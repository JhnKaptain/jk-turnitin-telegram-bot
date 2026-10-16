"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), vm = require("vm"), assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
const reader = source.match(/function readFloatEnv\(name, fallback\) \{[\s\S]*?\n\}/)?.[0];
const hold = source.match(/const API_DELIVERY_HOLD_MINUTES = Math\.max\([\s\S]*?\n\);/)?.[0];
assert(reader && hold);
function delay(value) {
 const env = value === undefined ? {} : { API_DELIVERY_HOLD_MINUTES: value };
 return vm.runInNewContext(reader + "\n" + hold + "\nAPI_DELIVERY_HOLD_MINUTES * 60000;", { process: { env } });
}
assert.equal(delay(), 90000); assert.equal(delay("1.5"), 90000); assert.equal(delay("2"), 120000);
assert.equal(delay("invalid"), 90000); assert.equal(delay(""), 90000); assert.equal(delay("-1"), 0);
const summary = require("./jk-provider-admin-status.js").summary;
const notice = summary({ job: { userId: 123 }, file: { file_name: "Test.docx" }, stage: "ready", rendered: {}, remainingMs: 90000 });
assert(notice.includes("90 second(s)"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "jk-timing-test-")), now = Date.now(), hour = 3600000;
try {
 const files = [], records = {};
 function fixture(name, age, extra = {}) {
  const dir = path.join(root, "provider-runs", name); fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, "bundle.json"); fs.writeFileSync(filename, "test");
  const old = new Date(now - age); fs.utimesSync(filename, old, old); fs.utimesSync(dir, old, old);
  files.push({ providerBundleFile: filename, providerStatus: "COMPLETE", ...extra }); return dir;
 }
 fixture("recent", 24 * hour - 1000); const exact = fixture("boundary", 24 * hour);
 const expired = fixture("expired", 25 * hour); const active = fixture("active", 25 * hour, { providerStatus: "SCANNING" });
 const pending = fixture("pending-payment", 25 * hour);
 records.pending = { bundlePath: path.join(pending, "bundle.json"), status: "PENDING" };
 const purchasePath = path.join(root, "aiHighlightsPurchases.store.json"), purchaseText = JSON.stringify({ version: 1, records });
 fs.writeFileSync(purchasePath, purchaseText);
 const ledger = path.join(root, "dailySalesLedger.store.json"); fs.writeFileSync(ledger, "KEEP PAYMENT RECORDS");
 const { cleanFiles } = require("./jk-file-retention.js"); const jobs = { test: { files } };
 let saves = 0;
 const preview = cleanFiles({ dataDir: root, paidJobs: jobs, now, persist: () => saves++ });
 assert.equal(preview.eligible.length, 2); assert.equal(preview.deleted.length, 0); assert.equal(saves, 0);
 const result = cleanFiles({ dataDir: root, paidJobs: jobs, now, apply: true, persist: () => saves++ });
 assert.equal(result.deleted.length, 2); assert.equal(saves, 2);
 assert(!fs.existsSync(exact)); assert(!fs.existsSync(expired)); assert(fs.existsSync(active)); assert(fs.existsSync(pending));
 assert(fs.existsSync(path.join(root, "provider-runs", "recent")));
 assert.equal(files[1].providerFilesRetentionHours, 24); assert.equal(files[1].providerAutoResubmitBlocked, true);
 assert.equal(fs.readFileSync(purchasePath, "utf8"), purchaseText); assert.equal(fs.readFileSync(ledger, "utf8"), "KEEP PAYMENT RECORDS");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log("PASS: 90-second decimal delivery hold, defaults/env overrides, accurate notice and 24-hour retention boundary.");
console.log("PASS: recent/active/pending-payment files protected; payment and job records retained. Temporary fixtures only; no live deletions, scans or deliveries.");
