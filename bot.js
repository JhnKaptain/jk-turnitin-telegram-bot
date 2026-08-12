require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const moment = require("moment");
const qs = require("querystring");

let IntaSend = null;
try {
  IntaSend = require("intasend-node");
} catch {
  IntaSend = null;
}

let Tesseract = null;
try {
  Tesseract = require("tesseract.js");
} catch {
  Tesseract = null;
}

// =====================
// ENV + CONSTANTS
// =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is missing");
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

function readBoolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}

function readIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function readFloatEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function readLabelEnv(name, fallback) {
  const raw = String(process.env[name] || fallback).trim();
  const cleaned = raw
    .replace(/[^A-Za-z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30)
    .toUpperCase();

  return cleaned || fallback;
}

function toTitleCaseLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

function normalizeHHMM(value, fallback) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return fallback;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function eatHHMMToUtc(hhmm) {
  const s = normalizeHHMM(hhmm, null);
  if (!s) return null;
  let [hh, mm] = s.split(":").map(Number);
  hh = (hh - 3 + 24) % 24;
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function utcHHMMToEat(hhmm) {
  const s = normalizeHHMM(hhmm, "03:45");
  let [hh, mm] = s.split(":").map(Number);
  hh = (hh + 3) % 24;
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function formatHHMMTo12Hour(hhmm) {
  const s = normalizeHHMM(hhmm, "06:45");
  let [hh, mm] = s.split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  let hour12 = hh % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

function formatHHMMTo12HourStrict(hhmm) {
  const s = normalizeHHMM(hhmm, null);
  if (!s) return "";
  let [hh, mm] = s.split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  let hour12 = hh % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

const PUBLIC_BASE_URL = sanitizeBaseUrl(
  process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || ""
);

if (!PUBLIC_BASE_URL) {
  console.error("PUBLIC_BASE_URL is missing or invalid.");
  console.error("Set: PUBLIC_BASE_URL=https://your-service.onrender.com");
  process.exit(1);
}

const INTASEND_TEST = readBoolEnv("INTASEND_TEST_ENVIRONMENT", false);
const INTASEND_WEBHOOK_CHALLENGE = String(process.env.INTASEND_WEBHOOK_CHALLENGE || "").trim();

const INTASEND_PUBLISHABLE_KEY = INTASEND_TEST
  ? String(process.env.INTASEND_TEST_PUBLISHABLE_KEY || "")
  : String(process.env.INTASEND_LIVE_PUBLISHABLE_KEY || "");

const INTASEND_SECRET_KEY = INTASEND_TEST
  ? String(process.env.INTASEND_TEST_SECRET_KEY || "")
  : String(process.env.INTASEND_LIVE_SECRET_KEY || "");

if (!INTASEND_SECRET_KEY) {
  console.error("Missing IntaSend secret key for selected environment.");
  process.exit(1);
}

if (!INTASEND_PUBLISHABLE_KEY) {
  console.warn("Warning: IntaSend publishable key missing.");
}

const INTASEND_API_BASE = "https://api.intasend.com/api/v1";
const ADMIN_ID = Number(process.env.ADMIN_ID || 6569201830);
const MAX_BATCH_FILES = 10;
const TILL_NUMBER = String(process.env.TILL_NUMBER || "6164915").trim();

const BOT_ONLINE_NAME = String(process.env.BOT_ONLINE_NAME || "JK Turnitin Reports (ONLINE)")
  .trim()
  .slice(0, 64);

const BOT_OFFLINE_NAME = String(process.env.BOT_OFFLINE_NAME || "JK Turnitin Reports (OFFLINE)")
  .trim()
  .slice(0, 64);

const PAYMENT_PROOF_RECIPIENT = String(
  process.env.PAYMENT_PROOF_RECIPIENT || "JOHNKAPTAIN SOLUTIONS HUB"
).trim();

const PAYMENT_OCR_ENABLED = readBoolEnv("PAYMENT_OCR_ENABLED", true);
const PAYMENT_OCR_MAX_MB = readFloatEnv("PAYMENT_OCR_MAX_MB", 1);
const PAYMENT_OCR_MAX_BYTES = PAYMENT_OCR_MAX_MB * 1024 * 1024;
const PAYMENT_OCR_TIMEOUT_SECONDS = readIntEnv("PAYMENT_OCR_TIMEOUT_SECONDS", 8);
const PAYMENT_OCR_TIMEOUT_MS = PAYMENT_OCR_TIMEOUT_SECONDS * 1000;

const CHECK_PRICE_KES = readIntEnv("CHECK_PRICE_KES", 135);
const RECHECK_PRICE_KES = readIntEnv("RECHECK_PRICE_KES", 130);
const SIMILARITY_ONLY_ENABLED = readBoolEnv("SIMILARITY_ONLY_ENABLED", true);
const SIMILARITY_ONLY_PRICE_KES = readIntEnv("SIMILARITY_ONLY_PRICE_KES", 100);
const RESALE_PRICE_KES = readIntEnv(
  "RESALE_PRICE_KES",
  readIntEnv("RESALE_AMOUNT_KES", 100)
);

const RESELLER_CODE = String(
  process.env.RESELLER_CODE || process.env.RESALE_CODE || ""
).trim();

const RESALE_ENABLED = RESELLER_CODE.length > 0;
const RESALE_AMOUNT_VISIBLE = readBoolEnv("RESALE_AMOUNT_VISIBLE", true);
const DISCOUNT_PUBLIC_ENABLED = readBoolEnv("DISCOUNT_PUBLIC_ENABLED", false);
const RESALE_LABEL = readLabelEnv("RESALE_LABEL", "RESALE");
const RESALE_LABEL_TITLE = toTitleCaseLabel(RESALE_LABEL);

const DISCOUNT_TIME_VISIBLE = readBoolEnv("DISCOUNT_TIME_VISIBLE", false);
const DISCOUNT_START_EAT = normalizeHHMM(process.env.DISCOUNT_START_EAT, "");
const DISCOUNT_END_EAT = normalizeHHMM(process.env.DISCOUNT_END_EAT, "");

const INTERNATIONAL_PAYMENT_ENABLED = readBoolEnv("INTERNATIONAL_PAYMENT_ENABLED", true);
const INTERNATIONAL_CHECK_PRICE_USD = readFloatEnv("INTERNATIONAL_CHECK_PRICE_USD", 2);
const INTERNATIONAL_SIMILARITY_ONLY_PRICE = readFloatEnv(
  "INTERNATIONAL_SIMILARITY_ONLY_PRICE",
  INTERNATIONAL_CHECK_PRICE_USD
);
const INTERNATIONAL_CURRENCY = String(process.env.INTERNATIONAL_CURRENCY || "USD").trim().toUpperCase();
const INTERNATIONAL_METHODS_TEXT = String(
  process.env.INTERNATIONAL_METHODS_TEXT || "Kenyan bank/PesaLink checkout"
).trim();

const INTERNATIONAL_BANK_FALLBACK_ENABLED = readBoolEnv("INTERNATIONAL_BANK_FALLBACK_ENABLED", true);
const INTERNATIONAL_BANK_NAME = String(process.env.INTERNATIONAL_BANK_NAME || "Co-operative Bank").trim();
const INTERNATIONAL_BANK_ACCOUNT_NUMBER = String(
  process.env.INTERNATIONAL_BANK_ACCOUNT_NUMBER || "01102610456001"
).replace(/[^0-9A-Za-z-]/g, "").trim();
const INTERNATIONAL_BANK_ACCOUNT_NAME = String(process.env.INTERNATIONAL_BANK_ACCOUNT_NAME || "").trim();

const TZ_OTHER_PAYMENT_ENABLED = readBoolEnv("TZ_OTHER_PAYMENT_ENABLED", true);
const TZ_OTHER_SAFARICOM_NUMBER = String(process.env.TZ_OTHER_SAFARICOM_NUMBER || "0741924396")
  .replace(/[^0-9+]/g, "")
  .trim();
const TZ_OTHER_AIRTEL_NUMBER = String(process.env.TZ_OTHER_AIRTEL_NUMBER || "0788060948")
  .replace(/[^0-9+]/g, "")
  .trim();
const TZ_OTHER_RECIPIENT_NAME = String(process.env.TZ_OTHER_RECIPIENT_NAME || "JOHN WANJALA").trim();
const TZ_OTHER_PROOF_WAIT_MINUTES = Math.max(1, readIntEnv("TZ_OTHER_PROOF_WAIT_MINUTES", 2));
const TZ_OTHER_CURRENCY = String(process.env.TZ_OTHER_CURRENCY || INTERNATIONAL_CURRENCY || "KES")
  .trim()
  .toUpperCase();

const REPORT_PROCESSING_MIN_MINUTES = Math.max(
  1,
  readIntEnv("REPORT_PROCESSING_MIN_MINUTES", 5)
);

const REPORT_PROCESSING_MAX_MINUTES = Math.max(
  REPORT_PROCESSING_MIN_MINUTES,
  readIntEnv("REPORT_PROCESSING_MAX_MINUTES", 20)
);

const REPORT_PROCESSING_LABEL = String(process.env.REPORT_PROCESSING_LABEL || "queue")
  .replace(/[^A-Za-z0-9 ,._()/-]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 50) || "queue";

const REPORT_PROCESSING_CUSTOM_ENABLED = readBoolEnv(
  "REPORT_PROCESSING_CUSTOM_ENABLED",
  false
);

const REPORT_PROCESSING_MESSAGE_OVERRIDE = String(
  process.env.REPORT_PROCESSING_MESSAGE || ""
).trim();

function reportProcessingTimeText() {
  if (REPORT_PROCESSING_CUSTOM_ENABLED && REPORT_PROCESSING_MESSAGE_OVERRIDE) {
    return REPORT_PROCESSING_MESSAGE_OVERRIDE;
  }

  if (REPORT_PROCESSING_MIN_MINUTES === REPORT_PROCESSING_MAX_MINUTES) {
    return `Reports take *${REPORT_PROCESSING_MIN_MINUTES} minutes* (${REPORT_PROCESSING_LABEL}).`;
  }

  return `Reports take *${REPORT_PROCESSING_MIN_MINUTES}–${REPORT_PROCESSING_MAX_MINUTES} minutes* (${REPORT_PROCESSING_LABEL}).`;
}

const RECHECK_WINDOW_MS = 24 * 60 * 60 * 1000;
const CHECK_HISTORY_RETENTION_MS = 72 * 60 * 60 * 1000;
const USED_PROOF_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PAID_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const INACTIVE_START_UTC = normalizeHHMM(
  process.env.INACTIVE_START_UTC,
  eatHHMMToUtc(process.env.INACTIVE_START_EAT) || "21:00"
);

const INACTIVE_END_UTC = normalizeHHMM(
  process.env.INACTIVE_END_UTC,
  eatHHMMToUtc(process.env.INACTIVE_END_EAT) || "03:45"
);

const INACTIVE_END_EAT = utcHHMMToEat(INACTIVE_END_UTC);
const INACTIVE_END_EAT_DISPLAY = formatHHMMTo12Hour(INACTIVE_END_EAT);

// =====================
// STAGES / PAYMENT
// =====================
const STAGE_WAIT_BATCH_SIZE = "WAIT_BATCH_SIZE";
const STAGE_WAIT_UPLOADS = "WAIT_UPLOADS";
const STAGE_WAIT_FILE_TYPE = "WAIT_FILE_TYPE";
const STAGE_WAIT_RESELLER_CODE = "WAIT_RESELLER_CODE";
const STAGE_WAIT_PAYMENT_METHOD = "WAIT_PAYMENT_METHOD";
const STAGE_WAIT_PHONE = "WAIT_PHONE";
const STAGE_WAIT_PAYMENT = "WAIT_PAYMENT";
const STAGE_PAID = "PAID";

const STK_RESEND_COOLDOWN_MS = 30 * 1000;
const STK_MAX_RESENDS = 3;
const PAYMENT_TIMEOUT_MS = 6 * 60 * 1000;
const STATUS_POLL_INTERVAL_MS = readIntEnv("STATUS_POLL_INTERVAL_SECONDS", 10) * 1000;
const STATUS_POLL_MAX_ATTEMPTS = readIntEnv("STATUS_POLL_MAX_ATTEMPTS", 180);

// =====================
// UI TEXT
// =====================
const KEY_SEND_DOC = "📎 Upload Procedure";
const KEY_SEND_MPESA = "🧾 Payment Help";
const KEY_CONTACT_SUPPORT = "💬 Contact Support Team";
const KEY_CANCEL = "❌ Cancel / New submission";

const CLEAN_COPY_WARNING =
  "⚠️ Only Upload Files without institution names and logos on cover pages to avoid account bans.";

const REPORTS_DELIVERED_MESSAGE =
  "✅ Your Turnitin reports are ready. Thank you for choosing JK Turnitin. Access our other writing services here: https://john-kaptain.github.io/johnkaptain-academic-tools-hub/";

const AI_UNAVAILABLE_NOTE =
  `ℹ️ AI Writing Report Unavailable

📌 Turnitin AI may not show when:

📝 Essay/prose content is below 300 words or above 30,000 words
🌐 File language is not English, Spanish, or Japanese
📄 File type is not .docx, .pdf, .txt, or .rtf

✅ If AI is unavailable, only the similarity report may be provided.`;

const AI_STAR_NOTE =
  `⭐ *AI Report Asterisk*

An asterisk (\\*%) appears when AI detection is below *20%*.

At *1–19%*, Turnitin may not show the exact percentage or AI highlights because results are less reliable.

To get highlights for revision, add AI content at the end of the file to boost detection to at least *20%*, then request a *paid recheck*.

The revised file must be submitted again. *All submissions are paid for.*`;

function mpesaTillNoticeMessage() {
  return [
    "🧾 *M-Pesa Payment Notice*",
    "",
    "The M-Pesa STK prompt gateway is currently experiencing technical issues.",
    "",
    "Please pay manually via *Buy Goods Till Number:*",
    "*" + TILL_NUMBER + "*",
    "",
    "If payment is not confirmed within *1 minute*, send the M-Pesa confirmation message or payment screenshot here for verification.",
    "",
    "STK prompts will resume once the gateway is stable."
  ].join("\n");
}

function discountTimeText() {
  if (!DISCOUNT_TIME_VISIBLE) return "";

  const start = formatHHMMTo12HourStrict(DISCOUNT_START_EAT);
  const end = formatHHMMTo12HourStrict(DISCOUNT_END_EAT);

  if (start && end) return `${RESALE_LABEL_TITLE} available from ${start} to ${end} EAT.`;
  if (start) return `${RESALE_LABEL_TITLE} available from ${start} EAT.`;
  if (end) return `${RESALE_LABEL_TITLE} available until ${end} EAT.`;
  return "";
}

function discountTimeLineForMessage() {
  const text = discountTimeText();
  return text ? `\n⏰ ${text}` : "";
}

function resalePublicPriceText() {
  if (!RESALE_ENABLED) return "";
  if (RESALE_AMOUNT_VISIBLE) return `${RESALE_PRICE_KES} KES`;
  return "available with code";
}

function resaleButtonLabel(resaleVerified) {
  if (!RESALE_ENABLED) return "";

  if (isDiscountPublicActive() || resaleVerified) {
    return `🏷️ Use ${RESALE_LABEL_TITLE} (${RESALE_PRICE_KES} KES)`;
  }

  return `🏷️ ${RESALE_LABEL_TITLE} Code`;
}

function typeDisplayName(kind) {
  if (kind === "SIMILARITY") return "Similarity Report Only";
  if (kind === "RESALE") return RESALE_LABEL_TITLE;
  return kind;
}

function tillLine() {
  return `Till: ${TILL_NUMBER}`;
}

const UPLOAD_PROCEDURE_MESSAGE = [
  "📎 Upload Procedure",
  "",
  "You do not need to tap this button before uploading.",
  "",
  "1️⃣ Tap Telegram's 📎 attachment button beside the message box.",
  "2️⃣ Choose File/Document.",
  "3️⃣ Send your DOC/PDF file directly.",
  "4️⃣ After the first file is received, choose the total number of files in the batch.",
  "5️⃣ Upload any remaining files as documents.",
  "",
  "The bot will then check the file and show the available service options.",
  "",
  "⚠️ Do not send the document as a photo.",
  CLEAN_COPY_WARNING
].join("\n");
const MESSAGES = {
  welcome: (check, recheck, resale) => `
JK Turnitin Reports Bot

💰 *Pricing*
• Check: ${check} KES
• Recheck: ${recheck} KES${SIMILARITY_ONLY_ENABLED ? `\n• Similarity Report Only: ${SIMILARITY_ONLY_PRICE_KES} KES` : ""}${RESALE_ENABLED ? `\n• ${RESALE_LABEL_TITLE}: ${resalePublicPriceText()}` : ""}

🔁 *Recheck*
The bot automatically checks whether an uploaded file qualifies for *RECHECK*.
Recheck is available only when the same file was checked and paid within the last 24 hours.

${RESALE_ENABLED && !isDiscountPublicActive() ? `🏷️ *${RESALE_LABEL_TITLE}*\n${RESALE_LABEL_TITLE} currently requires a code.${discountTimeLineForMessage()}` : ""}
${RESALE_ENABLED && isDiscountPublicActive() ? `🏷️ *${RESALE_LABEL_TITLE}*\n${RESALE_LABEL_TITLE} is currently available without a code.${discountTimeLineForMessage()}` : ""}
`,  inactive: () => `
⏳ Turnitin checks are paused right now.
We’ll resume at *${INACTIVE_END_EAT_DISPLAY} EAT*.

⚠️ Payment prompts will only be sent after ${INACTIVE_END_EAT_DISPLAY}.

If urgent, WhatsApp call *0701730921*.
`,
  sendDocHelp: UPLOAD_PROCEDURE_MESSAGE,  paymentHelp:
    `🧾 Payment help:

Default method: *STK Push*.

If STK delays or fails, pay manually via:
*Buy Goods Till:* ${TILL_NUMBER}

If payment is not confirmed within *1 minute*, send the M-Pesa confirmation message or payment screenshot here.

🔁 Recheck is only available when the same file was checked and paid within the last 24 hours.${RESALE_ENABLED && !isDiscountPublicActive() ? `\n\n🏷️ ${RESALE_LABEL_TITLE} requires a code.${discountTimeLineForMessage()}` : ""}${RESALE_ENABLED && isDiscountPublicActive() ? `\n\n🏷️ ${RESALE_LABEL_TITLE} is active.${discountTimeLineForMessage()}` : ""}`,
  askPhoneBatch: (summary, amount) =>
    `📦 Batch summary\n\n${summary}\n\n💰 Total: *${amount} KES*\n\nSend phone number (07XXXXXXXX / 01XXXXXXXX).`,
  stkSentWithTill: () =>
    `✅ STK Push sent. Check your phone and enter PIN.

If STK delays or fails, pay manually via:
*Buy Goods Till:* ${TILL_NUMBER}

If payment is not confirmed within *1 minute*, send the M-Pesa confirmation message or payment screenshot here.`,
  paidMsgBatch: (amount, summary, currency = "KES") =>
    `✅ Payment confirmed (${amount} ${currency}).\n\n${summary}\n\n⏱ ${reportProcessingTimeText()}`
};

// =====================
// BOT STATE
// =====================
const bot = new Telegraf(BOT_TOKEN);
const submissions = {};
const pendingFileTargets = {};
const activePollers = {};
const supportRequests = {};
const pendingAdminReplies = {};

const processedUpdateCache = new Map();
const PROCESSED_UPDATE_TTL_MS = 30 * 60 * 1000;

let paymentRefs = {};
let checkHistory = [];
let usedProofCodes = {};
let paidJobs = {};
let dailySalesSummary = {};
let dailySalesLedger = {};
let lastAppliedBotNameMode = null;

const DATA_DIR = String(process.env.DATA_DIR || __dirname).trim();

try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error("Failed to create DATA_DIR:", e?.message || e);
}

const STORE_FILE = path.join(DATA_DIR, "paymentRefs.store.json");
const CHECK_HISTORY_FILE = path.join(DATA_DIR, "checkHistory.store.json");
const USED_PROOF_CODES_FILE = path.join(DATA_DIR, "usedProofCodes.store.json");
const PAID_JOBS_FILE = path.join(DATA_DIR, "paidJobs.store.json");
const DAILY_SALES_SUMMARY_FILE = path.join(DATA_DIR, "dailySalesSummary.store.json");
const DAILY_SALES_LEDGER_FILE = path.join(DATA_DIR, "dailySalesLedger.store.json");

// =====================
// DUPLICATE UPDATE GUARD
// =====================
function cleanupProcessedUpdateCache() {
  const now = Date.now();

  for (const [key, value] of processedUpdateCache.entries()) {
    if (now - Number(value?.ts || 0) > PROCESSED_UPDATE_TTL_MS) {
      processedUpdateCache.delete(key);
    }
  }
}

bot.use(async (ctx, next) => {
  cleanupProcessedUpdateCache();

  const updateId = ctx.update?.update_id;
  if (updateId === undefined || updateId === null) return next();

  const key = `update:${updateId}`;
  if (processedUpdateCache.has(key)) {
    console.log(`Duplicate Telegram update skipped: ${key}`);
    return;
  }

  processedUpdateCache.set(key, { ts: Date.now(), status: "processing" });

  try {
    await next();
    processedUpdateCache.set(key, { ts: Date.now(), status: "done" });
  } catch (err) {
    processedUpdateCache.delete(key);
    throw err;
  }
});

// =====================
// PAYMENT REF PERSISTENCE
// =====================
function loadStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") paymentRefs = parsed;
  } catch (e) {
    console.error("Failed to load payment store:", e?.message || e);
  }
}

function saveStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(paymentRefs, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save payment store:", e?.message || e);
  }
}

function putPaymentRef(apiRef, value) {
  paymentRefs[apiRef] = value;
  saveStore();
}

function updatePaymentRef(apiRef, patch) {
  paymentRefs[apiRef] = {
    ...(paymentRefs[apiRef] || {}),
    ...patch,
    updatedAt: Date.now()
  };
  saveStore();
}

function getPaymentRef(apiRef) {
  return paymentRefs[apiRef] || null;
}

function findPaymentRefByInvoiceId(invoiceId) {
  const wanted = String(invoiceId || "").trim();
  if (!wanted) return null;

  for (const [apiRef, value] of Object.entries(paymentRefs)) {
    if (String(value?.invoiceId || "").trim() === wanted) return { apiRef, value };
  }
  return null;
}

loadStore();

setInterval(() => {
  const now = Date.now();
  const cutoff = 7 * 24 * 60 * 60 * 1000;
  let changed = false;

  for (const [apiRef, value] of Object.entries(paymentRefs)) {
    if (value?.createdAt && now - value.createdAt > cutoff) {
      delete paymentRefs[apiRef];
      changed = true;
    }
  }

  if (changed) saveStore();
}, 6 * 60 * 60 * 1000);

// =====================
// DAILY SALES SUMMARY
// =====================
function loadDailySalesSummary() {
  try {
    if (!fs.existsSync(DAILY_SALES_SUMMARY_FILE)) return;
    const raw = fs.readFileSync(DAILY_SALES_SUMMARY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") dailySalesSummary = parsed;
  } catch (e) {
    console.error("Failed to load daily sales summary store:", e?.message || e);
  }
}

function saveDailySalesSummary() {
  try {
    fs.writeFileSync(DAILY_SALES_SUMMARY_FILE, JSON.stringify(dailySalesSummary, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save daily sales summary store:", e?.message || e);
  }
}

function loadDailySalesLedger() {
  try {
    if (!fs.existsSync(DAILY_SALES_LEDGER_FILE)) return;
    const raw = fs.readFileSync(DAILY_SALES_LEDGER_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") dailySalesLedger = parsed;
  } catch (e) {
    console.error("Failed to load daily sales ledger:", e?.message || e);
  }

  if (!dailySalesLedger || typeof dailySalesLedger !== "object") dailySalesLedger = {};
  if (!dailySalesLedger.payments || typeof dailySalesLedger.payments !== "object") {
    dailySalesLedger.payments = {};
  }
}

function saveDailySalesLedger() {
  try {
    if (!dailySalesLedger.payments || typeof dailySalesLedger.payments !== "object") {
      dailySalesLedger.payments = {};
    }

    fs.writeFileSync(DAILY_SALES_LEDGER_FILE, JSON.stringify(dailySalesLedger, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save daily sales ledger:", e?.message || e);
  }
}

function getEatDateKeyFromTimestamp(ts) {
  return moment(Number(ts || Date.now())).utcOffset(180).format("YYYY-MM-DD");
}

function getEatDayBoundsMs(dateKey) {
  const start = moment.parseZone(`${dateKey}T00:00:00+03:00`).valueOf();
  const end = moment.parseZone(`${dateKey}T00:00:00+03:00`).add(1, "day").valueOf();
  return { start, end };
}

function countTypesFromPaymentRef(ref, counts) {
  if (Array.isArray(ref?.files) && ref.files.length > 0) {
    for (const file of ref.files) {
      const t = String(file?.type || "").toUpperCase();
      if (t === "CHECK") counts.checks += 1;
      else if (t === "RECHECK") counts.rechecks += 1;
      else if (t === "SIMILARITY") counts.similarities += 1;
      else if (t === "RESALE") counts.resales += 1;
    }
    return;
  }

  const kind = String(ref?.kind || "").toUpperCase();

  const checkMatch = kind.match(/(\d+)\s*CHECK\b/);
  const recheckMatch = kind.match(/(\d+)\s*RECHECK\b/);
  const similarityMatch = kind.match(/(\d+)\s*SIMILARITY\b/i);

  let resaleMatch = null;
  if (RESALE_LABEL) {
    resaleMatch = kind.match(
      new RegExp(`(\\d+)\\s*${RESALE_LABEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    );
  }

  if (!resaleMatch) resaleMatch = kind.match(/(\d+)\s*DISCOUNT\b/i);
  if (!resaleMatch) resaleMatch = kind.match(/(\d+)\s*RESALE\b/i);

  if (checkMatch) counts.checks += Number(checkMatch[1] || 0);
  if (recheckMatch) counts.rechecks += Number(recheckMatch[1] || 0);
  if (similarityMatch) counts.similarities += Number(similarityMatch[1] || 0);
  if (resaleMatch) counts.resales += Number(resaleMatch[1] || 0);
}

function getTypeCountsFromPaymentRef(ref) {
  const counts = { checks: 0, rechecks: 0, similarities: 0, resales: 0 };
  countTypesFromPaymentRef(ref, counts);
  return counts;
}

function cleanupDailySalesLedger() {
  if (!dailySalesLedger.payments || typeof dailySalesLedger.payments !== "object") {
    dailySalesLedger.payments = {};
    saveDailySalesLedger();
    return;
  }

  const cutoffDateKey = moment().utcOffset(180).subtract(120, "days").format("YYYY-MM-DD");
  let changed = false;

  for (const [apiRef, record] of Object.entries(dailySalesLedger.payments)) {
    const dateKey = String(record?.dateKey || "");
    if (!dateKey || dateKey < cutoffDateKey) {
      delete dailySalesLedger.payments[apiRef];
      changed = true;
    }
  }

  if (changed) saveDailySalesLedger();
}

function recordDailySale({ apiRef, ref, userId, invoiceId, source }) {
  if (!apiRef || !ref) return;

  if (!dailySalesLedger.payments || typeof dailySalesLedger.payments !== "object") {
    dailySalesLedger.payments = {};
  }

  if (dailySalesLedger.payments[apiRef]) return;

  const completedAt = Number(ref.completedAt || ref.paidAt || Date.now());
  const dateKey = getEatDateKeyFromTimestamp(completedAt);
  const typeCounts = getTypeCountsFromPaymentRef(ref);

  dailySalesLedger.payments[apiRef] = {
    apiRef,
    invoiceId: invoiceId || ref.invoiceId || null,
    userId: Number(userId || ref.userId || 0),
    name: ref.name || "N/A",
    username: ref.username || "N/A",
    phone: ref.phone || null,
    amount: Number(ref.amount || 0) || 0,
    kind: ref.kind || "BATCH",
    checks: typeCounts.checks,
    rechecks: typeCounts.rechecks,
    similarities: typeCounts.similarities,
    resales: typeCounts.resales,
    completedAt,
    dateKey,
    source: source || ref.completionSource || "unknown",
    createdAt: Date.now()
  };

  cleanupDailySalesLedger();
  saveDailySalesLedger();
}

function buildDailySalesSummary(dateKey) {
  const counts = {
    payments: 0,
    total: 0,
    checks: 0,
    rechecks: 0,
    similarities: 0,
    resales: 0
  };

  const seenApiRefs = new Set();

  if (!dailySalesLedger.payments || typeof dailySalesLedger.payments !== "object") {
    dailySalesLedger.payments = {};
  }

  for (const [apiRef, record] of Object.entries(dailySalesLedger.payments)) {
    if (String(record?.dateKey || "") !== String(dateKey)) continue;

    seenApiRefs.add(apiRef);

    counts.payments += 1;
    counts.total += Number(record?.amount || 0) || 0;
    counts.checks += Number(record?.checks || 0) || 0;
    counts.rechecks += Number(record?.rechecks || 0) || 0;
    counts.similarities += Number(record?.similarities || 0) || 0;
    counts.resales += Number(record?.resales || 0) || 0;
  }

  const { start, end } = getEatDayBoundsMs(dateKey);

  for (const [apiRef, ref] of Object.entries(paymentRefs || {})) {
    if (seenApiRefs.has(apiRef)) continue;

    const status = String(ref?.status || "").toUpperCase();
    if (status !== "COMPLETE") continue;

    const completedAt = Number(ref?.completedAt || ref?.paidAt || 0);
    if (!completedAt || completedAt < start || completedAt >= end) continue;

    const typeCounts = getTypeCountsFromPaymentRef(ref);

    counts.payments += 1;

    const amount = Number(ref?.amount || 0);
    if (Number.isFinite(amount)) counts.total += amount;

    counts.checks += typeCounts.checks;
    counts.rechecks += typeCounts.rechecks;
    counts.similarities += typeCounts.similarities;
    counts.resales += typeCounts.resales;
  }

  return counts;
}

async function sendDailySalesSummaryForPreviousEatDay() {
  const dateKey = moment().utcOffset(180).subtract(1, "day").format("YYYY-MM-DD");

  if (dailySalesSummary.lastSentDateKey === dateKey) {
    return;
  }

  const summary = buildDailySalesSummary(dateKey);

  const text =
    `📊 Daily Payment Summary\n\n` +
    `Date: ${dateKey}\n` +
    `Successful payments: ${summary.payments}\n` +
    `Total collected: ${summary.total.toLocaleString("en-KE")} KES\n\n` +
    `CHECK: ${summary.checks}\n` +
    `RECHECK: ${summary.rechecks}\n` +
    `SIMILARITY ONLY: ${summary.similarities}\n` +
    `${RESALE_LABEL}: ${summary.resales}`;

  await sendAdminMessage(text, { parse_mode: "Markdown" });

  dailySalesSummary.lastSentDateKey = dateKey;
  dailySalesSummary.lastSentAt = Date.now();
  saveDailySalesSummary();
}

function msUntilNextEatMidnight() {
  const nowEat = moment().utcOffset(180);
  const nextEatMidnight = nowEat.clone().add(1, "day").startOf("day");
  return Math.max(1000, nextEatMidnight.valueOf() - Date.now());
}

function startDailySalesSummaryScheduler() {
  const delay = msUntilNextEatMidnight();

  setTimeout(async () => {
    try {
      await sendDailySalesSummaryForPreviousEatDay();
    } catch (e) {
      console.error("Daily sales summary failed:", e?.message || e);
    } finally {
      startDailySalesSummaryScheduler();
    }
  }, delay);
}

loadDailySalesSummary();
loadDailySalesLedger();
cleanupDailySalesLedger();
setInterval(cleanupDailySalesLedger, 6 * 60 * 60 * 1000);

// =====================
// PAID JOB STORE
// =====================
function loadPaidJobs() {
  try {
    if (!fs.existsSync(PAID_JOBS_FILE)) return;
    const raw = fs.readFileSync(PAID_JOBS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") paidJobs = parsed;
  } catch (e) {
    console.error("Failed to load paid jobs:", e?.message || e);
  }
}

function savePaidJobs() {
  try {
    fs.writeFileSync(PAID_JOBS_FILE, JSON.stringify(paidJobs, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save paid jobs:", e?.message || e);
  }
}

function cleanupPaidJobs() {
  const now = Date.now();
  let changed = false;

  for (const [jobId, job] of Object.entries(paidJobs)) {
    const t = Number(job?.paidAt || job?.createdAt || 0);
    if (!t || now - t > PAID_JOB_RETENTION_MS) {
      delete paidJobs[jobId];
      changed = true;
    }
  }

  if (changed) savePaidJobs();
}

function createPaidJob({ userId, apiRef, ref, invoiceId, source }) {
  const now = Date.now();
  const batchId = ref?.batchId || `paid_${userId}_${now}`;
  const jobId = String(batchId || apiRef || `paid_${userId}_${now}`);
  const cancelAllowedAt = now + REPORT_PROCESSING_MAX_MINUTES * 60 * 1000;

  paidJobs[jobId] = {
    jobId,
    userId: Number(userId),
    batchId,
    apiRef,
    invoiceId: invoiceId || ref?.invoiceId || null,
    amount: ref?.amount || null,
    kind: ref?.kind || "BATCH",
    summary: ref?.summary || "",
    name: ref?.name || "N/A",
    username: ref?.username || "N/A",
    phone: ref?.phone || null,
    paidAt: now,
    cancelAllowedAt,
    status: "PROCESSING",
    createdAt: now,
    source: source || "payment-confirmed"
  };

  cleanupPaidJobs();
  savePaidJobs();
  return paidJobs[jobId];
}

function getLatestActivePaidJob(userId) {
  const list = Object.values(paidJobs)
    .filter((job) => String(job.userId) === String(userId))
    .filter((job) => !["DELIVERED", "CLOSED"].includes(String(job.status || "").toUpperCase()))
    .sort((a, b) => Number(b.paidAt || 0) - Number(a.paidAt || 0));

  return list[0] || null;
}

function markPaidJobCancellationRequested(jobId) {
  if (!paidJobs[jobId]) return null;
  paidJobs[jobId].status = "CANCEL_REQUESTED";
  paidJobs[jobId].cancelRequestedAt = Date.now();
  savePaidJobs();
  return paidJobs[jobId];
}

function markLatestPaidJobDelivered(userId) {
  const job = getLatestActivePaidJob(userId);
  if (!job) return null;

  paidJobs[job.jobId].status = "DELIVERED";
  paidJobs[job.jobId].deliveredAt = Date.now();
  savePaidJobs();

  return paidJobs[job.jobId];
}

function paidJobCancelWaitText(job) {
  const ms = Number(job.cancelAllowedAt || 0) - Date.now();
  const min = Math.max(1, Math.ceil(ms / 60000));
  return `✅ Payment confirmed. Report is processing.\n\nCancellation opens in about ${min} minute(s).`;
}

loadPaidJobs();
cleanupPaidJobs();
setInterval(cleanupPaidJobs, 6 * 60 * 60 * 1000);

// =====================
// USED PROOF CODE STORE
// =====================
function normalizeProofCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function loadUsedProofCodes() {
  try {
    if (!fs.existsSync(USED_PROOF_CODES_FILE)) return;
    const raw = fs.readFileSync(USED_PROOF_CODES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") usedProofCodes = parsed;
  } catch (e) {
    console.error("Failed to load used proof codes:", e?.message || e);
  }
}

function saveUsedProofCodes() {
  try {
    fs.writeFileSync(USED_PROOF_CODES_FILE, JSON.stringify(usedProofCodes, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save used proof codes:", e?.message || e);
  }
}

function cleanupUsedProofCodes() {
  const now = Date.now();
  let changed = false;

  for (const [code, record] of Object.entries(usedProofCodes)) {
    const t = Number(record?.confirmedAt || 0);
    if (!t || now - t > USED_PROOF_RETENTION_MS) {
      delete usedProofCodes[code];
      changed = true;
    }
  }

  if (changed) saveUsedProofCodes();
}

function isProofCodeUsed(code) {
  const normalized = normalizeProofCode(code);
  if (!normalized) return false;
  return Boolean(usedProofCodes[normalized]);
}

function rememberUsedProofCode(code, details) {
  const normalized = normalizeProofCode(code);
  if (!normalized) return;

  usedProofCodes[normalized] = {
    code: normalized,
    userId: details?.userId || null,
    apiRef: details?.apiRef || null,
    amount: details?.amount || null,
    source: details?.source || "manual-confirm",
    confirmedAt: Date.now()
  };

  cleanupUsedProofCodes();
  saveUsedProofCodes();
}

loadUsedProofCodes();
cleanupUsedProofCodes();
setInterval(cleanupUsedProofCodes, 6 * 60 * 60 * 1000);

// =====================
// CHECK HISTORY
// =====================
function loadCheckHistory() {
  try {
    if (!fs.existsSync(CHECK_HISTORY_FILE)) return;
    const raw = fs.readFileSync(CHECK_HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      checkHistory = parsed;
      return;
    }

    if (parsed && Array.isArray(parsed.records)) {
      checkHistory = parsed.records;
      return;
    }

    if (parsed && typeof parsed === "object") {
      checkHistory = Object.values(parsed).filter(Boolean);
    }
  } catch (e) {
    console.error("Failed to load check history:", e?.message || e);
  }
}

function saveCheckHistory() {
  try {
    fs.writeFileSync(CHECK_HISTORY_FILE, JSON.stringify(checkHistory, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save check history:", e?.message || e);
  }
}

function cleanupCheckHistory() {
  const now = Date.now();
  const before = checkHistory.length;

  checkHistory = checkHistory.filter((record) => {
    const t = Number(record?.lastPaidCheckAt || 0);
    return t > 0 && now - t <= CHECK_HISTORY_RETENTION_MS;
  });

  if (checkHistory.length !== before) saveCheckHistory();
}

function normalizeFileNameForRecheck(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sameFileIdentity(record, userId, fileName, fileUniqueId) {
  if (!record) return false;
  if (String(record.userId) !== String(userId)) return false;

  const historyName = normalizeFileNameForRecheck(record.fileName);
  const currentName = normalizeFileNameForRecheck(fileName);

  if (!historyName || !currentName) return false;
  return historyName === currentName;
}

function getRecheckEligibility(userId, fileName, fileUniqueId) {
  const now = Date.now();

  const match = checkHistory
    .filter((record) => sameFileIdentity(record, userId, fileName, fileUniqueId))
    .filter((record) => now - Number(record.lastPaidCheckAt || 0) <= RECHECK_WINDOW_MS)
    .sort((a, b) => Number(b.lastPaidCheckAt || 0) - Number(a.lastPaidCheckAt || 0))[0];

  if (!match) return { eligible: false, matchedAt: null, hoursLeft: 0 };

  const expiresAt = Number(match.lastPaidCheckAt) + RECHECK_WINDOW_MS;
  const hoursLeft = Math.max(0, Math.ceil((expiresAt - now) / (60 * 60 * 1000)));

  return { eligible: true, matchedAt: Number(match.lastPaidCheckAt), hoursLeft };
}

function rememberPaidChecks({ userId, files, batchId, source }) {
  const paidAt = Date.now();
  let changed = false;

  for (const file of files || []) {
    if (file?.type !== "CHECK" && file?.type !== "RESALE") continue;

    const fileName = String(file.file_name || file.fileName || "").trim();
    if (!fileName) continue;

    const fileUniqueId = String(file.file_unique_id || file.fileUniqueId || "").trim();
    const normalizedName = normalizeFileNameForRecheck(fileName);

    const existing = checkHistory.find((record) => {
      return (
        String(record.userId) === String(userId) &&
        normalizeFileNameForRecheck(record.fileName) === normalizedName
      );
    });

    if (existing) {
      existing.fileName = fileName;
      existing.fileUniqueId = fileUniqueId || existing.fileUniqueId || null;
      existing.normalizedFileName = normalizedName;
      existing.lastPaidCheckAt = paidAt;
      existing.batchId = batchId || existing.batchId || null;
      existing.source = source || "payment-confirmed";
      existing.lastPaidType = file.type || "CHECK";
      changed = true;
    } else {
      checkHistory.push({
        userId,
        fileName,
        normalizedFileName: normalizedName,
        fileUniqueId: fileUniqueId || null,
        lastPaidCheckAt: paidAt,
        batchId: batchId || null,
        source: source || "payment-confirmed",
        lastPaidType: file.type || "CHECK"
      });
      changed = true;
    }
  }

  cleanupCheckHistory();
  if (changed) saveCheckHistory();
}

loadCheckHistory();
cleanupCheckHistory();
setInterval(cleanupCheckHistory, 60 * 60 * 1000);

// =====================
// HELPERS + PAYMENT PROOF PARSER
// =====================
function safeText(s) {
  return (s || "").toString();
}

function getUserFullName(user) {
  return `${safeText(user?.first_name || "")} ${safeText(user?.last_name || "")}`
    .replace(/\s+/g, " ")
    .trim() || "N/A";
}

function safeFileName(name) {
  const fallback = `file_${Date.now()}`;

  return String(name || fallback)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim() || fallback;
}

function ensureTmpDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeLoose(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractMoneyAmount(text) {
  const s = String(text || "");
  const patterns = [
    /\b(?:KSH|KES|KSHS|K)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
    /\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:KSH|KES|KSHS)\b/i
  ];

  for (const pattern of patterns) {
    const match = s.match(pattern);
    if (match) {
      const n = Number(String(match[1]).replace(/,/g, ""));
      if (Number.isFinite(n)) return Math.round(n);
    }
  }

  return null;
}

function extractPaidAmount(text) {
  const s = oneLine(text);

  const patterns = [
    /\b(?:KSH|KES|KSHS)\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s+(?:has\s+been\s+)?paid\s+to\b/i,
    /\bConfirmed\.?\s*(?:KSH|KES|KSHS)?\s*([0-9][0-9,]*(?:\.\d{1,2})?).{0,90}\bpaid\s+to\b/i,
    /\bpaid\s+(?:KSH|KES|KSHS)\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s+to\b/i
  ];

  for (const pattern of patterns) {
    const match = s.match(pattern);
    if (match) {
      const n = Number(String(match[1]).replace(/,/g, ""));
      if (Number.isFinite(n)) return Math.round(n);
    }
  }

  return extractMoneyAmount(s);
}

function extractMpesaCode(text) {
  const s = String(text || "").toUpperCase();
  const firstWord = s.trim().split(/\s+/)[0] || "";
  const firstCandidate = normalizeProofCode(firstWord);

  if (/^[A-Z0-9]{10}$/.test(firstCandidate) && /[A-Z]/.test(firstCandidate) && /\d/.test(firstCandidate)) {
    return firstCandidate;
  }

  const matches = s.match(/\b[A-Z0-9]{10}\b/g) || [];
  for (const item of matches) {
    const code = normalizeProofCode(item);
    if (/[A-Z]/.test(code) && /\d/.test(code)) return code;
  }

  return "";
}

function extractProofTime(text) {
  const s = oneLine(text);

  const match1 = s.match(/\bon\s+([0-3]?\d[\/.-][01]?\d[\/.-]\d{2,4})\s+at\s+([0-2]?\d:[0-5]\d\s*(?:AM|PM)?)/i);
  if (match1) return `${match1[1]} ${match1[2]}`.trim();

  const match2 = s.match(/\b([0-3]?\d[\/.-][01]?\d[\/.-]\d{2,4})\s+([0-2]?\d:[0-5]\d\s*(?:AM|PM)?)/i);
  if (match2) return `${match2[1]} ${match2[2]}`.trim();

  const match3 = s.match(/\b([0-2]?\d:[0-5]\d\s*(?:AM|PM)?)\b/i);
  if (match3) return match3[1].trim();

  return "";
}

function extractPaidRecipient(text) {
  const s = oneLine(text);

  const match = s.match(/\bpaid\s+to\s+(.+?)(?:\.?\s+on\b|\.?\s+New\s+M[- ]?PESA|\.?\s+M[- ]?PESA\s+Balance|\.?\s+Transaction\b|\.?\s+Amount\b|$)/i);
  if (!match) return "";

  return String(match[1] || "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function buildPaymentProofCandidates(rawText) {
  const raw = String(rawText || "");
  const candidates = [];
  const seen = new Set();

  function addBlock(block, source) {
    const clean = String(block || "").trim();
    if (!clean) return;

    const compact = clean.replace(/\s+/g, " ").trim();
    const key = compact.slice(0, 250);
    if (seen.has(key)) return;
    seen.add(key);

    candidates.push({ block: clean, source });
  }

  const codeRegex = /\b[A-Z0-9]{10}\b/g;
  const matches = [];
  let m;

  while ((m = codeRegex.exec(raw.toUpperCase())) !== null) {
    const code = normalizeProofCode(m[0]);
    if (/[A-Z]/.test(code) && /\d/.test(code)) matches.push({ index: m.index, code });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const nextStart = matches[i + 1]?.index || raw.length;
    const end = Math.min(nextStart, start + 900);
    addBlock(raw.slice(start, end), "code-window");
  }

  const paidRegex = /\bpaid\s+to\b/gi;
  while ((m = paidRegex.exec(raw)) !== null) {
    const start = Math.max(0, m.index - 160);
    const end = Math.min(raw.length, m.index + 900);
    addBlock(raw.slice(start, end), "paid-to-window");
  }

  if (candidates.length === 0) addBlock(raw.slice(0, 1200), "whole-text");

  return candidates;
}

function scorePaymentCandidate(candidate, expectedAmount) {
  const block = candidate.block || "";
  const compact = normalizeLoose(block);
  const compactRecipient = normalizeLoose(PAYMENT_PROOF_RECIPIENT);
  const compactTill = normalizeLoose(TILL_NUMBER);

  const code = extractMpesaCode(block);
  const paidTo = /\bpaid\s+to\b/i.test(block);
  const receivedFrom = /\breceived\b/i.test(block) || /\breceived\s+(?:KSH|KES|KSHS)/i.test(block);
  const sentTo = /\bsent\s+to\b/i.test(block);
  const confirmed = /\bconfirmed\b/i.test(block);

  const amount = paidTo ? extractPaidAmount(block) : extractMoneyAmount(block);
  const amountMatch = Number(amount) === Number(expectedAmount);
  const recipient = extractPaidRecipient(block);
  const recipientMatch = compactRecipient ? compact.includes(compactRecipient) : false;
  const tillMatch = compactTill ? compact.includes(compactTill) : false;
  const time = extractProofTime(block);
  const duplicateCode = code ? isProofCodeUsed(code) : false;

  let score = 0;

  if (paidTo) score += 90;
  if (confirmed) score += 15;
  if (recipientMatch) score += 70;
  if (amountMatch) score += 60;
  if (code) score += 25;
  if (time) score += 8;
  if (tillMatch) score += 10;

  if (amount && !amountMatch) score -= 35;
  if (duplicateCode) score -= 80;
  if (receivedFrom) score -= 100;
  if (sentTo && !paidTo) score -= 40;

  return {
    ...candidate,
    score,
    amount,
    amountMatch,
    code,
    duplicateCode,
    paidTo,
    receivedFrom,
    sentTo,
    confirmed,
    recipient,
    recipientMatch,
    tillMatch,
    detectedTime: time
  };
}

function parsePaymentProofText(text, expectedAmount) {
  const raw = String(text || "");
  const candidates = buildPaymentProofCandidates(raw)
    .map((candidate) => scorePaymentCandidate(candidate, expectedAmount))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0] || scorePaymentCandidate({ block: raw, source: "fallback" }, expectedAmount);

  let confidence = "Low";
  if (best.amountMatch && best.code && best.recipientMatch && best.paidTo && !best.duplicateCode) {
    confidence = "High";
  } else if (best.amountMatch && best.code && best.paidTo && !best.duplicateCode) {
    confidence = "Medium";
  } else if (best.amountMatch && best.recipientMatch && best.paidTo && !best.duplicateCode) {
    confidence = "Medium";
  }

  const warnings = [];

  if (!best.paidTo) warnings.push("Paid-to transaction not clearly detected");
  if (!best.amount) warnings.push("Amount not detected");
  if (best.amount && !best.amountMatch) warnings.push(`Amount mismatch: expected ${expectedAmount} KES`);
  if (!best.code) warnings.push("Transaction code not detected");
  if (best.duplicateCode) warnings.push("Transaction code was already used before");
  if (!best.recipientMatch) warnings.push("Recipient not clearly matched");

  return {
    amount: best.amount || null,
    amountMatch: Boolean(best.amountMatch),
    code: best.code || "",
    duplicateCode: Boolean(best.duplicateCode),
    recipient: best.recipient || (best.recipientMatch ? PAYMENT_PROOF_RECIPIENT : ""),
    recipientMatch: Boolean(best.recipientMatch),
    tillMatch: Boolean(best.tillMatch),
    detectedTime: best.detectedTime || "",
    confidence,
    warnings,
    selectedSource: best.source || "unknown",
    selectedPaidTo: Boolean(best.paidTo),
    candidateCount: candidates.length
  };
}

function proofValue(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "Not detected";
  return String(value);
}

function initBatchTracking(target) {
  if (!target.sentItemKeys) target.sentItemKeys = {};
  if (!target.inProgressItemKeys) target.inProgressItemKeys = {};
}

function makeDocumentDeliveryKey(doc) {
  return [
    "document",
    doc.file_unique_id || doc.file_id || "unknown",
    doc.file_size || 0,
    safeFileName(doc.file_name || "unknown")
  ].join(":");
}

function makePhotoDeliveryKey(photo) {
  return [
    "photo",
    photo.file_unique_id || photo.file_id || "unknown",
    photo.file_size || 0
  ].join(":");
}

function startBatchItemOnce(target, key) {
  initBatchTracking(target);

  if (target.sentItemKeys[key] || target.inProgressItemKeys[key]) return false;

  target.inProgressItemKeys[key] = Date.now();
  return true;
}

function markBatchItemSent(target, key) {
  initBatchTracking(target);
  delete target.inProgressItemKeys[key];
  target.sentItemKeys[key] = Date.now();
}

function clearBatchItemProgress(target, key) {
  initBatchTracking(target);
  delete target.inProgressItemKeys[key];
}

function batchOpenedMessage(userId) {
  return `✅ Batch delivery opened for user ${userId}.

send /donebatch
send /cancelbatch`;
}

function resellerCodeMatches(value) {
  if (!RESALE_ENABLED) return false;
  const given = String(value || "").trim();
  if (!given) return false;
  return given.toLowerCase() === RESELLER_CODE.toLowerCase();
}

async function downloadTelegramFileToTemp(fileId, ext) {
  const tmpDir = path.join(os.tmpdir(), "jk-payment-proof");
  ensureTmpDir(tmpDir);

  const fileLink = await bot.telegram.getFileLink(fileId);
  const res = await fetch(fileLink.href || String(fileLink));

  if (!res.ok) throw new Error(`Failed to download Telegram file. HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const localPath = path.join(
    tmpDir,
    `${Date.now()}_${Math.random().toString(36).slice(2)}${ext || ".jpg"}`
  );

  fs.writeFileSync(localPath, buffer);
  return localPath;
}

function promiseTimeout(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(label || "Timed out")), ms));
}

async function extractOcrTextFromImage(localPath) {
  if (!PAYMENT_OCR_ENABLED) return { ok: false, text: "", status: "disabled", error: "OCR disabled" };
  if (!Tesseract) return { ok: false, text: "", status: "package-missing", error: "tesseract.js not installed" };

  try {
    const result = await Promise.race([
      Tesseract.recognize(localPath, "eng"),
      promiseTimeout(PAYMENT_OCR_TIMEOUT_MS, "OCR timeout")
    ]);

    return { ok: true, text: result?.data?.text || "", status: "ok", error: "" };
  } catch (err) {
    return { ok: false, text: "", status: "failed", error: safeText(err?.message || err) };
  }
}

// =====================
// KEYBOARDS
// =====================
function mainKeyboard() {
  return {
    keyboard: [
      [{ text: KEY_SEND_DOC }],
      [{ text: KEY_SEND_MPESA }],
      [{ text: KEY_CONTACT_SUPPORT }],
      [{ text: KEY_CANCEL }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

function startInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(KEY_SEND_DOC, "START_SEND_DOC")],
    [Markup.button.callback(KEY_SEND_MPESA, "START_PAYMENT_HELP")]
  ]);
}

function batchSizeKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("1", "BATCH_COUNT_1"),
      Markup.button.callback("2", "BATCH_COUNT_2"),
      Markup.button.callback("3", "BATCH_COUNT_3"),
      Markup.button.callback("4", "BATCH_COUNT_4"),
      Markup.button.callback("5", "BATCH_COUNT_5")
    ],
    [
      Markup.button.callback("6", "BATCH_COUNT_6"),
      Markup.button.callback("7", "BATCH_COUNT_7"),
      Markup.button.callback("8", "BATCH_COUNT_8"),
      Markup.button.callback("9", "BATCH_COUNT_9"),
      Markup.button.callback("10", "BATCH_COUNT_10")
    ],
    [Markup.button.callback("\u274C Cancel document", "TYPE_CANCEL")]
  ]);
}

function typeInlineKeyboard(allowRecheck, allowResale, resaleVerified) {
  const rows = [];
  const publicDiscountExclusive = isPublicDiscountExclusiveMode();

  if (!publicDiscountExclusive) {
    if (allowRecheck) {
      rows.push([
        Markup.button.callback(
          `\u{1F501} CLICK TO RECHECK (${RECHECK_PRICE_KES} KES)`,
          "TYPE_RECHECK"
        )
      ]);
    } else {
      rows.push([
        Markup.button.callback(
          `\u2705 CLICK TO CHECK (${CHECK_PRICE_KES} KES)`,
          "TYPE_CHECK"
        )
      ]);
    }
  }

  if (SIMILARITY_ONLY_ENABLED) {
    rows.push([
      Markup.button.callback(
        `\u{1F4CA} SIMILARITY REPORT ONLY (${SIMILARITY_ONLY_PRICE_KES} KES)`,
        "TYPE_SIMILARITY"
      )
    ]);
  }

  if (allowResale) {
    rows.push([
      Markup.button.callback(
        resaleButtonLabel(resaleVerified),
        "TYPE_RESALE"
      )
    ]);
  }

  rows.push([
    Markup.button.callback(
      "\u274C Cancel document",
      "TYPE_CANCEL"
    )
  ]);

  return Markup.inlineKeyboard(rows);
}

function uploadContinueKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Done Uploading", "DONE_UPLOADING")],
    [Markup.button.callback("❌ Cancel document", "TYPE_CANCEL")]
  ]);
}

