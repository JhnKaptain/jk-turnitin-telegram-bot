/**
 * JK Turnitin Reports Bot — Telegraf + Express Webhook
 * UPDATED:
 * ✅ Inactive period: 02:00–05:59 EAT
 * ✅ CHECK price: 75 KES
 * ✅ RECHECK price: 70 KES
 * ✅ MIN_PAYMENT_KES: 75 (baseline for new checks)
 * ✅ Cancel button notifies admin
 * ✅ FIX: ONLINE/OFFLINE name sync now RESPECTS Telegram rate limits (429 retry_after)
 * ✅ Admin notifications include copy-ready commands: `/file2 USER_ID` and `/reply USER_ID`
 * ✅ Admin notifications show what message the user is replying to (if applicable)
 * ✅ REMOVED: GPTZero reports/promos (Turnitin only)
 * ✅ Inactive message: "Voice call on WhatsApp 0701730921 if so urgent"
 */

require("dotenv").config();

const { Telegraf } = require("telegraf");
const express = require("express");
const moment = require("moment");

// =====================
// ENV + CONSTANTS
// =====================
const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error("❌ BOT_TOKEN is missing in .env file");
  console.error("Make sure BOT_TOKEN is set in your .env file.");
  process.exit(1);
}

// ⭐ Your Telegram numeric ID from @userinfobot
const ADMIN_ID = 6569201830; // johnkappy

// 💰 Pricing constants (Turnitin only)
const CHECK_PRICE_KES = 75;
const RECHECK_PRICE_KES = 70;

// Minimum payment to auto-accept as valid (baseline for new checks)
const MIN_PAYMENT_KES = 75;

// Webhook URL: Replace with your Render app URL
const WEBHOOK_URL = "https://jk-turnitin-telegram-bot-1.onrender.com";

// Button labels
const KEY_SEND_DOC = "📄 Send Document";
const KEY_SEND_MPESA = "🧾 Send Mpesa Text / Screenshot";
const KEY_CANCEL = "❌ Cancel / New submission";

// Follow-up TTL
const UNDERPAYMENT_FOLLOWUP_TTL_MINUTES = 180; // 3 hours

// =====================
// BOT STATE
// =====================
const bot = new Telegraf(botToken);

// Remember which user the next admin file(s) should go to
// key = admin id, value = { userId, caption, remaining }
const pendingFileTargets = {};

// Track underpayment follow-up state so “recheck/top up” works even if user replies with ONLY that word
// key = user id, value = timestamp (ms)
const pendingUnderpaymentFollowup = {};

// =====================
// HELPERS
// =====================

/**
 * ✅ INACTIVE PERIOD CONFIG (EDIT HERE WHEN YOU WANT TO CHANGE TIMES)
 *
 * Desired inactive period in EAT: 02:00–05:59
 * EAT = UTC+3
 * So UTC inactive = 23:00–02:59
 *
 * NOTE: This is the ONLY place you change inactive time.
 */
const INACTIVE_START_UTC = "23:00"; // 02:00 EAT
const INACTIVE_END_UTC = "03:00"; // 05:59 EAT ends at 02:59 UTC (so end is 03:00 exclusive)

/**
 * Returns true if current UTC time is inside inactive window.
 * Handles windows that cross midnight (like 23:00 → 03:00).
 */
function isTimeInWindowUTC(currentHHMM, startHHMM, endHHMM) {
  // if window does NOT cross midnight
  if (startHHMM < endHHMM) {
    return currentHHMM >= startHHMM && currentHHMM < endHHMM;
  }
  // crosses midnight (e.g., 23:00 to 03:00)
  return currentHHMM >= startHHMM || currentHHMM < endHHMM;
}

/**
 * ✅ Inactive period checker
 */
function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm"); // UTC time (00:00–23:59)
  return isTimeInWindowUTC(currentTime, INACTIVE_START_UTC, INACTIVE_END_UTC);
}

