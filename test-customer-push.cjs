"use strict";
// JK_CUSTOMER_PUSH_V1: website customers' notifications. Fake push service; no network.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createCustomerPush, installCustomerPushRoutes } = require("./jk-customer-push.cjs");
const { shopEvents } = require("./jk-shop-store.cjs");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-cust-push-"));
  let t = 1_000_000;
  const sent = [];
  const fake = {
    generateVAPIDKeys: () => ({ publicKey: "PUBKEY", privateKey: "PRIV" }),
    sendNotification: async (sub, payload) => {
      if (sub.endpoint.includes("gone")) { const e = new Error("gone"); e.statusCode = 410; throw e; }
      sent.push([sub.endpoint.split("/").pop(), JSON.parse(payload)]);
    }
  };
  const push = createCustomerPush({ file: path.join(dir, "cp.json"), webpush: fake, now: () => t, log: { error() {} } });
  const sub = n => ({ endpoint: "https://fcm.googleapis.com/send/" + n, keys: { p256dh: "p", auth: "a" } });
  const tokens = { W1: "tok1", W2: "tok2" };
  const shopToken = "s".repeat(48);
  const hash = crypto.createHash("sha256").update(shopToken).digest("hex");
  const shop = { ORD_1_1: { chatTokenHash: hash, productName: "Chegg", paymentState: "COMPLETE" },
    ORD_2_2: { chatTokenHash: hash, productName: "Quillbot", paymentState: "PENDING" } };
  const verifyReport = (id, token) => { if (tokens[id] !== token) throw new Error("Order not found."); return {}; };

  try {
    // 1. Routes: each order is proven with its own key; wrong keys are ignored.
    const app = express();
    installCustomerPushRoutes({ app, express, push, verifyReport, shopOrders: () => shop });
    const server = app.listen(0);
    const base = "http://127.0.0.1:" + server.address().port;
    const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await (await fetch(base + "/api/web/push/key")).json()).publicKey, "PUBKEY");
    let r = await post("/api/web/push/subscribe", { subscription: sub("phone"), orders: [{ kind: "report", id: "W1", token: "WRONG" }] });
    assert.equal(r.status, 400, "no valid order: refused");
    r = await post("/api/web/push/subscribe", { subscription: { endpoint: "http://x" }, orders: [{ kind: "report", id: "W1", token: "tok1" }] });
    assert.equal(r.status, 400, "invalid subscription");
    r = await post("/api/web/push/subscribe", { subscription: sub("phone"), orders: [
      { kind: "report", id: "W1", token: "tok1" }, { kind: "report", id: "W2", token: "nope" }, { kind: "shop", id: "ORD_1_1", token: shopToken }, { kind: "shop", id: "ORD_9_9", token: shopToken }] });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).orders, 2, "only W1 and ORD_1_1 accepted");
    // Unpaid orders cannot be followed yet.
    r = await post("/api/web/push/subscribe", { subscription: sub("x"), orders: [{ kind: "shop", id: "ORD_2_2", token: shopToken }] });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /once your payment is confirmed/);
    await post("/api/web/push/subscribe", { subscription: sub("laptop"), orders: [{ kind: "report", id: "W2", token: "tok2" }] });
    await post("/api/web/push/subscribe", { subscription: sub("gone"), orders: [{ kind: "report", id: "W1", token: "tok1" }] });

    // 2. Alerts go only to devices linked to that order; no private content.
    let res = await push.reportReady("W1");
    assert.deepEqual(res, { sent: 1, removed: 1 }, "gone device removed");
    assert.deepEqual(sent.at(-1), ["phone", { title: "✅ Your report is ready", body: "Tap to open your order and download it.", tag: "report-W1", url: "/?order=W1" }]);
    // Several reports in a row: one alert.
    assert.equal((await push.reportReady("W1")).merged, true);
    t += 91000;
    assert.equal((await push.reportReady("W1")).sent, 1, "next burst alerts again");
    await push.reportReply("W2");
    assert.equal(sent.at(-1)[0], "laptop");
    await push.shopReply("ORD_1_1", "Chegg Study");
    assert.deepEqual(sent.at(-1), ["phone", { title: "💬 JK Support replied", body: "About your Chegg Study order. Tap to open it.", tag: "shop-ORD_1_1", url: "/?shop=ORD_1_1" }]);
    assert.equal((await push.shopReply("ORD_404_1", "x")).sent, 0, "nobody linked: nothing sent");
    await push.shopReply("ORD_1_1", "Chegg Study", true);
    assert.equal(sent.at(-1)[1].title, "📎 JK Support sent you a file");

    // 3. Re-subscribing replaces the device's orders; unsubscribe removes it; keys persist.
    await post("/api/web/push/subscribe", { subscription: sub("phone"), orders: [{ kind: "report", id: "W2", token: "tok2" }] });
    t += 91000;
    assert.equal((await push.reportReady("W1")).sent, 0, "phone no longer linked to W1");
    await post("/api/web/push/unsubscribe", { endpoint: sub("laptop").endpoint });
    assert.equal(push.count(), 1);
    assert.equal(createCustomerPush({ file: path.join(dir, "cp.json"), webpush: fake }).publicKey(), "PUBKEY");

    // 4. At most 5 devices per order (oldest dropped).
    for (let i = 0; i < 7; i++) await post("/api/web/push/subscribe", { subscription: sub("d" + i), orders: [{ kind: "report", id: "W1", token: "tok1" }] });
    t += 91000;
    sent.length = 0;
    await push.reportReady("W1");
    assert.equal(sent.length, 5);
    assert(!sent.some(([e]) => e === "d0" || e === "d1"), "oldest dropped");
    server.close();

    // 5. Shop: a new JK Support message is a customer event (admin alerts unchanged).
    const ev = shopEvents(
      { O1: { productName: "Grammarly", paymentState: "COMPLETE", messages: [{ at: 1, from: "client", text: "hi" }] } },
      { O1: { productName: "Grammarly", paymentState: "COMPLETE", messages: [{ at: 1, from: "client", text: "hi" }, { at: 2, from: "support", text: "Email: x Password: y" }] } });
    assert.deepEqual(ev, [{ kind: "support", orderId: "O1", product: "Grammarly", file: false }], "logins never copied into the event");
    const fileEv = shopEvents({ O1: { paymentState: "COMPLETE", messages: [] } },
      { O1: { productName: "Grammarly", paymentState: "COMPLETE", messages: [{ at: 5, from: "support", text: "", file: { name: "guide.pdf" } }] } });
    assert.deepEqual(fileEv, [{ kind: "support", orderId: "O1", product: "Grammarly", file: true }]);
    const unpaidEv = shopEvents({ O1: { paymentState: "PENDING", messages: [] } },
      { O1: { productName: "Grammarly", paymentState: "PENDING", messages: [{ at: 5, from: "support", text: "hello" }] } });
    assert.deepEqual(unpaidEv, [], "unpaid orders: no customer alert");

    // 6. Wiring.
    const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
    const web = fs.readFileSync(path.join(__dirname, "jk-web-orders.cjs"), "utf8");
    assert(bot.includes("customerAlert: notifyWebCustomer,") && bot.includes("function notifyWebCustomer("));
    assert(bot.includes('if (ev.kind === "support") {') && bot.includes("customerPush.shopReply(ev.orderId, ev.product, ev.file)"));
    assert(bot.includes("installCustomerPushRoutes({") && bot.includes("verifyReport: (orderId, token) => webOrders.authorize(orderId, token) && webOrderPaid(orderId)"));
    assert(bot.includes("if (!webOrderPaid(orderId)) return;"), "report alerts only for paid orders");
    assert(bot.includes('const WEB_PAID_STAGES = ["PAID", "PROCESSING", "PARTLY_DELIVERED", "DELIVERED"];'));
    assert(bot.indexOf("installCustomerPushRoutes({") > bot.indexOf('installWebOrders({'), "after the /api/web CORS rules");
    assert(web.includes('if (kind === "support") { try { d.customerAlert?.("reply", order.id); } catch {} }'));
    assert(web.includes('try { d.customerAlert?.("ready", order.id); } catch {}'));

    console.log("PASS: customer notifications: orders proven with their own keys; wrong keys ignored; invalid subscriptions refused.");
    console.log("PASS: report ready / support replied / shop reply reach only linked devices; bursts merged; gone devices removed; 5 per order.");
    console.log("PASS: paid orders only: unpaid orders can't subscribe or get alerts; files and messages from JK Support only.");
    console.log("PASS: alerts carry no private content (no logins or messages); wired to web orders and shop saves.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
