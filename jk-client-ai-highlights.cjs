"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { spawn } = require("child_process");
const { validateBundle, highlightFileName } = require("./jk-low-ai-review.cjs");
const QUOTE_MS = 30 * 60 * 1000;
const token = () => crypto.randomBytes(12).toString("hex");
const idOf = file => /^trn:oid:::1:([1-9]\d{9})$/.exec(String(file?.jkSubmissionId || ""))?.[1];
function price(env = process.env) {
  const n = Number(env.AI_HIGHLIGHTS_PRICE_KES ?? 50);
  return Number.isSafeInteger(n) && n > 0 && n <= 100000 ? n : null;
}
function phone(raw) {
  const value = String(raw || "").replace(/[\s+()-]/g, "");
  if (/^0[17]\d{8}$/.test(value)) return "254" + value.slice(1);
  return /^254[17]\d{8}$/.test(value) ? value : null;
}
function pdfExists(filename) {
  if (!filename || !fs.existsSync(filename)) return false;
  const fd = fs.openSync(filename, "r");
  try { const b = Buffer.alloc(5); return fs.readSync(fd, b, 0, 5, 0) === 5 && b.toString() === "%PDF-"; }
  finally { fs.closeSync(fd); }
}
function atomic(filename, value) {
  const temporary = filename + ".tmp-" + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, filename);
}
function hasProtectedPurchase(dataDir, directory, now = Date.now()) {
  const filename = path.join(dataDir, "aiHighlightsPurchases.store.json");
  if (!fs.existsSync(filename)) return false;
  const store = JSON.parse(fs.readFileSync(filename, "utf8"));
  return Object.values(store.records || {}).some(r => path.dirname(r.bundlePath || "") === directory && (
    ["SUBMITTING", "PENDING", "UNCERTAIN", "REVIEW", "PAID"].includes(r.status) ||
    (["PREPARING", "READY_TO_PAY", "WAIT_PHONE"].includes(r.status) && now < r.quoteExpires)
  ));
}
function prepareChild(bundlePath, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "jk-build-client-ai-highlights.cjs"),
      "--bundle", bundlePath, "--output", outputPath], { stdio: ["ignore", "ignore", "pipe"], shell: false });
    let detail = "";
    child.stderr.on("data", chunk => { detail = (detail + chunk.toString()).slice(-1000); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(detail || "PDF preparation failed.")));
  });
}
async function timed(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Payment gateway request timed out.")), 30000);
  })]); } finally { clearTimeout(timer); }
}