// ✅ Main keyboard helper
function mainKeyboard() {
  return {
    keyboard: [[{ text: KEY_SEND_DOC }], [{ text: KEY_SEND_MPESA }], [{ text: KEY_CANCEL }]],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

// ✅ Safe Markdown reply
async function replyMarkdownSafe(ctx, message, extra = {}) {
  try {
    await ctx.reply(message, { parse_mode: "Markdown", ...extra });
  } catch {
    await ctx.reply(message, { ...extra });
  }
}

// Basic safe text for admin (avoid markdown breaking)
function safeText(s) {
  return (s || "").toString();
}

// Show which message user is replying to (helps you know the exact file/message)
function getReplyContextLine(message) {
  const r = message?.reply_to_message;
  if (!r) return "";

  if (r.document) {
    const name = r.document.file_name || "document";
    return `\n↩️ Replying to: document "${safeText(name)}"`;
  }

  if (r.photo) {
    const cap = r.caption ? ` (caption: "${safeText(r.caption).slice(0, 60)}")` : "";
    return `\n↩️ Replying to: photo${cap}`;
  }

  if (typeof r.text === "string" && r.text.trim()) {
    return `\n↩️ Replying to: "${safeText(r.text).slice(0, 80)}"`;
  }

  if (typeof r.caption === "string" && r.caption.trim()) {
    return `\n↩️ Replying to caption: "${safeText(r.caption).slice(0, 80)}"`;
  }

  return "\n↩️ Replying to a previous message";
}

// Build clickable admin commands
function adminQuickCommands(userId) {
  return (
    "\n\nQuick commands (tap & copy):\n" +
    `\`/file2 ${userId}\`\n` +
    `\`/reply ${userId} \``
  );
}

// Send message to admin (Markdown)
async function sendAdminMessage(text) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Error sending message to admin:", err?.message || err);
  }
}

// =====================
// BOT NAME ONLINE/OFFLINE (RATE-LIMIT SAFE)
// =====================
let lastOnlineStatus = null; // "ONLINE" or "OFFLINE"

// throttle attempts so we don't spam Telegram even on many messages
const BOT_NAME_MIN_ATTEMPT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastBotNameAttemptAt = 0;

// when Telegram returns 429 retry_after, we must wait
let nextBotNameAllowedAt = 0;

function extractRetryAfterSeconds(err) {
  const ra = err?.response?.parameters?.retry_after;
  if (typeof ra === "number") return ra;

  const msg = (err?.message || "").toLowerCase();
  const m = msg.match(/retry after\s+(\d+)/i);
  if (m) return parseInt(m[1], 10);

  return null;
}

async function updateBotNameForCurrentStatus() {
  const now = Date.now();

  if (now < nextBotNameAllowedAt) return;
  if (now - lastBotNameAttemptAt < BOT_NAME_MIN_ATTEMPT_INTERVAL_MS) return;

  const inactive = isBotInactivePeriod();
  const desiredStatus = inactive ? "OFFLINE" : "ONLINE";

  if (lastOnlineStatus === desiredStatus) return;

  const baseName = "JK Turnitin Reports";
  const newName = `${baseName} (${desiredStatus})`;

  lastBotNameAttemptAt = now;

  try {
    await bot.telegram.callApi("setMyName", { name: newName });
    lastOnlineStatus = desiredStatus;
    console.log(`✅ Bot name updated to: ${newName}`);
  } catch (err) {
    const retryAfter = extractRetryAfterSeconds(err);
    if (retryAfter) {
      nextBotNameAllowedAt = Date.now() + retryAfter * 1000;
      console.error(
        `❌ Error updating bot name (429). Will retry after ${retryAfter}s at ${new Date(nextBotNameAllowedAt).toISOString()}`
      );
      return;
    }
    console.error("❌ Error updating bot name:", err?.message || err);
  }
}

// ✅ Keep ONLINE/OFFLINE synced on EVERY incoming update (but throttled + 429-safe)
bot.use(async (ctx, next) => {
  try {
    await updateBotNameForCurrentStatus();
  } catch (err) {
    console.error("Error syncing bot name in middleware:", err?.message || err);
  }
  return next();
});

// Reply when user writes during inactive hours
async function notifyInactivePeriod(ctx) {
  await updateBotNameForCurrentStatus();

  await replyMarkdownSafe(
    ctx,
    "⏳ Turnitin checks are paused right now.\n" +
      "We’ll resume Turnitin reports at *6:00 AM EAT*.\n\n" +
      "If so urgent, *voice call on WhatsApp 0701730921*.",
    { reply_markup: mainKeyboard() }
  );
}

