"use strict";
// JK_WEBSITE_MOVE_NOTICE_V1: the "moving to our website / get the app" note on the
// reports-delivered message. Automatic: once per customer per 24 h; done batch:
// always; website customers: never. Temporary folder only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWebsiteNotice, TEXT } = require("./jk-website-notice.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-notice-"));
try {
  let t = 1_000_000;
  const file = path.join(dir, "website-notice.json");
  const n = createWebsiteNotice({ file, now: () => t, isWebUser: id => String(id).startsWith("9000") });

  // 1. First automatic delivery: the note; again the same day: nothing.
  assert.equal(n.forUser(5189765792), "\n\n" + TEXT);
  t += 60 * 60 * 1000;
  assert.equal(n.forUser(5189765792), "", "once per 24 hours");
  // Another customer is independent.
  assert.equal(n.forUser(6001234567), "\n\n" + TEXT);
  // 2. The admin's done batch: always included.
  assert.equal(n.forUser(5189765792, { force: true }), "\n\n" + TEXT);
  // 3. After 24 hours: again.
  t += 24 * 60 * 60 * 1000 + 1;
  assert.equal(n.forUser(5189765792), "\n\n" + TEXT);
  // 4. Website customers never get it.
  assert.equal(n.forUser(9000000000000123), "");
  assert.equal(n.forUser(9000000000000123, { force: true }), "");
  // 5. Remembered across restarts.
  const again = createWebsiteNotice({ file, now: () => t });
  assert.equal(again.forUser(5189765792), "", "survives a restart");

  // 6. The text: website link and app steps.
  assert.match(TEXT, /We're moving to our website/);
  assert.match(TEXT, /https:\/\/jkacademictoolshub\.com/);
  assert.match(TEXT, /📲 Get the app/);
  assert.match(TEXT, /Add to Home Screen/);

  // 7. Wiring: automatic delivery (limited) and done batch (always).
  const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  assert(bot.includes("websiteNotice.forUser(job.userId)"), "automatic delivery: limited");
  assert(bot.includes("API_REPORTS_DELIVERED_MESSAGE + websiteNotice.forUser(userId, { force: true })"), "done batch: always");
  console.log("PASS: website/app note: automatic once per customer per 24 h; done batch always; never for website customers; survives restarts.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
