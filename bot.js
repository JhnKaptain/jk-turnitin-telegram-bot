require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const moment = require("moment");
const qs = require("querystring");

// =====================
// ENV + CONSTANTS
// =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing");
  process.exit(1);
}

function sanitizeBaseUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  u = u.replace(/\/+$/, "");
  if (u.startsWith("http://")) u = "https://" + u.slice("http://".length);
  if (!u.startsWith("https://")) return "";
  return u;
}

const PUBLIC_BASE_URL = sanitizeBaseUrl(
  process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || ""
);

if (!PUBLIC_BASE_URL) {
  console.error("❌ PUBLIC_BASE_URL is missing/invalid.");
  console.error("✅ Set Render env: PUBLIC_BASE_URL=https://<your-service>.onrender.com");
  process.exit(1);
}

const INTASEND_WEBHOOK_CHALLENGE = process.env.INTASEND_WEBHOOK_CHALLENGE || "";

const INTASEND_TEST =
  String(process.env.INTASEND_TEST_ENVIRONMENT || "true").toLowerCase() === "true";

const INTASEND_PUBLISHABLE_KEY = INTASEND_TEST
  ? process.env.INTASEND_TEST_PUBLISHABLE_KEY || ""
  : process.env.INTASEND_LIVE_PUBLISHABLE_KEY || "";

const INTASEND_SECRET_KEY = INTASEND_TEST
  ? process.env.INTASEND_TEST_SECRET_KEY || ""
  : process.env.INTASEND_LIVE_SECRET_KEY || "";

if (!INTASEND_PUBLISHABLE_KEY || !INTASEND_SECRET_KEY) {
  console.error("❌ Missing IntaSend keys for the selected environment.");
  console.error(`INTASEND_TEST_ENVIRONMENT=${INTASEND_TEST}`);
  console.error(
    INTASEND_TEST
      ? "Need: INTASEND_TEST_PUBLISHABLE_KEY and INTASEND_TEST_SECRET_KEY"
      : "Need: INTASEND_LIVE_PUBLISHABLE_KEY and INTASEND_LIVE_SECRET_KEY"
  );
  process.exit(1);
}

// =====================
// INTASEND DIRECT API CONFIG (replaces intasend-node SDK)
// =====================
const INTASEND_BASE_URL = INTASEND_TEST
  ? "https://sandbox.intasend.com"
  : "https://payment.intasend.com";

function intasendHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${INTASEND_SECRET_KEY}`,
    "X-IntaSend-Public-API-Key": INTASEND_PUBLISHABLE_KEY
  };
}

/**
 * Direct STK Push via IntaSend REST API
 */
async function intasendStkPush({ first_name, last_name, email, host, amount, phone_number, api_ref }) {
  const url = `${INTASEND_BASE_URL}/api/v1/payment/mpesa-stk-push/`;

  const body = {
    first_name,
    last_name,
    email,
    host,
    amount: Number(amount),
    phone_number: String(phone_number),
    api_ref,
    wallet_id: null
  };

  console.log(`[IntaSend STK] POST ${url} | api_ref=${api_ref} | phone=${phone_number} | amount=${amount}`);

  const resp = await fetch(url, {
    method: "POST",
    headers: intasendHeaders(),
    body: JSON.stringify(body)
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    const errMsg = data?.errors
      ? JSON.stringify(data)
      : `HTTP ${resp.status}: ${text.slice(0, 500)}`;
    const err = new Error(errMsg);
    err.status = resp.status;
    err.responseData = data;
    throw err;
  }

  return data;
}

/**
 * Direct invoice status check via IntaSend REST API
 * Docs: POST /api/v1/payment/status/ with { invoice_id } in body
 */
async function intasendCheckStatus(invoiceId) {
  const url = `${INTASEND_BASE_URL}/api/v1/payment/status/`;

  console.log(`[IntaSend Status] POST ${url} | invoice_id=${invoiceId}`);

  const resp = await fetch(url, {
    method: "POST",
    headers: intasendHeaders(),
    body: JSON.stringify({ invoice_id: invoiceId })
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    const errMsg = `HTTP ${resp.status}: ${text.slice(0, 500)}`;
    const err = new Error(errMsg);
    err.status = resp.status;
    err.responseData = data;
    throw err;
  }

  return data;
}

const ADMIN_ID = 6569201830;
const MAX_BATCH_FILES = 5;

// =====================
// ENV OVERRIDES (PRICING + INACTIVE WINDOW)
// =====================
function readIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function normalizeHHMM(value, fallback) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;

  const hh = Number(m[1]);
  const mm = Number(m[2]);

  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return fallback;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function eatHHMMToUtc(hhmm) {
  const s = normalizeHHMM(hhmm, null);
  if (!s) return null;

  let [hh, mm] = s.split(":").map(Number);
  hh = (hh - 3 + 24) % 24;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const CHECK_PRICE_KES = readIntEnv("CHECK_PRICE_KES", 135);
const RECHECK_PRICE_KES = readIntEnv("RECHECK_PRICE_KES", 130);
const TILL_NUMBER = "6164915";

const INACTIVE_START_UTC = normalizeHHMM(
  process.env.INACTIVE_START_UTC,
  eatHHMMToUtc(process.env.INACTIVE_START_EAT) || "21:00"
);

const INACTIVE_END_UTC = normalizeHHMM(
  process.env.INACTIVE_END_UTC,
  eatHHMMToUtc(process.env.INACTIVE_END_EAT) || "03:00"
);

// =====================
// UI / STAGES / LIMITS
// =====================
const KEY_SEND_DOC = "📄 Send Document";
const KEY_SEND_MPESA = "🧾 Payment Help";
const KEY_CANCEL = "❌ Cancel / New submission";

const STAGE_WAIT_BATCH_SIZE = "WAIT_BATCH_SIZE";
const STAGE_WAIT_UPLOADS = "WAIT_UPLOADS";
const STAGE_WAIT_FILE_TYPE = "WAIT_FILE_TYPE";
const STAGE_WAIT_PHONE = "WAIT_PHONE";
const STAGE_WAIT_PAYMENT = "WAIT_PAYMENT";
const STAGE_PAID = "PAID";

const STK_RESEND_COOLDOWN_MS = 30 * 1000;
const STK_MAX_RESENDS = 3;
const PAYMENT_TIMEOUT_MS = 6 * 60 * 1000;

const REPORTS_DELIVERED_MESSAGE =
  "✅ Your Turnitin reports are ready. Thank you for choosing JK Turnitin.";

// =====================
// MESSAGES
// =====================
const MESSAGES = {
  welcome: (check, recheck) => `
