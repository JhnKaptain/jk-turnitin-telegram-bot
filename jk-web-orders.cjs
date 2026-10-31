"use strict";
// JK_WEB_ORDERS_V1
// Website front door for the SAME report service the Telegram bot sells.
//
// A website order is a virtual bot customer with a reserved user ID
// (above WEB_UID_BASE, far outside Telegram's 52-bit user ID range). The
// order drives the bot's own functions: identical prices, discount rules,
// filter policy, report identity, M-Pesa STK payment, payment polling and
// webhook, PAID admin message, AUTO / ADMIN APPROVAL / MANUAL report modes,
// reference review, duplicate safeguards and report rendering.
//
// Anything the bot "sends" to that virtual customer through bot.telegram is
// captured here instead of Telegram: text messages become order updates and
// documents become downloadable reports on the website. Uploaded files use
// "web:<orderId>:<n>" file IDs that the bot reads from persistent storage.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const WEB_UID_BASE = 9_000_000_000_000_000;
const WEB_FILE_PREFIX = "web:";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // Telegram bot document limit
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const REPORT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CREATE_LIMIT_PER_HOUR = 20;

function isWebUserId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > WEB_UID_BASE;
}
function isWebFileId(value) {
  return typeof value === "string" && value.startsWith(WEB_FILE_PREFIX);
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function safeName(name) {
  const base = path.basename(String(name || "document")).replace(/[^\p{L}\p{N}._ ()-]+/gu, "_").trim();
  return (base || "document").slice(0, 120);
}
// Plain text for the website: strip Telegram Markdown / HTML decoration.
function plainText(text) {
  return String(text ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\\([\\[\]()~>#+\-=|{}.!])/g, "$1")
    .trim();
}
function timingSafeEqualHex(a, b) {
  const x = Buffer.from(String(a || ""), "utf8"), y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Same availability rules as the Telegram type keyboard (typeInlineKeyboard):
// - RECHECK is never offered on the website (no returning-customer identity).
// - During the public discount window (exclusive mode) CHECK is hidden.
// - SIMILARITY when SIMILARITY_ONLY_ENABLED.
// - RESALE (discount) when enabled AND (public window active OR code verified).
function allowedServices(d, { resellerVerified = false } = {}) {
  const p = d.prices();
  const f = d.flags();
  const exclusive = d.isPublicDiscountExclusiveMode();
  const services = [];
  if (!exclusive) services.push({ type: "CHECK", label: "Check (AI + Similarity)", price: p.CHECK });
  if (f.SIMILARITY_ONLY_ENABLED) services.push({ type: "SIMILARITY", label: "Similarity Report Only", price: p.SIMILARITY });
  if (f.RESALE_ENABLED && (d.isDiscountPublicActive() || resellerVerified)) {
    services.push({ type: "RESALE", label: f.RESALE_LABEL_TITLE + " (AI + Similarity)", price: p.RESALE });
  }
  return services;
}

function publicConfig(d) {
  const p = d.prices();
  const f = d.flags();
  const publicActive = Boolean(f.RESALE_ENABLED && d.isDiscountPublicActive());
  return {
    enabled: d.webEnabled(),
    open: !d.isBotInactivePeriod(),
    closedMessage: d.isBotInactivePeriod() ? plainText(d.inactiveText()) : "",
    currency: "KES",
    maxFiles: d.MAX_BATCH_FILES,
    maxFileBytes: MAX_UPLOAD_BYTES,
    acceptedExtensions: [".pdf", ".docx", ".doc", ".pptx"],
    services: allowedServices(d),
    discount: {
      enabled: Boolean(f.RESALE_ENABLED),
      label: f.RESALE_LABEL_TITLE,
      publicActive,
      exclusive: Boolean(d.isPublicDiscountExclusiveMode()),
      price: f.RESALE_ENABLED && (publicActive || f.RESALE_AMOUNT_VISIBLE) ? p.RESALE : null,
      requiresCode: Boolean(f.RESALE_ENABLED && !publicActive),
      timeText: plainText(d.discountTimeText())
    },
    similarityFilterChoice: d.getFilterMode() === d.FILTER_MODE_CLIENT
  };
}

function createWebOrders(d) {
  const root = path.join(d.DATA_DIR, "web-orders");
  const storeFile = path.join(d.DATA_DIR, "web-orders.json");
  let store = { nextSeq: 1, orders: {} };
  try {
    if (fs.existsSync(storeFile)) store = { nextSeq: 1, orders: {}, ...JSON.parse(fs.readFileSync(storeFile, "utf8")) };
  } catch (e) {
    console.error("WEB ORDERS: store unreadable, starting empty:", e?.message || e);
  }
  const save = () => {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    const tmp = storeFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tmp, storeFile);
  };
  const orderByUid = uid => Object.values(store.orders).find(o => String(o.uid) === String(uid)) || null;
  const orderDir = id => path.join(root, id);
  const createRate = new Map();

  function newOrder(ip) {
    const now = Date.now();
    const hits = (createRate.get(ip) || []).filter(t => now - t < 3600_000);
    if (hits.length >= CREATE_LIMIT_PER_HOUR) {
      const e = new Error("Too many new orders from this connection. Please try again later.");
      e.status = 429; throw e;
    }
    createRate.set(ip, [...hits, now]);
    const seq = store.nextSeq++;
    const uid = WEB_UID_BASE + seq;
    const id = "W" + now.toString(36).toUpperCase() + seq.toString(36).toUpperCase();
    const token = crypto.randomBytes(32).toString("hex");
    store.orders[id] = { id, uid, tokenHash: sha256(token), createdAt: now, stage: "DRAFT",
      uploads: [], messages: [], reports: [] };
    const sub = d.createEmptySubmission();
    sub.stage = d.STAGES.WAIT_UPLOADS;
    sub.expectedFiles = 0;
    sub.webOrderId = id;
    d.submissions[uid] = sub;
    fs.mkdirSync(path.join(orderDir(id), "uploads"), { recursive: true });
    save();
    return { order: store.orders[id], token };
  }

  function authorize(id, token) {
    const order = store.orders[String(id || "")];
    if (!order || !timingSafeEqualHex(order.tokenHash, sha256(String(token || "")))) {
      const e = new Error("Order not found."); e.status = 404; throw e;
    }
    return order;
  }

  function subFor(order) {
    let sub = d.submissions[order.uid];
    if (!sub) {
      // The bot keeps submissions in memory; rebuild after a restart.
      sub = d.createEmptySubmission();
      sub.webOrderId = order.id;
      sub.files = order.files || [];
      sub.expectedFiles = sub.files.length;
      sub.batchId = order.batchId || null;
      sub.api_ref = order.apiRef || null;
      sub.phone = order.phone || null;
      sub.amount = order.amount || null;
      sub.stage = order.stage === "DRAFT" ? d.STAGES.WAIT_UPLOADS : d.STAGES.WAIT_PAYMENT;
      d.submissions[order.uid] = sub;
    }
    return sub;
  }

  function webFilePath(fileId) {
    const [, id, n] = String(fileId).split(":");
    const order = store.orders[id];
    const upload = order?.uploads?.[Number(n)];
    if (!upload) throw new Error("Website upload not found: " + fileId);
    return path.join(orderDir(id), "uploads", upload.stored);
  }
  function readWebFile(fileId) {
    return fs.readFileSync(webFilePath(fileId));
  }

  function addUpload(order, name, buffer) {
    if (order.stage !== "DRAFT") { const e = new Error("This order can no longer be changed."); e.status = 409; throw e; }
    if (!d.supportedScanUpload(name)) { const e = new Error("Only PDF, DOCX, DOC and PPTX are supported for scanning."); e.status = 415; throw e; }
    if (!buffer?.length) { const e = new Error("The file is empty."); e.status = 400; throw e; }
    if (buffer.length > MAX_UPLOAD_BYTES) { const e = new Error("The file is larger than 20 MB."); e.status = 413; throw e; }
    const sub = subFor(order);
    if (sub.files.length >= d.MAX_BATCH_FILES) { const e = new Error("A maximum of " + d.MAX_BATCH_FILES + " files can be checked per order."); e.status = 409; throw e; }
    const digest = sha256(buffer);
    if (order.uploads.some(u => !u.removed && u.sha256 === digest)) { const e = new Error("This file is already in the order."); e.status = 409; throw e; }
    const n = order.uploads.length;
    const fileName = safeName(name);
    const stored = n + "-" + fileName;
    fs.mkdirSync(path.join(orderDir(order.id), "uploads"), { recursive: true });
    fs.writeFileSync(path.join(orderDir(order.id), "uploads", stored), buffer);
    order.uploads.push({ n, name: fileName, stored, size: buffer.length, sha256: digest, at: Date.now() });
    const file = d.createStoredFileFromDocument(order.uid, {
      file_id: WEB_FILE_PREFIX + order.id + ":" + n,
      file_unique_id: "web_" + digest.slice(0, 40),
      file_name: fileName,
      file_size: buffer.length
    });
    file.webUploadIndex = n;
    sub.files.push(file);
    sub.expectedFiles = sub.files.length;
    save();
    return { index: sub.files.length - 1, name: fileName, size: buffer.length };
  }

  function removeUpload(order, index) {
    if (order.stage !== "DRAFT") { const e = new Error("This order can no longer be changed."); e.status = 409; throw e; }
    const sub = subFor(order);
    const file = sub.files[index];
    if (!file) { const e = new Error("File not found."); e.status = 404; throw e; }
    sub.files.splice(index, 1);
    sub.expectedFiles = sub.files.length;
    const upload = order.uploads[file.webUploadIndex];
    if (upload) {
      upload.removed = true;
      try { fs.unlinkSync(path.join(orderDir(order.id), "uploads", upload.stored)); } catch {}
    }
    save();
  }

  // Fake Telegraf context for the bot's own payment function: replies to the
  // virtual customer become order updates.
  function contextFor(order) {
    return {
      from: { id: order.uid, first_name: "Website", last_name: "order " + order.id, username: "web_" + order.id },
      chat: { id: order.uid },
      reply: async text => { pushMessage(order, text); return { message_id: 0 }; },
      answerCbQuery: async text => { if (text) pushMessage(order, text); }
    };
  }

  function pushMessage(order, text) {
    const clean = plainText(text);
    if (!clean) return;
    order.messages.push({ at: Date.now(), text: clean });
    if (order.messages.length > 60) order.messages = order.messages.slice(-60);
    save();
  }

  async function checkout(order, { files = [], code = "", phone = "" } = {}) {
    if (!d.webEnabled()) { const e = new Error("Website orders are temporarily unavailable."); e.status = 503; throw e; }
    if (d.isBotInactivePeriod()) { const e = new Error(plainText(d.inactiveText()) || "The service is currently closed."); e.status = 403; throw e; }
    if (order.stage !== "DRAFT") { const e = new Error("Payment has already been started for this order."); e.status = 409; throw e; }
    const sub = subFor(order);
    if (!sub.files.length) { const e = new Error("Upload at least one document."); e.status = 400; throw e; }
    if (!Array.isArray(files) || files.length !== sub.files.length) {
      const e = new Error("Choose a service for every document."); e.status = 400; throw e;
    }
    const phone254 = d.normalizePhoneTo254(phone);
    if (!phone254) { const e = new Error("Invalid phone. Use 07XXXXXXXX or 01XXXXXXXX."); e.status = 400; throw e; }

    const wantsResale = files.some(f => String(f?.type || "").toUpperCase() === "RESALE");
    if (wantsResale && !d.isDiscountPublicActive()) {
      if (!d.resellerCodeMatches(code)) { const e = new Error("Invalid " + d.flags().RESALE_LABEL_TITLE + " code."); e.status = 403; throw e; }
      sub.resellerVerified = true;
    }
    const allowed = allowedServices(d, { resellerVerified: Boolean(sub.resellerVerified) });
    const clientFilter = d.getFilterMode() === d.FILTER_MODE_CLIENT;
    const choices = files.map((choice, i) => {
      const kind = String(choice?.type || "").toUpperCase();
      const service = allowed.find(s => s.type === kind);
      if (!service) { const e = new Error("Service not available for document " + (i + 1) + "."); e.status = 400; throw e; }
      let filter = null;
      if (clientFilter) {
        filter = String(choice?.filter || "").toUpperCase();
        if (![d.FILTER_MODE_FILTERED, d.FILTER_MODE_UNFILTERED].includes(filter)) {
          const e = new Error("Choose similarity filtering for document " + (i + 1) + "."); e.status = 400; throw e;
        }
      }
      return { kind, filter };
    });

    // Same steps as finalizeFileTypeSelection / finalizeTypeWithFilterSelection.
    choices.forEach(({ kind, filter }, i) => {
      const file = sub.files[i];
      d.ensureFileReportIdentity(file);
      file.type = kind;
      file.pendingType = null;
      if (filter) file.similarityFilter = filter;
      if (!file.similarityFilter) file.similarityFilter = d.effectiveSimilarityFilter(file);
      file.price = d.priceFor(kind);
    });

    sub.amount = d.calculateSubmissionAmount(sub);
    sub.currency = "KES";
    sub.batchId = sub.batchId || d.makeBatchId(order.uid);
    sub.paymentMethod = "MPESA";
    sub.phone = phone254;
    sub.stage = d.STAGES.WAIT_PHONE;
    sub.currentFileIndex = null;
    order.stage = "PAYMENT";
    order.batchId = sub.batchId;
    order.amount = sub.amount;
    order.phone = phone254;
    order.files = sub.files;
    order.summary = d.formatBatchSummary(sub);
    save();

    // Each document goes to the admin chat exactly like a Telegram upload.
    for (let i = 0; i < sub.files.length; i++) await sendFileToAdmin(order, sub, sub.files[i], i + 1);

    await d.attemptStkPush(contextFor(order), sub, { mode: "initial" });
    order.apiRef = sub.api_ref || null;
    save();
    return statusFor(order);
  }

  async function resend(order, phone) {
    if (order.stage !== "PAYMENT") { const e = new Error("No payment is waiting for this order."); e.status = 409; throw e; }
    const sub = subFor(order);
    if (statusFor(order).stage !== "PAYMENT" && statusFor(order).stage !== "PAYMENT_FAILED") return statusFor(order);
    if (phone) {
      const phone254 = d.normalizePhoneTo254(phone);
      if (!phone254) { const e = new Error("Invalid phone. Use 07XXXXXXXX or 01XXXXXXXX."); e.status = 400; throw e; }
      sub.phone = order.phone = phone254;
    }
    await d.attemptStkPush(contextFor(order), sub, { mode: "resend" });
    order.apiRef = sub.api_ref || order.apiRef;
    save();
    return statusFor(order);
  }

  function cancel(order) {
    const stage = statusFor(order).stage;
    if (!["DRAFT", "PAYMENT", "PAYMENT_FAILED"].includes(stage)) {
      const e = new Error("A paid order cannot be cancelled here. Contact support."); e.status = 409; throw e;
    }
    const latest = order.batchId && d.latestPaymentRefForBatch ? d.latestPaymentRefForBatch(order.batchId) : null;
    if (latest && latest.status !== "COMPLETE") d.updatePaymentRef(latest.apiRef, { status: "CANCELLED", cancelledBy: "website-customer" });
    delete d.submissions[order.uid];
    order.stage = "CANCELLED";
    order.cancelledAt = Date.now();
    try { fs.rmSync(path.join(orderDir(order.id), "uploads"), { recursive: true, force: true }); } catch {}
    save();
    return statusFor(order);
  }

  async function sendFileToAdmin(order, sub, file, number) {
    if (file.adminSentAt) return;
    const caption = d.buildAdminDocumentCaption({
      userId: order.uid, name: "Website order " + order.id, usernameText: "web_" + order.id,
      file, fileNumber: number, expectedFiles: sub.expectedFiles
    });
    try {
      const sent = await d.bot.telegram.sendDocument(d.ADMIN_ID,
        { source: webFilePath(file.file_id), filename: file.file_name },
        { caption, parse_mode: "HTML", reply_markup: d.adminActionKeyboard(order.uid, "document").reply_markup });
      file.adminMessageId = sent?.message_id || null;
    } catch (err) {
      await d.sendAdminMessage("⚠️ Website document could not be attached. Details below.\n\n" + caption,
        { adminButtons: "document", parse_mode: "HTML" }).catch(() => {});
    }
    file.adminSentAt = Date.now();
  }

  function paidJobFor(order) {
    const jobs = d.getPaidJobs();
    return order.batchId ? jobs[order.batchId] || Object.values(jobs).find(j => j?.batchId === order.batchId) || null : null;
  }

  function statusFor(order) {
    const sub = d.submissions[order.uid];
    const latest = order.batchId && d.latestPaymentRefForBatch ? d.latestPaymentRefForBatch(order.batchId) : null;
    const apiRef = latest?.apiRef || sub?.api_ref || order.apiRef || null;
    const ref = apiRef ? d.getPaymentRef(apiRef) : null;
    const job = paidJobFor(order);
    let stage = order.stage;
    if (stage === "PAYMENT") {
      const s = String(ref?.status || "PENDING").toUpperCase();
      if (s === "COMPLETE" || job) stage = "PAID";
      else if (["FAILED", "CANCELLED", "EXPIRED", "FAILED_TO_INITIATE", "ADMIN_CANCELLED"].includes(s)) stage = "PAYMENT_FAILED";
    }
    if (stage === "PAID") {
      stage = order.reports.length ? (job?.deliveredAt || order.deliveredAt ? "DELIVERED" : "PARTLY_DELIVERED") : "PROCESSING";
    }
    const files = (sub?.files || order.files || []).map((f, i) => ({
      index: i, name: f.file_name, size: f.file_size || null, type: f.type || null, price: f.price || null,
      similarityFilter: f.type ? f.similarityFilter || null : null
    }));
    return {
      orderId: order.id, stage, createdAt: order.createdAt, deleted: Boolean(order.deletedAt),
      amount: sub?.amount ?? order.amount ?? null, currency: "KES",
      summary: order.summary || null, files,
      payment: ref ? { status: ref.status || "PENDING", invoiceId: ref.invoiceId || null } : null,
      messages: order.messages.slice(-20),
      reports: order.reports.filter(r => !r.purged).map((r, k) => ({ id: k, name: r.name, size: r.size, at: r.at }))
    };
  }

  // ---- delivery capture: bot.telegram calls addressed to a website order ----
  async function storeReport(order, buffer, name, caption) {
    const dir = path.join(orderDir(order.id), "reports");
    fs.mkdirSync(dir, { recursive: true });
    const fileName = safeName(name || ("report-" + (order.reports.length + 1) + ".pdf"));
    const stored = order.reports.length + "-" + fileName;
    fs.writeFileSync(path.join(dir, stored), buffer);
    order.reports.push({ name: fileName, stored, size: buffer.length, at: Date.now() });
    if (caption) pushMessage(order, caption);
    save();
  }
  async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  async function materialize(input, originalGetFileLink) {
    if (typeof input === "string") {
      if (isWebFileId(input)) return { buffer: readWebFile(input), name: null };
      if (/^https?:\/\//.test(input)) {
        const res = await fetch(input); return { buffer: Buffer.from(await res.arrayBuffer()), name: path.basename(new URL(input).pathname) };
      }
      const link = await originalGetFileLink(input); // Telegram file_id (admin manual delivery)
      const res = await fetch(String(link));
      if (!res.ok) throw new Error("Telegram file download failed: HTTP " + res.status);
      return { buffer: Buffer.from(await res.arrayBuffer()), name: path.basename(new URL(String(link)).pathname) };
    }
    const source = input?.source ?? input;
    const name = input?.filename || null;
    if (Buffer.isBuffer(source)) return { buffer: source, name };
    if (typeof source === "string") return { buffer: fs.readFileSync(source), name: name || path.basename(source) };
    if (source && typeof source.pipe === "function") return { buffer: await streamToBuffer(source), name: name || (source.path ? path.basename(String(source.path)) : null) };
    if (input?.url) return materialize(String(input.url), originalGetFileLink);
    throw new Error("Unsupported document source for website delivery");
  }

  function installTelegramRouting(bot) {
    const telegram = bot.telegram;
    if (telegram.__jkWebOrdersRouted) return;
    const originalGetFileLink = telegram.getFileLink.bind(telegram);
    const fake = chatId => ({ message_id: Date.now() % 1e9, chat: { id: chatId }, date: Math.floor(Date.now() / 1000) });
    const methods = ["sendMessage", "sendDocument", "sendPhoto", "sendMediaGroup", "copyMessage", "forwardMessage",
      "editMessageText", "editMessageReplyMarkup", "editMessageCaption", "deleteMessage", "sendChatAction",
      "pinChatMessage", "sendVideo", "sendAudio", "sendSticker", "sendAnimation"];
    for (const method of methods) {
      if (typeof telegram[method] !== "function") continue;
      const original = telegram[method].bind(telegram);
      telegram[method] = async (...args) => {
        // A website upload sent to the admin chat is read from disk.
        if (method === "sendDocument" && isWebFileId(args[1])) {
          args[1] = { source: webFilePath(args[1]), filename: path.basename(webFilePath(args[1])).replace(/^\d+-/, "") };
        }
        if (!isWebUserId(args[0])) return original(...args);
        const order = orderByUid(args[0]);
        if (!order) return fake(args[0]);
        try {
          if (method === "sendMessage") pushMessage(order, args[1]);
          else if (["sendDocument", "sendPhoto", "sendVideo", "sendAudio", "sendAnimation"].includes(method)) {
            const { buffer, name } = await materialize(args[1], originalGetFileLink);
            await storeReport(order, buffer, args[2]?.filename || name, args[2]?.caption);
          } else if (method === "sendMediaGroup") {
            for (const media of args[1] || []) {
              const { buffer, name } = await materialize(media.media, originalGetFileLink);
              await storeReport(order, buffer, name, media.caption);
            }
          } else if (method === "copyMessage" || method === "forwardMessage") {
            pushMessage(order, "An item was sent by the administrator. If it is not listed below, please contact support.");
          }
        } catch (err) {
          console.error("WEB ORDERS: delivery capture failed for " + order.id + ":", err?.message || err);
          throw err; // the bot's own delivery error handling applies
        }
        return fake(args[0]);
      };
    }
    telegram.__jkWebOrdersRouted = true;
  }

  // Customer-requested deletion of their documents and reports from the
  // website storage. Refused while the bot still needs the files.
  function deleteData(order) {
    const stage = statusFor(order).stage;
    if (!["DELIVERED", "CANCELLED", "DRAFT", "PAYMENT_FAILED"].includes(stage)) {
      const e = new Error(stage === "PARTLY_DELIVERED" || stage === "PROCESSING"
        ? "Your reports are still being prepared. You can delete your files once they are delivered."
        : "Files can be deleted once your reports are delivered."); e.status = 409; throw e;
    }
    if (stage === "PAYMENT_FAILED" || stage === "DRAFT") cancel(order);
    try { fs.rmSync(orderDir(order.id), { recursive: true, force: true }); } catch {}
    for (const upload of order.uploads) { upload.removed = true; upload.name = "deleted"; }
    for (const report of order.reports) { report.purged = true; report.name = "deleted"; }
    const sub = d.submissions[order.uid];
    if (sub) delete d.submissions[order.uid];
    order.files = (order.files || []).map(f => ({ ...f, file_name: "deleted" }));
    order.messages = [];
    order.deletedAt = Date.now();
    save();
    return statusFor(order);
  }

  function markDelivered(uid) {
    const order = orderByUid(uid);
    if (order && order.reports.length) { order.deliveredAt = Date.now(); save(); }
  }

  function prune(now = Date.now()) {
    for (const order of Object.values(store.orders)) {
      if ((order.stage === "DRAFT" || order.stage === "CANCELLED") && now - order.createdAt > DRAFT_TTL_MS && !order.pruned) {
        delete d.submissions[order.uid];
        try { fs.rmSync(orderDir(order.id), { recursive: true, force: true }); } catch {}
        order.pruned = true;
      }
      for (const report of order.reports) {
        if (!report.purged && now - report.at > REPORT_TTL_MS) {
          try { fs.unlinkSync(path.join(orderDir(order.id), "reports", report.stored)); } catch {}
          report.purged = true;
        }
      }
    }
    save();
  }

  function reportFile(order, id) {
    const report = order.reports[Number(id)];
    if (!report || report.purged) { const e = new Error("Report not available."); e.status = 404; throw e; }
    return { file: path.join(orderDir(order.id), "reports", report.stored), name: report.name };
  }

  return { newOrder, authorize, addUpload, removeUpload, checkout, resend, cancel, deleteData, statusFor, reportFile,
    readWebFile, installTelegramRouting, markDelivered, prune, orderById: id => store.orders[id] || null,
    orderByUid, uidForOrder: id => store.orders[String(id || "").trim()]?.uid || null };
}

function installWebOrders(d) {
  const orders = createWebOrders(d);
  orders.installTelegramRouting(d.bot);
  const allowed = String(process.env.WEB_ALLOWED_ORIGINS || "https://john-kaptain.github.io")
    .split(",").map(s => s.trim()).filter(Boolean);
  const app = d.app;

  app.use("/api/web", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Order-Token,X-File-Name");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    if (origin && !allowed.includes(origin)) return res.status(403).json({ error: "Origin not allowed" });
    next();
  });

  const handle = fn => async (req, res) => {
    try { await fn(req, res); } catch (err) {
      const status = Number(err?.status) || 500;
      if (status >= 500) console.error("WEB ORDERS:", err?.stack || err);
      res.status(status).json({ error: status >= 500 ? "Something went wrong. Please try again or contact support." : String(err.message || err) });
    }
  };
  const token = req => req.headers["x-order-token"] || req.query.token;
  const enabledOr503 = () => {
    if (!d.webEnabled()) { const e = new Error("Website orders are temporarily unavailable."); e.status = 503; throw e; }
  };

  app.get("/api/web/config", handle(async (req, res) => res.json(publicConfig(d))));
  app.post("/api/web/orders", handle(async (req, res) => {
    enabledOr503();
    if (d.isBotInactivePeriod()) { const e = new Error(plainText(d.inactiveText()) || "The service is currently closed."); e.status = 403; throw e; }
    const { order, token: secret } = orders.newOrder(String(req.ip || req.headers["x-forwarded-for"] || "unknown"));
    res.status(201).json({ orderId: order.id, token: secret, status: orders.statusFor(order) });
  }));
  app.put("/api/web/orders/:id/files", d.express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES + 1024 }), handle(async (req, res) => {
    const order = orders.authorize(req.params.id, token(req));
    const name = decodeURIComponent(String(req.headers["x-file-name"] || ""));
    const result = orders.addUpload(order, name, req.body);
    res.status(201).json({ file: result, status: orders.statusFor(order) });
  }));
  app.delete("/api/web/orders/:id/files/:index", handle(async (req, res) => {
    const order = orders.authorize(req.params.id, token(req));
    orders.removeUpload(order, Number(req.params.index));
    res.json({ status: orders.statusFor(order) });
  }));
  app.post("/api/web/orders/:id/checkout", handle(async (req, res) => {
    const order = orders.authorize(req.params.id, token(req));
    res.json({ status: await orders.checkout(order, req.body || {}) });
  }));
  app.post("/api/web/orders/:id/resend", handle(async (req, res) => {
    const order = orders.authorize(req.params.id, token(req));
    res.json({ status: await orders.resend(order, req.body?.phone) });
  }));
  app.post("/api/web/orders/:id/cancel", handle(async (req, res) => {
    const order = orders.authorize(req.params.id, token(req));
    res.json({ status: orders.cancel(order) });
  }));
  app.post("/api/web/orders/:id/delete", handle(async (req, res) => {
    const order = orders.authorize(req.params.id, token(req));
    res.json({ status: orders.deleteData(order) });
  }));
  app.get("/api/web/orders/:id", handle(async (req, res) => {
    const order = orders.authorize(req.params.id, token(req));
    res.json({ status: orders.statusFor(order) });
  }));
  app.get("/api/web/orders/:id/reports/:report", handle(async (req, res) => {
    const order = orders.authorize(req.params.id, token(req));
    const { file, name } = orders.reportFile(order, req.params.report);
    res.setHeader("Cache-Control", "no-store");
    res.download(file, name);
  }));

  const timer = setInterval(() => { try { orders.prune(); } catch (e) { console.error("WEB ORDERS prune:", e?.message || e); } }, 3600_000);
  timer.unref?.();
  return orders;
}

module.exports = { installWebOrders, createWebOrders, publicConfig, allowedServices, isWebUserId, isWebFileId,
  plainText, WEB_UID_BASE, MAX_UPLOAD_BYTES };