function isUnderpaymentFollowupActive(userId) {
  const ts = pendingUnderpaymentFollowup[userId];
  if (!ts) return false;

  const ageMinutes = (Date.now() - ts) / 60000;
  if (ageMinutes > UNDERPAYMENT_FOLLOWUP_TTL_MINUTES) {
    delete pendingUnderpaymentFollowup[userId];
    return false;
  }
  return true;
}

/**
 * Parse an M-PESA payment SMS
 */
function parseMpesaPayment(text) {
  const t = text || "";
  const lower = t.toLowerCase();

  const hasConfirmed = lower.includes("confirmed");

  const hasPaidOrSent =
    lower.includes("paid to") ||
    lower.includes("sent to") ||
    lower.includes("you have sent") ||
    lower.includes("you have paid");

  const hasYourName = lower.includes("john") && (lower.includes("makokha") || lower.includes("wanjala"));
  const hasTillNumber = lower.includes("6164915");
  const hasYourPhone = lower.includes("0741924396") || lower.includes("741924396");

  const isPaymentToYou = hasConfirmed && hasPaidOrSent && (hasYourName || hasTillNumber || hasYourPhone);

  let amount = null;
  const amountMatch =
    t.match(/confirmed\.?\s*ksh\s*([\d,]+(?:\.\d+)?)/i) || t.match(/\bksh\s*([\d,]+(?:\.\d+)?)/i);

  if (amountMatch) {
    const amountStr = amountMatch[1].replace(/,/g, "");
    const parsed = parseFloat(amountStr);
    if (!Number.isNaN(parsed)) amount = parsed;
  }

  const looksLikeMpesa = hasConfirmed && amount != null;

  return { isPaymentToYou, amount, looksLikeMpesa };
}

// =====================
// WEBHOOK SETUP
// =====================
bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`);

updateBotNameForCurrentStatus();
setInterval(updateBotNameForCurrentStatus, 10 * 60 * 1000);

// =====================
// MESSAGES
// =====================
const WELCOME_MESSAGE = `
JK Turnitin Reports Bot

This bot generates Turnitin plagiarism and AI reports.

✅ Lipa Na Mpesa Till Number: 6164915
📱 If you cannot use the till, you may *Send Money* to 0741924396 (John Wanjala).
   Please use this option *only if the till option fails*.

📌 Instructions:
1️⃣ Send your document here as a file (not as a photo).
2️⃣ Send your Mpesa payment text or screenshot.
3️⃣ Wait for confirmation and then receive your report.

💰 Pricing
• Price / check: ${CHECK_PRICE_KES} KES
• Recheck: ${RECHECK_PRICE_KES} KES
• No bargaining.
`;

// =====================
// /start
// =====================
bot.start(async (ctx) => {
  const user = ctx.from;

  if (isBotInactivePeriod() && user.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }

  if (user.id === ADMIN_ID) {
    await replyMarkdownSafe(
      ctx,
      "👋 Admin mode is ready.\n\n" +
        "📩 *Reply with text as the bot:*\n" +
        "`/reply <userId> <your message>`\n\n" +
        "📁 *Send file(s) as the bot:*\n" +
        "1. Send this command:\n" +
        "`/file <userId> Optional caption`  → next 1 document or photo\n" +
        "`/file2 <userId> Optional caption` → next 2 documents or photos\n" +
        "2. Then upload/send the document(s) or photo(s) in the *next* message(s).\n\n" +
        "Example:\n" +
        "`/file2 7488919090 Here are your Turnitin reports ✅`\n" +
        "Then attach the two DOC/PDF files or screenshots."
    );
    return;
  }

  console.log("🔔 New user started the bot:", user.username || user.first_name);

  await replyMarkdownSafe(ctx, WELCOME_MESSAGE, { reply_markup: mainKeyboard() });

  const header =
    `🔥 New user started the bot:\n` +
    `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
    `Username: @${safeText(user.username || "N/A")}\n` +
    `User ID: ${user.id}` +
    adminQuickCommands(user.id);

  await sendAdminMessage(header);
});

// =====================
// BUTTON HANDLERS
// =====================
bot.hears(KEY_SEND_DOC, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(
    ctx,
    "📄 *How to send your document:*\n\n" +
      "1️⃣ Tap the *📎 attachment* icon in Telegram.\n" +
      "2️⃣ Choose *File* → select your DOC/PDF from your phone or PC.\n" +
      "3️⃣ Send it here as a *file* (please do *not* send as a photo or plain text).",
    { reply_markup: mainKeyboard() }
  );
});

