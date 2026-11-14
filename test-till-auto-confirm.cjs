"use strict";
// JK_TILL_AUTO_CONFIRM_V1: till proofs passing every check are confirmed after 4 minutes
// without admin action; the payment must be after the file was sent. Offline: fake clock,
// fake confirm. No Telegram, IntaSend or M-Pesa requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseMpesaTime, timeWarnings, eligibility, createTillAutoConfirm, WAIT_MS } = require("./jk-till-auto-confirm.cjs");

(async () => {
  // 1. Kenya-time parsing (UTC+3); a time without a date is not accepted.
  assert.equal(parseMpesaTime("14/11/26 2:31 AM"), Date.UTC(2026, 10, 13, 23, 31));
  assert.equal(parseMpesaTime("14/11/2026 14:31"), Date.UTC(2026, 10, 14, 11, 31));
  assert.equal(parseMpesaTime("14-11-26 12:05 PM"), Date.UTC(2026, 10, 14, 9, 5));
  assert.equal(parseMpesaTime("2:31 AM"), null);
  assert.equal(parseMpesaTime("31/02/26 1:00 PM"), null);
  assert.equal(parseMpesaTime(""), null);

  const fileSent = Date.UTC(2026, 10, 13, 23, 20);   // 2:20 AM Kenya
  const proofAt = Date.UTC(2026, 10, 13, 23, 33);    // 2:33 AM Kenya
  const proof = (over = {}) => ({
    type: "mpesa-text", confidence: "High", amountMatch: true, recipientMatch: true,
    code: "QJK4ABCD12", duplicateCode: false, amount: 100,
    detectedTime: "14/11/26 2:31 AM", filesSentAt: fileSent, receivedAt: proofAt, ...over
  });

  // 2. Payment-time check (used for every till proof).
  assert.deepEqual(timeWarnings(proof()), []);
  assert.deepEqual(timeWarnings(proof({ detectedTime: "14/11/26 2:10 AM" })), ["Payment time is BEFORE the file was sent"]);
  assert.deepEqual(timeWarnings(proof({ detectedTime: "14/11/26 1:50 AM", filesSentAt: null })), ["Payment is more than 30 minutes older than the proof"]);
  assert.deepEqual(timeWarnings(proof({ detectedTime: "14/11/26 2:50 AM" })), ["Payment time is in the future"]);
  assert.deepEqual(timeWarnings(proof({ detectedTime: "2:31 AM" })), ["Payment date and time not detected"]);
  // One-minute tolerance: M-Pesa times have minute precision.
  assert.deepEqual(timeWarnings(proof({ detectedTime: "14/11/26 2:19 AM" })), []);

  // 3. Eligibility rules.
  const env = {};
  const ok = (p, extra = {}) => eligibility({ userId: 1, amount: 100, pendingProof: p }, { now: proofAt, env, ...extra });
  assert.equal(ok(proof()).ok, true);
  for (const [over, reason] of [
    [{ type: "screenshot" }, "not a pasted M-Pesa message"],
    [{ confidence: "Medium" }, "confidence is not High"],
    [{ duplicateCode: true }, "code already used"],
    [{ filesSentAt: null }, "time the file was sent is unknown"],
    [{ detectedTime: "14/11/26 2:10 AM" }, "Payment time is BEFORE the file was sent"]
  ]) {
    const r = ok(proof(over));
    assert.equal(r.ok, false, reason);
    assert(r.reasons.includes(reason), reason + " -> " + r.reasons);
  }
  assert.equal(eligibility({ userId: 1, amount: 1500, pendingProof: proof() }, { now: proofAt, env }).ok, false);
  assert.equal(ok(proof(), { recentAutoConfirms: [proofAt - 3600 * 1000] }).ok, false, "one per customer per 24 h");
  assert.equal(ok(proof(), { env: { TILL_AUTO_CONFIRM: "0" } }).ok, false, "switch off");

  // 4. The 4-minute timer.
  let clock = proofAt;
  const timers = [];
  const setTimer = (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; };
  const advance = async ms => {
    clock += ms;
    for (const t of timers.splice(0)) { if (t.at <= clock) await t.fn(); else timers.push(t); }
  };
  const refs = {};
  const confirmed = [], admin = [];
  const tac = createTillAutoConfirm({
    getRefs: () => refs, save: () => {},
    confirm: async (userId, apiRef) => { confirmed.push(apiRef); refs[apiRef].status = "COMPLETE"; return { ok: true }; },
    isClosed: ref => ["COMPLETE", "ADMIN_CANCELLED", "CANCELLED"].includes(ref.status),
    sendAdmin: async t => admin.push(t), now: () => clock, setTimer, env
  });

  // 4a. No admin action: confirmed after 4 minutes, not before.
  refs.a = { userId: 1, amount: 100, status: "PENDING", pendingProof: proof() };
  assert.match(tac.onProof("a"), /YES in 4 min/);
  await advance(WAIT_MS - 1000);
  assert.deepEqual(confirmed, []);
  await advance(1000);
  assert.deepEqual(confirmed, ["a"]);
  assert(admin.some(t => /AUTO-CONFIRMED/.test(t)));

  // 4b. Admin cancels within 4 minutes: nothing happens.
  clock += 25 * 3600 * 1000;
  refs.b = { userId: 2, amount: 100, status: "PENDING", pendingProof: proof({ receivedAt: clock, detectedTime: "15/11/26 3:31 AM", filesSentAt: clock - 5 * 60000 }) };
  refs.b.pendingProof.detectedTime = new Date(clock + 3 * 3600 * 1000 - 2 * 60000).toISOString().replace(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d).*/, (_, y, m, d, h, mi) => `${d}/${m}/${y.slice(2)} ${h}:${mi}`);
  assert.match(tac.onProof("b"), /YES/);
  refs.b.status = "ADMIN_CANCELLED";
  await advance(WAIT_MS);
  assert.equal(confirmed.includes("b"), false);

  // 4c. Code used meanwhile: skipped and the admin is told.
  refs.c = { userId: 3, amount: 100, status: "PENDING", pendingProof: { ...refs.b.pendingProof, receivedAt: clock, filesSentAt: clock - 5 * 60000 } };
  refs.c.pendingProof.detectedTime = new Date(clock + 3 * 3600 * 1000 - 60000).toISOString().replace(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d).*/, (_, y, m, d, h, mi) => `${d}/${m}/${y.slice(2)} ${h}:${mi}`);
  assert.match(tac.onProof("c"), /YES/);
  refs.c.pendingProof.duplicateCode = true;
  await advance(WAIT_MS);
  assert.equal(confirmed.includes("c"), false);
  assert(admin.some(t => /skipped for user 3/.test(t)));

  // 4d. Not eligible: the admin line says why, nothing is scheduled.
  refs.d = { userId: 4, amount: 100, status: "PENDING", pendingProof: proof({ type: "screenshot" }) };
  assert.match(tac.onProof("d"), /NO \(not a pasted M-Pesa message/);

  // 4e. Restart: pending auto-confirmations are re-armed.
  refs.e = { userId: 5, amount: 100, status: "PENDING", pendingProof: { ...proof(), autoConfirmAt: clock + 60000 } };
  timers.length = 0;
  tac.resume();
  assert(timers.some(t => t.at === clock + 60000));

  // 5. Bot wiring: every till proof gets the time check; auto-confirm uses the admin's confirm path.
  const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  const handler = bot.slice(bot.indexOf("async function handleMpesaProofText"), bot.indexOf("async function handlePaymentScreenshotProof"));
  assert(handler.includes("tillCheck.timeWarnings(") && handler.includes("filesSentAt,") && handler.includes("tillAutoConfirm?.onProof(apiRef)"));
  assert(handler.includes("${autoConfirmLine}"));
  assert(bot.includes('manuallyConfirmLatestPaymentForUser(userId, "till-auto-confirm-4min")'));
  assert(bot.includes("tillAutoConfirm.resume();"));

  console.log("PASS: Kenya-time parsing; payment must be after the file and within 30 minutes of the proof.");
  console.log("PASS: auto-confirm after 4 minutes only when every check passes; admin action always wins.");
  console.log("PASS: screenshots, duplicates, large amounts and repeat customers are never auto-confirmed; restart-safe.");
})().catch(error => { console.error(error); process.exitCode = 1; });
