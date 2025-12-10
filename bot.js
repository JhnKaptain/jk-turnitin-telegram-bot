// bot.js
require("dotenv").config();
const { Telegraf } = require("telegraf");
const http = require("http"); // tiny HTTP server for Render

const botToken = process.env.BOT_TOKEN;

if (!botToken) {
  console.error("❌ BOT_TOKEN is missing in .env file");
  process.exit(1);
}

// ⭐ Your Telegram numeric ID from @userinfobot
const ADMIN_ID = 6569201830; // johnkappy

const bot = new Telegraf(botToken);

// Remember which user the next admin file should go to
// key = admin id (or chat id), value = { userId, caption }
const pendingFileTargets = {};

// Button labels
const KEY_SEND_DOC = "📄 Send Document";
const KEY_SEND_MPESA = "🧾 Send Mpesa Text / Screenshot";
const KEY_HELP = "❓ Help";

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
• Price / check: 60 KES
• Recheck: 50 KES
• No bargaining, please 😊
`;

// Simple helper to detect payment-looking text that mentions your name
function looksLikePaymentText(text) {
  if (!text) return false;
  const t = text.toLowerCase();

  const hasName =
    t.includes("john makokha wanjala") ||
    t.includes("makokha") ||
    t.includes("john wanjala");

  const hasPaymentWords =
    t.includes("mpesa") ||
    t.includes("paid") ||
    t.includes("payment") ||
    t.includes("confirmed") ||
    t.includes("sent to") ||
    t.includes("ksh") ||
    t.includes("amount");

  return hasName && hasPaymentWords;
}

// Function to check if the current time is within active hours (6 AM to 11:59 PM) and inactive (12 AM to 5:59 AM)
function isBotActive() {
  const now = new Date();

  // Convert the current time to Kenya's timezone (UTC +3)
  const kenyanTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi', // Kenya time zone
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).format(now);

  const hour = new Date(`1970-01-01T${kenyanTime}Z`).getHours();

  // Active hours: From 6 AM to 11:59 PM
  return hour >= 6 && hour < 24;  // 6 AM to 11:59 PM
}

// /start
bot.start(async (ctx) => {
  const user = ctx.from;

  if (user.id === ADMIN_ID) {
    await ctx.reply(
      "👋 Admin mode is ready.\n\n" +
        "📩 *Reply with text as the bot:*\n" +
        "`/reply <userId> <your message>`\n\n" +
        "📁 *Send a file as the bot:*\n" +
        "1. Send this command:\n" +
        "`/file <userId> Optional caption`\n" +
        "2. Then upload/send the document in the *next* message.\n\n" +
        "Example:\n" +
        "`/file 7488919090 Here is your Turnitin report ✅`\n" +
        "Then attach the DOC/PDF.",
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

// /reply <userId> <message>  (text replies)
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

// Handle documents (files)
bot.on("document", async (ctx) => {
  const user = ctx.from;

  // ADMIN sending a file
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];

    if (!target) {
      await ctx.reply(
        "To send this file to a user, first run:\n" +
          "`/file <userId> Optional caption`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Use and clear the pending target
    delete pendingFileTargets[ADMIN_ID];

    const { userId, caption } = target;
    const doc = ctx.message.document;

    try {
      await bot.telegram.sendDocument(userId, doc.file_id, {
        caption: caption || undefined
      });
      await ctx.reply(`✅ File sent to user ${userId}`);
    } catch (err) {
      console.error("Error sending file to user:", err.message);
      await ctx.reply("❌ Failed to send file: " + err.message);
    }

    return;
  }

  // USER sending a file -> forward to admin + auto "file received, make payment" reply
  console.log("📄 Document from user:", user.id);

  try {
    // Notify admin
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

  // 🔔 Auto-reply to user about payment
  if (!isBotActive()) {
    await ctx.reply(
      "⚠️ The bot is currently inactive and will resume at 6 AM. Please try again later."
    );
    return; // Stops further processing
  }

  try {
    await ctx.reply(
      "📄 I’ve received your file.\n\n" +
        "Now please send your *Mpesa payment* text or screenshot.\n\n" +
        "✅ Lipa Na Mpesa Till Number: *6164915*\n" +
        "💰 Price per check: *60 KES* (recheck *50 KES*)\n" +
        "Once payment is confirmed, your Turnitin AI & Plag report will be processed.",
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Error sending auto file-received reply to user:", err.message);
  }
});

// Catch all other messages (text/photos/etc.)
bot.on("message", async (ctx) => {
  const user = ctx.from;

  // Admin messages (other than document) handled by /reply and /file
  if (user.id === ADMIN_ID) return;

  // Ignore /start (already handled)
  if (ctx.message.text && ctx.message.text.startsWith("/start")) return;

  // If it's a document, that is handled in the document handler
  if (ctx.message.document) return;

  const text = ctx.message.text || "";
  const caption = ctx.message.caption || "";

  console.log("📨 New message from user:", user.id);

  // Handle keyboard buttons / helper texts
  if (text === KEY_SEND_DOC) {
    await ctx.reply(
      "📄 *How to send your document:*\n\n" +
        "1️⃣ Tap the *📎 (attachment)* or *+* icon in Telegram.\n" +
        "2️⃣ Choose *File* (not Gallery/Photo).\n" +
        "3️⃣ Select your DOC/PDF and send.\n\n" +
        "Once I receive it, I’ll ask for your Mpesa payment.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (text === KEY_SEND_MPESA) {
    await ctx.reply(
      "🧾 *How to send your Mpesa payment:*\n\n" +
        "1️⃣ Pay via *Lipa Na Mpesa Till Number 6164915*.\n" +
        "2️⃣ Copy the Mpesa *SMS text* or take a *screenshot*.\n" +
        "3️⃣ Paste the text here, or send the screenshot (you can add a caption if you like).\n\n" +
        "Once I detect the payment, I’ll confirm and start processing your report.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (text === KEY_HELP) {
    await ctx.reply(
      "❓ *Quick help:*\n\n" +
        "1️⃣ Tap *📄 Send Document* to see how to upload your file.\n" +
        "2️⃣ Tap *🧾 Send Mpesa Text / Screenshot* to see how to send your payment.\n" +
        "3️⃣ After both are received, your Turnitin AI & Plag report will be processed and sent here.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // ---- Auto-detect payment text or caption ----
  try {
    const paymentCandidate = text || caption;

    if (looksLikePaymentText(paymentCandidate)) {
      await ctx.reply(
        "✅ I’ve received your payment details.\n\n" +
          "Your file will now be *queued for processing*.\n" +
          "You’ll receive your Turnitin AI & Plag report here once it’s ready.\n\n" +
          "If I need anything else, I’ll let you know.",
        { parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    console.error("Error sending auto payment-confirmed reply:", err.message);
  }
  // ---------------------------------------------

  // Forward everything (except keyboard commands) to admin
  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `📨 New message from user:\n` +
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
    console.error("Error forwarding message to admin:", err.message);
  }
});

// 🚀 Start the Telegram bot
bot.launch().then(() => {
  console.log(
    "🤖 @KaptainTurnitinBot is running with keyboard + auto file + auto payment replies..."
  );
});

// 🌐 Tiny HTTP server for Render Web Service (so a port is open)
const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("JK Turnitin Telegram bot is running.\n");
  })
  .listen(PORT, () => {
    console.log(`🌐 HTTP server listening on port ${PORT}`);
  });

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
