"use strict";
// The website shop keeps its order list on this bot's disk. Offline.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { installShopStore } = require("./jk-shop-store.cjs");

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-store-"));
  const key = "k".repeat(32);
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  installShopStore({ app, dataDir, key });
  const off = express(); off.use(express.json()); installShopStore({ app: off, dataDir, key: "" });
  const server = app.listen(0), offServer = off.listen(0);
  const url = s => `http://127.0.0.1:${s.address().port}/api/shop-store`;
  const auth = { Authorization: "Bearer " + key, "Content-Type": "application/json" };

  assert.equal((await fetch(url(server))).status, 404, "no key -> hidden");
  assert.equal((await fetch(url(server), { headers: { Authorization: "Bearer wrong" } })).status, 404);
  assert.deepEqual(await (await fetch(url(server), { headers: auth })).json(), { ok: true, orders: {} });
  const orders = { ORD_1_2: { id: "ORD_1_2", messages: [{ from: "support", text: "logins" }] } };
  const put = await fetch(url(server), { method: "PUT", headers: auth, body: JSON.stringify({ orders }) });
  assert.equal(put.status, 200);
  assert.deepEqual((await (await fetch(url(server), { headers: auth })).json()).orders, orders, "round trip");
  assert(fs.existsSync(path.join(dataDir, "shop-orders.store.json")), "saved on the persistent disk");
  assert.equal((await fetch(url(server), { method: "PUT", headers: auth, body: JSON.stringify({ orders: [] }) })).status, 400);
  assert.equal((await fetch(url(offServer), { headers: auth })).status, 404, "off without SHOP_STORE_KEY");
  const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  assert(bot.includes('require("./jk-shop-store.cjs").installShopStore({ app, dataDir: DATA_DIR })'), "installed in bot.js");

  server.close(); offServer.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("PASS: shop order list stored on the bot's disk; key required; off without SHOP_STORE_KEY");
})().catch(e => { console.error(e); process.exit(1); });