JK Turnitin Reports Bot

1️⃣ Tap *Send Document*
2️⃣ Choose how many files you want to upload (1-${MAX_BATCH_FILES})
3️⃣ Upload your files one by one as *documents*
4️⃣ Choose *CHECK* or *RECHECK* for each file
5️⃣ Pay *once* for the whole batch

💰 Pricing
• Check: ${check} KES
• Recheck: ${recheck} KES
`,

  inactive: `
⏳ Turnitin checks are paused right now.
We'll resume at *6:00 AM EAT*.

✅ You can still send your document now — it will be received.
⚠️ Payment prompts will only be sent after 6:00 AM.

If urgent, WhatsApp call *0701730921*.
`,

  sendDocHelp: `📄 Tap *Send Document* first, choose *1-${MAX_BATCH_FILES}* files, then upload your files one by one as *documents* (DOC/PDF).\n\nPlease don't send as a photo.`,

  paymentHelp:
    "🧾 Payment help:\n\n✅ Default method: *STK Push*\nChoose your batch size → upload files → choose Check/Recheck for each file → enter phone number → receive *one combined STK prompt*.\n\nIf prompt delays/fails, tap *Resend STK Push*.",

  askPhoneBatch: (summary, amount) =>
    `📦 Batch summary\n\n${summary}\n\n💰 Total: *${amount} KES*\n\nSend phone number (07XXXXXXXX / 01XXXXXXXX / 2547XXXXXXXX / 2541XXXXXXXX).`,

  stkSending: "⏳ Sending STK Push… check your phone and enter PIN.",
  stkSentSimple: "✅ STK Push sent. Pay on your phone — confirmation is automatic.",

  stkSentWithTill: (till) =>
    `✅ STK Push sent. Pay on your phone — confirmation is automatic.\n\nIf prompt fails, pay via Till:\n\`\`\`\n${till}\n\`\`\`\nSend proof here as screenshot not text.`,

  waitingConfirm: "Waiting for payment confirmation…",

  paidMsgBatch: (amount, summary) =>
    `✅ Payment confirmed (${amount} KES).\n\n${summary}\n\n⏱ Reports take *5–20 minutes* (queue).`
};

// =====================
// BOT + STATE
// =====================
const bot = new Telegraf(BOT_TOKEN);

// userId -> submission state
const submissions = {};

// admin batch delivery session
// pendingFileTargets[ADMIN_ID] = { userId, caption, sentCount }
const pendingFileTargets = {};

// paymentRefs[api_ref] = { userId, kind, amount, createdAt, summary, invoice_id, ... }
let paymentRefs = {};
const confirmedRefs = new Set();

// =====================
// PERSISTENCE
// =====================
const STORE_FILE = path.join(__dirname, "paymentRefs.store.json");

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        paymentRefs = parsed;
      }
    }
  } catch (e) {
    console.error("⚠️ Failed to load store:", e?.message || e);
  }
}

function saveStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(paymentRefs, null, 2), "utf8");
  } catch (e) {
    console.error("⚠️ Failed to save store:", e?.message || e);
  }
}

function putPaymentRef(api_ref, value) {
  paymentRefs[api_ref] = {
    ...value,
    api_ref
  };
  saveStore();
}

function updatePaymentRef(api_ref, patch) {
  if (!api_ref || !paymentRefs[api_ref]) return;
  paymentRefs[api_ref] = {
    ...paymentRefs[api_ref],
    ...patch
  };
  saveStore();
}

function getPaymentRef(api_ref) {
  return paymentRefs[api_ref] || null;
}

function getPaymentRefByInvoiceId(invoiceId) {
  if (!invoiceId) return null;

  for (const value of Object.values(paymentRefs)) {
    if (value?.invoice_id === invoiceId) return value;
  }
  return null;
}

/**
 * IntaSend webhooks strip underscores from api_ref values.
 * e.g. "JK_BATCH_123_456" becomes "JKBATCH123456"
 * This does a fuzzy match by comparing with underscores removed.
 */
function getPaymentRefByApiRefFuzzy(webhookApiRef) {
  if (!webhookApiRef) return null;

  const normalized = String(webhookApiRef).replace(/_/g, "");

  for (const value of Object.values(paymentRefs)) {
    if (!value?.api_ref) continue;
    const storedNormalized = String(value.api_ref).replace(/_/g, "");
    if (storedNormalized === normalized) return value;
  }
  return null;
}

loadStore();

setInterval(() => {
  const now = Date.now();
  const cutoff = 7 * 24 * 60 * 60 * 1000;
  let changed = false;

  for (const [k, v] of Object.entries(paymentRefs)) {
    if (v?.createdAt && now - v.createdAt > cutoff) {
      delete paymentRefs[k];
      changed = true;
    }
  }

  if (changed) saveStore();
}, 6 * 60 * 60 * 1000);

// =====================
// HELPERS
// =====================
function isTimeInWindowUTC(currentHHMM, startHHMM, endHHMM) {
  if (startHHMM < endHHMM) {
    return currentHHMM >= startHHMM && currentHHMM < endHHMM;
  }
  return currentHHMM >= startHHMM || currentHHMM < endHHMM;
}

function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm");
  return isTimeInWindowUTC(currentTime, INACTIVE_START_UTC, INACTIVE_END_UTC);
}

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: KEY_SEND_DOC }],
      [{ text: KEY_SEND_MPESA }],
      [{ text: KEY_CANCEL }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

async function replyMarkdownSafe(ctx, message, extra = {}) {
  try {
    await ctx.reply(message, { parse_mode: "Markdown", ...extra });
  } catch {
    await ctx.reply(message, { ...extra });
  }
}

function safeText(s) {
  return (s || "").toString();
}

function truncateText(s, max = 3000) {
  const text = safeText(s);
  if (text.length <= max) return text;
  return text.slice(0, max) + " ...[truncated]";
}

async function sendAdminMessage(text, extra = {}) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text, {
      parse_mode: "Markdown",
      ...extra
    });
  } catch (e) {
    try {
      await bot.telegram.sendMessage(ADMIN_ID, text, extra);
    } catch (e2) {
      console.error("Admin message failed:", e2?.message || e2);
    }
  }
}

