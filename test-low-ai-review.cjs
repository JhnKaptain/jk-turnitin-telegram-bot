"use strict";
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { validateBundle, sendAdmin } = require("./jk-low-ai-review.cjs");
const { summary } = require("./jk-provider-admin-status.js");

async function run() {
  const bundle = { canonicalDocument: { text: "Original sentence.\nOther writing." },
    aiDetection: { available: true, provider: "sapling", percent: 12.3,
      ranges: [{ id: "sentence-1", start: 0, end: 18, sentence: "Original sentence.", score: 0.9 }] } };
  const original = JSON.stringify(bundle);
  assert.equal(validateBundle(bundle), 12.3);
  assert.equal(JSON.stringify(bundle), original);
  for (const percent of [0, 20, 100, null, ""]) {
    const copy = JSON.parse(original); copy.aiDetection.percent = percent;
    assert.throws(() => validateBundle(copy));
  }
  for (const edit of [
    b => b.aiDetection.ranges = [],
    b => b.aiDetection.ranges[0].start = 1,
    b => b.aiDetection.ranges[0].score = 0.1,
    b => b.aiDetection.provider = "other"
  ]) {
    const copy = JSON.parse(original); edit(copy);
    assert.throws(() => validateBundle(copy));
  }
  const base = { job: { userId: 111 }, file: { file_name: "Example.docx",
    providerBundleFile: "/var/data/example/bundle.json", providerAiPercent: 12.3 },
    rendered: { aiAvailable: true, aiPercent: 12.3 }, runAi: true, remainingMs: 0 };
  for (const stage of ["ready", "delivered"]) {
    assert(summary({ ...base, stage }).includes('node jk-low-ai-review.cjs --bundle "/var/data/example/bundle.json"'));
  }
  for (const percent of [0, 20, 90]) {
    assert(!summary({ ...base, stage: "ready", rendered: { aiAvailable: true, aiPercent: percent } })
      .includes("node jk-low-ai-review.cjs"));
  }
  assert(!summary({ ...base, stage: "ready", runAi: false }).includes("node jk-low-ai-review.cjs"));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jk-low-ai-test-"));
  const filename = path.join(directory, "fixture.pdf");
  fs.writeFileSync(filename, "test fixture");
  try {
    const sends = [];
    await sendAdmin(filename, "test", { token: "test-token", adminId: "999",
      telegram: { sendDocument: async (recipient, document) => {
        sends.push(recipient); document.source.destroy();
      } } });
    assert.deepEqual(sends, [999]);
    await assert.rejects(() => sendAdmin(filename, "test", { token: "test-token", adminId: "invalid",
      telegram: { sendDocument: async () => assert.fail("Must not send") } }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  console.log("PASS: low-score eligibility, saved-range verification, unchanged results, admin-only recipient and alert commands. No API or Telegram requests made.");
}
module.exports = { run };
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
