require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Telegraf, Markup, Input } = require("telegraf");
const pdfParse = require("pdf-parse");
const PDFParser = require("pdf2json");
const mammoth = require("mammoth");
const express = require("express");
const moment = require("moment");
const qs = require("querystring");

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
const MAX_BATCH_FILES = 5;
const TILL_NUMBER = String(process.env.TILL_NUMBER || "6164915");

const CHECK_PRICE_KES = readIntEnv("CHECK_PRICE_KES", 135);
const RECHECK_PRICE_KES = readIntEnv("RECHECK_PRICE_KES", 130);

const REPORT_DETECTION_MAX_MB = readIntEnv("REPORT_DETECTION_MAX_MB", 4);
const REPORT_DETECTION_MAX_BYTES = REPORT_DETECTION_MAX_MB * 1024 * 1024;

const RECHECK_WINDOW_MS = 24 * 60 * 60 * 1000;
const CHECK_HISTORY_RETENTION_MS = 72 * 60 * 60 * 1000;

const INACTIVE_START_UTC = normalizeHHMM(
  process.env.INACTIVE_START_UTC,
  eatHHMMToUtc(process.env.INACTIVE_START_EAT) || "21:00"
);

const INACTIVE_END_UTC = normalizeHHMM(
  process.env.INACTIVE_END_UTC,
  eatHHMMToUtc(process.env.INACTIVE_END_EAT) || "03:00"
);

// =====================
// STAGES / PAYMENT
// =====================
const STAGE_WAIT_BATCH_SIZE = "WAIT_BATCH_SIZE";
const STAGE_WAIT_UPLOADS = "WAIT_UPLOADS";
const STAGE_WAIT_FILE_TYPE = "WAIT_FILE_TYPE";
const STAGE_WAIT_PHONE = "WAIT_PHONE";
const STAGE_WAIT_PAYMENT = "WAIT_PAYMENT";
const STAGE_PAID = "PAID";

const STK_RESEND_COOLDOWN_MS = 30 * 1000;
const STK_MAX_RESENDS = 3;
const PAYMENT_TIMEOUT_MS = 6 * 60 * 1000;
const STATUS_POLL_INTERVAL_MS = 10 * 1000;
const STATUS_POLL_MAX_ATTEMPTS = 48;

// =====================
// UI TEXT
// =====================
const KEY_SEND_DOC = "📄 Send Document";
const KEY_SEND_MPESA = "🧾 Payment Help";
const KEY_CONTACT_SUPPORT = "💬 Contact Support Team";
const KEY_CANCEL = "❌ Cancel / New submission";

const REPORTS_DELIVERED_MESSAGE =
  "✅ Your Turnitin reports are ready. Thank you for choosing JK Turnitin. Access other Writing Serices Here https://john-kaptain.github.io/johnkaptain-academic-tools-hub/";

const MESSAGES = {
  welcome: (check, recheck) => `
JK Turnitin Reports Bot

1️⃣ Tap *Send Document*
2️⃣ Choose how many files you want to upload (1-${MAX_BATCH_FILES})
3️⃣ Upload your files one by one as *documents*
4️⃣ Choose *CHECK* or *RECHECK* where eligible
5️⃣ Pay *once* for the whole batch

💰 Pricing
• Check: ${check} KES
• Recheck: ${recheck} KES

🔁 Recheck is only available when the same visible file name was checked and paid within the last 24 hours.
`,
  inactive: `
⏳ Turnitin checks are paused right now.
We’ll resume at *6:45 AM EAT*.

✅ You can still send your document now — it will be received.
⚠️ Payment prompts will only be sent after 6:45 AM.

If urgent, WhatsApp call *0701730921*.
`,
  sendDocHelp:
    `📄 Tap *Send Document* first, choose *1-${MAX_BATCH_FILES}* files, then upload your files one by one as *documents* (DOC/PDF).\n\nPlease don’t send as a photo.`,
  paymentHelp:
    "🧾 Payment help:\n\n✅ Default method: *STK Push*\nChoose your batch size → upload files → choose Check/Recheck where eligible → enter phone number → receive *one combined STK prompt*.\n\n🔁 Recheck is only available when the same visible file name was checked and paid within the last 24 hours.\n\nIf prompt delays/fails, tap *Resend STK Push*.",
  askPhoneBatch: (summary, amount) =>
    `📦 Batch summary\n\n${summary}\n\n💰 Total: *${amount} KES*\n\nSend phone number (07XXXXXXXX / 01XXXXXXXX).`,
  stkSending: "⏳ Sending STK Push… check your phone and enter PIN.",
  stkSentSimple: "✅ STK Push sent. Pay on your phone — confirmation is automatic.",
  stkSentWithTill: (till) =>
    `✅ STK Push sent. Pay on your phone — confirmation is automatic.\n\nIf prompt fails, pay via Till:\n\n\`${till}\`\n\nSend proof here as screenshot not text.`,
  waitingConfirm:
    "Waiting for payment confirmation…\n\nIf webhook delays, the bot will also check IntaSend status automatically.",
  paidMsgBatch: (amount, summary) =>
    `✅ Payment confirmed (${amount} KES).\n\n${summary}\n\n⏱ Reports take *5–20 minutes* (queue).`
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
let paymentRefs = {};
let checkHistory = [];

const STORE_FILE = path.join(__dirname, "paymentRefs.store.json");
const CHECK_HISTORY_FILE = path.join(__dirname, "checkHistory.store.json");

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
    if (String(value?.invoiceId || "").trim() === wanted) {
      return { apiRef, value };
    }
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
// CHECK HISTORY PERSISTENCE
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
  if (historyName !== currentName) return false;

  return true;
}

