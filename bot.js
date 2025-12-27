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

// Button labels
const KEY_SEND_DOC = "📄 Send Document";
const KEY_SEND_MPESA = "🧾 Send Mpesa Text / Screenshot";
const KEY_HELP = "❓ Help";

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

// Reply when user writes during inactive hours (but do NOT stop bot)
async function notifyInactivePeriod(ctx) {
  await ctx.reply(
    "⏳ Turnitin checks are paused right now.\n" +
      "We’ll resume Turnitin reports at *6:00 AM EAT*.\n\n" +
      `🧠 In the meantime, *GPTZero AI & Plagiarism reports* are available at *${GPTZERO_PRICE_KES} KES*.\n` +
      "If urgent, WhatsApp us on *0701730921*.",
    { parse_mode: "Markdown" }
  );
}

// 🔍 Parse an M-PESA payment SMS: detect if it's to you and extract amount
function parseMpesaPayment(text) {
  const lower = text.toLowerCase();

  const hasConfirmed = lower.includes("confirmed");
  const hasPaidTo = lower.includes("paid to");
  const hasYourName =
    lower.includes("john") &&
    (lower.includes("makokha") || lower.includes("wanjala"));
  const hasTillNumber = lower.includes("6164915");

  const isPaymentToYou = hasConfirmed && hasPaidTo && (hasYourName || hasTillNumber);

  // Extract the amount right after "Confirmed. Ksh ..."
  // Example: "TLGLN14EOK Confirmed. Ksh 100.00 paid to JOHN Makokha..."
  let amount = null;
  const amountMatch = text.match(/confirmed\.\s*ksh\s*([\d,]+(?:\.\d+)?)/i);
  if (amountMatch) {
    const amountStr = amountMatch[1].replace(/,/g, "");
    const parsed = parseFloat(amountStr);
    if (!isNaN(parsed)) {
      amount = parsed;
    }
  }

  return { isPaymentToYou, amount };
}

// Webhook URL: Replace with your Render app URL
const webhookUrl = "https://jk-turnitin-telegram-bot-1.onrender.com";

// Set webhook (no polling)
bot.telegram.setWebhook(webhookUrl + "/webhook");

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
    await ctx.reply(
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
        "Then attach the two DOC/PDF files or screenshots.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  console.log("🔔 New user started the bot:", user.username || user.first_name);

  // Show welcome + custom keyboard
  await ctx.reply(WELCOME_MESSAGE, {
    parse_mode: "Markdown",
    reply_markup: {
      keyboard: [
        [{ text: KEY_SEND_DOC }],
        [{ text: KEY_SEND_MPESA }],
        [{ text: KEY_HELP }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  });

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
  await ctx.reply(
    "📄 *How to send your document:*\n\n" +
      "1️⃣ Tap the *📎 attachment* icon in Telegram.\n" +
      "2️⃣ Choose *File* → select your DOC/PDF from your phone or PC.\n" +
      "3️⃣ Send it here as a *file* (please do *not* send as a photo or plain text).",
    { parse_mode: "Markdown" }
  );
});

bot.hears(KEY_SEND_MPESA, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }
  await ctx.reply(
    "🧾 *How to send your Mpesa payment:*\n\n" +
      "1️⃣ After paying, open your *Mpesa SMS*.\n" +
      "2️⃣ Either:\n" +
      "   • *Forward* the payment SMS here, or\n" +
      "   • Take a *screenshot* and send it here as a photo.\n\n" +
      "✅ Lipa Na Mpesa Till Number: *6164915*\n" +
      "📱 If you cannot use the till, you may *Send Money* to *0741924396* (John Wanjala).\n" +
      "   Please use this option *only if the till option fails*.\n\n" +
      `💰 Price / check: *${CHECK_PRICE_KES} KES*  |  Recheck: *${RECHECK_PRICE_KES} KES*`,
    { parse_mode: "Markdown" }
  );
});

