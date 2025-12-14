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
 * 23:00–02:59 EAT  =  20:00–23:59 UTC
 * (Active: 03:00–22:59 EAT)
 */
function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm"); // UTC time (00:00–23:59)
  // Inactive from 20:00–23:59 UTC
  return currentTime >= "20:00";
}

// Reply when user writes during inactive hours (but do NOT stop bot)
async function notifyInactivePeriod(ctx) {
  await ctx.reply(
    "⏳ The bot is inactive now. We’ll start processing files again at 6:00 AM EAT.\n" +
      "If urgent, WhatsApp Us on 0701730921."
  );
}

// Detect if text looks like an M-PESA payment message to you
function isLikelyMpesaPayment(text) {
  const t = text.toLowerCase();

  // Flexible: "confirmed", "paid to", your name or till number
  const hasConfirmed = t.includes("confirmed");
  const hasPaidTo = t.includes("paid to");
  const hasYourName =
    t.includes("john") && (t.includes("makokha") || t.includes("wanjala"));
  const hasTillNumber = t.includes("6164915");

  return hasPaidTo && (hasYourName || hasTillNumber) && hasConfirmed;
}

// Webhook URL: Replace with your Render app URL
const webhookUrl = "https://jk-turnitin-telegram-bot-1.onrender.com";

// Set webhook (no polling)
bot.telegram.setWebhook(webhookUrl + "/webhook");

// Bot's welcome message
const WELCOME_MESSAGE = `
Turnitin Reports Bot – JK

What can this bot do?

This bot generates Turnitin plagiarism and AI reports.

✅ Name: John Wanjala
✅ Lipa Na Mpesa Till Number: 6164915

📌 Instructions:
1️⃣ Send your document here as a file (not as a photo).
2️⃣ Send your Mpesa payment text or screenshot.
3️⃣ Wait for confirmation and then receive your report.

💰 Pricing
• Price / check: 80 KES
• Recheck: 80 KES
• No bargaining, please 😊
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
        "`/file <userId> Optional caption`  → next 1 document\n" +
        "`/file2 <userId> Optional caption` → next 2 documents\n" +
        "2. Then upload/send the document(s) in the *next* message(s).\n\n" +
        "Example:\n" +
        "`/file2 7488919090 Here are your Turnitin reports ✅`\n" +
        "Then attach the two DOC/PDF files.",
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
    "📄 Please send your document here as a *file* (not a photo or text).",
    { parse_mode: "Markdown" }
  );
});

bot.hears(KEY_SEND_MPESA, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }
  await ctx.reply(
    "🧾 Please send your *Mpesa payment* text or screenshot.\n\n" +
      "✅ Lipa Na Mpesa Till Number: *6164915*\n" +
      "💰 Price / check: *80 KES*  |  Recheck: *80 KES*",
    { parse_mode: "Markdown" }
  );
});

bot.hears(KEY_HELP, async (ctx) => {
  await ctx.reply(
    "❓ How to use this bot:\n\n" +
      "1️⃣ Tap *Send Document* and upload your DOC/PDF as a file.\n" +
      "2️⃣ Tap *Send Mpesa Text / Screenshot* and send your payment.\n" +
      "3️⃣ Wait for confirmation and your Turnitin report.",
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

// /file <userId> Optional caption  → next 1 document goes to that user
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
    `✅ Got it. The *next document* you send will be delivered to user ${userId}.`,
    { parse_mode: "Markdown" }
  );
});

// /file2 <userId> Optional caption  → next 2 documents go to that user
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
    `✅ Got it. The *next 2 documents* you send will be delivered to user ${userId}.`,
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
        "💰 Price per check: *80 KES* (recheck *80 KES*)\n" +
        "🧠 *GPTZero AI report* also available on request at *40 KES*.\n" +
        "Once payment is confirmed, your Turnitin AI & Plag report will be processed.",
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Error sending auto file-received reply to user:", err.message);
  }
});

/* ---------- PHOTO HANDLER (M-PESA SCREENSHOTS) ---------- */

bot.on("photo", async (ctx) => {
  const user = ctx.from;

  if (isBotInactivePeriod() && user.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }

  // Ignore admin photos for now
  if (user.id === ADMIN_ID) return;

  console.log("🖼️ Photo from user (likely payment screenshot):", user.id);

  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `🖼️ Payment screenshot from user:\n` +
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

  // Short confirmation ONLY for payment screenshots
  try {
    await ctx.reply(
      "✅ We’ve received your payment screenshot.\n\n" +
        "Your payment will be confirmed and your file has been queued for processing.\n" +
        "You’ll receive your Turnitin AI & Plag report here once it’s ready."
    );
  } catch (err) {
    console.error("Error sending payment screenshot confirmation:", err.message);
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

  const paymentLike = isLikelyMpesaPayment(text);

  // 🔔 Always forward client messages to admin
  try {
    const label = paymentLike ? "💰 Payment text" : "💬 Message";
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

  // ✅ Only auto-reply on Mpesa payment-like texts
  if (paymentLike) {
    try {
      await ctx.reply(
        "✅ We’ve received your payment details.\n\n" +
          "Your payment will be confirmed and your file has been queued for processing.\n" +
          "You’ll receive your Turnitin AI & Plag report here once it’s ready."
      );
    } catch (err) {
      console.error("Error sending payment confirmation to user:", err.message);
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
