"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");

const creditFailure = error => /^Insufficient API credits\./i.test(String(error || ""));
const read = filename => JSON.parse(fs.readFileSync(filename, "utf8"));
function writeAtomic(filename, value) {
  const temporary = filename + ".write-" + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, filename);
}

async function retryCheckpoint(filename, provider, log = console.log) {
  filename = path.resolve(filename);
  assert(filename.endsWith(".provider-results.json"), "Unexpected checkpoint filename.");
  const stateFile = filename + ".quetext-credit-retry.json";
  const lockFile = stateFile + ".lock";
  const lock = fs.openSync(lockFile, "wx", 0o600);
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const saved = read(filename);
    const state = fs.existsSync(stateFile) ? read(stateFile) : {};
    assert.equal(saved.version, 1, "Unsupported checkpoint.");
    const existing = saved.providerResults?.similarity;
    if (existing?.status === "fulfilled" && state.reportId &&
        String(existing.value?.reportId) === String(state.reportId)) {
      log("Quetext result already saved. Reusing it without another scan.");
      return saved;
    }
    assert(existing?.status === "rejected" && creditFailure(existing.error),
      "Only a confirmed insufficient-credit rejection is eligible. Timeout/network failures require separate review.");
    assert.equal(saved.providerResults?.ai?.status, "fulfilled", "Completed saved Sapling result required.");
    const prepared = saved.preparedInputs?.similarity;
    assert(typeof prepared?.text === "string" && prepared.text.trim(), "Saved Quetext input missing.");
    assert.equal(prepared.map?.length, prepared.text.length, "Saved source map invalid.");
    assert(typeof saved.canonicalDocument?.text === "string", "Original document text missing.");
    const apiWordLimit = require("./jk-api-word-limit.cjs").readApiWordLimit();
    const words = prepared.text.trim().split(/\s+/u).length;
    assert(words <= apiWordLimit && words > 0, "Saved input exceeds automatic scan limit.");
    const sourceWords = saved.canonicalDocument.wordCount;
    assert(Number.isFinite(sourceWords) && sourceWords > 0 && sourceWords <= apiWordLimit,
      "Original word count must satisfy the API word limit.");
    if (!state.reportId && state.phase && state.phase !== "CREDIT_REJECTED") {
      throw new Error("Previous retry has uncertain submission status. Do not repeat a paid submission; inspect " + stateFile);
    }
    const backup = filename + ".before-credit-retry.json";
    if (!fs.existsSync(backup)) fs.copyFileSync(filename, backup, fs.constants.COPYFILE_EXCL);
    let reportId = state.reportId;
    if (!reportId) {
      writeAtomic(stateFile, { phase: "SUBMITTING", startedAt: new Date().toISOString() });
      log("Submitting Quetext only. Saved Sapling result will be reused.");
      let created;
      try {
        created = await provider.createPlagiarismReport({
          text: prepared.text,
          title: path.basename(saved.sourcePath || "Recovered document")
        });
      } catch (error) {
        writeAtomic(stateFile, {
          phase: Number(error.code) === 402 || Number(error.status) === 402
            ? "CREDIT_REJECTED" : "SUBMISSION_UNCERTAIN",
          error: String(error.message), updatedAt: new Date().toISOString()
        });
        throw error;
      }
      reportId = created.reportId;
      assert(reportId, "Quetext accepted response without report ID. Do not submit again.");
      writeAtomic(stateFile, { phase: "ACCEPTED", reportId, acceptedAt: new Date().toISOString() });
      log("Quetext accepted report " + reportId + ". Waiting for completion.");
    } else {
      log("Resuming existing Quetext report " + reportId + "; no new submission.");
    }
    const raw = await provider.waitForPlagiarismReport(reportId);
    const result = provider.normalizePlagiarismReport(raw);
    assert.equal(String(result.reportId), String(reportId), "Returned report ID differs.");
    assert(Number.isFinite(result.score) && result.score >= 0 && result.score <= 100,
      "Quetext similarity score missing or invalid.");
    const updated = JSON.parse(JSON.stringify(saved));
    updated.providerResults.similarity = { status: "fulfilled", value: result };
    updated.quetextCreditRetry = { reportId, completedAt: new Date().toISOString(), originalCheckpointBackup: backup };
    writeAtomic(filename, updated);
    writeAtomic(stateFile, { phase: "COMPLETE", reportId, completedAt: new Date().toISOString() });
    assert.deepEqual(updated.providerResults.ai, saved.providerResults.ai);
    log("Quetext result saved. Sapling result unchanged. Original checkpoint backed up.");
    return updated;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockFile);
  }
}

