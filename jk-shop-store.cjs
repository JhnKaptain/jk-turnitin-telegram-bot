"use strict";
// Storage for the website shop server (Grammarly, Chegg... orders and their
// chats). That service has no persistent disk, so it keeps its small order
// list here on this bot's disk. Protected by SHOP_STORE_KEY, which must be set
// to the same value on both Render services; without it the routes are off.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MAX_BYTES = 5 * 1024 * 1024;

function safeEqual(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// JK_ADMIN_BOT_CHAT_V1: what changed between two saves of the shop store
// (new paid orders, new customer messages), for the admin's notifications.
function shopEvents(prev, next) {
  const events = [];
  for (const [id, order] of Object.entries(next || {})) {
    if (!order || typeof order !== "object") continue;
    const before = (prev || {})[id] || {};
    const product = String(order.productName || "Product").slice(0, 80);
    if (order.paymentState === "COMPLETE" && before.paymentState !== "COMPLETE") {
      events.push({ kind: "paid", orderId: id, text: "🛍 New paid shop order\n" + product + (order.amount != null ? " · KES " + order.amount : "") + "\nOrder ID: " + id });
    }
    const seen = new Set((before.messages || []).map(m => String(m?.at) + "|" + String(m?.text || "").slice(0, 40)));
    for (const m of order.messages || []) {
      if (m?.from !== "client" || seen.has(String(m.at) + "|" + String(m.text || "").slice(0, 40))) continue;
      events.push({ kind: "message", orderId: id, text: "🛍 Shop customer message\n" + product + " · " + id + "\n" + String(m.text || "").slice(0, 300) });
    }
  }
  return events;
}

function installShopStore({ app, dataDir, key = process.env.SHOP_STORE_KEY, onEvents = null }) {
  const secret = String(key || "").trim();
  const file = path.join(dataDir, "shop-orders.store.json");
  // JK admin web panel: the shop tells us its address on every save, so the
  // panel can send replies/files through it with no extra setting.
  const metaFile = path.join(dataDir, "shop-service.json");
  const authorized = req => secret.length >= 16 &&
    safeEqual(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""), secret);

  app.get("/api/shop-store", (req, res) => {
    if (!authorized(req)) return res.status(404).end();
    res.setHeader("Cache-Control", "no-store");
    if (!fs.existsSync(file)) return res.json({ ok: true, orders: {} });
    try {
      return res.json({ ok: true, orders: JSON.parse(fs.readFileSync(file, "utf8")) });
    } catch (err) {
      return res.status(500).json({ error: "Store unreadable" });
    }
  });

  app.put("/api/shop-store", (req, res) => {
    if (!authorized(req)) return res.status(404).end();
    const orders = req.body?.orders;
    if (!orders || typeof orders !== "object" || Array.isArray(orders)) return res.status(400).json({ error: "orders object required" });
    const text = JSON.stringify(orders);
    if (Buffer.byteLength(text) > MAX_BYTES) return res.status(413).json({ error: "Store too large" });
    fs.mkdirSync(dataDir, { recursive: true });
    const previous = onEvents ? readOrders() : null;
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, file);
    // The first save after a restart of the shop is not "new"; only changes are.
    if (onEvents && previous && Object.keys(previous).length) {
      try { const ev = shopEvents(previous, orders); if (ev.length) onEvents(ev); } catch (error) { console.error("Shop events failed:", error.message); }
    }
    const serviceUrl = String(req.body?.serviceUrl || "").trim().replace(/\/+$/, "");
    if (/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(serviceUrl)) {
      try { fs.writeFileSync(metaFile, JSON.stringify({ serviceUrl, at: Date.now() })); } catch {}
    }
    return res.json({ ok: true, count: Object.keys(orders).length });
  });

  if (!secret) console.log("Shop store: off (set SHOP_STORE_KEY on this service and the website service)");
  else if (secret.length < 16) console.log("Shop store: off — SHOP_STORE_KEY must be at least 16 characters");
  function readOrders() {
    try { return JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { return {}; }
  }
  function serviceUrl() {
    const fromEnv = String(process.env.SHOP_SERVICE_URL || "").trim().replace(/\/+$/, "");
    if (fromEnv) return fromEnv;
    try { return JSON.parse(fs.readFileSync(metaFile, "utf8")).serviceUrl || null; } catch { return null; }
  }
  return { file, readOrders, serviceUrl, key: () => secret, enabled: () => secret.length >= 16 };
}

module.exports = { installShopStore, shopEvents };
