"use strict";
// HTTP contract for the website: real Express server, mocked bot internals.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { installWebOrders } = require("./jk-web-orders.cjs");

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-web-http-"));
  process.env.WEB_ALLOWED_ORIGINS = "https://john-kaptain.github.io";
  const telegram = {
    getFileLink: async () => new URL("https://x/y.pdf"),
    sendMessage: async () => ({ message_id: 1 }),
    sendDocument: async () => ({ message_id: 2 })
  };
  const refs = {}, submissions = {}, paidJobs = {};
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  installWebOrders({
    app, express, bot: { telegram }, DATA_DIR: dataDir, ADMIN_ID: 1, MAX_BATCH_FILES: 10, submissions,
    getPaidJobs: () => paidJobs, getPaymentRef: r => refs[r], updatePaymentRef: (r, p) => Object.assign(refs[r], p),
    webEnabled: () => true,
    prices: () => ({ CHECK: 135, SIMILARITY: 100, RESALE: 90 }), priceFor: k => ({ CHECK: 135, SIMILARITY: 100, RESALE: 90 })[k],
    flags: () => ({ SIMILARITY_ONLY_ENABLED: true, RESALE_ENABLED: false, RESALE_AMOUNT_VISIBLE: true, RESALE_LABEL_TITLE: "Discount" }),
    isDiscountPublicActive: () => false, isPublicDiscountExclusiveMode: () => false, discountTimeText: () => "",
    resellerCodeMatches: () => false, isBotInactivePeriod: () => false, inactiveText: () => "",
    getFilterMode: () => "FILTERED", FILTER_MODE_CLIENT: "CLIENT_CHOICE", FILTER_MODE_FILTERED: "FILTERED", FILTER_MODE_UNFILTERED: "UNFILTERED",
    STAGES: { WAIT_UPLOADS: "U", WAIT_PHONE: "P", WAIT_PAYMENT: "W" },
    createEmptySubmission: () => ({ files: [], paymentAttempts: [] }),
    createStoredFileFromDocument: (u, doc) => ({ ...doc }), ensureFileReportIdentity: () => {},
    effectiveSimilarityFilter: () => "FILTERED", calculateSubmissionAmount: s => s.files.length * 135,
    formatBatchSummary: () => "", makeBatchId: u => "B" + u, normalizePhoneTo254: p => "254" + String(p).slice(1),
    attemptStkPush: async (ctx, sub) => { refs.R = { status: "PENDING" }; sub.api_ref = "R"; await ctx.reply("STK sent"); },
    buildAdminDocumentCaption: () => "c", adminActionKeyboard: () => ({ reply_markup: {} }),
    supportedScanUpload: n => /\.(pdf|docx|doc|pptx)$/i.test(n), sendAdminMessage: async () => {}
  });
  const server = app.listen(0);
  const base = "http://127.0.0.1:" + server.address().port;
  const origin = { Origin: "https://john-kaptain.github.io" };

  let res = await fetch(base + "/api/web/config", { headers: origin });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://john-kaptain.github.io");
  assert.deepEqual((await res.json()).services.map(s => s.price), [135, 100]);

  res = await fetch(base + "/api/web/config", { headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 403, "foreign websites cannot use the API");
  res = await fetch(base + "/api/web/orders", { method: "OPTIONS", headers: { ...origin, "Access-Control-Request-Method": "PUT" } });
  assert.equal(res.status, 204);
  assert.match(res.headers.get("access-control-allow-headers"), /X-Order-Token/);

  res = await fetch(base + "/api/web/orders", { method: "POST", headers: origin });
  assert.equal(res.status, 201);
  const { orderId, token } = await res.json();

  const bytes = Buffer.from("%PDF-1.4 binary \x00\x01\x02 payload");
  res = await fetch(base + "/api/web/orders/" + orderId + "/files", { method: "PUT",
    headers: { ...origin, "Content-Type": "application/octet-stream", "X-Order-Token": token, "X-File-Name": encodeURIComponent("My Essay (final).pdf") },
    body: bytes });
  assert.equal(res.status, 201);
  const stored = fs.readdirSync(path.join(dataDir, "web-orders", orderId, "uploads"));
  assert.deepEqual(fs.readFileSync(path.join(dataDir, "web-orders", orderId, "uploads", stored[0])), bytes, "binary upload intact");

  res = await fetch(base + "/api/web/orders/" + orderId, { headers: { ...origin, "X-Order-Token": "bad" } });
  assert.equal(res.status, 404);

  res = await fetch(base + "/api/web/orders/" + orderId + "/checkout", { method: "POST",
    headers: { ...origin, "Content-Type": "application/json", "X-Order-Token": token },
    body: JSON.stringify({ files: [{ type: "CHECK" }], phone: "0712345678" }) });
  const checkout = await res.json();
  assert.equal(res.status, 200, JSON.stringify(checkout));
  assert.equal(checkout.status.amount, 135);
  assert.equal(checkout.status.stage, "PAYMENT");

  // Report captured from the bot is downloadable with the order token only.
  refs.R.status = "COMPLETE";
  const uid = Object.keys(submissions)[0];
  await telegram.sendDocument(uid, { source: Buffer.from("%PDF report"), filename: "AI Report.pdf" });
  res = await fetch(base + "/api/web/orders/" + orderId + "/reports/0?token=" + token, { headers: origin });
  assert.equal(res.status, 200);
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "%PDF report");
  assert.match(res.headers.get("content-disposition"), /AI Report\.pdf/);
  res = await fetch(base + "/api/web/orders/" + orderId + "/reports/0?token=nope", { headers: origin });
  assert.equal(res.status, 404);

  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("PASS: website HTTP API: CORS allow-list, binary uploads, token auth, checkout and report download");
})().catch(err => { console.error(err); process.exit(1); });
