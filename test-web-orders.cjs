"use strict";
// Website orders: offline. IntaSend, Telegram and providers are mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const W = require("./jk-web-orders.cjs");

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-web-orders-"));
  const sentToTelegram = [];
  const telegram = {
    getFileLink: async id => new URL("https://files.example/" + id + ".pdf"),
    sendMessage: async (chat, text) => { sentToTelegram.push({ m: "sendMessage", chat, text }); return { message_id: 1 }; },
    sendDocument: async (chat, doc, extra) => { sentToTelegram.push({ m: "sendDocument", chat, doc, extra }); return { message_id: 2 }; },
    forwardMessage: async () => ({ message_id: 3 })
  };
  const bot = { telegram };
  const paymentRefs = {}, paidJobs = {}, submissions = {};
  let discountWindow = false, filterMode = "FILTERED", inactive = false;
  const stkCalls = [];
  let failNextStk = false;
  const d = {
    bot, DATA_DIR: dataDir, ADMIN_ID: 111, MAX_BATCH_FILES: 10, submissions,
    getPaidJobs: () => paidJobs,
    getPaymentRef: r => paymentRefs[r] || null,
    latestPaymentRefForBatch: b => Object.entries(paymentRefs).filter(([, r]) => r.batchId === b)
      .sort((x, y) => (y[1].createdAt || 0) - (x[1].createdAt || 0)).map(([apiRef, r]) => ({ apiRef, ...r }))[0] || null,
    updatePaymentRef: (r, patch) => { paymentRefs[r] = { ...(paymentRefs[r] || {}), ...patch }; },
    webEnabled: () => true,
    prices: () => ({ CHECK: 135, SIMILARITY: 100, RESALE: 90 }),
    priceFor: k => ({ CHECK: 135, RECHECK: 130, SIMILARITY: 100, RESALE: 90 })[k],
    flags: () => ({ SIMILARITY_ONLY_ENABLED: true, RESALE_ENABLED: true, RESALE_AMOUNT_VISIBLE: true, RESALE_LABEL_TITLE: "Discount" }),
    isDiscountPublicActive: () => discountWindow,
    isPublicDiscountExclusiveMode: () => discountWindow,
    discountTimeText: () => "Discount available from 9:00 PM to 6:00 AM EAT.",
    resellerCodeMatches: c => String(c).toLowerCase() === "secret",
    isBotInactivePeriod: () => inactive,
    inactiveText: () => "*Closed* now",
    getFilterMode: () => filterMode,
    FILTER_MODE_CLIENT: "CLIENT_CHOICE", FILTER_MODE_FILTERED: "FILTERED", FILTER_MODE_UNFILTERED: "UNFILTERED",
    STAGES: { WAIT_UPLOADS: "WAIT_UPLOADS", WAIT_PHONE: "WAIT_PHONE", WAIT_PAYMENT: "WAIT_PAYMENT" },
    createEmptySubmission: () => ({ stage: "WAIT_BATCH_SIZE", files: [], paymentAttempts: [], resellerVerified: false }),
    createStoredFileFromDocument: (uid, doc) => ({ ...doc, type: null, price: null, similarityFilter: null,
      recheckEligible: false, jkSubmissionId: "trn:oid:::1:" + (1000000000 + Math.floor(Math.random() * 1e9)) }),
    ensureFileReportIdentity: f => { f.reportName ||= "Author Author"; },
    effectiveSimilarityFilter: f => f.similarityFilter || (filterMode === "UNFILTERED" ? "UNFILTERED" : "FILTERED"),
    calculateSubmissionAmount: sub => sub.files.reduce((n, f) => n + d.priceFor(f.type), 0),
    formatBatchSummary: sub => "Files: " + sub.files.length,
    makeBatchId: uid => "JK_BATCH_" + uid + "_1",
    normalizePhoneTo254: p => /^0[17]\d{8}$/.test(String(p)) ? "254" + String(p).slice(1) : null,
    attemptStkPush: async (ctx, sub, { mode }) => {
      stkCalls.push({ uid: ctx.from.id, amount: sub.amount, phone: sub.phone, mode });
      const ref = "JKPAY" + ctx.from.id + stkCalls.length;
      paymentRefs[ref] = { userId: ctx.from.id, batchId: sub.batchId, amount: sub.amount, status: "PENDING", files: sub.files, createdAt: Date.now() + stkCalls.length };
      if (failNextStk) {
        // Real attemptStkPush: the ref is stored, sub.api_ref is NOT set on failure.
        failNextStk = false;
        paymentRefs[ref].status = "FAILED_TO_INITIATE";
        await ctx.reply("❌ STK Push failed.");
        return;
      }
      sub.api_ref = ref;
      await ctx.reply("📲 *STK sent*. Enter your M-Pesa PIN.");
    },
    buildAdminDocumentCaption: ({ userId, file }) => "User " + userId + " " + file.file_name,
    adminActionKeyboard: () => ({ reply_markup: { inline_keyboard: [] } }),
    supportedScanUpload: n => /\.(pdf|docx|doc|pptx)$/i.test(n),
    sendAdminMessage: async () => {}
  };

  const orders = W.createWebOrders(d);
  orders.installTelegramRouting(bot);

  // 1. Config mirrors the Telegram keyboard rules and live prices.
  let cfg = W.publicConfig(d);
  assert.deepEqual(cfg.services.map(s => [s.type, s.price]), [["CHECK", 135], ["SIMILARITY", 100]]);
  assert.equal(cfg.discount.requiresCode, true);
  assert(!cfg.services.some(s => s.type === "RECHECK"), "no recheck on the website");
  discountWindow = true;
  cfg = W.publicConfig(d);
  assert.deepEqual(cfg.services.map(s => s.type), ["SIMILARITY", "RESALE"], "exclusive discount hides CHECK like Telegram");
  discountWindow = false;
  filterMode = "CLIENT_CHOICE";
  assert.equal(W.publicConfig(d).similarityFilterChoice, true);
  filterMode = "FILTERED";

  // 2. Order + uploads; tokens are required.
  const { order, token } = orders.newOrder("1.2.3.4");
  assert(W.isWebUserId(order.uid));
  assert.throws(() => orders.authorize(order.id, "wrong"), e => e.status === 404);
  assert.equal(orders.authorize(order.id, token), order);
  orders.addUpload(order, "Essay One.docx", Buffer.from("first document"));
  orders.addUpload(order, "essay2.pdf", Buffer.from("second document"));
  assert.throws(() => orders.addUpload(order, "virus.exe", Buffer.from("x")), e => e.status === 415);
  assert.throws(() => orders.addUpload(order, "dup.pdf", Buffer.from("second document")), e => e.status === 409);
  const sub = submissions[order.uid];
  assert.equal(sub.files.length, 2);
  assert(W.isWebFileId(sub.files[0].file_id));
  assert.equal(orders.readWebFile(sub.files[1].file_id).toString(), "second document");

  // 3. Checkout validation identical to Telegram's choices.
  await assert.rejects(orders.checkout(order, { files: [{ type: "CHECK" }], phone: "0712345678" }), e => e.status === 400);
  await assert.rejects(orders.checkout(order, { files: [{ type: "RECHECK" }, { type: "CHECK" }], phone: "0712345678" }), /not available/);
  await assert.rejects(orders.checkout(order, { files: [{ type: "RESALE" }, { type: "CHECK" }], phone: "0712345678", code: "nope" }), e => e.status === 403);
  await assert.rejects(orders.checkout(order, { files: [{ type: "CHECK" }, { type: "CHECK" }], phone: "12345" }), /Invalid phone/);
  inactive = true;
  await assert.rejects(orders.checkout(order, { files: [{ type: "CHECK" }, { type: "CHECK" }], phone: "0712345678" }), e => e.status === 403);
  inactive = false;

  sentToTelegram.length = 0;
  let status = await orders.checkout(order, { files: [{ type: "RESALE" }, { type: "SIMILARITY" }], code: "SECRET", phone: "0712345678" });
  assert.equal(status.amount, 90 + 100, "amount from the bot's own prices");
  assert.deepEqual(stkCalls.at(-1), { uid: order.uid, amount: 190, phone: "254712345678", mode: "initial" });
  assert.equal(status.stage, "PAYMENT");
  assert(status.messages.some(m => m.text === "📲 STK sent. Enter your M-Pesa PIN."), "bot reply captured as plain text");
  const adminDocs = sentToTelegram.filter(x => x.m === "sendDocument" && x.chat === 111);
  assert.equal(adminDocs.length, 2, "admin receives each document like a Telegram upload");
  assert(fs.existsSync(adminDocs[0].doc.source));
  assert.equal(sub.files[0].similarityFilter, "FILTERED");
  assert.throws(() => orders.addUpload(order, "late.pdf", Buffer.from("late")), e => e.status === 409, "locked after checkout");

  // 4. Telegram routing: nothing addressed to the website customer reaches Telegram.
  sentToTelegram.length = 0;
  await bot.telegram.sendMessage(order.uid, "✅ *Payment confirmed*. Report is processing.");
  await bot.telegram.sendMessage(222, "a real telegram user");
  assert.deepEqual(sentToTelegram.map(x => x.chat), [222], "only real Telegram chats are contacted");
  paymentRefs[sub.api_ref].status = "COMPLETE";
  paidJobs[sub.batchId] = { jobId: sub.batchId, batchId: sub.batchId, userId: order.uid, status: "API_PROCESSING" };
  status = orders.statusFor(order);
  assert.equal(status.stage, "PROCESSING");
  await assert.rejects(Promise.resolve().then(() => orders.cancel(order)), e => e.status === 409, "paid orders are not cancellable here");

  // API delivery (renderAndDeliverApiReports) uses a read stream.
  const pdf = path.join(dataDir, "rendered.pdf");
  fs.writeFileSync(pdf, "%PDF-1.4 similarity");
  await bot.telegram.sendDocument(order.uid, { source: fs.createReadStream(pdf), filename: "Similarity Report.pdf" });
  // Manual delivery (/filebatch or /webdeliver) forwards a Telegram file_id; userId arrives as a string.
  const realFetch = global.fetch;
  global.fetch = async url => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from("%PDF-1.4 ai from " + url) });
  await bot.telegram.sendDocument(String(order.uid), "AgADtelegramFileId", { caption: "Your AI report" });
  global.fetch = realFetch;
  assert.equal(sentToTelegram.filter(x => String(x.chat) === String(order.uid)).length, 0);
  status = orders.statusFor(order);
  assert.equal(status.stage, "PARTLY_DELIVERED");
  assert.deepEqual(status.reports.map(r => r.name), ["Similarity Report.pdf", "AgADtelegramFileId.pdf"]);
  paidJobs[sub.batchId].deliveredAt = Date.now();
  assert.equal(orders.statusFor(order).stage, "DELIVERED");
  const r0 = orders.reportFile(order, 0);
  assert.equal(fs.readFileSync(r0.file, "utf8"), "%PDF-1.4 similarity");
  assert(orders.statusFor(order).messages.some(m => m.text === "Your AI report"), "delivery caption shown");

  // 4b. A failed STK initiation is reported as PAYMENT_FAILED and can be resent.
  const failing = orders.newOrder("4.4.4.4");
  orders.addUpload(failing.order, "f.docx", Buffer.from("failing stk"));
  failNextStk = true;
  status = await orders.checkout(failing.order, { files: [{ type: "CHECK" }], phone: "0712345678" });
  assert.equal(status.stage, "PAYMENT_FAILED", "failed STK must not look like 'waiting'");
  status = await orders.resend(failing.order, "0798765432");
  assert.equal(stkCalls.at(-1).mode, "resend");
  assert.equal(stkCalls.at(-1).phone, "254798765432");
  assert.equal(status.stage, "PAYMENT", "newest attempt decides the status");
  assert.equal(orders.cancel(failing.order).stage, "CANCELLED");

  // 5. Unpaid order can be cancelled; uploads are removed.
  const second = orders.newOrder("1.2.3.4");
  orders.addUpload(second.order, "draft.docx", Buffer.from("draft"));
  assert.equal(orders.cancel(second.order).stage, "CANCELLED");
  assert(!submissions[second.order.uid]);

  // 6. Exclusive discount window: CHECK refused exactly as on Telegram.
  discountWindow = true;
  const third = orders.newOrder("5.6.7.8");
  orders.addUpload(third.order, "x.docx", Buffer.from("third"));
  await assert.rejects(orders.checkout(third.order, { files: [{ type: "CHECK" }], phone: "0712345678" }), /not available/);
  status = await orders.checkout(third.order, { files: [{ type: "RESALE" }], phone: "0712345678" });
  assert.equal(status.amount, 90, "public window needs no code");
  discountWindow = false;

  // 7. Client-choice filtering must be answered per document.
  filterMode = "CLIENT_CHOICE";
  const fourth = orders.newOrder("9.9.9.9");
  orders.addUpload(fourth.order, "f.pdf", Buffer.from("fourth"));
  await assert.rejects(orders.checkout(fourth.order, { files: [{ type: "CHECK" }], phone: "0712345678" }), /similarity filtering/);
  await orders.checkout(fourth.order, { files: [{ type: "CHECK", filter: "UNFILTERED" }], phone: "0712345678" });
  assert.equal(submissions[fourth.order.uid].files[0].similarityFilter, "UNFILTERED");
  filterMode = "FILTERED";

  // 8. Persistence: a restart reloads orders and rebuilds the submission.
  delete submissions[order.uid];
  const reloaded = W.createWebOrders(d);
  const again = reloaded.authorize(order.id, token);
  assert.equal(reloaded.statusFor(again).reports.length, 2);
  assert.equal(reloaded.readWebFile(sub.files[0].file_id).toString(), "first document");

  // 9. bot.js wiring: every dependency handed to installWebOrders exists in bot.js.
  const botSource = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  const block = botSource.slice(botSource.indexOf('require("./jk-web-orders.cjs").installWebOrders({') + 50,
    botSource.indexOf('app.post("/webhook"'));
  assert(block.length > 200, "installWebOrders call present before /webhook");
  // Shorthand properties and plain identifier values (e.g. "attemptStkPush," / "X: CHECK_PRICE_KES,").
  const names = new Set([...block.replace(/\/\/[^\n]*/g, "").matchAll(/(?:^|[\s,{:])([A-Za-z_][A-Za-z0-9_]*)(?=\s*(?:,|\n|\}))/g)].map(m => m[1]));
  for (const name of names) {
    if (/^(app|express|bot|true|false|null)$/.test(name)) continue;
    const declared = new RegExp("(?:function\\s+|const\\s+|let\\s+|var\\s+)" + name + "\\b").test(botSource);
    assert(declared, "installWebOrders dependency is not defined in bot.js: " + name);
  }
  for (const used of ["CHECK_PRICE_KES", "RECHECK_PRICE_KES", "SIMILARITY_ONLY_PRICE_KES", "RESALE_PRICE_KES",
    "SIMILARITY_ONLY_ENABLED", "RESALE_ENABLED", "RESALE_AMOUNT_VISIBLE", "RESALE_LABEL_TITLE", "STAGE_WAIT_UPLOADS",
    "STAGE_WAIT_PHONE", "STAGE_WAIT_PAYMENT", "reportSettings", "paidJobs", "MESSAGES", "readBoolEnv"]) {
    assert(new RegExp("(?:const|let|function)\\s+" + used + "\\b").test(botSource), used);
  }
  assert(/if \(webOrders && require\("\.\/jk-web-orders\.cjs"\)\.isWebFileId\(fileId\)\)/.test(botSource), "provider download reads website uploads");
  assert(botSource.includes('bot.command("webdeliver"'), "/webdeliver admin command");

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("PASS: website config mirrors Telegram prices, discount window, code and filter rules (no recheck)");
  console.log("PASS: uploads, token auth, checkout via the bot's own STK payment, admin receives documents");
  console.log("PASS: messages and reports for website customers never reach Telegram; API and manual delivery captured");
  console.log("PASS: cancellation only before payment; restart persistence; bot.js wiring dependencies all defined");
})().catch(err => { console.error(err); process.exit(1); });