function getRecheckEligibility(userId, fileName, fileUniqueId) {
  const now = Date.now();

  const match = checkHistory
    .filter((record) => sameFileIdentity(record, userId, fileName, fileUniqueId))
    .filter((record) => now - Number(record.lastPaidCheckAt || 0) <= RECHECK_WINDOW_MS)
    .sort((a, b) => Number(b.lastPaidCheckAt || 0) - Number(a.lastPaidCheckAt || 0))[0];

  if (!match) {
    return {
      eligible: false,
      matchedAt: null,
      hoursLeft: 0
    };
  }

  const expiresAt = Number(match.lastPaidCheckAt) + RECHECK_WINDOW_MS;
  const hoursLeft = Math.max(0, Math.ceil((expiresAt - now) / (60 * 60 * 1000)));

  return {
    eligible: true,
    matchedAt: Number(match.lastPaidCheckAt),
    hoursLeft
  };
}

function rememberPaidChecks({ userId, files, batchId, source }) {
  const paidAt = Date.now();
  let changed = false;

  for (const file of files || []) {
    if (file?.type !== "CHECK") continue;

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
      changed = true;
    } else {
      checkHistory.push({
        userId,
        fileName,
        normalizedFileName: normalizedName,
        fileUniqueId: fileUniqueId || null,
        lastPaidCheckAt: paidAt,
        batchId: batchId || null,
        source: source || "payment-confirmed"
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
// HELPERS
// =====================
function safeText(s) {
  return (s || "").toString();
}

const REPORT_TMP_DIR = path.join(os.tmpdir(), "jk-turnitin-reports");

function ensureReportTmpDir() {
  if (!fs.existsSync(REPORT_TMP_DIR)) {
    fs.mkdirSync(REPORT_TMP_DIR, { recursive: true });
  }
}

function safeFileName(name) {
  const fallback = `report_${Date.now()}`;

  return String(name || fallback)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim() || fallback;
}

function stripExistingReportPrefix(fileName) {
  return safeFileName(fileName).replace(/^(plag|ai|similarity|report)[\s_-]+/i, "");
}

function addReportPrefix(fileName, prefix) {
  return `${prefix}_${stripExistingReportPrefix(fileName)}`;
}

async function downloadTelegramDocument(fileId, originalFileName) {
  ensureReportTmpDir();

  const fileLink = await bot.telegram.getFileLink(fileId);
  const res = await fetch(fileLink.href || String(fileLink));

  if (!res.ok) {
    throw new Error(`Failed to download Telegram file. HTTP ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const localPath = path.join(
    REPORT_TMP_DIR,
    `${Date.now()}_${Math.random().toString(36).slice(2)}_${safeFileName(originalFileName)}`
  );

  fs.writeFileSync(localPath, buffer);
  return localPath;
}

function extractPdfTextWithPdf2Json(localPath) {
  return new Promise((resolve) => {
    try {
      const pdfParser = new PDFParser();

      pdfParser.on("pdfParser_dataError", (errData) => {
        console.warn("pdf2json extraction failed:", errData?.parserError || errData);
        resolve("");
      });

      pdfParser.on("pdfParser_dataReady", (pdfData) => {
        try {
          const pages = pdfData?.Pages || [];
          const textParts = [];

          for (const page of pages) {
            for (const textItem of page.Texts || []) {
              for (const run of textItem.R || []) {
                if (run.T) {
                  try {
                    textParts.push(decodeURIComponent(run.T));
                  } catch {
                    textParts.push(run.T);
                  }
                }
              }
            }
          }

          resolve(textParts.join(" "));
        } catch (err) {
          console.warn("pdf2json parse-read failed:", err?.message || err);
          resolve("");
        }
      });

      pdfParser.loadPDF(localPath);
    } catch (err) {
      console.warn("pdf2json setup failed:", err?.message || err);
      resolve("");
    }
  });
}

async function extractReportText(localPath, originalFileName, mimeType) {
  const ext = path.extname(originalFileName || "").toLowerCase();
  const mime = String(mimeType || "").toLowerCase();

  try {
    const fileBuffer = fs.readFileSync(localPath);

    if (ext === ".pdf" || mime.includes("pdf")) {
      let pdfParseText = "";
      let pdf2JsonText = "";

      try {
        const data = await pdfParse(fileBuffer);
        pdfParseText = data.text || "";
      } catch (err) {
        console.warn("pdf-parse extraction failed:", err?.message || err);
      }

      try {
        pdf2JsonText = await extractPdfTextWithPdf2Json(localPath);
      } catch (err) {
        console.warn("pdf2json extraction wrapper failed:", err?.message || err);
      }

      const rawUtf8 = fileBuffer.toString("utf8");
      const rawLatin1 = fileBuffer.toString("latin1");

      return `${pdfParseText}\n${pdf2JsonText}\n${rawUtf8}\n${rawLatin1}`;
    }

    if (ext === ".docx" || mime.includes("wordprocessingml.document")) {
      const data = await mammoth.extractRawText({ path: localPath });
      return data.value || "";
    }
  } catch (err) {
    console.warn("Report text extraction failed:", err?.message || err);
  }

  return "";
}

function normalizeReportDetectionText(value) {
  const loose = String(value || "")
    .normalize("NFKD")
    .replace(/[’‘`´]/g, "'")
    .replace(/[‐-‒–—―]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  const compact = loose.replace(/[^a-z0-9%]+/g, "");

  return { loose, compact };
}

function scoreLoosePatterns(text, patterns) {
  let score = 0;

  for (const item of patterns) {
    if (item.pattern.test(text)) {
      score += item.weight || 1;
    }
  }

  return score;
}

function scoreCompactTerms(text, terms) {
  let score = 0;

  for (const item of terms) {
    if (text.includes(item.term)) {
      score += item.weight || 1;
    }
  }

  return score;
}

function detectTurnitinReportType({ fileName, caption, text }) {
  const rawCombined = `
${fileName || ""}
${caption || ""}
${text || ""}
`;

  const { loose, compact } = normalizeReportDetectionText(rawCombined);

  const aiLoosePatterns = [
    { pattern: /\bai writing overview\b/i, weight: 20 },
    { pattern: /\bai writing report\b/i, weight: 18 },
    { pattern: /\b\d{1,3}\s*%?\s*detected as ai\b/i, weight: 20 },
    { pattern: /\*?\s*%\s*detected as ai\b/i, weight: 18 },
    { pattern: /\bdetected as ai\b/i, weight: 18 },
    { pattern: /\bai-generated only\b/i, weight: 16 },
    { pattern: /\bai generated only\b/i, weight: 16 },
    { pattern: /\bai-generated text that was ai-paraphrased\b/i, weight: 16 },
    { pattern: /\bai generated text that was ai paraphrased\b/i, weight: 16 },
    { pattern: /\bai-paraphrased\b/i, weight: 12 },
    { pattern: /\bai paraphrased\b/i, weight: 12 },
    { pattern: /\bqualifying text\b/i, weight: 10 },
    { pattern: /\blarge-language model\b/i, weight: 10 },
    { pattern: /\blarge language model\b/i, weight: 10 },
    { pattern: /\bai writing assessment\b/i, weight: 10 },
    { pattern: /\bturnitin'?s ai detection\b/i, weight: 10 },
    { pattern: /\bai detection capabilities\b/i, weight: 8 },
    { pattern: /\bfalse positives\b/i, weight: 6 }
  ];

  const aiCompactTerms = [
    { term: "aiwritingoverview", weight: 20 },
    { term: "aiwritingreport", weight: 18 },
    { term: "detectedasai", weight: 20 },
    { term: "aigeneratedonly", weight: 16 },
    { term: "aigeneratedtextthatwasaiparaphrased", weight: 16 },
    { term: "aiparaphrased", weight: 12 },
    { term: "qualifyingtext", weight: 10 },
    { term: "largelanguagemodel", weight: 10 },
    { term: "aiwritingassessment", weight: 10 },
    { term: "turnitinsaidetection", weight: 10 },
    { term: "aidetectioncapabilities", weight: 8 },
    { term: "falsepositives", weight: 6 }
  ];

  const plagLoosePatterns = [
    { pattern: /\bintegrity overview\b/i, weight: 20 },
    { pattern: /\boverall similarity\b/i, weight: 20 },
    { pattern: /\bsimilarity report\b/i, weight: 18 },
    { pattern: /\boriginality report\b/i, weight: 18 },
    { pattern: /\bsimilarity index\b/i, weight: 18 },
    { pattern: /\bmatch groups\b/i, weight: 14 },
    { pattern: /\bmatched sources\b/i, weight: 14 },
    { pattern: /\bmatch overview\b/i, weight: 14 },
    { pattern: /\bsource overview\b/i, weight: 14 },
    { pattern: /\btop sources\b/i, weight: 14 },
    { pattern: /\binternet sources\b/i, weight: 12 },
    { pattern: /\bpublications\b/i, weight: 10 },
    { pattern: /\bsubmitted works\b/i, weight: 12 },
    { pattern: /\bstudent papers\b/i, weight: 12 },
    { pattern: /\bprimary sources\b/i, weight: 12 },
    { pattern: /\bexcluded sources\b/i, weight: 6 }
  ];

  const plagCompactTerms = [
    { term: "integrityoverview", weight: 20 },
    { term: "overallsimilarity", weight: 20 },
    { term: "similarityreport", weight: 18 },
    { term: "originalityreport", weight: 18 },
    { term: "similarityindex", weight: 18 },
    { term: "matchgroups", weight: 14 },
    { term: "matchedsources", weight: 14 },
    { term: "matchoverview", weight: 14 },
    { term: "sourceoverview", weight: 14 },
    { term: "topsources", weight: 14 },
    { term: "internetsources", weight: 12 },
    { term: "publications", weight: 10 },
    { term: "submittedworks", weight: 12 },
    { term: "studentpapers", weight: 12 },
    { term: "primarysources", weight: 12 },
    { term: "excludedsources", weight: 6 }
  ];

  const aiScore =
    scoreLoosePatterns(loose, aiLoosePatterns) +
    scoreCompactTerms(compact, aiCompactTerms);

  const plagScore =
    scoreLoosePatterns(loose, plagLoosePatterns) +
    scoreCompactTerms(compact, plagCompactTerms);

  if (aiScore >= 12 && aiScore > plagScore) {
    return {
      kind: "AI",
      prefix: "AI",
      confidence: "high",
      aiScore,
      plagScore
    };
  }

  if (plagScore >= 12 && plagScore >= aiScore) {
    return {
      kind: "PLAG",
      prefix: "Plag",
      confidence: "high",
      aiScore,
      plagScore
    };
  }

  return {
    kind: "NORMAL",
    prefix: null,
    confidence: "low",
    aiScore,
    plagScore
  };
}

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
      Markup.button.callback("3", "BATCH_COUNT_3")
    ],
    [
      Markup.button.callback("4", "BATCH_COUNT_4"),
      Markup.button.callback("5", "BATCH_COUNT_5")
    ],
    [Markup.button.callback("❌ Cancel", "TYPE_CANCEL")]
  ]);
}

function typeInlineKeyboard(allowRecheck) {
  const rows = [[Markup.button.callback(`✅ CHECK (${CHECK_PRICE_KES} KES)`, "TYPE_CHECK")]];

  if (allowRecheck) {
    rows.push([Markup.button.callback(`🔁 RECHECK (${RECHECK_PRICE_KES} KES)`, "TYPE_RECHECK")]);
  }

  rows.push([Markup.button.callback("❌ Cancel", "TYPE_CANCEL")]);

  return Markup.inlineKeyboard(rows);
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

function adminActionKeyboard(userId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📦 Start filebatch", `ADMIN_FILEBATCH_${userId}`)],
    [Markup.button.callback("💬 Reply to user", `ADMIN_REPLY_${userId}`)]
  ]);
}

async function sendAdminMessage(text, extra = {}) {
  const userIdForButtons = extractAdminActionUserId(text);

  const finalExtra = {
    parse_mode: "Markdown",
    ...extra
  };

  if (userIdForButtons && !finalExtra.reply_markup) {
    finalExtra.reply_markup = adminActionKeyboard(userIdForButtons).reply_markup;
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
    pendingInitialDocument: null
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

async function notifyUserCancelledToAdmin(user) {
  if (user.id === ADMIN_ID) return;

  await sendAdminMessage(
    `❌ User cancelled submission\nUser ID: ${user.id}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}${adminQuickCommands(
      user.id
    )}`
  );
}

function hasActiveSubmissionForUploads(sub) {
  return !!sub && [
    STAGE_WAIT_UPLOADS,
    STAGE_WAIT_FILE_TYPE,
    STAGE_WAIT_PHONE,
    STAGE_WAIT_PAYMENT
  ].includes(sub.stage);
}

function ensureFreshSubmission(userId) {
  if (!submissions[userId]) {
    submissions[userId] = createEmptySubmission();
  }
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

async function forwardAcceptedDocumentByIds(userId, chatId, messageId, username, firstName, lastName) {
  try {
    await sendAdminMessage(
      `📨 Document received\nUser ID: ${userId}\nUsername: @${safeText(
        username || "N/A"
      )}\nName: ${safeText(firstName)} ${safeText(lastName)}${adminQuickCommands(userId)}`
    );
    await bot.telegram.forwardMessage(ADMIN_ID, chatId, messageId);
  } catch {}
}

async function beginSubmissionFlow(ctx) {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  if (ctx.from.id === ADMIN_ID) {
    return replyMarkdownSafe(ctx, MESSAGES.sendDocHelp, {
      reply_markup: mainKeyboard()
    });
  }

  const userId = ctx.from.id;
  const existing = submissions[userId];

  if (existing && existing.stage === STAGE_WAIT_BATCH_SIZE) {
    await ctx.reply(
      `📦 How many files do you want to upload?\nChoose from *1* to *${MAX_BATCH_FILES}*.`,
      {
        parse_mode: "Markdown",
        reply_markup: batchSizeKeyboard().reply_markup
      }
    );
    return;
  }

  submissions[userId] = createEmptySubmission();

  await ctx.reply(
    `📦 How many files do you want to upload?\nChoose from *1* to *${MAX_BATCH_FILES}*.`,
    {
      parse_mode: "Markdown",
      reply_markup: batchSizeKeyboard().reply_markup
    }
  );
}

async function showPaymentHelp(ctx) {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) {
    return notifyInactivePeriod(ctx);
  }

  await replyMarkdownSafe(ctx, MESSAGES.paymentHelp, {
    reply_markup: mainKeyboard()
  });
}

async function askForFileType(ctx, sub) {
  const file = getCurrentPendingFile(sub);
  if (!file) return;

  const fileNumber = sub.currentFileIndex + 1;

  const recheckNote = file.recheckEligible
    ? `✅ This file qualifies for *RECHECK* because the same file was checked and paid within the last 24 hours.\n\nYou may choose *CHECK* or *RECHECK*.`
    : `ℹ️ This file name does not have a matching paid *CHECK* within the last 24 hours.\n\nIt will be treated as *CHECK*.`;

  await ctx.reply(
    `📄 File Received: *${safeText(file.file_name)}*\n\nFile *${fileNumber}* of *${sub.expectedFiles}*.\n\n${recheckNote}`,
    {
      parse_mode: "Markdown",
      reply_markup: typeInlineKeyboard(Boolean(file.recheckEligible)).reply_markup
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
  sub.batchId = sub.batchId || makeBatchId(ctx.from.id);
  sub.stage = STAGE_WAIT_PHONE;
  sub.currentFileIndex = null;

  const summary = formatBatchSummary(sub);

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

  if (kind === "RECHECK" && !file.recheckEligible) {
    kind = "CHECK";
    await ctx.answerCbQuery("Recheck not available; treated as CHECK.");
    await ctx.reply(
      "⚠️ Recheck is only available when the same file name was checked and paid within the last 24 hours.\n\nThis file has been treated as *CHECK*.",
      { parse_mode: "Markdown" }
    );
  } else {
    await ctx.answerCbQuery(`${kind} selected`);
  }

  file.type = kind;
  file.price = kind === "CHECK" ? CHECK_PRICE_KES : RECHECK_PRICE_KES;
  const justCompletedNumber = sub.currentFileIndex + 1;
  sub.currentFileIndex = null;

  if (sub.files.length >= sub.expectedFiles) {
    await moveBatchToPhoneStep(ctx, sub);
    return;
  }

  sub.stage = STAGE_WAIT_UPLOADS;
  await ctx.reply(
    `✅ ${kind} saved for file ${justCompletedNumber}.\n\nNow send file ${
      sub.files.length + 1
    } of ${sub.expectedFiles}.\nIf you are finished early, tap *Done Uploading*.`,
    {
      parse_mode: "Markdown",
      reply_markup: uploadContinueKeyboard().reply_markup
    }
  );
}

// =====================
// INTASEND REST HELPERS
// =====================
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
      (data && (data.detail || data.message || JSON.stringify(data))) ||
        `HTTP ${res.status}`
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

  if (
    ["COMPLETE", "COMPLETED", "SUCCESS", "SUCCEEDED", "PAID", "TS100"].includes(s)
  ) return "COMPLETE";

  if (["FAILED", "FAIL", "ERROR", "TF103", "TF106"].includes(s)) return "FAILED";
  if (["CANCELLED", "CANCELED", "TC108"].includes(s)) return "CANCELLED";
  if (["EXPIRED", "TIMEOUT", "TIMEDOUT"].includes(s)) return "EXPIRED";

  if (
    ["PENDING", "PROCESSING", "IN_PROGRESS", "INPROGRESS", "TP101", "TP102", "BP101", "BP103"].includes(s)
  ) return "PENDING";

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
  return intasendRequest("/payment/status/", {
    invoice_id
  });
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

  updatePaymentRef(apiRef, {
    status: "COMPLETE",
    invoiceId: invoiceId || ref.invoiceId || null,
    completedAt: Date.now(),
    lastState: state || "COMPLETE",
    completionSource: source || "unknown"
  });

  stopStatusPolling(apiRef);

  const batchLookup = getBatchById(ref.batchId);
  const userId = batchLookup?.userId || ref.userId;
  const sub = batchLookup?.sub || submissions[userId];

  if (sub) {
    sub.paid = true;
    sub.stage = STAGE_PAID;
    sub.invoiceId = invoiceId || sub.invoiceId || ref.invoiceId || null;
  }

  const filesForHistory = sub?.files || ref.files || [];

  rememberPaidChecks({
    userId,
    files: filesForHistory,
    batchId: ref.batchId || sub?.batchId || null,
    source: source || "payment-confirmed"
  });

  try {
    await bot.telegram.sendMessage(
      userId,
      MESSAGES.paidMsgBatch(ref.amount, ref.summary || "Batch payment"),
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    await sendAdminMessage(
      `❌ Could not message user ${userId} after payment completion. Error: ${safeText(
        e?.message || e
      )}`
    );
  }

  await sendAdminMessage(
    `✅ PAYMENT COMPLETE\nUser: ${userId}\nType: ${safeText(
      ref.kind || "BATCH"
    )}\nAmount: ${safeText(ref.amount)} KES\napi_ref: ${safeText(
      apiRef
    )}\ninvoice_id: ${safeText(invoiceId || ref.invoiceId || "N/A")}\nSource: ${safeText(
      source || "unknown"
    )}\nMode: ${INTASEND_TEST ? "TEST" : "LIVE"}`
  );

  resetSubmission(userId);
  return true;
}

async function markPaymentFailure({ apiRef, invoiceId, state, source, reason }) {
  const ref = getPaymentRef(apiRef);
  if (!ref) return false;
  if (ref.status === "COMPLETE") return false;

  updatePaymentRef(apiRef, {
    status: state || "FAILED",
    invoiceId: invoiceId || ref.invoiceId || null,
    lastState: state || "FAILED",
    failureSource: source || "unknown",
    failureReason: reason || null
  });

  stopStatusPolling(apiRef);

  const batchLookup = getBatchById(ref.batchId);
  const userId = batchLookup?.userId || ref.userId;
  const sub = batchLookup?.sub || submissions[userId];

  if (sub && !sub.paid) {
    sub.stage = STAGE_WAIT_PAYMENT;
  }

  try {
    await bot.telegram.sendMessage(
      userId,
      `❌ Payment ${String(state || "failed").toLowerCase()}.\nTap *Resend STK Push* to try again.`,
      {
        parse_mode: "Markdown",
        reply_markup: paymentWaitKeyboard().reply_markup
      }
    );
  } catch (e) {
    await sendAdminMessage(
      `❌ Could not message user ${userId} after payment failure. Error: ${safeText(
        e?.message || e
      )}`
    );
  }

  await sendAdminMessage(
    `⚠️ PAYMENT ${safeText(state || "FAILED")}\nUser: ${userId}\napi_ref: ${safeText(
      apiRef
    )}\ninvoice_id: ${safeText(invoiceId || ref.invoiceId || "N/A")}\nSource: ${safeText(
      source || "unknown"
    )}\nReason: ${safeText(reason || "N/A")}`
  );

  return true;
}

async function queryPaymentStatus(invoiceId) {
  if (!invoiceId) throw new Error("Missing invoiceId for status query");
  const resp = await intasendCheckPaymentStatus({ invoice_id: invoiceId });
  const state = normalizePaymentState(extractState(resp));

  return {
    raw: resp,
    invoiceId: extractInvoiceId(resp) || invoiceId,
    apiRef: extractApiRef(resp) || resp?.invoice?.api_ref || null,
    state,
    failedReason:
      resp?.invoice?.failed_reason ||
      resp?.failed_reason ||
      resp?.detail ||
      resp?.message ||
      null
  };
}

function startStatusPolling({ userId, apiRef, invoiceId }) {
  if (!apiRef || !invoiceId) return;

  stopStatusPolling(apiRef);

  let attempts = 0;

  activePollers[apiRef] = setInterval(async () => {
    attempts += 1;

    if (attempts > STATUS_POLL_MAX_ATTEMPTS) {
      stopStatusPolling(apiRef);
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
      const statusResp = await queryPaymentStatus(invoiceId);

      updatePaymentRef(apiRef, {
        invoiceId: statusResp.invoiceId || invoiceId,
        lastState: statusResp.state,
        lastPolledAt: Date.now(),
        pollAttempts: attempts
      });

      if (statusResp.state === "COMPLETE") {
        await markPaymentComplete({
          apiRef,
          invoiceId: statusResp.invoiceId,
          state: statusResp.state,
          source: "status-poll"
        });
        return;
      }

      if (["FAILED", "CANCELLED", "EXPIRED"].includes(statusResp.state)) {
        await markPaymentFailure({
          apiRef,
          invoiceId: statusResp.invoiceId,
          state: statusResp.state,
          source: "status-poll",
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
          `⚠️ IntaSend status poll failed\nUser: ${userId}\napi_ref: ${safeText(
            apiRef
          )}\ninvoice_id: ${safeText(invoiceId)}\nAttempt: ${attempts}\nHTTP: ${safeText(
            err?.status || "N/A"
          )}\nError: ${safeText(err?.message || err)}`
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
    if (!sub || sub.paid) return;
    if (sub.stage !== STAGE_WAIT_PAYMENT) return;

    try {
      await bot.telegram.sendMessage(
        userId,
        "⏳ Still waiting for payment confirmation.\n\nIf you already paid, the bot is still checking IntaSend automatically. If the prompt never came, tap *Resend STK Push*.",
        {
          parse_mode: "Markdown",
          reply_markup: paymentWaitKeyboard().reply_markup
        }
      );
    } catch {}
  }, PAYMENT_TIMEOUT_MS);
}

// =====================
// STK PUSH
// =====================
async function attemptStkPush(ctx, sub, { mode }) {
  const userId = ctx.from.id;

  if (!sub?.phone || !sub?.amount || !sub?.batchId) {
    sub.stage = STAGE_WAIT_PHONE;
    await ctx.reply("⚠️ Missing payment details. Please send your phone number again.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  if (
    mode === "resend" &&
    sub.stkSentAt &&
    Date.now() - sub.stkSentAt < STK_RESEND_COOLDOWN_MS
  ) {
    const remainingMs = STK_RESEND_COOLDOWN_MS - (Date.now() - sub.stkSentAt);
    const remainingSec = Math.ceil(remainingMs / 1000);
    if (ctx.answerCbQuery) await ctx.answerCbQuery(`Wait ${remainingSec}s`);
    return;
  }

  if (mode === "resend") {
    sub.resendCount = (sub.resendCount || 0) + 1;
    if (sub.resendCount > STK_MAX_RESENDS) {
      await ctx.reply(
        `⚠️ Resend limit reached.\n\nPay via Till:\n\n\`${TILL_NUMBER}\`\n\nSend proof here.`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  }

  if (mode === "initial") await ctx.reply(MESSAGES.stkSending);

  const apiRef = makePaymentAttemptRef(userId);
  const summary = formatBatchSummary(sub);

  putPaymentRef(apiRef, {
    userId,
    batchId: sub.batchId,
    kind: getBatchKindLabel(sub),
    amount: sub.amount,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    summary,
    phone: sub.phone,
    invoiceId: null,
    status: "PENDING",
    lastState: "PENDING",
    mode: INTASEND_TEST ? "TEST" : "LIVE",
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

    if (invoiceId) {
      startStatusPolling({ userId, apiRef, invoiceId });
    } else {
      await sendAdminMessage(
        `⚠️ STK response had no invoice_id\nUser: ${userId}\napi_ref: ${apiRef}\nMode: ${
          INTASEND_TEST ? "TEST" : "LIVE"
        }\nWebhook may still confirm, but polling cannot start without invoice_id.`
      );
    }

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

    await ctx.reply("❌ STK Push failed.\nTap *Resend STK Push* to try again.", {
      parse_mode: "Markdown",
      reply_markup: paymentWaitKeyboard().reply_markup
    });

    await sendAdminMessage(
      `❌ STK Push error\nUser: ${userId}\napi_ref: ${safeText(apiRef)}\nPhone: ${safeText(
        sub.phone
      )}\nHTTP: ${safeText(err?.status || "N/A")}\nError: ${safeText(
        err?.message || err
      )}\nPayload: ${safeText(JSON.stringify(err?.payload || {}))}\nMode: ${
        INTASEND_TEST ? "TEST" : "LIVE"
      }\nHost: ${PUBLIC_BASE_URL}`
    );
  }
}

// =====================
// START
// =====================
bot.start(async (ctx) => {
  const user = ctx.from;

  if (user.id === ADMIN_ID) {
    await replyMarkdownSafe(ctx, "👋 Admin mode is ready.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  await sendAdminMessage(
    `🔥 New user started bot\nName: ${safeText(user.first_name)} ${safeText(
      user.last_name
    )}\nUsername: @${safeText(user.username || "N/A")}\nUser ID: ${user.id}${adminQuickCommands(
      user.id
    )}`
  );

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(
    ctx,
    `${MESSAGES.welcome(CHECK_PRICE_KES, RECHECK_PRICE_KES)}\nTap the button below to begin.`,
    {
      reply_markup: startInlineKeyboard().reply_markup
    }
  );
});

// =====================
// ADMIN COMMANDS
// =====================
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

━━━━━━━━━━━━━━━
_We’re here if you need anything else._`,
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
    sentCount: 0
  };

  await ctx.reply(
    `✅ Batch delivery opened for user ${userId}.\nNow send as many document/photo messages as needed.\nWhen finished, send /donebatch\nTo cancel, send /cancelbatch`
  );
});

bot.command("donebatch", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const target = pendingFileTargets[ADMIN_ID];
  if (!target) return ctx.reply("No active batch session. Use /filebatch <userId> first.");

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
  if (!target) return ctx.reply("No active batch session.");

  delete pendingFileTargets[ADMIN_ID];
  await ctx.reply(`✅ Batch session cancelled for user ${target.userId}.`);
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
    sentCount: 0
  };

  await ctx.answerCbQuery("Filebatch opened");
  await ctx.reply(
    `✅ Batch delivery opened for user ${userId}.\nNow send as many document/photo messages as needed.\nWhen finished, send /donebatch\nTo cancel, send /cancelbatch`
  );
});

bot.action(/^ADMIN_REPLY_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  const userId = ctx.match[1];

  pendingAdminReplies[ADMIN_ID] = {
    userId
  };

  await ctx.answerCbQuery("Reply mode opened");
  await ctx.reply(
    `💬 Reply mode opened for user ${userId}.\nType the message you want to send.\nTo cancel, send /cancelreply`
  );
});

bot.command("cancelreply", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const replyTarget = pendingAdminReplies[ADMIN_ID];
  if (!replyTarget) {
    return ctx.reply("No active reply session.");
  }

  delete pendingAdminReplies[ADMIN_ID];

  await ctx.reply(`✅ Reply session cancelled for user ${replyTarget.userId}.`);
});

// =====================
// START INLINE BUTTONS
// =====================
bot.action("START_SEND_DOC", async (ctx) => {
  await ctx.answerCbQuery("Starting");
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

bot.hears(KEY_SEND_MPESA, async (ctx) => {
  await showPaymentHelp(ctx);
});

bot.hears(KEY_CONTACT_SUPPORT, async (ctx) => {
  supportRequests[ctx.from.id] = true;
  await ctx.reply(
    "💬 Please type your message for the Support Team. It will be delivered to admin.",
    { reply_markup: mainKeyboard() }
  );
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

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  if (count < 1 || count > MAX_BATCH_FILES) {
    return ctx.answerCbQuery("Invalid number.");
  }

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

    sub.files.push(storedFile);
    sub.currentFileIndex = sub.files.length - 1;
    sub.stage = STAGE_WAIT_FILE_TYPE;
    sub.pendingInitialDocument = null;

    await ctx.reply(
      `✅ You selected *${count}* file(s).\n\nYour first document has been captured as *file 1*.`,
      {
        parse_mode: "Markdown",
        reply_markup: mainKeyboard()
      }
    );

    await forwardAcceptedDocumentByIds(
      pending.userId,
      pending.chatId,
      pending.messageId,
      pending.username,
      pending.firstName,
      pending.lastName
    );

    await askForFileType(ctx, sub);
    return;
  }

  await ctx.reply(
    `✅ You selected *${count}* file(s).\n\nNow send file *1* of *${count}* as a *document*.`,
    {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    }
  );
});

// =====================
// DOCUMENT HANDLER
// =====================
bot.on("document", async (ctx) => {
  const user = ctx.from;

  // ADMIN SENDING REPORT FILES
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];

    if (!target) {
      return ctx.reply("Use /filebatch <userId> first.");
    }

    const doc = ctx.message.document;
    const docSize = Number(doc.file_size || 0);

    let localPath = null;
    let detection = {
      kind: "NORMAL",
      prefix: null,
      confidence: "low",
      aiScore: 0,
      plagScore: 0
    };

    let finalFileName = safeFileName(doc.file_name || `document_${Date.now()}`);
    let sentWithPrefix = false;
    let skippedDetectionBecauseLarge = false;

    try {
      const sendOptions = {
        caption: target.sentCount === 0 ? target.caption || undefined : undefined
      };

      if (docSize > REPORT_DETECTION_MAX_BYTES) {
        skippedDetectionBecauseLarge = true;

        await bot.telegram.sendDocument(
          target.userId,
          doc.file_id,
          sendOptions
        );
      } else {
        try {
          localPath = await downloadTelegramDocument(doc.file_id, finalFileName);

          const extractedText = await extractReportText(
            localPath,
            finalFileName,
            doc.mime_type
          );

          detection = detectTurnitinReportType({
            fileName: finalFileName,
            caption: ctx.message.caption || target.caption || "",
            text: extractedText
          });

          console.log("Report detection:", {
            fileName: finalFileName,
            fileSizeBytes: docSize,
            maxDetectionBytes: REPORT_DETECTION_MAX_BYTES,
            extractedChars: extractedText.length,
            kind: detection.kind,
            aiScore: detection.aiScore,
            plagScore: detection.plagScore
          });
        } catch (err) {
          console.warn("Report detection failed; using normal send route:", err?.message || err);
        }

        if (detection.kind === "AI" || detection.kind === "PLAG") {
          if (!localPath) {
            throw new Error("Report was detected, but the local file was not available for renaming.");
          }

          finalFileName = addReportPrefix(finalFileName, detection.prefix);

          await bot.telegram.sendDocument(
            target.userId,
            Input.fromLocalFile(localPath, finalFileName),
            sendOptions
          );

          sentWithPrefix = true;
        } else {
          await bot.telegram.sendDocument(
            target.userId,
            doc.file_id,
            sendOptions
          );
        }
      }

      target.sentCount += 1;

      if (sentWithPrefix) {
        await ctx.reply(`✅ Document with prefix sent to ${target.userId}`);
      } else if (skippedDetectionBecauseLarge) {
        await ctx.reply(
          `✅ Large document sent without prefix to ${target.userId}\nSkipped detection because file is above ${REPORT_DETECTION_MAX_MB} MB.`
        );
      } else {
        await ctx.reply(`✅ Document without prefix sent to ${target.userId}`);
      }
    } catch (err) {
      await ctx.reply("❌ Failed: " + (err?.message || err));
    } finally {
      if (localPath) {
        fs.unlink(localPath, () => {});
      }
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
      `📦 First document received.\n\nNow choose how many files you want to upload.\nYour first document will be used as *file 1* after you choose the number.`,
      {
        parse_mode: "Markdown",
        reply_markup: batchSizeKeyboard().reply_markup
      }
    );
    return;
  }

  if (sub.stage === STAGE_WAIT_BATCH_SIZE) {
    if (sub.pendingInitialDocument) {
      await ctx.reply(
        "📦 Please choose the number of files first. Your first document is already held and will be used as file 1.",
        {
          reply_markup: batchSizeKeyboard().reply_markup
        }
      );
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
      `📦 First document received.\n\nNow choose how many files you want to upload.\nYour first document will be used as *file 1* after you choose the number.`,
      {
        parse_mode: "Markdown",
        reply_markup: batchSizeKeyboard().reply_markup
      }
    );
    return;
  }

  if (sub.stage === STAGE_WAIT_FILE_TYPE) {
    return ctx.reply("⚠️ Please choose *Check* or *Recheck* for the previous file first.", {
      parse_mode: "Markdown",
      reply_markup: typeInlineKeyboard(Boolean(getCurrentPendingFile(sub)?.recheckEligible)).reply_markup
    });
  }

  if (sub.stage === STAGE_WAIT_PHONE || sub.stage === STAGE_WAIT_PAYMENT) {
    return ctx.reply(
      "⚠️ This batch is already in payment state. Please finish payment or tap *Cancel / New submission* to start another batch.",
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
  const storedFile = createStoredFileFromDocument(user.id, doc);

  sub.files.push(storedFile);
  sub.currentFileIndex = sub.files.length - 1;
  sub.stage = STAGE_WAIT_FILE_TYPE;

  await forwardAcceptedDocumentByIds(
    user.id,
    ctx.chat.id,
    ctx.message.message_id,
    user.username || "N/A",
    user.first_name || "",
    user.last_name || ""
  );

  await askForFileType(ctx, sub);
});

// =====================
// PHOTO HANDLER
// =====================
bot.on("photo", async (ctx) => {
  const user = ctx.from;

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
    } catch (err) {
      await ctx.reply("❌ Failed: " + (err?.message || err));
    }
    return;
  }

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  const sub = submissions[user.id];

  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    try {
      await sendAdminMessage(
        `🖼️ Payment proof received\nUser ID: ${user.id}\nUsername: @${safeText(
          user.username || "N/A"
        )}\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}${adminQuickCommands(
          user.id
        )}`
      );
      await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
    } catch {}

    await ctx.reply("✅ Payment proof received.", { reply_markup: mainKeyboard() });
    return;
  }

  if (
    sub &&
    [STAGE_WAIT_BATCH_SIZE, STAGE_WAIT_UPLOADS, STAGE_WAIT_FILE_TYPE].includes(sub.stage)
  ) {
    return ctx.reply("⚠️ Please send your file as a *document*, not as a photo.", {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard()
    });
  }

  await ctx.reply("⚠️ Please tap *Send Document* and upload your file as a *document*, not a photo.", {
    parse_mode: "Markdown",
    reply_markup: startInlineKeyboard().reply_markup
  });
});

// =====================
// TYPE SELECTION
// =====================
bot.action("TYPE_CHECK", async (ctx) => {
  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  await handleFileTypeSelected(ctx, "CHECK");
});

bot.action("TYPE_RECHECK", async (ctx) => {
  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  await handleFileTypeSelected(ctx, "RECHECK");
});

bot.action("DONE_UPLOADING", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

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
  if (!sub) return ctx.answerCbQuery("No active session.");

  sub.stage = STAGE_WAIT_PHONE;
  sub.phone = null;

  await ctx.answerCbQuery("Send new phone");
  await ctx.reply(
    "📞 Send your phone number again (07XXXXXXXX / 01XXXXXXXX).",
    {
      reply_markup: mainKeyboard()
    }
  );
});

bot.action("STK_RESEND", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];
  if (!sub) return ctx.answerCbQuery("No active session.");

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

━━━━━━━━━━━━━━━
_We’re here if you need anything else._`,
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
        `💬 Support message from user\nUser ID: ${user.id}\nUsername: @${safeText(
          user.username || "N/A"
        )}\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\n\n${safeText(
          text
        )}${adminQuickCommands(user.id)}`
      );
      await ctx.reply("✅ Your message has been sent to the Support Team.", {
        reply_markup: mainKeyboard()
      });
    } catch {
      await ctx.reply("❌ Failed to send your message. Please try again.", {
        reply_markup: mainKeyboard()
      });
    }
    return;
  }

  const sub = submissions[user.id];

  if (hasActiveSubmissionForUploads(sub)) {
    await sendAdminMessage(
      `💬 Message from user\nUser ID: ${user.id}\nUsername: @${safeText(
        user.username || "N/A"
      )}\n\n${safeText(text)}${adminQuickCommands(user.id)}`
    );
  }

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  if (sub && sub.stage === STAGE_WAIT_PHONE) {
    const phone254 = normalizePhoneTo254(text);
    if (!phone254) {
      return ctx.reply(
        "❌ Invalid phone. Send like 07XXXXXXXX or 01XXXXXXXX."
      );
    }

    sub.phone = phone254;
    await attemptStkPush(ctx, sub, { mode: "initial" });
    return;
  }

  if (sub && sub.stage === STAGE_WAIT_UPLOADS) {
    return ctx.reply(
      `📄 Please send file ${sub.files.length + 1} of ${
        sub.expectedFiles
      } as a *document*.\nOr tap *Done Uploading* if you are finished early.`,
      {
        parse_mode: "Markdown",
        reply_markup: uploadContinueKeyboard().reply_markup
      }
    );
  }

  if (sub && sub.stage === STAGE_WAIT_FILE_TYPE) {
    return ctx.reply("⚠️ Please choose *Check* or *Recheck* for the last uploaded file first.", {
      parse_mode: "Markdown",
      reply_markup: typeInlineKeyboard(Boolean(getCurrentPendingFile(sub)?.recheckEligible)).reply_markup
    });
  }

  if (sub && sub.stage === STAGE_WAIT_PAYMENT) return;

  if (!sub) {
    return ctx.reply("Tap *Send Document* below to start your submission.", {
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

app.use(bot.webhookCallback("/webhook"));

app.get("/", (req, res) => res.status(200).send("OK"));

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    timeUtc: moment.utc().format(),
    intasendTest: INTASEND_TEST,
    publicBaseUrl: PUBLIC_BASE_URL,
    secretKeyPresent: Boolean(INTASEND_SECRET_KEY),
    secretKeyLooksValid: String(INTASEND_SECRET_KEY).startsWith("ISSecretKey_"),
    publishableKeyPresent: Boolean(INTASEND_PUBLISHABLE_KEY),
    publishableKeyLooksValid: String(INTASEND_PUBLISHABLE_KEY).startsWith("ISPubKey_"),
    pendingSubmissions: Object.keys(submissions).length,
    activePollers: Object.keys(activePollers).length,
    checkHistoryRecords: checkHistory.length,
    recheckWindowHours: 24,
    reportDetectionMaxMb: REPORT_DETECTION_MAX_MB
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
        await sendAdminMessage("⚠️ IntaSend webhook: invalid challenge received.");
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
          `⚠️ IntaSend webhook received but api_ref not matched.\ninvoice_id: ${safeText(
            invoiceId || "N/A"
          )}\nstate: ${safeText(state)}`
        );
        return;
      }

      const ref = getPaymentRef(apiRef);
      if (!ref) {
        await sendAdminMessage(
          `⚠️ IntaSend webhook: unknown api_ref ${safeText(apiRef)}\ninvoice_id: ${safeText(
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
        await markPaymentFailure({
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

// =====================
// START SERVER + TELEGRAM WEBHOOK
// =====================
const port = Number(process.env.PORT || 3000);

app.listen(port, async () => {
  console.log(`Webhook server listening on port ${port}`);
  console.log(`PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}`);
  console.log(`IntaSend Mode: ${INTASEND_TEST ? "TEST" : "LIVE"}`);
  console.log(`Report detection max: ${REPORT_DETECTION_MAX_MB} MB`);
  console.log("Recheck rule: same user + same visible file name within 24 hours");

  const webhookUrl = `${PUBLIC_BASE_URL}/webhook`;

  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Telegram webhook set to: ${webhookUrl}`);
  } catch (e) {
    console.error("Failed to set Telegram webhook:", e?.description || e?.message || e);
  }
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});