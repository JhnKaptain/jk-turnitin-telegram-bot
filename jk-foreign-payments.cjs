"use strict";
// One IntaSend account serves both this bot and the website shop
// (jkacademictoolshub.com), and IntaSend sends every payment notification to
// this bot's webhook. Website shop payments (api_ref "PAY_ORD_...") are passed
// on to the shop's own webhook silently instead of alerting the admin.
// Other unknown payments alert only when money actually arrived (COMPLETE):
// PENDING / FAILED for a payment nobody here started is noise.

const DEFAULT_SHOP_WEBHOOK_URL = "https://johnkaptain-academic-tools-hub.onrender.com/intasend/webhook";
const isShopPayment = apiRef => /^PAY_ORD_\d+_\d+_/.test(String(apiRef || ""));

function shopWebhookUrl(env = process.env) {
  const value = String(env.SHOP_INTASEND_WEBHOOK_URL ?? DEFAULT_SHOP_WEBHOOK_URL).trim();
  return /^https?:\/\//i.test(value) ? value : ""; // set to "off" to stop forwarding
}

async function forwardToShop(payload, { url = shopWebhookUrl(), fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: controller.signal
    });
    return Boolean(res && res.ok);
  } catch (err) {
    console.error("Forwarding website payment notification failed:", err?.message || err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Returns true when handled (caller stops); false lets the caller alert.
async function handleUnknownPayment({ payload, apiRef, state }, options = {}) {
  if (isShopPayment(apiRef)) {
    await forwardToShop(payload, options);
    return true;
  }
  return state !== "COMPLETE";
}

module.exports = { handleUnknownPayment, forwardToShop, isShopPayment, shopWebhookUrl, DEFAULT_SHOP_WEBHOOK_URL };
