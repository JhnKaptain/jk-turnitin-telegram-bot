require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const moment = require("moment");
const qs = require("querystring");

// TRN_LIVE_API_DELIVERY_V2
let renderJkReports = null;

try {
  ({
    renderJkReports
  } = require("./jk-report-renderer-max.js"));
} catch (err) {
  console.error(
    "Report renderer could not be loaded:",
    err?.message || err
  );
}

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
const worldwidePay = require("./jk-international-manual-payment.cjs");
const WORLDWIDE_MPESA_NUMBER = String(process.env.WORLDWIDE_MPESA_NUMBER || "+254741924396").replace(/[^+0-9]/g, "");
const WORLDWIDE_BINANCE_ID = String(process.env.WORLDWIDE_BINANCE_ID || "1203517288").trim();
const WORLDWIDE_BINANCE_NAME = String(process.env.WORLDWIDE_BINANCE_NAME || "JohnKaptain").trim();
const WORLDWIDE_KES_PER_USDT = readFloatEnv("WORLDWIDE_KES_PER_USDT", 130);
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

// JK_API_DELIVERY_RESTART_SAFE_V6
const API_DELIVERY_HOLD_MINUTES = Math.max(
  0,
  readFloatEnv("API_DELIVERY_HOLD_MINUTES", 1.5)
);

const API_DELIVERY_RECOVERY_INTERVAL_MS = Math.max(
  30000,
  readIntEnv("API_DELIVERY_RECOVERY_SECONDS", 60) * 1000
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
const STAGE_WAIT_SIM_FILTER = "WAIT_SIM_FILTER";
const STAGE_WAIT_RESELLER_CODE = "WAIT_RESELLER_CODE";

// JK_COPYLEAKS_CONTROL_PATCH_V2
// JK_COPYLEAKS_EXPORT_PATCH_V1
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

const CLEAN_COPY_NEXT_SUBMISSION_NOTE =
  `⚠️ *IMPORTANT FOR YOUR NEXT SUBMISSION*

Please remove all institution names and/or logos from the cover page before uploading your paper.

Only upload a clean copy with no school, college, university, or other institution name/logo on the cover page. This helps protect the Turnitin account from restrictions or bans.

Please make sure this is done before your next submission. Thank you.`;

const PRELIM_PAGES_REMOVED_NOTE =
  `🧹 *Preliminary Pages Removed*

To protect the Turnitin account from possible restrictions or bans linked to institution details and other identifying information, preliminary/front matter pages have been removed from your checking copy.

*Removed sections may include:*
• Acknowledgements
• Dedication
• Declaration
• Table of Contents
• List of Figures/Tables
• Other front matter

*The Turnitin check begins from:*
✅ Abstract
✅ Main body/content
✅ References
✅ Appendices

Your academic content remains unchanged.`;

const REPORTS_DELIVERED_MESSAGE =
  "✅ Your Turnitin reports are ready. Thank you for choosing JK Turnitin. Access our other writing services here: https://john-kaptain.github.io/johnkaptain-academic-tools-hub/";

// JK_API_DELIVERY_MESSAGE_V1
const API_REPORTS_DELIVERED_MESSAGE =
  "✅ Your Turnitin reports are ready. Thank you for choosing JK Turnitin.";

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
  "1️⃣ Tap Telegram's 📎 attachment button beside the message box.",
  "2️⃣ Choose File/Document.",
  "3️⃣ Send your DOC/PDF file directly.",
  "4️⃣ After the first file is received, choose the total number of files to check.",
  "5️⃣ Upload any remaining files as documents if any.",
  "",
  "The bot will then check the file and show the available service options.",
  "",
  CLEAN_COPY_WARNING
].join("\n");
const MESSAGES = {
  welcome: (check, recheck, resale) => `
JK Turnitin Reports Bot

💰 *Pricing*
• Check: ${check} KES
• Recheck: ${recheck} KES${SIMILARITY_ONLY_ENABLED ? `\n• Similarity Report Only: ${SIMILARITY_ONLY_PRICE_KES} KES` : ""}${RESALE_ENABLED ? `\n• ${RESALE_LABEL_TITLE}: ${resalePublicPriceText()}` : ""}

Recheck is available only when the same file was checked and paid within the last 24 hours.

${RESALE_ENABLED && !isDiscountPublicActive() ? `🏷️ *${RESALE_LABEL_TITLE}*\n${RESALE_LABEL_TITLE} currently requires a code.${discountTimeLineForMessage()}` : ""}
${RESALE_ENABLED && isDiscountPublicActive() ? `🏷️ *${RESALE_LABEL_TITLE}*\n${RESALE_LABEL_TITLE} is currently available without a code.${discountTimeLineForMessage()}` : ""}
`,
  inactive: () => `
⏳ Turnitin checks are paused right now.
We’ll resume at *${INACTIVE_END_EAT_DISPLAY} EAT*.

⚠️ Payment prompts will only be sent after ${INACTIVE_END_EAT_DISPLAY}.

If urgent, WhatsApp call *0701730921*.
`,
  sendDocHelp: UPLOAD_PROCEDURE_MESSAGE,
  paymentHelp:
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
const pendingBroadcasts = {};
let broadcastInProgress = false;

const processedUpdateCache = new Map();
const PROCESSED_UPDATE_TTL_MS = 30 * 60 * 1000;

let paymentRefs = {};
let checkHistory = [];
let usedProofCodes = {};
let paidJobs = {};
let paidAiHighlights;
let dailySalesSummary = {};
let dailySalesLedger = {};
let botUsers = {};
let broadcastMeta = {};
// JK_SCHEDULER_RELIABILITY_V1
let lastAppliedBotNameMode = null;

let botNameRetryNotBefore = 0;
let botNameLastVerifiedAt = 0;
let botNameSyncInFlight = false;

let dailySalesSummarySendInFlight = false;

const BOT_NAME_VERIFY_INTERVAL_MS =
  15 * 60 * 1000;

const DAILY_SALES_SUMMARY_CHECK_MS =
  60 * 1000;

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
const BOT_USERS_FILE = path.join(DATA_DIR, "botUsers.store.json");

const JK_REPORT_SETTINGS_FILE = path.join(
  DATA_DIR,
  "jkReportSettings.store.json"
);

const COPYLEAKS_DATA_DIR = path.join(DATA_DIR, "copyleaks");

try {
  if (!fs.existsSync(COPYLEAKS_DATA_DIR)) {
    fs.mkdirSync(COPYLEAKS_DATA_DIR, { recursive: true });
  }
} catch (err) {
  console.error(
    "Failed to create Copyleaks data dir:",
    err?.message || err
  );
}

const REPORT_MODE_MANUAL = "MANUAL";
const REPORT_MODE_APPROVAL = "ADMIN_APPROVAL";
const REPORT_MODE_AUTO = "AUTO_API";

const FILTER_MODE_CLIENT = "CLIENT_CHOICE";
const FILTER_MODE_FILTERED = "FILTERED";
const FILTER_MODE_UNFILTERED = "UNFILTERED";

const REPORT_NAMES = [
  "Author Author",
  "User User"
];

const REPORT_INSTITUTIONS = [
  "Arsi University",
  "University of Anbar",
  "Oromia State University"
];

const COPYLEAKS_ENABLED = readBoolEnv(
  "COPYLEAKS_ENABLED",
  false
);

const COPYLEAKS_SANDBOX = readBoolEnv(
  "COPYLEAKS_SANDBOX",
  true
);

const COPYLEAKS_EMAIL = String(
  process.env.COPYLEAKS_EMAIL || ""
).trim();

const COPYLEAKS_API_KEY = String(
  process.env.COPYLEAKS_API_KEY || ""
).trim();

const COPYLEAKS_WEBHOOK_SECRET = String(
  process.env.COPYLEAKS_WEBHOOK_SECRET || ""
).trim();

const COPYLEAKS_API_BASE =
  "https://api.copyleaks.com";

const COPYLEAKS_LOGIN_URL =
  "https://id.copyleaks.com/v3/account/login/api";

const COPYLEAKS_SENSITIVITY = Math.min(
  5,
  Math.max(
    1,
    readIntEnv("COPYLEAKS_SENSITIVITY", 5)
  )
);

const COPYLEAKS_AI_SENSITIVITY = Math.min(
  3,
  Math.max(
    1,
    readIntEnv("COPYLEAKS_AI_SENSITIVITY", 2)
  )
);

const COPYLEAKS_INDEX_TO_DB = readBoolEnv(
  "COPYLEAKS_INDEX_TO_DB",
  false
);

const COPYLEAKS_SCAN_SHARED_DB = readBoolEnv(
  "COPYLEAKS_SCAN_SHARED_DB",
  true
);

const COPYLEAKS_EXPORT_ENABLED = readBoolEnv(
  "COPYLEAKS_EXPORT_ENABLED",
  true
);

/*
  JK_PROVIDER_FLAGS_EARLY_V1

  These must exist before report settings are
  loaded because the startup safety lock needs
  to know which provider route is active.
*/
const JK_PROVIDER_CUTOVER_ENABLED =
  readBoolEnv(
    "JK_PROVIDER_CUTOVER_ENABLED",
    false
  );

const JK_PROVIDER_LIVE =
  readBoolEnv(
    "JK_PROVIDER_LIVE",
    false
  );

function legacyCopyleaksConfigured() {
  return Boolean(
    COPYLEAKS_ENABLED &&
    COPYLEAKS_EMAIL &&
    COPYLEAKS_API_KEY &&
    COPYLEAKS_WEBHOOK_SECRET
  );
}

function activeProviderReadyForReportMode() {
  /*
    When provider cutover is enabled, new jobs no
    longer use Copyleaks.

    Require LIVE mode before allowing client-facing
    automatic/API report modes. This prevents a
    paid job from accidentally ending as DRY_RUN_READY.
  */
  if (
    JK_PROVIDER_CUTOVER_ENABLED
  ) {
    return Boolean(
      JK_PROVIDER_LIVE
    );
  }

  /*
    Legacy compatibility route.
  */
  return legacyCopyleaksConfigured();
}


let reportSettings = {
  reportMode: [
    REPORT_MODE_MANUAL,
    REPORT_MODE_APPROVAL,
    REPORT_MODE_AUTO
  ].includes(
    String(
      process.env.REPORT_GENERATION_MODE || ""
    )
      .trim()
      .toUpperCase()
  )
    ? String(
        process.env.REPORT_GENERATION_MODE
      )
        .trim()
        .toUpperCase()
    : REPORT_MODE_MANUAL,

  filterMode: [
    FILTER_MODE_CLIENT,
    FILTER_MODE_FILTERED,
    FILTER_MODE_UNFILTERED
  ].includes(
    String(
      process.env.SIMILARITY_FILTER_MODE || ""
    )
      .trim()
      .toUpperCase()
  )
    ? String(
        process.env.SIMILARITY_FILTER_MODE
      )
        .trim()
        .toUpperCase()
    : FILTER_MODE_CLIENT,

  institution: REPORT_INSTITUTIONS.includes(
    String(
      process.env.REPORT_INSTITUTION || ""
    ).trim()
  )
    ? String(
        process.env.REPORT_INSTITUTION
      ).trim()
    : REPORT_INSTITUTIONS[0],

  updatedAt: Date.now()
};

function loadReportSettings() {
  try {
    if (!fs.existsSync(JK_REPORT_SETTINGS_FILE)) {
      return;
    }

    const parsed = JSON.parse(
      fs.readFileSync(
        JK_REPORT_SETTINGS_FILE,
        "utf8"
      )
    );

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    if (
      [
        REPORT_MODE_MANUAL,
        REPORT_MODE_APPROVAL,
        REPORT_MODE_AUTO
      ].includes(parsed.reportMode)
    ) {
      reportSettings.reportMode =
        parsed.reportMode;
    }

    if (
      [
        FILTER_MODE_CLIENT,
        FILTER_MODE_FILTERED,
        FILTER_MODE_UNFILTERED
      ].includes(parsed.filterMode)
    ) {
      reportSettings.filterMode =
        parsed.filterMode;
    }

    if (
      REPORT_INSTITUTIONS.includes(
        parsed.institution
      )
    ) {
      reportSettings.institution =
        parsed.institution;
    }

    reportSettings.updatedAt = Number(
      parsed.updatedAt || Date.now()
    );
  } catch (err) {
    console.error(
      "Failed to load JK report settings:",
      err?.message || err
    );
  }
}

function saveReportSettings() {
  try {
    reportSettings.updatedAt = Date.now();

    fs.writeFileSync(
      JK_REPORT_SETTINGS_FILE,
      JSON.stringify(
        reportSettings,
        null,
        2
      ),
      "utf8"
    );
  } catch (err) {
    console.error(
      "Failed to save JK report settings:",
      err?.message || err
    );
  }
}

function reportModeLabel(
  mode = reportSettings.reportMode
) {
  if (mode === REPORT_MODE_MANUAL) {
    return "MANUAL ONLY";
  }

  if (mode === REPORT_MODE_AUTO) {
    return "AUTOMATIC API";
  }

  return "ADMIN APPROVAL";
}

function filterModeLabel(
  mode = reportSettings.filterMode
) {
  if (mode === FILTER_MODE_FILTERED) {
    return "ALWAYS FILTERED";
  }

  if (mode === FILTER_MODE_UNFILTERED) {
    return "ALWAYS UNFILTERED";
  }

  return "CLIENT CHOICE";
}
function generateJkSubmissionId() {
  let digits = "";

  for (
    let i = 0;
    i < 10;
    i += 1
  ) {
    digits += String(
      Math.floor(
        Math.random() * 10
      )
    );
  }

  if (
    digits[0] === "0"
  ) {
    digits =
      String(
        Math.floor(
          Math.random() * 9
        ) + 1
      ) +
      digits.slice(1);
  }

  return (
    "trn:oid:::1:" +
    digits
  );
}

function chooseReportName() {
  return REPORT_NAMES[
    Math.floor(
      Math.random() * REPORT_NAMES.length
    )
  ];
}

// JK_AUTO_REPORT_IDENTITY_V2
function chooseReportInstitution() {
  return REPORT_INSTITUTIONS[
    Math.floor(
      Math.random() * REPORT_INSTITUTIONS.length
    )
  ];
}

// JK_STRICT_REPORT_IDENTITY_V1
function requireFileReportIdentity(
  file
) {
  if (
    !file ||
    typeof file !== "object"
  ) {
    throw new Error(
      "Report identity file is missing."
    );
  }

  const submissionId =
    String(
      file.jkSubmissionId || ""
    ).trim();

  const reportName =
    String(
      file.reportName || ""
    ).trim();

  const institution =
    String(
      file.reportInstitution || ""
    ).trim();

  if (
    !/^trn:oid:::1:[1-9]\d{9}$/.test(
      submissionId
    )
  ) {
    throw new Error(
      "Invalid report Submission ID: " +
      submissionId
    );
  }

  if (
    ![...REPORT_NAMES, "Jabbar Mutlaq"].includes(
      reportName
    )
  ) {
    throw new Error(
      "Unapproved report name: " +
      reportName
    );
  }

  if (
    !REPORT_INSTITUTIONS.includes(
      institution
    )
  ) {
    throw new Error(
      "Unapproved report institution: " +
      institution
    );
  }

  return file;
}

function ensureFileReportIdentity(
  file
) {
  return requireFileReportIdentity(
    file
  );
}

function effectiveSimilarityFilter(file) {
  const v = String(
    file?.similarityFilter || ""
  ).toUpperCase();

  if (
    v === FILTER_MODE_FILTERED ||
    v === FILTER_MODE_UNFILTERED
  ) {
    return v;
  }

  if (
    reportSettings.filterMode ===
    FILTER_MODE_UNFILTERED
  ) {
    return FILTER_MODE_UNFILTERED;
  }

  return FILTER_MODE_FILTERED;
}

function similarityFilterLabel(value) {
  return String(
    value || ""
  ).toUpperCase() ===
    FILTER_MODE_UNFILTERED
    ? "UNFILTERED"
    : "Quotes + Bibliography";
}

loadReportSettings();

/*
  JK_PROVIDER_READINESS_V2

  API modes are allowed only when the ACTIVE
  provider route can actually run live.

  - Provider cutover ON  -> JK_PROVIDER_LIVE required
  - Provider cutover OFF -> legacy Copyleaks required
*/
if (
  !activeProviderReadyForReportMode()
) {
  reportSettings.reportMode =
    REPORT_MODE_MANUAL;
}

const BROADCAST_INTERVAL_MS = Math.max(50, readIntEnv("BROADCAST_INTERVAL_MS", 60));
const BROADCAST_PREVIEW_TTL_MS = 15 * 60 * 1000;
const DISCOUNT_BROADCAST_CHECK_MS = Math.max(
  15000,
  readIntEnv("DISCOUNT_BROADCAST_CHECK_SECONDS", 30) * 1000
);

// =====================
// BOT USER REGISTRY + BROADCAST HELPERS
// =====================
function loadBotUsers() {
  try {
    if (!fs.existsSync(BOT_USERS_FILE)) return;

    const raw = fs.readFileSync(BOT_USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

    if (parsed.users && typeof parsed.users === "object" && !Array.isArray(parsed.users)) {
      botUsers = parsed.users;
      broadcastMeta = parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {};
      return;
    }

    // Backward-compatible with a plain { userId: record } registry.
    botUsers = parsed;
  } catch (e) {
    console.error("Failed to load bot users:", e?.message || e);
  }
}

function saveBotUsers() {
  try {
    fs.writeFileSync(
      BOT_USERS_FILE,
      JSON.stringify({ version: 1, users: botUsers, meta: broadcastMeta }, null, 2),
      "utf8"
    );
  } catch (e) {
    console.error("Failed to save bot users:", e?.message || e);
  }
}

function cleanBroadcastUsername(value) {
  return String(value || "").trim().replace(/^@+/, "").slice(0, 64);
}

function rememberBotUser(user, source = "interaction") {
  const userId = Number(user?.id || 0);
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId === ADMIN_ID) return false;

  const key = String(userId);
  const existing = botUsers[key] || null;
  const now = Date.now();

  const firstName = String(user?.first_name || "").trim().slice(0, 128);
  const lastName = String(user?.last_name || "").trim().slice(0, 128);
  const username = cleanBroadcastUsername(user?.username);
  const displayName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();

  const changedIdentity =
    !existing ||
    existing.firstName !== firstName ||
    existing.lastName !== lastName ||
    existing.username !== username ||
    existing.displayName !== displayName;

  const reactivated = Boolean(existing && existing.active === false);
  const shouldPersistLastSeen = !existing || now - Number(existing.lastPersistedAt || 0) >= 5 * 60 * 1000;

  botUsers[key] = {
    ...(existing || {}),
    userId,
    firstName,
    lastName,
    displayName,
    username,
    firstSeenAt: Number(existing?.firstSeenAt || now),
    lastSeenAt: now,
    active: true,
    inactiveAt: null,
    inactiveReason: null,
    source: source || existing?.source || "interaction",
    lastInteractionSource: source || "interaction",
    lastPersistedAt: existing?.lastPersistedAt || 0
  };

  if (changedIdentity || reactivated || shouldPersistLastSeen) {
    botUsers[key].lastPersistedAt = now;
    saveBotUsers();
  }

  return !existing;
}

function rememberHistoricalBotUser(userIdRaw, details = {}) {
  const userId = Number(userIdRaw || 0);
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId === ADMIN_ID) return false;

  const key = String(userId);
  if (botUsers[key]) return false;

  const now = Date.now();
  const seenAt = Number(
    details.lastSeenAt || details.lastPaidCheckAt || details.completedAt || details.paidAt || details.updatedAt || details.createdAt || now
  );

  botUsers[key] = {
    userId,
    firstName: "",
    lastName: "",
    displayName: String(details.name || details.displayName || "").trim().slice(0, 256),
    username: cleanBroadcastUsername(details.username),
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
    active: true,
    inactiveAt: null,
    inactiveReason: null,
    source: "historical-backfill",
    lastInteractionSource: "historical-backfill",
    lastPersistedAt: now
  };

  return true;
}

function backfillBotUsersFromExistingData() {
  let added = 0;

  for (const ref of Object.values(paymentRefs || {})) {
    if (rememberHistoricalBotUser(ref?.userId, ref || {})) added += 1;
  }

  for (const record of checkHistory || []) {
    if (rememberHistoricalBotUser(record?.userId, record || {})) added += 1;
  }

  for (const job of Object.values(paidJobs || {})) {
    if (rememberHistoricalBotUser(job?.userId, job || {})) added += 1;
  }

  for (const record of Object.values(dailySalesLedger?.payments || {})) {
    if (rememberHistoricalBotUser(record?.userId, record || {})) added += 1;
  }

  if (added > 0) saveBotUsers();
  return added;
}

function getBotUserStats() {
  const records = Object.values(botUsers || {}).filter((record) => {
    const userId = Number(record?.userId || 0);
    return Number.isSafeInteger(userId) && userId > 0 && userId !== ADMIN_ID;
  });

  const active = records.filter((record) => record.active !== false).length;

  return {
    registered: records.length,
    active,
    inactive: records.length - active
  };
}

function getActiveBotUserIds() {
  return Object.values(botUsers || {})
    .filter((record) => record?.active !== false)
    .map((record) => Number(record?.userId || 0))
    .filter((userId) => Number.isSafeInteger(userId) && userId > 0 && userId !== ADMIN_ID);
}

function cleanupPendingBroadcasts() {
  const now = Date.now();

  for (const [token, pending] of Object.entries(pendingBroadcasts)) {
    if (!pending?.createdAt || now - Number(pending.createdAt) > BROADCAST_PREVIEW_TTL_MS) {
      delete pendingBroadcasts[token];
    }
  }
}

function makeBroadcastToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function broadcastPreviewKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ SEND TO ALL", `BROADCAST_SEND_${token}`)],
    [Markup.button.callback("❌ CANCEL", `BROADCAST_CANCEL_${token}`)]
  ]);
}

function broadcastSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBroadcastTelegramError(err) {
  const errorCode = Number(err?.response?.error_code || err?.code || 0) || 0;
  const description = String(
    err?.response?.description || err?.description || err?.message || err || "Unknown Telegram error"
  );
  const retryAfter = Number(
    err?.response?.parameters?.retry_after || err?.parameters?.retry_after || 0
  ) || 0;

  const permanent =
    errorCode === 403 ||
    /blocked by (the )?user|bot was blocked|chat not found|user is deactivated|can't initiate conversation|peer_id_invalid/i.test(description);

  return { errorCode, description, retryAfter, permanent };
}

async function sendBroadcastMessageToUser(userId, message) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await bot.telegram.sendMessage(userId, message);
      return { ok: true };
    } catch (err) {
      const info = getBroadcastTelegramError(err);

      if (info.retryAfter > 0 && attempt === 1) {
        await broadcastSleep((info.retryAfter + 1) * 1000);
        continue;
      }

      return { ok: false, ...info };
    }
  }

  return { ok: false, description: "Broadcast retry exhausted", permanent: false };
}

async function runBroadcast(message, recipientIds) {
  const uniqueIds = [...new Set((recipientIds || []).map(Number))]
    .filter((userId) => Number.isSafeInteger(userId) && userId > 0 && userId !== ADMIN_ID);

  const startedAt = Date.now();
  let attempted = 0;
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  let newlyInactive = 0;

  for (let index = 0; index < uniqueIds.length; index += 1) {
    const userId = uniqueIds[index];
    const key = String(userId);
    const record = botUsers[key];

    if (!record || record.active === false) {
      skipped += 1;
      continue;
    }

    attempted += 1;
    const result = await sendBroadcastMessageToUser(userId, message);
    const now = Date.now();

    record.lastBroadcastAt = now;

    if (result.ok) {
      delivered += 1;
      record.lastBroadcastStatus = "DELIVERED";
      record.lastBroadcastError = null;
    } else {
      failed += 1;
      record.lastBroadcastStatus = "FAILED";
      record.lastBroadcastError = String(result.description || "Unknown failure").slice(0, 500);

      if (result.permanent) {
        if (record.active !== false) newlyInactive += 1;
        record.active = false;
        record.inactiveAt = now;
        record.inactiveReason = record.lastBroadcastError;
      }
    }

    if (attempted % 20 === 0) saveBotUsers();

    if (index < uniqueIds.length - 1) {
      await broadcastSleep(BROADCAST_INTERVAL_MS);
    }
  }

  broadcastMeta = {
    ...(broadcastMeta || {}),
    lastBroadcastStartedAt: startedAt,
    lastBroadcastAt: Date.now(),
    lastBroadcastRecipients: uniqueIds.length,
    lastBroadcastAttempted: attempted,
    lastBroadcastDelivered: delivered,
    lastBroadcastFailed: failed,
    lastBroadcastSkipped: skipped,
    lastBroadcastNewlyInactive: newlyInactive
  };

  saveBotUsers();

  return {
    recipients: uniqueIds.length,
    attempted,
    delivered,
    failed,
    skipped,
    newlyInactive
  };
}

function getActiveDiscountBroadcastWindow() {
  if (!RESALE_ENABLED || !DISCOUNT_START_EAT || !DISCOUNT_END_EAT) return null;
  if (DISCOUNT_START_EAT === DISCOUNT_END_EAT || !isDiscountPublicActive()) return null;

  const nowEat = moment().utcOffset(180);
  const [sh, sm] = DISCOUNT_START_EAT.split(":").map(Number);
  const [eh, em] = DISCOUNT_END_EAT.split(":").map(Number);

  let start = nowEat.clone().startOf("day").hour(sh).minute(sm).second(0).millisecond(0);
  let end = nowEat.clone().startOf("day").hour(eh).minute(em).second(0).millisecond(0);

  if (DISCOUNT_START_EAT > DISCOUNT_END_EAT) {
    if (nowEat.format("HH:mm") < DISCOUNT_END_EAT) start.subtract(1, "day");
    else end.add(1, "day");
  }

  return {
    key: `${start.format("YYYY-MM-DDTHH:mm")}|${end.format("YYYY-MM-DDTHH:mm")}`,
    fromText: formatHHMMTo12HourStrict(DISCOUNT_START_EAT) || DISCOUNT_START_EAT,
    toText: formatHHMMTo12HourStrict(DISCOUNT_END_EAT) || DISCOUNT_END_EAT,
    price: RESALE_PRICE_KES
  };
}

function discountBroadcastMessage(windowInfo) {
  return [
    "🏷️ DISCOUNT IS NOW OPEN!",
    "",
    `Get your full Turnitin report for only ${windowInfo.price} KES during the current discount period.`,
    "",
    "⏰ Discount Period",
    `From: ${windowInfo.fromText} EAT`,
    `To: ${windowInfo.toText} EAT`,
    "",
    "📎 Upload your document now to take advantage of the discounted rate before the offer closes."
  ].join("\n");
}

async function createDiscountBroadcastPreview(force = false) {
  cleanupPendingBroadcasts();

  const windowInfo = getActiveDiscountBroadcastWindow();
  if (!windowInfo) return { ok: false, reason: "inactive" };

  if (!force && broadcastMeta.lastDiscountPreviewWindowKey === windowInfo.key) {
    return { ok: false, reason: "already-previewed" };
  }

  const recipientIds = getActiveBotUserIds();
  if (!recipientIds.length) return { ok: false, reason: "no-recipients" };

  const message = discountBroadcastMessage(windowInfo);
  const token = makeBroadcastToken();

  pendingBroadcasts[token] = {
    message,
    recipientIds,
    createdAt: Date.now(),
    kind: "discount",
    discountWindow: windowInfo
  };

  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      "📢 DISCOUNT BROADCAST PREVIEW\n\n" +
        message +
        "\n\n" +
        `Recipients: ${recipientIds.length} active user(s)\n` +
        "This preview expires in 15 minutes.\n\n" +
        "Nothing will be sent unless you choose SEND TO ALL.",
      { reply_markup: broadcastPreviewKeyboard(token).reply_markup }
    );
  } catch (err) {
    delete pendingBroadcasts[token];
    throw err;
  }

  broadcastMeta.lastDiscountPreviewWindowKey = windowInfo.key;
  broadcastMeta.lastDiscountPreviewAt = Date.now();
  saveBotUsers();

  return { ok: true, windowInfo, recipients: recipientIds.length };
}

