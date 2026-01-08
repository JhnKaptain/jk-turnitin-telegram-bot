/**
 * JK Turnitin Reports Bot — Telegraf + Express Webhook
 * UPDATED:
 * ✅ Inactive period now: 03:00 AM – 09:00 PM EAT
 * ✅ CHECK + RECHECK price: 100 KES
 * ✅ MIN_PAYMENT_KES: 100
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

// 💰 Pricing constants
const CHECK_PRICE_KES = 100;
const RECHECK_PRICE_KES = 100;
const GPTZERO_PRICE_KES = 40;

// Minimum payment to auto-accept as valid
const MIN_PAYMENT_KES = 100;

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
 * ✅ Inactive period (UPDATED):
 * 03:00–21:00 EAT  =  00:00–18:00 UTC
 * EAT = UTC+3
 *
 * (Active: 21:01–02:59 EAT)  => 18:01–23:59 UTC
 */
function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm"); // UTC time (00:00–23:59)
  // Inactive from 00:00–18:00 UTC (inclusive start, inclusive 18:00)
  return currentTime >= "00:00" && currentTime <= "18:00";
}

// Main keyboard helper
function mainKeyboard() {
  return {
    keyboard: [[{ text: KEY_SEND_DOC }], [{ text: KEY_SEND_MPESA }], [{ text: KEY_CANCEL }]],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

// Safe Markdown reply
async function replyMarkdownSafe(ctx, message, extra = {}) {
  try {
    await ctx.reply(message, { parse_mode: "Markdown", ...extra });
  } catch {
    await ctx.reply(message, { ...extra });
  }
}

// Bot name ONLINE/OFFLINE
let lastOnlineStatus = null; // "ONLINE" | "OFFLINE"

async function updateBotNameForCurrentStatus() {
  const inactive = isBotInactivePeriod();
  const desiredStatus = inactive ? "OFFLINE" : "ONLINE";
  if (lastOnlineStatus === desiredStatus) return;

  const baseName = "JK Turnitin Reports";
  const newName = `${baseName} (${desiredStatus})`;

  try {
    await bot.telegram.setMyName(newName);
    lastOnlineStatus = desiredStatus;
    console.log(`✅ Bot name updated to: ${newName}`);
  } catch (err) {
    console.error("Error updating bot name:", err.message);
  }
}

// Reply when user writes during inactive hours (but do NOT stop bot)
async function notifyInactivePeriod(ctx) {
  await replyMarkdownSafe(
    ctx,
    "⏳ Turnitin checks are paused right now.\n" +
      "We’ll resume Turnitin reports at *9:01 PM EAT*.\n\n" +
      `🧠 In the meantime, *GPTZero AI & Plagiarism reports* are available at *${GPTZERO_PRICE_KES} KES*.\n` +
      "If urgent, WhatsApp us on *0701730921*.",
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

What can this bot do?

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

  // Users blocked during inactive period, admin is not
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

  // Notify admin
  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `🔥 New user started the bot:\n` +
        `Name: ${user.first_name || ""} ${user.last_name || ""}\n` +
        `Username: @${user.username || "N/A"}\n` +
        `User ID: ${user.id}`
    );
  } catch (err) {
    console.error("Error notifying admin about new user:", err.message);
  }
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

bot.hears(KEY_CANCEL, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  delete pendingUnderpaymentFollowup[ctx.from.id];

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

// /file <userId> Optional caption
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

// /file2 <userId> Optional caption
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
        "To send this file to a user, first run:\n" +
          "`/file <userId> Optional caption` or `/file2 <userId> Optional caption`"
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

  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `📨 Document from user:\n` +
        `Name: ${user.first_name || ""} ${user.last_name || ""}\n` +
        `Username: @${user.username || "N/A"}\n` +
        `User ID: ${user.id}`
    );

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
      `🧠 *GPTZero AI report* also available on request at *${GPTZERO_PRICE_KES} KES*.\n` +
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
        "To send this photo to a user, first run:\n" +
          "`/file <userId> Optional caption` or `/file2 <userId> Optional caption`"
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

  // USER: forward photo to admin
  console.log("🖼️ Photo from user (likely screenshot):", user.id);

  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `🖼️ Screenshot from user:\n` +
        `Name: ${user.first_name || ""} ${user.last_name || ""}\n` +
        `Username: @${user.username || "N/A"}\n` +
        `User ID: ${user.id}`
    );

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
  let underpayment = false;

  if (isPaymentToYou) {
    if (amount != null && amount < MIN_PAYMENT_KES) {
      label = "⚠️ Possible underpayment";
      underpayment = true;
    } else {
      label = "💰 Payment text";
    }
  } else if (looksLikeMpesa) {
    label = "⚠️ M-PESA text (recipient not matched)";
  }

  // forward all client messages to admin
  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `${label} from user:\n` +
        `Name: ${user.first_name || ""} ${user.last_name || ""}\n` +
        `Username: @${user.username || "N/A"}\n` +
        `User ID: ${user.id}\n\n` +
        text
    );
  } catch (err) {
    console.error("Error forwarding text to admin:", err.message);
  }

  // If user previously got the underpayment alert and now replies ONLY “recheck” or “top up”
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
      if (underpayment) {
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

  // Looks like M-PESA but recipient didn’t match
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