function adminQuickCommands(userId) {
  return `\n\n\`/filebatch ${userId}\`\n\`/reply ${userId}\``;
}

function normalizePhoneTo254(phoneRaw) {
  const t = String(phoneRaw || "")
    .trim()
    .replace(/\s+/g, "");

  if (!t) return null;

  if (t.startsWith("+")) {
    const x = t.slice(1);
    if (/^254(?:7|1)\d{8}$/.test(x)) return x;
    return null;
  }

  if (/^254(?:7|1)\d{8}$/.test(t)) return t;
  if (/^0(?:7|1)\d{8}$/.test(t)) return "254" + t.slice(1);
  if (/^(?:7|1)\d{8}$/.test(t)) return "254" + t;

  return null;
}

function makeApiRef(userId, kind) {
  return `JK_${kind}_${userId}_${Date.now()}`;
}

function createEmptySubmission() {
  return {
    stage: STAGE_WAIT_BATCH_SIZE,
    expectedFiles: null,
    files: [],
    currentFileIndex: null,
    amount: null,
    api_ref: null,
    invoice_id: null,
    collection_id: null,   // full UUID for status polling
    phone: null,
    paid: false,
    createdAt: Date.now(),
    stkSentAt: null,
    resendCount: 0
  };
}

function batchSizeKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("1", "BATCH_COUNT_1"),
      Markup.button.callback("2", "BATCH_COUNT_2"),
      Markup.button.callback("3", "BATCH_COUNT_3")
    ],
    [
      Markup.button.callback("4", "BATCH_COUNT_4"),
      Markup.button.callback("5", "BATCH_COUNT_5")
    ],
    [Markup.button.callback("❌ Cancel", "TYPE_CANCEL")]
  ]);
}

function typeInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`✅ CHECK (${CHECK_PRICE_KES} KES)`, "TYPE_CHECK")],
    [Markup.button.callback(`🔁 RECHECK (${RECHECK_PRICE_KES} KES)`, "TYPE_RECHECK")],
    [Markup.button.callback("❌ Cancel", "TYPE_CANCEL")]
  ]);
}

function uploadContinueKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Done Uploading", "DONE_UPLOADING")],
    [Markup.button.callback("❌ Cancel", "TYPE_CANCEL")]
  ]);
}

function paymentWaitKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔁 Resend STK Push", "STK_RESEND")],
    [Markup.button.callback("📞 Change phone number", "STK_CHANGE_PHONE")],
    [Markup.button.callback("❌ Cancel", "TYPE_CANCEL")]
  ]);
}

async function notifyInactivePeriod(ctx) {
  await replyMarkdownSafe(ctx, MESSAGES.inactive.trim(), {
    reply_markup: mainKeyboard()
  });
}

function getCurrentPendingFile(sub) {
  if (!sub) return null;
  if (sub.currentFileIndex === null || sub.currentFileIndex === undefined) return null;
  return sub.files[sub.currentFileIndex] || null;
}

function getSubmissionCounts(sub) {
  let checks = 0;
  let rechecks = 0;

  for (const file of sub.files || []) {
    if (file.type === "CHECK") checks += 1;
    if (file.type === "RECHECK") rechecks += 1;
  }

  return {
    checks,
    rechecks,
    total: checks + rechecks
  };
}

function calculateSubmissionAmount(sub) {
  const counts = getSubmissionCounts(sub);
  return counts.checks * CHECK_PRICE_KES + counts.rechecks * RECHECK_PRICE_KES;
}

function formatBatchSummary(sub) {
  const counts = getSubmissionCounts(sub);

  return [
    `• Check: ${counts.checks}`,
    `• Recheck: ${counts.rechecks}`,
    `• Files: ${counts.total}`
  ].join("\n");
}

function getBatchKindLabel(sub) {
  const counts = getSubmissionCounts(sub);
  return `${counts.checks} CHECK, ${counts.rechecks} RECHECK`;
}

function resetSubmission(userId) {
  delete submissions[userId];
}

async function notifyUserCancelledToAdmin(user) {
  if (user.id === ADMIN_ID) return;

  await sendAdminMessage(
    `❌ User cancelled submission
User ID: ${user.id}
Username: @${safeText(user.username || "N/A")}
Name: ${safeText(user.first_name)} ${safeText(user.last_name)}${adminQuickCommands(user.id)}`
  );
}

function canAcceptMoreFiles(sub) {
  return sub.files.length < (sub.expectedFiles || 0);
}

async function askForFileType(ctx, sub) {
  const file = getCurrentPendingFile(sub);
  if (!file) return;

  const fileNumber = sub.currentFileIndex + 1;

  await ctx.reply(
    `📄 File Received: *${safeText(file.file_name)}*\n\nFile *${fileNumber}* of *${sub.expectedFiles}*.\nClick on the Respective Button Below for Check or Recheck.`,
    {
      parse_mode: "Markdown",
      reply_markup: typeInlineKeyboard().reply_markup
    }
  );
}

