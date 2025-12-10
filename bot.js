require("dotenv").config();
const { Telegraf } = require("telegraf");
const http = require("http"); // tiny HTTP server for Render
const moment = require("moment");

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

// Time check function to determine inactivity period (12 AM - 5:59 AM EAT = 9 PM - 2:59 AM UTC)
function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm"); // Current time in UTC (24-hour format)
  return currentTime >= "21:00" && currentTime < "03:00"; // 9 PM to 3 AM UTC
}

// Notify users during inactive periods
async function notifyInactivePeriod(ctx) {
  await ctx.reply("The bot is temporarily inactive. I’ll be back at 6 AM EAT.");
  bot.stop();
}

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
• Price / check: 70 KES
• Recheck: 50 KES
• No bargaining, please 😊
`;

bot.start(async (ctx) => {
  const user = ctx.from;

  if (isBotInactivePeriod()) {
    await notifyInactivePeriod(ctx);
    return;
  }

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

// /file <userId> Optional caption   (prepare to send a file)
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

  pendingFileTargets[ADMIN_ID] = { userId, caption };

  await ctx.reply(
    `✅ Got it. The *next document* you send will be delivered to user ${userId}.`,
    { parse_mode: "Markdown" }
  );
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
  try {
    await ctx.reply(
      "📄 I’ve received your file.\n\n" +
        "Now please send your *Mpesa payment* text or screenshot.\n\n" +
        "✅ Lipa Na Mpesa Till Number: *6164915*\n" +
        "💰 Price per check: *70 KES* (recheck *50 KES*)\n" +
        "Once payment is confirmed, your Turnitin AI & Plag report will be processed.",
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Error sending auto file-received reply to user:", err.message);
  }
});

// 🚀 Start the Telegram bot
bot.launch().then(() => {
  console.log("🤖 @KaptainTurnitinBot is running with keyboard + auto file + auto payment replies...");
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