bot.hears(KEY_SEND_MPESA, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(
    ctx,
    "🧾 *How to send your Mpesa payment:*\n\n" +
      "1️⃣ After paying, open your *Mpesa SMS*.\n" +
      "2️⃣ Either:\n" +
      "   • *Forward* the payment SMS here, or\n" +
      "   • Take a *screenshot* and send it here as a photo.\n\n" +
      "✅ Lipa Na Mpesa Till Number: *6164915*\n" +
      "📱 If you cannot use the till, you may *Send Money* to *0741924396* (John Wanjala).\n" +
      "   Please use this option *only if the till option fails*.\n\n" +
      `💰 Price / check: *${CHECK_PRICE_KES} KES*  |  Recheck: *${RECHECK_PRICE_KES} KES*`,
    { reply_markup: mainKeyboard() }
  );
});

// ✅ Cancel button notifies admin
bot.hears(KEY_CANCEL, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  const user = ctx.from;

  delete pendingUnderpaymentFollowup[user.id];

  const msg =
    "❌ User cancelled submission:\n" +
    `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
    `Username: @${safeText(user.username || "N/A")}\n` +
    `User ID: ${user.id}\n` +
    `Time (EAT): ${moment().utcOffset(3).format("YYYY-MM-DD HH:mm")}` +
    adminQuickCommands(user.id);

  await sendAdminMessage(msg);

  await ctx.reply(
    "❌ Current submission cancelled.\n\n" +
      "You can start a fresh submission anytime by sending a new document and payment details.",
    { reply_markup: mainKeyboard() }
  );
});

// =====================
// ADMIN COMMANDS
// =====================
bot.command("reply", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const text = ctx.message.text || "";
  const parts = text.split(" ");

  if (parts.length < 3) return ctx.reply("Usage: /reply <userId> <message>");

  const userId = parts[1];
  const replyText = parts.slice(2).join(" ");

  try {
    await bot.telegram.sendMessage(userId, replyText);
    await ctx.reply(`✅ Message sent to user ${userId}`);
  } catch (err) {
    console.error("Error sending reply:", err.message);
    await ctx.reply("❌ Failed to send message: " + err.message);
  }
});

bot.command("file", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const text = ctx.message.text || "";
  const parts = text.split(" ");

  if (parts.length < 2) return ctx.reply("Usage: /file <userId> Optional caption");

  const userId = parts[1];
  const caption = parts.slice(2).join(" ");

  pendingFileTargets[ADMIN_ID] = { userId, caption, remaining: 1 };

  await replyMarkdownSafe(ctx, `✅ Got it. The *next document or photo* you send will be delivered to user ${userId}.`);
});

bot.command("file2", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const text = ctx.message.text || "";
  const parts = text.split(" ");

  if (parts.length < 2) return ctx.reply("Usage: /file2 <userId> Optional caption");

  const userId = parts[1];
  const caption = parts.slice(2).join(" ");

  pendingFileTargets[ADMIN_ID] = { userId, caption, remaining: 2 };

  await replyMarkdownSafe(ctx, `✅ Got it. The *next 2 documents or photos* you send will be delivered to user ${userId}.`);
});

// =====================
// DOCUMENT HANDLER
// =====================
bot.on("document", async (ctx) => {
  const user = ctx.from;

  if (isBotInactivePeriod() && user.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  // ADMIN: send doc to user
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];
    if (!target) {
      await replyMarkdownSafe(
        ctx,
        "To send this file to a user, first run:\n" + "`/file <userId> Optional caption` or `/file2 <userId> Optional caption`"
      );
      return;
    }

    const { userId, caption } = target;
    const doc = ctx.message.document;

    const remainingAfter = (target.remaining || 1) - 1;

    try {
      await bot.telegram.sendDocument(userId, doc.file_id, { caption: caption || undefined });

      if (remainingAfter <= 0) delete pendingFileTargets[ADMIN_ID];
      else target.remaining = remainingAfter;

      const extra = remainingAfter > 0 ? ` (${remainingAfter} file(s) remaining for this command)` : "";
      await ctx.reply(`✅ File sent to user ${userId}${extra}`);
    } catch (err) {
      console.error("Error sending file to user:", err.message);
      await ctx.reply("❌ Failed to send file: " + err.message);
    }
    return;
  }

  // USER: forward doc to admin
  console.log("📄 Document from user:", user.id);

  const replyContext = getReplyContextLine(ctx.message);

  const header =
    `📨 Document from user:\n` +
    `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
    `Username: @${safeText(user.username || "N/A")}\n` +
    `User ID: ${user.id}` +
    replyContext +
    adminQuickCommands(user.id);

  await sendAdminMessage(header);

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch (err) {
    console.error("Error forwarding document to admin:", err.message);
  }

  await replyMarkdownSafe(
    ctx,
    "📄 We’ve received your file.\n\n" +
      "Now please send your *Mpesa payment* text or screenshot.\n\n" +
      "✅ Lipa Na Mpesa Till Number: *6164915*\n" +
      "📱 If you cannot use the till, you may *Send Money* to *0741924396* (John Wanjala) as a backup.\n" +
      "   Please use this option *only if the till option fails*.\n\n" +
      `💰 Price per check: *${CHECK_PRICE_KES} KES* (recheck *${RECHECK_PRICE_KES} KES*)\n` +
      "Once payment is confirmed, your Turnitin AI & Plag report will be processed.",
    { reply_markup: mainKeyboard() }
  );
});