async function moveBatchToPhoneStep(ctx, sub) {
  const counts = getSubmissionCounts(sub);

  if (counts.total === 0) {
    await ctx.reply("❌ Please upload at least one file first.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  sub.amount = calculateSubmissionAmount(sub);
  sub.api_ref = makeApiRef(ctx.from.id, "BATCH");
  sub.stage = STAGE_WAIT_PHONE;
  sub.currentFileIndex = null;
  sub.invoice_id = null;

  const summary = formatBatchSummary(sub);

  putPaymentRef(sub.api_ref, {
    userId: ctx.from.id,
    kind: getBatchKindLabel(sub),
    amount: sub.amount,
    createdAt: Date.now(),
    summary,
    invoice_id: null,
    phone: null,
    last_state: "INITIATED",
    last_checked_at: null,
    last_webhook_at: null
  });

  await replyMarkdownSafe(ctx, MESSAGES.askPhoneBatch(summary, sub.amount), {
    reply_markup: mainKeyboard()
  });
}

async function handleFileTypeSelected(ctx, kind) {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (!sub || sub.stage !== STAGE_WAIT_FILE_TYPE) {
    return ctx.answerCbQuery("No pending file type selection.");
  }

  const file = getCurrentPendingFile(sub);
  if (!file) {
    sub.stage = STAGE_WAIT_UPLOADS;
    sub.currentFileIndex = null;
    return ctx.answerCbQuery("No pending file.");
  }

  file.type = kind;
  file.price = kind === "CHECK" ? CHECK_PRICE_KES : RECHECK_PRICE_KES;

  const justCompletedNumber = sub.currentFileIndex + 1;
  sub.currentFileIndex = null;

  await ctx.answerCbQuery(`${kind} selected`);

  if (sub.files.length >= sub.expectedFiles) {
    await moveBatchToPhoneStep(ctx, sub);
    return;
  }

  sub.stage = STAGE_WAIT_UPLOADS;

  await ctx.reply(
    `✅ ${kind} saved for file ${justCompletedNumber}.\n\nNow send file ${sub.files.length + 1} of ${sub.expectedFiles}.\nIf you are finished early, tap *Done Uploading*.`,
    {
      parse_mode: "Markdown",
      reply_markup: uploadContinueKeyboard().reply_markup
    }
  );
}

function schedulePaymentTimeoutReminder(userId, apiRef) {
  setTimeout(async () => {
    const sub = submissions[userId];
    if (!sub) return;
    if (sub.paid) return;
    if (sub.api_ref !== apiRef) return;
    if (sub.stage !== STAGE_WAIT_PAYMENT) return;

    try {
      await bot.telegram.sendMessage(
        userId,
        "⏳ Still waiting for payment confirmation.\n\nIf you did not receive the STK prompt, tap *Resend STK Push*.",
        {
          parse_mode: "Markdown",
          reply_markup: paymentWaitKeyboard().reply_markup
        }
      );
    } catch {}
  }, PAYMENT_TIMEOUT_MS);
}

// =====================
// INTASEND WEBHOOK / STATUS HELPERS
// =====================
function extractApiRef(payload) {
  return (
    payload.api_ref ||
    payload.apiRef ||
    payload.apiref ||          // IntaSend webhook sends lowercase
    payload.invoice?.api_ref ||
    payload.invoice?.apiRef ||
    payload.invoice?.apiref ||
    payload.data?.api_ref ||
    payload.data?.apiRef ||
    payload.data?.apiref ||
    payload.payload?.api_ref ||
    payload.payload?.apiRef ||
    payload.payload?.apiref
  );
}

function extractState(payload) {
  return (
    payload.state ||
    payload.status ||
    payload.invoice?.state ||
    payload.invoice?.status ||
    payload.data?.state ||
    payload.data?.status ||
    payload.payload?.state ||
    payload.payload?.status
  );
}

function normalizeWebhookState(raw) {
  const s = String(raw || "").trim().toUpperCase();

  if (["COMPLETE", "COMPLETED", "SUCCESS", "SUCCEEDED"].includes(s)) return "COMPLETE";
  if (["FAILED", "FAIL", "ERROR"].includes(s)) return "FAILED";
  if (["CANCELLED", "CANCELED"].includes(s)) return "CANCELLED";
  if (["EXPIRED", "TIMEOUT", "TIMEDOUT"].includes(s)) return "EXPIRED";
  if (["PENDING", "PROCESSING", "IN_PROGRESS", "INPROGRESS"].includes(s)) return "PENDING";

  return s || "UNKNOWN";
}

function extractInvoiceIdFromStkResponse(resp) {
  // IntaSend returns keys without underscores (e.g. invoiceid not invoice_id)
  // Prioritize the short invoice ID over the top-level UUID
  return (
    resp?.invoice_id ||
    resp?.invoiceid ||
    resp?.invoice?.invoice_id ||
    resp?.invoice?.invoiceid ||
    resp?.invoice?.id ||
    // Do NOT fall back to resp.id — that's the collection UUID, not the invoice ID
    null
  );
}

function extractInvoiceIdFromPayload(payload) {
  return (
    payload?.invoice_id ||
    payload?.invoiceid ||          // IntaSend webhook sends lowercase
    payload?.invoice?.invoice_id ||
    payload?.invoice?.invoiceid ||
    payload?.invoice?.id ||
    payload?.data?.invoice_id ||
    payload?.data?.invoiceid ||
    payload?.data?.invoice?.invoice_id ||
    payload?.payload?.invoice_id ||
    payload?.payload?.invoiceid ||
    payload?.payload?.invoice?.invoice_id ||
    null
  );
}

function extractInvoiceFromStatusResponse(resp) {
  return resp?.invoice || resp || {};
}

async function markPaymentComplete(ref, source, extra = {}) {
  if (!ref) return;

  const userId = ref.userId;
  const apiRef = ref.api_ref || ref.apiRef || extra.api_ref || null;
  const dedupeKey = apiRef || extra.invoice_id || `user_${userId}_complete`;

  if (confirmedRefs.has(dedupeKey)) return;
  confirmedRefs.add(dedupeKey);

  const sub = submissions[userId];
  if (sub && (!apiRef || sub.api_ref === apiRef)) {
    sub.paid = true;
    sub.stage = STAGE_PAID;
    if (extra.invoice_id) sub.invoice_id = extra.invoice_id;
  }

  if (apiRef) {
    updatePaymentRef(apiRef, {
      last_state: "COMPLETE",
      invoice_id: extra.invoice_id || ref.invoice_id || null,
      last_checked_at: Date.now()
    });
  }

  try {
    await bot.telegram.sendMessage(
      userId,
      MESSAGES.paidMsgBatch(ref.amount || "", ref.summary || "Batch payment"),
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    await sendAdminMessage(
      `❌ Could not message user ${userId}. Error: ${safeText(e?.message || e)}`
    );
  }

  await sendAdminMessage(
    `✅ PAYMENT COMPLETE (${source})
User: ${userId}
Type: ${ref.kind || "CHECK/RECHECK"}
Amount: ${ref.amount ? `${ref.amount} KES` : "N/A"}
api_ref: ${apiRef || "N/A"}
invoice_id: ${extra.invoice_id || ref.invoice_id || "N/A"}`
  );
}

async function markPaymentFailed(ref, state, source, extra = {}) {
  if (!ref) return;

  const userId = ref.userId;
  const apiRef = ref.api_ref || ref.apiRef || extra.api_ref || null;

  const sub = submissions[userId];
  if (sub && (!apiRef || sub.api_ref === apiRef)) {
    sub.paid = false;
    sub.stage = STAGE_WAIT_PAYMENT;
    if (extra.invoice_id) sub.invoice_id = extra.invoice_id;
  }

  if (apiRef) {
    updatePaymentRef(apiRef, {
      last_state: state,
      invoice_id: extra.invoice_id || ref.invoice_id || null,
      last_checked_at: Date.now()
    });
  }

  try {
    await bot.telegram.sendMessage(
      userId,
      `❌ Payment ${String(state).toLowerCase()}.\nTap *Resend STK Push* to try again.`,
      {
        parse_mode: "Markdown",
        reply_markup: paymentWaitKeyboard().reply_markup
      }
    );
  } catch (e) {
    await sendAdminMessage(
      `❌ Could not message user ${userId}. Error: ${safeText(e?.message || e)}`
    );
  }

  await sendAdminMessage(
    `⚠️ PAYMENT ${state} (${source})
User: ${userId}
Type: ${ref.kind || "CHECK/RECHECK"}
api_ref: ${apiRef || "N/A"}
invoice_id: ${extra.invoice_id || ref.invoice_id || "N/A"}`
  );
}

function scheduleInvoiceStatusPolling(userId, apiRef, collectionId, invoiceId) {
  if (!invoiceId) return;

  const delays = [15000, 30000, 60000, 120000, 180000];

  for (const delay of delays) {
    setTimeout(async () => {
      try {
        const sub = submissions[userId];
        if (!sub) return;
        if (sub.paid) return;
        if (sub.api_ref !== apiRef) return;

        // POST /api/v1/payment/status/ with invoice_id in body
        const resp = await intasendCheckStatus(invoiceId);
        const invoice = extractInvoiceFromStatusResponse(resp);
        const state = normalizeWebhookState(invoice?.state || resp?.state || resp?.status);
        const ref = getPaymentRef(apiRef) || getPaymentRefByInvoiceId(invoiceId);

        if (!ref) return;

        if (state === "COMPLETE") {
          updatePaymentRef(apiRef, {
            invoice_id: invoiceId,
            collection_id: collectionId,
            last_state: state,
            last_checked_at: Date.now()
          });

          await markPaymentComplete(ref, "status-poll", {
            invoice_id: invoiceId,
            api_ref: apiRef
          });
          return;
        }

        if (["FAILED", "CANCELLED", "EXPIRED"].includes(state)) {
          updatePaymentRef(apiRef, {
            invoice_id: invoiceId,
            collection_id: collectionId,
            last_state: state,
            last_checked_at: Date.now()
          });

          await markPaymentFailed(ref, state, "status-poll", {
            invoice_id: invoiceId,
            api_ref: apiRef
          });
          return;
        }

        updatePaymentRef(apiRef, {
          invoice_id: invoiceId,
          collection_id: collectionId,
          last_state: state,
          last_checked_at: Date.now()
        });
      } catch (err) {
        console.error(`[Status Poll Error] user=${userId} collection=${collectionId}:`, err?.message || err);
        await sendAdminMessage(
          `⚠️ Status poll error
User: ${userId}
api_ref: ${apiRef}
collection_id: ${collectionId}
invoice_id: ${invoiceId}
Error: ${safeText(err?.message || err)}`
        );
      }
    }, delay);
  }
}

// =====================
// STK PUSH
// =====================
async function attemptStkPush(ctx, sub, { mode }) {
  const userId = ctx.from.id;

  if (!sub?.phone || !sub?.api_ref || !sub?.amount) {
    sub.stage = STAGE_WAIT_PHONE;
    await ctx.reply("⚠️ Missing payment details. Please send your phone number again.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  if (mode === "resend" && sub.stkSentAt && Date.now() - sub.stkSentAt < STK_RESEND_COOLDOWN_MS) {
    const remainingMs = STK_RESEND_COOLDOWN_MS - (Date.now() - sub.stkSentAt);
    const remainingSec = Math.ceil(remainingMs / 1000);
    await ctx.answerCbQuery?.(`Wait ${remainingSec}s`);
    return;
  }

  if (mode === "resend") {
    sub.resendCount = (sub.resendCount || 0) + 1;

    if (sub.resendCount > STK_MAX_RESENDS) {
      await ctx.reply(
        `⚠️ Resend limit reached.\n\nPay via Till:\n\`\`\`\n${TILL_NUMBER}\n\`\`\`\nSend proof here.`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  }

  if (mode === "initial") {
    await ctx.reply(MESSAGES.stkSending);
  }

  try {
    // Direct API call instead of SDK
    const stkResp = await intasendStkPush({
      first_name: safeText(ctx.from.first_name || "Customer"),
      last_name: safeText(ctx.from.last_name || "User"),
      email: `${userId}@jkturnitin.local`,
      host: PUBLIC_BASE_URL,
      amount: sub.amount,
      phone_number: sub.phone,
      api_ref: sub.api_ref
    });

    const invoiceId = extractInvoiceIdFromStkResponse(stkResp);
    // The top-level 'id' is the collection UUID needed for status polling
    const collectionId = stkResp?.id || null;

    sub.stage = STAGE_WAIT_PAYMENT;
    sub.stkSentAt = Date.now();
    sub.invoice_id = invoiceId || null;
    sub.collection_id = collectionId || null;

    updatePaymentRef(sub.api_ref, {
      invoice_id: invoiceId || null,
      collection_id: collectionId || null,
      phone: sub.phone,
      amount: sub.amount,
      last_state: "PENDING",
      stk_response_received_at: Date.now()
    });

    await sendAdminMessage(
      `📥 STK PUSH RESPONSE
User: ${userId}
api_ref: ${sub.api_ref}
invoice_id: ${invoiceId || "N/A"}
collection_id: ${collectionId || "N/A"}
Amount: ${sub.amount} KES
Phone: ${sub.phone}
Mode: ${INTASEND_TEST ? "TEST" : "LIVE"}
Raw: ${truncateText(JSON.stringify(stkResp), 2500)}`
    );

    if (mode === "resend") {
      await ctx.reply(MESSAGES.stkSentWithTill(TILL_NUMBER), {
        parse_mode: "Markdown"
      });
    } else {
      await ctx.reply(MESSAGES.stkSentSimple);
    }

    await ctx.reply(MESSAGES.waitingConfirm, {
      reply_markup: paymentWaitKeyboard().reply_markup
    });

    schedulePaymentTimeoutReminder(userId, sub.api_ref);

    if (invoiceId) {
      scheduleInvoiceStatusPolling(userId, sub.api_ref, collectionId, invoiceId);
    } else {
      await sendAdminMessage(
        `⚠️ No invoice_id returned by STK response
User: ${userId}
api_ref: ${sub.api_ref}`
      );
    }
  } catch (err) {
    sub.stage = STAGE_WAIT_PAYMENT;

    await ctx.reply("❌ STK Push failed.\nTap *Resend STK Push* to try again.", {
      parse_mode: "Markdown",
      reply_markup: paymentWaitKeyboard().reply_markup
    });

    await sendAdminMessage(
      `❌ STK Push error
User: ${userId}
api_ref: ${safeText(sub.api_ref)}
Phone: ${safeText(sub.phone)}
Error: ${safeText(err?.message || err)}
Mode: ${INTASEND_TEST ? "TEST" : "LIVE"}
Host: ${PUBLIC_BASE_URL}`
    );
  }
}

// =====================
// START
// =====================
bot.start(async (ctx) => {
  const user = ctx.from;

  if (user.id === ADMIN_ID) {
    await replyMarkdownSafe(ctx, "👋 Admin mode is ready.\n" + adminQuickCommands(ADMIN_ID), {
      reply_markup: mainKeyboard()
    });
    return;
  }

  await sendAdminMessage(
    `🔥 New user started bot
Name: ${safeText(user.first_name)} ${safeText(user.last_name)}
Username: @${safeText(user.username || "N/A")}
User ID: ${user.id}${adminQuickCommands(user.id)}`
  );

  if (isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  await replyMarkdownSafe(ctx, MESSAGES.welcome(CHECK_PRICE_KES, RECHECK_PRICE_KES), {
    reply_markup: mainKeyboard()
  });
});

// =====================
// ADMIN COMMANDS
// =====================
bot.command("reply", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").split(" ");
  if (parts.length < 3) {
    return ctx.reply("Usage: /reply <userId> <message>");
  }

  const userId = parts[1];
  const replyText = parts.slice(2).join(" ");

  try {
    await bot.telegram.sendMessage(userId, `✅ Support Team:\n\n${replyText}`);
    await ctx.reply(`✅ Sent to ${userId}`);
  } catch (err) {
    await ctx.reply("❌ Failed: " + (err?.message || err));
  }
});

bot.command("filebatch", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply("Usage: /filebatch <userId> [caption]");
  }

  const userId = parts[1];
  const caption = parts.slice(2).join(" ");

  pendingFileTargets[ADMIN_ID] = {
    userId,
    caption,
    sentCount: 0
  };

  await ctx.reply(
    `✅ Batch delivery opened for user ${userId}.
Now send as many document/photo messages as needed.
When finished, send /donebatch
To cancel, send /cancelbatch`
  );
});

bot.command("donebatch", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const target = pendingFileTargets[ADMIN_ID];
  if (!target) {
    return ctx.reply("No active batch session. Use /filebatch <userId> first.");
  }

  const userId = target.userId;
  const sentCount = target.sentCount || 0;

  delete pendingFileTargets[ADMIN_ID];

  if (sentCount > 0) {
    try {
      await bot.telegram.sendMessage(userId, REPORTS_DELIVERED_MESSAGE);
    } catch {}
  }

  await ctx.reply(`✅ Batch closed. Sent ${sentCount} item(s) to ${userId}.`);
});

bot.command("cancelbatch", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const target = pendingFileTargets[ADMIN_ID];
  if (!target) {
    return ctx.reply("No active batch session.");
  }

  delete pendingFileTargets[ADMIN_ID];
  await ctx.reply(`✅ Batch session cancelled for user ${target.userId}.`);
});

// =====================
// MAIN BUTTONS
// =====================
bot.hears(KEY_SEND_DOC, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  if (ctx.from.id === ADMIN_ID) {
    return replyMarkdownSafe(ctx, MESSAGES.sendDocHelp, {
      reply_markup: mainKeyboard()
    });
  }

  submissions[ctx.from.id] = createEmptySubmission();

  await ctx.reply(
    `📦 How many files do you want to upload?\nChoose from *1* to *${MAX_BATCH_FILES}*.`,
    {
      parse_mode: "Markdown",
      reply_markup: batchSizeKeyboard().reply_markup
    }
  );
});

bot.hears(KEY_SEND_MPESA, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  await replyMarkdownSafe(ctx, MESSAGES.paymentHelp, {
    reply_markup: mainKeyboard()
  });
});

