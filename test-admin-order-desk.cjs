"use strict";
// JK_ADMIN_ORDER_DESK_V1: message log + one set of order actions shared by
// Telegram and the web panel. Temporary folders only; no Telegram requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMessageLog } = require("./jk-admin-messages.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-order-desk-"));
try {
  const file = path.join(dir, "admin-messages.json");
  let t = 1000;
  const log = createMessageLog(file, { now: () => t });

  // 1. Waiting = the customer's message is the latest one.
  log.log(111, "customer", "Hi"); t += 10;
  assert.equal(log.waiting(111), 1000);
  log.log(111, "admin", "Hello", "text"); t += 10;
  assert.equal(log.waiting(111), null);
  log.log(222, "customer", "Price?");
  assert.deepEqual(log.waitingUsers().map(w => w.userId), ["222"]);
  log.log("bad id", "customer", "x");
  assert.equal(log.thread("bad id").length, 0);

  // 2. Capped at 100 per customer; text capped at 2000 characters.
  for (let i = 0; i < 130; i++) log.log(333, "admin", "m" + i);
  assert.equal(log.thread(333).length, 100);
  assert.equal(log.thread(333)[0].text, "m30");
  log.log(444, "customer", "x".repeat(5000));
  assert.equal(log.thread(444)[0].text.length, 2000);

  // 3. Saved to disk and reloaded; old messages (90 days) dropped on the next write.
  log.flush();
  const again = createMessageLog(file, { now: () => t + 91 * 86400000 });
  assert.equal(again.thread(111).length, 2);
  again.log(111, "customer", "new");
  assert.deepEqual(again.thread(111).map(m => m.text), ["new"]);

  // 4. bot.js: Telegram buttons and the web panel share the same functions.
  const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  for (const kind of ["AI_UNAVAILABLE", "AI_STAR", "TILL", "CLEAN_COPY", "PRELIM_REMOVED"]) {
    assert(bot.includes('adminSendNoteToUser(userId, "' + kind + '")'), kind + " button uses the shared note");
  }
  assert.equal((bot.match(/await adminReplyToUser\(/g) || []).length, 2, "/reply and reply mode");
  assert(bot.includes("await adminFinishDelivery(userId, sentCount);"), "/donebatch");
  assert(bot.includes('adminMessages.log(user.id, "customer", text);'), "support messages logged");
  assert(bot.includes("logMessage: adminLogCustomerMessage,") && bot.includes("function adminLogCustomerMessage("), "website chat logged");
  assert(fs.readFileSync(path.join(__dirname, "jk-web-orders.cjs"), "utf8").includes('d.logMessage?.(order.uid, "customer", clean)'));
  for (const dep of ["replyToUser:", "sendNote:", "sendFileToUser:", "finishDelivery:", "customerOriginal:", "messages: adminMessages"]) {
    assert(bot.includes(dep), dep);
  }
  // The support reply wording is unchanged.
  assert(bot.includes("💬 *JK Turnitin Support*"));

  console.log("PASS: message log: waiting customers, 100-message cap, 90-day expiry, saved and reloaded.");
  console.log("PASS: Telegram /reply, reply mode, note buttons and /donebatch share the web panel's functions.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
