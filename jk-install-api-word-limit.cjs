"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = __dirname;
const patches = {"jk-provider-pipeline.js": [["const API_WORD_LIMIT_EXCLUSIVE = 4800;", "const API_WORD_LIMIT = require(\"./jk-api-word-limit.cjs\").readApiWordLimit();"], ["largestWordCount >= API_WORD_LIMIT_EXCLUSIVE ||", "largestWordCount > API_WORD_LIMIT ||"], ["\" words. API requires fewer than 4800.\"", "\" words. API allows up to \" + API_WORD_LIMIT + \" words.\""]], "jk-retry-quetext-credits.cjs": [["    const words = prepared.text.trim().split(/\\s+/u).length;", "    const apiWordLimit = require(\"./jk-api-word-limit.cjs\").readApiWordLimit();\n    const words = prepared.text.trim().split(/\\s+/u).length;"], ["words < 4800 && words > 0", "words <= apiWordLimit && words > 0"], ["sourceWords > 0 && sourceWords < 4800", "sourceWords > 0 && sourceWords <= apiWordLimit"]]};
const files = {"jk-api-word-limit.cjs": "\"use strict\";\nfunction readApiWordLimit(env = process.env) {\n  const raw = String(env.API_MAX_WORDS ?? \"\").trim();\n  if (!raw) return 5000;\n  const limit = Number(raw);\n  if (!/^\\d+$/.test(raw) || !Number.isSafeInteger(limit) || limit < 1) {\n    const error = new Error(\"API_MAX_WORDS must be a positive whole number. API submission blocked.\");\n    error.code = \"API_MANUAL_REVIEW_REQUIRED\";\n    error.apiBlocked = true;\n    throw error;\n  }\n  return limit;\n}\nmodule.exports = { readApiWordLimit };\n", "test-api-word-guard.js": "\"use strict\";\nconst fs = require(\"fs\");\nconst path = require(\"path\");\nconst assert = require(\"node:assert/strict\");\nconst { readApiWordLimit } = require(\"./jk-api-word-limit.cjs\");\nconst source = fs.readFileSync(path.join(__dirname, \"jk-provider-pipeline.js\"), \"utf8\");\nconst start = source.indexOf(\"// JK_SHARED_API_WORD_GUARD_V1\");\nconst end = source.indexOf(\"  const result = {\", start);\nassert(start >= 0 && end > start, \"Shared API word guard missing.\");\nconst validate = new Function(\"document\", \"similarityPrepared\", \"aiPrepared\", \"runSimilarity\", \"runAi\", \"require\", source.slice(start, end) + \"\\nreturn true;\");\nconst words = n => Array(n).fill(\"word\").join(\" \");\nfunction check(label, original, similarity, ai, blocked, env = {}, extra = {}) {\n  let error;\n  try {\n    validate({ text: words(original), wordCount: extra.extractor ?? original },\n      {text: words(similarity)}, {text: words(ai)}, extra.similarity ?? true,\n      extra.ai ?? true, name => {\n        assert.equal(name, \"./jk-api-word-limit.cjs\");\n        return { readApiWordLimit: () => readApiWordLimit(env) };\n      });\n  } catch (caught) { error = caught; }\n  if (error && error.code !== \"API_MANUAL_REVIEW_REQUIRED\") throw error;\n  assert.equal(Boolean(error), blocked, label);\n  if (error) assert.equal(error.apiBlocked, true);\n  console.log(\"PASS:\", label);\n}\ncheck(\"4999 allowed\",4999,4999,4999,false);\ncheck(\"Exactly 5000 allowed\",5000,5000,5000,false);\ncheck(\"5001 blocked\",5001,5001,5001,true);\ncheck(\"Quetext input oversized\",4900,5001,4900,true);\ncheck(\"Sapling input oversized\",4900,4900,5001,true);\ncheck(\"Extractor count oversized\",4900,4900,4900,true,{}, {extractor:5001});\ncheck(\"Empty original blocked\",0,100,100,true);\ncheck(\"Configured boundary allowed\",3000,3000,3000,false,{API_MAX_WORDS:\"3000\"});\ncheck(\"Configured boundary exceeded\",3001,3001,3001,true,{API_MAX_WORDS:\"3000\"});\ncheck(\"Configured increase allowed\",6000,6000,6000,false,{API_MAX_WORDS:\"6000\"});\ncheck(\"Unused provider excluded\",100,6000,100,false,{}, {similarity:false});\nfor (const value of [\"0\", \"-1\", \"1.5\", \"oops\", \"Infinity\", \"9007199254740992\"]) {\n  check(\"Invalid configuration blocked: \" + value,100,100,100,true,{API_MAX_WORDS:value});\n}\nassert.equal(readApiWordLimit({}),5000);\nassert.equal(readApiWordLimit({API_MAX_WORDS:\" \"}),5000);\nassert.equal(readApiWordLimit({API_MAX_WORDS:\" 5200 \"}),5200);\n// Execute the actual credit-retry guard in isolation; no provider is loaded.\nconst retry = fs.readFileSync(path.join(__dirname,\"jk-retry-quetext-credits.cjs\"),\"utf8\");\nconst rs = retry.indexOf(\"    const apiWordLimit =\");\nconst re = retry.indexOf(\"    if (!state.reportId\",rs);\nassert(rs >= 0 && re > rs);\nconst retryGuard = new Function(\"prepared\",\"saved\",\"assert\",\"require\",retry.slice(rs,re));\nfor (const cap of [3000,5000,6000]) {\n  for (const n of [cap,cap+1]) {\n    const invoke = () => retryGuard({text:words(n)}, {canonicalDocument:{wordCount:n}}, assert,\n      () => ({readApiWordLimit:()=>readApiWordLimit({API_MAX_WORDS:String(cap)})}));\n    if (n === cap) assert.doesNotThrow(invoke); else assert.throws(invoke);\n  }\n}\nconsole.log(\"PASS: credit retry uses the same configurable inclusive limit.\");\nconsole.log(\"ALL WORD-LIMIT TESTS PASSED. No API requests or deliveries.\");\n"};
const changes = new Map();
for (const [name, replacements] of Object.entries(patches)) {
  const filename = path.join(root,name);
  let value = fs.readFileSync(filename,"utf8");
  for (const [before,after] of replacements) {
    if (!value.includes(before) && value.includes(after)) continue;
    if (value.split(before).length !== 2) throw new Error("Unexpected source in " + name + ". Nothing changed.");
    value = value.replace(before, () => after);
  }
  changes.set(filename,value);
}
for (const [name,value] of Object.entries(files)) changes.set(path.join(root,name),value);
const originals = new Map();
const stamp = Date.now();
try {
  for (const [filename,value] of changes) {
    const original = fs.existsSync(filename) ? fs.readFileSync(filename) : null;
    originals.set(filename,original);
    if (original) fs.writeFileSync(filename + ".word-limit-backup-" + stamp, original, {flag:"wx"});
    fs.writeFileSync(filename,value);
  }
  for (const filename of changes.keys()) {
    const result = spawnSync(process.execPath,["--check",filename],{cwd:root,stdio:"inherit"});
    if (result.error || result.status !== 0) throw result.error || new Error("Syntax check failed.");
  }
  const result = spawnSync(process.execPath,[path.join(root,"test-api-word-guard.js")],{cwd:root,stdio:"inherit"});
  if (result.error || result.status !== 0) throw result.error || new Error("Word-limit tests failed.");
  console.log("PASS: API_MAX_WORDS installed; default 5000 words inclusive. No scans or deliveries.");
} catch (error) {
  for (const [filename,original] of originals) {
    if (original === null) { if(fs.existsSync(filename)) fs.unlinkSync(filename); }
    else fs.writeFileSync(filename,original);
  }
  console.error("Installation failed; original files restored.");
  throw error;
}
