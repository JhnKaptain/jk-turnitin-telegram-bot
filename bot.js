require("dotenv").config();
const { Telegraf } = require("telegraf");
const express = require("express");
const moment = require("moment");

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error("❌ BOT_TOKEN is missing in .env file");
  console.error("Make sure BOT_TOKEN is set in your .env file.");
  process.exit(1);
}

// ⭐ Your Telegram numeric ID from @userinfobot
const ADMIN_ID = 6569201830; // johnkappy

// 💰 Pricing constants
const CHECK_PRICE_KES = 80;
const RECHECK_PRICE_KES = 70;
const GPTZERO_PRICE_KES = 40;
// Minimum payment to auto-accept as valid (baseline 80 KES)
const MIN_PAYMENT_KES = 80;

const bot = new Telegraf(botToken);

// Remember which user the next admin file(s) should go to
// key = admin id, value = { userId, caption, remaining }
const pendingFileTargets = {};

// ✅ Track underpayment follow-up state so “recheck/top up” works even if user replies with ONLY that word
// key = user id, value = timestamp (ms)
const pendingUnderpaymentFollowup = {};
const UNDERPAYMENT_FOLLOWUP_TTL_MINUTES = 180; // auto-expire after 3 hours

// Button labels
const KEY_SEND_DOC = "📄 Send Document";
const KEY_SEND_MPESA = "🧾 Send Mpesa Text / Screenshot";
const KEY_CANCEL = "❌ Cancel / New submission";

/**
 * Inactive period:
 * 02:30–05:59 EAT  =  23:30–02:59 UTC
 * (Active: 06:00–02:29 EAT)
 */
function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm"); // UTC time (00:00–23:59)
  // Inactive from 23:30–23:59 UTC OR 00:00–02:59 UTC
  return currentTime >= "23:30" || currentTime < "03:00";
}

// ✅ Main keyboard helper (ensures buttons don’t “disappear” after replies)
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

// ✅ Safe Markdown reply (prevents Telegram Markdown parse errors from killing the reply)
async function replyMarkdownSafe(ctx, message, extra = {}) {
  try {
    await ctx.reply(message, { parse_mode: "Markdown", ...extra });
  } catch (err) {
    // fallback without parse_mode
    await ctx.reply(message, { ...extra });
  }
}

// 🔄 Auto-update bot name to show ONLINE / OFFLINE in Telegram
let lastOnlineStatus = null; // "ONLINE" or "OFFLINE"

async function updateBotNameForCurrentStatus() {
  const inactive = isBotInactivePeriod();
  const desiredStatus = inactive ? "OFFLINE" : "ONLINE";

  if (lastOnlineStatus === desiredStatus) return; // no change needed

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
      "We’ll resume Turnitin reports at *6:00 AM EAT*.\n\n" +
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
 * 🔍 Parse an M-PESA payment SMS: detect if it's to you and extract amount.
 * FIX: supports both "paid to" (till) AND "sent to" (send money), plus phone number.
 */
function parseMpesaPayment(text) {
  const t = text || "";
  const lower = t.toLowerCase();

  // Must look like an M-PESA confirmation
  const hasConfirmed = lower.includes("confirmed");

  // Accept common variants (till vs send money)
  const hasPaidOrSent =
    lower.includes("paid to") ||
    lower.includes("sent to") ||
    lower.includes("you have sent") ||
    lower.includes("you have paid");

  // Recipient identifiers
  const hasYourName =
    lower.includes("john") &&
    (lower.includes("makokha") || lower.includes("wanjala"));

  const hasTillNumber = lower.includes("6164915");
  const hasYourPhone =
    lower.includes("0741924396") || lower.includes("741924396"); // with/without leading 0

  const isPaymentToYou =
    hasConfirmed && hasPaidOrSent && (hasYourName || hasTillNumber || hasYourPhone);

  // Amount extraction (more tolerant)
  let amount = null;
  const amountMatch =
    t.match(/confirmed\.?\s*ksh\s*([\d,]+(?:\.\d+)?)/i) ||
    t.match(/\bksh\s*([\d,]+(?:\.\d+)?)/i);

  if (amountMatch) {
    const amountStr = amountMatch[1].replace(/,/g, "");
    const parsed = parseFloat(amountStr);
    if (!isNaN(parsed)) amount = parsed;
  }

  // Helpful to know if it’s an M-PESA-ish SMS even if recipient didn’t match
  const looksLikeMpesa = hasConfirmed && amount != null;

  return { isPaymentToYou, amount, looksLikeMpesa };
}

// Webhook URL: Replace with your Render app URL
const webhookUrl = "https://jk-turnitin-telegram-bot-1.onrender.com";

// Set webhook (no polling)
bot.telegram.setWebhook(webhookUrl + "/webhook");

// Keep bot name in sync with ONLINE/OFFLINE status
updateBotNameForCurrentStatus();
setInterval(updateBotNameForCurrentStatus, 10 * 60 * 1000); // every 10 minutes

// Bot's welcome message
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

// /start
bot.start(async (ctx) => {
  const user = ctx.from;

  // Users are blocked during inactive period, admin is not
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

  // Show welcome + custom keyboard (Help removed, Cancel added)
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

/* ---------- BUTTON HANDLERS ---------- */

bot.hears(KEY_SEND_DOC, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }
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
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }
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

// Cancel button handler
bot.hears(KEY_CANCEL, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }

  // clear any pending “underpayment follow-up”
  delete pendingUnderpaymentFollowup[ctx.from.id];

  await ctx.reply(
    "❌ Current submission cancelled.\n\n" +
      "You can start a fresh submission anytime by sending a new document and payment details.",
    { reply_markup: mainKeyboard() }
  );
});