function paymentMethodKeyboard() {
  const rows = [
    [Markup.button.callback("\u{1F1F0}\u{1F1EA} M-Pesa STK", "PAYMENT_METHOD_MPESA")]
  ];

  if (INTERNATIONAL_PAYMENT_ENABLED) {
    rows.push([Markup.button.callback("\u{1F3E6} Kenyan Bank Payment", "PAYMENT_METHOD_INTL")]);
  }

  if (TZ_OTHER_PAYMENT_ENABLED) {
    rows.push([Markup.button.callback("\u{1F1F9}\u{1F1FF} Tanzania / Other Countries", "PAYMENT_METHOD_TZ_OTHER")]);
  }

  rows.push([Markup.button.callback("\u274C Cancel payment attempt", "PAYMENT_CANCEL")]);

  return Markup.inlineKeyboard(rows);
}

function internationalPayKeyboard(checkoutUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.url("\u{1F3E6} Pay via Kenyan Bank", checkoutUrl)],
    [Markup.button.callback("\u274C Cancel payment attempt", "PAYMENT_CANCEL")]
  ]);
}

function paymentWaitKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("\u{1F501} Resend STK Push", "STK_RESEND")],
    [Markup.button.callback("\u{1F4DE} Change phone number", "STK_CHANGE_PHONE")],
    [Markup.button.callback("\u274C Cancel payment attempt", "PAYMENT_CANCEL")]
  ]);
}

function manualPaymentWaitKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("\u274C Cancel payment attempt", "PAYMENT_CANCEL")]
  ]);
}

async function replyMarkdownSafe(ctx, message, extra = {}) {
  try {
    await ctx.reply(message, { parse_mode: "Markdown", ...extra });
  } catch {
    await ctx.reply(message, { ...extra });
  }
}

function adminQuickCommands(userId) {
  return "";
}

function extractAdminActionUserId(text) {
  const s = String(text || "");
  const patterns = [
    /User ID:\s*(\d{3,30})/i,
    /User:\s*(\d{3,30})/i,
    /\/filebatch\s+(\d{3,30})/i,
    /\/reply\s+(\d{3,30})/i
  ];

  for (const pattern of patterns) {
    const match = s.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function adminActionKeyboard(userId, variant) {
  const rows = [];

  if (variant === "paymentProof") {
    rows.push([
      Markup.button.callback("💬 Reply", `ADMIN_REPLY_${userId}`),
      Markup.button.callback("✅ Confirm", `ADMIN_PAID_${userId}`)
    ]);

    rows.push([Markup.button.callback("🛑 Cancel Pay", `ADMIN_CANCEL_PAYMENT_${userId}`)]);

    rows.push([Markup.button.callback("📦 Filebatch", `ADMIN_FILEBATCH_${userId}`)]);
  } else if (variant === "document") {
    rows.push([
      Markup.button.callback("📦 Filebatch", `ADMIN_FILEBATCH_${userId}`),
      Markup.button.callback("💬 Reply", `ADMIN_REPLY_${userId}`),
      Markup.button.callback("✅ Confirm", `ADMIN_PAID_${userId}`)
    ]);

    rows.push([Markup.button.callback("🛑 Cancel Pay", `ADMIN_CANCEL_PAYMENT_${userId}`)]);

    rows.push([
      Markup.button.callback("ℹ️ AI Unavail", `ADMIN_AI_NOTE_${userId}`),
      Markup.button.callback("🧾 Till", `ADMIN_TILL_NOTICE_${userId}`),
      Markup.button.callback("⭐ AI Star", `ADMIN_AI_STAR_NOTE_${userId}`)
    ]);
  } else if (variant === "delivery") {
    rows.push([Markup.button.callback("📦 Filebatch", `ADMIN_FILEBATCH_${userId}`)]);
    rows.push([Markup.button.callback("💬 Reply", `ADMIN_REPLY_${userId}`)]);
    rows.push([Markup.button.callback("✅ Confirm", `ADMIN_PAID_${userId}`)]);
  } else if (variant === "paid") {
    rows.push([Markup.button.callback("📦 Filebatch", `ADMIN_FILEBATCH_${userId}`)]);
    rows.push([Markup.button.callback("💬 Reply", `ADMIN_REPLY_${userId}`)]);
  } else if (variant === "replyOnly") {
    rows.push([Markup.button.callback("💬 Reply", `ADMIN_REPLY_${userId}`)]);
  } else {
    rows.push([Markup.button.callback("📦 Filebatch", `ADMIN_FILEBATCH_${userId}`)]);
    rows.push([Markup.button.callback("💬 Reply", `ADMIN_REPLY_${userId}`)]);
    rows.push([Markup.button.callback("✅ Confirm", `ADMIN_PAID_${userId}`)]);
  }

  return Markup.inlineKeyboard(rows);
}

async function sendAdminMessage(text, extra = {}) {
  const userIdForButtons = extractAdminActionUserId(text);
  const adminButtons = extra.adminButtons;
  const finalExtra = { ...extra };

  delete finalExtra.adminButtons;

  if (!finalExtra.parse_mode) finalExtra.parse_mode = "Markdown";

  if (userIdForButtons && adminButtons && !finalExtra.reply_markup) {
    finalExtra.reply_markup = adminActionKeyboard(userIdForButtons, adminButtons).reply_markup;
  }

  try {
    await bot.telegram.sendMessage(ADMIN_ID, text, finalExtra);
  } catch {
    try {
      const fallbackExtra = { ...finalExtra };
      delete fallbackExtra.parse_mode;
      await bot.telegram.sendMessage(ADMIN_ID, text, fallbackExtra);
    } catch (e2) {
      console.error("Admin message failed:", e2?.message || e2);
    }
  }
}

function normalizePhoneTo254(phoneRaw) {
  const t = String(phoneRaw || "").trim().replace(/\s+/g, "");
  if (!t) return null;
  if (/^0(?:7|1)\d{8}$/.test(t)) return "254" + t.slice(1);
  return null;
}

function formatPhone254ForAdmin(phone254) {
  const s = String(phone254 || "").trim();

  if (/^254(?:7|1)\d{8}$/.test(s)) {
    return "0" + s.slice(3);
  }

  return s || "N/A";
}

function makeBatchId(userId) {
  return `JK_BATCH_${userId}_${Date.now()}`;
}

function makePaymentAttemptRef(userId) {
  return `JKPAY${userId}${Date.now()}${Math.floor(Math.random() * 100000)}`;
}

function createEmptySubmission() {
  return {
    stage: STAGE_WAIT_BATCH_SIZE,
    expectedFiles: null,
    files: [],
    currentFileIndex: null,
    amount: null,
    batchId: null,
    api_ref: null,
    phone: null,
    invoiceId: null,
    paid: false,
    createdAt: Date.now(),
    stkSentAt: null,
    resendCount: 0,
    paymentAttempts: [],
    pendingInitialDocument: null,
    resellerVerified: false
  };
}

function isTimeInWindowUTC(currentHHMM, startHHMM, endHHMM) {
  if (startHHMM < endHHMM) return currentHHMM >= startHHMM && currentHHMM < endHHMM;
  return currentHHMM >= startHHMM || currentHHMM < endHHMM;
}

function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm");
  return isTimeInWindowUTC(currentTime, INACTIVE_START_UTC, INACTIVE_END_UTC);
}

function isDiscountPublicActive() {
  const hasWindow = Boolean(DISCOUNT_START_EAT && DISCOUNT_END_EAT);

  if (!hasWindow) {
    return DISCOUNT_PUBLIC_ENABLED;
  }

  const currentEat = moment().utcOffset(180).format("HH:mm");
  return isTimeInWindowUTC(currentEat, DISCOUNT_START_EAT, DISCOUNT_END_EAT);
}

function isPublicDiscountExclusiveMode() {
  return RESALE_ENABLED && isDiscountPublicActive();
}

function discountPublicModeText() {
  const currentEat = moment().utcOffset(180).format("HH:mm");
  const hasWindow = Boolean(DISCOUNT_START_EAT && DISCOUNT_END_EAT);

  if (!hasWindow) {
    return "Manual env mode. DISCOUNT_PUBLIC_ENABLED=" + (DISCOUNT_PUBLIC_ENABLED ? "1" : "0");
  }

  return (
    "Auto time mode\n" +
    "Now EAT: " + currentEat + "\n" +
    "Window: " + DISCOUNT_START_EAT + " to " + DISCOUNT_END_EAT + " EAT\n" +
    "Public discount active: " + (isDiscountPublicActive() ? "YES" : "NO")
  );
}

// =====================
// BOT DISPLAY NAME STATUS
// =====================
async function syncBotDisplayName(force = false) {
  const inactive = isBotInactivePeriod();
  const mode = inactive ? "OFFLINE" : "ONLINE";
  const desiredName = inactive ? BOT_OFFLINE_NAME : BOT_ONLINE_NAME;

  if (!force && lastAppliedBotNameMode === mode) return;

  try {
    await bot.telegram.callApi("setMyName", { name: desiredName });
    lastAppliedBotNameMode = mode;
    console.log(`Bot display name synced: ${desiredName}`);
  } catch (err) {
    console.error("Failed to sync bot display name:", err?.description || err?.message || err);
  }
}

function startBotDisplayNameScheduler() {
  syncBotDisplayName(true);

  setInterval(() => {
    syncBotDisplayName(false);
  }, 60 * 1000);
}

async function notifyInactivePeriod(ctx) {
  await replyMarkdownSafe(ctx, MESSAGES.inactive().trim(), { reply_markup: mainKeyboard() });
}

function getCurrentPendingFile(sub) {
  if (!sub) return null;
  if (sub.currentFileIndex === null || sub.currentFileIndex === undefined) return null;
  return sub.files[sub.currentFileIndex] || null;
}

function getSubmissionCounts(sub) {
  let checks = 0;
  let rechecks = 0;
  let similarities = 0;
  let resales = 0;

  for (const file of sub.files || []) {
    if (file.type === "CHECK") checks += 1;
    if (file.type === "RECHECK") rechecks += 1;
    if (file.type === "SIMILARITY") similarities += 1;
    if (file.type === "RESALE") resales += 1;
  }

  return { checks, rechecks, similarities, resales, total: checks + rechecks + similarities + resales };
}

function calculateSubmissionAmount(sub) {
  const counts = getSubmissionCounts(sub);
  return (
    counts.checks * CHECK_PRICE_KES +
    counts.rechecks * RECHECK_PRICE_KES +
    counts.similarities * SIMILARITY_ONLY_PRICE_KES +
    counts.resales * RESALE_PRICE_KES
  );
}

function formatBatchSummary(sub) {
  const counts = getSubmissionCounts(sub);
  const lines = [`• Check: ${counts.checks}`, `• Recheck: ${counts.rechecks}`];

  if (SIMILARITY_ONLY_ENABLED || counts.similarities > 0) {
    lines.push(`• Similarity Only: ${counts.similarities}`);
  }

  if (RESALE_ENABLED || counts.resales > 0) lines.push(`• ${RESALE_LABEL_TITLE}: ${counts.resales}`);
  lines.push(`• Files: ${counts.total}`);

  return lines.join("\n");
}

function getBatchKindLabel(sub) {
  const counts = getSubmissionCounts(sub);
  return `${counts.checks} CHECK, ${counts.rechecks} RECHECK, ${counts.similarities} SIMILARITY, ${counts.resales} ${RESALE_LABEL}`;
}

function canAcceptMoreFiles(sub) {
  return sub.files.length < (sub.expectedFiles || 0);
}

function stopStatusPolling(apiRef) {
  if (activePollers[apiRef]) {
    clearInterval(activePollers[apiRef]);
    delete activePollers[apiRef];
  }
}

function resetSubmission(userId) {
  const sub = submissions[userId];
  if (sub?.paymentAttempts?.length) {
    for (const apiRef of sub.paymentAttempts) stopStatusPolling(apiRef);
  }
  delete submissions[userId];
  delete supportRequests[userId];
}

async function notifyUserCancelledToAdmin(user, label) {
  if (user.id === ADMIN_ID) return;

  await sendAdminMessage(
    `❌ ${label || "User cancelled submission"}\nUser ID: ${user.id}\nName: ${getUserFullName(user)}\nUsername: @${safeText(
      user.username || "N/A"
    )}${adminQuickCommands(user.id)}`,
    { adminButtons: "replyOnly" }
  );
}

async function handleCancelRequest(ctx, sourceLabel) {
  const user = ctx.from;

  if (user.id === ADMIN_ID) {
    await ctx.reply("No user submission to cancel.");
    return;
  }

  const sub = submissions[user.id];

  if (sub && sub.stage !== STAGE_PAID) {
    const isPayment = sub.stage === STAGE_WAIT_PAYMENT || sub.stage === STAGE_WAIT_PHONE;
    const label = isPayment ? "User cancelled unpaid payment attempt" : "User cancelled unpaid document submission";

    await notifyUserCancelledToAdmin(user, label);
    resetSubmission(user.id);

    await ctx.reply("❌ Cancelled. You can start again.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  const job = getLatestActivePaidJob(user.id);

  if (!job) {
    await ctx.reply("No active submission to cancel.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  if (String(job.status || "").toUpperCase() === "CANCEL_REQUESTED") {
    await ctx.reply("Cancellation request already sent.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  if (Date.now() < Number(job.cancelAllowedAt || 0)) {
    await ctx.reply(paidJobCancelWaitText(job), {
      reply_markup: mainKeyboard()
    });
    return;
  }

  const updatedJob = markPaidJobCancellationRequested(job.jobId);

  await sendAdminMessage(
    `⚠️ Paid cancellation request\nUser ID: ${user.id}\nName: ${getUserFullName(user)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nAmount: ${safeText(updatedJob?.amount || "N/A")} KES\nBatch: ${safeText(
      updatedJob?.batchId || "N/A"
    )}\nPaid at: ${moment(updatedJob?.paidAt || Date.now()).format("YYYY-MM-DD HH:mm")}\nMax time elapsed: Yes`,
    { adminButtons: "delivery" }
  );

  await ctx.reply("✅ Cancellation request sent to admin.", {
    reply_markup: mainKeyboard()
  });
}

function hasActiveSubmissionForUploads(sub) {
  return !!sub && [
    STAGE_WAIT_UPLOADS,
    STAGE_WAIT_FILE_TYPE,
    STAGE_WAIT_PAYMENT_METHOD,
    STAGE_WAIT_PHONE,
    STAGE_WAIT_PAYMENT
  ].includes(sub.stage);
}

function ensureFreshSubmission(userId) {
  if (!submissions[userId]) submissions[userId] = createEmptySubmission();
  return submissions[userId];
}

function createStoredFileFromDocument(userId, doc) {
  const fileName = doc.file_name || `file_${Date.now()}`;
  const fileUniqueId = doc.file_unique_id || null;
  const eligibility = getRecheckEligibility(userId, fileName, fileUniqueId);

  return {
    file_id: doc.file_id,
    file_unique_id: fileUniqueId,
    file_name: fileName,
    type: null,
    price: null,
    uploadedAt: Date.now(),
    recheckEligible: eligibility.eligible,
    recheckMatchedAt: eligibility.matchedAt,
    recheckHoursLeft: eligibility.hoursLeft
  };
}

function adminReportTypeLabel(kind) {
  const t = String(kind || "").toUpperCase();

  if (t === "CHECK") return "CHECK - FULL REPORT";
  if (t === "RECHECK") return "RECHECK - FULL REPORT";
  if (t === "SIMILARITY") return "SIMILARITY ONLY";
  if (t === "RESALE") return RESALE_LABEL_TITLE.toUpperCase() + " - FULL REPORT";

  return "PENDING SERVICE CHOICE";
}

function adminReportInstruction(kind) {
  const t = String(kind || "").toUpperCase();

  if (t === "SIMILARITY") {
    return "Generate: Similarity report only. DO NOT generate AI report.";
  }

  if (t === "CHECK" || t === "RECHECK" || t === "RESALE") {
    return "Generate: Similarity + AI report where available.";
  }

  return "Generate: Wait until client chooses service.";
}

function buildAdminDocumentCaption({ userId, name, usernameText, file, fileNumber, expectedFiles }) {
  const fileNo = Number(fileNumber || 0) || "?";
  const total = Number(expectedFiles || 0) || "?";
  const fileName = safeText(file?.file_name || file?.fileName || "N/A");
  const service = adminReportTypeLabel(file?.type);
  const price = file?.price ? String(file.price) + " KES" : "Not selected yet";

  const lines = [
    "📨 Document received",
    "",
    "File: " + fileNo + "/" + total,
    "Service: " + service,
    "Price: " + price,
    "Filename: " + fileName
  ];

  if (file?.recheckEligible) {
    lines.push("Recheck eligibility: YES (" + safeText(file.recheckHoursLeft || "?") + "h left)");
  }

  lines.push(
    "",
    "User ID: " + userId,
    "Name: " + safeText(name),
    "Username: @" + safeText(usernameText || "N/A")
  );

  return lines.join("\n");
}

async function sendSelectedDocumentToAdmin(user, sub, file, fileNumber) {
  if (!file) return;
  if (file.adminSentAt) return;

  const userId = user.id;
  const name = getUserFullName(user);
  const usernameText = safeText(user.username || "N/A");

  const caption = buildAdminDocumentCaption({
    userId,
    name,
    usernameText,
    file,
    fileNumber,
    expectedFiles: sub?.expectedFiles
  });

  try {
    if (!file.sourceChatId || !file.sourceMessageId) {
      throw new Error("Missing original document message details.");
    }

    const copied = await bot.telegram.copyMessage(ADMIN_ID, file.sourceChatId, file.sourceMessageId, {
      caption,
      reply_markup: adminActionKeyboard(userId, "document").reply_markup
    });

    file.adminSentAt = Date.now();
    file.adminMessageId = copied?.message_id || null;
  } catch (err) {
    await sendAdminMessage(
      "⚠️ Document selected but copy failed. Details below.\n\n" + caption,
      { adminButtons: "document" }
    );

    try {
      if (file.sourceChatId && file.sourceMessageId) {
        await bot.telegram.forwardMessage(ADMIN_ID, file.sourceChatId, file.sourceMessageId);
      }
    } catch {}

    file.adminSentAt = Date.now();
  }
}

async function showUploadProcedure(ctx) {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  return ctx.reply(UPLOAD_PROCEDURE_MESSAGE, {
    reply_markup: mainKeyboard()
  });
}

async function showUploadProcedure(ctx) {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  return ctx.reply(UPLOAD_PROCEDURE_MESSAGE, {
    reply_markup: mainKeyboard()
  });
}

async function showUploadProcedure(ctx) {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  return ctx.reply(UPLOAD_PROCEDURE_MESSAGE, {
    reply_markup: mainKeyboard()
  });
}

async function beginSubmissionFlow(ctx) {
  return showUploadProcedure(ctx);
}
async function showPaymentHelp(ctx) {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(ctx, MESSAGES.paymentHelp, { reply_markup: mainKeyboard() });
}

async function askForFileType(ctx, sub) {
  const file = getCurrentPendingFile(sub);
  if (!file) return;

  const fileNumber = sub.currentFileIndex + 1;

  const similarityHint = SIMILARITY_ONLY_ENABLED
    ? `\n\n\u{1F4CA} You can also choose *SIMILARITY REPORT ONLY* if you do not need AI report.`
    : "";

  const recheckNote = isPublicDiscountExclusiveMode()
    ? [
        SIMILARITY_ONLY_ENABLED
          ? `📊 Choose *SIMILARITY REPORT ONLY* if you only need the similarity report.`
          : "",
        RESALE_ENABLED
          ? `🏷️ Public *${RESALE_LABEL_TITLE}* is available now. Choose it for the discounted full report.`
          : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    : file.recheckEligible
      ? `✅ This file qualifies for *RECHECK*.\n\nTap *CLICK TO RECHECK* to continue.${similarityHint}`
      : `ℹ️ Recheck not available for this file.\n\nTap *CLICK TO CHECK* to continue.${similarityHint}`;

  const resaleNote = isPublicDiscountExclusiveMode()
    ? discountTimeLineForMessage()
    : RESALE_ENABLED
      ? `\n\n🏷️ *${RESALE_LABEL_TITLE}* Requires a Code. Wait For Public Access.${discountTimeLineForMessage()}`
      : "";

  await ctx.reply(
    `📄 File Received: *${safeText(file.file_name)}*\n\nFile *${fileNumber}* of *${sub.expectedFiles}*.\n\n${recheckNote}${resaleNote}`,
    {
      parse_mode: "Markdown",
      reply_markup: typeInlineKeyboard(
        Boolean(file.recheckEligible),
        RESALE_ENABLED,
        Boolean(sub.resellerVerified)
      ).reply_markup
    }
  );
}

async function moveBatchToPaymentMethodStep(ctx, sub) {
  const counts = getSubmissionCounts(sub);

  if (counts.total === 0) {
    await ctx.reply("\u274C Please upload at least one file first.", { reply_markup: mainKeyboard() });
    return;
  }

  sub.amount = calculateSubmissionAmount(sub);
  sub.currency = "KES";
  sub.batchId = sub.batchId || makeBatchId(ctx.from.id);
  sub.stage = STAGE_WAIT_PAYMENT_METHOD;
  sub.currentFileIndex = null;

  const summary = formatBatchSummary(sub);

  const bankLine = INTERNATIONAL_PAYMENT_ENABLED
    ? "\n\u{1F3E6} Kenyan Bank Payment: *" + sub.amount + " KES*"
    : "";

  const tzOtherLine = TZ_OTHER_PAYMENT_ENABLED
    ? (
        isInternationalCheckOnly(sub)
          ? "\n\u{1F1F9}\u{1F1FF} Tanzania / Other Countries: *" + formatPaymentMoney(calculateInternationalAmount(sub), TZ_OTHER_CURRENCY) + "*"
          : "\n\u{1F1F9}\u{1F1FF} Tanzania / Other Countries: not available for discount/resale"
      )
    : "";

  await replyMarkdownSafe(
    ctx,
    "\u{1F4E6} Batch summary\n\n" + summary + "\n\n" +
      "\u{1F1F0}\u{1F1EA} M-Pesa STK: *" + sub.amount + " KES*" +
      bankLine +
      tzOtherLine +
      "\n\nChoose payment method.",
    {
      reply_markup: paymentMethodKeyboard().reply_markup
    }
  );
}

async function moveBatchToPhoneStep(ctx, sub) {
  sub.amount = calculateSubmissionAmount(sub);
  sub.currency = "KES";
  sub.batchId = sub.batchId || makeBatchId(ctx.from.id);
  sub.stage = STAGE_WAIT_PHONE;
  sub.paymentMethod = "MPESA";

  const summary = formatBatchSummary(sub);

  await replyMarkdownSafe(ctx, MESSAGES.askPhoneBatch(summary, sub.amount), {
    reply_markup: mainKeyboard()
  });
}

async function finalizeFileTypeSelection(ctx, sub, kind) {
  const file = getCurrentPendingFile(sub);
  if (!file) {
    sub.stage = STAGE_WAIT_UPLOADS;
    sub.currentFileIndex = null;
    return;
  }

  file.type = kind;
  if (kind === "CHECK") file.price = CHECK_PRICE_KES;
  if (kind === "RECHECK") file.price = RECHECK_PRICE_KES;
  if (kind === "SIMILARITY") file.price = SIMILARITY_ONLY_PRICE_KES;
  if (kind === "RESALE") file.price = RESALE_PRICE_KES;

  const justCompletedNumber = sub.currentFileIndex + 1;

  await sendSelectedDocumentToAdmin(ctx.from, sub, file, justCompletedNumber);

  sub.currentFileIndex = null;

  if (sub.files.length >= sub.expectedFiles) {
    await moveBatchToPaymentMethodStep(ctx, sub);
    return;
  }

  sub.stage = STAGE_WAIT_UPLOADS;
  await ctx.reply(
    `✅ ${typeDisplayName(kind)} saved for file ${justCompletedNumber}.\n\nSend file ${sub.files.length + 1} of ${sub.expectedFiles}.`,
    {
      parse_mode: "Markdown",
      reply_markup: uploadContinueKeyboard().reply_markup
    }
  );
}

async function handleFileTypeSelected(ctx, kind) {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (!sub || sub.stage !== STAGE_WAIT_FILE_TYPE) return ctx.answerCbQuery("No pending file type selection.");

  const file = getCurrentPendingFile(sub);
  if (!file) {
    sub.stage = STAGE_WAIT_UPLOADS;
    sub.currentFileIndex = null;
    return ctx.answerCbQuery("No pending file.");
  }

  if (kind === "RECHECK" && !file.recheckEligible) {
    kind = "CHECK";
    await ctx.answerCbQuery("Treated as CHECK.");
    await ctx.reply("⚠️ Recheck not available. Treated as *CHECK*.", { parse_mode: "Markdown" });
  } else if (kind === "RESALE") {
    if (!RESALE_ENABLED) {
      await ctx.answerCbQuery(`${RESALE_LABEL_TITLE} is not enabled.`);
      return ctx.reply(`⚠️ ${RESALE_LABEL_TITLE} is not enabled right now.`);
    }

    if (isDiscountPublicActive()) {
      sub.resellerVerified = true;
      await ctx.answerCbQuery(`${RESALE_LABEL_TITLE} Applied`);
      await ctx.reply(`✅ ${RESALE_LABEL_TITLE} Applied`);
      await finalizeFileTypeSelection(ctx, sub, "RESALE");
      return;
    }

    if (!sub.resellerVerified) {
      sub.stage = STAGE_WAIT_RESELLER_CODE;
      await ctx.answerCbQuery("Code required");
      return ctx.reply(`🔐 Send ${RESALE_LABEL_TITLE} Code.`, {
        parse_mode: "Markdown",
        reply_markup: mainKeyboard()
      });
    }

    await ctx.answerCbQuery(`${RESALE_LABEL_TITLE} selected`);
  } else {
    await ctx.answerCbQuery(`${kind} selected`);
  }

  await finalizeFileTypeSelection(ctx, sub, kind);
}

// =====================
// INTASEND REST HELPERS
// =====================
function formatPaymentMoney(amount, currency) {
  const n = Number(amount);
  const clean = Number.isFinite(n)
    ? (Number.isInteger(n) ? String(n) : n.toFixed(2))
    : String(amount || "0");

  return `${clean} ${currency || "KES"}`;
}

function calculateInternationalAmount(sub) {
  const counts = getSubmissionCounts(sub);
  const amount =
    (counts.checks + counts.rechecks) * INTERNATIONAL_CHECK_PRICE_USD +
    counts.similarities * INTERNATIONAL_SIMILARITY_ONLY_PRICE;

  return Number(amount.toFixed(2));
}

function isInternationalCheckOnly(sub) {
  const counts = getSubmissionCounts(sub);
  const billableFiles = counts.checks + counts.rechecks + counts.similarities;
  return counts.total > 0 && billableFiles === counts.total && counts.resales === 0;
}

function extractCheckoutUrl(payload) {
  return (
    payload?.url ||
    payload?.checkout_url ||
    payload?.payment_link ||
    payload?.data?.url ||
    payload?.data?.checkout_url ||
    payload?.data?.payment_link ||
    payload?.checkout?.url ||
    null
  );
}

async function intasendCheckoutRequest(endpoint, body) {
  const checkoutToken = INTASEND_SECRET_KEY;

  if (!checkoutToken) {
    throw new Error("Missing IntaSend secret key for checkout.");
  }

  const res = await fetch(`${INTASEND_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: `Bearer ${checkoutToken}`
    },
    body: JSON.stringify(body || {})
  });

  const text = await res.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      (data && (data.detail || data.message || JSON.stringify(data))) || `HTTP ${res.status}`
    );
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

async function intasendCreateCheckout({ amount, currency, api_ref, user }) {
  if (!IntaSend) {
    throw new Error("intasend-node package missing. Run npm install intasend-node");
  }

  if (!INTASEND_PUBLISHABLE_KEY) {
    throw new Error("Missing IntaSend publishable key for checkout.");
  }

  const intasend = new IntaSend(
    INTASEND_PUBLISHABLE_KEY,
    INTASEND_SECRET_KEY,
    INTASEND_TEST
  );

  const collection = intasend.collection();

  return collection.charge({
    first_name: safeText(user?.first_name || ""),
    last_name: safeText(user?.last_name || ""),
    amount: Number(amount),
    currency,
    api_ref,
    comment: "JK Turnitin Kenyan Bank Payment",
    host: PUBLIC_BASE_URL,
    redirect_url: PUBLIC_BASE_URL
  });
}

async function intasendRequest(endpoint, body) {
  const res = await fetch(`${INTASEND_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: `Bearer ${INTASEND_SECRET_KEY}`
    },
    body: JSON.stringify(body || {})
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      (data && (data.detail || data.message || JSON.stringify(data))) || `HTTP ${res.status}`
    );
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

async function intasendGet(endpoint, query = {}) {
  const url = new URL(`${INTASEND_API_BASE}${endpoint}`);

  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${INTASEND_SECRET_KEY}`
    }
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      (data && (data.detail || data.message || JSON.stringify(data))) || `HTTP ${res.status}`
    );
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

function extractApiRef(payload) {
  return (
    payload?.api_ref ||
    payload?.apiRef ||
    payload?.invoice?.api_ref ||
    payload?.invoice?.apiRef ||
    payload?.data?.api_ref ||
    payload?.data?.apiRef ||
    payload?.payload?.api_ref ||
    payload?.payload?.apiRef ||
    null
  );
}

function extractInvoiceId(payload) {
  return (
    payload?.invoice_id ||
    payload?.invoiceId ||
    payload?.id ||
    payload?.invoice?.invoice_id ||
    payload?.invoice?.invoiceId ||
    payload?.invoice?.id ||
    payload?.data?.invoice_id ||
    payload?.data?.invoiceId ||
    payload?.data?.invoice?.invoice_id ||
    payload?.data?.invoice?.invoiceId ||
    payload?.data?.invoice?.id ||
    payload?.payload?.invoice_id ||
    payload?.payload?.invoiceId ||
    payload?.payload?.invoice?.invoice_id ||
    payload?.payload?.invoice?.invoiceId ||
    payload?.payload?.invoice?.id ||
    null
  );
}

function extractState(payload) {
  return (
    payload?.state ||
    payload?.status ||
    payload?.invoice?.state ||
    payload?.invoice?.status ||
    payload?.data?.state ||
    payload?.data?.status ||
    payload?.data?.invoice?.state ||
    payload?.data?.invoice?.status ||
    payload?.payload?.state ||
    payload?.payload?.status ||
    payload?.payload?.invoice?.state ||
    payload?.payload?.invoice?.status ||
    null
  );
}

function normalizePaymentState(raw) {
  const s = String(raw || "").trim().toUpperCase();

  if (["COMPLETE", "COMPLETED", "SUCCESS", "SUCCEEDED", "PAID", "TS100"].includes(s)) return "COMPLETE";
  if (["FAILED", "FAIL", "ERROR", "TF103", "TF106"].includes(s)) return "FAILED";
  if (["CANCELLED", "CANCELED", "TC108"].includes(s)) return "CANCELLED";
  if (["EXPIRED", "TIMEOUT", "TIMEDOUT"].includes(s)) return "EXPIRED";
  if (["PENDING", "PROCESSING", "IN_PROGRESS", "INPROGRESS", "TP101", "TP102", "BP101", "BP103"].includes(s)) return "PENDING";

  return s || "UNKNOWN";
}

async function intasendSendStkPush({ amount, phone_number, api_ref }) {
  return intasendRequest("/payment/mpesa-stk-push/", {
    amount: String(amount),
    phone_number,
    api_ref
  });
}

async function intasendCheckPaymentStatus({ invoice_id }) {
  return intasendRequest("/payment/status/", { invoice_id });
}

async function intasendListInvoicesByApiRef(apiRef) {
  return intasendGet("/invoices/", { api_ref: apiRef });
}

function extractInvoicesFromListResponse(resp) {
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp?.results)) return resp.results;
  if (Array.isArray(resp?.data)) return resp.data;
  if (Array.isArray(resp?.invoices)) return resp.invoices;
  return [];
}

function getBatchById(batchId) {
  for (const [userId, sub] of Object.entries(submissions)) {
    if (String(sub?.batchId || "") === String(batchId || "")) {
      return { userId: Number(userId), sub };
    }
  }
  return null;
}

async function markPaymentComplete({ apiRef, invoiceId, state, source }) {
  const ref = getPaymentRef(apiRef);
  if (!ref) return false;
  if (ref.status === "COMPLETE") return false;

  const currentStatus = String(ref.status || "").toUpperCase();
  if (["ADMIN_CANCELLED", "CANCELLED", "FAILED", "EXPIRED"].includes(currentStatus)) {
    stopStatusPolling(apiRef);
    return false;
  }

  if (ref.pendingProof?.code && !isProofCodeUsed(ref.pendingProof.code)) {
    rememberUsedProofCode(ref.pendingProof.code, {
      userId: ref.userId,
      apiRef,
      amount: ref.pendingProof.amount || ref.amount,
      source: source || "payment-confirmed"
    });
  }

  const completedAt = Date.now();

  updatePaymentRef(apiRef, {
    status: "COMPLETE",
    invoiceId: invoiceId || ref.invoiceId || null,
    completedAt,
    lastState: state || "COMPLETE",
    completionSource: source || "unknown"
  });

  const completedRef = getPaymentRef(apiRef) || {
    ...ref,
    status: "COMPLETE",
    invoiceId: invoiceId || ref.invoiceId || null,
    completedAt,
    lastState: state || "COMPLETE",
    completionSource: source || "unknown"
  };

  stopStatusPolling(apiRef);

  const batchLookup = getBatchById(ref.batchId);
  const userId = batchLookup?.userId || ref.userId;
  const sub = batchLookup?.sub || submissions[userId];

  recordDailySale({
    apiRef,
    ref: completedRef,
    userId,
    invoiceId: invoiceId || ref.invoiceId || null,
    source: source || "unknown"
  });

  if (sub) {
    sub.paid = true;
    sub.stage = STAGE_PAID;
    sub.invoiceId = invoiceId || sub.invoiceId || ref.invoiceId || null;
  }

  createPaidJob({ userId, apiRef, ref: completedRef, invoiceId, source });

  const filesForHistory = sub?.files || completedRef.files || [];

  rememberPaidChecks({
    userId,
    files: filesForHistory,
    batchId: completedRef.batchId || sub?.batchId || null,
    source: source || "payment-confirmed"
  });

  try {
    await bot.telegram.sendMessage(
      userId,
      MESSAGES.paidMsgBatch(completedRef.amount, completedRef.summary || "Batch payment"),
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    await sendAdminMessage(`❌ Could not message user ${userId}. Error: ${safeText(e?.message || e)}`);
  }

  await sendAdminMessage(
    `✅ PAID\nUser: ${userId}\nName: ${safeText(completedRef.name || "N/A")}\nUsername: @${safeText(
      completedRef.username || "N/A"
    )}\nPhone: ${formatPhone254ForAdmin(completedRef.phone || sub?.phone)}\nAmount: ${safeText(
      completedRef.amount
    )} KES\nType: ${safeText(completedRef.kind || "BATCH")}\nRef: ${safeText(
      invoiceId || completedRef.invoiceId || apiRef || "N/A"
    )}`,
    { adminButtons: "paid" }
  );

  resetSubmission(userId);
  return true;
}

async function handlePaymentAttemptFailed({ apiRef, invoiceId, state, source, reason }) {
  const ref = getPaymentRef(apiRef);
  if (!ref) return false;
  if (ref.status === "COMPLETE") return false;

  if (["FAILED", "CANCELLED", "EXPIRED"].includes(String(ref.status || "").toUpperCase())) return false;

  updatePaymentRef(apiRef, {
    status: state || "FAILED",
    invoiceId: invoiceId || ref.invoiceId || null,
    lastState: state || "FAILED",
    failureSource: source || "unknown",
    failureReason: reason || null,
    failedAt: Date.now()
  });

  stopStatusPolling(apiRef);

  const batchLookup = getBatchById(ref.batchId);
  const userId = batchLookup?.userId || ref.userId;
  const sub = batchLookup?.sub || submissions[userId];

  if (sub && !sub.paid) sub.stage = STAGE_WAIT_PAYMENT;

  try {
    await bot.telegram.sendMessage(
      userId,
      `❌ Payment was not completed.\n\nReason: ${safeText(reason || state || "Payment failed")}\n\nYou can try again or pay via:\n${tillLine()}`,
      { parse_mode: "Markdown", reply_markup: paymentWaitKeyboard().reply_markup }
    );
  } catch {}

  await sendAdminMessage(
    `⚠️ PAYMENT ATTEMPT FAILED\nUser ID: ${safeText(userId)}\nName: ${safeText(
      ref.name || "N/A"
    )}\nUsername: @${safeText(ref.username || "N/A")}\nPhone: ${formatPhone254ForAdmin(
      ref.phone
    )}\napiref: ${safeText(apiRef)}\ninvoiceid: ${safeText(
      invoiceId || ref.invoiceId || "N/A"
    )}\nState: ${safeText(state || "FAILED")}\nSource: ${safeText(source || "unknown")}\nReason: ${safeText(reason || "N/A")}`,
    { adminButtons: "replyOnly" }
  );

  return true;
}

async function queryPaymentStatus(invoiceId, apiRef) {
  let best = null;
  let lastError = null;

  if (invoiceId) {
    try {
      const resp = await intasendCheckPaymentStatus({ invoice_id: invoiceId });
      best = {
        raw: resp,
        invoiceId: extractInvoiceId(resp) || invoiceId,
        apiRef: extractApiRef(resp) || apiRef || null,
        state: normalizePaymentState(extractState(resp)),
        failedReason:
          resp?.invoice?.failed_reason ||
          resp?.failed_reason ||
          resp?.detail ||
          resp?.message ||
          null,
        source: "payment-status"
      };

      if (best.state === "COMPLETE") return best;
    } catch (err) {
      lastError = err;
    }
  }

  if (apiRef) {
    try {
      const resp = await intasendListInvoicesByApiRef(apiRef);
      const invoices = extractInvoicesFromListResponse(resp);

      const matching =
        invoices.find((item) => String(item?.api_ref || item?.apiRef || "") === String(apiRef)) ||
        invoices[0] ||
        null;

      if (matching) {
        const invoiceResult = {
          raw: resp,
          invoiceId: extractInvoiceId(matching) || invoiceId || null,
          apiRef: extractApiRef(matching) || apiRef,
          state: normalizePaymentState(extractState(matching)),
          failedReason:
            matching?.failed_reason ||
            matching?.invoice?.failed_reason ||
            matching?.detail ||
            matching?.message ||
            null,
          source: "invoice-list"
        };

        if (invoiceResult.state === "COMPLETE") return invoiceResult;
        if (!best || best.state === "UNKNOWN" || best.state === "PENDING") best = invoiceResult;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (best) return best;
  if (lastError) throw lastError;

  return {
    raw: {},
    invoiceId: invoiceId || null,
    apiRef: apiRef || null,
    state: "UNKNOWN",
    failedReason: null,
    source: "none"
  };
}

function startStatusPolling({ userId, apiRef, invoiceId }) {
  if (!apiRef) return;

  stopStatusPolling(apiRef);
  let attempts = 0;

  activePollers[apiRef] = setInterval(async () => {
    attempts += 1;

    if (attempts > STATUS_POLL_MAX_ATTEMPTS) {
      stopStatusPolling(apiRef);
      await sendAdminMessage(
        `⚠️ Payment watcher stopped.\nUser ID: ${userId}\napiref: ${safeText(apiRef)}\ninvoiceid: ${safeText(invoiceId || "N/A")}`
      );
      return;
    }

    const ref = getPaymentRef(apiRef);
    if (!ref || ref.status === "COMPLETE") {
      stopStatusPolling(apiRef);
      return;
    }

    const sub = submissions[userId];
    if (sub?.paid) {
      stopStatusPolling(apiRef);
      return;
    }

    try {
      const statusResp = await queryPaymentStatus(invoiceId || ref.invoiceId, apiRef);

      updatePaymentRef(apiRef, {
        invoiceId: statusResp.invoiceId || invoiceId || ref.invoiceId || null,
        lastState: statusResp.state,
        lastStatusSource: statusResp.source,
        lastPolledAt: Date.now(),
        pollAttempts: attempts
      });

      if (statusResp.state === "COMPLETE") {
        await markPaymentComplete({
          apiRef,
          invoiceId: statusResp.invoiceId || invoiceId || ref.invoiceId || null,
          state: statusResp.state,
          source: statusResp.source || "status-poll"
        });
        return;
      }

      if (["FAILED", "CANCELLED", "EXPIRED"].includes(statusResp.state)) {
        await handlePaymentAttemptFailed({
          apiRef,
          invoiceId: statusResp.invoiceId || invoiceId || ref.invoiceId || null,
          state: statusResp.state,
          source: statusResp.source || "status-poll",
          reason: statusResp.failedReason
        });
      }
    } catch (err) {
      updatePaymentRef(apiRef, {
        lastPolledAt: Date.now(),
        pollAttempts: attempts,
        lastPollError: safeText(err?.message || err),
        lastPollStatus: err?.status || null
      });

      if (attempts === 1 || attempts % 6 === 0) {
        await sendAdminMessage(
          `⚠️ IntaSend status poll failed\nUser ID: ${userId}\napiref: ${safeText(
            apiRef
          )}\nAttempt: ${attempts}\nError: ${safeText(err?.message || err)}`
        );
      }
    }
  }, STATUS_POLL_INTERVAL_MS);
}

function schedulePaymentTimeoutReminder(userId, apiRef) {
  setTimeout(async () => {
    const ref = getPaymentRef(apiRef);
    const sub = submissions[userId];

    if (!ref) return;
    if (ref.status === "COMPLETE") return;
    if (["FAILED", "CANCELLED", "EXPIRED"].includes(String(ref.status || "").toUpperCase())) return;
    if (!sub || sub.paid) return;
    if (sub.stage !== STAGE_WAIT_PAYMENT) return;

    try {
      await bot.telegram.sendMessage(
        userId,
        `⏳ Payment not confirmed yet.\n\nIf you already paid and confirmation takes more than *1 minute*, send the M-Pesa confirmation message or payment screenshot here.\n\nManual payment:\n*Buy Goods Till:* ${TILL_NUMBER}`,
        { parse_mode: "Markdown", reply_markup: paymentWaitKeyboard().reply_markup }
      );
    } catch {}
  }, PAYMENT_TIMEOUT_MS);
}

async function handleMpesaProofText(ctx, sub, text) {
  const user = ctx.from;
  const expectedAmount = Number(sub?.amount || 0);
  const found = findLatestPendingPaymentRefByUser(user.id);
  const parsed = parsePaymentProofText(text, expectedAmount);

  if (found) {
    const [apiRef] = found;
    updatePaymentRef(apiRef, {
      pendingProof: {
        type: "mpesa-text",
        amount: parsed.amount,
        amountMatch: parsed.amountMatch,
        code: parsed.code || null,
        duplicateCode: parsed.duplicateCode,
        recipient: parsed.recipient || null,
        recipientMatch: parsed.recipientMatch,
        tillMatch: parsed.tillMatch,
        detectedTime: parsed.detectedTime || null,
        confidence: parsed.confidence,
        receivedAt: Date.now()
      }
    });
  }

  const warningsText = parsed.warnings.length ? parsed.warnings.map((w) => `• ${w}`).join("\n") : "None";

  await sendAdminMessage(
    `🧾 M-Pesa message received\nUser ID: ${user.id}\nName: ${getUserFullName(user)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\n\nExpected amount: ${expectedAmount} KES\n\nDetected:\nAmount: ${proofValue(
      parsed.amount ? `${parsed.amount} KES` : ""
    )}\nAmount match: ${proofValue(parsed.amountMatch)}\nRecipient: ${proofValue(
      parsed.recipient
    )}\nRecipient match: ${proofValue(parsed.recipientMatch)}\nCode: ${proofValue(
      parsed.code
    )}\nCode already used: ${proofValue(parsed.duplicateCode)}\nTime/date: ${proofValue(
      parsed.detectedTime
    )}\nConfidence: ${parsed.confidence}\n\nWarnings:\n${warningsText}`,
    { adminButtons: "paymentProof" }
  );

  try {
    await ctx.reply("✅ Payment proof received. Admin will verify.", {
      reply_markup: paymentWaitKeyboard().reply_markup
    });
  } catch {}
}

async function handlePaymentScreenshotProof(ctx, sub) {
  const user = ctx.from;
  const expectedAmount = Number(sub?.amount || 0);
  const photos = ctx.message.photo || [];
  const largest = photos[photos.length - 1];

  if (!largest) {
    await ctx.reply("❌ No screenshot found.");
    return;
  }

  let localPath = null;
  let ocrStatus = "not-run";
  let ocrError = "";
  let ocrText = "";
  let parsed = null;

  try {
    if (Number(largest.file_size || 0) > PAYMENT_OCR_MAX_BYTES) {
      ocrStatus = "skipped-large-image";
      ocrError = `Image is above ${PAYMENT_OCR_MAX_MB} MB`;
    } else {
      localPath = await downloadTelegramFileToTemp(largest.file_id, ".jpg");
      const ocr = await extractOcrTextFromImage(localPath);
      ocrStatus = ocr.status;
      ocrError = ocr.error || "";
      ocrText = ocr.text || "";
    }

    parsed = parsePaymentProofText(ocrText, expectedAmount);

    const found = findLatestPendingPaymentRefByUser(user.id);
    if (found) {
      const [apiRef] = found;
      updatePaymentRef(apiRef, {
        pendingProof: {
          type: "screenshot-ocr",
          amount: parsed.amount,
          amountMatch: parsed.amountMatch,
          code: parsed.code || null,
          duplicateCode: parsed.duplicateCode,
          recipient: parsed.recipient || null,
          recipientMatch: parsed.recipientMatch,
          tillMatch: parsed.tillMatch,
          detectedTime: parsed.detectedTime || null,
          confidence: parsed.confidence,
          ocrStatus,
          receivedAt: Date.now()
        }
      });
    }

    const warningsText = parsed.warnings.length ? parsed.warnings.map((w) => `• ${w}`).join("\n") : "None";

    await sendAdminMessage(
      `🖼️ Payment screenshot received\nUser ID: ${user.id}\nName: ${getUserFullName(user)}\nUsername: @${safeText(
        user.username || "N/A"
      )}\n\nExpected amount: ${expectedAmount} KES\nOCR status: ${ocrStatus}${ocrError ? `\nOCR note: ${safeText(ocrError)}` : ""}\n\nDetected:\nAmount: ${proofValue(
        parsed.amount ? `${parsed.amount} KES` : ""
      )}\nAmount match: ${proofValue(parsed.amountMatch)}\nRecipient: ${proofValue(
        parsed.recipient
      )}\nRecipient match: ${proofValue(parsed.recipientMatch)}\nCode: ${proofValue(
        parsed.code
      )}\nCode already used: ${proofValue(parsed.duplicateCode)}\nTime/date: ${proofValue(
        parsed.detectedTime
      )}\nConfidence: ${parsed.confidence}\n\nWarnings:\n${warningsText}`,
      { adminButtons: "paymentProof" }
    );

    try {
      await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
    } catch {}

    await ctx.reply("✅ Payment proof received. Admin will verify.", {
      reply_markup: paymentWaitKeyboard().reply_markup
    });
  } catch (err) {
    await sendAdminMessage(
      `🖼️ Payment screenshot received\nUser ID: ${user.id}\nName: ${getUserFullName(user)}\nUsername: @${safeText(
        user.username || "N/A"
      )}\n\nExpected amount: ${expectedAmount} KES\nOCR failed: ${safeText(err?.message || err)}`,
      { adminButtons: "paymentProof" }
    );

    try {
      await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
    } catch {}

    await ctx.reply("✅ Payment proof received. Admin will verify.", {
      reply_markup: paymentWaitKeyboard().reply_markup
    });
  } finally {
    if (localPath) fs.unlink(localPath, () => {});
  }
}

function internationalBankFallbackLines(apiRef) {
  if (!INTERNATIONAL_BANK_FALLBACK_ENABLED || !INTERNATIONAL_BANK_ACCOUNT_NUMBER) return [];

  return [
    "",
    "Backup manual bank transfer:",
    "Bank: *" + safeText(INTERNATIONAL_BANK_NAME || "Co-operative Bank") + "*",
    "*Account Number:* *" + safeText(INTERNATIONAL_BANK_ACCOUNT_NUMBER) + "*",
    "*Payment Description:* *" + safeText(apiRef) + "*"
  ];
}

function internationalBankVerificationLine() {
  if (!INTERNATIONAL_BANK_ACCOUNT_NAME) return "";
  return "\nExpected bank recipient: " + safeText(INTERNATIONAL_BANK_ACCOUNT_NAME);
}

function buildInternationalPaymentMessage({ intlAmount, currency, apiRef }) {
  const amountText = formatPaymentMoney(intlAmount, currency);

  const lines = [
    "\u{1F3E6} Kenyan Bank Payment",
    "",
    "Amount: *" + amountText + "*",
    "Reference: *" + safeText(apiRef) + "*",
    "",
    "Tap *Pay via Kenyan Bank* and complete the checkout.",
    "Use *PesaLink* or the available Kenyan bank option.",
    "",
    "Put the *Reference Number* in *Payment Description*.",
    "The bot confirms automatically after successful payment.",
    "",
    "If it does not confirm within 2 minutes, send payment proof here.",
    ...internationalBankFallbackLines(apiRef)
  ];

  return lines.join("\n");
}

async function startInternationalPayment(ctx, sub) {
  const userId = ctx.from.id;

  if (!INTERNATIONAL_PAYMENT_ENABLED) {
    await ctx.reply("\u{1F3E6} Kenyan Bank Payment is not available right now.", {
      reply_markup: paymentMethodKeyboard().reply_markup
    });
    return;
  }

  const apiRef = makePaymentAttemptRef(userId);
  const summary = formatBatchSummary(sub);
  const bankAmount = calculateSubmissionAmount(sub);
  const currency = "KES";

  putPaymentRef(apiRef, {
    userId,
    batchId: sub.batchId,
    kind: getBatchKindLabel(sub),
    amount: bankAmount,
    currency,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    summary,
    phone: null,
    name: getUserFullName(ctx.from),
    username: ctx.from.username || "N/A",
    invoiceId: null,
    status: "PENDING",
    lastState: "PENDING",
    mode: INTASEND_TEST ? "TEST" : "LIVE",
    paymentMethod: "KENYAN_BANK",
    pendingProof: null,
    files: (sub.files || []).map((file) => ({
      file_id: file.file_id || null,
      file_unique_id: file.file_unique_id || null,
      file_name: file.file_name || null,
      type: file.type || null,
      price: file.price || null,
      recheckEligible: Boolean(file.recheckEligible)
    }))
  });

  try {
    const checkout = await intasendCreateCheckout({
      amount: bankAmount,
      currency,
      api_ref: apiRef,
      user: ctx.from
    });

    const checkoutUrl = extractCheckoutUrl(checkout);
    const checkoutInvoiceId = extractInvoiceId(checkout);

    if (!checkoutUrl) throw new Error("Checkout link was not returned by IntaSend.");

    sub.api_ref = apiRef;
    sub.invoiceId = checkoutInvoiceId || null;
    sub.stage = STAGE_WAIT_PAYMENT;
    sub.paymentMethod = "KENYAN_BANK";
    sub.amount = bankAmount;
    sub.currency = currency;
    sub.paymentAttempts.push(apiRef);

    updatePaymentRef(apiRef, {
      invoiceId: checkoutInvoiceId || null,
      checkoutUrl,
      checkoutResponseAt: Date.now(),
      rawResponseSnapshot: {
        url: checkoutUrl,
        invoice_id: checkoutInvoiceId || null,
        api_ref: apiRef,
        amount: bankAmount,
        currency
      }
    });

    await ctx.reply(
      buildInternationalPaymentMessage({ intlAmount: bankAmount, currency, apiRef }),
      {
        parse_mode: "Markdown",
        reply_markup: internationalPayKeyboard(checkoutUrl).reply_markup
      }
    );

    startStatusPolling({ userId, apiRef, invoiceId: checkoutInvoiceId || null });
    scheduleManualProofReminder(
      userId,
      apiRef,
      "KENYAN_BANK",
      "If Kenyan bank payment is not confirmed yet, send payment proof here."
    );
  } catch (err) {
    updatePaymentRef(apiRef, {
      status: "FAILED_TO_CREATE_CHECKOUT",
      failureSource: "kenyan-bank-checkout",
      failureMessage: safeText(err?.message || err),
      failureStatus: err?.status || null,
      failurePayload: err?.payload || null
    });

    await ctx.reply(
      "\u274C Kenyan Bank Payment link could not be created right now.\n\nPlease choose M-Pesa STK or Tanzania / Other Countries payment.",
      { reply_markup: paymentMethodKeyboard().reply_markup }
    );

    await sendAdminMessage(
      "\u274C Kenyan bank checkout error\nUser ID: " + userId +
        "\nName: " + getUserFullName(ctx.from) +
        "\nUsername: @" + safeText(ctx.from.username || "N/A") +
        "\nAmount: " + formatPaymentMoney(bankAmount, currency) +
        "\nError: " + safeText(err?.message || err),
      { adminButtons: "replyOnly" }
    );
  }
}

async function handleInternationalPaymentProofText(ctx, sub, text) {
  const user = ctx.from;
  const amount = formatPaymentMoney(sub.amount, sub.currency || "KES");

  await sendAdminMessage(
    "\u{1F3E6} Kenyan bank payment proof received\nUser ID: " + user.id +
      "\nName: " + getUserFullName(user) +
      "\nUsername: @" + safeText(user.username || "N/A") +
      "\n\nExpected amount: " + amount +
      "\nMethod: " + INTERNATIONAL_METHODS_TEXT + internationalBankVerificationLine() +
      "\n\nMessage:\n" + safeText(text),
    { adminButtons: "paymentProof" }
  );

  await ctx.reply("\u2705 Payment proof received. Admin will verify.", {
    reply_markup: manualPaymentWaitKeyboard().reply_markup
  });
}

async function handleInternationalPaymentScreenshotProof(ctx, sub) {
  const user = ctx.from;
  const amount = formatPaymentMoney(sub.amount, sub.currency || "KES");

  await sendAdminMessage(
    "\u{1F3E6} Kenyan bank payment screenshot received\nUser ID: " + user.id +
      "\nName: " + getUserFullName(user) +
      "\nUsername: @" + safeText(user.username || "N/A") +
      "\n\nExpected amount: " + amount +
      "\nMethod: " + INTERNATIONAL_METHODS_TEXT + internationalBankVerificationLine(),
    { adminButtons: "paymentProof" }
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch {}

  await ctx.reply("\u2705 Payment proof received. Admin will verify.", {
    reply_markup: manualPaymentWaitKeyboard().reply_markup
  });
}

function scheduleManualProofReminder(userId, apiRef, paymentMethod, message) {
  setTimeout(async () => {
    const ref = getPaymentRef(apiRef);
    const sub = submissions[userId];

    if (!ref) return;
    if (ref.status === "COMPLETE") return;
    if (!sub || sub.paid) return;
    if (sub.stage !== STAGE_WAIT_PAYMENT) return;
    if (String(sub.paymentMethod || "") !== String(paymentMethod || "")) return;
    if (String(sub.api_ref || "") !== String(apiRef || "")) return;

    try {
      await bot.telegram.sendMessage(
        userId,
        message || "If payment is not confirmed yet, send payment proof here.",
        { reply_markup: manualPaymentWaitKeyboard().reply_markup }
      );
    } catch {}
  }, TZ_OTHER_PROOF_WAIT_MINUTES * 60 * 1000);
}

function buildTzOtherPaymentMessage({ amount, currency, apiRef }) {
  const amountText = formatPaymentMoney(amount, currency);

  const lines = [
    "\u{1F1F9}\u{1F1FF} Tanzania / Other Countries",
    "",
    "Amount: *" + amountText + "*",
    "Reference: *" + safeText(apiRef) + "*",
    "",
    "Pay manually to either:",
    "Safaricom M-Pesa: *" + safeText(TZ_OTHER_SAFARICOM_NUMBER) + "*",
    "Airtel Money: *" + safeText(TZ_OTHER_AIRTEL_NUMBER) + "*",
    "Name: *" + safeText(TZ_OTHER_RECIPIENT_NAME) + "*",
    "",
    "Wait up to *" + TZ_OTHER_PROOF_WAIT_MINUTES + " minutes* for admin confirmation.",
    "If confirmation takes more than 1 minute, send the payment message or screenshot here.",
    "",
    "Other countries: send to the Safaricom M-Pesa number using Remitly, WorldRemit, Wise, Taptap Send, or similar."
  ];

  return lines.join("\n");
}

async function startTzOtherPayment(ctx, sub) {
  const userId = ctx.from.id;

  if (!TZ_OTHER_PAYMENT_ENABLED) {
    await ctx.reply("\u{1F1F9}\u{1F1FF} Tanzania / Other Countries payment is not available right now.", {
      reply_markup: paymentMethodKeyboard().reply_markup
    });
    return;
  }

  if (!isInternationalCheckOnly(sub)) {
    await ctx.reply(
      "\u{1F1F9}\u{1F1FF} Tanzania / Other Countries payment is available for CHECK, RECHECK, or Similarity Report Only.\n\nDiscount/resale files should use M-Pesa STK, Kenyan Bank Payment, or contact support.",
      { reply_markup: paymentMethodKeyboard().reply_markup }
    );
    return;
  }

  const apiRef = makePaymentAttemptRef(userId);
  const summary = formatBatchSummary(sub);
  const amount = calculateInternationalAmount(sub);
  const currency = TZ_OTHER_CURRENCY;

  putPaymentRef(apiRef, {
    userId,
    batchId: sub.batchId,
    kind: (getSubmissionCounts(sub).checks + getSubmissionCounts(sub).rechecks + getSubmissionCounts(sub).similarities) + " TZ/OTHER REPORT",
    amount,
    currency,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    summary,
    phone: null,
    name: getUserFullName(ctx.from),
    username: ctx.from.username || "N/A",
    invoiceId: null,
    status: "PENDING",
    lastState: "PENDING",
    mode: "MANUAL",
    paymentMethod: "TZ_OTHER",
    pendingProof: null,
    paymentInstructions: {
      safaricom: TZ_OTHER_SAFARICOM_NUMBER,
      airtel: TZ_OTHER_AIRTEL_NUMBER,
      recipientName: TZ_OTHER_RECIPIENT_NAME
    },
    files: (sub.files || []).map((file) => ({
      file_id: file.file_id || null,
      file_unique_id: file.file_unique_id || null,
      file_name: file.file_name || null,
      type: file.type || null,
      price: file.type === "SIMILARITY" ? INTERNATIONAL_SIMILARITY_ONLY_PRICE : INTERNATIONAL_CHECK_PRICE_USD,
      recheckEligible: Boolean(file.recheckEligible)
    }))
  });

  sub.api_ref = apiRef;
  sub.invoiceId = null;
  sub.stage = STAGE_WAIT_PAYMENT;
  sub.paymentMethod = "TZ_OTHER";
  sub.amount = amount;
  sub.currency = currency;
  sub.paymentAttempts.push(apiRef);

  await ctx.reply(
    buildTzOtherPaymentMessage({ amount, currency, apiRef }),
    {
      parse_mode: "Markdown",
      reply_markup: manualPaymentWaitKeyboard().reply_markup
    }
  );

  await sendAdminMessage(
    "\u{1F4F2} Tanzania / Other Countries payment opened\nUser ID: " + userId +
      "\nName: " + getUserFullName(ctx.from) +
      "\nUsername: @" + safeText(ctx.from.username || "N/A") +
      "\n\nExpected amount: " + formatPaymentMoney(amount, currency) +
      "\nRef: " + apiRef +
      "\nSafaricom: " + TZ_OTHER_SAFARICOM_NUMBER +
      "\nAirtel: " + TZ_OTHER_AIRTEL_NUMBER +
      "\nExpected name: " + TZ_OTHER_RECIPIENT_NAME +
      "\n\nAdmin can confirm if payment arrives.",
    { adminButtons: "paymentProof" }
  );

  scheduleManualProofReminder(
    userId,
    apiRef,
    "TZ_OTHER",
    "If payment is not confirmed yet, send the payment message or screenshot here."
  );
}

async function handleTzOtherPaymentProofText(ctx, sub, text) {
  const user = ctx.from;
  const amount = formatPaymentMoney(sub.amount, sub.currency || TZ_OTHER_CURRENCY);
  const apiRef = sub.api_ref;

  if (apiRef) {
    updatePaymentRef(apiRef, {
      pendingProof: {
        type: "tz-other-text",
        message: safeText(text),
        receivedAt: Date.now()
      }
    });
  }

  await sendAdminMessage(
    "\u{1F4F2} Tanzania / Other Countries proof received\nUser ID: " + user.id +
      "\nName: " + getUserFullName(user) +
      "\nUsername: @" + safeText(user.username || "N/A") +
      "\n\nExpected amount: " + amount +
      "\nSafaricom: " + TZ_OTHER_SAFARICOM_NUMBER +
      "\nAirtel: " + TZ_OTHER_AIRTEL_NUMBER +
      "\nExpected name: " + TZ_OTHER_RECIPIENT_NAME +
      "\n\nCheck sender phone, send-to number/name, amount, and reference." +
      "\n\nMessage:\n" + safeText(text),
    { adminButtons: "paymentProof" }
  );

  await ctx.reply("\u2705 Payment proof received. Admin will verify.", {
    reply_markup: manualPaymentWaitKeyboard().reply_markup
  });
}

async function handleTzOtherPaymentScreenshotProof(ctx, sub) {
  const user = ctx.from;
  const amount = formatPaymentMoney(sub.amount, sub.currency || TZ_OTHER_CURRENCY);
  const apiRef = sub.api_ref;

  if (apiRef) {
    updatePaymentRef(apiRef, {
      pendingProof: {
        type: "tz-other-screenshot",
        receivedAt: Date.now()
      }
    });
  }

  await sendAdminMessage(
    "\u{1F4F2} Tanzania / Other Countries screenshot received\nUser ID: " + user.id +
      "\nName: " + getUserFullName(user) +
      "\nUsername: @" + safeText(user.username || "N/A") +
      "\n\nExpected amount: " + amount +
      "\nSafaricom: " + TZ_OTHER_SAFARICOM_NUMBER +
      "\nAirtel: " + TZ_OTHER_AIRTEL_NUMBER +
      "\nExpected name: " + TZ_OTHER_RECIPIENT_NAME +
      "\n\nCheck sender phone, send-to number/name, amount, and reference.",
    { adminButtons: "paymentProof" }
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch {}

  await ctx.reply("\u2705 Payment proof received. Admin will verify.", {
    reply_markup: manualPaymentWaitKeyboard().reply_markup
  });
}

// =====================
// STK PUSH

// =====================
// STK PUSH
// =====================
async function attemptStkPush(ctx, sub, { mode }) {
  const userId = ctx.from.id;

  if (!sub?.phone || !sub?.amount || !sub?.batchId) {
    sub.stage = STAGE_WAIT_PHONE;
    await ctx.reply("⚠️ Missing payment details. Send phone number again.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  if (mode === "resend" && sub.stkSentAt && Date.now() - sub.stkSentAt < STK_RESEND_COOLDOWN_MS) {
    const remainingSec = Math.ceil((STK_RESEND_COOLDOWN_MS - (Date.now() - sub.stkSentAt)) / 1000);
    if (ctx.answerCbQuery) await ctx.answerCbQuery(`Wait ${remainingSec}s`);
    return;
  }

  if (mode === "resend") {
    sub.resendCount = (sub.resendCount || 0) + 1;
    if (sub.resendCount > STK_MAX_RESENDS) {
      await ctx.reply(`⚠️ Resend limit reached.\n\nPay via:\n${tillLine()}`, {
        parse_mode: "Markdown"
      });
      return;
    }
  }

  const apiRef = makePaymentAttemptRef(userId);
  const summary = formatBatchSummary(sub);

  putPaymentRef(apiRef, {
    userId,
    batchId: sub.batchId,
    kind: getBatchKindLabel(sub),
    amount: sub.amount,
    currency: "KES",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    summary,
    phone: sub.phone,
    name: getUserFullName(ctx.from),
    username: ctx.from.username || "N/A",
    invoiceId: null,
    status: "PENDING",
    lastState: "PENDING",
    mode: INTASEND_TEST ? "TEST" : "LIVE",
    pendingProof: null,
    files: (sub.files || []).map((file) => ({
      file_id: file.file_id || null,
      file_unique_id: file.file_unique_id || null,
      file_name: file.file_name || null,
      type: file.type || null,
      price: file.price || null,
      recheckEligible: Boolean(file.recheckEligible)
    }))
  });

  try {
    const resp = await intasendSendStkPush({
      amount: sub.amount,
      phone_number: sub.phone,
      api_ref: apiRef
    });

    const invoiceId = extractInvoiceId(resp);
    const state = normalizePaymentState(extractState(resp) || "PENDING");

    sub.api_ref = apiRef;
    sub.invoiceId = invoiceId || null;
    sub.stage = STAGE_WAIT_PAYMENT;
    sub.stkSentAt = Date.now();
    sub.paymentAttempts.push(apiRef);

    updatePaymentRef(apiRef, {
      invoiceId: invoiceId || null,
      lastState: state,
      stkResponseAt: Date.now(),
      rawResponseSnapshot: {
        invoice_id: invoiceId || null,
        state,
        api_ref: apiRef
      }
    });

    await ctx.reply(MESSAGES.stkSentWithTill(), {
      parse_mode: "Markdown",
      reply_markup: paymentWaitKeyboard().reply_markup
    });

    startStatusPolling({ userId, apiRef, invoiceId: invoiceId || null });
    schedulePaymentTimeoutReminder(userId, apiRef);
  } catch (err) {
    sub.stage = STAGE_WAIT_PAYMENT;

    updatePaymentRef(apiRef, {
      status: "FAILED_TO_INITIATE",
      failureSource: "stk-init",
      failureMessage: safeText(err?.message || err),
      failureStatus: err?.status || null,
      failurePayload: err?.payload || null
    });

    await ctx.reply(`❌ STK Push failed.\n\nTry again or pay via:\n${tillLine()}`, {
      parse_mode: "Markdown",
      reply_markup: paymentWaitKeyboard().reply_markup
    });

    await sendAdminMessage(
      `❌ STK Push error\nUser ID: ${userId}\nName: ${getUserFullName(ctx.from)}\nUsername: @${safeText(
        ctx.from.username || "N/A"
      )}\nPhone: ${formatPhone254ForAdmin(sub.phone)}\nError: ${safeText(err?.message || err)}`,
      { adminButtons: "replyOnly" }
    );
  }
}

// =====================
// START
// =====================
bot.start(async (ctx) => {
  const user = ctx.from;

  if (user.id === ADMIN_ID) {
    await replyMarkdownSafe(ctx, "👋 Admin mode is ready.", { reply_markup: mainKeyboard() });
    return;
  }

  await sendAdminMessage(
    `🔥 New user started bot\nName: ${getUserFullName(user)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nUser ID: ${user.id}${adminQuickCommands(user.id)}`,
    { adminButtons: "replyOnly" }
  );

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(
    ctx,
    MESSAGES.welcome(CHECK_PRICE_KES, RECHECK_PRICE_KES, RESALE_PRICE_KES),
    { reply_markup: startInlineKeyboard().reply_markup }
  );
});

// =====================
// ADMIN COMMANDS
// =====================
bot.command("discountmode", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  await ctx.reply(
    "Discount mode check\n\n" +
    discountPublicModeText() + "\n\n" +
    "Button: " + (isDiscountPublicActive() ? "PUBLIC DISCOUNT" : "CODE REQUIRED")
  );
});

bot.command("mode", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const nowUtc = moment.utc().format("YYYY-MM-DD HH:mm");
  const nowEat = moment().utcOffset(180).format("YYYY-MM-DD HH:mm");
  const inactive = isBotInactivePeriod();
  const desiredName = inactive ? BOT_OFFLINE_NAME : BOT_ONLINE_NAME;

  await ctx.reply(
    "Bot mode check\n\n" +
    "Now UTC: " + nowUtc + "\n" +
    "Now EAT: " + nowEat + "\n" +
    "Inactive UTC: " + INACTIVE_START_UTC + " to " + INACTIVE_END_UTC + "\n" +
    "Inactive ends EAT: " + INACTIVE_END_EAT_DISPLAY + "\n" +
    "Current mode: " + (inactive ? "OFFLINE" : "ONLINE") + "\n" +
    "Target name: " + desiredName + "\n" +
    "Last applied: " + (lastAppliedBotNameMode || "N/A")
  );
});

bot.command("syncname", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  await syncBotDisplayName(true);

  const inactive = isBotInactivePeriod();
  await ctx.reply(
    "Bot name sync forced.\n\nCurrent mode: " + (inactive ? "OFFLINE" : "ONLINE")
  );
});

bot.command("reply", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").split(" ");
  if (parts.length < 3) return ctx.reply("Usage: /reply <userId> <message>");

  const userId = parts[1];
  const replyText = parts.slice(2).join(" ");

  try {
    await bot.telegram.sendMessage(
      userId,
      `━━━━━━━━━━━━━━━
💬 *JK Turnitin Support*
━━━━━━━━━━━━━━━

${replyText}

━━━━━━━━━━━━━━━`,
      { parse_mode: "Markdown" }
    );

    await ctx.reply(`✅ Sent to ${userId}`);
  } catch (err) {
    await ctx.reply("❌ Failed: " + (err?.message || err));
  }
});

bot.command("filebatch", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) return ctx.reply("Usage: /filebatch <userId> [caption]");

  const userId = parts[1];
  const caption = parts.slice(2).join(" ");

  pendingFileTargets[ADMIN_ID] = {
    userId,
    caption,
    sentCount: 0,
    sentItemKeys: {},
    inProgressItemKeys: {}
  };

  await ctx.reply(batchOpenedMessage(userId));
});

bot.command("donebatch", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const target = pendingFileTargets[ADMIN_ID];
  if (!target) return ctx.reply("No active batch session. Use /filebatch <userId> first.");

  const userId = target.userId;
  const sentCount = target.sentCount || 0;

  delete pendingFileTargets[ADMIN_ID];

  if (sentCount > 0) {
    markLatestPaidJobDelivered(userId);

    try {
      await bot.telegram.sendMessage(userId, REPORTS_DELIVERED_MESSAGE);
    } catch {}
  }

  await ctx.reply(`✅ Batch closed. Sent ${sentCount} item(s) to ${userId}.`);
});

bot.command("cancelbatch", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const target = pendingFileTargets[ADMIN_ID];
  if (!target) return ctx.reply("No active batch session.");

  delete pendingFileTargets[ADMIN_ID];
  await ctx.reply(`✅ Batch session cancelled for user ${target.userId}.`);
});

bot.command("cancelreply", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const replyTarget = pendingAdminReplies[ADMIN_ID];
  if (!replyTarget) return ctx.reply("No active reply session.");

  delete pendingAdminReplies[ADMIN_ID];
  await ctx.reply(`✅ Reply session cancelled for user ${replyTarget.userId}.`);
});

function findLatestPendingPaymentRefByUser(userId) {
  const entries = Object.entries(paymentRefs)
    .filter(([apiRef, value]) => String(value?.userId) === String(userId) && !isPaymentRefClosedForAdmin(value))
    .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0));

  return entries[0] || null;
}

async function manuallyConfirmLatestPaymentForUser(userId, source) {
  const found = findLatestPendingPaymentRefByUser(userId);
  if (!found) return { ok: false, message: `❌ No pending payment found for user ${userId}` };

  const [apiRef, ref] = found;

  await markPaymentComplete({
    apiRef,
    invoiceId: ref.invoiceId || `manual_${Date.now()}`,
    state: "COMPLETE",
    source: source || "admin-manual"
  });

  return {
    ok: true,
    apiRef,
    message: `✅ Manually marked latest payment complete for user ${userId}`
  };
}

function isPaymentRefClosedForAdmin(ref) {
  const status = String(ref?.status || "").toUpperCase();
  return ["COMPLETE", "ADMIN_CANCELLED", "CANCELLED", "FAILED", "EXPIRED"].includes(status);
}

function findOpenPaymentRefsByUser(userId) {
  return Object.entries(paymentRefs)
    .filter(([apiRef, value]) => String(value?.userId) === String(userId) && !isPaymentRefClosedForAdmin(value))
    .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0));
}

async function cancelPaymentProcessForUser(userId, source) {
  const sub = submissions[userId];

  if (sub?.paid || sub?.stage === STAGE_PAID) {
    return {
      ok: false,
      message: `⚠️ User ${userId} is already marked paid. Do not cancel payment from here.`
    };
  }

  const refsByApi = new Map(findOpenPaymentRefsByUser(userId));

  if (Array.isArray(sub?.paymentAttempts)) {
    for (const apiRef of sub.paymentAttempts) {
      const ref = getPaymentRef(apiRef);
      if (ref && String(ref.userId) === String(userId) && !isPaymentRefClosedForAdmin(ref)) {
        refsByApi.set(apiRef, ref);
      }
      stopStatusPolling(apiRef);
    }
  }

  if (sub?.api_ref) stopStatusPolling(sub.api_ref);

  let cancelledRefs = 0;

  for (const [apiRef] of refsByApi.entries()) {
    stopStatusPolling(apiRef);
    updatePaymentRef(apiRef, {
      status: "ADMIN_CANCELLED",
      cancelledAt: Date.now(),
      lastState: "ADMIN_CANCELLED",
      cancelSource: source || "admin-button"
    });
    cancelledRefs += 1;
  }

  if (!sub && cancelledRefs === 0) {
    return {
      ok: false,
      message: `❌ No active unpaid payment process found for user ${userId}.`
    };
  }

  resetSubmission(userId);

  try {
    await bot.telegram.sendMessage(
      userId,
      "❌ Your payment attempt for the uploaded document has been cancelled by admin.\n\nYou can start again by sending your first document directly.",
      { parse_mode: "Markdown", reply_markup: mainKeyboard() }
    );
  } catch (err) {
    await sendAdminMessage(
      `⚠️ Payment process cancelled for user ${userId}, but user message failed: ${safeText(err?.message || err)}`
    );
  }

  return {
    ok: true,
    message: `✅ Payment process cancelled for user ${userId}.\nStopped ${cancelledRefs} pending payment reference(s).`
  };
}

bot.command("paidref", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  const apiRef = parts[1];

  if (!apiRef) return ctx.reply("Usage: /paidref <apiref>");

  const ref = getPaymentRef(apiRef);
  if (!ref) return ctx.reply(`❌ No payment found for apiref: ${apiRef}`);

  await markPaymentComplete({
    apiRef,
    invoiceId: ref.invoiceId || `manual_${Date.now()}`,
    state: "COMPLETE",
    source: "admin-manual"
  });

  await ctx.reply(`✅ Manually marked payment complete for ${apiRef}`);
});

bot.command("paiduser", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  const userId = parts[1];

  if (!userId) return ctx.reply("Usage: /paiduser <userId>");

  const result = await manuallyConfirmLatestPaymentForUser(userId, "admin-manual-command");
  await ctx.reply(result.message);
});

// =====================
// ADMIN QUICK ACTION BUTTONS
// =====================
bot.action(/^ADMIN_FILEBATCH_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  const userId = ctx.match[1];

  pendingFileTargets[ADMIN_ID] = {
    userId,
    caption: "",
    sentCount: 0,
    sentItemKeys: {},
    inProgressItemKeys: {}
  };

  await ctx.answerCbQuery("Filebatch opened");
  await ctx.reply(batchOpenedMessage(userId));
});

bot.action(/^ADMIN_REPLY_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  const userId = ctx.match[1];
  pendingAdminReplies[ADMIN_ID] = { userId };

  await ctx.answerCbQuery("Reply mode opened");
  await ctx.reply(`💬 Reply mode opened for user ${userId}.\nSend message or /cancelreply`);
});

bot.action(/^ADMIN_PAID_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  const userId = ctx.match[1];

  await ctx.answerCbQuery("Checking pending payment...");
  const result = await manuallyConfirmLatestPaymentForUser(userId, "admin-manual-button");
  await ctx.reply(result.message);
});

bot.action(/^ADMIN_CANCEL_PAYMENT_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  const userId = ctx.match[1];

  await ctx.answerCbQuery("Cancelling payment...");
  const result = await cancelPaymentProcessForUser(userId, "admin-cancel-button");
  await ctx.reply(result.message);
});

bot.action(/^ADMIN_AI_NOTE_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  const userId = ctx.match[1];

  try {
    await bot.telegram.sendMessage(userId, AI_UNAVAILABLE_NOTE, { parse_mode: "Markdown" });
    await ctx.answerCbQuery("AI note sent");
    await ctx.reply(`✅ AI unavailable note sent to ${userId}`);
  } catch (err) {
    await ctx.answerCbQuery("Failed");
    await ctx.reply("❌ Failed: " + (err?.message || err));
  }
});



bot.action(/^ADMIN_AI_STAR_NOTE_(\d+)$/, async (ctx) => {

  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");



  const userId = ctx.match[1];



  try {

    await bot.telegram.sendMessage(userId, AI_STAR_NOTE, { parse_mode: "Markdown" });

    await ctx.answerCbQuery("AI star note sent");

    await ctx.reply("✅ AI star note sent to " + userId);

  } catch (err) {

    await ctx.answerCbQuery("Failed");

    await ctx.reply("❌ Failed: " + (err?.message || err));

  }

});



bot.action(/^ADMIN_TILL_NOTICE_(\d+)$/, async (ctx) => {

  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");



  const userId = ctx.match[1];



  try {

    await bot.telegram.sendMessage(userId, mpesaTillNoticeMessage(), { parse_mode: "Markdown" });

    await ctx.answerCbQuery("Till notice sent");

    await ctx.reply("✅ Till payment notice sent to " + userId);

  } catch (err) {

    await ctx.answerCbQuery("Failed");

    await ctx.reply("❌ Failed: " + (err?.message || err));

  }

});


// =====================
// START INLINE BUTTONS
// =====================
bot.action("START_SEND_DOC", async (ctx) => {
  await ctx.answerCbQuery("Upload instructions");
  await beginSubmissionFlow(ctx);
});

bot.action("START_PAYMENT_HELP", async (ctx) => {
  await ctx.answerCbQuery("Opening payment help");
  await showPaymentHelp(ctx);
});

// =====================
// MAIN BUTTONS
// =====================
bot.hears(KEY_SEND_DOC, async (ctx) => {
  await beginSubmissionFlow(ctx);
});

bot.hears("📄 Send Document", async (ctx) => {
  await beginSubmissionFlow(ctx);
});

// Old Telegram keyboards may remain cached briefly; treat the old button as help only.
bot.hears(KEY_SEND_MPESA, async (ctx) => {
  await showPaymentHelp(ctx);
});

bot.hears(KEY_CONTACT_SUPPORT, async (ctx) => {
  supportRequests[ctx.from.id] = true;
  await ctx.reply("💬 Type your message for support.", { reply_markup: mainKeyboard() });
});

bot.hears(KEY_CANCEL, async (ctx) => {
  await handleCancelRequest(ctx, "main");
});

// =====================
// BATCH SIZE SELECTION
// =====================
bot.action(/^BATCH_COUNT_(\d{1,2})$/, async (ctx) => {
  const count = Number(ctx.match[1]);
  const userId = ctx.from.id;

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  if (count < 1 || count > MAX_BATCH_FILES) return ctx.answerCbQuery("Invalid number.");

  const sub = ensureFreshSubmission(userId);
  sub.expectedFiles = count;
  sub.stage = STAGE_WAIT_UPLOADS;

  await ctx.answerCbQuery(`Selected ${count} file(s)`);

  if (sub.pendingInitialDocument) {
    const pending = sub.pendingInitialDocument;

    const storedFile = createStoredFileFromDocument(userId, {
      file_id: pending.fileId,
      file_unique_id: pending.fileUniqueId,
      file_name: pending.fileName
    });

    storedFile.sourceChatId = pending.chatId;
    storedFile.sourceMessageId = pending.messageId;
    storedFile.sourceUsername = pending.username || "N/A";
    storedFile.sourceFirstName = pending.firstName || "";
    storedFile.sourceLastName = pending.lastName || "";

    sub.files.push(storedFile);
    sub.currentFileIndex = sub.files.length - 1;
    sub.stage = STAGE_WAIT_FILE_TYPE;
    sub.pendingInitialDocument = null;

    await ctx.reply(`✅ Selected *${count}* file(s).\n\nFirst document saved as *file 1*.`, {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    });

    await askForFileType(ctx, sub);
    return;
  }

  await ctx.reply(`✅ Selected *${count}* file(s).\n\n${CLEAN_COPY_WARNING}\n\nSend file *1* of *${count}* as a document.`, {
    parse_mode: "Markdown",
    reply_markup: mainKeyboard()
  });
});

// =====================
// DOCUMENT HANDLER
// =====================
bot.on("document", async (ctx) => {
  const user = ctx.from;

  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];

    if (!target) return ctx.reply("Use /filebatch <userId> first.");

    initBatchTracking(target);

    const doc = ctx.message.document;
    const deliveryKey = makeDocumentDeliveryKey(doc);

    if (!startBatchItemOnce(target, deliveryKey)) {
      return ctx.reply(`⚠️ Duplicate document ignored for ${target.userId}`);
    }

    try {
      await bot.telegram.sendDocument(target.userId, doc.file_id, {
        caption: target.sentCount === 0 ? target.caption || undefined : undefined
      });

      target.sentCount += 1;
      markBatchItemSent(target, deliveryKey);
      await ctx.reply(`✅ File sent to ${target.userId}`);
    } catch (err) {
      clearBatchItemProgress(target, deliveryKey);
      await ctx.reply("❌ Failed: " + (err?.message || err));
    }

    return;
  }

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  let sub = submissions[user.id];

  if (sub && sub.stage === STAGE_PAID) {
    resetSubmission(user.id);
    sub = null;
  }

  if (!sub) {
    const doc = ctx.message.document;

    submissions[user.id] = createEmptySubmission();
    submissions[user.id].pendingInitialDocument = {
      userId: user.id,
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id,
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id || null,
      fileName: doc.file_name || `file_${Date.now()}`,
      username: user.username || "N/A",
      firstName: user.first_name || "",
      lastName: user.last_name || ""
    };

    await ctx.reply(
  `📦 First document received.\n\n${CLEAN_COPY_WARNING}\n\nChoose number of files. This is file 1.`,
  { parse_mode: "Markdown", reply_markup: batchSizeKeyboard().reply_markup }
);
    return;
  }

  if (sub.stage === STAGE_WAIT_BATCH_SIZE) {
    if (sub.pendingInitialDocument) {
      await ctx.reply("📦 Choose number of files first.", {
        reply_markup: batchSizeKeyboard().reply_markup
      });
      return;
    }

    const doc = ctx.message.document;

    sub.pendingInitialDocument = {
      userId: user.id,
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id,
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id || null,
      fileName: doc.file_name || `file_${Date.now()}`,
      username: user.username || "N/A",
      firstName: user.first_name || "",
      lastName: user.last_name || ""
    };

    await ctx.reply(
      `📦 First document received.\n\n${CLEAN_COPY_WARNING}\n\nChoose number of files. This is file 1.`,
      { parse_mode: "Markdown", reply_markup: batchSizeKeyboard().reply_markup }
    );
    return;
  }

  if (sub.stage === STAGE_WAIT_FILE_TYPE || sub.stage === STAGE_WAIT_RESELLER_CODE) {
    return ctx.reply("⚠️ Choose type for the previous file first.", {
      parse_mode: "Markdown",
      reply_markup: typeInlineKeyboard(
        Boolean(getCurrentPendingFile(sub)?.recheckEligible),
        RESALE_ENABLED,
        Boolean(sub.resellerVerified)
      ).reply_markup
    });
  }

  if (
    sub.stage === STAGE_WAIT_PAYMENT_METHOD ||
    sub.stage === STAGE_WAIT_PHONE ||
    sub.stage === STAGE_WAIT_PAYMENT
  ) {
    return ctx.reply("⚠️ Finish payment or cancel this payment attempt first.", {
      parse_mode: "Markdown",
      reply_markup:
        sub.stage === STAGE_WAIT_PAYMENT_METHOD
          ? paymentMethodKeyboard().reply_markup
          : paymentWaitKeyboard().reply_markup
    });
  }

  if (!canAcceptMoreFiles(sub)) {
    return ctx.reply("✅ Selected file count already uploaded.", { reply_markup: mainKeyboard() });
  }

  const doc = ctx.message.document;
  const storedFile = createStoredFileFromDocument(user.id, doc);

  storedFile.sourceChatId = ctx.chat.id;
  storedFile.sourceMessageId = ctx.message.message_id;
  storedFile.sourceUsername = user.username || "N/A";
  storedFile.sourceFirstName = user.first_name || "";
  storedFile.sourceLastName = user.last_name || "";

  sub.files.push(storedFile);
  sub.currentFileIndex = sub.files.length - 1;
  sub.stage = STAGE_WAIT_FILE_TYPE;

  await askForFileType(ctx, sub);
});

// =====================
// PHOTO HANDLER
// =====================
bot.on("photo", async (ctx) => {
  const user = ctx.from;

  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];
    if (!target) return ctx.reply("Use /filebatch <userId> first.");

    initBatchTracking(target);

    const photos = ctx.message.photo || [];
    const largest = photos[photos.length - 1];

    if (!largest) return ctx.reply("❌ No photo found.");

    const deliveryKey = makePhotoDeliveryKey(largest);

    if (!startBatchItemOnce(target, deliveryKey)) {
      return ctx.reply(`⚠️ Duplicate photo ignored for ${target.userId}`);
    }

    try {
      await bot.telegram.sendPhoto(target.userId, largest.file_id, {
        caption: target.sentCount === 0 ? target.caption || undefined : undefined
      });

      target.sentCount += 1;
      markBatchItemSent(target, deliveryKey);
      await ctx.reply(`✅ Photo sent to ${target.userId}`);
    } catch (err) {
      clearBatchItemProgress(target, deliveryKey);
      await ctx.reply("❌ Failed: " + (err?.message || err));
    }
    return;
  }

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  const sub = submissions[user.id];

  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    if (sub.paymentMethod === "INTERNATIONAL" || sub.paymentMethod === "KENYAN_BANK") {
      await handleInternationalPaymentScreenshotProof(ctx, sub);
    } else if (sub.paymentMethod === "TZ_OTHER") {
      await handleTzOtherPaymentScreenshotProof(ctx, sub);
    } else {
      await handlePaymentScreenshotProof(ctx, sub);
    }
    return;
  }

  if (sub && [STAGE_WAIT_BATCH_SIZE, STAGE_WAIT_UPLOADS, STAGE_WAIT_FILE_TYPE, STAGE_WAIT_RESELLER_CODE].includes(sub.stage)) {
    return ctx.reply("⚠️ Send file as a document, not photo.", {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    });
  }

  await ctx.reply("⚠️ Use Telegram's 📎 attachment button and send the file as a *document*.", {
    parse_mode: "Markdown",
    reply_markup: startInlineKeyboard().reply_markup
  });
});

// =====================
// TYPE SELECTION
// =====================
bot.action("TYPE_CHECK", async (ctx) => {
  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  if (isPublicDiscountExclusiveMode()) {
    const sub = submissions[ctx.from.id];

    await ctx.answerCbQuery("CHECK is hidden during the public discount.");

    return ctx.reply(
      `🏷️ Public ${RESALE_LABEL_TITLE} is active. Choose ${
        SIMILARITY_ONLY_ENABLED
          ? `SIMILARITY REPORT ONLY or ${RESALE_LABEL_TITLE}.`
          : `${RESALE_LABEL_TITLE}.`
      }`,
      {
        reply_markup: typeInlineKeyboard(
          Boolean(getCurrentPendingFile(sub)?.recheckEligible),
          RESALE_ENABLED,
          Boolean(sub?.resellerVerified)
        ).reply_markup
      }
    );
  }

  await handleFileTypeSelected(ctx, "CHECK");
});

bot.action("TYPE_RECHECK", async (ctx) => {
  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  if (isPublicDiscountExclusiveMode()) {
    const sub = submissions[ctx.from.id];

    await ctx.answerCbQuery("RECHECK is hidden during the public discount.");

    return ctx.reply(
      `🏷️ Public ${RESALE_LABEL_TITLE} is active. Choose ${
        SIMILARITY_ONLY_ENABLED
          ? `SIMILARITY REPORT ONLY or ${RESALE_LABEL_TITLE}.`
          : `${RESALE_LABEL_TITLE}.`
      }`,
      {
        reply_markup: typeInlineKeyboard(
          Boolean(getCurrentPendingFile(sub)?.recheckEligible),
          RESALE_ENABLED,
          Boolean(sub?.resellerVerified)
        ).reply_markup
      }
    );
  }

  await handleFileTypeSelected(ctx, "RECHECK");
});

bot.action("TYPE_SIMILARITY", async (ctx) => {
  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  if (!SIMILARITY_ONLY_ENABLED) return ctx.answerCbQuery("Similarity Only is not enabled.");
  await handleFileTypeSelected(ctx, "SIMILARITY");
});

bot.action("TYPE_RESALE", async (ctx) => {
  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  await handleFileTypeSelected(ctx, "RESALE");
});

bot.action("DONE_UPLOADING", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  if (!sub || sub.stage !== STAGE_WAIT_UPLOADS) return ctx.answerCbQuery("Nothing to finish.");
  if (sub.files.length === 0) return ctx.answerCbQuery("Upload at least one file first.");

  await ctx.answerCbQuery("Finishing batch");
  await moveBatchToPaymentMethodStep(ctx, sub);
});

bot.action("TYPE_CANCEL", async (ctx) => {
  await ctx.answerCbQuery("Cancelling");
  await handleCancelRequest(ctx, "document");
});

bot.action("PAYMENT_CANCEL", async (ctx) => {
  await ctx.answerCbQuery("Cancelling payment attempt");
  await handleCancelRequest(ctx, "payment");
});

// =====================
// PAYMENT METHOD SELECTION
// =====================
bot.action("PAYMENT_METHOD_MPESA", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  if (!sub || sub.stage !== STAGE_WAIT_PAYMENT_METHOD) return ctx.answerCbQuery("No payment method needed.");

  await ctx.answerCbQuery("Kenya M-Pesa selected");
  await moveBatchToPhoneStep(ctx, sub);
});

bot.action("PAYMENT_METHOD_INTL", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  if (!sub || sub.stage !== STAGE_WAIT_PAYMENT_METHOD) return ctx.answerCbQuery("No payment method needed.");

  await ctx.answerCbQuery("Kenyan bank selected");
  await startInternationalPayment(ctx, sub);
});


bot.action("PAYMENT_METHOD_TZ_OTHER", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  if (!sub || sub.stage !== STAGE_WAIT_PAYMENT_METHOD) return ctx.answerCbQuery("No payment method needed.");

  await ctx.answerCbQuery("Tanzania / other countries selected");
  await startTzOtherPayment(ctx, sub);
});

// =====================
// STK CONTROLS
// =====================
bot.action("STK_CHANGE_PHONE", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];
  if (!sub) return ctx.answerCbQuery("No active session.");

  sub.stage = STAGE_WAIT_PHONE;
  sub.phone = null;

  await ctx.answerCbQuery("Send new phone");
  await ctx.reply("📞 Send phone number again.", { reply_markup: mainKeyboard() });
});

bot.action("STK_RESEND", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];
  if (!sub) return ctx.answerCbQuery("No active session.");

  await ctx.answerCbQuery("Resending...");

  if (!sub.phone) {
    sub.stage = STAGE_WAIT_PHONE;
    await ctx.reply("📞 Send phone number again.", { reply_markup: mainKeyboard() });
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

  if (user.id === ADMIN_ID) {
    const replyTarget = pendingAdminReplies[ADMIN_ID];

    if (!replyTarget) return;

    try {
      await bot.telegram.sendMessage(
        replyTarget.userId,
        `━━━━━━━━━━━━━━━
💬 *JK Turnitin Support*
━━━━━━━━━━━━━━━

${text}

━━━━━━━━━━━━━━━`,
        { parse_mode: "Markdown" }
      );

      await ctx.reply(`✅ Reply sent to ${replyTarget.userId}`);
      delete pendingAdminReplies[ADMIN_ID];
    } catch (err) {
      await ctx.reply("❌ Failed: " + (err?.message || err));
    }

    return;
  }

  if (supportRequests[user.id]) {
    supportRequests[user.id] = false;

    try {
      await sendAdminMessage(
        `💬 Support message from user\nUser ID: ${user.id}\nName: ${getUserFullName(user)}\nUsername: @${safeText(
          user.username || "N/A"
        )}\n\n${safeText(text)}${adminQuickCommands(user.id)}`,
        { adminButtons: "replyOnly" }
      );
      await ctx.reply("✅ Sent to support.", { reply_markup: mainKeyboard() });
    } catch {
      await ctx.reply("❌ Failed. Try again.", { reply_markup: mainKeyboard() });
    }
    return;
  }

  const sub = submissions[user.id];

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  if (sub && sub.stage === STAGE_WAIT_RESELLER_CODE) {
    if (!RESALE_ENABLED) {
      sub.stage = STAGE_WAIT_FILE_TYPE;
      return ctx.reply(`⚠️ ${RESALE_LABEL_TITLE} is not enabled.`, {
        reply_markup: typeInlineKeyboard(
          Boolean(getCurrentPendingFile(sub)?.recheckEligible),
          RESALE_ENABLED,
          Boolean(sub.resellerVerified)
        ).reply_markup
      });
    }

    if (!resellerCodeMatches(text)) {
      sub.stage = STAGE_WAIT_FILE_TYPE;
      return ctx.reply(`❌ Wrong Code. Choose another type.`, {
        reply_markup: typeInlineKeyboard(
          Boolean(getCurrentPendingFile(sub)?.recheckEligible),
          RESALE_ENABLED,
          Boolean(sub.resellerVerified)
        ).reply_markup
      });
    }

    sub.resellerVerified = true;
    await ctx.reply(`✅ ${RESALE_LABEL_TITLE} Applied`);
    await finalizeFileTypeSelection(ctx, sub, "RESALE");
    return;
  }

  if (sub && sub.stage === STAGE_WAIT_PAYMENT_METHOD) {
    return ctx.reply("Choose payment method.", {
      reply_markup: paymentMethodKeyboard().reply_markup
    });
  }

  if (sub && sub.stage === STAGE_WAIT_PHONE) {
    const phone254 = normalizePhoneTo254(text);
    if (!phone254) return ctx.reply("❌ Invalid phone. Use 07XXXXXXXX or 01XXXXXXXX.");

    sub.phone = phone254;
    await attemptStkPush(ctx, sub, { mode: "initial" });
    return;
  }

  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    if (sub.paymentMethod === "INTERNATIONAL" || sub.paymentMethod === "KENYAN_BANK") {
      await handleInternationalPaymentProofText(ctx, sub, text);
    } else if (sub.paymentMethod === "TZ_OTHER") {
      await handleTzOtherPaymentProofText(ctx, sub, text);
    } else {
      await handleMpesaProofText(ctx, sub, text);
    }
    return;
  }

  if (hasActiveSubmissionForUploads(sub)) {
    await sendAdminMessage(
      `💬 Message from user\nUser ID: ${user.id}\nName: ${getUserFullName(user)}\nUsername: @${safeText(
        user.username || "N/A"
      )}\n\n${safeText(text)}${adminQuickCommands(user.id)}`,
      { adminButtons: "replyOnly" }
    );
  }

  if (sub && sub.stage === STAGE_WAIT_UPLOADS) {
    return ctx.reply(`📄 Send file ${sub.files.length + 1} of ${sub.expectedFiles} as document.`, {
      parse_mode: "Markdown",
      reply_markup: uploadContinueKeyboard().reply_markup
    });
  }

  if (sub && sub.stage === STAGE_WAIT_FILE_TYPE) {
    return ctx.reply("⚠️ Choose type for the last file first.", {
      parse_mode: "Markdown",
      reply_markup: typeInlineKeyboard(
        Boolean(getCurrentPendingFile(sub)?.recheckEligible),
        RESALE_ENABLED,
        Boolean(sub.resellerVerified)
      ).reply_markup
    });
  }

  if (!sub) {
    return ctx.reply("📎 Send your first file directly using Telegram's attachment button and choose *File/Document*. No start button is required.", {
      parse_mode: "Markdown",
      reply_markup: startInlineKeyboard().reply_markup
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

app.post("/webhook", (req, res) => {
  res.status(200).send("OK");

  setImmediate(async () => {
    try {
      await bot.handleUpdate(req.body);
    } catch (err) {
      console.error("Telegram update processing failed:", err?.message || err);
    }
  });
});

app.get("/", (req, res) => res.status(200).send("OK"));

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    timeUtc: moment.utc().format(),
    intasendTest: INTASEND_TEST,
    publicBaseUrl: PUBLIC_BASE_URL,
    dataDir: DATA_DIR,
    secretKeyPresent: Boolean(INTASEND_SECRET_KEY),
    secretKeyLooksValid: String(INTASEND_SECRET_KEY).startsWith("ISSecretKey_"),
    publishableKeyPresent: Boolean(INTASEND_PUBLISHABLE_KEY),
    publishableKeyLooksValid: String(INTASEND_PUBLISHABLE_KEY).startsWith("ISPubKey_"),
    pendingSubmissions: Object.keys(submissions).length,
    paidJobs: Object.keys(paidJobs).length,
    activePollers: Object.keys(activePollers).length,
    processedUpdateCache: processedUpdateCache.size,
    checkHistoryRecords: checkHistory.length,
    usedProofCodes: Object.keys(usedProofCodes).length,
    dailySalesSummaryLastSentDateKey: dailySalesSummary.lastSentDateKey || null,
    dailySalesLedgerPayments: Object.keys(dailySalesLedger.payments || {}).length,
    botDisplayNameMode: lastAppliedBotNameMode,
    botOnlineName: BOT_ONLINE_NAME,
    botOfflineName: BOT_OFFLINE_NAME,
    statusPollIntervalSeconds: STATUS_POLL_INTERVAL_MS / 1000,
    statusPollMaxAttempts: STATUS_POLL_MAX_ATTEMPTS,
    recheckWindowHours: 24,
    reportParsing: "disabled",
    paymentOcrEnabled: PAYMENT_OCR_ENABLED,
    paymentOcrPackagePresent: Boolean(Tesseract),
    paymentOcrMaxMb: PAYMENT_OCR_MAX_MB,
    paymentOcrTimeoutSeconds: PAYMENT_OCR_TIMEOUT_SECONDS,
    paymentProofRecipient: PAYMENT_PROOF_RECIPIENT,
    tillNumber: TILL_NUMBER,
    reportProcessingMinMinutes: REPORT_PROCESSING_MIN_MINUTES,
    reportProcessingMaxMinutes: REPORT_PROCESSING_MAX_MINUTES,
    reportProcessingLabel: REPORT_PROCESSING_LABEL,
    reportProcessingMessage: reportProcessingTimeText(),
    checkPriceKes: CHECK_PRICE_KES,
    recheckPriceKes: RECHECK_PRICE_KES,
    similarityOnlyEnabled: SIMILARITY_ONLY_ENABLED,
    similarityOnlyPriceKes: SIMILARITY_ONLY_PRICE_KES,
    resaleEnabled: RESALE_ENABLED,
    resalePriceKes: RESALE_PRICE_KES,
    resaleLabel: RESALE_LABEL,
    discountPublicEnabled: isDiscountPublicActive(),
    publicDiscountExclusiveButtons: isPublicDiscountExclusiveMode(),
    discountPublicConfigured: DISCOUNT_PUBLIC_ENABLED,
    discountPublicAutoWindowSet: Boolean(DISCOUNT_START_EAT && DISCOUNT_END_EAT),
    discountStartEat: DISCOUNT_START_EAT,
    discountEndEat: DISCOUNT_END_EAT,
    internationalPaymentEnabled: INTERNATIONAL_PAYMENT_ENABLED,
    internationalCheckPriceUsd: INTERNATIONAL_CHECK_PRICE_USD,
    internationalSimilarityOnlyPrice: INTERNATIONAL_SIMILARITY_ONLY_PRICE,
    internationalCurrency: INTERNATIONAL_CURRENCY,
    internationalMethodsText: INTERNATIONAL_METHODS_TEXT,
    internationalBankFallbackEnabled: INTERNATIONAL_BANK_FALLBACK_ENABLED,
    internationalBankName: INTERNATIONAL_BANK_NAME,
    internationalBankAccountNumber: INTERNATIONAL_BANK_ACCOUNT_NUMBER,
    internationalBankAccountNameSet: Boolean(INTERNATIONAL_BANK_ACCOUNT_NAME),
    tanzaniaOtherPaymentEnabled: TZ_OTHER_PAYMENT_ENABLED,
    tanzaniaOtherSafaricomNumber: TZ_OTHER_SAFARICOM_NUMBER,
    tanzaniaOtherAirtelNumber: TZ_OTHER_AIRTEL_NUMBER,
    tanzaniaOtherRecipientName: TZ_OTHER_RECIPIENT_NAME,
    tanzaniaOtherProofWaitMinutes: TZ_OTHER_PROOF_WAIT_MINUTES,
    tanzaniaOtherCurrency: TZ_OTHER_CURRENCY,
    inactiveStartUtc: INACTIVE_START_UTC,
    inactiveEndUtc: INACTIVE_END_UTC,
    inactiveEndEat: INACTIVE_END_EAT,
    inactiveEndEatDisplay: INACTIVE_END_EAT_DISPLAY
  });
});

app.get("/intasend/webhook", (req, res) => {
  const qChallenge = req.query?.challenge;
  if (!qChallenge) return res.status(200).send("OK");

  if (INTASEND_WEBHOOK_CHALLENGE && qChallenge !== INTASEND_WEBHOOK_CHALLENGE) {
    return res.status(401).send("Invalid challenge");
  }

  return res.status(200).send(qChallenge);
});

app.post("/intasend/webhook", (req, res) => {
  res.status(200).json({ ok: true });

  setImmediate(async () => {
    try {
      let payload = req.body;

      const bodyIsEmptyObject =
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        Object.keys(payload).length === 0;

      if (!payload || typeof payload === "string" || bodyIsEmptyObject) {
        const raw = String(req.rawBody || "").trim();
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

      if (
        payload?.challenge &&
        INTASEND_WEBHOOK_CHALLENGE &&
        String(payload.challenge).trim() !== INTASEND_WEBHOOK_CHALLENGE
      ) {
        await sendAdminMessage("⚠️ IntaSend webhook: invalid challenge.");
        return;
      }

      let apiRef = extractApiRef(payload);
      const invoiceId = extractInvoiceId(payload);
      const state = normalizePaymentState(extractState(payload));
      const reason =
        payload?.failed_reason ||
        payload?.invoice?.failed_reason ||
        payload?.detail ||
        payload?.message ||
        null;

      if (!apiRef && invoiceId) {
        const found = findPaymentRefByInvoiceId(invoiceId);
        if (found) apiRef = found.apiRef;
      }

      if (!apiRef) {
        await sendAdminMessage(
          `⚠️ IntaSend webhook not matched.\ninvoiceid: ${safeText(invoiceId || "N/A")}\nstate: ${safeText(state)}`
        );
        return;
      }

      const ref = getPaymentRef(apiRef);
      if (!ref) {
        await sendAdminMessage(
          `⚠️ IntaSend webhook: unknown apiref ${safeText(apiRef)}\ninvoiceid: ${safeText(
            invoiceId || "N/A"
          )}\nstate: ${safeText(state)}`
        );
        return;
      }

      updatePaymentRef(apiRef, {
        invoiceId: invoiceId || ref.invoiceId || null,
        lastState: state,
        lastWebhookAt: Date.now()
      });

      if (state === "COMPLETE") {
        await markPaymentComplete({
          apiRef,
          invoiceId: invoiceId || ref.invoiceId || null,
          state,
          source: "webhook"
        });
        return;
      }

      if (["FAILED", "CANCELLED", "EXPIRED"].includes(state)) {
        await handlePaymentAttemptFailed({
          apiRef,
          invoiceId: invoiceId || ref.invoiceId || null,
          state,
          source: "webhook",
          reason
        });
      }
    } catch (err) {
      console.error("Async IntaSend webhook processing error:", err?.message || err);
    }
  });
});

bot.catch((err) => {
  console.error("Bot error:", err?.message || err);
});

// =====================
// START SERVER + TELEGRAM WEBHOOK
// =====================
const port = Number(process.env.PORT || 3000);

app.listen(port, async () => {
  console.log(`Webhook server listening on port ${port}`);
  console.log(`PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`IntaSend Mode: ${INTASEND_TEST ? "TEST" : "LIVE"}`);
  console.log(`Report parsing: DISABLED`);
  console.log(`Till number: ${TILL_NUMBER}`);
  console.log(`Payment proof recipient: ${PAYMENT_PROOF_RECIPIENT}`);
  console.log(`Payment OCR enabled: ${PAYMENT_OCR_ENABLED ? "YES" : "NO"}`);
  console.log(`Payment OCR package present: ${Tesseract ? "YES" : "NO"}`);
  console.log(`Payment OCR max: ${PAYMENT_OCR_MAX_MB} MB`);
  console.log(`Payment OCR timeout: ${PAYMENT_OCR_TIMEOUT_SECONDS}s`);
  console.log(`Report processing message: ${reportProcessingTimeText().replace(/\*/g, "")}`);
  console.log(`Paid cancellation opens after max processing: ${REPORT_PROCESSING_MAX_MINUTES} minutes`);
  console.log(`Prices: CHECK=${CHECK_PRICE_KES}, RECHECK=${RECHECK_PRICE_KES}, SIMILARITY=${SIMILARITY_ONLY_PRICE_KES}, ${RESALE_LABEL}=${RESALE_PRICE_KES}`);
  console.log(`Discount public active now: ${isDiscountPublicActive() ? "YES" : "NO"}`);
  console.log(`Public discount exclusive buttons: ${isPublicDiscountExclusiveMode() ? "YES" : "NO"}`);
  console.log(`Discount public mode: ${DISCOUNT_START_EAT && DISCOUNT_END_EAT ? "AUTO TIME WINDOW" : "MANUAL ENV"}`);
  console.log(`Kenyan bank payment enabled: ${INTERNATIONAL_PAYMENT_ENABLED ? "YES" : "NO"}`);
  console.log(`International check/recheck price: ${INTERNATIONAL_CHECK_PRICE_USD} ${INTERNATIONAL_CURRENCY}`);
  console.log(`International similarity only price: ${INTERNATIONAL_SIMILARITY_ONLY_PRICE} ${INTERNATIONAL_CURRENCY}`);
  console.log(`International bank fallback: ${INTERNATIONAL_BANK_FALLBACK_ENABLED ? "YES" : "NO"}`);
  console.log(`Payment polling: every ${STATUS_POLL_INTERVAL_MS / 1000}s, max ${STATUS_POLL_MAX_ATTEMPTS} attempts`);
  console.log(`Inactive period UTC: ${INACTIVE_START_UTC} to ${INACTIVE_END_UTC}`);
  console.log(`Inactive end display: ${INACTIVE_END_EAT_DISPLAY} EAT`);
  console.log(`Bot names: ${BOT_ONLINE_NAME} / ${BOT_OFFLINE_NAME}`);
  console.log(`Daily payment summary: enabled at 00:00 EAT`);
  console.log(`Daily sales ledger payments loaded: ${Object.keys(dailySalesLedger.payments || {}).length}`);

  const webhookUrl = `${PUBLIC_BASE_URL}/webhook`;

  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Telegram webhook set to: ${webhookUrl}`);
  } catch (e) {
    console.error("Failed to set Telegram webhook:", e?.description || e?.message || e);
  }

  startBotDisplayNameScheduler();
  startDailySalesSummaryScheduler();
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});