"use strict";
// JK_DELETE_FILES_NOW_V1: admin "delete now" (web panel and /deletefiles).
// Temporary folders only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { deleteFilesNow } = require("./jk-file-retention.js");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-delete-now-"));
const run = name => {
  const d = path.join(dir, "provider-runs", name);
  fs.mkdirSync(path.join(d, "reports"), { recursive: true });
  fs.writeFileSync(path.join(d, "original.docx"), "x");
  fs.writeFileSync(path.join(d, "bundle.json"), "{}");
  fs.writeFileSync(path.join(d, "reports", "r.pdf"), "%PDF");
  return path.join(d, "bundle.json");
};
const file = (id, bundle, extra = {}) => ({ jkSubmissionId: "trn:oid:::1:" + id, providerBundleFile: bundle, providerStatus: "COMPLETE", ...extra });

try {
  const jobs = {
    a: { jobId: "a", files: [file("1111111111", run("a-0")), file("2222222222", run("a-1"), { providerStatus: "SCANNING" })] },
    b: { jobId: "b", files: [file("3333333333", run("b-0")), file("4444444444", path.join(dir, "provider-runs", "b-0", "bundle.json"))] }
  };
  let saves = 0;
  const persist = () => { saves++; };

  // 1. Deletes the run folder, keeps a small record, blocks resubmission.
  let r = deleteFilesNow({ dataDir: dir, paidJobs: jobs, persist, submissionIds: ["1111111111"], by: "admin-web-panel", now: 5 });
  assert.deepEqual(r.deleted, ["1111111111"]);
  assert.equal(fs.existsSync(path.join(dir, "provider-runs", "a-0")), false);
  const f = jobs.a.files[0];
  assert.equal(f.providerFilesDeletedAt, 5);
  assert.equal(f.providerFilesDeletedBy, "admin-web-panel");
  assert.equal(f.providerAutoResubmitBlocked, true);
  assert.equal(f.providerRetryStopped, true);
  assert.equal(saves, 1, "records saved before deleting");

  // 2. Already deleted, processing, unknown, shared folder.
  r = deleteFilesNow({ dataDir: dir, paidJobs: jobs, persist, submissionIds: ["1111111111", "2222222222", "9999999999", "3333333333"] });
  assert.deepEqual(r.deleted, []);
  assert.deepEqual(r.skipped.map(s => s.reason).sort(), ["Already deleted", "Folder shared with another file", "Not found", "Processing or delivery still active"]);
  assert(fs.existsSync(path.join(dir, "provider-runs", "a-1")));

  // 3. Selecting every file that shares the folder deletes it.
  r = deleteFilesNow({ dataDir: dir, paidJobs: jobs, persist, submissionIds: ["3333333333", "4444444444"] });
  assert.deepEqual(r.deleted.sort(), ["3333333333", "4444444444"]);
  assert.equal(fs.existsSync(path.join(dir, "provider-runs", "b-0")), false);

  // 4. A failed record save deletes nothing and restores the record.
  jobs.a.files[1].providerStatus = "COMPLETE";
  assert.throws(() => deleteFilesNow({ dataDir: dir, paidJobs: jobs, persist: () => { throw new Error("disk full"); }, submissionIds: ["2222222222"] }), /not deleted/);
  assert(fs.existsSync(path.join(dir, "provider-runs", "a-1")));
  assert.equal(jobs.a.files[1].providerFilesDeletedAt, undefined);

  // 5. Bot wiring: shared by the web panel and Telegram; uploads removed too.
  const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  assert(bot.includes("function deleteStoredFilesNow(ids, by)"));
  assert(bot.includes("deleteFiles: (ids, by) => deleteStoredFilesNow(ids, by)"));
  assert(bot.includes('bot.command("deletefiles"') && bot.includes('deleteStoredFilesNow(pending.ids, "admin-telegram")'));
  assert(bot.includes("webOrders?.removeWebFile?.(fileId)") && bot.includes("adminPanel.removeUpload(fileId)"));
  assert(bot.indexOf('bot.command("deletefiles"') < bot.indexOf('bot.command("adminhelp"'));

  console.log("PASS: delete now removes stored files, keeps a record, blocks resubmission, saves records first.");
  console.log("PASS: refuses while processing, for shared folders, unknown or already-deleted IDs; failed save deletes nothing.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