async function checkAutomaticDiscountBroadcastPreview() {
  try {
    await createDiscountBroadcastPreview(false);
  } catch (err) {
    console.error("Automatic discount broadcast preview failed:", err?.message || err);
  }
}

function startDiscountBroadcastPreviewScheduler() {
  setTimeout(checkAutomaticDiscountBroadcastPreview, 3000);
  setInterval(checkAutomaticDiscountBroadcastPreview, DISCOUNT_BROADCAST_CHECK_MS);
}

loadBotUsers();

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

// Persist every private non-admin user interaction for future broadcasts.
bot.use(async (ctx, next) => {
  const user = ctx.from;
  const chatType = ctx.chat?.type;

  if (user && user.id !== ADMIN_ID && (!chatType || chatType === "private")) {
    rememberBotUser(user, "private-interaction");
  }

  return next();
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
    currency: String(ref.currency || "KES").toUpperCase(),
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
    usdtTotal: 0,
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
    if (String(record?.currency || "KES").toUpperCase() === "USDT") {
      counts.usdtTotal += Number(record?.amount || 0) || 0;
    } else {
      counts.total += Number(record?.amount || 0) || 0;
    }
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
    if (Number.isFinite(amount)) {
      if (String(ref?.currency || "KES").toUpperCase() === "USDT") counts.usdtTotal += amount;
      else counts.total += amount;
    }

    counts.checks += typeCounts.checks;
    counts.rechecks += typeCounts.rechecks;
    counts.similarities += typeCounts.similarities;
    counts.resales += typeCounts.resales;
  }

  return counts;
}

async function sendDailySalesSummaryForDate(
  dateKey,
  reason = "scheduled"
) {
  const normalizedDateKey =
    String(
      dateKey ||
      ""
    ).trim();

  if (!normalizedDateKey) {
    throw new Error(
      "Daily summary date key is missing."
    );
  }

  if (
    dailySalesSummary.lastSentDateKey ===
    normalizedDateKey
  ) {
    return {
      sent: false,
      skipped: true,
      dateKey:
        normalizedDateKey
    };
  }

  const summary =
    buildDailySalesSummary(
      normalizedDateKey
    );

  const text =
    `📊 Daily Payment Summary\n\n` +
    `Date: ${normalizedDateKey}\n` +
    `Successful payments: ${summary.payments}\n` +
    `Total collected: ${(summary.total * 0.75).toLocaleString(
      "en-KE",
      {
        maximumFractionDigits: 2
      }
    )} KES\n` +
    `Binance Pay collected: ${summary.usdtTotal.toFixed(2)} USDT (not included in KES total)\n\n` +
    `CHECK: ${summary.checks}\n` +
    `RECHECK: ${summary.rechecks}\n` +
    `SIMILARITY ONLY: ${summary.similarities}\n` +
    `${RESALE_LABEL}: ${summary.resales}`;

  /*
    JK_DAILY_SUMMARY_DELIVERY_ACK_V1

    requireDelivery means sendAdminMessage throws if
    Telegram delivery really failed.

    Therefore lastSentDateKey cannot advance after a
    failed delivery.
  */
  await sendAdminMessage(
    text,
    {
      parse_mode:
        "Markdown",

      requireDelivery:
        true
    }
  );

  dailySalesSummary.lastSentDateKey =
    normalizedDateKey;

  dailySalesSummary.lastSentAt =
    Date.now();

  dailySalesSummary.lastSentReason =
    String(
      reason ||
      "scheduled"
    );

  saveDailySalesSummary();

  console.log(
    `Daily sales summary sent for ${normalizedDateKey} (${reason}).`
  );

  return {
    sent: true,
    skipped: false,
    dateKey:
      normalizedDateKey,
    summary
  };
}


async function sendDailySalesSummaryForPreviousEatDay(
  reason = "scheduled"
) {
  const dateKey =
    moment()
      .utcOffset(180)
      .subtract(
        1,
        "day"
      )
      .format(
        "YYYY-MM-DD"
      );

  return sendDailySalesSummaryForDate(
    dateKey,
    reason
  );
}


async function checkDailySalesSummary(
  reason
) {
  if (
    dailySalesSummarySendInFlight
  ) {
    return;
  }

  dailySalesSummarySendInFlight =
    true;

  try {
    await sendDailySalesSummaryForPreviousEatDay(
      reason
    );
  } catch (e) {
    console.error(
      "Daily sales summary failed:",
      e?.description ||
      e?.message ||
      e
    );
  } finally {
    dailySalesSummarySendInFlight =
      false;
  }
}


function startDailySalesSummaryScheduler() {
  /*
    Startup catch-up.

    If the service was asleep/restarting at midnight,
    the previous EAT day's summary is recovered after
    the process comes back.
  */
  setTimeout(
    () => {
      checkDailySalesSummary(
        "startup-catchup"
      );
    },
    5000
  );

  /*
    Minute watchdog.

    This avoids depending on one fragile midnight
    setTimeout. It is cheap because already-sent days
    return immediately.
  */
  setInterval(
    () => {
      checkDailySalesSummary(
        "scheduler-watchdog"
      );
    },
    DAILY_SALES_SUMMARY_CHECK_MS
  );
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

const PROVIDER_NEUTRAL_PIPELINE =
  "PROVIDER_NEUTRAL_V1";

function isProviderNeutralJob(job) {
  return (
    String(
      job?.reportPipeline ||
      ""
    )
      .trim()
      .toUpperCase() ===
    PROVIDER_NEUTRAL_PIPELINE
  );
}

function createPaidJob({ userId, apiRef, ref, invoiceId, source }) {
  const now = Date.now();
  const batchId = ref?.batchId || `paid_${userId}_${now}`;
  const jobId = String(batchId || apiRef || `paid_${userId}_${now}`);
  const cancelAllowedAt = now + REPORT_PROCESSING_MAX_MINUTES * 60 * 1000;

  paidJobs[jobId] = {
    ...(JK_PROVIDER_CUTOVER_ENABLED
      ? {
          reportPipeline:
            PROVIDER_NEUTRAL_PIPELINE
        }
      : {}),
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

    files:
      Array.isArray(ref?.files)
        ? ref.files.map(
            (file, index) => ({
              ...file,
              fileIndex: index,

              similarityFilter:
                effectiveSimilarityFilter(
                  file
                ),

              jkSubmissionId:
                file.jkSubmissionId,

              reportName:
                file.reportName,

              reportInstitution:
        file.reportInstitution,

              copyleaksStatus:
                "NOT_SUBMITTED",

              copyleaksScanId:
                null
            })
          )
        : [],

    reportModeSnapshot:
      reportSettings.reportMode,

    route:
      reportSettings.reportMode ===
      REPORT_MODE_MANUAL
        ? "MANUAL"
        : "PENDING",

    paidAt: now,
    cancelAllowedAt,
    status: "PROCESSING",
    createdAt: now,
    source: source || "payment-confirmed"
  };

  // JK_REPORT_TEMPLATE_ROTATION_V1: reserve once per paid/admin batch.
  require("./jk-report-template-profiles.cjs").assignBatch(paidJobs[jobId], DATA_DIR);
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
  const clean = String(name || "")
    .trim()
    .replace(/\s+/g, " ");

  const extensionMatch = clean.match(/(\.[^.]+)$/);
  const extension = extensionMatch ? extensionMatch[1] : "";
  let baseName = extension ? clean.slice(0, -extension.length) : clean;

  // Ignore only duplicate-download suffixes (1) through (10)
  // immediately before the file extension.
  baseName = baseName
    .replace(/\s+\((?:[1-9]|10)\)$/, "")
    .trim();

  return (baseName + extension).toLowerCase();
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

// JK_ADMIN_FREE_SCAN_V1
let adminFreeScanSession = null;

function adminFreeScanServiceKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "✅ FULL CHECK",
        "ADMIN_FREE_SCAN_CHECK"
      )
    ],
    [
      Markup.button.callback(
        "📊 SIMILARITY ONLY",
        "ADMIN_FREE_SCAN_SIMILARITY"
      )
    ],
    [Markup.button.callback("🤖 AI REPORT ONLY", "ADMIN_FREE_SCAN_AI_ONLY")],
    [
      Markup.button.callback(
        "❌ Cancel",
        "ADMIN_FREE_SCAN_CANCEL"
      )
    ]
  ]);
}

function adminFreeScanFilterKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "✅ FILTER QUOTES + BIBLIOGRAPHY",
        "ADMIN_FREE_SCAN_FILTERED"
      )
    ],
    [
      Markup.button.callback(
        "📄 DO NOT FILTER",
        "ADMIN_FREE_SCAN_UNFILTERED"
      )
    ],
    [
      Markup.button.callback(
        "❌ Cancel",
        "ADMIN_FREE_SCAN_CANCEL"
      )
    ]
  ]);
}

function adminFreeScanWaitingKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📋 Review Batch", "ADMIN_FREE_SCAN_REVIEW")],
    [Markup.button.callback("❌ Cancel Admin Scan", "ADMIN_FREE_SCAN_CANCEL")]
  ]);
}

function adminFreeScanReviewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🚀 Confirm & Start Scanning", "ADMIN_FREE_SCAN_START")],
    [Markup.button.callback("↩️ Add More Files", "ADMIN_FREE_SCAN_MORE")],
    [Markup.button.callback("❌ Cancel Admin Scan", "ADMIN_FREE_SCAN_CANCEL")]
  ]);
}

function adminDashboardKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "📢 Broadcast",
        "ADMIN_DASH_BROADCAST"
      ),
      Markup.button.callback(
        "🏷️ Discount",
        "ADMIN_DASH_DISCOUNT"
      )
    ],
    [
      Markup.button.callback(
        "📊 Broadcast Stats",
        "ADMIN_DASH_STATS"
      ),
      Markup.button.callback(
        "⚙️ Bot Status",
        "ADMIN_DASH_MODE"
      )
    ],
    [
      Markup.button.callback(
        "💬 User Support",
        "ADMIN_DASH_SUPPORT"
      ),
      Markup.button.callback(
        "📦 File Delivery",
        "ADMIN_DASH_DELIVERY"
      )
    ],
    [
      Markup.button.callback(
        "⚡ Report Generation",
        "ADMIN_DASH_REPORTS"
      ),
      Markup.button.callback(
        "🔎 Similarity Filter",
        "ADMIN_DASH_FILTERS"
      )
    ],
    [
      Markup.button.callback(
        "🎲 Identity Pool",
        "ADMIN_DASH_INSTITUTION"
      ),
      Markup.button.callback(
        "💳 Payments",
        "ADMIN_DASH_PAYMENTS"
      )
    ],
    ...(require("./jk-admin-free-scan-control.cjs").enabled() ? [[
      Markup.button.callback(
        "🧪 Admin Free Scan",
        "ADMIN_DASH_FREE_SCAN"
      )
    ]] : []),
    [
      Markup.button.callback(
        "📋 All Commands",
        "ADMIN_DASH_COMMANDS"
      )
    ],
    [
      Markup.button.callback(
        "🔄 Sync Bot Name",
        "ADMIN_DASH_SYNCNAME"
      )
    ]
  ]);
}

function adminBackKeyboard(extraRows = []) {
  return Markup.inlineKeyboard([
    ...(extraRows || []),
    [Markup.button.callback("🏠 Admin Dashboard", "ADMIN_DASH_HOME")]
  ]);
}

function adminDiscountKeyboard() {
  const rows = [];

  if (
    DISCOUNT_START_EAT &&
    DISCOUNT_END_EAT &&
    isDiscountPublicActive()
  ) {
    rows.push([
      Markup.button.callback(
        "🏷️ Create Discount Preview",
        "ADMIN_DASH_DISCOUNT_PREVIEW"
      )
    ]);
  }

  return adminBackKeyboard(rows);
}

function reportModeKeyboard() {
  return adminBackKeyboard([
    [Markup.button.callback("Report Template", "RPTM:OPEN")],
    [
      Markup.button.callback(
        "🧑‍💻 Manual Only",
        "REPORT_MODE_MANUAL"
      )
    ],
    [
      Markup.button.callback(
        "✅ Admin Approval",
        "REPORT_MODE_APPROVAL"
      )
    ],
    [
      Markup.button.callback(
        "⚡ Automatic API",
        "REPORT_MODE_AUTO"
      )
    ]
  ]);
}

function reportModeAutoConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "✅ ENABLE AUTO API",
        "REPORT_MODE_AUTO_CONFIRM"
      )
    ],
    [
      Markup.button.callback(
        "❌ CANCEL",
        "REPORT_MODE_AUTO_CANCEL"
      )
    ]
  ]);
}

function similarityFilterModeKeyboard() {
  return adminBackKeyboard([
    [
      Markup.button.callback(
        "👤 Client Choice",
        "FILTER_MODE_CLIENT"
      )
    ],
    [
      Markup.button.callback(
        "✅ Always Filtered",
        "FILTER_MODE_FILTERED"
      )
    ],
    [
      Markup.button.callback(
        "📄 Always Unfiltered",
        "FILTER_MODE_UNFILTERED"
      )
    ]
  ]);
}

function institutionKeyboard() {
  return adminBackKeyboard();
}

function clientSimilarityFilterKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "✅ FILTER QUOTES + BIBLIOGRAPHY",
        "SIM_FILTER_FILTERED"
      )
    ],
    [
      Markup.button.callback(
        "📄 DO NOT FILTER",
        "SIM_FILTER_UNFILTERED"
      )
    ],
    [
      Markup.button.callback(
        "❌ Cancel document",
        "TYPE_CANCEL"
      )
    ]
  ]);
}

function adminDashboardText() {
  const stats = getBotUserStats();
  const inactive = isBotInactivePeriod();
  const discountActive = isDiscountPublicActive();

  return [
    "🛠️ JK TURNITIN ADMIN DASHBOARD",
    "",
    "🤖 Bot mode: " + (inactive ? "OFFLINE WINDOW" : "ONLINE"),
    "⚡ Reports: " + reportModeLabel(),
    "🔎 Similarity: " + filterModeLabel(),
    "🎲 Identity: Random per document",
    "🏷️ Discount: " + (discountActive ? "OPEN • " + RESALE_PRICE_KES + " KES" : "CLOSED"),
    "👥 Broadcast users: " + stats.active + " active",
    "",
    "Choose an admin tool below."
  ].join("\n");
}

function adminBroadcastStatsText() {
  const stats = getBotUserStats();
  const lastAt = Number(broadcastMeta?.lastBroadcastAt || 0);
  const lastText = lastAt
    ? moment(lastAt).utcOffset(180).format("YYYY-MM-DD HH:mm:ss [EAT]")
    : "Never";

  return [
    "📊 BROADCAST STATS",
    "",
    "Registered: " + stats.registered,
    "Active: " + stats.active,
    "Inactive/blocked: " + stats.inactive,
    "Broadcast running: " + (broadcastInProgress ? "YES" : "NO"),
    "Last broadcast: " + lastText,
    "Last delivered: " + Number(broadcastMeta?.lastBroadcastDelivered || 0),
    "Last failed: " + Number(broadcastMeta?.lastBroadcastFailed || 0)
  ].join("\n");
}

function adminModeText() {
  const nowUtc = moment.utc().format("YYYY-MM-DD HH:mm");
  const nowEat = moment().utcOffset(180).format("YYYY-MM-DD HH:mm");
  const inactive = isBotInactivePeriod();
  const desiredName = inactive ? BOT_OFFLINE_NAME : BOT_ONLINE_NAME;

  return [
    "⚙️ BOT STATUS",
    "",
    "Now UTC: " + nowUtc,
    "Now EAT: " + nowEat,
    "Inactive UTC: " + INACTIVE_START_UTC + " to " + INACTIVE_END_UTC,
    "Inactive ends EAT: " + INACTIVE_END_EAT_DISPLAY,
    "Current mode: " + (inactive ? "OFFLINE" : "ONLINE"),
    "Target name: " + desiredName,
    "Last applied: " + (lastAppliedBotNameMode || "N/A")
  ].join("\n");
}

function adminDiscountPanelText() {
  const active = isDiscountPublicActive();
  const hasTimedWindow = Boolean(DISCOUNT_START_EAT && DISCOUNT_END_EAT);
  const periodText = hasTimedWindow
    ? formatHHMMTo12HourStrict(DISCOUNT_START_EAT) + " to " + formatHHMMTo12HourStrict(DISCOUNT_END_EAT) + " EAT"
    : "Manual environment mode";

  return [
    "🏷️ DISCOUNT CONTROL",
    "",
    "Status: " + (active ? "OPEN" : "CLOSED"),
    "Price: " + RESALE_PRICE_KES + " KES",
    "Period: " + periodText,
    "Mode: " + (hasTimedWindow ? "AUTOMATIC TIME WINDOW" : "MANUAL"),
    "",
    active && hasTimedWindow
      ? "Tap Create Discount Preview to prepare the current offer for SEND / CANCEL approval."
      : hasTimedWindow
        ? "The preview button will appear automatically when the discount period opens."
        : "Use /discountmode to review the manual discount setting."
  ].join("\n");
}

function adminAllCommandsText() {
  return [
    "📋 ADMIN COMMANDS",
    "",
    "Dashboard",
    "/adminhelp - Open this button dashboard",
    "/admin - Dashboard alias",
    "",
    "Broadcasting",
    "/broadcast <message> - Create custom broadcast preview",
    "/broadcaststats - Broadcast user and delivery stats",
    "/discountbroadcast - Create current discount preview",
    "",
    "Discount + bot",
    "/discountmode - Check discount mode",
    "/mode - Check bot operating status",
    "/syncname - Force bot display-name sync",
    "",
    "Report generation",
    "/reportmode - Manual / Admin Approval / Automatic API",
    "/reporttemplate - Automatic rotation or fixed report profile",
    "/filtermode - Client choice / Always filtered / Always unfiltered",
    "/institution - View automatic identity pool",
    "/copyleaksstatus - Show Copyleaks configuration status",
    "/aihighlights - Generate saved AI highlights to admin",
    "/recoverreports - Recover saved reports to admin",
    "",
    "Support",
    "/reply <userId> <message> - Reply to a user",
    "/cancelreply - Cancel reply session",
    "",
    "File delivery",
    "/filebatch <userId> [caption] - Open delivery batch",
    "/donebatch - Finish delivery batch",
    "/cancelbatch - Cancel delivery batch",
    "",
    "Payments",
    "/paiduser <userId> - Confirm latest user payment",
    "/paidref <apiRef> - Confirm payment reference"
  ].join("\n");
}

async function showAdminScreen(ctx, textValue, keyboard, edit = false) {
  const extra = { reply_markup: keyboard.reply_markup };

  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(textValue, extra);
      return;
    } catch (err) {
      const msg = String(err?.description || err?.message || err || "");
      if (/message is not modified/i.test(msg)) return;
    }
  }

  await ctx.reply(textValue, extra);
}

async function showAdminDashboard(ctx, edit = false) {
  return showAdminScreen(ctx, adminDashboardText(), adminDashboardKeyboard(), edit);
}

async function syncAdminCommandMenu() {
  const commands = [
    { command: "adminhelp", description: "Open admin button dashboard" },
    { command: "broadcast", description: "Create custom broadcast preview" },
    { command: "broadcaststats", description: "View broadcast statistics" },
    { command: "discountbroadcast", description: "Create discount broadcast preview" },
    { command: "discountmode", description: "Check discount mode" },
    { command: "mode", description: "Check bot status" },
    { command: "syncname", description: "Sync bot display name" },
    { command: "reportmode", description: "Set report generation mode" },
    { command: "reporttemplate", description: "View or set report template rotation" },
    { command: "filtermode", description: "Set similarity filtering mode" },
    { command: "institution", description: "View automatic identity pool" },
    { command: "copyleaksstatus", description: "Check Copyleaks API status" },
    { command: "aihighlights", description: "Generate saved AI highlights to admin" },
    { command: "recoverreports", description: "Recover saved reports to admin" },
    { command: "reply", description: "Reply to a user" },
    { command: "filebatch", description: "Open report delivery batch" },
    { command: "donebatch", description: "Finish report delivery batch" },
    { command: "cancelbatch", description: "Cancel report delivery batch" },
    { command: "paiduser", description: "Confirm latest user payment" },
    { command: "paidref", description: "Confirm payment reference" }
  ];

  try {
    await bot.telegram.callApi("setMyCommands", {
      commands,
      scope: { type: "chat", chat_id: ADMIN_ID }
    });
    console.log("Admin Telegram command menu synced");
  } catch (err) {
    console.error("Failed to sync admin command menu:", err?.description || err?.message || err);
  }
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
    rows.push([Markup.button.callback("🌍 International", "PAYMENT_METHOD_WORLDWIDE")]);
  }

  // Legacy Tanzania payment callback remains supported for pending orders; no new button.

  rows.push([Markup.button.callback("\u274C Cancel payment attempt", "PAYMENT_CANCEL")]);

  return Markup.inlineKeyboard(rows);
}

function internationalPayKeyboard(checkoutUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.url("\u{1F3E6} Pay via Kenyan Bank", checkoutUrl)],
    [Markup.button.callback("\u274C Cancel payment attempt", "PAYMENT_CANCEL")]
  ]);
}

function worldwidePaymentKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📱 M-Pesa to Kenya", "WORLDWIDE_MPESA")],
    [Markup.button.callback("🟡 Binance Pay — USDT", "WORLDWIDE_BINANCE")],
    [Markup.button.callback("❌ Cancel payment attempt", "PAYMENT_CANCEL")]
  ]);
}

function paymentWaitKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("\u{1F501} Resend STK Push", "STK_RESEND")],
    [Markup.button.callback("\u{1F4DE} Change phone number", "STK_CHANGE_PHONE")],
    [Markup.button.callback("\u274C Cancel payment attempt", "PAYMENT_CANCEL")]
  ]);
}