// =====================
// PHOTO HANDLER
// =====================
bot.on("photo", async (ctx) => {
  const user = ctx.from;

  if (isBotInactivePeriod() && user.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  // ADMIN: send photo to user
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];
    if (!target) {
      await replyMarkdownSafe(
        ctx,
        "To send this photo to a user, first run:\n" + "`/file <userId> Optional caption` or `/file2 <userId> Optional caption`"
      );
      return;
    }

    const { userId, caption } = target;
    const photos = ctx.message.photo || [];
    const largestPhoto = photos[photos.length - 1];

    const remainingAfter = (target.remaining || 1) - 1;

    try {
      await bot.telegram.sendPhoto(userId, largestPhoto.file_id, { caption: caption || undefined });

      if (remainingAfter <= 0) delete pendingFileTargets[ADMIN_ID];
      else target.remaining = remainingAfter;

      const extra = remainingAfter > 0 ? ` (${remainingAfter} file(s) remaining for this command)` : "";
      await ctx.reply(`✅ Photo sent to user ${userId}${extra}`);
    } catch (err) {
      console.error("Error sending photo to user:", err.message);
      await ctx.reply("❌ Failed to send photo: " + err.message);
    }
    return;
  }

  console.log("🖼️ Photo from user (likely screenshot):", user.id);

  const replyContext = getReplyContextLine(ctx.message);

  const header =
    `🖼️ Screenshot/Photo from user:\n` +
    `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
    `Username: @${safeText(user.username || "N/A")}\n` +
    `User ID: ${user.id}` +
    replyContext +
    adminQuickCommands(user.id);

  await sendAdminMessage(header);

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch (err) {
    console.error("Error forwarding photo to admin:", err.message);
  }

  await ctx.reply(
    "🖼️ We’ve received your screenshot.\n\n" +
      "If it is a payment screenshot, it will be reviewed and confirmed shortly.\n" +
      "Once payment is confirmed, your file will be queued for processing and you’ll receive your Turnitin AI & Plag report here.",
    { reply_markup: mainKeyboard() }
  );
});

// =====================
// TEXT HANDLER
// =====================
bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = ctx.message.text || "";

  if (text.startsWith("/")) return;

  if (isBotInactivePeriod() && user.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  if (user.id === ADMIN_ID) return;

  const lowered = text.toLowerCase();
  const mentionsRecheck = lowered.includes("recheck");
  const mentionsTopUp = lowered.includes("top up") || lowered.includes("top-up");

  const { isPaymentToYou, amount, looksLikeMpesa } = parseMpesaPayment(text);

  let label = "💬 Message";
  if (isPaymentToYou) {
    if (amount != null && amount < MIN_PAYMENT_KES) label = "⚠️ Possible underpayment";
    else label = "💰 Payment text";
  } else if (looksLikeMpesa) {
    label = "⚠️ M-PESA text (recipient not matched)";
  }

  const replyContext = getReplyContextLine(ctx.message);

  const adminBody =
    `${label} from user:\n` +
    `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
    `Username: @${safeText(user.username || "N/A")}\n` +
    `User ID: ${user.id}` +
    replyContext +
    adminQuickCommands(user.id) +
    `\n\n${safeText(text)}`;

  await sendAdminMessage(adminBody);

  // Follow-up mode: user replies only "recheck" or "top up"
  if (!looksLikeMpesa && isUnderpaymentFollowupActive(user.id) && (mentionsRecheck || mentionsTopUp)) {
    try {
      if (mentionsRecheck) {
        await replyMarkdownSafe(
          ctx,
          "✅ Recheck noted.\n\n" +
            "Your payment and previous report will be reviewed. Rechecks are valid within *24 hours* of the last check.\n" +
            "Your file will be queued and the updated report sent here in *2–5 minutes* depending on the queue.",
          { reply_markup: mainKeyboard() }
        );
      } else {
        await replyMarkdownSafe(
          ctx,
          "✅ Top-up noted.\n\n" +
            "Your payments and files will be reconciled and queued together.\n" +
            "You’ll receive your report(s) here in *2–5 minutes* depending on the queue.",
          { reply_markup: mainKeyboard() }
        );
      }
    } catch (err) {
      console.error("Error sending recheck/top-up follow-up reply:", err);
    } finally {
      delete pendingUnderpaymentFollowup[user.id];
    }
    return;
  }

  // Payment to you → auto replies
  if (isPaymentToYou) {
    try {
      if (amount != null && amount < MIN_PAYMENT_KES) {
        pendingUnderpaymentFollowup[user.id] = Date.now();

        if (mentionsRecheck) {
          await replyMarkdownSafe(
            ctx,
            "✅ Recheck noted.\n\n" +
              "Your payment and previous report will be reviewed. Rechecks are valid within *24 hours* of the last check.\n" +
              "Your file will be queued and the updated report sent here in *2–5 minutes* depending on the queue.",
            { reply_markup: mainKeyboard() }
          );
          delete pendingUnderpaymentFollowup[user.id];
        } else if (mentionsTopUp) {
          await replyMarkdownSafe(
            ctx,
            "✅ Top-up noted.\n\n" +
              "Your payments and files will be reconciled and queued together.\n" +
              "You’ll receive your report(s) here in *2–5 minutes* depending on the queue.",
            { reply_markup: mainKeyboard() }
          );
          delete pendingUnderpaymentFollowup[user.id];
        } else {
          await replyMarkdownSafe(
            ctx,
            `⚠️ We’ve received your M-PESA message, but it looks like the amount is less than *${CHECK_PRICE_KES} KES*, which is the standard fee per new report.\n\n` +
              `If this payment is for a *recheck* (currently *${RECHECK_PRICE_KES} KES*) or part of a *top-up* for multiple reports, please reply here and confirm.\n` +
              "Otherwise, kindly send the remaining balance so we can proceed with your report.",
            { reply_markup: mainKeyboard() }
          );
        }
      } else {
        delete pendingUnderpaymentFollowup[user.id];

        await replyMarkdownSafe(
          ctx,
          "✅ We’ve received your payment details.\n\n" +
            "Your file has been queued for processing. Reports usually take *2–5 minutes* depending on the queue.\n\n" +
            "ℹ️ Official Turnitin hides the exact AI % and does not show AI highlights when the AI score is below *20%*.\n" +
            'If your AI report only shows "% detected as AI" (without a number), you may need to add more AI-like text to push the score above *20%* and request a *paid recheck* to see AI highlights.',
          { reply_markup: mainKeyboard() }
        );
      }
    } catch (err) {
      console.error("Error sending payment-related auto-reply:", err);
    }
    return;
  }

  // Fallback: looks like M-PESA but recipient not matched
  if (looksLikeMpesa && !isPaymentToYou) {
    await ctx.reply(
      "✅ We’ve received your M-PESA message.\n\n" +
        "If you paid to the correct till/number, we’ll confirm shortly.\n" +
        "If possible, please forward the full SMS (showing the recipient) or send a screenshot for faster confirmation.",
      { reply_markup: mainKeyboard() }
    );
  }
});

// =====================
// EXPRESS SERVER
// =====================
const app = express();
app.use(express.json());
app.use(bot.webhookCallback("/webhook"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Webhook server is listening on port ${port}`));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
