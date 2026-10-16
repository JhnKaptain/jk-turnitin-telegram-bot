"use strict";
const fs = require("fs"), { spawnSync } = require("child_process");
const patches = {"bot.js": [["readIntEnv(\"API_DELIVERY_HOLD_MINUTES\", 3)", "readFloatEnv(\"API_DELIVERY_HOLD_MINUTES\", 1.5)"]], "jk-provider-admin-status.js": [["Math.ceil(remainingMs / 60000) + \" minute(s).\"", "Math.ceil(remainingMs / 1000) + \" second(s).\""]], "jk-file-retention.js": [["const RETENTION_MS = 48 * 60 * 60 * 1000;", "const RETENTION_MS = 24 * 60 * 60 * 1000;"], ["Less than 48 hours since last file change", "Less than 24 hours since last file change"], ["file.providerFilesRetentionHours = 48;", "file.providerFilesRetentionHours = 24;"], ["48-hour file cleanup:", "24-hour file cleanup:"], ["const old = new Date(now - 49 * 60 * 60 * 1000);", "const old = new Date(now - 25 * 60 * 60 * 1000);"], ["PASS: 48-hour expiry and preview mode.", "PASS: 24-hour expiry and preview mode."]]};
const test = "\"use strict\";\nconst fs = require(\"fs\"), path = require(\"path\"), os = require(\"os\"), vm = require(\"vm\"), assert = require(\"node:assert/strict\");\nconst source = fs.readFileSync(path.join(__dirname, \"bot.js\"), \"utf8\");\nconst reader = source.match(/function readFloatEnv\\(name, fallback\\) \\{[\\s\\S]*?\\n\\}/)?.[0];\nconst hold = source.match(/const API_DELIVERY_HOLD_MINUTES = Math\\.max\\([\\s\\S]*?\\n\\);/)?.[0];\nassert(reader && hold);\nfunction delay(value) {\n const env = value === undefined ? {} : { API_DELIVERY_HOLD_MINUTES: value };\n return vm.runInNewContext(reader + \"\\n\" + hold + \"\\nAPI_DELIVERY_HOLD_MINUTES * 60000;\", { process: { env } });\n}\nassert.equal(delay(), 90000); assert.equal(delay(\"1.5\"), 90000); assert.equal(delay(\"2\"), 120000);\nassert.equal(delay(\"invalid\"), 90000); assert.equal(delay(\"\"), 90000); assert.equal(delay(\"-1\"), 0);\nconst summary = require(\"./jk-provider-admin-status.js\").summary;\nconst notice = summary({ job: { userId: 123 }, file: { file_name: \"Test.docx\" }, stage: \"ready\", rendered: {}, remainingMs: 90000 });\nassert(notice.includes(\"90 second(s)\"));\nconst root = fs.mkdtempSync(path.join(os.tmpdir(), \"jk-timing-test-\")), now = Date.now(), hour = 3600000;\ntry {\n const files = [], records = {};\n function fixture(name, age, extra = {}) {\n  const dir = path.join(root, \"provider-runs\", name); fs.mkdirSync(dir, { recursive: true });\n  const filename = path.join(dir, \"bundle.json\"); fs.writeFileSync(filename, \"test\");\n  const old = new Date(now - age); fs.utimesSync(filename, old, old); fs.utimesSync(dir, old, old);\n  files.push({ providerBundleFile: filename, providerStatus: \"COMPLETE\", ...extra }); return dir;\n }\n fixture(\"recent\", 24 * hour - 1000); const exact = fixture(\"boundary\", 24 * hour);\n const expired = fixture(\"expired\", 25 * hour); const active = fixture(\"active\", 25 * hour, { providerStatus: \"SCANNING\" });\n const pending = fixture(\"pending-payment\", 25 * hour);\n records.pending = { bundlePath: path.join(pending, \"bundle.json\"), status: \"PENDING\" };\n const purchasePath = path.join(root, \"aiHighlightsPurchases.store.json\"), purchaseText = JSON.stringify({ version: 1, records });\n fs.writeFileSync(purchasePath, purchaseText);\n const ledger = path.join(root, \"dailySalesLedger.store.json\"); fs.writeFileSync(ledger, \"KEEP PAYMENT RECORDS\");\n const { cleanFiles } = require(\"./jk-file-retention.js\"); const jobs = { test: { files } };\n let saves = 0;\n const preview = cleanFiles({ dataDir: root, paidJobs: jobs, now, persist: () => saves++ });\n assert.equal(preview.eligible.length, 2); assert.equal(preview.deleted.length, 0); assert.equal(saves, 0);\n const result = cleanFiles({ dataDir: root, paidJobs: jobs, now, apply: true, persist: () => saves++ });\n assert.equal(result.deleted.length, 2); assert.equal(saves, 2);\n assert(!fs.existsSync(exact)); assert(!fs.existsSync(expired)); assert(fs.existsSync(active)); assert(fs.existsSync(pending));\n assert(fs.existsSync(path.join(root, \"provider-runs\", \"recent\")));\n assert.equal(files[1].providerFilesRetentionHours, 24); assert.equal(files[1].providerAutoResubmitBlocked, true);\n assert.equal(fs.readFileSync(purchasePath, \"utf8\"), purchaseText); assert.equal(fs.readFileSync(ledger, \"utf8\"), \"KEEP PAYMENT RECORDS\");\n} finally { fs.rmSync(root, { recursive: true, force: true }); }\nconsole.log(\"PASS: 90-second decimal delivery hold, defaults/env overrides, accurate notice and 24-hour retention boundary.\");\nconsole.log(\"PASS: recent/active/pending-payment files protected; payment and job records retained. Temporary fixtures only; no live deletions, scans or deliveries.\");\n";
const originals = new Map(), updates = new Map();
for (const [name, edits] of Object.entries(patches)) {
  const original = fs.readFileSync(name, "utf8"); originals.set(name, original);
  let next = original.replace(/\r\n/g, "\n");
  for (const [before, after] of edits) {
    if (!next.includes(before) && next.split(after).length === 2) continue;
    if (next.split(before).length !== 2) throw new Error("Expected timing code missing or ambiguous in " + name + ". Nothing changed.");
    next = next.replace(before, () => after);
  }
  updates.set(name, next.trimEnd() + "\n");
}
const testName = "test-report-timing.cjs";
const oldTest = fs.existsSync(testName) ? fs.readFileSync(testName, "utf8") : null;
if (oldTest !== null && oldTest.replace(/\r\n/g, "\n") !== test) throw new Error("A different timing test exists. Nothing changed.");
originals.set(testName, oldTest); updates.set(testName, test);
const stamp = Date.now();
for (const [name, original] of originals) if (original !== null) fs.writeFileSync(name + ".timing-backup-" + stamp, original, { flag: "wx" });
try {
  for (const [name, value] of updates) fs.writeFileSync(name, value);
  for (const args of [["--check", "bot.js"], ["--check", "jk-provider-admin-status.js"], ["jk-file-retention.js", "--self-test"], [testName]]) {
    const result = spawnSync(process.execPath, args, { stdio: "inherit" });
    if (result.error || result.status !== 0) throw result.error || new Error("Validation failed.");
  }
  console.log("PASS: 24-hour file retention and 90-second default delivery hold installed.");
  console.log("Set API_DELIVERY_HOLD_MINUTES=1.5 in Render. Existing environment settings override the default.");
  console.log("No live files deleted, provider requests made or Telegram deliveries triggered by this installer.");
} catch (error) {
  for (const [name, original] of originals) {
    if (original === null) { if (fs.existsSync(name)) fs.unlinkSync(name); }
    else fs.writeFileSync(name, original);
  }
  throw error;
}