bot.hears(KEY_CANCEL, async (ctx) => {
  await notifyUserCancelledToAdmin(ctx.from);
  resetSubmission(ctx.from.id);

  await ctx.reply("❌ Cancelled. Send a new document to start again.", {
    reply_markup: mainKeyboard()
  });
});

// =====================
// BATCH SIZE SELECTION
// =====================
bot.action(/^BATCH_COUNT_(\d)$/, async (ctx) => {
  const count = Number(ctx.match[1]);
  const userId = ctx.from.id;

  if (isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  if (count < 1 || count > MAX_BATCH_FILES) {
    return ctx.answerCbQuery("Invalid number.");
  }

  submissions[userId] = createEmptySubmission();
  submissions[userId].expectedFiles = count;
  submissions[userId].stage = STAGE_WAIT_UPLOADS;

  await ctx.answerCbQuery(`Selected ${count} file(s)`);

  await ctx.reply(
    `✅ You selected *${count}* file(s).\n\nNow send file *1* of *${count}* as a *document*.`,
    {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    }
  );
});

// =====================
// USER DOCUMENT HANDLER
// ADMIN DOCUMENT SENDER
// =====================
bot.on("document", async (ctx) => {
  const user = ctx.from;

  // ADMIN sending report files
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];

    if (!target) {
      return ctx.reply("Use /filebatch <userId> first.");
    }

    const doc = ctx.message.document;

    try {
      await bot.telegram.sendDocument(target.userId, doc.file_id, {
        caption: target.sentCount === 0 ? target.caption || undefined : undefined
      });

      target.sentCount += 1;
      await ctx.reply(`✅ Document sent to ${target.userId}`);
    } catch (err) {
      await ctx.reply("❌ Failed: " + (err?.message || err));
    }

    return;
  }

  // USER -> forward to admin
  try {
    await sendAdminMessage(
      `📨 Document received
User ID: ${user.id}
Username: @${safeText(user.username || "N/A")}
Name: ${safeText(user.first_name)} ${safeText(user.last_name)}${adminQuickCommands(user.id)}`
    );

    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch {}

  if (isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  const sub = submissions[user.id];

  if (!sub || sub.stage === STAGE_WAIT_BATCH_SIZE) {
    return ctx.reply(
      `📄 File received.\n\nPlease tap *Send Document* first and choose how many files you want to upload (1-${MAX_BATCH_FILES}).`,
      {
        parse_mode: "Markdown",
        reply_markup: mainKeyboard()
      }
    );
  }

  if (sub.stage === STAGE_WAIT_FILE_TYPE) {
    return ctx.reply("⚠️ Please choose *Check* or *Recheck* for the previous file first.", {
      parse_mode: "Markdown",
      reply_markup: typeInlineKeyboard().reply_markup
    });
  }

  if (
    sub.stage === STAGE_WAIT_PHONE ||
    sub.stage === STAGE_WAIT_PAYMENT ||
    sub.stage === STAGE_PAID
  ) {
    return ctx.reply(
      "⚠️ This batch is already in payment/completed state. Tap *Cancel / New submission* to start another batch.",
      {
        parse_mode: "Markdown",
        reply_markup: mainKeyboard()
      }
    );
  }

  if (!canAcceptMoreFiles(sub)) {
    return ctx.reply(
      "✅ You have already uploaded the selected number of files.\nIf you are ready, continue with the next prompt.",
      {
        reply_markup: mainKeyboard()
      }
    );
  }

  const doc = ctx.message.document;

  sub.files.push({
    file_id: doc.file_id,
    file_name: doc.file_name || `file_${Date.now()}`,
    type: null,
    price: null,
    uploadedAt: Date.now()
  });

  sub.currentFileIndex = sub.files.length - 1;
  sub.stage = STAGE_WAIT_FILE_TYPE;

  await askForFileType(ctx, sub);
});

// =====================
// PHOTO HANDLER
// =====================
bot.on("photo", async (ctx) => {
  const user = ctx.from;

  // ADMIN sending photo reports
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];

    if (!target) {
      return ctx.reply("Use /filebatch <userId> first.");
    }

    const photos = ctx.message.photo || [];
    const largest = photos[photos.length - 1];

    try {
      await bot.telegram.sendPhoto(target.userId, largest.file_id, {
        caption: target.sentCount === 0 ? target.caption || undefined : undefined
      });

      target.sentCount += 1;
      await ctx.reply(`✅ Photo sent to ${target.userId}`);
    } catch (err) {
      await ctx.reply("❌ Failed: " + (err?.message || err));
    }

    return;
  }

  // USER PHOTO -> forward to admin
  try {
    await sendAdminMessage(
      `🖼️ Photo received
User ID: ${user.id}
Username: @${safeText(user.username || "N/A")}
Name: ${safeText(user.first_name)} ${safeText(user.last_name)}${adminQuickCommands(user.id)}`
    );

    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch {}

  if (isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  const sub = submissions[user.id];

  if (
    sub &&
    [STAGE_WAIT_BATCH_SIZE, STAGE_WAIT_UPLOADS, STAGE_WAIT_FILE_TYPE].includes(sub.stage)
  ) {
    return ctx.reply("⚠️ Please send your file as a *document*, not as a photo.", {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    });
  }

  await ctx.reply("✅ Received.", {
    reply_markup: mainKeyboard()
  });
});

// =====================
// TYPE SELECTION
// =====================
bot.action("TYPE_CHECK", async (ctx) => {
  if (isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }
  await handleFileTypeSelected(ctx, "CHECK");
});

bot.action("TYPE_RECHECK", async (ctx) => {
  if (isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }
  await handleFileTypeSelected(ctx, "RECHECK");
});

bot.action("DONE_UPLOADING", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  if (!sub || sub.stage !== STAGE_WAIT_UPLOADS) {
    return ctx.answerCbQuery("Nothing to finish.");
  }

  if (sub.files.length === 0) {
    return ctx.answerCbQuery("Upload at least one file first.");
  }

  await ctx.answerCbQuery("Finishing batch");
  await moveBatchToPhoneStep(ctx, sub);
});