/* ---------- ADMIN COMMANDS ---------- */

// /reply <userId> <message>
bot.command("reply", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const text = ctx.message.text || "";
  const parts = text.split(" ");

  if (parts.length < 3) {
    await ctx.reply("Usage: /reply <userId> <message>");
    return;
  }

  const userId = parts[1];
  const replyText = parts.slice(2).join(" ");

  try {
    await bot.telegram.sendMessage(userId, replyText);
    await ctx.reply("✅ Message sent to user " + userId);
  } catch (err) {
    console.error("Error sending reply:", err.message);
    await ctx.reply("❌ Failed to send message: " + err.message);
  }
});

// /file <userId> Optional caption  → next 1 document or photo goes to that user
bot.command("file", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const text = ctx.message.text || "";
  const parts = text.split(" ");

  if (parts.length < 2) {
    await ctx.reply("Usage: /file <userId> Optional caption");
    return;
  }

  const userId = parts[1];
  const caption = parts.slice(2).join(" ");

  pendingFileTargets[ADMIN_ID] = { userId, caption, remaining: 1 };

  await replyMarkdownSafe(
    ctx,
    `✅ Got it. The *next document or photo* you send will be delivered to user ${userId}.`
  );
});

// /file2 <userId> Optional caption  → next 2 documents or photos go to that user
bot.command("file2", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const text = ctx.message.text || "";
  const parts = text.split(" ");

  if (parts.length < 2) {
    await ctx.reply("Usage: /file2 <userId> Optional caption");
    return;
  }

  const userId = parts[1];
  const caption = parts.slice(2).join(" ");

  pendingFileTargets[ADMIN_ID] = { userId, caption, remaining: 2 };

  await replyMarkdownSafe(
    ctx,
    `✅ Got it. The *next 2 documents or photos* you send will be delivered to user ${userId}.`
  );
});

/* ---------- DOCUMENT HANDLER ---------- */

bot.on("document", async (ctx) => {
  const user = ctx.from;

  // For normal users, respect inactive period
  if (isBotInactivePeriod() && user.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }

  // ADMIN sending file(s) to a user
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
    const remainingBefore = target.remaining || 1;
    const remainingAfter = remainingBefore - 1;

    try {
      await bot.telegram.sendDocument(userId, doc.file_id, {
        caption: caption || undefined
      });

      if (remainingAfter <= 0) {
        delete pendingFileTargets[ADMIN_ID];
      } else {
        target.remaining = remainingAfter;
      }

      const extra =
        remainingAfter > 0 ? ` (${remainingAfter} file(s) remaining for this command)` : "";
      await ctx.reply(`✅ File sent to user ${userId}${extra}`);
    } catch (err) {
      console.error("Error sending file to user:", err.message);
      await ctx.reply("❌ Failed to send file: " + err.message);
    }

    return;
  }

  // USER sending a file -> forward to admin + auto reply
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

  // Ask user to send payment + mention GPTZero (kept same flow/wording)
  try {
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
  } catch (err) {
    console.error("Error sending auto file-received reply to user:", err.message);
  }
});

