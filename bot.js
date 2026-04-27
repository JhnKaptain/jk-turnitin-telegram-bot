require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const moment = require("moment");

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

const ADMIN_ID = Number(process.env.ADMIN_ID || 6569201830);
const MAX_BATCH_FILES = 5;

const TILL_NUMBER = String(process.env.TILL_NUMBER || "6164915");
const BUSINESS_NAME = String(process.env.BUSINESS_NAME || "JOHNKAPTAIN SOLUTIONS HUB");

const CHECK_PRICE_KES = readIntEnv("CHECK_PRICE_KES", 135);
const RECHECK_PRICE_KES = readIntEnv("RECHECK_PRICE_KES", 130);

const AUTO_VERIFICATION_RESUME_DATE =
  process.env.AUTO_VERIFICATION_RESUME_DATE || "29 April 2026";

const INACTIVE_START_UTC = normalizeHHMM(
  process.env.INACTIVE_START_UTC,
  eatHHMMToUtc(process.env.INACTIVE_START_EAT) || "21:00"
);

const INACTIVE_END_UTC = normalizeHHMM(
  process.env.INACTIVE_END_UTC,
  eatHHMMToUtc(process.env.INACTIVE_END_EAT) || "03:00"
);

// =====================
// STAGES
// =====================
const STAGE_WAIT_BATCH_SIZE = "WAIT_BATCH_SIZE";
const STAGE_WAIT_UPLOADS = "WAIT_UPLOADS";
const STAGE_WAIT_FILE_TYPE = "WAIT_FILE_TYPE";
const STAGE_WAIT_PAYMENT = "WAIT_PAYMENT";
const STAGE_PAID = "PAID";

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
4️⃣ Choose *CHECK* or *RECHECK* for each file
5️⃣ Pay via M-PESA Till and send proof

💰 Pricing
• Check: ${check} KES
• Recheck: ${recheck} KES

⚠️ Automatic verification is temporarily unavailable and will resume on *${AUTO_VERIFICATION_RESUME_DATE}*.
`,
  inactive: `
⏳ Turnitin checks are paused right now.
We’ll resume at *6:45 AM EAT*.

✅ You can still send your document now — it will be received.
⚠️ Payment verification is currently manual.

If urgent, WhatsApp call *0701730921*.
`,
  sendDocHelp:
    `📄 Tap *Send Document* first, choose *1-${MAX_BATCH_FILES}* files, then upload your files one by one as *documents* (DOC/PDF).\n\nPlease don’t send as a photo.`,
  paymentHelp:
    `🧾 Payment help:\n\nAutomatic STK verification is temporarily unavailable and will resume on *${AUTO_VERIFICATION_RESUME_DATE}*.\n\nFor now, pay via M-PESA Buy Goods Till:\n\nTill Number: *${TILL_NUMBER}*\nBusiness Name: *${BUSINESS_NAME}*\n\nAfter payment, send your M-PESA confirmation screenshot or transaction message here.`,
  manualPaymentInstructions: (summary, amount) =>
    `🧾 *Manual Payment Required*\n\n📦 Batch summary\n\n${summary}\n\n💰 Total amount: *KES ${amount}*\n\nPay via M-PESA Buy Goods Till:\n\nTill Number: *${TILL_NUMBER}*\nBusiness Name: *${BUSINESS_NAME}*\nAmount: *KES ${amount}*\n\nAfter payment, send your M-PESA confirmation screenshot or transaction message here.\n\n⚠️ Automatic verification is temporarily unavailable and will resume on *${AUTO_VERIFICATION_RESUME_DATE}*.`,
  proofReceived:
    "✅ Payment proof received.\n\nWe will verify it manually and confirm shortly.",
  paidMsgBatch: (amount, summary) =>
    `✅ Payment confirmed (${amount} KES).\n\n${summary}\n\n⏱ Reports take *5–20 minutes* (queue).`
};

// =====================
// BOT STATE
// =====================
const bot = new Telegraf(BOT_TOKEN);
const submissions = {};
const pendingFileTargets = {};
const supportRequests = {};
let manualPayments = {};

const STORE_FILE = path.join(__dirname, "manualPayments.store.json");

// =====================
// PERSISTENCE
// =====================
function loadStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") manualPayments = parsed;
  } catch (e) {
    console.error("Failed to load manual payment store:", e?.message || e);
  }
}

function saveStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(manualPayments, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save manual payment store:", e?.message || e);
  }
}

function putManualPayment(userId, value) {
  manualPayments[String(userId)] = value;
  saveStore();
}

function updateManualPayment(userId, patch) {
  const key = String(userId);
  manualPayments[key] = {
    ...(manualPayments[key] || {}),
    ...patch,
    updatedAt: Date.now()
  };
  saveStore();
}

function getManualPayment(userId) {
  return manualPayments[String(userId)] || null;
}

loadStore();

setInterval(() => {
  const now = Date.now();
  const cutoff = 7 * 24 * 60 * 60 * 1000;
  let changed = false;

  for (const [userId, value] of Object.entries(manualPayments)) {
    if (value?.createdAt && now - value.createdAt > cutoff) {
      delete manualPayments[userId];
      changed = true;
    }
  }

  if (changed) saveStore();
}, 6 * 60 * 60 * 1000);

// =====================
// HELPERS
// =====================
function safeText(s) {
  return (s || "").toString();
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

function paymentProofKeyboard() {
  return Markup.inlineKeyboard([
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

async function sendAdminMessage(text, extra = {}) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text, {
      parse_mode: "Markdown",
      ...extra
    });
  } catch {
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

function paymentAdminCommands(userId) {
  return `\n\nApprove:\n\`/approvepay ${userId}\`\n\nReject:\n\`/rejectpay ${userId} reason\``;
}