async function selfTest() {
  const os = require("os");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jk-credit-retry-test-"));
  const fixture = () => ({ version: 1, sourcePath: "/test/original.docx",
    canonicalDocument: { text: "Original text.", wordCount: 2 },
    preparedInputs: { similarity: { text: "Original text.", map: Array.from({ length: 14 }, (_, i) => i) } },
    providerResults: { similarity: { status: "rejected", error: "Insufficient API credits. Top up your balance to continue." },
      ai: { status: "fulfilled", value: { percent: 12.3, ranges: [] } } } });
  let creates = 0, polls = 0, failPoll = true;
  const provider = {
    createPlagiarismReport: async ({ text }) => { assert.equal(text, "Original text."); creates++; return { reportId: "123" }; },
    waitForPlagiarismReport: async id => { assert.equal(id, "123"); polls++; if (failPoll) { failPoll = false; throw new Error("poll interrupted"); } return { id }; },
    normalizePlagiarismReport: raw => ({ reportId: raw.id, score: 4, matches: [] })
  };
  try {
    const filename = path.join(directory, "bundle.json.provider-results.json");
    const original = fixture(); fs.writeFileSync(filename, JSON.stringify(original));
    await assert.rejects(() => retryCheckpoint(filename, provider, () => {}), /poll interrupted/);
    assert.equal(read(filename).providerResults.similarity.status, "rejected");
    const result = await retryCheckpoint(filename, provider, () => {});
    assert.equal(creates, 1); assert.equal(polls, 2);
    assert.deepEqual(result.providerResults.ai, original.providerResults.ai);
    assert.deepEqual(read(filename + ".before-credit-retry.json"), original);
    await retryCheckpoint(filename, provider, () => {});
    assert.equal(creates, 1); assert.equal(polls, 2);
    for (const error of ["Quetext API request timed out.", "fetch failed"]) {
      const other = path.join(directory, "other.provider-results.json");
      const bad = fixture(); bad.providerResults.similarity.error = error;
      fs.writeFileSync(other, JSON.stringify(bad));
      await assert.rejects(() => retryCheckpoint(other, provider, () => {}), /Only a confirmed/);
    }
    const uncertain = path.join(directory, "uncertain.provider-results.json");
    fs.writeFileSync(uncertain, JSON.stringify(fixture()));
    await assert.rejects(() => retryCheckpoint(uncertain, { ...provider,
      createPlagiarismReport: async () => { throw new Error("connection lost"); }
    }, () => {}), /connection lost/);
    await assert.rejects(() => retryCheckpoint(uncertain, provider, () => {}), /uncertain submission/);
    assert.equal(creates, 1);
    console.log("PASS: Quetext-only retry, saved AI preserved, backup, resume without duplicate charge, completed-result reuse and uncertain-attempt protection. Mock tests only; no API requests or messages.");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") return selfTest();
  assert(args.length === 2 && args[0] === "--checkpoint",
    "Usage: node jk-retry-quetext-credits.cjs --checkpoint PATH OR --self-test");
  assert(process.env.QUETEXT_API_KEY, "QUETEXT_API_KEY missing.");
  assert(process.env.BOT_TOKEN, "BOT_TOKEN missing. No scan started.");
  const adminId = Number(process.env.ADMIN_ID || "6569201830");
  assert(Number.isSafeInteger(adminId) && adminId > 0, "Invalid ADMIN_ID. No scan started.");
  const filename = path.resolve(args[1]);
  const jobsPath = path.join(process.env.DATA_DIR || "/var/data", "paidJobs.store.json");
  // Validate report identity before consuming Quetext words.
  require("./jk-recover-provider-results.js").identityFromStore(filename, jobsPath, read(filename));
  const recovery = path.join(__dirname, "jk-recover-reviewed-results.cjs");
  assert(fs.existsSync(recovery), "Recovery script missing. No scan started.");
  await retryCheckpoint(filename, require("./providers/quetext.js"));
  const child = spawnSync(process.execPath, [recovery, "--checkpoint", filename], { stdio: "inherit" });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
  if (child.status !== 0) {
    console.log("Quetext result remains saved. Fix recovery without another scan. No client delivery was triggered.");
  }
}
module.exports = { retryCheckpoint, selfTest };
if (require.main === module) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