/* ---------- PHOTO HANDLER (USER SCREENSHOTS + ADMIN SENDING PHOTOS) ---------- */

bot.on("photo", async (ctx) => {
  const user = ctx.from;

  if (isBotInactivePeriod() && user.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }

  // ADMIN sending photo(s) to a user
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
    const remainingBefore = target.remaining || 1;
    const remainingAfter = remainingBefore - 1;

    try {
      await bot.telegram.sendPhoto(userId, largestPhoto.file_id, {
        caption: caption || undefined
      });

      if (remainingAfter <= 0) {
        delete pendingFileTargets[ADMIN_ID];
      } else {
        target.remaining = remainingAfter;
      }

      const extra =
        remainingAfter > 0 ? ` (${remainingAfter} file(s) remaining for this command)` : "";
      await ctx.reply(`✅ Photo sent to user ${userId}${extra}`);
    } catch (err) {
      console.error("Error sending photo to user:", err.message);
      await ctx.reply("❌ Failed to send photo: " + err.message);
    }

    return;
  }

  // USER photos -> forward to admin + neutral reply
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

  try {
    await ctx.reply(
      "🖼️ We’ve received your screenshot.\n\n" +
        "If it is a payment screenshot, it will be reviewed and confirmed shortly.\n" +
        "Once payment is confirmed, your file will be queued for processing and you’ll receive your Turnitin AI & Plag report here.",
      { reply_markup: mainKeyboard() }
    );
  } catch (err) {
    console.error("Error sending screenshot confirmation to user:", err.message);
  }
});

/* ---------- TEXT HANDLER (M-PESA SMS + CHAT) ---------- */

bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = ctx.message.text || "";

  // Let command handlers handle commands
  if (text.startsWith("/")) return;

  if (isBotInactivePeriod() && user.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }

  // Ignore admin free text
  if (user.id === ADMIN_ID) return;

  const lowered = text.toLowerCase();
  const mentionsRecheck = lowered.includes("recheck");
  const mentionsTopUp = lowered.includes("top up") || lowered.includes("top-up");

  // Parse payment
  const { isPaymentToYou, amount, looksLikeMpesa } = parseMpesaPayment(text);

  // Decide label for admin message
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

  // Always forward client messages to admin
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

  // ✅ NEW: If user previously got the underpayment alert and now replies ONLY “recheck” or “top up”
  // This makes the recheck/top-up autoresponses work even without being inside the M-PESA SMS.
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

  // ✅ Auto-replies for payments to you
  if (isPaymentToYou) {
    try {
      if (underpayment) {
        // Keep the follow-up “armed” so the next “recheck/top up” message works
        pendingUnderpaymentFollowup[user.id] = Date.now();

        // If the underpayment message itself includes “recheck/top up”, respond immediately
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
        // Payment OK: clear any pending follow-up
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
      console.error("Error sending payment-related auto-reply to user:", err);
    }
    return;
  }

  // ✅ Fallback: if it looks like M-PESA but recipient didn’t match, still respond (so 80+ won’t be “silent”)
  if (looksLikeMpesa && !isPaymentToYou) {
    try {
      await ctx.reply(
        "✅ We’ve received your M-PESA message.\n\n" +
          "If you paid to the correct till/number, we’ll confirm shortly.\n" +
          "If possible, please forward the full SMS (showing the recipient) or send a screenshot for faster confirmation.",
        { reply_markup: mainKeyboard() }
      );
    } catch (err) {
      console.error("Error sending fallback mpesa auto-reply:", err);
    }
  }

  // For non-payment messages: no auto-reply.
});

/* ---------- EXPRESS WEBHOOK SERVER ---------- */

const app = express();
app.use(express.json()); // so Telegraf sees req.body
app.use(bot.webhookCallback("/webhook"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Webhook server is listening on port ${port}`);
});

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
