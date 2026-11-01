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

function installShopStore({ app, dataDir, key = process.env.SHOP_STORE_KEY }) {
  const secret = String(key || "").trim();
  const file = path.join(dataDir, "shop-orders.store.json");
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
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, file);
    return res.json({ ok: true, count: Object.keys(orders).length });
  });

  if (!secret) console.log("Shop store: off (set SHOP_STORE_KEY on this service and the website service)");
  else if (secret.length < 16) console.log("Shop store: off — SHOP_STORE_KEY must be at least 16 characters");
  return { file };
}

module.exports = { installShopStore };
