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
  const adminMessages = [], proofCalls = [];
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
    sendAdminMessage: async (text, extra) => { adminMessages.push({ text, extra }); },
    handleMpesaProofText: async (ctx, sub, text) => { proofCalls.push({ uid: ctx.from.id, text }); await ctx.reply("✅ Payment proof received. Admin will verify."); },
    TILL_NUMBER: "6164915"
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

  // 4a. Manual delivery keeps the admin's file name; deletion rules.
  global.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from("%PDF manual") });
  await bot.telegram.sendDocument(String(order.uid), "AgADother", { filename: "Smith Essay - Similarity Report.pdf" });
  global.fetch = realFetch;
  assert.equal(orders.statusFor(order).reports.at(-1).name, "Smith Essay - Similarity Report.pdf", "original file name kept");
  const processing = orders.newOrder("3.3.3.3");
  orders.addUpload(processing.order, "p.docx", Buffer.from("processing doc"));
  await orders.checkout(processing.order, { files: [{ type: "CHECK" }], phone: "0712345678" });
  const pSub = submissions[processing.order.uid];
  paymentRefs[pSub.api_ref].status = "COMPLETE";
  paidJobs[pSub.batchId] = { jobId: pSub.batchId, batchId: pSub.batchId, userId: processing.order.uid, status: "API_PROCESSING" };
  assert.throws(() => orders.deleteData(processing.order), /still being prepared/, "files kept while the bot needs them");
  const deleted = orders.deleteData(order);
  assert.equal(deleted.deleted, true);
  assert.deepEqual(deleted.reports, []);
  assert.deepEqual(deleted.messages, []);
  assert(deleted.files.every(f => f.name === "deleted"));
  assert.throws(() => orders.reportFile(order, 0), e => e.status === 404);
  assert.throws(() => orders.readWebFile(sub.files[0].file_id), /not found|ENOENT|storage clean-up/);

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

  // 7b. Support conversation and till payment proof.
  assert.equal(W.publicConfig(d).tillNumber, "6164915");
  const talk = orders.newOrder("7.7.7.7");
  orders.addUpload(talk.order, "t.docx", Buffer.from("talk doc"));
  failNextStk = true;
  await orders.checkout(talk.order, { files: [{ type: "CHECK" }], phone: "0712345678" });
  assert.equal(orders.statusFor(talk.order).stage, "PAYMENT_FAILED");
  // admin reply from Telegram (💬 Reply button) lands in the order, tagged as support
  await bot.telegram.sendMessage(String(talk.order.uid), "━━━━━━━━━━━━━━━\n💬 *JK Turnitin Support*\n━━━━━━━━━━━━━━━\n\nPlease resend the prompt or pay via till.\n\n━━━━━━━━━━━━━━━", { parse_mode: "Markdown" });
  const supportMsg = orders.statusFor(talk.order).messages.at(-1);
  assert.deepEqual([supportMsg.kind, supportMsg.text], ["support", "Please resend the prompt or pay via till."]);
  // customer message goes to the admin with the order's user ID (Reply button attaches)
  adminMessages.length = 0;
  await orders.clientMessage(talk.order, "  I paid via till, kindly confirm.  ");
  assert.equal(adminMessages.length, 1);
  assert(adminMessages[0].text.includes("User ID: " + talk.order.uid) && adminMessages[0].text.includes(talk.order.id));
  assert.equal(adminMessages[0].extra.adminButtons, "replyOnly");
  assert.deepEqual(orders.statusFor(talk.order).messages.at(-1), { at: orders.statusFor(talk.order).messages.at(-1).at, text: "I paid via till, kindly confirm.", kind: "client" });
  await assert.rejects(orders.clientMessage(talk.order, " "), e => e.status === 400);
  // till proof uses the bot's own handler with the order's virtual user
  await assert.rejects(orders.paymentProof(talk.order, "hello"), e => e.status === 400);
  const sms = "UKA1B2C3D4 Confirmed. Ksh135.00 paid to JK TURNITIN. on 1/11/26 at 3:41 PM. New M-PESA balance is Ksh1,200.00.";
  const proofStatus = await orders.paymentProof(talk.order, sms);
  assert.deepEqual(proofCalls.at(-1), { uid: talk.order.uid, text: sms });
  assert.equal(proofStatus.proofSubmitted, true);
  assert(proofStatus.messages.some(m => m.text === "✅ Payment proof received. Admin will verify."));
  // once paid, no further proofs
  const talkSub = submissions[talk.order.uid];
  paidJobs[talkSub.batchId] = { jobId: talkSub.batchId, batchId: talkSub.batchId, userId: talk.order.uid, status: "API_PROCESSING" };
  await assert.rejects(orders.paymentProof(talk.order, sms), e => e.status === 409);
  for (let k = 0; k < 9; k++) await orders.clientMessage(talk.order, "message " + k);
  await assert.rejects(orders.clientMessage(talk.order, "one too many"), e => e.status === 429);

  // 8. Persistence: a restart reloads orders and rebuilds the submission.
  delete submissions[processing.order.uid];
  const reloaded = W.createWebOrders(d);
  const again = reloaded.authorize(processing.order.id, processing.token);
  assert.equal(reloaded.statusFor(again).stage, "PROCESSING");
  assert.equal(reloaded.readWebFile(pSub.files[0].file_id).toString(), "processing doc");
  assert.equal(reloaded.statusFor(reloaded.authorize(order.id, token)).deleted, true, "deletion persists");

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
  const moduleSource = fs.readFileSync(path.join(__dirname, "jk-web-orders.cjs"), "utf8");
  for (const origin of ["https://jkacademictoolshub.com", "https://www.jkacademictoolshub.com", "https://john-kaptain.github.io"]) {
    assert(moduleSource.includes(origin), "website origin allowed by default: " + origin);
  }
  assert(botSource.includes("services here: https://jkacademictoolshub.com/"), "delivery message links the new domain");
  assert(/isWebUserId\(userId\)\s*\?\s*API_REPORTS_DELIVERED_MESSAGE\s*:\s*REPORTS_DELIVERED_MESSAGE/.test(botSource),
    "web orders get the API delivery message (no website link) after /donebatch");
  assert(/isWebUserId\(target\.userId\) && doc\.file_name\s*\?\s*\{ filename: doc\.file_name \}/.test(botSource),
    "manual delivery passes the original file name for web orders");

  // 9. Disk retention: unpaid 36 h; paid uploads 36 h after delivery and at
  //    most 48 h (kept while processing); reports 48 h; records 30 days.
  {
    discountWindow = false; inactive = false;
    const H = 3600_000, t0 = Date.now();
    const exists = fid => { try { orders.readWebFile(fid); return true; } catch { return false; } };
    const make = async (ip, name) => {
      const o = orders.newOrder(ip).order;
      orders.addUpload(o, name, Buffer.from("retention " + name));
      await orders.checkout(o, { files: [{ type: "CHECK" }], phone: "0712345678" });
      const s = submissions[o.uid];
      return { o, s, fid: s.files[0].file_id };
    };
    const unpaid = await make("9.0.0.1", "unpaid.docx");
    const delivered = await make("9.0.0.2", "delivered.docx");
    const busy = await make("9.0.0.3", "busy.docx");
    for (const x of [delivered, busy]) {
      paymentRefs[x.s.api_ref].status = "COMPLETE";
      paidJobs[x.s.batchId] = { jobId: x.s.batchId, batchId: x.s.batchId, userId: x.o.uid, status: "API_PROCESSING" };
    }
    fs.writeFileSync(pdf, "%PDF-1.4 retention");
    await bot.telegram.sendDocument(delivered.o.uid, { source: fs.createReadStream(pdf), filename: "Report.pdf" });
    paidJobs[delivered.s.batchId].deliveredAt = Date.now();
    assert.equal(orders.statusFor(delivered.o).stage, "DELIVERED");
    assert.equal(orders.statusFor(unpaid.o).stage, "PAYMENT");

    orders.prune(t0 + 35 * H);
    assert(exists(unpaid.fid) && exists(delivered.fid) && exists(busy.fid), "nothing removed before 36 h");
    orders.prune(t0 + 37 * H);
    assert(!exists(unpaid.fid), "unpaid (stuck in payment) files removed after 36 h");
    assert(!exists(delivered.fid), "paid documents removed 36 h after delivery");
    assert(exists(busy.fid), "paid order still processing keeps its documents");
    assert(fs.existsSync(orders.reportFile(delivered.o, 0).file), "reports still downloadable after 36 h");
    assert.match(String((() => { try { orders.readWebFile(delivered.fid); } catch (e) { return e.message; } })()), /storage clean-up|not found/);

    orders.prune(t0 + 49 * H);
    assert.deepEqual(orders.statusFor(delivered.o).reports, [], "reports removed after 48 h");
    assert(exists(busy.fid), "a job still processing keeps its documents past 48 h");
    await bot.telegram.sendDocument(busy.o.uid, { source: fs.createReadStream(pdf), filename: "Late.pdf" });
    paidJobs[busy.s.batchId].deliveredAt = Date.now();
    orders.prune(t0 + 49 * H);
    assert(!exists(busy.fid), "late job's documents removed once delivered after 48 h");

    orders.prune(t0 + 31 * 24 * H);
    assert.equal(orders.orderById(delivered.o.id), null, "order record dropped after 30 days");
    assert.equal(orders.orderById(unpaid.o.id), null);
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("PASS: disk retention: unpaid 36 h, paid documents 36 h after delivery / max 48 h (kept while processing), reports 48 h, records 30 days");
  console.log("PASS: website config mirrors Telegram prices, discount window, code and filter rules (no recheck)");
  console.log("PASS: uploads, token auth, checkout via the bot's own STK payment, admin receives documents");
  console.log("PASS: messages and reports for website customers never reach Telegram; API and manual delivery captured");
  console.log("PASS: cancellation only before payment; restart persistence; bot.js wiring dependencies all defined");
  console.log("PASS: admin replies shown as support messages; customer messages reach the admin with Reply; till SMS proof via the bot's handler");
})().catch(err => { console.error(err); process.exit(1); });