function internationalCopyKeyboard(recipient, note, method) {
  return Markup.inlineKeyboard([
    [{text: method === worldwidePay.METHOD_BINANCE ? "📋 Copy Binance User ID: " + recipient : "📋 Copy recipient: " + recipient, copy_text: {text: recipient}}],
    [{text: "📋 Copy note: " + note, copy_text: {text: note}}],
    [Markup.button.callback("❌ Cancel", "PAYMENT_CANCEL")]
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
  const s = String(text || "").replace(/<[^>]*>/g, "");
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

    rows.push([
      Markup.button.callback(
        "🚫 REMOVE LOGO/NAME",
        `ADMIN_CLEAN_COPY_NOTE_${userId}`
      )
    ]);

    rows.push([
      Markup.button.callback(
        "🧹 PRELIM PAGES REMOVED",
        `ADMIN_PRELIM_REMOVED_${userId}`
      )
    ]);
  } else if (variant === "delivery") {
    rows.push([Markup.button.callback("📦 Filebatch", `ADMIN_FILEBATCH_${userId}`)]);
    rows.push([Markup.button.callback("💬 Reply", `ADMIN_REPLY_${userId}`)]);
    rows.push([Markup.button.callback("✅ Confirm", `ADMIN_PAID_${userId}`)]);
  } else if (variant === "paid") {
    const latestJob =
      getLatestActivePaidJob(userId);

    const paidMode =
      latestJob?.reportModeSnapshot ||
      reportSettings.reportMode;

    /*
      MANUAL mode deliberately preserves
      the existing Filebatch button.
    */
    if (
      paidMode ===
      REPORT_MODE_MANUAL
    ) {
      rows.push([
        Markup.button.callback(
          "📦 Filebatch",
          `ADMIN_FILEBATCH_${userId}`
        )
      ]);
    } else if (
      paidMode ===
      REPORT_MODE_APPROVAL
    ) {
      rows.push([
        Markup.button.callback(
          "🧑‍💻 Manual",
          `ADMIN_MANUAL_${userId}`
        ),
        Markup.button.callback(
          "⚡ Provider API",
          `ADMIN_COPYLEAKS_${userId}`
        )
      ]);

      rows.push([
        Markup.button.callback(
          "🔎 Filters",
          `ADMIN_JOB_FILTERS_${userId}`
        )
      ]);
    } else {
      rows.push([
        Markup.button.callback(
          "⚡ API Status",
          `ADMIN_COPYLEAKS_STATUS_${userId}`
        ),
        Markup.button.callback(
          "🧑‍💻 Manual Fallback",
          `ADMIN_MANUAL_${userId}`
        )
      ]);
    }

    rows.push([
      Markup.button.callback(
        "💬 Reply",
        `ADMIN_REPLY_${userId}`
      )
    ]);
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
  const userIdForButtons =
    extractAdminActionUserId(text);

  const adminButtons =
    extra.adminButtons;

  const requireDelivery =
    Boolean(
      extra.requireDelivery
    );

  const finalExtra = {
    ...extra
  };

  delete finalExtra.adminButtons;
  delete finalExtra.requireDelivery;

  if (!finalExtra.parse_mode) {
    finalExtra.parse_mode =
      "Markdown";
  }

  if (
    userIdForButtons &&
    adminButtons &&
    !finalExtra.reply_markup
  ) {
    finalExtra.reply_markup =
      adminActionKeyboard(
        userIdForButtons,
        adminButtons
      ).reply_markup;
  }

  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      text,
      finalExtra
    );

    return true;
  } catch (firstErr) {
    try {
      const fallbackExtra = {
        ...finalExtra
      };

      delete fallbackExtra.parse_mode;

      await bot.telegram.sendMessage(
        ADMIN_ID,
        text,
        fallbackExtra
      );

      return true;
    } catch (e2) {
      console.error(
        "Admin message failed:",
        e2?.description ||
        e2?.message ||
        e2
      );

      if (requireDelivery) {
        throw e2;
      }

      return false;
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
function telegramRetryAfterSeconds(
  err
) {
  const candidates = [
    err?.parameters?.retry_after,
    err?.response?.parameters?.retry_after,
    err?.response?.body?.parameters?.retry_after,
    err?.payload?.parameters?.retry_after
  ];

  for (
    const value of
    candidates
  ) {
    const n =
      Number(value);

    if (
      Number.isFinite(n) &&
      n > 0
    ) {
      return Math.ceil(n);
    }
  }

  return 0;
}


async function getTelegramBotDisplayName() {
  const result =
    await bot.telegram.callApi(
      "getMyName",
      {}
    );

  return String(
    result?.name ||
    ""
  ).trim();
}


async function syncBotDisplayName(
  force = false
) {
  const inactive =
    isBotInactivePeriod();

  const mode =
    inactive
      ? "OFFLINE"
      : "ONLINE";

  const desiredName =
    inactive
      ? BOT_OFFLINE_NAME
      : BOT_ONLINE_NAME;

  const now =
    Date.now();

  if (
    botNameSyncInFlight
  ) {
    return false;
  }

  /*
    Important:
    even a forced /syncname must respect Telegram's
    retry_after. Otherwise repeated manual retries make
    the rate limit worse.
  */
  if (
    now <
    botNameRetryNotBefore
  ) {
    const waitSeconds =
      Math.max(
        1,
        Math.ceil(
          (
            botNameRetryNotBefore -
            now
          ) /
          1000
        )
      );

    if (force) {
      console.warn(
        `Bot display-name sync deferred for ${waitSeconds}s due to Telegram retry_after.`
      );
    }

    return false;
  }

  if (
    !force &&
    lastAppliedBotNameMode ===
      mode &&
    now -
      botNameLastVerifiedAt <
      BOT_NAME_VERIFY_INTERVAL_MS
  ) {
    return true;
  }

  botNameSyncInFlight =
    true;

  try {
    /*
      Read Telegram first.

      This prevents needless setMyName calls on every
      deployment when the name is already correct.
    */
    const actualName =
      await getTelegramBotDisplayName();

    botNameLastVerifiedAt =
      Date.now();

    if (
      actualName ===
      BOT_ONLINE_NAME
    ) {
      lastAppliedBotNameMode =
        "ONLINE";
    } else if (
      actualName ===
      BOT_OFFLINE_NAME
    ) {
      lastAppliedBotNameMode =
        "OFFLINE";
    }

    if (
      actualName ===
      desiredName
    ) {
      lastAppliedBotNameMode =
        mode;

      botNameRetryNotBefore =
        0;

      return true;
    }

    await bot.telegram.callApi(
      "setMyName",
      {
        name:
          desiredName
      }
    );

    lastAppliedBotNameMode =
      mode;

    botNameLastVerifiedAt =
      Date.now();

    botNameRetryNotBefore =
      0;

    console.log(
      `Bot display name synced: ${desiredName}`
    );

    return true;
  } catch (err) {
    const retryAfter =
      telegramRetryAfterSeconds(
        err
      );

    if (
      retryAfter > 0
    ) {
      /*
        Small safety buffer prevents retrying exactly
        on Telegram's boundary.
      */
      botNameRetryNotBefore =
        Date.now() +
        (
          retryAfter +
          5
        ) *
        1000;

      console.error(
        `Failed to sync bot display name: Telegram rate limit. Retry after ${retryAfter}s.`
      );
    } else {
      console.error(
        "Failed to sync bot display name:",
        err?.description ||
        err?.message ||
        err
      );
    }

    return false;
  } finally {
    botNameSyncInFlight =
      false;
  }
}


function startBotDisplayNameScheduler() {
  /*
    Startup verification.

    This first performs getMyName. setMyName is called
    only when Telegram's real name differs from the
    desired ONLINE/OFFLINE state.
  */
  syncBotDisplayName(
    true
  );

  setInterval(
    () => {
      syncBotDisplayName(
        false
      );
    },
    60 * 1000
  );
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
  if (paidAiHighlights) paidAiHighlights.cancelPhone(userId);
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
    STAGE_WAIT_SIM_FILTER,
    STAGE_WAIT_PAYMENT_METHOD,
    STAGE_WAIT_PHONE,
    STAGE_WAIT_PAYMENT
  ].includes(sub.stage);
}

function ensureFreshSubmission(userId) {
  if (!submissions[userId]) submissions[userId] = createEmptySubmission();
  return submissions[userId];
}

function supportedScanUpload(name) {
  return /\.(pdf|docx|doc|pptx)$/iu.test(String(name || ""));
}
function createStoredFileFromDocument(userId, doc) {
  const fileName = doc.file_name || `file_${Date.now()}`;
  const fileUniqueId = doc.file_unique_id || null;
  const eligibility = getRecheckEligibility(userId, fileName, fileUniqueId);

  return {
    file_id: doc.file_id,
    file_unique_id: fileUniqueId,
    file_name: fileName,
    file_size: Number(doc.file_size || 0) || null,
    type: null,
    price: null,
    uploadedAt: Date.now(),
    recheckEligible: eligibility.eligible,
    recheckMatchedAt: eligibility.matchedAt,
    recheckHoursLeft: eligibility.hoursLeft,
    similarityFilter: null,
    pendingType: null,
    jkSubmissionId: generateJkSubmissionId(),
    reportName: chooseReportName(),
    reportInstitution: chooseReportInstitution()
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

function escapeAdminHtml(value) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildAdminDocumentCaption({
  userId,
  name,
  usernameText,
  file,
  fileNumber,
  expectedFiles
}) {
  const fileNo =
    Number(fileNumber || 0) || "?";

  const total =
    Number(expectedFiles || 0) || "?";

  const fileName =
    escapeAdminHtml(
      file?.file_name ||
      file?.fileName ||
      "N/A"
    );

  const service =
    escapeAdminHtml(
      adminReportTypeLabel(
        file?.type
      )
    );

  const price =
    file?.price
      ? escapeAdminHtml(
          String(file.price) +
          " KES"
        )
      : "Not selected yet";

  const exclusion =
    escapeAdminHtml(
      similarityFilterLabel(
        effectiveSimilarityFilter(
          file
        )
      )
    );

  const cleanName =
    escapeAdminHtml(
      name || "N/A"
    );

  const cleanUsername =
    escapeAdminHtml(
      usernameText ||
      "N/A"
    );

  return [
    "📨 <b>Document received</b>",
    "",
    "<b>File:</b> " +
      fileNo +
      "/" +
      total,
    "<b>Service:</b> " +
      service,
    "<b>Price:</b> " +
      price,
    "<b>File Name:</b> " +
      fileName,
    "<b>Exclusion:</b> " +
      exclusion,
    "",
    "<b>User ID:</b> " +
      userId,
    "<b>Name:</b> " +
      cleanName,
    "<b>Username:</b> @" +
      cleanUsername
  ].join("\n");
}

async function sendSelectedDocumentToAdmin(
  user,
  sub,
  file,
  fileNumber
) {
  if (!file) return;
  if (file.adminSentAt) return;

  const userId =
    user.id;

  const name =
    getUserFullName(
      user
    );

  const usernameText =
    safeText(
      user.username ||
      "N/A"
    );

  const caption =
    buildAdminDocumentCaption({
      userId,
      name,
      usernameText,
      file,
      fileNumber,
      expectedFiles:
        sub?.expectedFiles
    });

  try {
    if (
      !file.sourceChatId ||
      !file.sourceMessageId
    ) {
      throw new Error(
        "Missing original document message details."
      );
    }

    const copied =
      await bot.telegram.copyMessage(
        ADMIN_ID,
        file.sourceChatId,
        file.sourceMessageId,
        {
          caption,
          parse_mode:
            "HTML",
          reply_markup:
            adminActionKeyboard(
              userId,
              "document"
            ).reply_markup
        }
      );

    file.adminSentAt =
      Date.now();

    file.adminMessageId =
      copied?.message_id ||
      null;
  } catch (err) {
    await sendAdminMessage(
      "⚠️ Document selected but copy failed. Details below.\n\n" +
        caption,
      {
        adminButtons:
          "document",
        parse_mode:
          "HTML"
      }
    );

    try {
      if (
        file.sourceChatId &&
        file.sourceMessageId
      ) {
        await bot.telegram.forwardMessage(
          ADMIN_ID,
          file.sourceChatId,
          file.sourceMessageId
        );
      }
    } catch {}

    file.adminSentAt =
      Date.now();
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
    ? "\n🌍 International Payment: M-Pesa *" + sub.amount + " KES* or Binance *" + formatPaymentMoney(worldwidePay.kesToUsdt(sub.amount, WORLDWIDE_KES_PER_USDT), "USDT") + "*"
    : "";

  const tzOtherLine = "";

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

  ensureFileReportIdentity(file);

  file.type = kind;
  file.pendingType = null;

  if (!file.similarityFilter) {
    file.similarityFilter =
      effectiveSimilarityFilter(file);
  }

  if (kind === "CHECK") {
    file.price = CHECK_PRICE_KES;
  }
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

async function finalizeTypeWithFilterSelection(
  ctx,
  sub,
  kind
) {
  const file =
    getCurrentPendingFile(sub);

  if (!file) return;

  ensureFileReportIdentity(file);

  // JK_MANUAL_FILTER_PATCH_V1
  // Similarity filtering applies in Manual, Admin Approval,
  // and Automatic API modes. Delivery mode does not change
  // the client's filtering preference.

  if (
    reportSettings.filterMode ===
    FILTER_MODE_CLIENT
  ) {
    file.pendingType = kind;
    sub.stage = STAGE_WAIT_SIM_FILTER;

    await ctx.reply(
      "🔎 *Choose similarity filtering*\n\n" +
      "*Filter Quotes + Bibliography*\n" +
      "Quotations and the reference/bibliography section will not count toward the similarity percentage.\n\n" +
      "*Do Not Filter*\n" +
      "All detected matching text will count toward the similarity percentage.",
      {
        parse_mode: "Markdown",
        reply_markup:
          clientSimilarityFilterKeyboard()
            .reply_markup
      }
    );

    return;
  }

  file.similarityFilter =
    reportSettings.filterMode ===
    FILTER_MODE_UNFILTERED
      ? FILTER_MODE_UNFILTERED
      : FILTER_MODE_FILTERED;

  await finalizeFileTypeSelection(
    ctx,
    sub,
    kind
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
      await finalizeTypeWithFilterSelection(ctx, sub, "RESALE");
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

  await finalizeTypeWithFilterSelection(ctx, sub, kind);
}

bot.action(/^ADMIN_PRELIM_REMOVED_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);

  if (ctx.from.id !== ADMIN_ID) {
    return ctx.answerCbQuery("Not allowed.");
  }

  await ctx.answerCbQuery("Notice sent.");

  await bot.telegram.sendMessage(
    userId,
    PRELIM_PAGES_REMOVED_NOTE,
    {
      parse_mode: "Markdown"
    }
  );
});

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

  const paidJob = createPaidJob({
    userId,
    apiRef,
    ref: completedRef,
    invoiceId,
    source
  });

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
      MESSAGES.paidMsgBatch(completedRef.amount, completedRef.summary || "Batch payment", completedRef.currency || "KES"),
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
    )} ${safeText(completedRef.currency || "KES")}\nType: ${safeText(completedRef.kind || "BATCH")}\nRef: ${safeText(
      invoiceId || completedRef.invoiceId || apiRef || "N/A"
    )}`,
    { adminButtons: "paid" }
  );

  if (
    paidJob &&
    paidJob.reportModeSnapshot ===
      REPORT_MODE_AUTO
  ) {
    setImmediate(
      async () => {
        try {
          await submitPaidJobToActiveProvider(
            paidJob.jobId
          );
        } catch (err) {
          await sendAdminMessage(
            "❌ Automatic provider submission failed\n" +
            "User: " +
            userId +
            "\nError: " +
            safeText(
              err?.message || err
            )
          );
        }
      }
    );
  }

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
      file_size: Number(file.file_size || file.fileSize || 0) || null,
      type: file.type || null,
      price: file.price || null,
      recheckEligible: Boolean(file.recheckEligible),
      similarityFilter:
        effectiveSimilarityFilter(file),
      jkSubmissionId:
        file.jkSubmissionId || null,
      reportName:
        file.reportName || null,
      reportInstitution:
        file.reportInstitution
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
      file_size: Number(file.file_size || file.fileSize || 0) || null,
      type: file.type || null,
      price: file.type === "SIMILARITY" ? INTERNATIONAL_SIMILARITY_ONLY_PRICE : INTERNATIONAL_CHECK_PRICE_USD,
      recheckEligible: Boolean(file.recheckEligible),
      similarityFilter:
        effectiveSimilarityFilter(file),
      jkSubmissionId:
        file.jkSubmissionId || null,
      reportName:
        file.reportName || null,
      reportInstitution:
        file.reportInstitution
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
      file_size: Number(file.file_size || file.fileSize || 0) || null,
      type: file.type || null,
      price: file.price || null,
      recheckEligible: Boolean(file.recheckEligible),
      similarityFilter:
        effectiveSimilarityFilter(file),
      jkSubmissionId:
        file.jkSubmissionId || null,
      reportName:
        file.reportName || null,
      reportInstitution:
        file.reportInstitution
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
    await ctx.reply("👋 Admin mode is ready. Use the dashboard below or /adminhelp anytime.", {
      reply_markup: { remove_keyboard: true }
    });
    await showAdminDashboard(ctx);
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
// JK_CREDIT_FREE_AI_ADMIN_REPLAY_V1
// Reuses the persisted provider bundle. NO call to Sapling / Quetext.
// Both explicit requests and the one-time saved job repair deliver ADMIN ONLY.
const adminAiReplayActive = new Set();
async function deliverSavedAiReportToAdmin(bundlePath, label) {
  const full = path.resolve(String(bundlePath || ""));
  const dataRoot = path.resolve(DATA_DIR, "provider-runs") + path.sep;
  if (!full.startsWith(dataRoot) || path.basename(full) !== "bundle.json" ||
      !fs.existsSync(full)) throw new Error("Original saved provider bundle unavailable");
  const saved = JSON.parse(fs.readFileSync(full, "utf8"));
  if (!saved?.reportIdentity?.jkSubmissionId ||
      !saved?.aiDetection?.available ||
      !saved?.canonicalDocument?.pages?.length ||
      !Array.isArray(saved.aiDetection.ranges)) {
    throw new Error("No verified saved AI detection data; refusing new provider request");
  }
  if (adminAiReplayActive.has(full)) throw new Error("Replay already in progress");
  adminAiReplayActive.add(full);
  try {
    const {renderSavedAiOnlyFromBundle} = require("./jk-report-renderer-max.js");
    const outfile = path.join(path.dirname(full), "reports",
      "ADMIN_SAVED_AI_HIGHLIGHTS_REPLAY_" +
      String(saved.reportIdentity.jkSubmissionId).replace(/[^A-Za-z0-9]/g,"") + ".pdf");
    await renderSavedAiOnlyFromBundle(full,outfile);
    await bot.telegram.sendDocument(ADMIN_ID, {
      source: fs.createReadStream(outfile),
      filename: path.basename(outfile)
    }, {caption:
      "ADMIN-ONLY REGENERATED AI REPORT (NO API CREDITS). " +
      "Reuses SAVED Sapling result/percentage; bibliography highlight layout corrected. " +
      "Score has NOT been recalculated. " + String(label||"").slice(0,100)});
    return outfile;
  } finally {adminAiReplayActive.delete(full);}
}
function findSavedBundleForSubmission(submissionId) {
  const root = path.resolve(DATA_DIR,"provider-runs");
  if (!fs.existsSync(root)) return null;
  const found=[];
  for(const ent of fs.readdirSync(root,{withFileTypes:true})){
    if (!ent.isDirectory()) continue;
    const bundle=path.join(root,ent.name,"bundle.json");
    if (!fs.existsSync(bundle)) continue;
    try{
      const saved=JSON.parse(fs.readFileSync(bundle,"utf8"));
      if(saved?.reportIdentity?.jkSubmissionId===submissionId &&
         /^SC60100300GS07(?:\b|[ ._-])/i.test(
           String(saved?.reportIdentity?.filename||"SC60100300GS07"))) found.push(bundle);
    }catch {}
  }
  return found.length===1?found[0]:null;
}
bot.command("replayai", async (ctx) => {
  if(ctx.from?.id!==ADMIN_ID || ctx.chat?.type!=="private")return;
  const input=String(ctx.message?.text||"").trim().split(/\s+/u);
  const submissionId=input[1];
  if(!/^trn:oid:::1:[1-9]\d{9}$/u.test(submissionId||"")) {
    await ctx.reply("Usage: /replayai trn:oid:::1:3555822768\n" +
      "Uses saved AI data only. No Sapling or Quetext request. Admin-only delivery.");
    return;
  }
  const bundle=findSavedBundleForSubmission(submissionId);
  if(!bundle){await ctx.reply("Saved provider bundle not uniquely available. No API request made.");return;}
  try{
    await deliverSavedAiReportToAdmin(bundle,"Requested by administrator");
    await ctx.reply("Credit-free saved AI report delivered to this admin chat. The original detection percentage was reused.");
  }catch(e){await ctx.reply("Credit-free replay failed: "+String(e.message||e).slice(0,250));}
});
async function sendOneTimeSavedAiCorrection() {
  // Explicit, single-submission repair request, not a periodic scan.
  const id="trn:oid:::1:3555822768";
  const bundle=findSavedBundleForSubmission(id);
  if(!bundle){
    console.warn("ADMIN SAVED AI REPLAY: target bundle not available; no API call");
    return;
  }
  const marker=path.join(path.dirname(bundle),"admin-ai-replay-"+id.replace(/[^A-Za-z0-9]/g,"")+".sent");
  if(fs.existsSync(marker))return;
  try {
    await deliverSavedAiReportToAdmin(bundle,"One-time correction requested by administrator");
    fs.writeFileSync(marker,JSON.stringify({submissionId:id,deliveredAt:new Date().toISOString()}),
      {encoding:"utf8",flag:"wx"});
    console.log("ADMIN SAVED AI REPLAY: delivered",id);
  }catch(e){
    console.error("ADMIN SAVED AI REPLAY: not delivered",String(e?.message||e));
  }
}

bot.command("adminhelp", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await showAdminDashboard(ctx);
});

bot.command("admin", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await showAdminDashboard(ctx);
});

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
  const block = worldwidePay.manualApprovalBlock(ref, isProofCodeUsed);
  if (block) return { ok: false, message: "❌ Payment NOT approved: " + block };

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
  const block = worldwidePay.manualApprovalBlock(ref, isProofCodeUsed);
  if (block) return ctx.reply("❌ Payment NOT approved: " + block);

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

bot.command("broadcaststats", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const stats = getBotUserStats();
  const lastAt = Number(broadcastMeta?.lastBroadcastAt || 0);
  const lastText = lastAt
    ? moment(lastAt).utcOffset(180).format("YYYY-MM-DD HH:mm:ss [EAT]")
    : "Never";

  await ctx.reply(
    "📊 Broadcast users\n\n" +
      `Registered: ${stats.registered}\n` +
      `Active: ${stats.active}\n` +
      `Inactive/blocked: ${stats.inactive}\n` +
      `Broadcast running: ${broadcastInProgress ? "YES" : "NO"}\n` +
      `Last broadcast: ${lastText}\n` +
      `Last delivered: ${Number(broadcastMeta?.lastBroadcastDelivered || 0)}\n` +
      `Last failed: ${Number(broadcastMeta?.lastBroadcastFailed || 0)}`
  );
});

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  if (broadcastInProgress) {
    return ctx.reply("⚠️ A broadcast is already running. Use /broadcaststats to check it.");
  }

  cleanupPendingBroadcasts();

  const raw = String(ctx.message?.text || "");
  const message = raw
    .replace(/^\/broadcast(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i, "")
    .trim();

  if (!message) {
    return ctx.reply("Usage: /broadcast <message>");
  }

  if (message.length > 3200) {
    return ctx.reply("❌ Broadcast message is too long. Keep it at 3,200 characters or fewer.");
  }

  const recipientIds = getActiveBotUserIds();
  if (recipientIds.length === 0) {
    return ctx.reply("❌ No active registered bot users are available for broadcast yet.");
  }

  const token = makeBroadcastToken();
  pendingBroadcasts[token] = {
    message,
    recipientIds,
    createdAt: Date.now()
  };

  await ctx.reply(
    "📢 BROADCAST PREVIEW\n\n" +
      message +
      "\n\n" +
      `Recipients: ${recipientIds.length} active user(s)\n` +
      "This preview expires in 15 minutes.",
    { reply_markup: broadcastPreviewKeyboard(token).reply_markup }
  );
});

bot.command("discountbroadcast", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  if (!DISCOUNT_START_EAT || !DISCOUNT_END_EAT) {
    return ctx.reply("❌ No timed public discount window is configured.");
  }

  if (!isDiscountPublicActive()) {
    return ctx.reply(
      "ℹ️ Public discount is currently closed.\n\n" +
        `Period: ${formatHHMMTo12HourStrict(DISCOUNT_START_EAT)} - ${formatHHMMTo12HourStrict(DISCOUNT_END_EAT)} EAT\n` +
        `Price: ${RESALE_PRICE_KES} KES`
    );
  }

  try {
    const result = await createDiscountBroadcastPreview(true);
    if (result.ok) {
      return ctx.reply("✅ Fresh discount broadcast preview created.");
    }
    if (result.reason === "no-recipients") {
      return ctx.reply("❌ No active registered users are available for broadcast.");
    }
    return ctx.reply("❌ Discount broadcast preview could not be created.");
  } catch (err) {
    return ctx.reply("❌ Failed to create preview: " + String(err?.message || err));
  }
});

// =====================
// ADMIN QUICK ACTION BUTTONS
// =====================
bot.command(
  "reportmode",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return;
    }

    await ctx.reply(
      "⚙️ REPORT GENERATION\n\n" +
      "Current Mode: " +
      reportModeLabel(),
      {
        reply_markup:
          reportModeKeyboard()
            .reply_markup
      }
    );
  }
);

bot.command(
  "filtermode",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return;
    }

    await ctx.reply(
      "🔎 SIMILARITY FILTERING\n\n" +
      "Current Mode: " +
      filterModeLabel(),
      {
        reply_markup:
          similarityFilterModeKeyboard()
            .reply_markup
      }
    );
  }
);

bot.command(
  "institution",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return;
    }

    await ctx.reply(
      ["🎲 AUTOMATIC REPORT IDENTITY", "", "Names:", "• Author Author", "• User User", "", "Institutions:", "• Arsi University", "• University of Anbar", "• Oromia State University", "", "One random name + one random institution are assigned once per new document."].join("\n"),
      {
        reply_markup:
          institutionKeyboard()
            .reply_markup
      }
    );
  }
);

bot.command(
  "copyleaksstatus",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return;
    }

    await ctx.reply(
      [
        "⚡ COPYLEAKS STATUS",
        "",
        "Enabled: " +
          (
            COPYLEAKS_ENABLED
              ? "YES"
              : "NO"
          ),

        "Configured: " +
          (
            COPYLEAKS_EMAIL &&
            COPYLEAKS_API_KEY &&
            COPYLEAKS_WEBHOOK_SECRET
              ? "YES"
              : "NO"
          ),

        "Sandbox: " +
          (
            COPYLEAKS_SANDBOX
              ? "YES"
              : "NO"
          ),

        "Shared Data Hub scan: " +
          (
            COPYLEAKS_SCAN_SHARED_DB
              ? "YES"
              : "NO"
          ),

        "Index submitted docs: " +
          (
            COPYLEAKS_INDEX_TO_DB
              ? "YES"
              : "NO"
          ),

        "Report mode: " +
          reportModeLabel(),

        "Filter mode: " +
          filterModeLabel(),

        "Institution: " +
          reportSettings.institution
      ].join("\n")
    );
  }
);

bot.action("ADMIN_DASH_HOME", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  await ctx.answerCbQuery();
  await showAdminDashboard(ctx, true);
});

bot.action("ADMIN_DASH_BROADCAST", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  await ctx.answerCbQuery();

  const stats = getBotUserStats();
  await showAdminScreen(
    ctx,
    [
      "📢 CUSTOM BROADCAST",
      "",
      "Create a custom message with:",
      "/broadcast <message>",
      "",
      "Active recipients: " + stats.active,
      "",
      "The bot will show a preview with SEND TO ALL and CANCEL before anything is delivered."
    ].join("\n"),
    adminBackKeyboard([
      [Markup.button.callback("📊 View Broadcast Stats", "ADMIN_DASH_STATS")]
    ]),
    true
  );
});

bot.action("ADMIN_DASH_STATS", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  await ctx.answerCbQuery();
  await showAdminScreen(ctx, adminBroadcastStatsText(), adminBackKeyboard(), true);
});

bot.action("ADMIN_DASH_DISCOUNT", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  await ctx.answerCbQuery();
  await showAdminScreen(ctx, adminDiscountPanelText(), adminDiscountKeyboard(), true);
});

bot.action("ADMIN_DASH_DISCOUNT_PREVIEW", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  if (!DISCOUNT_START_EAT || !DISCOUNT_END_EAT) {
    return ctx.answerCbQuery("No timed discount window configured.", { show_alert: true });
  }

  if (!isDiscountPublicActive()) {
    return ctx.answerCbQuery("Discount is currently closed.", { show_alert: true });
  }

  await ctx.answerCbQuery("Creating preview...");

  try {
    const result = await createDiscountBroadcastPreview(true);
    if (result.ok) {
      await ctx.reply("✅ Fresh discount broadcast preview created. Choose SEND TO ALL or CANCEL on the preview.");
      return;
    }
    if (result.reason === "no-recipients") {
      await ctx.reply("❌ No active registered users are available for broadcast.");
      return;
    }
    await ctx.reply("❌ Discount broadcast preview could not be created.");
  } catch (err) {
    await ctx.reply("❌ Failed to create preview: " + String(err?.message || err));
  }
});

bot.action("ADMIN_DASH_MODE", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  await ctx.answerCbQuery();
  await showAdminScreen(ctx, adminModeText(), adminBackKeyboard(), true);
});

bot.action("ADMIN_DASH_SYNCNAME", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  await ctx.answerCbQuery("Syncing bot name...");
  await syncBotDisplayName(true);

  const inactive = isBotInactivePeriod();
  await showAdminScreen(
    ctx,
    "✅ Bot display name sync completed.\n\nCurrent mode: " + (inactive ? "OFFLINE" : "ONLINE"),
    adminBackKeyboard(),
    true
  );
});

bot.action("ADMIN_DASH_SUPPORT", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  await ctx.answerCbQuery();
  await showAdminScreen(
    ctx,
    [
      "💬 USER SUPPORT",
      "",
      "/reply <userId> <message>",
      "Send a direct support reply.",
      "",
      "/cancelreply",
      "Cancel an active reply session.",
      "",
      "Tip: User notifications also include a Reply button when available."
    ].join("\n"),
    adminBackKeyboard(),
    true
  );
});

bot.action("ADMIN_DASH_DELIVERY", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  await ctx.answerCbQuery();
  await showAdminScreen(
    ctx,
    [
      "📦 FILE DELIVERY",
      "",
      "/filebatch <userId> [caption]",
      "Open a delivery batch for a user.",
      "",
      "/donebatch",
      "Finish the active batch and close delivery.",
      "",
      "/cancelbatch",
      "Cancel the active delivery batch."
    ].join("\n"),
    adminBackKeyboard(),
    true
  );
});

bot.action("ADMIN_DASH_PAYMENTS", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  await ctx.answerCbQuery();
  await showAdminScreen(
    ctx,
    [
      "💳 PAYMENT ADMIN",
      "",
      "/paiduser <userId>",
      "Manually confirm the latest pending payment for a user.",
      "",
      "/paidref <apiRef>",
      "Manually confirm a specific payment reference.",
      "",
      "Use manual confirmation only after you have verified the payment."
    ].join("\n"),
    adminBackKeyboard(),
    true
  );
});

// JK_ADMIN_FREE_SCAN_ENABLED_V1
require("./jk-admin-free-scan-control.cjs").registerGuard(bot, {
  adminId: ADMIN_ID,
  onDisable: () => { adminFreeScanSession = null; }
});

// JK_ADMIN_FREE_SCAN_ACTIONS_V1
bot.action(
  "ADMIN_DASH_FREE_SCAN",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    adminFreeScanSession = null;

    /*
      Prevent an old manual filebatch target
      from receiving a personal admin document.
    */
    delete pendingFileTargets[
      ADMIN_ID
    ];

    await ctx.answerCbQuery();

    await showAdminScreen(
      ctx,
      [
        "🧪 ADMIN FREE SCAN",
        "",
        "No customer payment will be created.",
        "The finished report is delivered only to your admin account.",
        "",
        "Quetext/Sapling API usage still applies.",
        "",
        "Choose the report type."
      ].join("\n"),
      adminFreeScanServiceKeyboard(),
      true
    );
  }
);

bot.action(
  "ADMIN_FREE_SCAN_CHECK",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    adminFreeScanSession = {
      type: "CHECK",
      similarityFilter: null,
      stage: "WAIT_FILTER",
      startedAt: Date.now()
    };

    await ctx.answerCbQuery(
      "Full check selected"
    );

    await showAdminScreen(
      ctx,
      [
        "🧪 ADMIN FREE SCAN",
        "",
        "Service: CHECK - FULL REPORT",
        "",
        "Choose similarity filtering."
      ].join("\n"),
      adminFreeScanFilterKeyboard(),
      true
    );
  }
);

bot.action(
  "ADMIN_FREE_SCAN_SIMILARITY",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    adminFreeScanSession = {
      type: "SIMILARITY",
      similarityFilter: null,
      stage: "WAIT_FILTER",
      startedAt: Date.now()
    };

    await ctx.answerCbQuery(
      "Similarity only selected"
    );

    await showAdminScreen(
      ctx,
      [
        "🧪 ADMIN FREE SCAN",
        "",
        "Service: SIMILARITY ONLY",
        "",
        "Choose similarity filtering."
      ].join("\n"),
      adminFreeScanFilterKeyboard(),
      true
    );
  }
);

bot.action("ADMIN_FREE_SCAN_AI_ONLY", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  adminFreeScanSession = {
    type: "CHECK",
    adminAiOnly: true,
    similarityFilter: FILTER_MODE_FILTERED,
    stage: "WAIT_DOCUMENT",
    startedAt: Date.now()
  };
  await ctx.answerCbQuery("AI report only selected");
  await showAdminScreen(ctx, [
    "🧪 ADMIN AI REPORT ONLY",
    "",
    "Service: AI ONLY (SAPLING)",
    "Similarity API: NOT REQUESTED",
    "References excluded from AI analysis.",
    "",
    "Send 1–10 PDF, DOCX, DOC or PPTX documents, then tap Review Batch.",
    "No bot payment will be requested."
  ].join("\n"), adminFreeScanWaitingKeyboard(), true);
});

bot.action(
  "ADMIN_FREE_SCAN_FILTERED",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    if (
      !adminFreeScanSession ||
      adminFreeScanSession.stage !==
        "WAIT_FILTER"
    ) {
      return ctx.answerCbQuery(
        "Start Admin Free Scan first.",
        {
          show_alert: true
        }
      );
    }

    adminFreeScanSession
      .similarityFilter =
      FILTER_MODE_FILTERED;

    adminFreeScanSession.stage =
      "WAIT_DOCUMENT";

    await ctx.answerCbQuery(
      "Filtered selected"
    );

    await showAdminScreen(
      ctx,
      [
        "🧪 ADMIN FREE SCAN READY",
        "",
        "Service: " +
          adminReportTypeLabel(
            adminFreeScanSession.type
          ),
        "Filter: Quotes + Bibliography",
        "",
        "Send 1–10 PDF, DOCX, DOC or PPTX documents, then tap Review Batch.",
        "",
        "No bot payment will be requested."
      ].join("\n"),
      adminFreeScanWaitingKeyboard(),
      true
    );
  }
);

bot.action(
  "ADMIN_FREE_SCAN_UNFILTERED",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    if (
      !adminFreeScanSession ||
      adminFreeScanSession.stage !==
        "WAIT_FILTER"
    ) {
      return ctx.answerCbQuery(
        "Start Admin Free Scan first.",
        {
          show_alert: true
        }
      );
    }

    adminFreeScanSession
      .similarityFilter =
      FILTER_MODE_UNFILTERED;

    adminFreeScanSession.stage =
      "WAIT_DOCUMENT";

    await ctx.answerCbQuery(
      "Unfiltered selected"
    );

    await showAdminScreen(
      ctx,
      [
        "🧪 ADMIN FREE SCAN READY",
        "",
        "Service: " +
          adminReportTypeLabel(
            adminFreeScanSession.type
          ),
        "Filter: Unfiltered",
        "",
        "Send 1–10 PDF or DOCX documents, then tap Review Batch.",
        "",
        "No bot payment will be requested."
      ].join("\n"),
      adminFreeScanWaitingKeyboard(),
      true
    );
  }
);

// JK_ADMIN_FREE_BATCH_REVIEW_V1
bot.action("ADMIN_FREE_SCAN_REVIEW", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  const session = adminFreeScanSession;
  if (!session || session.stage !== "WAIT_DOCUMENT" ||
      !Array.isArray(session.files) || session.files.length === 0) {
    return ctx.answerCbQuery("Upload at least one document first.", { show_alert: true });
  }
  // Lock the exact file list while the admin reviews it.
  session.stage = "WAIT_CONFIRM";
  await ctx.answerCbQuery("Review documents before scanning.");
  await showAdminScreen(ctx, [
    "🧪 ADMIN FREE BATCH - REVIEW",
    "Files: " + session.files.length + " / 10",
    "Service: " + (session.adminAiOnly ? "AI REPORT ONLY" : adminReportTypeLabel(session.type)),
    "Filter: " + (session.adminAiOnly ? "AI reference exclusion (no similarity request)" : similarityFilterLabel(session.similarityFilter)),
    "",
    ...session.files.map((file, index) =>
      (index + 1) + ". " + safeText(file.file_name || "Document")),
    "",
    "No customer payment. Each document consumes provider API credits.",
    "Confirm to scan all files, or add more documents."
  ].join("\n"), adminFreeScanReviewKeyboard(), true);
});

bot.action("ADMIN_FREE_SCAN_MORE", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  if (!adminFreeScanSession || adminFreeScanSession.stage !== "WAIT_CONFIRM")
    return ctx.answerCbQuery("Review the current batch first.", { show_alert: true });
  if ((adminFreeScanSession.files || []).length >= MAX_BATCH_FILES)
    return ctx.answerCbQuery("The batch already has 10 files.", { show_alert: true });
  adminFreeScanSession.stage = "WAIT_DOCUMENT";
  await ctx.answerCbQuery();
  await showAdminScreen(ctx,
    "🧪 ADMIN FREE SCAN\nSend more PDF or DOCX files, then tap Review Batch.",
    adminFreeScanWaitingKeyboard(), true);
});

// JK_ADMIN_FREE_BATCH_CONFIRM_V1
bot.action("ADMIN_FREE_SCAN_START", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  const session = adminFreeScanSession;
  if (!session || session.stage !== "WAIT_CONFIRM" || !Array.isArray(session.files) ||
      session.files.length === 0) {
    return ctx.answerCbQuery("Upload at least one document first.", { show_alert: true });
  }
  if (!require("./jk-admin-free-scan-control.cjs").enabled()) {
    adminFreeScanSession = null;
    return ctx.answerCbQuery("Admin Free Scan is disabled.");
  }

  // Clear synchronously before any await. Double taps cannot start two jobs.
  adminFreeScanSession = null;
  await ctx.answerCbQuery("Batch confirmed. Starting scans.");

  const now = Date.now();
  const batchId = "JK_ADMIN_FREE_" + ADMIN_ID + "_" + now;
  const job = createPaidJob({
    userId: ADMIN_ID,
    apiRef: "ADMINFREE_" + now,
    ref: {
      batchId,
      amount: 0,
      kind: "ADMIN_FREE_SCAN",
      summary: "Admin Free Scan",
      name: getUserFullName(ctx.from),
      username: safeText(ctx.from.username || "N/A"),
      phone: null,
      files: session.files
    },
    invoiceId: null,
    source: "admin-free-scan"
  });
  job.reportPipeline = PROVIDER_NEUTRAL_PIPELINE;
  job.adminFreeScan = true;
  job.amount = 0;
  job.reportModeSnapshot = REPORT_MODE_AUTO;
  job.route = "PENDING";
  job.status = "PROCESSING";
  savePaidJobs();

  await ctx.reply([
    "🧪 ADMIN FREE BATCH STARTED",
    "Files: " + session.files.length + " / 10",
    "Service: " + (session.adminAiOnly ? "AI REPORT ONLY" : adminReportTypeLabel(session.type)),
    "Filter: " + (session.adminAiOnly ? "AI reference exclusion (no similarity request)" : similarityFilterLabel(session.similarityFilter)),
    "Payment: BYPASSED (ADMIN)",
    "Provider API usage: LIVE",
    "Reports will be delivered to your admin account."
  ].join("\n"));
  // The established provider-neutral job runner already processes job.files
  // sequentially and persists each file's checkpoints and delivery state.
  setImmediate(async () => {
    try {
      await submitPaidJobToActiveProvider(job.jobId);
    } catch (err) {
      await sendAdminMessage("❌ ADMIN FREE BATCH FAILED\n" +
        "Batch: " + batchId + "\nError: " + safeText(err?.message || err));
    }
  });
});

bot.action(
  "ADMIN_FREE_SCAN_CANCEL",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    adminFreeScanSession = null;

    await ctx.answerCbQuery(
      "Admin free scan cancelled"
    );

    await showAdminDashboard(
      ctx,
      true
    );
  }
);

bot.action(
  "ADMIN_DASH_REPORTS",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    await ctx.answerCbQuery();

    await showAdminScreen(
      ctx,
      "⚙️ REPORT GENERATION\n\n" +
        "Current Mode: " +
        reportModeLabel(),
      reportModeKeyboard(),
      true
    );
  }
);

bot.action(
  "ADMIN_DASH_FILTERS",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    await ctx.answerCbQuery();

    await showAdminScreen(
      ctx,
      "🔎 SIMILARITY FILTERING\n\n" +
        "Current Mode: " +
        filterModeLabel(),
      similarityFilterModeKeyboard(),
      true
    );
  }
);

bot.action(
  "ADMIN_DASH_INSTITUTION",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    await ctx.answerCbQuery();

    await showAdminScreen(
      ctx,
      ["🎲 AUTOMATIC REPORT IDENTITY", "", "Names:", "• Author Author", "• User User", "", "Institutions:", "• Arsi University", "• University of Anbar", "• Oromia State University", "", "One random name + one random institution are assigned once per new document."].join("\n"),
      institutionKeyboard(),
      true
    );
  }
);

bot.action(
  "REPORT_MODE_MANUAL",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    reportSettings.reportMode =
      REPORT_MODE_MANUAL;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Manual Only enabled"
    );

    await showAdminScreen(
      ctx,
      "⚙️ REPORT GENERATION\n\n" +
        "Current Mode: " +
        reportModeLabel(),
      reportModeKeyboard(),
      true
    );
  }
);

bot.action(
  "REPORT_MODE_APPROVAL",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    if (
      !activeProviderReadyForReportMode()
    ) {
      return ctx.answerCbQuery(
        "Enable the active provider in live mode first.",
        {
          show_alert: true
        }
      );
    }

    reportSettings.reportMode =
      REPORT_MODE_APPROVAL;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Admin Approval enabled"
    );

    await showAdminScreen(
      ctx,
      "⚙️ REPORT GENERATION\n\n" +
        "Current Mode: " +
        reportModeLabel(),
      reportModeKeyboard(),
      true
    );
  }
);

bot.action(
  "REPORT_MODE_AUTO",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    if (
      !activeProviderReadyForReportMode()
    ) {
      return ctx.answerCbQuery(
        "Enable the active provider in live mode first.",
        {
          show_alert: true
        }
      );
    }

    await ctx.answerCbQuery();

    await showAdminScreen(
      ctx,
      "⚠️ ENABLE AUTOMATIC API?\n\n" +
      "Every newly paid eligible document will be submitted to the active provider automatically and may consume provider credits. Existing jobs are not changed.",
      reportModeAutoConfirmKeyboard(),
      true
    );
  }
);

bot.action(
  "REPORT_MODE_AUTO_CONFIRM",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    if (
      !activeProviderReadyForReportMode()
    ) {
      return ctx.answerCbQuery(
        "Enable the active provider in live mode first.",
        {
          show_alert: true
        }
      );
    }

    reportSettings.reportMode =
      REPORT_MODE_AUTO;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Automatic API enabled"
    );

    await showAdminScreen(
      ctx,
      "⚙️ REPORT GENERATION\n\n" +
        "Current Mode: " +
        reportModeLabel(),
      reportModeKeyboard(),
      true
    );
  }
);

bot.action(
  "REPORT_MODE_AUTO_CANCEL",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    await ctx.answerCbQuery(
      "No change"
    );

    await showAdminScreen(
      ctx,
      "⚙️ REPORT GENERATION\n\n" +
        "Current Mode: " +
        reportModeLabel(),
      reportModeKeyboard(),
      true
    );
  }
);

bot.action(
  "FILTER_MODE_CLIENT",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    reportSettings.filterMode =
      FILTER_MODE_CLIENT;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Client Choice enabled"
    );

    await showAdminScreen(
      ctx,
      "🔎 SIMILARITY FILTERING\n\n" +
        "Current Mode: " +
        filterModeLabel(),
      similarityFilterModeKeyboard(),
      true
    );
  }
);

bot.action(
  "FILTER_MODE_FILTERED",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    reportSettings.filterMode =
      FILTER_MODE_FILTERED;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Always Filtered enabled"
    );

    await showAdminScreen(
      ctx,
      "🔎 SIMILARITY FILTERING\n\n" +
        "Current Mode: " +
        filterModeLabel(),
      similarityFilterModeKeyboard(),
      true
    );
  }
);

bot.action(
  "FILTER_MODE_UNFILTERED",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    reportSettings.filterMode =
      FILTER_MODE_UNFILTERED;

    saveReportSettings();

    await ctx.answerCbQuery(
      "Always Unfiltered enabled"
    );

    await showAdminScreen(
      ctx,
      "🔎 SIMILARITY FILTERING\n\n" +
        "Current Mode: " +
        filterModeLabel(),
      similarityFilterModeKeyboard(),
      true
    );
  }
);

bot.action(
  "INSTITUTION_EMBU",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    // Legacy cached button.
    // Automatic identity mode remains active.

    await ctx.answerCbQuery(
      "Automatic identity mode is enabled"
    );

    await showAdminScreen(
      ctx,
      ["🎲 AUTOMATIC REPORT IDENTITY", "", "Names:", "• Author Author", "• User User", "", "Institutions:", "• Arsi University", "• University of Anbar", "• Oromia State University", "", "One random name + one random institution are assigned once per new document."].join("\n"),
      institutionKeyboard(),
      true
    );
  }
);

bot.action(
  "INSTITUTION_TUM",
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    // Legacy cached button.
    // Automatic identity mode remains active.

    await ctx.answerCbQuery(
      "Automatic identity mode is enabled"
    );

    await showAdminScreen(
      ctx,
      ["🎲 AUTOMATIC REPORT IDENTITY", "", "Names:", "• Author Author", "• User User", "", "Institutions:", "• Arsi University", "• University of Anbar", "• Oromia State University", "", "One random name + one random institution are assigned once per new document."].join("\n"),
      institutionKeyboard(),
      true
    );
  }
);

bot.action("ADMIN_DASH_COMMANDS", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  await ctx.answerCbQuery();
  await showAdminScreen(ctx, adminAllCommandsText(), adminBackKeyboard(), true);
});

bot.action(/^BROADCAST_CANCEL_([A-Za-z0-9]+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  cleanupPendingBroadcasts();
  const token = ctx.match[1];

  if (!pendingBroadcasts[token]) {
    await ctx.answerCbQuery("Broadcast preview expired");
    return ctx.reply("⚠️ Broadcast preview is no longer available.");
  }

  delete pendingBroadcasts[token];
  await ctx.answerCbQuery("Broadcast cancelled");

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {}

  await ctx.reply("✅ Broadcast cancelled. No messages were sent.");
});

bot.action(/^BROADCAST_SEND_([A-Za-z0-9]+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  cleanupPendingBroadcasts();
  const token = ctx.match[1];
  const pending = pendingBroadcasts[token];

  if (!pending) {
    await ctx.answerCbQuery("Broadcast preview expired");
    return ctx.reply("⚠️ Broadcast preview is no longer available.");
  }

  if (pending.kind === "discount") {
    const currentWindow = getActiveDiscountBroadcastWindow();

    if (!currentWindow || currentWindow.key !== pending.discountWindow?.key) {
      delete pendingBroadcasts[token];
      await ctx.answerCbQuery("Discount period closed", { show_alert: true });

      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch {}

      return ctx.reply("❌ Discount broadcast not sent because that discount period is no longer active.");
    }

    if (Number(currentWindow.price) !== Number(pending.discountWindow?.price)) {
      delete pendingBroadcasts[token];
      await ctx.answerCbQuery("Discount price changed", { show_alert: true });

      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch {}

      return ctx.reply("⚠️ Discount price changed. Use /discountbroadcast to create a fresh preview.");
    }
  }

  if (broadcastInProgress) {
    return ctx.answerCbQuery("A broadcast is already running.", { show_alert: true });
  }

  delete pendingBroadcasts[token];
  broadcastInProgress = true;

  await ctx.answerCbQuery("Broadcast started");

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {}

  await ctx.reply(`📢 Broadcast started for ${pending.recipientIds.length} active user(s).`);

  try {
    const result = await runBroadcast(pending.message, pending.recipientIds);
    const stats = getBotUserStats();

    await ctx.reply(
      "✅ BROADCAST COMPLETE\n\n" +
        `Recipients selected: ${result.recipients}\n` +
        `Attempted: ${result.attempted}\n` +
        `Delivered: ${result.delivered}\n` +
        `Failed: ${result.failed}\n` +
        `Skipped: ${result.skipped}\n` +
        `Newly inactive: ${result.newlyInactive}\n\n` +
        `Active users now: ${stats.active}\n` +
        `Inactive/blocked now: ${stats.inactive}`
    );
  } catch (err) {
    console.error("Broadcast failed:", err?.message || err);
    await ctx.reply("❌ Broadcast stopped unexpectedly: " + String(err?.message || err));
  } finally {
    broadcastInProgress = false;
  }
});

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

bot.action(
  /^ADMIN_MANUAL_(\d+)$/,
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    const userId = ctx.match[1];

    const job =
      getLatestActivePaidJob(
        userId
      );

    if (job) {
      job.route = "MANUAL";
      job.status = "PROCESSING";
      savePaidJobs();
    }

    pendingFileTargets[
      ADMIN_ID
    ] = {
      userId,
      caption: "",
      sentCount: 0,
      sentItemKeys: {},
      inProgressItemKeys: {}
    };

    await ctx.answerCbQuery(
      "Manual delivery opened"
    );

    await ctx.reply(
      batchOpenedMessage(userId)
    );
  }
);

bot.action(
  /^ADMIN_COPYLEAKS_(\d+)$/,
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    const userId =
      ctx.match[1];

    const job =
      getLatestActivePaidJob(
        userId
      );

    if (!job) {
      return ctx.answerCbQuery(
        "No active paid job.",
        {
          show_alert: true
        }
      );
    }

    await ctx.answerCbQuery(
      "Starting provider..."
    );

    try {
      await submitPaidJobToActiveProvider(
        job.jobId
      );

      await ctx.reply(
        "✅ Provider submission started for user " +
          userId +
          "."
      );
    } catch (err) {
      await ctx.reply(
        "❌ Provider submission failed: " +
          safeText(
            err?.message || err
          )
      );
    }
  }
);

bot.action(
  /^ADMIN_COPYLEAKS_STATUS_(\d+)$/,
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    const userId =
      ctx.match[1];

    const job =
      getLatestActivePaidJob(
        userId
      );

    await ctx.answerCbQuery();

    if (!job) {
      return ctx.reply(
        "No active paid job for " +
          userId +
          "."
      );
    }

    const rows =
      (job.files || []).map(
        (f, i) =>
          `File ${i + 1}: ${safeText(
            f.file_name || "N/A"
          )} — ${safeText(
            f.copyleaksStatus ||
              "NOT_SUBMITTED"
          )}`
      );

    await ctx.reply(
      "⚡ COPYLEAKS STATUS\n\n" +
        rows.join("\n")
    );
  }
);

bot.action(
  /^ADMIN_JOB_FILTERS_(\d+)$/,
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    const userId =
      ctx.match[1];

    const job =
      getLatestActivePaidJob(
        userId
      );

    if (!job) {
      return ctx.answerCbQuery(
        "No active paid job.",
        {
          show_alert: true
        }
      );
    }

    const rows = [];

    for (
      let i = 0;
      i <
      (job.files || []).length;
      i += 1
    ) {
      const file =
        job.files[i];

      const current =
        effectiveSimilarityFilter(
          file
        );

      rows.push([
        Markup.button.callback(
          (
            current ===
            FILTER_MODE_FILTERED
              ? "✅ "
              : ""
          ) +
            "F" +
            (i + 1) +
            " Filtered",
          `JOB_FILTER_F_${userId}_${i}`
        ),

        Markup.button.callback(
          (
            current ===
            FILTER_MODE_UNFILTERED
              ? "✅ "
              : ""
          ) +
            "F" +
            (i + 1) +
            " Unfiltered",
          `JOB_FILTER_U_${userId}_${i}`
        )
      ]);
    }

    rows.push([
      Markup.button.callback(
        "✖ Close",
        `ADMIN_COPYLEAKS_STATUS_${userId}`
      )
    ]);

    await ctx.answerCbQuery();

    await ctx.reply(
      "🔎 FILTER OVERRIDE\n\n" +
      "Changes are allowed only before the file is submitted to the active provider.",
      {
        reply_markup:
          Markup.inlineKeyboard(
            rows
          ).reply_markup
      }
    );
  }
);

bot.action(
  /^JOB_FILTER_([FU])_(\d+)_(\d+)$/,
  async (ctx) => {
    if (
      ctx.from.id !== ADMIN_ID
    ) {
      return ctx.answerCbQuery(
        "Admin only."
      );
    }

    const choice =
      ctx.match[1];

    const userId =
      ctx.match[2];

    const index =
      Number(ctx.match[3]);

    const job =
      getLatestActivePaidJob(
        userId
      );

    const file =
      job?.files?.[index];

    if (!job || !file) {
      return ctx.answerCbQuery(
        "Job/file not found.",
        {
          show_alert: true
        }
      );
    }

    if (file.copyleaksScanId) {
      return ctx.answerCbQuery(
        "Already submitted to Copyleaks.",
        {
          show_alert: true
        }
      );
    }

    file.similarityFilter =
      choice === "F"
        ? FILTER_MODE_FILTERED
        : FILTER_MODE_UNFILTERED;

    savePaidJobs();

    await ctx.answerCbQuery(
      "Filter updated"
    );

    await ctx.reply(
      "✅ File " +
        (index + 1) +
        " filter: " +
        similarityFilterLabel(
          file.similarityFilter
        )
    );
  }
);

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



bot.action(/^ADMIN_CLEAN_COPY_NOTE_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  const userId = ctx.match[1];

  try {
    await bot.telegram.sendMessage(
      userId,
      CLEAN_COPY_NEXT_SUBMISSION_NOTE,
      { parse_mode: "Markdown" }
    );

    await ctx.answerCbQuery("Clean-copy note sent");
    await ctx.reply("✅ Remove logo/name reminder sent to " + userId);
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


// JK_REFERENCE_BOUNDARY_ADMIN_REVIEW_V1
// Ambiguous reference boundaries pause this individual file before providers
// are called. Decisions are persistent and keyed to the exact canonical text.
function referenceBoundaryToken(job, file, review) {
  const index = (job.files || []).indexOf(file);
  return require("crypto").createHash("sha256")
    .update([
      String(job.jobId || ""),
      String(job.userId || ""),
      String(index),
      String(review?.sourceTextSha256 || ""),
      String(review?.start)
    ].join(":"))
    .digest("hex").slice(0, 20);
}

function findPendingReferenceBoundaryReview(token) {
  const matches = [];
  for (const job of Object.values(paidJobs)) {
    for (const file of job.files || []) {
      const review = file.referenceBoundaryReview;
      if (file.referenceBoundaryReviewStatus === "PENDING_ADMIN" &&
          review && referenceBoundaryToken(job, file, review) === token) {
        matches.push({job, file, review});
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

async function notifyReferenceBoundaryReview(job, file, review) {
  const now = Date.now();
  const previous = file.referenceBoundaryReview;
  const sameReview = previous &&
    previous.sourceTextSha256 === review.sourceTextSha256 &&
    Number(previous.start) === Number(review.start);

  // Persist one notification attempt and one ten-minute deadline. Re-entering
  // the provider loop must not reset the deadline or send duplicate messages.
  file.referenceBoundaryReview = sameReview
    ? {
        ...previous,
        ...review,
        requestedAt: previous.requestedAt || now,
        autoResolveAt: previous.autoResolveAt ||
          (now + require("./jk-reference-review-timeout.cjs").REFERENCE_BOUNDARY_AUTO_RESOLVE_MS)
      }
    : {
        ...review,
        requestedAt: now,
        autoResolveAt: now +
          require("./jk-reference-review-timeout.cjs").REFERENCE_BOUNDARY_AUTO_RESOLVE_MS
      };

  file.referenceBoundaryReviewStatus = "PENDING_ADMIN";
  file.providerStatus = "MANUAL_REQUIRED";
  file.manualReviewRequired = true;
  file.manualReviewReason = "Reference/bibliography boundary requires administrator review.";
  file.providerError = null;
  file.referenceReviewNoProviderRequests = true;
  const shouldNotify = !sameReview && !file.referenceBoundaryReview.notificationAttemptedAt;
  if (shouldNotify) file.referenceBoundaryReview.notificationAttemptedAt = now;
  savePaidJobs();

  if (sameReview || !shouldNotify) return;
  const token = referenceBoundaryToken(job, file, file.referenceBoundaryReview);
  const lines = [
    "REFERENCE / BIBLIOGRAPHY BOUNDARY REVIEW",
    "File: " + safeText(file.file_name || "N/A"),
    "Job: " + safeText(job.jobId || "N/A"),
    "User ID: " + String(job.userId || "N/A"),
    "Heading: " + safeText(review.heading || "References"),
    "Reason: " + safeText(review.reason || "Ending boundary is ambiguous."),
    "Reference entries detected: " + String(review.entriesFound || 0),
    "",
    "No Quetext or Sapling request was made for this file.",
    "Choose the first text that should be INCLUDED after the references.",
    "You have 10 minutes to select the correct inclusion point or cancel this file.",
    "Otherwise the remaining text will automatically be treated as references, and provider submission will resume."
  ];
  const keyboard = [];
  for (const candidate of (review.candidates || []).slice(0, 3)) {
    keyboard.push([{
      text: "Include from: " + safeText(candidate.preview || ("candidate " + candidate.id)).slice(0, 36),
      callback_data: "JK_REF_BOUNDARY_" + String(candidate.id) + "_" + token
    }]);
  }
  if (!review.hasFollowingReferenceSection && !review.hasFollowingSubstantiveSection) {
    keyboard.push([{
      text: "Treat remainder as references (exclude to end)",
      callback_data: "JK_REF_BOUNDARY_END_" + token
    }]);
  }
  keyboard.push([{
    text: "Cancel this file (no provider submission)",
    callback_data: "JK_REF_BOUNDARY_CANCEL_" + token
  }]);
  await bot.telegram.sendMessage(ADMIN_ID, lines.join("\n"), {
    reply_markup: {inline_keyboard: keyboard}
  });
}

bot.command("cancelref", async ctx => {
  if (Number(ctx.from?.id) !== ADMIN_ID) return;
  const jobId = String(ctx.message?.text || "").trim().split(/\s+/u)[1];
  const job = paidJobs[jobId];
  if (!job) return ctx.reply("Usage: /cancelref JOB_ID");
  const pending = (job.files || []).filter(file =>
    file.referenceBoundaryReviewStatus === "PENDING_ADMIN");
  if (pending.length !== 1)
    return ctx.reply("Job must have exactly one pending reference review.");
  const file = pending[0];
  if (Date.now() >= Number(file.referenceBoundaryReview?.autoResolveAt || 0))
    return ctx.reply("Ten-minute review window elapsed. Automatic submission is pending.");
  const resultPath = file.providerBundleFile
    ? file.providerBundleFile + ".provider-results.json" : null;
  if (!file.referenceReviewNoProviderRequests || file.providerSubmittedAt ||
      file.providerQuetextReportId || file.providerResultsFile ||
      (resultPath && fs.existsSync(resultPath)))
    return ctx.reply("Provider work already started or review is unavailable.");
  file.referenceBoundaryReviewStatus = "CANCELLED";
  file.providerStatus = "CANCELLED";
  file.referenceReviewNoProviderRequests = false;
  file.providerAutoResubmitBlocked = true;
  file.referenceBoundaryAutoResolveCancelledAt = Date.now();
  file.referenceBoundaryReview.cancelledAt = Date.now();
  file.manualReviewRequired = false;
  file.manualReviewReason = null;
  savePaidJobs();
  return ctx.reply("Reference review cancelled for " +
    safeText(file.file_name || "file") + ". No API calls were made.");
});

// Administrator may stop an individual pending file before any paid API call.
bot.action(/^JK_REF_BOUNDARY_CANCEL_([a-f0-9]{20})$/, async ctx => {
  if (Number(ctx.from?.id) !== ADMIN_ID)
    return ctx.answerCbQuery("Admin only.", {show_alert: true});
  const found = findPendingReferenceBoundaryReview(ctx.match[1]);
  if (!found) return ctx.answerCbQuery("Review already handled or expired.", {show_alert: true});
  const {job, file, review} = found;
  if (Date.now() >= Number(review.autoResolveAt || 0))
    return ctx.answerCbQuery("Ten-minute review window elapsed.", {show_alert: true});
  const resultPath = file.providerBundleFile
    ? file.providerBundleFile + ".provider-results.json" : null;
  if (!file.referenceReviewNoProviderRequests ||
      file.providerSubmittedAt || file.providerQuetextReportId ||
      file.providerResultsFile || (resultPath && fs.existsSync(resultPath))) {
    return ctx.answerCbQuery("Provider activity detected. Cannot cancel safely.", {show_alert: true});
  }
  file.referenceBoundaryReviewStatus = "CANCELLED";
  file.referenceReviewNoProviderRequests = false;
  file.referenceBoundaryAutoResolveCancelledAt = Date.now();
  review.cancelledAt = Date.now();
  review.cancelledBy = String(ctx.from.id);
  file.providerStatus = "CANCELLED";
  file.providerAutoResubmitBlocked = true;
  file.manualReviewRequired = false;
  file.manualReviewReason = null;
  file.providerError = null;
  savePaidJobs();
  await ctx.answerCbQuery("File cancelled. No provider request made.");
  await bot.telegram.sendMessage(ADMIN_ID,
    "REFERENCE REVIEW CANCELLED\nFile: " + safeText(file.file_name || "N/A") +
    "\nJob: " + safeText(job.jobId || "N/A") +
    "\nNo provider request was made. The original file and job record remain stored.");
});

bot.action(/^JK_REF_BOUNDARY_(END|\d{1,2})_([a-f0-9]{20})$/, async ctx => {
  if (Number(ctx.from?.id) !== ADMIN_ID) {
    return ctx.answerCbQuery("Admin only.", {show_alert: true});
  }
  const [, choice, token] = ctx.match;
  const found = findPendingReferenceBoundaryReview(token);
  if (!found) {
    return ctx.answerCbQuery("Review is stale or already handled.", {show_alert: true});
  }
  const {job, file, review} = found;

  // The detector raises this review before any paid provider request. Refuse
  // to resume if another route has already submitted or saved provider data.
  const resultsPath = file.providerBundleFile
    ? file.providerBundleFile + ".provider-results.json"
    : null;
  if (!file.referenceReviewNoProviderRequests ||
      file.providerAutoResubmitBlocked ||
      file.providerQuetextReportId ||
      file.providerSubmittedAt ||
      file.providerResultsFile ||
      (resultsPath && fs.existsSync(resultsPath))) {
    return ctx.answerCbQuery("Cannot resume safely; check saved results first.", {show_alert: true});
  }

  let end;
  if (choice === "END") {
    if (review.hasFollowingReferenceSection || review.hasFollowingSubstantiveSection)
      return ctx.answerCbQuery("Later assignment content must be preserved.", {show_alert: true});
    end = Number(review.sourceLength);
  } else {
    const candidate = (review.candidates || []).find(c => String(c.id) === choice);
    if (!candidate) return ctx.answerCbQuery("That boundary option is no longer available.", {show_alert: true});
    end = Number(candidate.offset);
  }

  const chosenCandidate = choice === "END"
    ? null
    : (review.candidates || []).find(c => String(c.id) === choice);
  const validEndChoice = choice === "END"
    ? end === Number(review.sourceLength)
    : Boolean(chosenCandidate && Number(chosenCandidate.offset) === end);
  if (!Number.isInteger(end) || end <= Number(review.start) ||
      end > Number(review.sourceLength) || !validEndChoice) {
    return ctx.answerCbQuery("Invalid boundary; review remains pending.", {show_alert: true});
  }

  const overrides = Array.isArray(file.referenceBoundaryOverrides)
    ? file.referenceBoundaryOverrides.filter(x => x.start !== review.start)
    : [];
  overrides.push({
    start: Number(review.start),
    end,
    sourceTextSha256: String(review.sourceTextSha256),
    approvedBy: String(ctx.from.id),
    approvedAt: Date.now()
  });
  file.referenceBoundaryOverrides = overrides;
  file.referenceBoundaryReviewStatus = "APPROVED";
  file.referenceBoundaryAutoResolveCancelledAt = Date.now();
  file.referenceBoundaryReview.autoResolveCancelledAt = Date.now();
  file.referenceBoundaryReviewedAt = Date.now();
  file.referenceBoundaryReviewedBy = String(ctx.from.id);
  file.referenceReviewNoProviderRequests = false;
  file.manualReviewRequired = false;
  file.manualReviewReason = null;
  file.providerError = null;
  file.providerStatus = "QUEUED";
  savePaidJobs();

  await ctx.answerCbQuery("Boundary saved. Resuming provider preparation.");
  await bot.telegram.sendMessage(ADMIN_ID,
    "REFERENCE BOUNDARY APPROVED\nFile: " + safeText(file.file_name || "N/A") +
    "\nChosen end offset: " + end +
    "\nThe saved boundary will be applied to both AI and filtered Similarity inputs. Processing is resuming.");

  setImmediate(() => submitPaidJobToActiveProvider(job.jobId).catch(error => {
    sendAdminMessage("Reference-review resume failed for " +
      safeText(file.file_name || "N/A") + ": " + safeText(error.message));
  }));
});

// JK_REFERENCE_BOUNDARY_AUTO_RESOLVE_V1
// One initial admin notification. After ten minutes, silently take the already
// offered "Treat remainder as references" action, then resume the same job.
// A persisted deadline plus a serial sweep makes this restart-safe/idempotent.
let referenceBoundaryAutoResolveSweepRunning = false;

async function autoResolveReferenceBoundaryReview(job, file, now = Date.now()) {
  const timeout = require("./jk-reference-review-timeout.cjs");
  if (!timeout.isAutoResolveDue(file, now)) return false;

  const review = file.referenceBoundaryReview;
  const resultPath = file.providerBundleFile
    ? file.providerBundleFile + ".provider-results.json"
    : null;

  // Only resume a file with a genuinely unanswered review and no provider
  // submission or saved results. A cancelled file is never eligible.
  if (file.referenceBoundaryReviewStatus !== "PENDING_ADMIN" ||
      file.referenceReviewNoProviderRequests !== true ||
      file.providerAutoResubmitBlocked ||
      file.providerQuetextReportId ||
      file.providerSubmittedAt ||
      file.providerResultsFile ||
      (resultPath && fs.existsSync(resultPath))) {
    review.autoResolveBlockedAt = review.autoResolveBlockedAt || now;
    review.autoResolveBlockedReason = "Existing provider activity or cancelled file prevents automatic submission.";
    file.providerStatus = "MANUAL_REQUIRED";
    file.manualReviewRequired = true;
    file.manualReviewReason = review.autoResolveBlockedReason;
    savePaidJobs();
    return false;
  }

  const overrides = Array.isArray(file.referenceBoundaryOverrides)
    ? file.referenceBoundaryOverrides.filter(item => Number(item.start) !== Number(review.start))
    : [];
  overrides.push(timeout.makeTreatRemainderAsReferencesOverride(review, now));

  // Persist the decision and clear the pending status BEFORE scheduling any
  // provider work. This prevents timer ticks or restarts submitting twice.
  file.referenceBoundaryOverrides = overrides;
  review.automaticDecision = "TREAT_REMAINDER_AS_REFERENCES";
  review.autoResolvedAt = now;
  file.referenceBoundaryReviewStatus = "AUTO_RESOLVED";
  file.referenceBoundaryReviewedAt = now;
  file.referenceBoundaryReviewedBy = "AUTO_TIMEOUT_TREAT_REMAINDER_AS_REFERENCES";
  file.referenceReviewNoProviderRequests = false;
  file.manualReviewRequired = false;
  file.manualReviewReason = null;
  file.providerError = null;
  file.providerStatus = "QUEUED";
  file.referenceBoundaryAutoResolveCancelledAt = null;
  savePaidJobs();

  setImmediate(() => submitPaidJobToActiveProvider(job.jobId).catch(error => {
    sendAdminMessage("Automatic reference-review resume failed for " +
      safeText(file.file_name || "N/A") + ": " + safeText(error.message));
  }));
  return true;
}

async function sweepTimedReferenceBoundaryReviews(now = Date.now()) {
  if (referenceBoundaryAutoResolveSweepRunning) return;
  referenceBoundaryAutoResolveSweepRunning = true;
  try {
    for (const [jobKey, job] of Object.entries(paidJobs)) {
      if (!Array.isArray(job?.files)) continue;
      for (const file of job.files) {
        if (file?.referenceBoundaryReviewStatus !== "PENDING_ADMIN" ||
            !file.referenceBoundaryReview ||
            file.referenceReviewNoProviderRequests !== true) continue;

        const timeout = require("./jk-reference-review-timeout.cjs");
        if (!Number.isSafeInteger(Number(file.referenceBoundaryReview.autoResolveAt)) ||
            Number(file.referenceBoundaryReview.autoResolveAt) <= 0) {
          // Legacy pending reviews get a full ten-minute grace period from
          // this deployment's first sweep, without a second notification.
          file.referenceBoundaryReview.autoResolveAt =
            timeout.getAutoResolveAt(null, now);
          file.referenceBoundaryReview.timeoutInitializedAt = now;
          savePaidJobs();
          continue;
        }
        await autoResolveReferenceBoundaryReview(job, file, now);
      }
    }
  } catch (error) {
    console.error("Reference-boundary timeout sweep failed:", error?.message || error);
  } finally {
    referenceBoundaryAutoResolveSweepRunning = false;
  }
}

setInterval(() => {
  sweepTimedReferenceBoundaryReviews().catch(error =>
    console.error("Reference-boundary timeout scheduler failed:", error?.message || error));
}, 30 * 1000);
setTimeout(() => {
  sweepTimedReferenceBoundaryReviews().catch(error =>
    console.error("Reference-boundary startup recovery failed:", error?.message || error));
}, 5 * 1000);

// JK_SIMILARITY_API_APPROVAL_V1
// Approval is per paid file, persistent, and never triggers a new provider
// request unless the approved file has a saved paid job and correct identity.
function needsSimilarityApiApproval(job, file) {
  return !job?.adminFreeScan &&
    !["CLOSED","DELIVERED","CANCELLED","CANCELLATION_REQUESTED"].includes(String(job?.status || "").toUpperCase()) &&
    String(job?.reportModeSnapshot || "").toUpperCase() === REPORT_MODE_AUTO &&
    String(file?.type || "").toUpperCase() === "SIMILARITY" &&
    !["MANUAL","DECLINED"].includes(String(file?.similarityApprovalStatus || "").toUpperCase()) &&
    !file?.similarityApiApprovedAt;
}
function similarityApprovalToken(job, file) {
  return require("crypto").createHash("sha256")
    .update(String(job.jobId) + ":" + String(file.fileIndex) + ":" + String(job.userId))
    .digest("hex").slice(0, 24);
}
function findSimilarityApproval(token) {
  const matches = [];
  for (const job of Object.values(paidJobs)) {
    for (const file of job.files || []) {
      if (needsSimilarityApiApproval(job, file) &&
          similarityApprovalToken(job,file) === token) matches.push({job,file});
    }
  }
  return matches.length === 1 ? matches[0] : null;
}
async function requestSimilarityApproval(job, file) {
  if (!needsSimilarityApiApproval(job,file)) return false;
  if (!file.similarityApprovalNotifiedAt) {
    file.similarityApprovalNotifiedAt = Date.now();
    file.similarityApprovalStatus = "PENDING_ADMIN";
    savePaidJobs();
    const token = similarityApprovalToken(job,file);
    try {
    await bot.telegram.sendMessage(ADMIN_ID,
      "🔒 SIMILARITY-ONLY API APPROVAL REQUIRED\n" +
      "Customer: " + job.userId + "\n" +
      "File: " + safeText(file.file_name || "") + "\n" +
      "Paid job: " + safeText(job.jobId || "") + "\n" +
      "No API has been called for this file.",
      { reply_markup: { inline_keyboard: [[
        {text:"✅ Approve Quetext Only",callback_data:"JK_SIM_APPROVE_" + token},
        {text:"🧑‍💻 Manual",callback_data:"JK_SIM_MANUAL_" + token}
      ]] } });
    } catch (error) {
      delete file.similarityApprovalNotifiedAt;
      savePaidJobs();
      throw error;
    }
  }
  return true;
}
bot.action(/^JK_SIM_(APPROVE|MANUAL)_([a-f0-9]{24})$/, async ctx => {
  if (Number(ctx.from?.id) !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");
  const [,decision,token] = ctx.match;
  const found = findSimilarityApproval(token);
  if (!found) return ctx.answerCbQuery("Not pending, already handled, or expired.",{show_alert:true});
  const {job,file} = found;
  if (decision === "MANUAL") {
    file.similarityApprovalStatus = "MANUAL";
    file.providerStatus = "MANUAL_REQUIRED";
    file.manualReviewRequired = true;
    file.manualReviewReason = "Similarity-only: admin manual handling requested";
    savePaidJobs();
    await ctx.answerCbQuery("Manual handling selected.");
    return;
  }
  if (file.providerAutoResubmitBlocked ||
      file.providerResultsFile ||
      (file.providerBundleFile &&
       fs.existsSync(file.providerBundleFile + ".provider-results.json"))) {
    return ctx.answerCbQuery("Saved results exist. Review; do not rescan.",{show_alert:true});
  }
  file.similarityApiApprovedAt = Date.now();
  file.similarityApprovalStatus = "APPROVED";
  savePaidJobs();
  await ctx.answerCbQuery("Approved once. Submitting Quetext only.");
  setImmediate(() => submitPaidJobToActiveProvider(job.jobId).catch(err =>
    sendAdminMessage("Approved similarity API failed: " + safeText(err.message))));
});

// =====================
// DOCUMENT HANDLER
// =====================
bot.on("document", async (ctx) => {
  const user = ctx.from;

  // JK_ADMIN_FREE_SCAN_DOCUMENT_V1
  if (user.id === ADMIN_ID && adminFreeScanSession && !require("./jk-admin-free-scan-control.cjs").enabled()) {
    adminFreeScanSession = null;
    await ctx.reply("Admin Free Scan is disabled.");
    return;
  }
  // Prevent uploads after review until Add More Files is selected.
  if (user.id === ADMIN_ID && adminFreeScanSession?.stage === "WAIT_CONFIRM") {
    await ctx.reply("This batch is awaiting confirmation. Tap Add More Files before uploading another document.");
    return;
  }
  // JK_ADMIN_FREE_BATCH_UPLOAD_V1
  if (user.id === ADMIN_ID && adminFreeScanSession?.stage === "WAIT_DOCUMENT") {
    const session = adminFreeScanSession;
    const doc = ctx.message.document;
    const name = String(doc.file_name || "");
    if (!/\.(pdf|docx|doc|pptx)$/iu.test(name)) {
      await ctx.reply("Only PDF, DOCX, DOC and PPTX documents are supported. Nothing was queued.");
      return;
    }
    if (!Array.isArray(session.files)) session.files = [];
    if (session.files.length >= MAX_BATCH_FILES) {
      await ctx.reply("Batch already contains 10 files. Tap Review Batch or Cancel.");
      return;
    }
    const duplicate = session.files.some(file =>
      (doc.file_unique_id && file.file_unique_id === doc.file_unique_id) ||
      file.file_id === doc.file_id);
    if (duplicate) {
      await ctx.reply("Duplicate document ignored. Send another file or tap Review Batch.");
      return;
    }

    const storedFile = createStoredFileFromDocument(ADMIN_ID, doc);
    storedFile.type = session.type;
    storedFile.price = 0;
    storedFile.similarityFilter = session.similarityFilter;
    storedFile.pendingType = null;
    storedFile.adminFreeScan = true;
    storedFile.adminAiOnly = session.adminAiOnly === true;
    storedFile.sourceChatId = ctx.chat.id;
    storedFile.sourceMessageId = ctx.message.message_id;
    storedFile.sourceUsername = user.username || "N/A";
    storedFile.sourceFirstName = user.first_name || "";
    storedFile.sourceLastName = user.last_name || "";
    storedFile.file_unique_id = doc.file_unique_id || null;
    requireFileReportIdentity(storedFile);
    session.files.push(storedFile);

    await ctx.reply([
      "✅ Added file " + session.files.length + " / 10",
      "File: " + safeText(storedFile.file_name),
      "Upload another PDF/DOCX/DOC/PPTX or tap Review Batch.",
      "No provider request has been made yet."
    ].join("\n"), { reply_markup: adminFreeScanWaitingKeyboard().reply_markup });
    return;
  }

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
    if (!supportedScanUpload(doc.file_name)) return ctx.reply("Only PDF, DOCX, DOC and PPTX are supported for scanning.");

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
    if (!supportedScanUpload(doc.file_name)) return ctx.reply("Only PDF, DOCX, DOC and PPTX are supported for scanning.");

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

  if (
    sub.stage ===
    STAGE_WAIT_SIM_FILTER
  ) {
    return ctx.reply(
      "⚠️ Choose similarity filtering for the previous file first.",
      {
        parse_mode: "Markdown",
        reply_markup:
          clientSimilarityFilterKeyboard()
            .reply_markup
      }
    );
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
  if (!supportedScanUpload(doc.file_name)) return ctx.reply("Only PDF, DOCX, DOC and PPTX are supported for scanning.");
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
    if (worldwidePay.isWorldwideManualMethod(sub.paymentMethod)) {
      await handleWorldwideManualProof(ctx, sub, "", true);
    } else if (sub.paymentMethod === "INTERNATIONAL" || sub.paymentMethod === "KENYAN_BANK") {
      await handleInternationalPaymentScreenshotProof(ctx, sub);
    } else if (sub.paymentMethod === "TZ_OTHER") {
      await handleTzOtherPaymentScreenshotProof(ctx, sub);
    } else {
      await handlePaymentScreenshotProof(ctx, sub);
    }
    return;
  }

  if (sub && [STAGE_WAIT_BATCH_SIZE, STAGE_WAIT_UPLOADS, STAGE_WAIT_FILE_TYPE, STAGE_WAIT_SIM_FILTER, STAGE_WAIT_RESELLER_CODE].includes(sub.stage)) {
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
  if (isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  await handleFileTypeSelected(
    ctx,
    "RESALE"
  );
});

bot.action(
  "SIM_FILTER_FILTERED",
  async (ctx) => {
    if (isBotInactivePeriod()) {
      return notifyInactivePeriod(ctx);
    }

    const sub =
      submissions[ctx.from.id];

    if (
      !sub ||
      sub.stage !== STAGE_WAIT_SIM_FILTER
    ) {
      return ctx.answerCbQuery(
        "No filter selection pending."
      );
    }

    const file =
      getCurrentPendingFile(sub);

    if (
      !file ||
      !file.pendingType
    ) {
      return ctx.answerCbQuery(
        "No pending file."
      );
    }

    file.similarityFilter =
      FILTER_MODE_FILTERED;

    const kind =
      file.pendingType;

    await ctx.answerCbQuery(
      "Quotes + bibliography will be filtered"
    );

    await finalizeFileTypeSelection(
      ctx,
      sub,
      kind
    );
  }
);

bot.action(
  "SIM_FILTER_UNFILTERED",
  async (ctx) => {
    if (isBotInactivePeriod()) {
      return notifyInactivePeriod(ctx);
    }

    const sub =
      submissions[ctx.from.id];

    if (
      !sub ||
      sub.stage !== STAGE_WAIT_SIM_FILTER
    ) {
      return ctx.answerCbQuery(
        "No filter selection pending."
      );
    }

    const file =
      getCurrentPendingFile(sub);

    if (
      !file ||
      !file.pendingType
    ) {
      return ctx.answerCbQuery(
        "No pending file."
      );
    }

    file.similarityFilter =
      FILTER_MODE_UNFILTERED;

    const kind =
      file.pendingType;

    await ctx.answerCbQuery(
      "Unfiltered similarity selected"
    );

    await finalizeFileTypeSelection(
      ctx,
      sub,
      kind
    );
  }
);

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

  await ctx.answerCbQuery("Choose new international method");
  await ctx.reply("🌍 International payment is now M-Pesa or Binance Pay USDT. Choose your method:", {
    reply_markup: worldwidePaymentKeyboard().reply_markup
  });
});


bot.action("PAYMENT_METHOD_WORLDWIDE", async ctx => {
  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  const sub = submissions[ctx.from.id];
  if (!sub || sub.stage !== STAGE_WAIT_PAYMENT_METHOD || !INTERNATIONAL_PAYMENT_ENABLED)
    return ctx.answerCbQuery("International payment not available for this order.");
  await ctx.answerCbQuery("Choose international method");
  return ctx.reply("🌍 *International payment*\nChoose M-Pesa or Binance Pay (USDT).", {
    parse_mode: "Markdown", reply_markup: worldwidePaymentKeyboard().reply_markup
  });
});

async function startWorldwideManualPayment(ctx, method) {
  const sub = submissions[ctx.from.id];
  if (!INTERNATIONAL_PAYMENT_ENABLED || !sub || sub.stage !== STAGE_WAIT_PAYMENT_METHOD)
    return ctx.answerCbQuery("Payment selection expired.");
  // The legacy resale/discount KES pricing is not USD-equivalent; do not assume a USDT exchange rate.
  if (method === worldwidePay.METHOD_BINANCE && !isInternationalCheckOnly(sub)) {
    await ctx.answerCbQuery("Not available for this pricing", { show_alert: true });
    return ctx.reply("Binance USDT is available for CHECK, RECHECK, and Similarity Only. Choose Kenya M-Pesa STK for local discounts or contact support.");
  }
  const kesAmount = calculateSubmissionAmount(sub);
  const usdtAmount = worldwidePay.kesToUsdt(kesAmount, WORLDWIDE_KES_PER_USDT);
  const quote = worldwidePay.quoteForMethod(method, kesAmount, usdtAmount);
  const userId = ctx.from.id;
  const apiRef = makePaymentAttemptRef(userId);
  const summary = formatBatchSummary(sub);
  putPaymentRef(apiRef, {
    userId, batchId: sub.batchId, kind: getBatchKindLabel(sub),
    amount: quote.amount, currency: quote.currency,
    createdAt: Date.now(), updatedAt: Date.now(), summary,
    phone: null, name: getUserFullName(ctx.from), username: ctx.from.username || "N/A",
    invoiceId: null, status: "PENDING", lastState: "PENDING",
    mode: "MANUAL", paymentMethod: method, pendingProof: null,
    files: (sub.files || []).map(file => ({
      file_id: file.file_id || null, file_unique_id: file.file_unique_id || null,
      file_name: file.file_name || null,
      file_size: Number(file.file_size || file.fileSize || 0) || null,
      type: file.type || null, price: file.price || null,
      recheckEligible: Boolean(file.recheckEligible),
      similarityFilter: effectiveSimilarityFilter(file),
      jkSubmissionId: file.jkSubmissionId || null,
      reportName: file.reportName || null,
      reportInstitution: file.reportInstitution || null
    }))
  });
  sub.api_ref = apiRef; sub.invoiceId = null;
  sub.stage = STAGE_WAIT_PAYMENT; sub.paymentMethod = method;
  sub.amount = quote.amount; sub.currency = quote.currency;
  sub.paymentAttempts.push(apiRef);
  const paymentNoteRef = worldwidePay.noteReference(apiRef);
  const text = worldwidePay.paymentInstructions({
    method, amount: quote.amount, currency: quote.currency, reference: apiRef, paymentNoteRef,
    mpesaNumber: WORLDWIDE_MPESA_NUMBER,
    binanceId: WORLDWIDE_BINANCE_ID, binanceName: WORLDWIDE_BINANCE_NAME
  });
  await ctx.answerCbQuery("Manual international payment created");
  await ctx.reply(text, {
    parse_mode: "Markdown", reply_markup: internationalCopyKeyboard(method === worldwidePay.METHOD_BINANCE ? WORLDWIDE_BINANCE_ID : WORLDWIDE_MPESA_NUMBER, paymentNoteRef, method).reply_markup
  });
  await sendAdminMessage(
    "🌍 New international manual payment\nUser ID: " + userId +
    "\nMethod: " + method + "\nExpected amount: " +
    formatPaymentMoney(quote.amount, quote.currency) + "\nOrder reference: " + apiRef + "\nCustomer payment note: " + paymentNoteRef +
    "\nSTATUS: PENDING; verify received funds before confirming.",
    { adminButtons: "replyOnly" }
  );
  scheduleManualProofReminder(userId, apiRef, method,
    method === worldwidePay.METHOD_BINANCE
      ? "After paying, send only the Binance Order ID from Payment Details. Admin verifies received funds before processing."
      : "If you have paid, send the M-Pesa transfer reference. Admin verifies received funds before processing.");
}

bot.action("WORLDWIDE_MPESA", async ctx => {
  await startWorldwideManualPayment(ctx, worldwidePay.METHOD_MPESA);
});
bot.action("WORLDWIDE_BINANCE", async ctx => {
  await startWorldwideManualPayment(ctx, worldwidePay.METHOD_BINANCE);
});

async function handleWorldwideManualProof(ctx, sub, text, screenshot) {
  const method = sub.paymentMethod;
  const apiRef = sub.api_ref;
  const priorCode = apiRef ? String(getPaymentRef(apiRef)?.pendingProof?.code || "") : "";
  // Receipt images cannot establish a new payment transaction ID. Preserve the
  // already supplied ID when a customer sends supporting screenshots afterwards.
  const code = (screenshot ? "" : worldwidePay.extractTransactionId(text)) || priorCode;
  if (apiRef) updatePaymentRef(apiRef, {
    pendingProof: { type: screenshot ? "worldwide-screenshot" : "worldwide-text",
      code: code || null, receivedAt: Date.now() }
  });
  await sendAdminMessage("🌍 International payment proof received\nUser ID: " +
    ctx.from.id + "\nMethod: " + method +
    "\nExpected amount: " + formatPaymentMoney(sub.amount, sub.currency) +
    "\nOrder reference: " + apiRef +
    (method === worldwidePay.METHOD_BINANCE ? "\nBinance Order ID: " : "\nTransfer reference: ") +
    (code || (method === worldwidePay.METHOD_BINANCE ? "MISSING - request Binance Order ID" : "MISSING - request transfer reference")) +
    "\nVerify actual received amount and beneficiary in M-Pesa/Binance account; NEVER approve based on screenshot alone." +
    (screenshot ? "" : "\nCustomer message: " + safeText(text)),
    { adminButtons: "paymentProof" });
  if (screenshot) {
    try { await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id); }
    catch {}
  }
  await ctx.reply(method === worldwidePay.METHOD_BINANCE
    ? (code ? "✅ Binance Order ID received. Payment is pending until admin verifies the funds." : "✅ Screenshot received. Please send the Binance Order ID from Payment Details as text. Payment remains pending until admin verifies funds.")
    : (code ? "✅ Transfer reference received. Payment is pending until admin verifies the funds." : "✅ Screenshot received. Please send the M-Pesa transfer reference as text. Admin verification is still required."), {
    reply_markup: manualPaymentWaitKeyboard().reply_markup
  });
}

bot.action("PAYMENT_METHOD_TZ_OTHER", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  if (!sub || sub.stage !== STAGE_WAIT_PAYMENT_METHOD) return ctx.answerCbQuery("No payment method needed.");

  await ctx.answerCbQuery("Choose international method");
  await ctx.reply("🌍 International payment is now M-Pesa or Binance Pay USDT. Choose your method:", {
    reply_markup: worldwidePaymentKeyboard().reply_markup
  });
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
// JK_ADMIN_AI_HIGHLIGHTS_BUTTON_V1
require("./jk-ai-highlights-button.cjs").register(bot, {
  adminId: ADMIN_ID,
  getJobs: () => paidJobs
});

// JK_ADMIN_RECOVERY_BUTTON_V1
require("./jk-provider-recovery-button.cjs").register(bot, {
  adminId: ADMIN_ID,
  getJobs: () => paidJobs
});

// JK_PAID_AI_HIGHLIGHTS_V1
paidAiHighlights = require("./jk-client-ai-highlights.cjs").createService({
  dataDir: DATA_DIR,
  adminId: ADMIN_ID,
  telegram: bot.telegram,
  getJobs: () => paidJobs,
  configured: () => Boolean(INTASEND_SECRET_KEY),
  userBusy: userId => Boolean(submissions[userId] && submissions[userId].stage !== STAGE_PAID),
  sendStk: intasendSendStkPush,
  checkPayment: invoiceId => intasendCheckPaymentStatus({ invoice_id: invoiceId }),
  listInvoices: intasendListInvoicesByApiRef
});
paidAiHighlights.register(bot);

// JK_ADMIN_REPORT_TEMPLATE_CONTROL_V1
require("./jk-report-template-profiles.cjs").register(bot, { dataDir: DATA_DIR, adminId: ADMIN_ID });

bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = (ctx.message.text || "").trim();

  if (text.startsWith("/")) return;
  if (paidAiHighlights && await paidAiHighlights.handleText(ctx, text)) return;

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
    await finalizeTypeWithFilterSelection(ctx, sub, "RESALE");
    return;
  }

  if (
    sub &&
    sub.stage ===
      STAGE_WAIT_SIM_FILTER
  ) {
    return ctx.reply(
      "⚠️ Choose similarity filtering first.",
      {
        reply_markup:
          clientSimilarityFilterKeyboard()
            .reply_markup
      }
    );
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
    if (worldwidePay.isWorldwideManualMethod(sub.paymentMethod)) {
      await handleWorldwideManualProof(ctx, sub, text, false);
    } else if (sub.paymentMethod === "INTERNATIONAL" || sub.paymentMethod === "KENYAN_BANK") {
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
// COPYLEAKS API
// =====================

let copyleaksTokenCache = {
  token: null,
  expiresAt: 0
};

function assertCopyleaksConfigured() {
  if (!COPYLEAKS_ENABLED) {
    throw new Error(
      "COPYLEAKS_ENABLED is false."
    );
  }

  if (
    !COPYLEAKS_EMAIL ||
    !COPYLEAKS_API_KEY
  ) {
    throw new Error(
      "COPYLEAKS_EMAIL or COPYLEAKS_API_KEY is missing."
    );
  }

  if (
    !COPYLEAKS_WEBHOOK_SECRET
  ) {
    throw new Error(
      "COPYLEAKS_WEBHOOK_SECRET is missing."
    );
  }
}

// JK_COPYLEAKS_HTTP_ERROR_PATCH_V1
async function copyleaksJson(
  url,
  options = {}
) {
  const res =
    await fetch(
      url,
      options
    );

  const text =
    await res.text();

  let body = null;

  try {
    body =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    body = {
      raw: text
    };
  }

  if (!res.ok) {
    const nestedError =
      body &&
      typeof body.error === "object" &&
      body.error !== null
        ? body.error
        : null;

    let fullBody = "";

    try {
      fullBody =
        JSON.stringify(body);
    } catch {
      fullBody =
        String(text || "");
    }

    let details = "";

    if (
      nestedError?.details !==
      undefined
    ) {
      try {
        details =
          JSON.stringify(
            nestedError.details
          );
      } catch {
        details =
          String(
            nestedError.details
          );
      }
    }

    const message =
      nestedError?.message ||
      body?.message ||
      (
        typeof body?.error ===
        "string"
          ? body.error
          : ""
      ) ||
      body?.raw ||
      fullBody ||
      "No response body";

    const idText =
      nestedError?.id
        ? " | id=" +
          nestedError.id
        : "";

    const codeText =
      nestedError?.code !==
        undefined
        ? " | code=" +
          nestedError.code
        : "";

    const detailsText =
      details
        ? " | details=" +
          details
        : "";

    const fullBodyText =
      fullBody &&
      fullBody !== message
        ? " | response=" +
          fullBody
        : "";

    throw new Error(
      "Copyleaks HTTP " +
        res.status +
        ": " +
        message +
        idText +
        codeText +
        detailsText +
        fullBodyText
    );
  }

  return body;
}

async function getCopyleaksToken() {
  assertCopyleaksConfigured();

  const now = Date.now();

  if (
    copyleaksTokenCache.token &&
    copyleaksTokenCache.expiresAt >
      now +
        5 *
          60 *
          1000
  ) {
    return copyleaksTokenCache.token;
  }

  const data =
    await copyleaksJson(
      COPYLEAKS_LOGIN_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
          Accept:
            "application/json"
        },

        body: JSON.stringify({
          email:
            COPYLEAKS_EMAIL,
          key:
            COPYLEAKS_API_KEY
        })
      }
    );

  const token = String(
    data?.access_token || ""
  ).trim();

  if (!token) {
    throw new Error(
      "Copyleaks login returned no access_token."
    );
  }

  let expiresAt =
    now +
    47 *
      60 *
      60 *
      1000;

  const expiresRaw =
    data?.[".expires"];

  if (expiresRaw) {
    const parsed =
      Date.parse(expiresRaw);

    if (
      Number.isFinite(parsed)
    ) {
      expiresAt = parsed;
    }
  }

  copyleaksTokenCache = {
    token,
    expiresAt
  };

  return token;
}

function makeCopyleaksScanId(
  job,
  fileIndex
) {
  const stamp =
    Date.now().toString(36);

  const rand =
    Math.random()
      .toString(36)
      .slice(2, 8);

  return (
    "jk-" +
    job.userId +
    "-" +
    stamp +
    "-" +
    fileIndex +
    "-" +
    rand
  )
    .toLowerCase()
    .slice(0, 36);
}

async function downloadTelegramFileBuffer(
  fileId
) {
  const link =
    await bot.telegram.getFileLink(
      fileId
    );

  const res =
    await fetch(String(link));

  if (!res.ok) {
    throw new Error(
      "Telegram file download failed: HTTP " +
        res.status
    );
  }

  return Buffer.from(
    await res.arrayBuffer()
  );
}

function shouldRunAiForFile(file) {
  return String(
    file?.type || ""
  ).toUpperCase() !==
    "SIMILARITY";
}


/*
  JK_PROVIDER_CUTOVER_V1

  Safe feature gates.

  DEFAULT:
    cutover = OFF
    live    = OFF

  Therefore installing this patch does NOT make
  any Quetext or Sapling request.

  Enable later with:

    JK_PROVIDER_CUTOVER_ENABLED=true

  Paid provider calls additionally require:

    JK_PROVIDER_LIVE=true
*/

function safeProviderPathPart(
  value
) {
  return String(
    value == null
      ? ""
      : value
  )
    .trim()
    .replace(
      /[^a-zA-Z0-9._-]+/g,
      "-"
    )
    .replace(
      /^[-.]+|[-.]+$/g,
      ""
    )
    .slice(
      0,
      80
    ) ||
    "item";
}

function ensureProviderRunDir(
  job,
  file
) {
  const root =
    path.join(
      DATA_DIR,
      "provider-runs"
    );

  fs.mkdirSync(
    root,
    {
      recursive: true
    }
  );

  const jobPart =
    safeProviderPathPart(
      job?.jobId ||
      "job"
    );

  const filePart =
    safeProviderPathPart(
      String(
        file?.fileIndex ??
        file?.file_name ??
        "file"
      )
    );

  const dir =
    path.join(
      root,
      jobPart +
      "-" +
      filePart
    );

  fs.mkdirSync(
    dir,
    {
      recursive: true
    }
  );

  return dir;
}

// JK_CONCISE_PROVIDER_ALERTS_V1
async function updateProviderAdminStatus(job, file, stage, rendered, remainingMs, error) {
  return require("./jk-provider-admin-status.js").updateAdminStatus({
    telegram: bot.telegram,
    adminId: ADMIN_ID,
    job,
    file,
    stage,
    rendered,
    remainingMs,
    error,
    runAi: shouldRunAiForFile(file),
    save: savePaidJobs
  });
}

async function submitPaidJobToProviders(
  jobId
) {
  const {
    buildProviderJobBundle
  } =
    require(
      "./jk-provider-job-bundle.js"
    );

  const job =
    paidJobs[
      jobId
    ];

  if (!job) {
    throw new Error(
      "Paid job not found."
    );
  }

  if (
    !Array.isArray(
      job.files
    ) ||
    job.files.length === 0
  ) {
    throw new Error(
      "Paid job has no stored files."
    );
  }

  job.route =
    JK_PROVIDER_LIVE
      ? "PROVIDER"
      : "PROVIDER_DRY_RUN";

  job.status =
    "API_PROCESSING";

  savePaidJobs();

  let completedCount = 0;
  let failedCount = 0;

  const errors = [];
  let manualCount = 0; // JK_API_WORD_LIMIT_MANUAL_ROUTE_V1

  for (
    let i = 0;
    i <
      job.files.length;
    i += 1
  ) {
    const file =
      job.files[i];

    requireFileReportIdentity(
      file
    );

    if (!file) {
      continue;
    }
    if (file.referenceBoundaryReviewStatus === "CANCELLED" ||
        String(file.providerStatus || "").toUpperCase() === "CANCELLED") {
      manualCount += 1;
      continue;
    }

    if (
      file.providerAutoResubmitBlocked ||
      (
        String(file.providerStatus || "").toUpperCase() === "FAILED" &&
        /Quetext match cannot be aligned safely|Sapling offset has ambiguous interpretations/.test(
          String(file.providerError || "")
        )
      )
    ) {
      manualCount += 1;
      file.providerStatus = "MANUAL_REQUIRED";
      file.providerAutoResubmitBlocked = true;
      file.manualReviewRequired = true;
      file.manualReviewReason = file.manualReviewReason ||
        "Previous alignment failure. Do not resubmit; review stored results or use manual reports.";
      savePaidJobs();
      continue;
    }

    if (String(file.providerStatus || "").toUpperCase() === "MANUAL_REQUIRED") {
      manualCount += 1;
      continue;
    }

    /*
      Do not redo a successfully completed
      provider scan.
    */
    if (
      JK_PROVIDER_LIVE &&
      String(
        file.providerStatus ||
        ""
      )
        .trim()
        .toUpperCase() ===
        "COMPLETE" &&
      file.providerBundleFile &&
      fs.existsSync(
        file.providerBundleFile
      )
    ) {
      completedCount += 1;

      continue;
    }

    if (needsSimilarityApiApproval(job,file)) {
      manualCount++;
      await requestSimilarityApproval(job,file);
      continue;
    }

    try {
      file.providerStatus =
        "DOWNLOADING";

      file.providerStartedAt =
        Date.now();

      file.providerError =
        null;

      savePaidJobs();

      const buffer =
        await downloadTelegramFileBuffer(
          file.file_id
        );

      if (
        !Number(
          file.file_size ||
          file.fileSize ||
          0
        )
      ) {
        file.file_size =
          buffer.length;
      }

      const runDir =
        ensureProviderRunDir(
          job,
          file
        );

      const sourceExt =
        path
          .extname(
            String(
              file.file_name ||
              ""
            )
          )
          .toLowerCase()
          .replace(
            /[^.a-z0-9]/g,
            ""
          ) ||
        ".bin";

      const sourcePath =
        path.join(
          runDir,
          "original" +
          sourceExt
        );

      fs.writeFileSync(
        sourcePath,
        buffer
      );

      const bundlePath =
        path.join(
          runDir,
          "bundle.json"
        );

      file.providerOriginalFile =
        sourcePath;

      file.providerBundleFile =
        bundlePath;

      file.providerStatus =
        "SCANNING";

      savePaidJobs();

      const similarityMode =
        String(
          file.similarityFilter || ""
        )
          .trim()
          .toUpperCase();

      if (
        ![
          FILTER_MODE_FILTERED,
          FILTER_MODE_UNFILTERED
        ].includes(
          similarityMode
        )
      ) {
        throw new Error(
          "Provider job has invalid or missing stored similarity filter: " +
          String(
            file.similarityFilter || ""
          )
        );
      }

      const providerServiceType =
        String(
          file.type || ""
        )
          .trim()
          .toUpperCase();

      if (
        ![
          "CHECK",
          "RECHECK",
          "SIMILARITY",
          "RESALE"
        ].includes(
          providerServiceType
        )
      ) {
        throw new Error(
          "Provider job has invalid or missing stored service type: " +
          String(
            file.type || ""
          )
        );
      }

      const result =
        await buildProviderJobBundle({
          sourcePath,
          onQuetextSubmitted: async ({ reportId }) => {
            file.providerQuetextReportId = reportId;
            file.providerSubmittedAt = Date.now();
            savePaidJobs();
            await updateProviderAdminStatus(job, file, "submitted");
          },

          outputPath:
            bundlePath,

          job,

          file,

          reportSettings,

          similarityMode,

          runSimilarity:
            !(job.adminFreeScan === true && file.adminFreeScan === true && file.adminAiOnly === true),

          runAi:
            shouldRunAiForFile(
              file
            ),

          live:
            JK_PROVIDER_LIVE
        });

      file.providerSimilarityPercent =
        result
          ?.similarityDetection
          ?.percent ??
        null;

      file.providerAiPercent =
        result
          ?.aiDetection
          ?.percent ??
        null;

      file.providerUpdatedAt =
        Date.now();

      /*
        DRY RUN:
        Prove extraction, identity, filtering,
        bundle generation and canonical layout.

        DO NOT render/deliver fake detector scores.
      */
      if (
        !JK_PROVIDER_LIVE
      ) {
        file.providerStatus =
          "DRY_RUN_READY";

        completedCount += 1;

        savePaidJobs();

        await sendAdminMessage(
          "PROVIDER DRY RUN READY\n" +
          "File: " +
          safeText(
            file.file_name ||
            "N/A"
          ) +
          "\nSimilarity: DRY_RUN" +
          (
            shouldRunAiForFile(
              file
            )
              ? "\nAI: DRY_RUN"
              : "\nAI: Not requested"
          ) +
          "\nNo paid provider request was made."
        );

        continue;
      }

      /*
        Similarity is mandatory for report
        rendering. AI may legitimately be
        unavailable and the renderer already
        handles that case.
      */
      const similarityPercent =
        Number(
          result
            ?.similarityDetection
            ?.percent
        );

      if (
        !(job.adminFreeScan === true && file.adminFreeScan === true && file.adminAiOnly === true) &&
        (result?.similarityDetection?.available !== true || !Number.isFinite(similarityPercent))
      ) {
        const similarityReason =
          safeText(
            result
              ?.similarityDetection
              ?.error ||
            result
              ?.similarityDetection
              ?.reason ||
            "No usable similarity score"
          );

        throw new Error(
          "Similarity provider did not return a usable result. " +
          similarityReason
        );
      }

      /*
        A later successful attempt clears
        stale failure information.
      */
      file.providerError =
        null;

      file.providerFailedAt =
        null;

      file.providerStatus =
        "COMPLETE";

      file.providerCompletedAt =
        Date.now();

      completedCount += 1;

      savePaidJobs();

      /*
        Reuse the proven existing delivery
        pipeline. That function is patched
        below to prefer providerBundleFile.
      */
      await renderAndDeliverApiReports(
        job,
        file,
        bundlePath
      );
    } catch (err) {
      if (err?.code === "REFERENCE_BOUNDARY_REVIEW_REQUIRED") {
        manualCount += 1;
        file.providerStatus = "MANUAL_REQUIRED";
        file.manualReviewRequired = true;
        file.manualReviewRequestedAt = Date.now();
        file.manualReviewReason = "Reference/bibliography boundary requires administrator review.";
        file.referenceReviewNoProviderRequests = true;
        file.providerError = null;
        savePaidJobs();
        try {
          await notifyReferenceBoundaryReview(job, file, err.referenceReview || {});
        } catch (notifyError) {
          // Keep the pending state so the persisted ten-minute fallback still
          // resolves it if Telegram delivery failed. Record failure without
          // resetting the deadline or attempting a second review notification.
          file.referenceBoundaryReviewStatus = "PENDING_ADMIN";
          if (file.referenceBoundaryReview) {
            file.referenceBoundaryReview.notificationFailureAt = Date.now();
            file.referenceBoundaryReview.notificationFailureReason =
              safeText(notifyError?.message || notifyError).slice(0, 300);
          }
          savePaidJobs();
          try {
            await sendAdminMessage(
              "REFERENCE BOUNDARY REVIEW ALERT FAILED\n" +
              "File: " + safeText(file.file_name || "N/A") + "\n" +
              "Job: " + safeText(job.jobId || "N/A") + "\n" +
              "No provider requests were made. Retry notification or review the saved referenceBoundaryReview record."
            );
          } catch {}
        }
        continue;
      }

      // JK_PROVIDER_RESULTS_MANUAL_REVIEW_V1
      if (err?.code === "PROVIDER_RESULTS_REVIEW_REQUIRED") {
        manualCount += 1;
        file.providerStatus = "MANUAL_REQUIRED";
        file.manualReviewRequired = true;
        file.manualReviewRequestedAt = Date.now();
        file.manualReviewReason = String(
          err.message || "Provider alignment needs review"
        );
        file.providerResultsFile = err.providerResultsPath || null;
        file.providerError = file.manualReviewReason;
        file.providerAutoResubmitBlocked = true;
        savePaidJobs();

        try {
          await updateProviderAdminStatus(job, file, "review");
        } catch (notifyError) {
          console.error(
            "Provider review alert failed:",
            notifyError?.message || notifyError
          );
        }

        continue;
      }

      if (err?.code === "API_MANUAL_REVIEW_REQUIRED") {
        manualCount += 1;

        file.providerStatus = "MANUAL_REQUIRED";
        file.manualReviewRequired = true;
        file.manualReviewRequestedAt = Date.now();
        file.manualReviewReason = String(
          err.message || "Word limit exceeded"
        );

        file.apiWordCount =
          Number.isFinite(Number(err.wordCount))
            ? Number(err.wordCount)
            : null;

        file.apiWordCounts =
          Array.isArray(err.apiWordCounts)
            ? err.apiWordCounts
            : [];

        file.providerError = null;

        savePaidJobs();

        try {
          await sendAdminMessage(
            "MANUAL REVIEW REQUIRED - API BLOCKED\n" +
            "User ID: " + job.userId + "\n" +
            "File: " + safeText(file.file_name || "N/A") + "\n" +
            "Words: " + String(file.apiWordCount ?? "Unverified") + "\n" +
            "Reason: " + file.manualReviewReason + "\n" +
            "Quetext and Sapling were NOT called for this file.\n" +
            "Manual delivery: /filebatch " + job.userId
          );
        } catch (notifyError) {
          console.error(
            "Admin manual-review alert failed:",
            notifyError
          );
        }

        // Manual-review notifications are admin-only.

        continue;
      }

      failedCount += 1;

      file.providerStatus =
        "FAILED";

      file.providerFailedAt =
        Date.now();

      file.providerError =
        String(
          err?.stack ||
          err?.message ||
          err
        );

      errors.push({
        file:
          file.file_name ||
          String(i + 1),

        error:
          String(
            err?.message ||
            err
          )
      });

      savePaidJobs();

      await updateProviderAdminStatus(job, file, "failed", null, 0, err?.message || err);
    }
  }

  if (
    !JK_PROVIDER_LIVE
  ) {
    job.status = manualCount
      ? (completedCount ? "PROVIDER_DRY_RUN_PARTIAL_MANUAL" : "MANUAL_REQUIRED")
      : (failedCount ? "PROVIDER_DRY_RUN_PARTIAL" : "PROVIDER_DRY_RUN_READY");
  } else if (manualCount) {
    job.status = (completedCount || failedCount)
      ? "API_PARTIAL_MANUAL"
      : "MANUAL_REQUIRED";
  } else if (
    failedCount
  ) {
    job.status =
      completedCount
        ? "API_PARTIAL"
        : "API_FAILED";
  } else if (
    job.status !==
    "DELIVERED"
  ) {
    job.status =
      "API_SCAN_COMPLETE";
  }

  savePaidJobs();

  return {
    live:
      JK_PROVIDER_LIVE,

    completedCount,

    failedCount,
    manualCount,

    errors
  };
}

/*
  One stable entry point for NEW jobs.

  When cutover is disabled the exact legacy
  Copyleaks path remains available for existing
  operation/in-flight jobs.

  When enabled, new submissions use the
  Quetext/Sapling provider-neutral pipeline.
*/
async function submitPaidJobToActiveProvider(
  jobId
) {
  const job =
    paidJobs[jobId];

  if (!job) {
    throw new Error(
      "Paid job not found."
    );
  }

  if (
    isProviderNeutralJob(
      job
    )
  ) {
    return submitPaidJobToProviders(
      jobId
    );
  }

  return submitPaidJobToCopyleaks(
    jobId
  );
}

async function submitPaidJobToCopyleaks(
  jobId
) {
  assertCopyleaksConfigured();

  const job =
    paidJobs[jobId];

  if (!job) {
    throw new Error(
      "Paid job not found."
    );
  }

  if (
    !Array.isArray(job.files) ||
    job.files.length === 0
  ) {
    throw new Error(
      "Paid job has no stored files."
    );
  }

  const token =
    await getCopyleaksToken();

  job.route =
    "COPYLEAKS";

  job.status =
    "API_PROCESSING";

  savePaidJobs();

  // JK_COPYLEAKS_FAILURE_STATUS_V1
  let submittedCount = 0;
  let failedCount = 0;
  const submissionErrors = [];

  for (
    let i = 0;
    i < job.files.length;
    i += 1
  ) {
    const file =
      job.files[i];

    if (
      file.copyleaksScanId &&
      [
        "SUBMITTED",
        "PROCESSING",
        "COMPLETED"
      ].includes(
        String(
          file.copyleaksStatus ||
            ""
        )
      )
    ) {
      continue;
    }

    if (needsSimilarityApiApproval(job,file)) {
      await requestSimilarityApproval(job,file);
      continue;
    }

    try {
      const buffer =
        await downloadTelegramFileBuffer(
          file.file_id
        );

      // JK_FILE_SIZE_FROM_BUFFER_V1
      if (!Number(file.file_size || file.fileSize || 0)) {
        file.file_size = buffer.length;
        savePaidJobs();
      }

      const scanId =
        makeCopyleaksScanId(
          job,
          i
        );

      // JK_PRESERVE_ORIGINAL_FILE_V1
      const originalExt =
        path.extname(
          safeText(
            file.file_name ||
            ""
          )
        )
          .toLowerCase()
          .replace(
            /[^.a-z0-9]/g,
            ""
          ) ||
        ".bin";

      const originalScanDir =
        ensureCopyleaksScanDir(
          scanId
        );

      const originalPath =
        path.join(
          originalScanDir,
          "original" +
            originalExt
        );

      fs.writeFileSync(
        originalPath,
        buffer
      );

      file.copyleaksOriginalFile =
        originalPath;

      const filter =
        effectiveSimilarityFilter(
          file
        );

      const filtered =
        filter ===
        FILTER_MODE_FILTERED;

      const statusUrl =
        PUBLIC_BASE_URL +
        "/copyleaks/{STATUS}/" +
        encodeURIComponent(
          scanId
        );

      const payload = {
        base64:
          buffer.toString(
            "base64"
          ),

        filename:
          file.file_name ||
          (
            "submission-" +
            (i + 1) +
            ".docx"
          ),

        properties: {
          webhooks: {
            status:
              statusUrl,

            statusHeaders: [
              [
                "x-jk-copyleaks-secret",
                COPYLEAKS_WEBHOOK_SECRET
              ]
            ]
          },

          developerPayload:
            JSON.stringify({
              jobId:
                job.jobId,
              fileIndex: i,
              userId:
                job.userId
            }),

          sandbox:
            COPYLEAKS_SANDBOX,

          includeHtml: true,

          scanTimeZone:
            "Africa/Nairobi",

          sensitivityLevel:
            COPYLEAKS_SENSITIVITY,

          scanning: {
            internet: true,

            copyleaksDb: {
              includeMySubmissions:
                false,

              includeOthersSubmissions:
                COPYLEAKS_SCAN_SHARED_DB
            }
          },

          /*
            We search the Shared Data Hub
            but DO NOT add client documents
            to it unless explicitly enabled.
          */
          indexing: {
            copyleaksDb:
              COPYLEAKS_INDEX_TO_DB
          },

          /*
            FILTERED mode:
            - quotes excluded
            - bibliography/references excluded
            - citations themselves remain included
          */
          exclude: {
            quotes:
              filtered,

            references:
              filtered,

            citations:
              false
          },

          // JK_INDEPENDENT_AI_FILTER_V1
          aiGeneratedText: {
            detect: false
          }
        }
      };

      await copyleaksJson(
        COPYLEAKS_API_BASE +
          "/v3/scans/submit/file/" +
          encodeURIComponent(
            scanId
          ),
        {
          method: "PUT",

          headers: {
            Authorization:
              "Bearer " +
              token,

            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body:
            JSON.stringify(
              payload
            )
        }
      );

      file.copyleaksScanId =
        scanId;

      file.copyleaksStatus =
        "SUBMITTED";

      file.copyleaksSubmittedAt =
        Date.now();

      file.appliedFilter =
        filter;

      submittedCount += 1;

      savePaidJobs();
    } catch (err) {
      file.copyleaksStatus =
        "FAILED";

      file.copyleaksError =
        String(
          err?.message || err
        );

      file.copyleaksFailedAt =
        Date.now();

      failedCount += 1;

      submissionErrors.push(
        safeText(
          file.file_name ||
            ("File " + (i + 1))
        ) +
          ": " +
          String(
            err?.message || err
          )
      );

      savePaidJobs();

      await sendAdminMessage(
        "❌ Copyleaks submission failed\n" +
        "User: " +
        job.userId +
        "\nFile: " +
        safeText(
          file.file_name ||
            (
              "File " +
              (i + 1)
            )
        ) +
        "\nError: " +
        safeText(
          err?.message || err
        )
      );
    }
  }

  if (failedCount > 0) {
    job.status =
      submittedCount > 0
        ? "API_PARTIAL_FAILURE"
        : "API_FAILED";

    savePaidJobs();

    throw new Error(
      failedCount +
        " Copyleaks submission(s) failed: " +
        submissionErrors.join(" | ")
    );
  }

  return job;
}

function extractCopyleaksAiPercent(
  payload
) {
  const alert =
    (
      payload
        ?.notifications
        ?.alerts || []
    ).find(
      (a) =>
        String(
          a?.code || ""
        ) ===
        "suspected-ai-text"
    );

  if (!alert) {
    return 0;
  }

  let data =
    alert.additionalData;

  if (
    typeof data === "string"
  ) {
    try {
      data =
        JSON.parse(data);
    } catch {
      data = null;
    }
  }

  const raw =
    Number(
      data?.summary?.ai
    );

  if (
    !Number.isFinite(raw)
  ) {
    return null;
  }

  const percent =
    raw <= 1
      ? raw * 100
      : raw;

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        percent * 10
      ) / 10
    )
  );
}

function findJobFileByCopyleaksScanId(
  scanId
) {
  for (
    const job of
      Object.values(
        paidJobs || {}
      )
  ) {
    for (
      const file of
        job.files || []
    ) {
      if (
        String(
          file.copyleaksScanId ||
            ""
        ) ===
        String(
          scanId || ""
        )
      ) {
        return {
          job,
          file
        };
      }
    }
  }

  return null;
}


// ============================================================
// COPYLEAKS DETAILED EXPORT
// ============================================================

function safeCopyleaksPathPart(
  value
) {
  return (
    String(
      value || "unknown"
    )
      .replace(
        /[^A-Za-z0-9._-]/g,
        "_"
      )
      .slice(
        0,
        120
      ) ||
    "unknown"
  );
}

function ensureCopyleaksScanDir(
  scanId
) {
  const dir = path.join(
    COPYLEAKS_DATA_DIR,
    safeCopyleaksPathPart(
      scanId
    )
  );

  if (
    !fs.existsSync(dir)
  ) {
    fs.mkdirSync(
      dir,
      {
        recursive: true
      }
    );
  }

  return dir;
}

function readCopyleaksJsonFile(
  filePath
) {
  try {
    if (
      !filePath ||
      !fs.existsSync(
        filePath
      )
    ) {
      return null;
    }

    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch {
    return null;
  }
}

function addCopyleaksResultDescriptor(
  map,
  id,
  sourceType,
  data = {}
) {
  if (
    id === null ||
    id === undefined ||
    String(id).trim() === ""
  ) {
    return;
  }

  const key =
    String(id).trim();

  if (map.has(key)) {
    return;
  }

  map.set(
    key,
    {
      id: key,

      sourceType,

      title:
        data?.title ||
        null,

      introduction:
        data?.introduction ||
        null,

      matchedWords:
        Number(
          data?.matchedWords ||
            0
        ),

      url:
        data?.url ||
        data?.metadata
          ?.finalUrl ||
        data?.metadata
          ?.canonicalUrl ||
        null,

      metadata:
        data?.metadata ||
        null,

      scanId:
        data?.scanId ||
        null,

      repositoryId:
        data?.repositoryId ||
        null,

      tags:
        Array.isArray(
          data?.tags
        )
          ? data.tags
          : []
    }
  );
}

function collectAlertResultIds(
  value,
  map,
  sourceType = "aiDetection"
) {
  if (
    value === null ||
    value === undefined
  ) {
    return;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      collectAlertResultIds(
        item,
        map,
        sourceType
      );
    }

    return;
  }

  if (
    typeof value !==
    "object"
  ) {
    return;
  }

  for (
    const [
      key,
      child
    ] of Object.entries(
      value
    )
  ) {
    const normalizedKey =
      String(key)
        .replace(
          /[_-]/g,
          ""
        )
        .toLowerCase();

    if (
      normalizedKey ===
      "resultid"
    ) {
      addCopyleaksResultDescriptor(
        map,
        child,
        sourceType
      );
    }

    if (
      normalizedKey ===
        "resultids" &&
      Array.isArray(child)
    ) {
      for (
        const resultId of child
      ) {
        addCopyleaksResultDescriptor(
          map,
          resultId,
          sourceType
        );
      }
    }

    collectAlertResultIds(
      child,
      map,
      sourceType
    );
  }
}

function collectCopyleaksResultDescriptors(
  payload
) {
  const resultMap =
    new Map();

  const root =
    payload?.results ||
    {};

  const groups = [
    [
      "internet",
      root.internet
    ],

    [
      "database",
      root.database
    ],

    [
      "batch",
      root.batch
    ],

    [
      "repositories",
      root.repositories
    ],

    [
      "internalAIData",
      root.internalAIData
    ]
  ];

  for (
    const [
      sourceType,
      rows
    ] of groups
  ) {
    for (
      const row of
        Array.isArray(rows)
          ? rows
          : []
    ) {
      addCopyleaksResultDescriptor(
        resultMap,
        row?.id,
        sourceType,
        row
      );
    }
  }

  /*
    AI Detection may expose its detailed export result ID
    through the AI alert's additionalData.

    Preserve standard plagiarism result IDs above, then inspect
    AI alert metadata for resultId/resultIds without guessing
    unrelated numeric IDs.
  */
  for (
    const alert of
      payload
        ?.notifications
        ?.alerts ||
      []
  ) {
    let additionalData =
      alert?.additionalData;

    if (
      typeof additionalData ===
      "string"
    ) {
      try {
        additionalData =
          JSON.parse(
            additionalData
          );
      } catch {
        additionalData =
          null;
      }
    }

    if (
      additionalData
    ) {
      collectAlertResultIds(
        additionalData,
        resultMap,
        String(
          alert?.code ||
            ""
        ) ===
          "suspected-ai-text"
          ? "aiDetection"
          : "alertResult"
      );
    }
  }

  return Array.from(
    resultMap.values()
  );
}

// JK_COPYLEAKS_EXPORT_ID_FIX_V1
function makeCopyleaksExportId(
  scanId
) {
  /*
    Copyleaks requires Export ID length <= 36 characters.
    Keep it unique but deliberately short.
  */
  const scanPart =
    safeCopyleaksPathPart(
      scanId
    )
      .toLowerCase()
      .slice(0, 12);

  const timePart =
    Date.now()
      .toString(36)
      .slice(-8);

  const randomPart =
    Math.random()
      .toString(36)
      .slice(2, 8);

  return (
    "jk-" +
    scanPart +
    "-" +
    timePart +
    "-" +
    randomPart
  ).slice(0, 36);
}

function validCopyleaksExportSecret(
  req
) {
  const supplied =
    String(
      req.get(
        "x-jk-copyleaks-secret"
      ) || ""
    );

  return (
    Boolean(
      COPYLEAKS_WEBHOOK_SECRET
    ) &&
    supplied ===
      COPYLEAKS_WEBHOOK_SECRET
  );
}

async function startCopyleaksDetailedExport(
  job,
  file,
  completedPayload
) {
  if (
    !COPYLEAKS_EXPORT_ENABLED
  ) {
    return null;
  }

  if (
    !file?.copyleaksScanId
  ) {
    return null;
  }

  if (
    file.copyleaksExportId &&
    [
      "REQUESTED",
      "RECEIVING",
      "COMPLETE"
    ].includes(
      String(
        file.copyleaksExportStatus ||
          ""
      )
    )
  ) {
    return file.copyleaksExportId;
  }

  const token =
    await getCopyleaksToken();

  const scanId =
    String(
      file.copyleaksScanId
    );

  const exportId =
    makeCopyleaksExportId(
      scanId
    );

  const descriptors =
    collectCopyleaksResultDescriptors(
      completedPayload
    );

  const publicBase =
    String(
      PUBLIC_BASE_URL ||
        ""
    ).replace(
      /\/+$/,
      ""
    );

  const exportBase =
    publicBase +
    "/copyleaks-export/" +
    encodeURIComponent(
      scanId
    ) +
    "/" +
    encodeURIComponent(
      exportId
    );

  const secureHeaders = [
    [
      "x-jk-copyleaks-secret",
      COPYLEAKS_WEBHOOK_SECRET
    ]
  ];

  const body = {
    completionWebhook:
      exportBase +
      "/completed?secret=" +
      encodeURIComponent(
        COPYLEAKS_WEBHOOK_SECRET
      ),

    maxRetries: 3,

    developerPayload:
      JSON.stringify({
        jobId:
          job?.jobId ||
          null,

        userId:
          job?.userId ||
          null,

        scanId
      }),

    crawledVersion: {
      endpoint:
        exportBase +
        "/crawled",

      verb:
        "PUT",

      headers:
        secureHeaders
    },

    results:
      descriptors.map(
        (descriptor) => ({
          id:
            descriptor.id,

          endpoint:
            exportBase +
            "/result/" +
            encodeURIComponent(
              descriptor.id
            ),

          verb:
            "PUT",

          headers:
            secureHeaders
        })
      )
  };

  // JK_COPYLEAKS_RESULT_RACE_FIX_V1
  /*
    Prepare all callback state BEFORE starting
    the Copyleaks detailed export.

    Copyleaks may send result callbacks before
    this POST request has returned.
  */
  file.copyleaksExportId =
    exportId;

  file.copyleaksExportStatus =
    "REQUESTED";

  file.copyleaksExportRequestedAt =
    Date.now();

  file.copyleaksResultDescriptors =
    descriptors;

  file.copyleaksDetailedResultFiles =
    {};

  savePaidJobs();

  await copyleaksJson(
    COPYLEAKS_API_BASE +
      "/v3/downloads/" +
      encodeURIComponent(
        scanId
      ) +
      "/export/" +
      encodeURIComponent(
        exportId
      ),

    {
      method:
        "POST",

      headers: {
        Authorization:
          "Bearer " +
          token,

        "Content-Type":
          "application/json",

        Accept:
          "application/json"
      },

      body:
        JSON.stringify(
          body
        )
    }
  );

  return exportId;
}


// ============================================================
// JK_INDEPENDENT_AI_FILTER_V1
// AI DETECTION IS COMPLETELY INDEPENDENT OF SIMILARITY FILTERING
// ============================================================

function findIndependentAiBibliographyStart(text) {
  const value =
    String(text || "");

  const headingRe =
    /(^|\n)[ \t]*(references|bibliography|works cited|reference list)[ \t]*:?[ \t]*(?=\r?\n|$)/gim;

  const matches = [];

  let match;

  while (
    (match =
      headingRe.exec(value))
  ) {
    const start =
      match.index +
      (
        match[1]
          ? match[1].length
          : 0
      );

    matches.push(start);
  }

  /*
    A table of contents can contain the word
    "References" near the start of a document.

    Prefer a real References/Bibliography heading
    occurring later in the document.
  */
  const eligible =
    matches.filter(
      (start) =>
        start >=
        value.length * 0.30
    );

  if (eligible.length) {
    return eligible[
      eligible.length - 1
    ];
  }

  return -1;
}

function buildIndependentAiInput(rawText) {
  const source =
    String(rawText || "");

  const bibliographyStart =
    findIndependentAiBibliographyStart(
      source
    );

  const limit =
    bibliographyStart >= 0
      ? bibliographyStart
      : source.length;

  let text = "";
  const map = [];

  function addGap(originIndex) {
    if (
      text.length &&
      !/\s/.test(
        text[text.length - 1]
      )
    ) {
      text += " ";
      // JK_AI_EXCLUDED_GAP_NO_SOURCE_V1
      map.push(Number.NaN);
    }
  }

  for (
    let i = 0;
    i < limit;
    i += 1
  ) {
    const ch = source[i];

    /*
      Curly quotation marks.
    */
    if (ch === "“") {
      const close =
        source.indexOf(
          "”",
          i + 1
        );

      if (
        close >= 0 &&
        close < limit
      ) {
        addGap(i);
        i = close;
        addGap(i);
        continue;
      }
    }

    /*
      Straight double quotation marks.

      Only remove a quote when a matching
      closing quotation mark exists.
      Apostrophes/single quotes are untouched.
    */
    if (
      ch === '"' &&
      source[i - 1] !== "\\"
    ) {
      let close =
        i + 1;

      while (
        close < limit
      ) {
        close =
          source.indexOf(
            '"',
            close
          );

        if (close < 0) {
          break;
        }

        if (
          source[close - 1] !==
          "\\"
        ) {
          break;
        }

        close += 1;
      }

      if (
        close >= 0 &&
        close < limit
      ) {
        addGap(i);
        i = close;
        addGap(i);
        continue;
      }
    }

    text += ch;
    map.push(i);
  }

  /*
    Trim only the outside whitespace while
    keeping the character mapping aligned.
  */
  let first = 0;
  let last = text.length;

  while (
    first < last &&
    /\s/.test(text[first])
  ) {
    first += 1;
  }

  while (
    last > first &&
    /\s/.test(text[last - 1])
  ) {
    last -= 1;
  }

  return {
    text:
      text.slice(
        first,
        last
      ),

    map:
      map.slice(
        first,
        last
      ),

    bibliographyStart:
      bibliographyStart >= 0
        ? bibliographyStart
        : null,

    originalLength:
      source.length
  };
}

function splitIndependentAiInput(
  prepared
) {
  const MAX_CHARS = 90000;
  const MIN_CHARS = 255;

  const chunks = [];

  let start = 0;

  while (
    prepared.text.length -
      start >
    MAX_CHARS
  ) {
    const hardEnd =
      start +
      MAX_CHARS;

    const minimumCut =
      start +
      Math.floor(
        MAX_CHARS * 0.80
      );

    let cut =
      prepared.text
        .lastIndexOf(
          "\n",
          hardEnd
        );

    if (
      cut < minimumCut
    ) {
      cut =
        prepared.text
          .lastIndexOf(
            " ",
            hardEnd
          );
    }

    if (
      cut < minimumCut
    ) {
      cut = hardEnd;
    }

    chunks.push({
      text:
        prepared.text.slice(
          start,
          cut
        ),

      map:
        prepared.map.slice(
          start,
          cut
        )
    });

    start = cut;
  }

  chunks.push({
    text:
      prepared.text.slice(start),

    map:
      prepared.map.slice(start)
  });

  /*
    Avoid sending a final chunk shorter
    than Copyleaks' 255-character minimum.
  */
  if (
    chunks.length > 1 &&
    chunks[
      chunks.length - 1
    ].text.length <
      MIN_CHARS
  ) {
    const tail =
      chunks.pop();

    const previous =
      chunks.pop();

    chunks.push({
      text:
        previous.text +
        tail.text,

      map:
        previous.map.concat(
          tail.map
        )
    });
  }

  return chunks.filter(
    (chunk) =>
      chunk.text.trim().length > 0
  );
}

function independentAiRanges(
  response,
  charMap
) {
  const ranges = [];

  const sections =
    Array.isArray(
      response?.results
    )
      ? response.results
      : Array.isArray(
          response?.result
        )
        ? response.result
        : [];

  for (
    const section of sections
  ) {
    if (
      Number(
        section?.classification
      ) !== 2
    ) {
      continue;
    }

    for (
      const match of
        section?.matches || []
    ) {
      const starts =
        match
          ?.text
          ?.chars
          ?.starts || [];

      const lengths =
        match
          ?.text
          ?.chars
          ?.lengths || [];

      for (
        let j = 0;
        j < starts.length;
        j += 1
      ) {
        const localStart =
          Number(starts[j]);

        const length =
          Number(
            lengths[j] || 0
          );

        if (
          !Number.isFinite(
            localStart
          ) ||
          length <= 0
        ) {
          continue;
        }

        const localEnd =
          Math.min(
            charMap.length,
            localStart +
              length
          );

        let runStart = null;
        let previous = null;

        /*
          Split ranges whenever removed quoted
          material creates a discontinuity in
          original-document coordinates.

          This prevents excluded quote text
          from being highlighted accidentally.
        */
        for (
          let k = localStart;
          k < localEnd;
          k += 1
        ) {
          const originalIndex =
            Number(
              charMap[k]
            );

          if (
            !Number.isFinite(
              originalIndex
            )
          ) {
            continue;
          }

          if (
            runStart === null
          ) {
            runStart =
              originalIndex;

            previous =
              originalIndex;

            continue;
          }

          if (
            originalIndex ===
            previous + 1
          ) {
            previous =
              originalIndex;

            continue;
          }

          ranges.push({
            start:
              runStart,

            end:
              previous + 1
          });

          runStart =
            originalIndex;

          previous =
            originalIndex;
        }

        if (
          runStart !== null
        ) {
          ranges.push({
            start:
              runStart,

            end:
              previous + 1
          });
        }
      }
    }
  }

  ranges.sort(
    (a, b) =>
      a.start -
      b.start ||
      a.end -
      b.end
  );

  const merged = [];

  for (
    const range of ranges
  ) {
    const last =
      merged[
        merged.length - 1
      ];

    if (
      last &&
      range.start <=
        last.end
    ) {
      last.end =
        Math.max(
          last.end,
          range.end
        );
    } else {
      merged.push({
        ...range
      });
    }
  }

  return merged;
}

function makeIndependentAiScanId(
  file,
  chunkIndex
) {
  const base =
    safeCopyleaksPathPart(
      file?.copyleaksScanId ||
        "scan"
    )
      .toLowerCase()
      .slice(0, 18);

  const stamp =
    Date.now()
      .toString(36)
      .slice(-6);

  return (
    "ai-" +
    base +
    "-" +
    stamp +
    "-" +
    chunkIndex
  ).slice(0, 36);
}

async function runIndependentCopyleaksAi(
  job,
  file,
  bundlePath
) {
  if (
    !shouldRunAiForFile(
      file
    )
  ) {
    return null;
  }

  const resolvedAiStatus =
    String(
      file
        .copyleaksIndependentAiStatus ||
      ""
    )
      .trim()
      .toUpperCase();

  if (
    [
      "COMPLETE",
      "UNAVAILABLE",
      "FAILED"
    ].includes(
      resolvedAiStatus
    ) &&
    file
      .copyleaksIndependentAiFile &&
    fs.existsSync(
      file
        .copyleaksIndependentAiFile
    )
  ) {
    writeCopyleaksBundle(
      file.copyleaksScanId
    );

    return readCopyleaksJsonFile(
      file
        .copyleaksIndependentAiFile
    );
  }

  const bundle =
    readCopyleaksJsonFile(
      bundlePath
    );

  const rawText =
    String(
      bundle
        ?.crawled
        ?.text
        ?.value ||
      ""
    );

  const prepared =
    buildIndependentAiInput(
      rawText
    );

  // JK_TURNITIN_AI_WORD_ELIGIBILITY_V1
  // Turnitin-style AI eligibility:
  // qualifying text must be 300-30,000 words.
  const qualifyingWordCount =
    prepared.text
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .length;

  const AI_MIN_QUALIFYING_WORDS =
    300;

  const AI_MAX_QUALIFYING_WORDS =
    30000;

  const scanDir =
    ensureCopyleaksScanDir(
      file.copyleaksScanId
    );

  const resultPath =
    path.join(
      scanDir,
      "ai-independent.json"
    );

  const rawResultPath =
    path.join(
      scanDir,
      "ai-independent-raw.json"
    );

  let record;

  if (
    qualifyingWordCount <
    AI_MIN_QUALIFYING_WORDS
  ) {
    record = {
      available: false,

      reason:
        "AI writing detection is unavailable because qualifying text is fewer than 300 words.",

      percent: null,

      ranges: [],

      eligibilityPolicy:
        "TURNITIN_300_30000_V1",

      qualifyingWords:
        qualifyingWordCount,

      minimumQualifyingWords:
        AI_MIN_QUALIFYING_WORDS,

      maximumQualifyingWords:
        AI_MAX_QUALIFYING_WORDS,

      excluded: {
        quotes: true,
        references: true,
        citations: false
      },

      originalCharacters:
        prepared.originalLength,

      analyzedCharacters:
        prepared.text.length,

      bibliographyStart:
        prepared.bibliographyStart
    };

  } else if (
    qualifyingWordCount >
    AI_MAX_QUALIFYING_WORDS
  ) {
    record = {
      available: false,

      reason:
        "AI writing detection is unavailable because qualifying text exceeds 30,000 words.",

      percent: null,

      ranges: [],

      eligibilityPolicy:
        "TURNITIN_300_30000_V1",

      qualifyingWords:
        qualifyingWordCount,

      minimumQualifyingWords:
        AI_MIN_QUALIFYING_WORDS,

      maximumQualifyingWords:
        AI_MAX_QUALIFYING_WORDS,

      excluded: {
        quotes: true,
        references: true,
        citations: false
      },

      originalCharacters:
        prepared.originalLength,

      analyzedCharacters:
        prepared.text.length,

      bibliographyStart:
        prepared.bibliographyStart
    };

  } else if (
    prepared.text.length <
    255
  ) {
    record = {
      available: false,

      reason:
        "Text too short for AI detection after excluding quotes and bibliography.",

      percent: null,

      ranges: [],

      excluded: {
        quotes: true,
        references: true,
        citations: false
      },

      originalCharacters:
        prepared.originalLength,

      analyzedCharacters:
        prepared.text.length,

      bibliographyStart:
        prepared.bibliographyStart
    };
  } else {
    try {
      const token =
        await getCopyleaksToken();

      const chunks =
        splitIndependentAiInput(
          prepared
        );

      const responses = [];

      const allRanges = [];

      let weightedAi = 0;
      let totalWeight = 0;

      for (
        let index = 0;
        index < chunks.length;
        index += 1
      ) {
        const chunk =
          chunks[index];

        if (
          chunk.text.length <
          255
        ) {
          continue;
        }

        const aiScanId =
          makeIndependentAiScanId(
            file,
            index
          );

        const response =
          await copyleaksJson(
            COPYLEAKS_API_BASE +
              "/v2/writer-detector/" +
              encodeURIComponent(
                aiScanId
              ) +
              "/check",
            {
              method: "POST",

              headers: {
                Authorization:
                  "Bearer " +
                  token,

                "Content-Type":
                  "application/json",

                Accept:
                  "application/json"
              },

              body:
                JSON.stringify({
                  text:
                    chunk.text,

                  sandbox:
                    COPYLEAKS_SANDBOX,

                  explain:
                    false,

                  sensitivity:
                    COPYLEAKS_AI_SENSITIVITY
                })
            }
          );

        responses.push({
          scanId:
            aiScanId,

          response
        });

        const rawAi =
          Number(
            response
              ?.summary
              ?.ai
          );

        const fraction =
          Number.isFinite(rawAi)
            ? Math.max(
                0,
                Math.min(
                  1,
                  rawAi > 1
                    ? rawAi / 100
                    : rawAi
                )
              )
            : 0;

        const words =
          Number(
            response
              ?.scannedDocument
              ?.totalWords
          );

        const weight =
          Number.isFinite(words) &&
          words > 0
            ? words
            : Math.max(
                1,
                chunk.text
                  .trim()
                  .split(
                    /\s+/
                  )
                  .filter(Boolean)
                  .length
              );

        weightedAi +=
          fraction *
          weight;

        totalWeight +=
          weight;

        allRanges.push(
          ...independentAiRanges(
            response,
            chunk.map
          )
        );
      }

      allRanges.sort(
        (a, b) =>
          a.start -
          b.start ||
          a.end -
          b.end
      );

      const mergedRanges =
        [];

      for (
        const range of
          allRanges
      ) {
        const last =
          mergedRanges[
            mergedRanges.length -
              1
          ];

        if (
          last &&
          range.start <=
            last.end
        ) {
          last.end =
            Math.max(
              last.end,
              range.end
            );
        } else {
          mergedRanges.push({
            ...range
          });
        }
      }

      const aiFraction =
        totalWeight > 0
          ? weightedAi /
            totalWeight
          : 0;

      record = {
        available: true,

        reason: null,

        source:
          "copyleaks-writer-detector",

        percent:
          Math.round(
            aiFraction *
              1000
          ) / 10,

        summary: {
          ai:
            aiFraction,

          human:
            1 -
            aiFraction
        },

        ranges:
          mergedRanges,

        excluded: {
          quotes: true,
          references: true,
          citations: false
        },

        originalCharacters:
          prepared.originalLength,

        analyzedCharacters:
          prepared.text.length,

        bibliographyStart:
          prepared.bibliographyStart,

        chunkCount:
          responses.length
      };

      fs.writeFileSync(
        rawResultPath,
        JSON.stringify(
          responses,
          null,
          2
        ),
        "utf8"
      );

      file
        .copyleaksIndependentAiRawFile =
        rawResultPath;

      file
        .copyleaksIndependentAiStatus =
        "COMPLETE";

      file
        .copyleaksIndependentAiCompletedAt =
        Date.now();
    } catch (err) {
      record = {
        available: false,

        reason:
          "AI detection failed",

        percent: null,

        ranges: [],

        excluded: {
          quotes: true,
          references: true,
          citations: false
        },

        error:
          String(
            err?.message ||
            err
          )
      };

      file
        .copyleaksIndependentAiStatus =
        "FAILED";

      file
        .copyleaksIndependentAiError =
        String(
          err?.message ||
          err
        );

      file
        .copyleaksIndependentAiFailedAt =
        Date.now();

      await sendAdminMessage(
        "❌ INDEPENDENT AI DETECTION FAILED\n" +
        "User: " +
        job.userId +
        "\nFile: " +
        safeText(
          file.file_name ||
          "N/A"
        ) +
        "\nError: " +
        safeText(
          err?.message ||
          err
        )
      );
    }
  }

  fs.writeFileSync(
    resultPath,
    JSON.stringify(
      record,
      null,
      2
    ),
    "utf8"
  );

  file
    .copyleaksIndependentAiFile =
    resultPath;

  if (
    record.available === false &&
    file
      .copyleaksIndependentAiStatus !==
      "FAILED"
  ) {
    file
      .copyleaksIndependentAiStatus =
      "UNAVAILABLE";
  }

  savePaidJobs();

  /*
    Rebuild the normal similarity bundle,
    now including this completely separate
    AI result.
  */
  writeCopyleaksBundle(
    file.copyleaksScanId
  );

  return record;
}

const apiDeliveryActive = new Set();
const apiDeliveryTimers = new Map();
let apiDeliveryRecoveryRunning = false;

function apiDeliveryKey(
  job,
  file
) {
  return String(
    file?.copyleaksScanId ||
      String(
        job?.jobId ||
        "job"
      ) +
      ":" +
      String(
        file?.fileIndex ??
        file?.file_name ??
        "file"
      )
  );
}

function schedulePendingApiDelivery(
  job,
  file,
  bundlePath
) {
  if (
    !job ||
    !file ||
    file.apiReportsDeliveredAt
  ) {
    return;
  }

  const key =
    apiDeliveryKey(
      job,
      file
    );

  if (
    apiDeliveryTimers.has(
      key
    )
  ) {
    return;
  }

  const dueAt =
    Number(
      file.apiDeliveryNotBeforeAt ||
      Date.now()
    );

  const waitMs =
    Math.max(
      0,
      dueAt -
        Date.now()
    );

  const timer =
    setTimeout(
      () => {
        apiDeliveryTimers.delete(
          key
        );

        renderAndDeliverApiReports(
          job,
          file,
          bundlePath ||
            file.providerBundleFile ||
            file.copyleaksBundleFile ||
            null
        ).catch(
          (err) => {
            console.error(
              "Scheduled API report delivery failed:",
              file.file_name ||
                file.copyleaksScanId,
              err?.message ||
                err
            );
          }
        );
      },
      waitMs
    );

  apiDeliveryTimers.set(
    key,
    timer
  );
}

async function renderAndDeliverApiReports(
  job,
  file,
  bundlePath
) {
  if (
    !job ||
    !file
  ) {
    throw new Error(
      "Missing job or file."
    );
  }

  if (
    typeof renderJkReports !==
    "function"
  ) {
    throw new Error(
      "Report renderer is unavailable."
    );
  }

  if (
    file.apiReportsDeliveredAt
  ) {
    return;
  }

  const deliveryKey =
    apiDeliveryKey(
      job,
      file
    );

  if (
    apiDeliveryActive.has(
      deliveryKey
    )
  ) {
    return;
  }

  apiDeliveryActive.add(
    deliveryKey
  );

  const now =
    Date.now();

  file.apiReportDeliveryStatus =
    "IN_PROGRESS";

  file.apiReportDeliveryStartedAt =
    now;

  file.apiReportDeliveryError =
    null;

  savePaidJobs();

  try {
    /*
      JK_PROVIDER_CUTOVER_V1

      Prefer the new provider-neutral bundle.
      Fall back to the old Copyleaks bundle only
      for legacy/in-flight jobs.
    */
    const neutralJob =
      isProviderNeutralJob(
        job
      );

    const providerNeutralBundle =
      neutralJob &&
      file.providerBundleFile &&
      fs.existsSync(
        file.providerBundleFile
      )
        ? file.providerBundleFile
        : null;

    if (
      neutralJob
    ) {
      bundlePath =
        providerNeutralBundle;
    }

    if (
      !neutralJob &&
      (
        !bundlePath ||
        !fs.existsSync(
          bundlePath
        )
      )
    ) {
      bundlePath =
        file.copyleaksBundleFile ||
        null;
    }

    if (
      !neutralJob &&
      (
        !bundlePath ||
        !fs.existsSync(
          bundlePath
        )
      ) &&
      file.copyleaksScanId
    ) {
      bundlePath =
        writeCopyleaksBundle(
          file.copyleaksScanId
        );
    }

    if (
      !bundlePath ||
      !fs.existsSync(
        bundlePath
      )
    ) {
      throw new Error(
        "Provider bundle is unavailable for report delivery."
      );
    }

    /*
      JK_INDEPENDENT_AI_FILTER_V1

      Similarity filtering has already finished.

      AI now uses the complete crawled document
      independently and ALWAYS excludes:
      - quoted passages
      - bibliography/references

      Client FILTERED/UNFILTERED choice has
      no effect on this call.
    */
    if (
      !neutralJob &&
      !providerNeutralBundle &&
      shouldRunAiForFile(
        file
      )
    ) {
      await runIndependentCopyleaksAi(
        job,
        file,
        bundlePath
      );
    }

    const outputDir =
      path.join(
        path.dirname(
          bundlePath
        ),
        "reports"
      );

    const rendered =
      await renderJkReports({
        bundlePath,
        outputDir
      });

    if (
      !neutralJob &&
      shouldRunAiForFile(file) &&
      !file.apiAiFinalStatusSentAt
    ) {
      let finalAiStatus;

      if (
        rendered.aiAvailable
      ) {
        const aiValue =
          Number(
            rendered.aiPercent
          );

        finalAiStatus =
          (
            Number.isFinite(
              aiValue
            )
              ? aiValue
              : 0
          )
            .toFixed(1)
            .replace(
              /\.0$/,
              ""
            ) +
          "%";
      } else {
        finalAiStatus =
          "Unavailable - " +
          safeText(
            rendered
              .aiUnavailableReason ||
            "AI detection unavailable"
          );
      }

      await sendAdminMessage(
        "✅ AI CHECK COMPLETE\n" +
        "File: " +
        safeText(
          file.file_name ||
          "N/A"
        ) +
        "\nAI: " +
        finalAiStatus
      );

      file.apiAiFinalStatusSentAt =
        Date.now();

      savePaidJobs();
    }

    if (
      !Number(
        file.apiDeliveryNotBeforeAt ||
        0
      )
    ) {
      file.apiDeliveryReadyAt =
        Date.now();

      const deliveryHoldMinutes =
        job?.adminFreeScan
          ? 0
          : API_DELIVERY_HOLD_MINUTES;

      file.apiDeliveryNotBeforeAt =
        file.apiDeliveryReadyAt +
        deliveryHoldMinutes *
          60 *
          1000;

      file.apiReportDeliveryStatus =
        "HOLDING";

      savePaidJobs();
    }

    const remainingDeliveryWaitMs =
      Math.max(
        0,
        Number(
          file.apiDeliveryNotBeforeAt ||
          0
        ) -
        Date.now()
      );

    if (neutralJob) {
      await updateProviderAdminStatus(
        job, file, "ready", rendered, remainingDeliveryWaitMs
      );
    }

    if (
      remainingDeliveryWaitMs > 0
    ) {
      if (
        !neutralJob && !file.apiDeliveryHoldNotifiedAt
      ) {
        await sendAdminMessage(
          "⏳ REPORTS READY\n" +
          "File: " +
          safeText(
            file.file_name ||
            "N/A"
          ) +
          "\nClient delivery hold: " +
          API_DELIVERY_HOLD_MINUTES +
          " minute(s)"
        );

        file.apiDeliveryHoldNotifiedAt =
          Date.now();

        savePaidJobs();
      }

      file.apiReportDeliveryStatus =
        "HOLDING";

      savePaidJobs();

      schedulePendingApiDelivery(
        job,
        file,
        bundlePath
      );

      return;
    }

    file.apiReportDeliveryStatus =
      "DELIVERING";

    file.apiReportDeliveryStartedAt =
      Date.now();

    savePaidJobs();

    if (
      rendered.similarityPath &&
      !file.apiSimilarityDeliveredAt
    ) {
      await bot.telegram.sendDocument(
        job.userId,
        {
          source:
            fs.createReadStream(
              rendered.similarityPath
            ),
          filename:
            rendered.similarityFileName
        }
      );

      file.apiSimilarityDeliveredAt =
        Date.now();

      savePaidJobs();
    }

    if (
      rendered.aiPath &&
      !file.apiAiDeliveredAt
    ) {
      await bot.telegram.sendDocument(
        job.userId,
        {
          source:
            fs.createReadStream(
              rendered.aiPath
            ),
          filename:
            rendered.aiFileName
        }
      );

      file.apiAiDeliveredAt =
        Date.now();

      savePaidJobs();
    }

    file.apiReportsDeliveredAt =
      Date.now();

    file.apiReportDeliveryStatus =
      "DELIVERED";

    file.apiRenderedSimilarityPath =
      rendered.similarityPath ||
      null;

    file.apiRenderedAiPath =
      rendered.aiPath ||
      null;

    const allDelivered =
      (
        job.files ||
        []
      ).every(
        (f) =>
          Boolean(
            f.apiReportsDeliveredAt
          )
      );

    if (allDelivered) {
      job.status =
        "DELIVERED";

      job.deliveredAt =
        Date.now();

      /*
        API delivery should look like manual delivery:
        send the report PDFs first, then one clean
        completion message for the entire paid job.
      */
      if (
        !job.apiDeliveryMessageSentAt &&
        !job.apiDeliveryMessageSending
      ) {
        job.apiDeliveryMessageSending =
          true;

        savePaidJobs();

        try {
          // JK_PAID_AI_HIGHLIGHTS_DELIVERY_V1
          const offer = paidAiHighlights.deliveryOffer(job);
          const message = String(API_REPORTS_DELIVERED_MESSAGE)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;") + offer.text;

          await bot.telegram.sendMessage(
            job.userId,
            message,
            { parse_mode: "HTML", reply_markup: offer.replyMarkup }
          );

          job.apiDeliveryMessageSentAt =
            Date.now();
        } catch (messageErr) {
          console.error(
            "API delivery completion message failed:",
            messageErr?.description ||
              messageErr?.message ||
              messageErr
          );
        } finally {
          delete job.apiDeliveryMessageSending;
        }
      }
    }

    savePaidJobs();

    if (neutralJob) {
      await updateProviderAdminStatus(job, file, "delivered", rendered);
    } else {
    await sendAdminMessage(
      "✅ API REPORTS DELIVERED\n" +
        "User: " +
        job.userId +
        "\nFile: " +
        safeText(
          file.file_name ||
          "N/A"
        ) +
        "\nSimilarity PDF: " +
        (
          rendered.similarityPath
            ? "YES"
            : "NO"
        ) +
        "\nAI PDF: " +
        (
          rendered.aiPath
            ? "YES"
            : "NO"
        )
    );
    }
  } catch (err) {
    file.apiReportDeliveryStatus =
      "FAILED";

    file.apiReportDeliveryFailedAt =
      Date.now();

    file.apiReportDeliveryError =
      String(
        err?.stack ||
        err?.message ||
        err
      );

    savePaidJobs();

    if (isProviderNeutralJob(job)) {
      await updateProviderAdminStatus(
        job, file, "failed", null, 0, err?.message || err
      );
    } else {
    await sendAdminMessage(
      "❌ API REPORT RENDER/DELIVERY FAILED\n" +
        "User: " +
        job.userId +
        "\nFile: " +
        safeText(
          file.file_name ||
          "N/A"
        ) +
        "\nError: " +
        safeText(
          err?.message ||
          err
        )
    );
    }

    throw err;
  } finally {
    apiDeliveryActive.delete(
      deliveryKey
    );
  }
}

async function recoverPendingApiDeliveries(
  source = "recovery"
) {
  if (
    apiDeliveryRecoveryRunning
  ) {
    return;
  }

  apiDeliveryRecoveryRunning =
    true;

  try {
    for (
      const job of
        Object.values(
          paidJobs ||
          {}
        )
    ) {
      if (
        !job ||
        !Array.isArray(
          job.files
        )
      ) {
        continue;
      }

      const jobStatus =
        String(
          job.status ||
          ""
        )
          .trim()
          .toUpperCase();

      if (
        [
          "CANCEL_REQUESTED",
          "CANCELLED"
        ].includes(
          jobStatus
        )
      ) {
        continue;
      }

      const neutralJob =
        isProviderNeutralJob(
          job
        );

      for (
        const file of
          job.files
      ) {
        if (
          !file ||
          file.apiReportsDeliveredAt
        ) {
          continue;
        }

        const providerReady =
          neutralJob &&
          String(
            file.providerStatus ||
            ""
          )
            .trim()
            .toUpperCase() ===
            "COMPLETE" &&
          Boolean(
            file.providerBundleFile
          ) &&
          fs.existsSync(
            file.providerBundleFile
          );

        const legacyReady =
          !neutralJob &&
          String(
            file
              .copyleaksExportStatus ||
            ""
          )
            .trim()
            .toUpperCase() ===
            "COMPLETE" &&
          Boolean(
            file.copyleaksScanId
          );

        if (
          !providerReady &&
          !legacyReady
        ) {
          continue;
        }

        const key =
          apiDeliveryKey(
            job,
            file
          );

        if (
          apiDeliveryActive.has(
            key
          )
        ) {
          continue;
        }

        const notBeforeAt =
          Number(
            file.apiDeliveryNotBeforeAt ||
            0
          );

        if (
          notBeforeAt >
          Date.now()
        ) {
          schedulePendingApiDelivery(
            job,
            file,
            providerReady
              ? file.providerBundleFile
              : (
                  file.copyleaksBundleFile ||
                  null
                )
          );

          continue;
        }

        try {
          let recoveryBundle =
            providerReady
              ? file.providerBundleFile
              : (
                  file.copyleaksBundleFile ||
                  null
                );

          if (
            !providerReady &&
            (
              !recoveryBundle ||
              !fs.existsSync(
                recoveryBundle
              )
            )
          ) {
            recoveryBundle =
              writeCopyleaksBundle(
                file.copyleaksScanId
              );
          }

          if (
            !recoveryBundle ||
            !fs.existsSync(
              recoveryBundle
            )
          ) {
            console.error(
              "API delivery recovery bundle unavailable:",
              file.file_name ||
                file.copyleaksScanId
            );

            continue;
          }

          console.log(
            "Recovering pending API delivery:",
            source,
            file.file_name ||
              file.copyleaksScanId
          );

          await renderAndDeliverApiReports(
            job,
            file,
            recoveryBundle
          );
        } catch (err) {
          console.error(
            "Pending API delivery recovery failed:",
            file.file_name ||
              file.copyleaksScanId,
            err?.message ||
              err
          );
        }
      }
    }
  } finally {
    apiDeliveryRecoveryRunning =
      false;
  }
}

function startApiDeliveryRecoveryScheduler() {
  setInterval(
    () => {
      recoverPendingApiDeliveries(
        "scheduled"
      ).catch(
        (err) => {
          console.error(
            "API delivery recovery scheduler failed:",
            err?.message ||
              err
          );
        }
      );
    },
    API_DELIVERY_RECOVERY_INTERVAL_MS
  );
}

function writeCopyleaksBundle(
  scanId
) {
  const found =
    findJobFileByCopyleaksScanId(
      scanId
    );

  if (!found) {
    return null;
  }

  const {
    job,
    file
  } = found;

  const scanDir =
    ensureCopyleaksScanDir(
      scanId
    );

  const completion =
    readCopyleaksJsonFile(
      file.copyleaksCompletedFile
    );

  const crawled =
    readCopyleaksJsonFile(
      file.copyleaksCrawledFile
    );

  const resultDetails =
    (
      file
        .copyleaksResultDescriptors ||
      []
    ).map(
      (descriptor) => {
        const mappedResultPath =
          file
            .copyleaksDetailedResultFiles
            ?.[descriptor.id] ||
          null;

        const fallbackResultPath =
          path.join(
            scanDir,
            "result-" +
              safeCopyleaksPathPart(
                descriptor.id
              ) +
              ".json"
          );

        const resultPath =
          (
            mappedResultPath &&
            fs.existsSync(
              mappedResultPath
            )
          )
            ? mappedResultPath
            : fs.existsSync(
                fallbackResultPath
              )
              ? fallbackResultPath
              : mappedResultPath;

        return {
          descriptor,

          result:
            readCopyleaksJsonFile(
              resultPath
            )
        };
      }
    );

  const bundle = {
    generatedAt:
      new Date()
        .toISOString(),

    scanId,

    exportId:
      file.copyleaksExportId ||
      null,

    job: {
      jobId:
        job.jobId ||
        null,

      userId:
        job.userId ||
        null,

      paidAt:
        job.paidAt ||
        null,

      route:
        job.route ||
        null
    },

    reportIdentity: {
      jkSubmissionId:
        file.jkSubmissionId,

      reportName:
        file.reportName,

      institution:
        file.reportInstitution,

      filename:
        file.file_name ||
        null,

      fileSize:
        Number(file.file_size || file.fileSize || 0) ||
        null,

      originalFilePath:
        file.copyleaksOriginalFile ||
        null,

      similarityFilter:
        file.similarityFilter,

      serviceType:
        file.type
    },
    aiDetection:
      readCopyleaksJsonFile(
        file.copyleaksIndependentAiFile
      ),

    completion,

    crawled,

    results:
      resultDetails
  };

  const bundlePath =
    path.join(
      scanDir,
      "bundle.json"
    );

  fs.writeFileSync(
    bundlePath,

    JSON.stringify(
      bundle,
      null,
      2
    ),

    "utf8"
  );

  file.copyleaksBundleFile =
    bundlePath;

  file.copyleaksBundleUpdatedAt =
    Date.now();

  savePaidJobs();

  return bundlePath;
}

async function handleCopyleaksStatusWebhook(
  status,
  scanId,
  payload
) {
  const found =
    findJobFileByCopyleaksScanId(
      scanId
    );

  if (!found) {
    await sendAdminMessage(
      "⚠️ Unmatched Copyleaks webhook\n" +
      "Scan: " +
      safeText(scanId) +
      "\nStatus: " +
      safeText(status)
    );

    return;
  }

  const {
    job,
    file
  } = found;

  const normalized =
    String(
      status || ""
    ).toUpperCase();

  if (
    normalized ===
    "COMPLETED"
  ) {
    file.copyleaksStatus =
      "COMPLETED";

    file.copyleaksCompletedAt =
      Date.now();

    file.copyleaksSummary = {
      similarity:
        Number(
          payload
            ?.results
            ?.score
            ?.aggregatedScore ||
            0
        ),

      totalWords:
        Number(
          payload
            ?.scannedDocument
            ?.totalWords ||
            0
        ),

      totalExcluded:
        Number(
          payload
            ?.scannedDocument
            ?.totalExcluded ||
            0
        ),

      internetSources:
        Array.isArray(
          payload
            ?.results
            ?.internet
        )
          ? payload
              .results
              .internet
              .length
          : 0,

      databaseSources:
        Array.isArray(
          payload
            ?.results
            ?.database
        )
          ? payload
              .results
              .database
              .length
          : 0,

      repositorySources:
        Array.isArray(
          payload
            ?.results
            ?.repositories
        )
          ? payload
              .results
              .repositories
              .length
          : 0,

      aiAlert:
        Boolean(
          (
            payload
              ?.notifications
              ?.alerts || []
          ).some(
            (a) =>
              String(
                a?.code || ""
              ) ===
              "suspected-ai-text"
          )
        ),

      aiPercent:
        null
    };

    try {
      const rawPath =
        path.join(
          COPYLEAKS_DATA_DIR,
          scanId +
            ".completed.json"
        );

      fs.writeFileSync(
        rawPath,
        JSON.stringify(
          payload,
          null,
          2
        ),
        "utf8"
      );

      file.copyleaksCompletedFile =
        rawPath;
    } catch (err) {
      file.copyleaksStorageError =
        String(
          err?.message || err
        );
    }

    const everyDone =
      (
        job.files || []
      ).every(
        (f) =>
          String(
            f.copyleaksStatus ||
              ""
          ) ===
          "COMPLETED"
      );

    if (everyDone) {
      job.status =
        "API_SCAN_COMPLETE";
    }

    savePaidJobs();

        // JK_COPYLEAKS_START_EXPORT_ON_COMPLETE
    if (
      COPYLEAKS_EXPORT_ENABLED
    ) {
      try {
        await startCopyleaksDetailedExport(
          job,
          file,
          payload
        );
      } catch (err) {
        file.copyleaksExportStatus =
          "FAILED";

        file.copyleaksExportError =
          String(
            err?.message ||
              err
          );

        savePaidJobs();

        await sendAdminMessage(
          "Copyleaks detailed export could not start.\n" +
          "File: " +
          safeText(
            file.file_name ||
              "N/A"
          ) +
          "\nError: " +
          safeText(
            err?.message ||
              err
          )
        );
      }
    }

await sendAdminMessage(
      "✅ COPYLEAKS SCAN COMPLETE\n" +
      "User: " +
      job.userId +
      "\n" +
      "File: " +
      safeText(
        file.file_name || "N/A"
      ) +
      "\n" +
      "Similarity: " +
      Number(
        file
          .copyleaksSummary
          .similarity
      )
        .toFixed(1)
        .replace(
          /\.0$/,
          ""
        ) +
      "%\n" +
      "Filter: " +
      similarityFilterLabel(
        file.appliedFilter
      ) +
      "\n" +
      "AI: " +
      (
        shouldRunAiForFile(file)
          ? "Pending independent check"
          : "Not requested"
      ) +
      "\n\n" +
      "Raw API data has been stored for JK report rendering."
    );

    return;
  }

  if (
    normalized ===
    "ERROR"
  ) {
    file.copyleaksStatus =
      "FAILED";

    file.copyleaksFailedAt =
      Date.now();

    file.copyleaksErrorPayload =
      payload;

    savePaidJobs();

    await sendAdminMessage(
      "❌ COPYLEAKS SCAN ERROR\n" +
      "User: " +
      job.userId +
      "\nFile: " +
      safeText(
        file.file_name ||
          "N/A"
      )
    );

    return;
  }

  file.copyleaksStatus =
    normalized ||
    "PROCESSING";

  file.copyleaksLastWebhookAt =
    Date.now();

  savePaidJobs();
}

// =====================
// EXPRESS SERVER + WEBHOOKS
// =====================
const app = express();

app.use(
  express.json({
    limit: "15mb",
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

app.post(
  "/copyleaks/:status/:scanId",
  (req, res) => {
    const suppliedSecret =
      String(
        req.get(
          "x-jk-copyleaks-secret"
        ) || ""
      );

    if (
      !COPYLEAKS_WEBHOOK_SECRET ||
      suppliedSecret !==
        COPYLEAKS_WEBHOOK_SECRET
    ) {
      return res
        .status(401)
        .json({
          ok: false
        });
    }

    res
      .status(200)
      .json({
        ok: true
      });

    const status =
      req.params.status;

    const scanId =
      req.params.scanId;

    const payload =
      req.body || {};

    setImmediate(
      async () => {
        try {
          await handleCopyleaksStatusWebhook(
            status,
            scanId,
            payload
          );
        } catch (err) {
          console.error(
            "Copyleaks webhook processing failed:",
            err?.message ||
              err
          );
        }
      }
    );
  }
);


app.put(
  "/copyleaks-export/:scanId/:exportId/crawled",
  (req, res) => {
    if (
      !validCopyleaksExportSecret(
        req
      )
    ) {
      return res
        .status(401)
        .json({
          ok: false
        });
    }

    const scanId =
      String(
        req.params.scanId ||
          ""
      );

    const exportId =
      String(
        req.params.exportId ||
          ""
      );

    const found =
      findJobFileByCopyleaksScanId(
        scanId
      );

    if (!found) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            "Unknown scan"
        });
    }

    try {
      const scanDir =
        ensureCopyleaksScanDir(
          scanId
        );

      const crawledPath =
        path.join(
          scanDir,
          "crawled.json"
        );

      fs.writeFileSync(
        crawledPath,

        JSON.stringify(
          req.body || {},
          null,
          2
        ),

        "utf8"
      );

      found.file
        .copyleaksCrawledFile =
        crawledPath;

      found.file
        .copyleaksExportId =
        exportId;

      found.file
        .copyleaksExportStatus =
        "RECEIVING";

      savePaidJobs();

      writeCopyleaksBundle(
        scanId
      );

      return res
        .status(200)
        .json({
          ok: true
        });
    } catch (err) {
      console.error(
        "Copyleaks crawled export save failed:",
        err?.message ||
          err
      );

      return res
        .status(500)
        .json({
          ok: false
        });
    }
  }
);

app.put(
  "/copyleaks-export/:scanId/:exportId/result/:resultId",
  (req, res) => {
    if (
      !validCopyleaksExportSecret(
        req
      )
    ) {
      return res
        .status(401)
        .json({
          ok: false
        });
    }

    const scanId =
      String(
        req.params.scanId ||
          ""
      );

    const exportId =
      String(
        req.params.exportId ||
          ""
      );

    const resultId =
      String(
        req.params.resultId ||
          ""
      );

    const found =
      findJobFileByCopyleaksScanId(
        scanId
      );

    if (!found) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            "Unknown scan"
        });
    }

    try {
      const scanDir =
        ensureCopyleaksScanDir(
          scanId
        );

      const resultPath =
        path.join(
          scanDir,

          "result-" +
            safeCopyleaksPathPart(
              resultId
            ) +
            ".json"
        );

      fs.writeFileSync(
        resultPath,

        JSON.stringify(
          req.body || {},
          null,
          2
        ),

        "utf8"
      );

      found.file
        .copyleaksExportId =
        exportId;

      found.file
        .copyleaksExportStatus =
        "RECEIVING";

      found.file
        .copyleaksDetailedResultFiles =
        found.file
          .copyleaksDetailedResultFiles ||
        {};

      found.file
        .copyleaksDetailedResultFiles[
          resultId
        ] =
        resultPath;

      savePaidJobs();

      writeCopyleaksBundle(
        scanId
      );

      return res
        .status(200)
        .json({
          ok: true
        });
    } catch (err) {
      console.error(
        "Copyleaks result export save failed:",
        err?.message ||
          err
      );

      return res
        .status(500)
        .json({
          ok: false
        });
    }
  }
);

app.post(
  "/copyleaks-export/:scanId/:exportId/completed",
  (req, res) => {
    const suppliedSecret =
      String(
        req.query.secret ||
          ""
      );

    if (
      !COPYLEAKS_WEBHOOK_SECRET ||
      suppliedSecret !==
        COPYLEAKS_WEBHOOK_SECRET
    ) {
      return res
        .status(401)
        .json({
          ok: false
        });
    }

    const scanId =
      String(
        req.params.scanId ||
          ""
      );

    const exportId =
      String(
        req.params.exportId ||
          ""
      );

    const found =
      findJobFileByCopyleaksScanId(
        scanId
      );

    /*
      Respond immediately so Copyleaks does not wait while
      we create/update the local bundle.
    */
    res
      .status(200)
      .json({
        ok: true
      });

    setImmediate(
      async () => {
        if (!found) {
          return;
        }

        try {
          const payload =
            req.body ||
            {};

          const tasks =
            Array.isArray(
              payload?.tasks
            )
              ? payload.tasks
              : [];

          const tasksHealthy =
            tasks.every(
              (task) => {
                const statusCode =
                  Number(
                    task
                      ?.httpStatusCode
                  );

                return (
                  task?.isHealthy ===
                    true &&
                  statusCode >= 200 &&
                  statusCode < 300
                );
              }
            );

          const exportHealthy =
            payload?.completed ===
              true &&
            tasksHealthy;

          found.file
            .copyleaksExportId =
            exportId;

          found.file
            .copyleaksExportCompletedAt =
            Date.now();

          found.file
            .copyleaksExportStatus =
            exportHealthy
              ? "COMPLETE"
              : "FAILED";

          found.file
            .copyleaksExportCompletion =
            payload;

          const bundlePath =
            writeCopyleaksBundle(
              scanId
            );

          savePaidJobs();

          await sendAdminMessage(
            (
              exportHealthy
                ? "COPYLEAKS DETAILED DATA COMPLETE"
                : "COPYLEAKS DETAILED DATA FAILED"
            ) +
              "\nFile: " +
              safeText(
                found.file
                  .file_name ||
                  "N/A"
              ) +
              "\nBundle ready: " +
              (
                bundlePath
                  ? "YES"
                  : "NO"
              )
          );

          if (
            exportHealthy &&
            bundlePath
          ) {
            await renderAndDeliverApiReports(
              found.job,
              found.file,
              bundlePath
            );
          }

        } catch (err) {
          console.error(
            "Copyleaks export completion processing failed:",
            err?.message ||
              err
          );
        }
      }
    );
  }
);

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

    reportGenerationMode:
      reportSettings.reportMode,

    similarityFilterMode:
      reportSettings.filterMode,

    reportInstitution:
      reportSettings.institution,

    providerCutoverEnabled:
      JK_PROVIDER_CUTOVER_ENABLED,

    providerLive:
      JK_PROVIDER_LIVE,

    providerReadyForReportMode:
      activeProviderReadyForReportMode(),

    activeProviderRoute:
      JK_PROVIDER_CUTOVER_ENABLED
        ? (
            JK_PROVIDER_LIVE
              ? "QUETEXT_SAPLING_LIVE"
              : "QUETEXT_SAPLING_DRY"
          )
        : "LEGACY_COPYLEAKS",

    /*
      Legacy compatibility diagnostics below.
      Keep these while old in-flight jobs may
      still receive Copyleaks callbacks.
    */
    copyleaksEnabled:
      COPYLEAKS_ENABLED,

    copyleaksSandbox:
      COPYLEAKS_SANDBOX,

    copyleaksScanSharedDb:
      COPYLEAKS_SCAN_SHARED_DB,

    copyleaksIndexToDb:
      COPYLEAKS_INDEX_TO_DB,

    copyleaksConfigured:
      Boolean(
        COPYLEAKS_EMAIL &&
        COPYLEAKS_API_KEY &&
        COPYLEAKS_WEBHOOK_SECRET
      ),
    activePollers: Object.keys(activePollers).length,
    processedUpdateCache: processedUpdateCache.size,
    checkHistoryRecords: checkHistory.length,
    usedProofCodes: Object.keys(usedProofCodes).length,
    dailySalesSummaryLastSentDateKey: dailySalesSummary.lastSentDateKey || null,
    dailySalesLedgerPayments: Object.keys(dailySalesLedger.payments || {}).length,
    botUsersRegistered: getBotUserStats().registered,
    botUsersActive: getBotUserStats().active,
    botUsersInactive: getBotUserStats().inactive,
    broadcastInProgress,
    lastBroadcastAt: broadcastMeta.lastBroadcastAt || null,
    botDisplayNameMode: lastAppliedBotNameMode,

    botDisplayNameRetryNotBefore:
      botNameRetryNotBefore || null,

    botDisplayNameRetryInSeconds:
      botNameRetryNotBefore > Date.now()
        ? Math.ceil(
            (
              botNameRetryNotBefore -
              Date.now()
            ) /
            1000
          )
        : 0,

    botDisplayNameLastVerifiedAt:
      botNameLastVerifiedAt || null,

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

      if (await paidAiHighlights.handleWebhook(payload)) return;

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
  const backfilledBotUsers = backfillBotUsersFromExistingData();
  const botUserStats = getBotUserStats();

  console.log(`Webhook server listening on port ${port}`);
  console.log(`Bot users: ${botUserStats.registered} registered, ${botUserStats.active} active, ${botUserStats.inactive} inactive, ${backfilledBotUsers} newly backfilled`);
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
  console.log(`Discount broadcast preview check: every ${DISCOUNT_BROADCAST_CHECK_MS / 1000}s`);
  console.log(`Kenyan bank payment enabled: ${INTERNATIONAL_PAYMENT_ENABLED ? "YES" : "NO"}`);
  console.log(`International check/recheck price: ${INTERNATIONAL_CHECK_PRICE_USD} ${INTERNATIONAL_CURRENCY}`);
  console.log(`International similarity only price: ${INTERNATIONAL_SIMILARITY_ONLY_PRICE} ${INTERNATIONAL_CURRENCY}`);
  console.log(`International bank fallback: ${INTERNATIONAL_BANK_FALLBACK_ENABLED ? "YES" : "NO"}`);
  console.log(
    `Payment polling: every ${STATUS_POLL_INTERVAL_MS / 1000}s, max ${STATUS_POLL_MAX_ATTEMPTS} attempts`
  );

  console.log(
    `Report generation mode: ${reportModeLabel()}`
  );

  console.log(
    `Similarity filter mode: ${filterModeLabel()}`
  );

  console.log(
    `Report institution: ${reportSettings.institution}`
  );

  console.log(
    `Legacy Copyleaks compatibility enabled/configured/sandbox: ${COPYLEAKS_ENABLED ? "YES" : "NO"}/${COPYLEAKS_EMAIL && COPYLEAKS_API_KEY && COPYLEAKS_WEBHOOK_SECRET ? "YES" : "NO"}/${COPYLEAKS_SANDBOX ? "YES" : "NO"}`
  );
  console.log(`Inactive period UTC: ${INACTIVE_START_UTC} to ${INACTIVE_END_UTC}`);
  console.log(`Inactive end display: ${INACTIVE_END_EAT_DISPLAY} EAT`);
  console.log(`Bot names: ${BOT_ONLINE_NAME} / ${BOT_OFFLINE_NAME}`);
  console.log(
    "Daily payment summary: 00:00 EAT with restart-safe catch-up"
  );
  console.log(`Daily sales ledger payments loaded: ${Object.keys(dailySalesLedger.payments || {}).length}`);

  const webhookUrl = `${PUBLIC_BASE_URL}/webhook`;

  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Telegram webhook set to: ${webhookUrl}`);
  } catch (e) {
    console.error("Failed to set Telegram webhook:", e?.description || e?.message || e);
  }

  await syncAdminCommandMenu();
  // One-off rerender of the specifically requested saved submission, ADMIN only.
  setTimeout(() => { sendOneTimeSavedAiCorrection().catch(err =>
    console.error("Saved AI correction delivery failed:",err?.message||err)); }, 8000);
  paidAiHighlights.start();

  startBotDisplayNameScheduler();
  startDailySalesSummaryScheduler();
  startDiscountBroadcastPreviewScheduler();

  // JK_API_DELIVERY_RESTART_SAFE_V6
  setTimeout(
    () => {
      recoverPendingApiDeliveries(
        "startup"
      ).catch(
        (err) => {
          console.error(
            "Startup API delivery recovery failed:",
            err?.message ||
              err
          );
        }
      );
    },
    5000
  );

  // JK_FILE_RETENTION_48H_V1
  require("./jk-file-retention.js").startFileCleanup({
    dataDir: DATA_DIR,
    getPaidJobs: () => paidJobs,
    persist: () => {
      const temporaryPath = PAID_JOBS_FILE + ".cleanup.tmp";
      fs.writeFileSync(
        temporaryPath,
        JSON.stringify(paidJobs, null, 2),
        "utf8"
      );
      fs.renameSync(temporaryPath, PAID_JOBS_FILE);
    }
  });

  startApiDeliveryRecoveryScheduler();
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});