function makeBatchId(userId) {
  return `JK_BATCH_${userId}_${Date.now()}`;
}

function createEmptySubmission() {
  return {
    stage: STAGE_WAIT_BATCH_SIZE,
    expectedFiles: null,
    files: [],
    currentFileIndex: null,
    amount: null,
    batchId: null,
    paid: false,
    createdAt: Date.now(),
    pendingInitialDocument: null,
    proofReceived: false
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

function resetSubmission(userId) {
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
    STAGE_WAIT_FILE_TYPE
  ].includes(sub.stage);
}

function ensureFreshSubmission(userId) {
  if (!submissions[userId]) {
    submissions[userId] = createEmptySubmission();
  }
  return submissions[userId];
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

  await ctx.reply(
    `📄 File Received: *${safeText(file.file_name)}*\n\nFile *${fileNumber}* of *${sub.expectedFiles}*.\nClick the button below for Check or Recheck.`,
    {
      parse_mode: "Markdown",
      reply_markup: typeInlineKeyboard().reply_markup
    }
  );
}

async function moveBatchToManualPaymentStep(ctx, sub) {
  const counts = getSubmissionCounts(sub);

  if (counts.total === 0) {
    await ctx.reply("❌ Please upload at least one file first.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  sub.amount = calculateSubmissionAmount(sub);
  sub.batchId = sub.batchId || makeBatchId(ctx.from.id);
  sub.stage = STAGE_WAIT_PAYMENT;
  sub.currentFileIndex = null;
  sub.proofReceived = false;

  const summary = formatBatchSummary(sub);
  const userId = ctx.from.id;

  putManualPayment(userId, {
    userId,
    batchId: sub.batchId,
    kind: getBatchKindLabel(sub),
    amount: sub.amount,
    summary,
    status: "WAITING_FOR_PROOF",
    proofReceived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tillNumber: TILL_NUMBER,
    businessName: BUSINESS_NAME
  });

  await replyMarkdownSafe(ctx, MESSAGES.manualPaymentInstructions(summary, sub.amount), {
    reply_markup: paymentProofKeyboard().reply_markup
  });

  await sendAdminMessage(
    `🧾 Manual payment requested\nUser: ${userId}\nAmount: KES ${sub.amount}\nTill: ${TILL_NUMBER}\nBusiness: ${BUSINESS_NAME}\nType: ${getBatchKindLabel(
      sub
    )}\n\nWaiting for user payment proof.${paymentAdminCommands(userId)}`
  );
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
    await moveBatchToManualPaymentStep(ctx, sub);
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

async function notifyAdminPaymentProof({ ctx, proofType, text }) {
  const user = ctx.from;
  const userId = user.id;
  const sub = submissions[userId];
  const manual = getManualPayment(userId);

  const amount = sub?.amount || manual?.amount || "N/A";
  const summary = sub ? formatBatchSummary(sub) : manual?.summary || "N/A";
  const kind = sub ? getBatchKindLabel(sub) : manual?.kind || "N/A";

  updateManualPayment(userId, {
    status: "PROOF_RECEIVED",
    proofReceived: true,
    proofType,
    lastProofAt: Date.now()
  });

  if (sub) {
    sub.proofReceived = true;
  }

  await sendAdminMessage(
    `🧾 Manual payment proof received\n\nUser ID: ${userId}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nName: ${safeText(user.first_name)} ${safeText(
      user.last_name
    )}\n\nExpected amount: *KES ${amount}*\nExpected Till: *${TILL_NUMBER}*\nBusiness: *${BUSINESS_NAME}*\nBatch: ${safeText(
      kind
    )}\n\nSummary:\n${safeText(summary)}\n\nProof type: ${safeText(proofType)}${
      text ? `\n\nText proof:\n${safeText(text)}` : ""
    }\n\nPlease verify manually in M-PESA Business records, then approve or reject.${paymentAdminCommands(
      userId
    )}`
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch {}

  await ctx.reply(MESSAGES.proofReceived, {
    reply_markup: mainKeyboard()
  });
}

async function approveManualPayment(adminCtx, userIdRaw) {
  const userId = String(userIdRaw || "").trim();
  if (!userId) return adminCtx.reply("Usage: /approvepay <userId>");

  const sub = submissions[userId];
  const manual = getManualPayment(userId);

  if (!sub && !manual) {
    return adminCtx.reply(`❌ No pending payment record found for ${userId}.`);
  }

  const amount = sub?.amount || manual?.amount || "N/A";
  const summary = sub ? formatBatchSummary(sub) : manual?.summary || "Batch payment";

  updateManualPayment(userId, {
    status: "APPROVED",
    approvedAt: Date.now(),
    approvedBy: adminCtx.from.id
  });

  if (sub) {
    sub.paid = true;
    sub.stage = STAGE_PAID;
  }

  try {
    await bot.telegram.sendMessage(
      userId,
      MESSAGES.paidMsgBatch(amount, summary),
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    await sendAdminMessage(
      `❌ Could not message user ${userId} after manual payment approval. Error: ${safeText(
        e?.message || e
      )}`
    );
  }

  await adminCtx.reply(`✅ Payment approved for ${userId}.`);
  await sendAdminMessage(
    `✅ MANUAL PAYMENT APPROVED\nUser: ${userId}\nAmount: KES ${amount}\nApproved by admin.`
  );

  resetSubmission(userId);
}

async function rejectManualPayment(adminCtx, userIdRaw, reasonRaw) {
  const userId = String(userIdRaw || "").trim();
  const reason = String(reasonRaw || "").trim() || "Payment could not be verified.";

  if (!userId) return adminCtx.reply("Usage: /rejectpay <userId> <reason>");

  const sub = submissions[userId];
  const manual = getManualPayment(userId);

  if (!sub && !manual) {
    return adminCtx.reply(`❌ No pending payment record found for ${userId}.`);
  }

  updateManualPayment(userId, {
    status: "REJECTED",
    rejectedAt: Date.now(),
    rejectedBy: adminCtx.from.id,
    rejectionReason: reason
  });

  try {
    await bot.telegram.sendMessage(
      userId,
      `⚠️ Payment proof could not be verified.\n\nReason: ${reason}\n\nPlease send the correct M-PESA confirmation screenshot or transaction message again.\n\nExpected payment:\nTill Number: ${TILL_NUMBER}\nBusiness Name: ${BUSINESS_NAME}`,
      { reply_markup: mainKeyboard() }
    );
  } catch (e) {
    await sendAdminMessage(
      `❌ Could not message user ${userId} after manual payment rejection. Error: ${safeText(
        e?.message || e
      )}`
    );
  }

  await adminCtx.reply(`⚠️ Payment rejected for ${userId}.`);
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

bot.command("approvepay", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  await approveManualPayment(ctx, parts[1]);
});

bot.command("rejectpay", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  const userId = parts[1];
  const reason = parts.slice(2).join(" ");
  await rejectManualPayment(ctx, userId, reason);
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

// Old STK buttons may still exist in previous chats.
// These handlers prevent stuck callback errors during manual-payment mode.
bot.action("STK_RESEND", async (ctx) => {
  await ctx.answerCbQuery("Manual payment mode");
  await replyMarkdownSafe(
    ctx,
    `⚠️ Automatic STK verification is temporarily unavailable and will resume on *${AUTO_VERIFICATION_RESUME_DATE}*.\n\nPlease pay via Till *${TILL_NUMBER}* and send your M-PESA confirmation screenshot or transaction message.`,
    { reply_markup: mainKeyboard() }
  );
});

bot.action("STK_CHANGE_PHONE", async (ctx) => {
  await ctx.answerCbQuery("Manual payment mode");
  await replyMarkdownSafe(
    ctx,
    `⚠️ Phone number/STK prompt is temporarily disabled.\n\nPlease pay via Till *${TILL_NUMBER}* and send your M-PESA confirmation screenshot or transaction message.`,
    { reply_markup: mainKeyboard() }
  );
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

    sub.files.push({
      file_id: pending.fileId,
      file_name: pending.fileName || `file_${Date.now()}`,
      type: null,
      price: null,
      uploadedAt: Date.now()
    });

    sub.currentFileIndex = sub.files.length - 1;
    sub.stage = STAGE_WAIT_FILE_TYPE;

    sub.pendingInitialDocument = null;

    await ctx.reply(
      `✅ You selected *${count}* file(s).\n\nYour first document has been captured as *file 1*.\nNow choose *Check* or *Recheck* for it.`,
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

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  let sub = submissions[user.id];

  // If user sends document as proof during payment stage
  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    await notifyAdminPaymentProof({
      ctx,
      proofType: "document/screenshot proof",
      text: ""
    });
    return;
  }

  // Fresh start after completed/old state
  if (sub && sub.stage === STAGE_PAID) {
    resetSubmission(user.id);
    sub = null;
  }

  // No session yet: HOLD first document, do not forward yet, ask for batch count
  if (!sub) {
    submissions[user.id] = createEmptySubmission();
    submissions[user.id].pendingInitialDocument = {
      userId: user.id,
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id,
      fileId: ctx.message.document.file_id,
      fileName: ctx.message.document.file_name || `file_${Date.now()}`,
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

  // Waiting for batch size and first document already held
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

    sub.pendingInitialDocument = {
      userId: user.id,
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id,
      fileId: ctx.message.document.file_id,
      fileName: ctx.message.document.file_name || `file_${Date.now()}`,
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
      reply_markup: typeInlineKeyboard().reply_markup
    });
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

  // ADMIN SENDING PHOTO REPORTS
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

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  const sub = submissions[user.id];

  // Payment proof screenshot
  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    await notifyAdminPaymentProof({
      ctx,
      proofType: "photo/screenshot proof",
      text: ""
    });
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
  await moveBatchToManualPaymentStep(ctx, sub);
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
// TEXT HANDLER
// =====================
bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = (ctx.message.text || "").trim();

  if (text.startsWith("/")) return;
  if (user.id === ADMIN_ID) return;

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

  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    await notifyAdminPaymentProof({
      ctx,
      proofType: "text transaction message",
      text
    });
    return;
  }

  // Forward user texts only when there is an active upload/file-selection session
  if (hasActiveSubmissionForUploads(sub)) {
    await sendAdminMessage(
      `💬 Message from user\nUser ID: ${user.id}\nUsername: @${safeText(
        user.username || "N/A"
      )}\n\n${safeText(text)}${adminQuickCommands(user.id)}`
    );
  }

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

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
      reply_markup: typeInlineKeyboard().reply_markup
    });
  }

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

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(bot.webhookCallback("/webhook"));

app.get("/", (req, res) => res.status(200).send("OK"));

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    mode: "MANUAL_TILL_PAYMENT",
    manualPayment: true,
    automaticVerificationResumeDate: AUTO_VERIFICATION_RESUME_DATE,
    tillNumber: TILL_NUMBER,
    businessName: BUSINESS_NAME,
    timeUtc: moment.utc().format(),
    publicBaseUrl: PUBLIC_BASE_URL,
    pendingSubmissions: Object.keys(submissions).length,
    pendingManualPayments: Object.keys(manualPayments).length
  });
});

// Old IntaSend endpoint kept harmless during temporary manual mode.
// It simply acknowledges anything sent there so external retries do not crash the app.
app.get("/intasend/webhook", (req, res) => {
  res.status(200).send("Manual payment mode active");
});

app.post("/intasend/webhook", (req, res) => {
  res.status(200).json({
    ok: true,
    ignored: true,
    mode: "MANUAL_TILL_PAYMENT"
  });
});

// =====================
// START SERVER + TELEGRAM WEBHOOK
// =====================
const port = Number(process.env.PORT || 3000);

app.listen(port, async () => {
  console.log(`Webhook server listening on port ${port}`);
  console.log(`PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}`);
  console.log(`Payment Mode: MANUAL_TILL_PAYMENT`);
  console.log(`Till Number: ${TILL_NUMBER}`);
  console.log(`Business Name: ${BUSINESS_NAME}`);
  console.log(`Automatic verification resumes on: ${AUTO_VERIFICATION_RESUME_DATE}`);

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