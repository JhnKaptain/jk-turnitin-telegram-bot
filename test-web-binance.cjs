"use strict";
// JK_WEB_BINANCE_V1: Binance Pay (USDT) for Turnitin orders on the website.
// Real Express server; the bot's Binance functions are stand-ins. Offline.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { installWebOrders } = require("./jk-web-orders.cjs");

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-web-binance-"));
  process.env.WEB_ALLOWED_ORIGINS = "https://jkacademictoolshub.com";
  const sentDocs = [];
  const telegram = {
    getFileLink: async () => new URL("https://x/y.pdf"),
    sendMessage: async () => ({ message_id: 1 }),
    sendDocument: async (chat, doc) => { sentDocs.push(chat); return { message_id: 2 }; }
  };
  const refs = {}, submissions = {}, paidJobs = {};
  const calls = [];
  let enabled = true, stk = 0;
  const binance = {
    config: () => (enabled ? { enabled: true, kesPerUsdt: 130, id: "1203517288", name: "JohnKaptain" } : { enabled: false }),
    available: sub => sub.files.every(f => ["CHECK", "RECHECK", "SIMILARITY"].includes(f.type)),
    normalizeId: v => { const c = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return c.length >= 8 && /\d/.test(c) ? c : ""; },
    start: async (order, sub) => {
      const apiRef = "JKPAY" + order.uid + "0000000000000001";
      refs[apiRef] = { userId: order.uid, batchId: sub.batchId, amount: 2.08, currency: "USDT", status: "PENDING", createdAt: Date.now() };
      sub.api_ref = apiRef;
      calls.push(["start", order.id, sub.files.map(f => f.type)]);
      return { apiRef, amount: 2.08, currency: "USDT", note: "JK00000000000001", id: "1203517288", name: "JohnKaptain" };
    },
    proof: async (order, sub, code, image) => { calls.push(["proof", order.id, code, image ? image.length : 0]); }
  };
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  installWebOrders({
    app, express, bot: { telegram }, DATA_DIR: dataDir, ADMIN_ID: 1, MAX_BATCH_FILES: 10, submissions,
    getPaidJobs: () => paidJobs, getPaymentRef: r => refs[r], updatePaymentRef: (r, p) => Object.assign(refs[r], p),
    latestPaymentRefForBatch: b => Object.entries(refs).filter(([, r]) => r.batchId === b).map(([apiRef, r]) => ({ apiRef, ...r }))[0] || null,
    webEnabled: () => true,
    prices: () => ({ CHECK: 270, SIMILARITY: 200, RESALE: 90 }), priceFor: k => ({ CHECK: 270, SIMILARITY: 200, RESALE: 90 })[k],
    flags: () => ({ SIMILARITY_ONLY_ENABLED: true, RESALE_ENABLED: true, RESALE_AMOUNT_VISIBLE: true, RESALE_LABEL_TITLE: "Discount" }),
    isDiscountPublicActive: () => false, isPublicDiscountExclusiveMode: () => false, discountTimeText: () => "",
    resellerCodeMatches: c => c === "secret", isBotInactivePeriod: () => false, inactiveText: () => "",
    getFilterMode: () => "FILTERED", FILTER_MODE_CLIENT: "CLIENT_CHOICE", FILTER_MODE_FILTERED: "FILTERED", FILTER_MODE_UNFILTERED: "UNFILTERED",
    STAGES: { WAIT_UPLOADS: "U", WAIT_PHONE: "P", WAIT_PAYMENT: "W" },
    createEmptySubmission: () => ({ files: [], paymentAttempts: [] }),
    createStoredFileFromDocument: (u, doc) => ({ ...doc }), ensureFileReportIdentity: () => {},
    effectiveSimilarityFilter: () => "FILTERED", calculateSubmissionAmount: s => s.files.reduce((n, f) => n + ({ CHECK: 270, SIMILARITY: 200, RESALE: 90 })[f.type], 0),
    formatBatchSummary: () => "", makeBatchId: u => "B" + u, normalizePhoneTo254: p => /^0[17]\d{8}$/.test(p) ? "254" + p.slice(1) : null,
    attemptStkPush: async (ctx, sub) => { stk++; refs["STK" + stk] = { status: "PENDING", batchId: sub.batchId }; sub.api_ref = "STK" + stk; },
    buildAdminDocumentCaption: () => "c", adminActionKeyboard: () => ({ reply_markup: {} }),
    supportedScanUpload: n => /\.(pdf|docx|doc|pptx)$/i.test(n), sendAdminMessage: async () => {},
    binance
  });
  const server = app.listen(0);
  const base = "http://127.0.0.1:" + server.address().port;
  const H = { Origin: "https://jkacademictoolshub.com" };
  const newOrder = async (n = 1) => {
    const { orderId, token } = await (await fetch(base + "/api/web/orders", { method: "POST", headers: H })).json();
    for (let i = 0; i < n; i++) {
      await fetch(base + "/api/web/orders/" + orderId + "/files", { method: "PUT",
        headers: { ...H, "Content-Type": "application/octet-stream", "X-Order-Token": token, "X-File-Name": "Essay" + i + ".docx" }, body: "PK doc" });
    }
    return { orderId, token, T: { ...H, "X-Order-Token": token } };
  };
  const json = (url, T, body) => fetch(base + url, { method: "POST", headers: { ...T, "Content-Type": "application/json" }, body: JSON.stringify(body) });

  try {
    // 1. The website learns Binance is on, with the rate for the button's USDT amount.
    const config = await (await fetch(base + "/api/web/config", { headers: H })).json();
    assert.deepEqual(config.binance, { enabled: true, kesPerUsdt: 130, id: "1203517288", name: "JohnKaptain" });
    const pre = await fetch(base + "/api/web/orders", { method: "OPTIONS", headers: { ...H, "Access-Control-Request-Method": "PUT" } });
    assert.match(pre.headers.get("access-control-allow-headers"), /X-Binance-Order/);

    // 2. Binance checkout: no phone, no M-Pesa prompt; files to the admin; instructions back.
    const a = await newOrder(1);
    let r = await json("/api/web/orders/" + a.orderId + "/binance", a.T, { files: [{ type: "CHECK" }] });
    let body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.status.stage, "PAYMENT");
    assert.equal(body.status.paymentMethod, "BINANCE_USDT");
    assert.deepEqual(body.status.binance, { amount: 2.08, currency: "USDT", note: "JK00000000000001", id: "1203517288", name: "JohnKaptain", orderIdSent: null });
    assert.equal(stk, 0, "no M-Pesa prompt");
    assert.equal(sentDocs.length, 1, "document sent to the admin like any order");
    assert.deepEqual(calls.at(-1), ["start", a.orderId, ["CHECK"]]);
    // Starting again is refused; "Resend M-Pesa request" is refused.
    assert.equal((await json("/api/web/orders/" + a.orderId + "/binance", a.T, { files: [{ type: "CHECK" }] })).status, 409);
    r = await json("/api/web/orders/" + a.orderId + "/resend", a.T, {});
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /Binance Order ID/);

    // 3. Proof: the Binance Order ID is required; screenshot optional, images only.
    const proof = (T, id, bytes, type = "image/jpeg") => fetch(base + "/api/web/orders/" + a.orderId + "/binance-proof", { method: "PUT",
      headers: { ...T, "Content-Type": type, ...(id !== null ? { "X-Binance-Order": id } : {}) }, body: bytes });
    assert.equal((await proof(a.T, null, "")).status, 400, "Order ID required");
    assert.equal((await proof(a.T, "abc", "")).status, 400, "too short");
    assert.equal((await proof(a.T, "321547896541235", Buffer.from("not an image"))).status, 400, "images only");
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
    r = await proof(a.T, " 3215-4789 6541 235 ", jpg);
    body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.deepEqual(calls.at(-1), ["proof", a.orderId, "32154789654123" + "5", 104]);
    assert.equal(body.status.binance.orderIdSent, "321547896541235");
    assert.equal(body.status.proofSubmitted, true);
    assert.equal((await proof({ ...H, "X-Order-Token": "wrong" }, "321547896541235", "")).status, 404, "order key required");

    // 4. The admin confirms (ref COMPLETE): the order is paid.
    refs["JKPAY" + Object.keys(submissions)[0] + "0000000000000001"].status = "COMPLETE";
    const st = await (await fetch(base + "/api/web/orders/" + a.orderId, { headers: a.T })).json();
    assert.equal(st.status.stage, "PROCESSING");
    assert.equal((await proof(a.T, "321547896541235", "")).status, 409, "no proof after confirmation");

    // 5. Only Turnitin checks, never with a code; M-Pesa orders unaffected.
    const b = await newOrder(1);
    r = await json("/api/web/orders/" + b.orderId + "/binance", b.T, { files: [{ type: "RESALE" }], code: "secret" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /discount or reseller code/);
    r = await json("/api/web/orders/" + b.orderId + "/binance", b.T, { files: [{ type: "CHECK" }], code: "x" });
    assert.equal(r.status, 400, "any code: M-Pesa only");
    r = await json("/api/web/orders/" + b.orderId + "/checkout", b.T, { files: [{ type: "CHECK" }], phone: "12" });
    assert.equal(r.status, 400, "M-Pesa still validates the phone");
    r = await json("/api/web/orders/" + b.orderId + "/checkout", b.T, { files: [{ type: "CHECK" }], phone: "0712345678" });
    body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.status.paymentMethod, "MPESA");
    assert.equal(body.status.binance, null);
    assert.equal(stk, 1);
    r = await fetch(base + "/api/web/orders/" + b.orderId + "/binance-proof", { method: "PUT", headers: { ...b.T, "X-Binance-Order": "321547896541235" }, body: "" });
    assert.equal(r.status, 409, "M-Pesa order: no Binance proof");

    // 6. Binance switched off on Render (INTERNATIONAL_PAYMENT_ENABLED=false).
    enabled = false;
    const c = await newOrder(1);
    assert.equal((await json("/api/web/orders/" + c.orderId + "/binance", c.T, { files: [{ type: "CHECK" }] })).status, 409);
    assert.deepEqual((await (await fetch(base + "/api/web/config", { headers: H })).json()).binance, { enabled: false });

    // 7. bot.js wiring: same payment record, alerts and approval as Telegram.
    const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
    assert(bot.includes("binance: webBinance, // JK_WEB_BINANCE_V1"));
    assert(bot.includes("available: sub => INTERNATIONAL_PAYMENT_ENABLED && isInternationalCheckOnly(sub),"));
    assert(bot.includes('{ adminButtons: "paymentProof" });') && bot.includes("NEVER approve based on screenshot alone."));
    assert(bot.includes("mode: \"MANUAL\", paymentMethod: method, pendingProof: null,"));

    console.log("PASS: website Binance: config + CORS; checkout without phone or M-Pesa prompt; instructions; resend refused.");
    console.log("PASS: Binance Order ID required (normalised), screenshot optional (images only), paid after admin confirmation.");
    console.log("PASS: Turnitin checks only, never with a code; M-Pesa unaffected; off when international payments are off.");
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