function createService(deps) {
  const now = deps.now || Date.now;
  const dataDir = path.resolve(deps.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const storePath = path.join(dataDir, "aiHighlightsPurchases.store.json");
  const store = fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, "utf8")) : { version: 1, records: {} };
  if (store.version !== 1 || !store.records || Array.isArray(store.records)) throw new Error("Invalid AI highlights purchase store.");
  const records = store.records, busy = new Set();
  const prepare = deps.prepare || prepareChild;
  let preparationSlots = 2;
  const preparationQueue = [];
  async function prepareLimited(input, output) {
    if (preparationSlots) preparationSlots--;
    else await new Promise(resolve => preparationQueue.push(resolve));
    try { await prepare(input, output); }
    finally {
      const next = preparationQueue.shift();
      if (next) next(); else preparationSlots++;
    }
  }
  const getPrice = () => price(deps.env || process.env);
  const configured = () => getPrice() !== null && (!deps.configured || deps.configured());
  const save = () => atomic(storePath, store);
  const msg = (userId, text, extra) => deps.telegram.sendMessage(userId, text, extra);
  const recordFor = (userId, id) => Object.values(records).find(r => r.userId === Number(userId) && r.id === id);
  const owned = (ctx, r) => r && Number(ctx.from?.id) === r.userId && Number(ctx.chat?.id) === r.userId;
  const buttons = r => {
    const rows = [];
    if (r.paidAt) rows.push([{ text: "DOWNLOAD AGAIN", callback_data: "PAHC:" + r.token }]);
    else if (r.status === "READY_TO_PAY") rows.push([{ text: "PAY WITH M-PESA - KES " + r.amount, callback_data: "PAHP:" + r.token }]);
    else if (["PENDING", "UNCERTAIN", "REVIEW"].includes(r.status)) rows.push([{ text: "CHECK PAYMENT", callback_data: "PAHC:" + r.token }]);
    if (["READY_TO_PAY", "WAIT_PHONE", "OFFERED"].includes(r.status)) rows.push([{ text: "CANCEL", callback_data: "PAHX:" + r.token }]);
    return { reply_markup: { inline_keyboard: rows } };
  };
  async function stateMessage(r, text) {
    const sent = await msg(r.userId, text, buttons(r));
    r.statusMessageId = sent?.message_id || r.statusMessageId; save();
  }
  function source(userId, id) {
    const found = [];
    for (const job of Object.values(deps.getJobs() || {})) {
      if (Number(job.userId) !== Number(userId)) continue;
      for (const file of job.files || []) if (idOf(file) === id) found.push(file);
    }
    if (found.length !== 1 || !found[0].apiAiDeliveredAt) return null;
    const file = found[0];
    try {
      if (!path.isAbsolute(file.providerBundleFile || "")) return null;
      const bundle = JSON.parse(fs.readFileSync(file.providerBundleFile, "utf8"));
      if (bundle.reportIdentity?.jkSubmissionId !== file.jkSubmissionId) return null;
      validateBundle(bundle);
      return { bundlePath: file.providerBundleFile, name: bundle.reportIdentity.filename || file.file_name || "Document",
        outputName: highlightFileName(bundle) };
    } catch { return null; }
  }
  function deliveryOffer(job) {
    if (!configured() || Number(job.userId) === Number(deps.adminId)) return { text: "", replyMarkup: { inline_keyboard: [] } };
    const rows = [], seen = new Set();
    for (const file of job.files || []) {
      const id = idOf(file);
      if (!id || seen.has(id) || !source(job.userId, id)) continue;
      seen.add(id);
      rows.push([{ text: "GET AI HIGHLIGHTS - KES " + getPrice() + " - " + String(file.file_name || "Document").slice(0, 45),
        callback_data: "PAHL:" + id }]);
    }
    return { text: rows.length ? "\n\nYour AI report displays *% because the result is below 20%. AI HIGHLIGHTS <b>MAY</b> be available for KES " + getPrice() + ". Select a document below to check availability." : "",
      replyMarkup: { inline_keyboard: rows } };
  }
  async function notifyReview(r, reason) {
    r.status = "REVIEW"; r.reviewReason = reason; save();
    if (!r.reviewNotified) {
      await msg(deps.adminId, "AI HIGHLIGHTS payment needs review\nUser: " + r.userId + "\nFile: " + r.name + "\nReason: " + reason);
      r.reviewNotified = true; save();
    }
  }
  async function deliver(r) {
    if (!r.paidAt) throw new Error("Payment has not been verified.");
    if (!r.fileId && !pdfExists(r.outputPath)) return notifyReview(r, "Paid highlights PDF is missing; payment retained for manual handling.");
    const document = r.fileId || { source: fs.createReadStream(r.outputPath), filename: r.outputName };
    let sent;
    try { sent = await deps.telegram.sendDocument(r.userId, document); }
    finally { if (typeof document === "object") document.source.destroy(); }
    r.fileId = sent.document?.file_id || r.fileId || null;
    r.status = "DELIVERED"; r.deliveredAt = r.deliveredAt || now(); r.lastDownloadAt = now(); r.deliveryError = null; save();
    if (r.statusMessageId && deps.telegram.editMessageReplyMarkup) {
      try { await deps.telegram.editMessageReplyMarkup(r.userId, r.statusMessageId, undefined, buttons(r).reply_markup); }
      catch (error) { console.error("AI highlights download button update failed:", error.message); }
    }
    if (!r.adminNotified) {
      try {
        await msg(deps.adminId, "AI HIGHLIGHTS paid and delivered\nUser: " + r.userId + "\nFile: " + r.name + "\nAmount: KES " + r.amount);
        r.adminNotified = true; save();
      } catch (error) { console.error("AI highlights admin receipt notice failed:", error.message); }
    }
  }
  async function verify(r, feedback = false) {
    if (r.paidAt) { if (r.status !== "DELIVERED" || feedback) await deliver(r); return; }
    const attempt = r.attempts?.[r.attempts.length - 1];
    if (!attempt) { if (feedback) await msg(r.userId, "No payment request has been sent. Click the AI HIGHLIGHTS button to continue."); return; }
    if (r.status === "REVIEW") { if (feedback) await msg(r.userId, "This payment needs customer support assistance. No additional payment is required."); return; }
    if (!attempt.invoiceId) {
      const response = await timed(deps.listInvoices(attempt.apiRef));
      const values = Array.isArray(response) ? response : response?.results || response?.data || response?.invoices || [];
      const matched = (Array.isArray(values) ? values : []).filter(i => String(i.api_ref || "") === attempt.apiRef);
      if (matched.length > 1) return notifyReview(r, "More than one invoice matches the same purchase attempt.");
      if (!matched.length) { r.status = "UNCERTAIN"; save(); if (feedback) await msg(r.userId, "The payment request is still being checked. Do not pay again yet.", buttons(r)); return; }
      attempt.invoiceId = matched[0].invoice_id || matched[0].id;
      if (!attempt.invoiceId) return notifyReview(r, "Invoice lookup did not return an invoice ID.");
      save();
    }
    const response = await timed(deps.checkPayment(attempt.invoiceId));
    const invoice = response?.invoice || response?.data?.invoice || response;
    if (String(invoice?.invoice_id || "") !== String(attempt.invoiceId) || invoice?.api_ref !== attempt.apiRef ||
        String(invoice?.currency || "").toUpperCase() !== "KES" ||
        invoice?.value === null || invoice?.value === undefined || Number(invoice.value) !== attempt.amount ||
        phone(invoice.account) !== attempt.phone) {
      return notifyReview(r, "Invoice ID, reference, amount, currency or payer did not match the purchase.");
    }
    const state = String(invoice.state || "").toUpperCase();
    attempt.lastState = state; attempt.checkedAt = now(); save();
    if (state === "COMPLETE") {
      r.status = "PAID"; r.paidAt = now(); r.amount = attempt.amount;
      r.receipt = invoice.provider_ref || invoice.mpesa_reference || null; save();
      await deliver(r);
    } else if (["FAILED", "CANCELED", "CANCELLED", "EXPIRED"].includes(state)) {
      r.status = "FAILED"; save();
      if (!attempt.failureNotified) {
        await msg(r.userId, "The AI HIGHLIGHTS payment was not completed. You can click the original AI HIGHLIGHTS button to try again.");
        attempt.failureNotified = true; save();
      }
    } else {
      r.status = "PENDING"; save();
      if (feedback) await msg(r.userId, "Payment is still pending. Complete the M-Pesa prompt on your phone.", buttons(r));
    }
  }
  async function exclusive(r, task) {
    if (busy.has(r.token)) return false;
    busy.add(r.token);
    try { await task(); return true; }
    finally { busy.delete(r.token); }
  }
  function background(r, task) {
    void exclusive(r, task).catch(async error => {
      console.error("Client AI HIGHLIGHTS:", error.message);
      if (r.paidAt && r.status !== "REVIEW") { r.status = "PAID"; r.deliveryError = error.message; save(); }
      await msg(r.userId, r.paidAt
        ? "Your payment is confirmed. PDF delivery is being retried; no further payment is needed."
        : "AI HIGHLIGHTS could not complete this step. Try the available button or contact customer support.", buttons(r));
    }).catch(error => console.error("AI highlights status message failed:", error.message));
  }
  function cancelPhone(userId) {
    for (const r of Object.values(records)) {
      if (r.userId === Number(userId) && r.status === "WAIT_PHONE") r.status = "OFFERED";
    }
    save();
  }
  async function preparePurchase(r) {
    try {
      if (!pdfExists(r.outputPath)) await prepareLimited(r.bundlePath, r.outputPath);
      if (!pdfExists(r.outputPath)) throw new Error("Generated PDF is invalid.");
      cancelPhone(r.userId);
      r.status = "READY_TO_PAY"; save();
      await stateMessage(r, "AI HIGHLIGHTS are available.\nFile: " + r.name + "\nPrice: KES " + r.amount + "\n\nTap PAY WITH M-PESA to continue.");
    } catch (error) {
      r.status = "OFFERED"; r.preparationError = error.message; save();
      await msg(r.userId, "AI HIGHLIGHTS are unavailable for this document right now. No payment request was sent. Contact customer support.");
    }
  }
  async function buy(ctx, id) {
    const userId = Number(ctx.from?.id);
    if (Number(ctx.chat?.id) !== userId) return ctx.answerCbQuery("Open the bot in your private chat.");
    if (userId === Number(deps.adminId)) return ctx.answerCbQuery("Admin highlights remain free. Use /aihighlights.");
    let r = recordFor(userId, id);
    if (r?.paidAt) { await ctx.answerCbQuery("Sending your purchased PDF."); background(r, () => deliver(r)); return; }
    if (!configured()) return ctx.answerCbQuery("AI HIGHLIGHTS purchases are currently unavailable.");
    if (r && ["SUBMITTING", "PENDING", "UNCERTAIN", "REVIEW"].includes(r.status)) {
      await ctx.answerCbQuery("Checking your existing payment; no new request."); background(r, () => verify(r, true)); return;
    }
    if (r && busy.has(r.token)) return ctx.answerCbQuery("Your PDF is already being prepared.");
    if (deps.userBusy?.(userId)) return ctx.answerCbQuery("Finish or cancel your current document submission first.");
    const item = source(userId, id);
    if (!item) return ctx.answerCbQuery("Saved highlights are unavailable or expired. No payment requested.");
    if (!r) {
      r = { token: token(), id, userId, createdAt: now(), attempts: [] };
      records[r.token] = r;
    }
    cancelPhone(userId);
    Object.assign(r, item, { amount: getPrice(), quoteExpires: now() + QUOTE_MS, status: "PREPARING" });
    r.outputPath = path.join(path.dirname(r.bundlePath), "client-ai-highlights-" + r.token, r.outputName); save();
    await ctx.answerCbQuery("Checking availability and preparing your PDF.");
    background(r, () => preparePurchase(r));
  }
  async function pay(ctx, r) {
    if (!owned(ctx, r)) return ctx.answerCbQuery("This purchase belongs to another user.");
    if (r.paidAt) { await ctx.answerCbQuery("Sending your purchased PDF."); background(r, () => deliver(r)); return; }
    if (["SUBMITTING", "PENDING", "UNCERTAIN", "REVIEW"].includes(r.status)) {
      await ctx.answerCbQuery("Checking your existing payment; no new request."); background(r, () => verify(r, true)); return;
    }
    if (busy.has(r.token)) return ctx.answerCbQuery("Please wait for the current step.");
    if (!["READY_TO_PAY", "WAIT_PHONE"].includes(r.status)) return ctx.answerCbQuery("Click GET AI HIGHLIGHTS to check availability again.");
    if (now() >= r.quoteExpires || !pdfExists(r.outputPath)) {
      r.status = "OFFERED"; save(); return ctx.answerCbQuery("This offer has expired. Click GET AI HIGHLIGHTS again.");
    }
    if (deps.configured && !deps.configured()) return ctx.answerCbQuery("Payments are currently unavailable.");
    if (deps.userBusy?.(r.userId)) return ctx.answerCbQuery("Finish or cancel your document submission first.");
    cancelPhone(r.userId); r.status = "WAIT_PHONE"; save();
    await ctx.answerCbQuery("Enter your M-Pesa phone number.");
    await stateMessage(r, "Enter your M-Pesa phone number (07XXXXXXXX or 01XXXXXXXX).");
  }
  async function handleText(ctx, text) {
    const r = Object.values(records).find(item => owned(ctx, item) && item.status === "WAIT_PHONE");
    if (!r) return false;
    if (busy.has(r.token)) { await msg(r.userId, "PDF preparation is finishing. Send your phone number again in a moment."); return true; }
    if (now() > r.quoteExpires) { r.status = "OFFERED"; save(); await msg(r.userId, "This price quote has expired. Click AI HIGHLIGHTS again to continue."); return true; }
    const number = phone(text);
    if (!number) { await stateMessage(r, "Enter your M-Pesa phone number (07XXXXXXXX or 01XXXXXXXX)."); return true; }
    if (!pdfExists(r.outputPath)) { r.status = "OFFERED"; save(); await msg(r.userId, "The prepared PDF is unavailable. No payment request was sent."); return true; }
    const attempt = { apiRef: "AIHL_" + token(), amount: r.amount, phone: number, createdAt: now(), invoiceId: null };
    r.attempts.push(attempt); r.status = "SUBMITTING"; save();
    await stateMessage(r, "Sending an M-Pesa payment request for KES " + r.amount + ".");
    background(r, async () => {
      try {
        const response = await timed(deps.sendStk({ amount: attempt.amount, phone_number: number, api_ref: attempt.apiRef }));
        const invoice = response?.invoice || response?.data?.invoice || response;
        attempt.invoiceId = invoice?.invoice_id || null;
        r.status = attempt.invoiceId ? "PENDING" : "UNCERTAIN"; save();
        await stateMessage(r, attempt.invoiceId ? "M-Pesa request sent. Enter your PIN on your phone. Your PDF will be delivered after payment is confirmed."
          : "The payment request is being checked. Do not request another payment yet.");
        await verify(r);
      } catch (error) {
        if (!r.paidAt) {
          r.status = [400, 401, 403, 422].includes(Number(error.status)) ? "FAILED" : "UNCERTAIN";
          r.gatewayError = error.message; save();
        }
        throw error;
      }
    });
    return true;
  }
  async function handleWebhook(payload) {
    const event = payload?.invoice || payload?.data?.invoice || payload;
    const ref = event?.api_ref || payload?.api_ref;
    const invoiceId = event?.invoice_id;
    const r = Object.values(records).find(item => item.attempts?.some(a => a.apiRef === ref || (invoiceId && a.invoiceId === invoiceId)));
    if (!r) return typeof ref === "string" && ref.startsWith("AIHL_");
    background(r, () => verify(r)); return true;
  }
  function register(bot) {
    bot.action(/^PAHL:([1-9]\d{9})$/, ctx => buy(ctx, ctx.match[1]));
    bot.action(/^PAH([PCX]):([a-f0-9]{24})$/, async ctx => {
      const r = records[ctx.match[2]];
      if (!owned(ctx, r)) return ctx.answerCbQuery("This purchase belongs to another user.");
      if (ctx.match[1] === "P") return pay(ctx, r);
      if (ctx.match[1] === "X") {
        if (["READY_TO_PAY", "WAIT_PHONE", "OFFERED"].includes(r.status)) {
          r.status = "OFFERED"; save(); await ctx.answerCbQuery("Cancelled. No payment request sent.");
          return msg(r.userId, "AI HIGHLIGHTS purchase cancelled.");
        }
        return ctx.answerCbQuery("Cancel the M-Pesa prompt on your phone. Existing payments will still be checked.");
      }
      await ctx.answerCbQuery("Checking your payment."); background(r, () => verify(r, true));
    });
  }
  let timer;
  async function tick() {
    for (const r of Object.values(records)) {
      if (["PREPARING", "READY_TO_PAY", "WAIT_PHONE"].includes(r.status) && now() > r.quoteExpires) { r.status = "OFFERED"; save(); }
      if (!["SUBMITTING", "UNCERTAIN", "PENDING", "PAID"].includes(r.status) || busy.has(r.token)) continue;
      const cadence = now() - (r.attempts?.at(-1)?.createdAt || now()) < 15 * 60 * 1000 ? 15000 : 5 * 60 * 1000;
      if (now() - (r.lastPollAt || 0) < cadence) continue;
      r.lastPollAt = now(); save();
      // Failures remain persisted and are retried by the next scheduler pass.
      void exclusive(r, () => verify(r)).catch(error => console.error("AI highlights payment/delivery retry:", error.message));
    }
  }
  function start() {
    if (timer) return;
    for (const r of Object.values(records)) {
      if (r.status === "PREPARING") r.status = "OFFERED";
      if (r.status === "SUBMITTING") r.status = "UNCERTAIN";
    }
    save(); void tick(); timer = setInterval(() => void tick(), 15000); timer.unref?.();
  }
  return { deliveryOffer, buy, pay, handleText, handleWebhook, register, start, tick, cancelPhone,
    stop: () => { clearInterval(timer); timer = null; }, records, verify, source };
}
module.exports = { createService, price, phone, hasProtectedPurchase };