bot.action("TYPE_CANCEL", async (ctx) => {
  await notifyUserCancelledToAdmin(ctx.from);
  resetSubmission(ctx.from.id);

  await ctx.answerCbQuery("Cancelled");
  await ctx.reply("❌ Cancelled. Send a new document to start again.", {
    reply_markup: mainKeyboard()
  });
});

// =====================
// STK CONTROLS
// =====================
bot.action("STK_CHANGE_PHONE", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (!sub) {
    return ctx.answerCbQuery("No active session.");
  }

  sub.stage = STAGE_WAIT_PHONE;
  sub.phone = null;

  await ctx.answerCbQuery("Send new phone");
  await ctx.reply(
    "📞 Send your phone number again (07XXXXXXXX / 01XXXXXXXX / 2547XXXXXXXX / 2541XXXXXXXX).",
    {
      reply_markup: mainKeyboard()
    }
  );
});

bot.action("STK_RESEND", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (!sub) {
    return ctx.answerCbQuery("No active session.");
  }

  await ctx.answerCbQuery("Resending...");

  if (!sub.phone) {
    sub.stage = STAGE_WAIT_PHONE;
    await ctx.reply("📞 Please send your phone number again.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  await attemptStkPush(ctx, sub, { mode: "resend" });
});

// =====================
// TEXT HANDLER
// =====================
bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = (ctx.message.text || "").trim();

  if (text.startsWith("/")) return;
  if (user.id === ADMIN_ID) return;

  await sendAdminMessage(
    `💬 Message from user
User ID: ${user.id}
Username: @${safeText(user.username || "N/A")}

${safeText(text)}${adminQuickCommands(user.id)}`
  );

  if (isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  const sub = submissions[user.id];

  if (sub && sub.stage === STAGE_WAIT_PHONE) {
    const phone254 = normalizePhoneTo254(text);

    if (!phone254) {
      return ctx.reply(
        "❌ Invalid phone. Send like 07XXXXXXXX / 01XXXXXXXX or 2547XXXXXXXX / 2541XXXXXXXX."
      );
    }

    sub.phone = phone254;
    await attemptStkPush(ctx, sub, { mode: "initial" });
    return;
  }

  if (sub && sub.stage === STAGE_WAIT_UPLOADS) {
    return ctx.reply(
      `📄 Please send file ${sub.files.length + 1} of ${sub.expectedFiles} as a *document*.\nOr tap *Done Uploading* if you are finished early.`,
      {
        parse_mode: "Markdown",
        reply_markup: uploadContinueKeyboard().reply_markup
      }
    );
  }

  if (sub && sub.stage === STAGE_WAIT_FILE_TYPE) {
    return ctx.reply("⚠️ Please choose *Check* or *Recheck* for the last uploaded file first.", {
      parse_mode: "Markdown",
      reply_markup: typeInlineKeyboard().reply_markup
    });
  }

  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    return;
  }

  if (!sub) {
    return ctx.reply("Tap *Send Document* first to start your submission.", {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    });
  }
});