bot.hears(KEY_HELP, async (ctx) => {
  await ctx.reply(
    "❓ *How to use this bot:*\n\n" +
      "📄 *Sending documents:*\n" +
      "• Tap *Send Document*.\n" +
      "• Tap the *📎 attachment* icon → *File* → choose your DOC/PDF → send.\n\n" +
      "🧾 *Sending Mpesa details:*\n" +
      "• Tap *Send Mpesa Text / Screenshot*.\n" +
      "• Forward the Mpesa SMS *or* send a clear screenshot of the payment.\n" +
      "• Preferred: *Till 6164915*.\n" +
      "• If you cannot pay via till, you may *Send Money* to *0741924396* (John Wanjala) as a backup option only.\n\n" +
      "💬 *Chat & questions:*\n" +
      "• Just type your message here normally.\n" +
      "• The admin will reply using the bot.\n\n" +
      "After payment is confirmed, your Turnitin report (and optional GPTZero AI report) will be processed and sent here.",
    { parse_mode: "Markdown" }
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

  await ctx.reply(
    `✅ Got it. The *next document or photo* you send will be delivered to user ${userId}.`,
    { parse_mode: "Markdown" }
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

  await ctx.reply(
    `✅ Got it. The *next 2 documents or photos* you send will be delivered to user ${userId}.`,
    { parse_mode: "Markdown" }
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
      await ctx.reply(
        "To send this file to a user, first run:\n" +
          "`/file <userId> Optional caption` or `/file2 <userId> Optional caption`",
        { parse_mode: "Markdown" }
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

      // Update or clear the target
      if (remainingAfter <= 0) {
        delete pendingFileTargets[ADMIN_ID];
      } else {
        target.remaining = remainingAfter;
      }

      const extra =
        remainingAfter > 0
          ? ` (${remainingAfter} file(s) remaining for this command)`
          : "";
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

    await bot.telegram.forwardMessage(
      ADMIN_ID,
      ctx.chat.id,
      ctx.message.message_id
    );
  } catch (err) {
    console.error("Error forwarding document to admin:", err.message);
  }

  // Ask user to send payment + mention GPTZero
  try {
    await ctx.reply(
      "📄 We’ve received your file.\n\n" +
        "Now please send your *Mpesa payment* text or screenshot.\n\n" +
        "✅ Lipa Na Mpesa Till Number: *6164915*\n" +
        "📱 If you cannot use the till, you may *Send Money* to *0741924396* (John Wanjala) as a backup.\n" +
        "   Please use this option *only if the till option fails*.\n\n" +
        `💰 Price per check: *${CHECK_PRICE_KES} KES* (recheck *${RECHECK_PRICE_KES} KES*)\n` +
        `🧠 *GPTZero AI report* also available on request at *${GPTZERO_PRICE_KES} KES*.\n` +
        "Once payment is confirmed, your Turnitin AI & Plag report will be processed.",
      { parse_mode: "Markdown" }
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

  // ADMIN sending photo(s) to a user (same targeting as /file and /file2)
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];

    if (!target) {
      await ctx.reply(
        "To send this photo to a user, first run:\n" +
          "`/file <userId> Optional caption` or `/file2 <userId> Optional caption`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const { userId, caption } = target;
    const photos = ctx.message.photo || [];
    // Use the highest resolution photo (last in the array)
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
        remainingAfter > 0
          ? ` (${remainingAfter} file(s) remaining for this command)`
          : "";
      await ctx.reply(`✅ Photo sent to user ${userId}${extra}`);
    } catch (err) {
      console.error("Error sending photo to user:", err.message);
      await ctx.reply("❌ Failed to send photo: " + err.message);
    }

    return;
  }

  // USER photos (likely payment screenshots) -> forward to admin + neutral reply
  console.log("🖼️ Photo from user (likely screenshot):", user.id);

  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `🖼️ Screenshot from user:\n` +
        `Name: ${user.first_name || ""} ${user.last_name || ""}\n` +
        `Username: @${user.username || "N/A"}\n` +
        `User ID: ${user.id}`
    );

    await bot.telegram.forwardMessage(
      ADMIN_ID,
      ctx.chat.id,
      ctx.message.message_id
    );
  } catch (err) {
    console.error("Error forwarding photo to admin:", err.message);
  }

  // Neutral confirmation for ANY screenshot (no automatic "payment received")
  try {
    await ctx.reply(
      "🖼️ We’ve received your screenshot.\n\n" +
        "If it is a payment screenshot, it will be reviewed and confirmed shortly.\n" +
        "Once payment is confirmed, your file will be queued for processing and you’ll receive your Turnitin AI & Plag report here."
    );
  } catch (err) {
    console.error("Error sending screenshot confirmation to user:", err.message);
  }
});

/* ---------- TEXT HANDLER (M-PESA SMS + CHAT) ---------- */

bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = ctx.message.text || "";

  // Let command handlers (/start, /reply, /file, /file2) handle commands
  if (text.startsWith("/")) return;

  if (isBotInactivePeriod() && user.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }

  // Ignore admin free text; admin uses /reply and file commands
  if (user.id === ADMIN_ID) return;

  const { isPaymentToYou, amount } = parseMpesaPayment(text);

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
  }

  // 🔔 Always forward client messages to admin
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

  // ✅ Auto-replies only for messages that look like payment to you
  if (isPaymentToYou) {
    try {
      if (underpayment) {
        await ctx.reply(
          `⚠️ We’ve received your M-PESA message, but it looks like the amount is less than *${CHECK_PRICE_KES} KES*, which is the standard fee per new report.\n\n` +
            `If this payment is for a *recheck* (currently *${RECHECK_PRICE_KES} KES*) or part of a *top-up* for multiple reports, please reply here and confirm.\n` +
            "Otherwise, kindly send the remaining balance so we can proceed with your report."
        );
      } else {
        await ctx.reply(
          "✅ We’ve received your payment details.\n\n" +
            "Your payment will be confirmed and your file has been queued for processing.\n" +
            "Reports usually take *2–5 minutes* depending on the queue.\n" +
            "You’ll receive your Turnitin AI & Plag report here once it’s ready."
        );
      }
    } catch (err) {
      console.error("Error sending payment-related auto-reply to user:", err.message);
    }
  }
  // For non-payment messages: no auto-reply. Admin will respond via /reply.
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
