"use strict";
/*
  JK_CUSTOMER_PUSH_V1: notifications for website customers (Web Push, free).

  - A customer taps "🔔 Notify me" on the website. Their phone is linked only to
    the orders saved on that phone, each proven with the order's own secret key
    (report orders: the web-order token; shop orders: the chat token).
  - Only paid orders, and only two kinds of alert: files delivered (reports, or
    files sent on a shop order) and messages from JK Support. The text
    never contains logins, files or message content: it just says what happened
    and opens the order when tapped.
  - Signing keys are made on first use and kept on the persistent disk
    (DATA_DIR/customer-push.json), separate from the admin's.
*/
const crypto = require("crypto");
const fs = require("fs");

const MAX_SUBSCRIPTIONS = 5000;
const MAX_PER_ORDER = 5;
const MAX_ORDERS_PER_DEVICE = 30;
const KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const sha256 = v => crypto.createHash("sha256").update(String(v)).digest("hex");
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function createCustomerPush({ file, webpush = require("web-push"), subject = "https://jkacademictoolshub.com", now = () => Date.now(), log = console }) {
  let state = null;
  const lastSent = new Map(); // "order|kind" -> time, to merge bursts (several reports)

  function load() {
    if (state) return state;
    try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch { state = null; }
    if (!state?.publicKey || !state?.privateKey) {
      const k = webpush.generateVAPIDKeys();
      state = { publicKey: k.publicKey, privateKey: k.privateKey, subs: [] };
      persist();
    }
    if (!Array.isArray(state.subs)) state.subs = [];
    return state;
  }
  function persist() {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  function tidy() {
    const s = load();
    const cutoff = now() - KEEP_MS;
    s.subs = s.subs.filter(x => x.at > cutoff).slice(-MAX_SUBSCRIPTIONS);
  }

  const valid = sub => sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000 &&
    typeof sub.keys?.p256dh === "string" && sub.keys.p256dh.length < 200 && typeof sub.keys?.auth === "string" && sub.keys.auth.length < 100;

  // orders: [{ kind: "report" | "shop", id, token }] — each checked by verify().
  function subscribe(subscription, orders, verify) {
    if (!valid(subscription)) { const e = new Error("This browser's notification details are not valid."); e.status = 400; throw e; }
    const keys = [];
    for (const o of (Array.isArray(orders) ? orders : []).slice(0, MAX_ORDERS_PER_DEVICE)) {
      const kind = o?.kind === "shop" ? "shop" : o?.kind === "report" ? "report" : null;
      const id = String(o?.id || "").slice(0, 80);
      if (!kind || !id) continue;
      if (verify(kind, id, String(o.token || ""))) keys.push(kind + ":" + id);
    }
    if (!keys.length) { const e = new Error("Notifications start once your payment is confirmed."); e.status = 400; throw e; }
    const s = load();
    tidy();
    s.subs = s.subs.filter(x => x.subscription.endpoint !== subscription.endpoint);
    s.subs.push({ subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
      orders: [...new Set(keys)], at: now() });
    // At most a few devices per order (oldest dropped).
    for (const key of keys) {
      const holders = s.subs.filter(x => x.orders.includes(key));
      for (const extra of holders.slice(0, Math.max(0, holders.length - MAX_PER_ORDER))) extra.orders = extra.orders.filter(k => k !== key);
    }
    s.subs = s.subs.filter(x => x.orders.length);
    persist();
    return { orders: keys.length };
  }

  function unsubscribe(endpoint) {
    const s = load();
    const before = s.subs.length;
    s.subs = s.subs.filter(x => x.subscription.endpoint !== String(endpoint || ""));
    if (before !== s.subs.length) persist();
    return { removed: before - s.subs.length };
  }

  async function notify(kind, orderId, event, payload, { mergeMs = 90000 } = {}) {
    const key = kind + ":" + orderId;
    const burst = key + "|" + event;
    if (mergeMs && now() - (lastSent.get(burst) || 0) < mergeMs) return { sent: 0, merged: true };
    const s = load();
    const targets = s.subs.filter(x => x.orders.includes(key));
    if (!targets.length) return { sent: 0 };
    lastSent.set(burst, now());
    let sent = 0;
    const gone = [];
    await Promise.all(targets.map(async t => {
      try {
        await webpush.sendNotification(t.subscription, JSON.stringify(payload), {
          TTL: 24 * 3600, urgency: "high", vapidDetails: { subject, publicKey: s.publicKey, privateKey: s.privateKey }
        });
        sent++;
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) gone.push(t.subscription.endpoint);
        else log.error?.("Customer push failed:", error?.statusCode || "", error?.message || error);
      }
    }));
    if (gone.length) { s.subs = s.subs.filter(x => !gone.includes(x.subscription.endpoint)); persist(); }
    return { sent, removed: gone.length };
  }

  // Ready-made alerts (no private content).
  const reportReady = id => notify("report", id, "ready", {
    title: "✅ Your report is ready", body: "Tap to open your order and download it.", tag: "report-" + id, url: "/?order=" + encodeURIComponent(id)
  });
  const reportReply = id => notify("report", id, "reply", {
    title: "💬 JK Support replied", body: "Tap to read the message about your report order.", tag: "report-msg-" + id, url: "/?order=" + encodeURIComponent(id)
  }, { mergeMs: 30000 });
  const shopReply = (id, product, file = false) => notify("shop", id, file ? "file" : "reply", {
    title: file ? "📎 JK Support sent you a file" : "💬 JK Support replied",
    body: "About your " + String(product || "order").slice(0, 60) + " order. Tap to open it.",
    tag: "shop-" + id, url: "/?shop=" + encodeURIComponent(id)
  }, { mergeMs: 30000 });

  return { publicKey: () => load().publicKey, subscribe, unsubscribe, notify, reportReady, reportReply, shopReply, count: () => load().subs.length };
}

// Routes under /api/web (the website's CORS rules already apply there).
function installCustomerPushRoutes({ app, express, push, verifyReport, shopOrders }) {
  const verify = (kind, id, token) => {
    if (!token) return false;
    try {
      if (kind === "report") return Boolean(verifyReport(id, token));
      const order = (shopOrders() || {})[id];
      return order?.paymentState === "COMPLETE" && Boolean(order?.chatTokenHash && safeEqual(order.chatTokenHash, sha256(token)));
    } catch { return false; }
  };
  const handle = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : "Something went wrong." }); }
  };
  const hits = new Map();
  const limited = req => {
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    const t = Date.now();
    const list = (hits.get(ip) || []).filter(x => t - x < 3600000);
    list.push(t); hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    return list.length > 60;
  };
  app.get("/api/web/push/key", handle(async (req, res) => res.json({ publicKey: push.publicKey() })));
  app.post("/api/web/push/subscribe", express.json({ limit: "16kb" }), handle(async (req, res) => {
    if (limited(req)) return res.status(429).json({ error: "Too many requests. Try again later." });
    res.json({ ok: true, ...push.subscribe(req.body?.subscription, req.body?.orders, verify) });
  }));
  app.post("/api/web/push/unsubscribe", express.json({ limit: "4kb" }), handle(async (req, res) => {
    res.json({ ok: true, ...push.unsubscribe(req.body?.endpoint) });
  }));
}

module.exports = { createCustomerPush, installCustomerPushRoutes };