// =====================
// EXPRESS SERVER + WEBHOOKS
// =====================
const app = express();

app.use(
  express.json({
    limit: "2mb",
    verify: (req, res, buf) => {
      req.rawBody = buf?.toString() || "";
    }
  })
);

app.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      req.rawBody = buf?.toString() || "";
    }
  })
);

// Telegram webhook endpoint
app.use(bot.webhookCallback("/webhook"));

app.get("/", (req, res) => res.status(200).send("OK"));

app.get("/health", (req, res) =>
  res.status(200).json({
    ok: true,
    timeUtc: moment.utc().format(),
    intasendTest: INTASEND_TEST,
    intasendBaseUrl: INTASEND_BASE_URL,
    publicBaseUrl: PUBLIC_BASE_URL
  })
);

// IntaSend webhook challenge (GET)
app.get("/intasend/webhook", (req, res) => {
  const qChallenge = req.query?.challenge;

  if (!qChallenge) {
    return res.status(200).send("OK");
  }

  if (INTASEND_WEBHOOK_CHALLENGE && qChallenge !== INTASEND_WEBHOOK_CHALLENGE) {
    return res.status(401).send("Invalid challenge");
  }

  return res.status(200).send(qChallenge);
});

// IntaSend webhook (POST)
app.post("/intasend/webhook", (req, res) => {
  res.status(200).json({ ok: true });

  setImmediate(async () => {
    try {
      let payload = req.body;

      const bodyIsEmptyObj =
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        Object.keys(payload).length === 0;

      if (!payload || typeof payload === "string" || bodyIsEmptyObj) {
        const raw = (req.rawBody || "").trim();

        if (raw) {
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = qs.parse(raw);
          }
        } else {
          payload = {};
        }
      }

      await sendAdminMessage(
        `📨 INTASEND WEBHOOK HIT
Raw: ${truncateText(JSON.stringify(payload), 2500)}`
      );

      if (
        payload.challenge &&
        INTASEND_WEBHOOK_CHALLENGE &&
        payload.challenge !== INTASEND_WEBHOOK_CHALLENGE
      ) {
        await sendAdminMessage("⚠️ IntaSend webhook: invalid challenge received.");
        return;
      }

      const apiRef = extractApiRef(payload);
      const invoiceId = extractInvoiceIdFromPayload(payload);
      const state = normalizeWebhookState(extractState(payload));

      // Try exact match, then fuzzy (IntaSend strips underscores), then by invoice_id
      const ref = getPaymentRef(apiRef) || getPaymentRefByApiRefFuzzy(apiRef) || getPaymentRefByInvoiceId(invoiceId);

      if (!ref) {
        await sendAdminMessage(
          `⚠️ IntaSend webhook: unmatched payment
api_ref: ${apiRef || "N/A"}
invoice_id: ${invoiceId || "N/A"}
state: ${state}`
        );
        return;
      }

      const effectiveApiRef = apiRef || ref.api_ref;

      updatePaymentRef(effectiveApiRef, {
        invoice_id: invoiceId || ref.invoice_id || null,
        last_state: state,
        last_webhook_at: Date.now()
      });

      if (state === "COMPLETE") {
        await markPaymentComplete(ref, "webhook", {
          invoice_id: invoiceId,
          api_ref: effectiveApiRef
        });
        return;
      }

      if (["FAILED", "CANCELLED", "EXPIRED"].includes(state)) {
        await markPaymentFailed(ref, state, "webhook", {
          invoice_id: invoiceId,
          api_ref: effectiveApiRef
        });
        return;
      }

      await sendAdminMessage(
        `ℹ️ IntaSend webhook state update
User: ${ref.userId}
api_ref: ${effectiveApiRef || "N/A"}
invoice_id: ${invoiceId || "N/A"}
state: ${state}`
      );
    } catch (err) {
      console.error("Async IntaSend processing error:", err?.message || err);
    }
  });
});

// =====================
// START SERVER + WEBHOOK
// =====================
const port = process.env.PORT || 3000;

app.listen(port, async () => {
  console.log(`Webhook server listening on port ${port}`);
  console.log(`PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}`);
  console.log(`IntaSend Mode: ${INTASEND_TEST ? "TEST" : "LIVE"}`);
  console.log(`IntaSend API Base: ${INTASEND_BASE_URL}`);

  const webhookUrl = `${PUBLIC_BASE_URL}/webhook`;

  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`✅ Telegram webhook set to: ${webhookUrl}`);
  } catch (e) {
    console.error("❌ Failed to set Telegram webhook:", e?.description || e?.message || e);
  }
});