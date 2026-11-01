"use strict";
// Website shop payments share the IntaSend account; their notifications reach
// this bot. They must go to the shop quietly, and unknown PENDING/FAILED
// notifications must not alert the admin. Offline.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { handleUnknownPayment, isShopPayment, shopWebhookUrl, DEFAULT_SHOP_WEBHOOK_URL } = require("./jk-foreign-payments.cjs");

(async () => {
  const shopRef = "PAY_ORD_1793539573694_20877_1793539573694_61363";
  assert(isShopPayment(shopRef));
  for (const ref of ["JKPAY8819281121179353951380672775", "", null, "PAY_SOMETHING"]) assert(!isShopPayment(ref), String(ref));

  const sent = [];
  const fetchImpl = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
  for (const state of ["PENDING", "PROCESSING", "COMPLETE", "FAILED"]) {
    const payload = { api_ref: shopRef, invoice_id: "Y5X55BG", state };
    assert.equal(await handleUnknownPayment({ payload, apiRef: shopRef, state }, { fetchImpl, url: DEFAULT_SHOP_WEBHOOK_URL }), true, "no admin alert: " + state);
  }
  assert.equal(sent.length, 4, "every website notification forwarded");
  assert.equal(sent[0].url, "https://johnkaptain-academic-tools-hub.onrender.com/intasend/webhook");
  assert.deepEqual(sent[2].body, { api_ref: shopRef, invoice_id: "Y5X55BG", state: "COMPLETE" }, "payload passed on unchanged");

  // Shop down: still no admin alert, no crash.
  const down = async () => { throw new Error("ECONNREFUSED"); };
  assert.equal(await handleUnknownPayment({ payload: {}, apiRef: shopRef, state: "COMPLETE" }, { fetchImpl: down, url: DEFAULT_SHOP_WEBHOOK_URL }), true);

  // Other unknown payments: alert only when money arrived.
  const other = "SOMETHING_ELSE_1";
  assert.equal(await handleUnknownPayment({ payload: {}, apiRef: other, state: "PENDING" }), true);
  assert.equal(await handleUnknownPayment({ payload: {}, apiRef: other, state: "FAILED" }), true);
  assert.equal(await handleUnknownPayment({ payload: {}, apiRef: other, state: "COMPLETE" }), false, "COMPLETE still alerts");

  assert.equal(shopWebhookUrl({}), DEFAULT_SHOP_WEBHOOK_URL);
  assert.equal(shopWebhookUrl({ SHOP_INTASEND_WEBHOOK_URL: "off" }), "");

  const bot = fs.readFileSync(__dirname + "/bot.js", "utf8");
  const hook = bot.indexOf('require("./jk-foreign-payments.cjs").handleUnknownPayment');
  assert(hook > 0 && hook < bot.indexOf("IntaSend webhook: unknown apiref"), "bot checks before alerting");

  console.log("PASS: website payment notifications forwarded to the shop silently (all states, shop down safe)");
  console.log("PASS: other unknown payments alert only on COMPLETE; PENDING/FAILED noise removed");
})().catch(e => { console.error(e); process.exit(1); });
