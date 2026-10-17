"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const read = filename => JSON.parse(fs.readFileSync(filename, "utf8"));
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function writeAtomic(filename, value) {
  const temp = filename + ".write-" + crypto.randomBytes(8).toString("hex");
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, filename);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function wordCount(value) {
  const text = String(value || "").normalize("NFKC").trim();
  return Math.max((text.match(/\S+/gu) || []).length, (text.match(/[\p{L}\p{N}]+/gu) || []).length);
}
function prepare(saved, deps) {
  assert.equal(saved.version, 1, "Unsupported checkpoint version.");
  assert.equal(saved.providerResults?.similarity?.status, "fulfilled", "Completed Quetext result required. No scan started.");
  assert.equal(saved.providerResults?.ai?.status, "fulfilled", "Completed old AI result required.");
  const document = saved.canonicalDocument;
  assert(typeof document?.text === "string" && document.pages?.length, "Saved original layout missing.");
  assert(typeof saved.preparedInputs?.ai?.text === "string", "Saved old AI input missing.");
  const input = deps.buildAiInput(document.text, document);
  assert.equal(input.aiHeadingPolicy, "assessment-cover-and-formatted-labels-v4", "Deploy the assessment-cover fix first.");
  assert(Array.isArray(input.map) && input.map.length === input.text.length, "Invalid AI source map.");
  let previous = -1;
  for (const n of input.map) {
    if (n === null) continue;
    assert(Number.isInteger(n) && n >= 0 && n < document.text.length && n > previous, "Invalid source mapping. No scan started.");
    previous = n;
  }
  assert((input.aiCoverPagesExcluded || 0) + (input.aiCoverBlocksExcluded || 0) > 0,
    "No cover exclusion detected. No scan started.");
  const maxWords = deps.readApiWordLimit();
  const counts = [wordCount(document.text), wordCount(input.text), Number(document.wordCount) || 0];
  assert(counts[0] > 0 && counts[1] > 0 && Math.max(...counts) <= maxWords, "Document exceeds API_MAX_WORDS or text is empty.");
  const eligible = deps.aiEligibility(input);
  assert(eligible.eligible, "AI input ineligible: " + eligible.reason);
  return input;
}
async function rescanCheckpoint(filename, deps, log = console.log) {
  filename = path.resolve(filename);
  assert(filename.endsWith(".provider-results.json"), "Unexpected checkpoint filename.");
  const journalPath = filename + ".ai-policy-rescan.json";
  const lockPath = journalPath + ".lock";
  const lock = fs.openSync(lockPath, "wx", 0o600);
  try {
    const saved = read(filename);
    const input = prepare(saved, deps);
    const fingerprint = digest(input);
    const journal = fs.existsSync(journalPath) ? read(journalPath) : null;
    const preserved = { similarity: saved.providerResults.similarity, prepared: saved.preparedInputs.similarity, document: saved.canonicalDocument };
    if (journal) {
      assert.equal(journal.inputHash, fingerprint, "A previous rescan used different input. Review before another paid scan.");
      assert.equal(journal.preservedHash, digest(preserved), "Saved Quetext result, input or original changed. Review required.");
      if (["COMPLETE", "RESULT_SAVED"].includes(journal.phase)) {
        assert(journal.result, "Saved rescan result missing. Do not resubmit.");
        const updated = JSON.parse(JSON.stringify(saved));
        updated.preparedInputs.ai = input;
        updated.providerResults.ai = { status: "fulfilled", value: journal.result };
        updated.aiPolicyRescan = { policy: input.aiHeadingPolicy, completedAt: journal.completedAt,
          originalCheckpointBackup: filename + ".before-ai-policy-rescan.json" };
        writeAtomic(filename, updated);
        writeAtomic(journalPath, { ...journal, phase: "COMPLETE" });
        log("Reusing the saved corrected AI result. No new provider request.");
        return updated;
      }
      throw new Error("Previous AI submission has uncertain status. Do not repeat a paid scan; share " + journalPath);
    }
    assert.notEqual(input.text, saved.preparedInputs.ai.text, "AI input is already unchanged by this policy. No scan needed.");
    const backup = filename + ".before-ai-policy-rescan.json";
    fs.copyFileSync(filename, backup, fs.constants.COPYFILE_EXCL);
    const state = { version: 1, phase: "SUBMITTING", inputHash: fingerprint, preservedHash: digest(preserved), startedAt: new Date().toISOString() };
    writeAtomic(journalPath, state);
    log("Submitting Sapling only with corrected cover exclusions. Reusing completed Quetext result.");
    let result;
    try {
      result = await deps.checkAi({ text: input.text });
      assert(Number.isFinite(result?.percent) && result.percent >= 0 && result.percent <= 100,
        "Sapling returned no valid AI percentage. Do not repeat the scan.");
      assert(Array.isArray(result.ranges), "Sapling ranges missing. Do not repeat the scan.");
    } catch (error) {
      writeAtomic(journalPath, { ...state, phase: "UNCERTAIN", error: String(error.message) });
      throw error;
    }
    const completedAt = new Date().toISOString();
    const finished = { ...state, phase: "RESULT_SAVED", result, completedAt };
    writeAtomic(journalPath, finished);
    const updated = JSON.parse(JSON.stringify(saved));
    updated.preparedInputs.ai = input;
    updated.providerResults.ai = { status: "fulfilled", value: result };
    updated.aiPolicyRescan = { policy: input.aiHeadingPolicy, completedAt, originalCheckpointBackup: backup };
    assert.deepEqual(updated.providerResults.similarity, saved.providerResults.similarity);
    assert.deepEqual(updated.preparedInputs.similarity, saved.preparedInputs.similarity);
    writeAtomic(filename, updated);
    writeAtomic(journalPath, { ...finished, phase: "COMPLETE" });
    log("Corrected AI result saved: " + result.percent + "%. Quetext unchanged; old checkpoint backed up.");
    return updated;
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}
async function selfTest() {
  const os = require("os");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jk-ai-policy-test-"));
  let calls = 0;
  const text = "Cover Name\n" + Array(320).fill("body").join(" ");
  const saved = { version: 1, canonicalDocument: { text, pages: [{}], wordCount: 322 },
    preparedInputs: { similarity: { text, map: Array.from({length:text.length},(_,i)=>i) },
      ai: { text, map: Array.from({length:text.length},(_,i)=>i) } },
    providerResults: { similarity: { status:"fulfilled", value:{percent:1,matches:[]} },
      ai: { status:"fulfilled", value:{percent:64.6,ranges:[]} } } };
  const input = { text: "          \n" + text.slice(11),
    map: Array.from({length:text.length},(_,i)=>i<10?null:i),
    aiHeadingPolicy:"assessment-cover-and-formatted-labels-v4",aiCoverPagesExcluded:1 };
  const deps = { buildAiInput:()=>input, readApiWordLimit:()=>5000, aiEligibility:()=>({eligible:true}),
    checkAi:async({text:sent})=>{calls++;assert.equal(sent,input.text);return {percent:57.2,ranges:[]};} };
  try {
    const filename=path.join(directory,"bundle.json.provider-results.json");
    fs.writeFileSync(filename,JSON.stringify(saved));
    const old=fs.readFileSync(filename);
    let updated=await rescanCheckpoint(filename,deps,()=>{});
    assert.equal(calls,1);assert.equal(updated.providerResults.ai.value.percent,57.2);
    assert.deepEqual(updated.providerResults.similarity,saved.providerResults.similarity);
    assert.deepEqual(updated.preparedInputs.similarity,saved.preparedInputs.similarity);
    assert.deepEqual(updated.canonicalDocument,saved.canonicalDocument);
    assert.deepEqual(fs.readFileSync(filename+".before-ai-policy-rescan.json"),old);
    await rescanCheckpoint(filename,deps,()=>{});assert.equal(calls,1);
    const journalPath=filename+".ai-policy-rescan.json";
    const journal=read(journalPath);writeAtomic(journalPath,{...journal,phase:"RESULT_SAVED"});
    fs.writeFileSync(filename,JSON.stringify(saved));
    await rescanCheckpoint(filename,deps,()=>{});assert.equal(calls,1);
    const uncertain=path.join(directory,"uncertain.provider-results.json");
    fs.writeFileSync(uncertain,JSON.stringify(saved));
    await assert.rejects(()=>rescanCheckpoint(uncertain,{...deps,checkAi:async()=>{calls++;throw Error("connection lost");}},()=>{}),/connection lost/);
    await assert.rejects(()=>rescanCheckpoint(uncertain,deps,()=>{}),/uncertain status/);assert.equal(calls,2);
    assert.deepEqual(read(uncertain),saved);
    const bad=path.join(directory,"bad.provider-results.json");
    fs.writeFileSync(bad,JSON.stringify(saved));
    await assert.rejects(()=>rescanCheckpoint(bad,{...deps,readApiWordLimit:()=>300},()=>{}),/API_MAX_WORDS/);
    await assert.rejects(()=>rescanCheckpoint(bad,{...deps,buildAiInput:()=>({...input,aiCoverPagesExcluded:0})},()=>{}),/No cover exclusion/);
    assert.equal(calls,2);
    console.log("PASS: AI-only rescan, preserved Quetext/original layout, exact backup, saved-result reuse, interrupted-save recovery and uncertain-charge protection.");
    console.log("PASS: word-limit and cover-exclusion checks. Mock tests only; no scans or deliveries.");
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
}
async function main() {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==="--self-test")return selfTest();
  assert(args[0]==="--checkpoint"&&args[1]&&args.length===2,
    "Usage: node jk-rescan-ai-policy.cjs --checkpoint PATH OR --self-test");
  assert(process.env.SAPLING_API_KEY,"SAPLING_API_KEY missing. No scan started.");
  assert(process.env.BOT_TOKEN,"BOT_TOKEN missing. No scan started.");
  const adminId=Number(process.env.ADMIN_ID||"6569201830");
  assert(Number.isSafeInteger(adminId)&&adminId>0,"Invalid ADMIN_ID.");
  const filename=path.resolve(args[1]);
  const jobs=path.join(process.env.DATA_DIR||"/var/data","paidJobs.store.json");
  require("./jk-recover-provider-results.js").identityFromStore(filename,jobs,read(filename));
  const recovery=path.join(__dirname,"jk-recover-reviewed-results.cjs");
  assert(fs.existsSync(recovery),"Recovery script missing. No scan started.");
  const {aiEligibility}=require("./jk-provider-pipeline.js");
  await rescanCheckpoint(filename,{
    buildAiInput:require("./jk-scan-text.js").buildAiInput,
    readApiWordLimit:require("./jk-api-word-limit.cjs").readApiWordLimit,
    aiEligibility,checkAi:require("./providers/sapling.js").checkAi
  });
  const child=spawnSync(process.execPath,[recovery,"--checkpoint",filename],{stdio:"inherit"});
  if(child.error)throw child.error;
  process.exitCode=child.status??1;
  if(child.status!==0)console.log("AI result is saved. Rerunning this command reuses it without another scan. No client delivery triggered.");
}
module.exports={rescanCheckpoint,selfTest};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
