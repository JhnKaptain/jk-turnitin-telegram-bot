/**
 * JK Turnitin Reports Bot — Telegraf + Express Webhook
 * + IntaSend STK Push (default) + Webhook confirmation
 *
 * FIXES:
 * ✅ Phone-number flow not forwarded to admin before processing
 * ✅ STK Push is default (no checkout link needed)
 * ✅ Webhook validates challenge (ONLY if challenge exists) + marks payments COMPLETE via api_ref/state
 *
 * ONLY CHANGES REQUESTED NOW:
 * ✅ Payment-confirmed user message includes queue + AI <20% highlights note
 * ✅ Admin payment confirmation shortened (no long debug)
 * ✅ Inactive time: 04:00–05:59 EAT
 */

require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const moment = require("moment");
const IntaSend = require("intasend-node");

// =====================
// ENV + CONSTANTS
// =====================
const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error("❌ BOT_TOKEN is missing in .env file");
  process.exit(1);
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://jk-turnitin-telegram-bot-1.onrender.com";
const INTASEND_WEBHOOK_CHALLENGE = process.env.INTASEND_WEBHOOK_CHALLENGE || "";
const INTASEND_TEST = String(process.env.INTASEND_TEST_ENVIRONMENT || "true").toLowerCase() === "true";

// IntaSend keys required
const INTASEND_PUBLISHABLE_KEY = process.env.INTASEND_PUBLISHABLE_KEY || "";
const INTASEND_SECRET_KEY = process.env.INTASEND_SECRET_KEY || "";

if (!INTASEND_PUBLISHABLE_KEY || !INTASEND_SECRET_KEY) {
  console.error("❌ Missing INTASEND_PUBLISHABLE_KEY or INTASEND_SECRET_KEY in .env");
  process.exit(1);
}

// ⭐ Your Telegram numeric ID from @userinfobot
const ADMIN_ID = 6569201830;

// 💰 Pricing constants
const CHECK_PRICE_KES = 70;
const RECHECK_PRICE_KES = 65;
const MIN_PAYMENT_KES = 70;

// Follow-up TTL
const UNDERPAYMENT_FOLLOWUP_TTL_MINUTES = 180; // 3 hours

// Buttons
const KEY_SEND_DOC = "📄 Send Document";
const KEY_SEND_MPESA = "🧾 Send Mpesa Text / Screenshot";
const KEY_CANCEL = "❌ Cancel / New submission";

// =====================
// BOT STATE
// =====================
const bot = new Telegraf(botToken);

// IntaSend client
const intasend = new IntaSend(INTASEND_PUBLISHABLE_KEY, INTASEND_SECRET_KEY, INTASEND_TEST);
const collection = intasend.collection();

// Remember which user the next admin file(s) should go to
const pendingFileTargets = {};
const pendingUnderpaymentFollowup = {};

// Submission state per user (in-memory)
const submissions = {}; // userId -> { stage, docMsgId, kind, amount, api_ref, phone, paid, createdAt }
const paymentRefs = {}; // api_ref -> { userId, kind, amount }

// stages
const STAGE_NONE = "NONE";
const STAGE_WAIT_TYPE = "WAIT_TYPE";
const STAGE_WAIT_PHONE = "WAIT_PHONE";
const STAGE_WAIT_PAYMENT = "WAIT_PAYMENT";

// =====================
// HELPERS
// =====================

// ✅ Inactive: 04:00–05:59 EAT (UTC+3) => UTC 01:00–02:59 (end 03:00 exclusive)
const INACTIVE_START_UTC = "01:00"; // 04:00 EAT
const INACTIVE_END_UTC = "03:00";   // 05:59 EAT ends at 02:59 UTC (03:00 exclusive)

function isTimeInWindowUTC(currentHHMM, startHHMM, endHHMM) {
  if (startHHMM < endHHMM) return currentHHMM >= startHHMM && currentHHMM < endHHMM;
  return currentHHMM >= startHHMM || currentHHMM < endHHMM;
}

function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm");
  return isTimeInWindowUTC(currentTime, INACTIVE_START_UTC, INACTIVE_END_UTC);
}

function mainKeyboard() {
  return {
    keyboard: [[{ text: KEY_SEND_DOC }], [{ text: KEY_SEND_MPESA }], [{ text: KEY_CANCEL }]],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

async function replyMarkdownSafe(ctx, message, extra = {}) {
  try {
    await ctx.reply(message, { parse_mode: "Markdown", ...extra });
  } catch {
    await ctx.reply(message, { ...extra });
  }
}

function safeText(s) {
  return (s || "").toString();
}

function adminQuickCommands(userId) {
  return (
    "\n\nQuick commands (tap & copy):\n" +
    `\`/file2 ${userId}\`\n` +
    `\`/reply ${userId} \``
  );
}

async function sendAdminMessage(text) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Error sending message to admin:", err?.message || err);
  }
}

function normalizePhoneTo254(phoneRaw) {
  const t = String(phoneRaw || "").trim().replace(/\s+/g, "");
  if (!t) return null;

  // allow +2547..., 2547..., 07...
  if (t.startsWith("+")) {
    const x = t.slice(1);
    if (/^2547\d{8}$/.test(x)) return x;
    return null;
  }
  if (/^2547\d{8}$/.test(t)) return t;
  if (/^07\d{8}$/.test(t)) return "254" + t.slice(1);
  if (/^7\d{8}$/.test(t)) return "254" + t;
  return null;
}

// Create unique api_ref
function makeApiRef(userId, kind) {
  const stamp = Date.now();
  return `JK_${kind}_${userId}_${stamp}`;
}

// Inline buttons for type selection
function typeInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`✅ CHECK (${CHECK_PRICE_KES} KES)`, "TYPE_CHECK")],
    [Markup.button.callback(`🔁 RECHECK (${RECHECK_PRICE_KES} KES)`, "TYPE_RECHECK")],
    [Markup.button.callback("❌ Cancel", "TYPE_CANCEL")]
  ]);
}

async function notifyInactivePeriod(ctx) {
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

// =====================
// START / WELCOME
// =====================
const WELCOME_MESSAGE = `
JK Turnitin Reports Bot

This bot generates Turnitin plagiarism and AI reports.

📌 Instructions:
1️⃣ Send your document here as a file (not as a photo).
2️⃣ Choose CHECK or RECHECK.
3️⃣ Enter your M-Pesa phone number (Safaricom).
4️⃣ You’ll receive an M-Pesa prompt to enter PIN.
5️⃣ After payment confirmation, you’ll receive your report here.

💰 Pricing
• Price / check: ${CHECK_PRICE_KES} KES
• Recheck: ${RECHECK_PRICE_KES} KES
• No bargaining.
`;

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
        "2. Then upload/send the document(s) or photo(s) in the next messages."
    );
    return;
  }

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
      "2️⃣ Choose *File* → select your DOC/PDF.\n" +
      "3️⃣ Send it here as a *file* (not as a photo).",
    { reply_markup: mainKeyboard() }
  );
});

bot.hears(KEY_SEND_MPESA, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(
    ctx,
    "🧾 You no longer need to forward Mpesa SMS.\n\n" +
      "✅ The bot will send you an *M-Pesa STK prompt* after you enter your phone number.\n\n" +
      "Just send your document first, then choose CHECK/RECHECK.",
    { reply_markup: mainKeyboard() }
  );
});

bot.hears(KEY_CANCEL, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  const userId = ctx.from.id;
  delete submissions[userId];
  delete pendingUnderpaymentFollowup[userId];

  await sendAdminMessage(
    "❌ User cancelled submission:\n" +
      `Name: ${safeText(ctx.from.first_name)} ${safeText(ctx.from.last_name)}\n` +
      `Username: @${safeText(ctx.from.username || "N/A")}\n` +
      `User ID: ${userId}\n` +
      `Time (EAT): ${moment().utcOffset(3).format("YYYY-MM-DD HH:mm")}` +
      adminQuickCommands(userId)
  );

  await ctx.reply("❌ Current submission cancelled.\n\nSend a new document to start again.", { reply_markup: mainKeyboard() });
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
    await ctx.reply("❌ Failed to send message: " + (err?.message || err));
  }
});

bot.command("file", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").split(" ");
  if (parts.length < 2) return ctx.reply("Usage: /file <userId> Optional caption");

  const userId = parts[1];
  const caption = parts.slice(2).join(" ");

  pendingFileTargets[ADMIN_ID] = { userId, caption, remaining: 1 };
  await replyMarkdownSafe(ctx, `✅ Next document/photo you send will go to user ${userId}.`);
});

bot.command("file2", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").split(" ");
  if (parts.length < 2) return ctx.reply("Usage: /file2 <userId> Optional caption");

  const userId = parts[1];
  const caption = parts.slice(2).join(" ");

  pendingFileTargets[ADMIN_ID] = { userId, caption, remaining: 2 };
  await replyMarkdownSafe(ctx, `✅ Next 2 document/photo messages will go to user ${userId}.`);
});

// =====================
// DOCUMENT HANDLER
// =====================
bot.on("document", async (ctx) => {
  const user = ctx.from;

  // ADMIN sending doc to user
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];
    if (!target) {
      await replyMarkdownSafe(ctx, "Use `/file <userId>` or `/file2 <userId>` first.");
      return;
    }

    const { userId, caption } = target;
    const doc = ctx.message.document;
    target.remaining = (target.remaining || 1) - 1;

    try {
      await bot.telegram.sendDocument(userId, doc.file_id, { caption: caption || undefined });
      if (target.remaining <= 0) delete pendingFileTargets[ADMIN_ID];
      await ctx.reply(`✅ File sent to user ${userId}`);
    } catch (err) {
      await ctx.reply("❌ Failed to send file: " + (err?.message || err));
    }
    return;
  }

  // USER sending doc: forward to admin always
  await sendAdminMessage(
    `📨 Document from user:\n` +
      `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
      `Username: @${safeText(user.username || "N/A")}\n` +
      `User ID: ${user.id}` +
      adminQuickCommands(user.id)
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch (err) {
    console.error("Error forwarding document to admin:", err?.message || err);
  }

  // If inactive: do not start payment flow
  if (isBotInactivePeriod()) {
    await notifyInactivePeriod(ctx);
    return;
  }

  // Create submission + ask type
  submissions[user.id] = {
    stage: STAGE_WAIT_TYPE,
    docMsgId: ctx.message.message_id,
    kind: null,
    amount: null,
    api_ref: null,
    phone: null,
    paid: false,
    createdAt: Date.now()
  };

  await ctx.reply("📄 File received.\n\nChoose what you want:", typeInlineKeyboard());
});

// =====================
// INLINE TYPE SELECTION
// =====================
bot.action("TYPE_CHECK", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (!sub || sub.stage !== STAGE_WAIT_TYPE) {
    await ctx.answerCbQuery("No pending submission.");
    return;
  }

  sub.kind = "CHECK";
  sub.amount = CHECK_PRICE_KES;
  sub.api_ref = makeApiRef(userId, "CHECK");
  paymentRefs[sub.api_ref] = { userId, kind: sub.kind, amount: sub.amount };
  sub.stage = STAGE_WAIT_PHONE;

  await ctx.answerCbQuery("CHECK selected");
  await ctx.reply(
    `✅ CHECK selected (${CHECK_PRICE_KES} KES).\n\nSend your Safaricom number for STK Push (07XXXXXXXX or 2547XXXXXXXX).`,
    { reply_markup: mainKeyboard() }
  );
});

bot.action("TYPE_RECHECK", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (!sub || sub.stage !== STAGE_WAIT_TYPE) {
    await ctx.answerCbQuery("No pending submission.");
    return;
  }

  sub.kind = "RECHECK";
  sub.amount = RECHECK_PRICE_KES;
  sub.api_ref = makeApiRef(userId, "RECHECK");
  paymentRefs[sub.api_ref] = { userId, kind: sub.kind, amount: sub.amount };
  sub.stage = STAGE_WAIT_PHONE;

  await ctx.answerCbQuery("RECHECK selected");
  await ctx.reply(
    `🔁 RECHECK selected (${RECHECK_PRICE_KES} KES).\n\nSend your Safaricom number for STK Push (07XXXXXXXX or 2547XXXXXXXX).`,
    { reply_markup: mainKeyboard() }
  );
});

bot.action("TYPE_CANCEL", async (ctx) => {
  const userId = ctx.from.id;
  delete submissions[userId];
  await ctx.answerCbQuery("Cancelled");
  await ctx.reply("❌ Cancelled. Send a new document to start again.", { reply_markup: mainKeyboard() });
});

// =====================
// TEXT HANDLER (phone first)
// =====================
bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = (ctx.message.text || "").trim();

  if (text.startsWith("/")) return;
  if (user.id === ADMIN_ID) return;

  // If inactive: still forward to admin, but notify user
  if (isBotInactivePeriod()) {
    await sendAdminMessage(
      `💬 Message from user (inactive period):\n` +
        `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
        `Username: @${safeText(user.username || "N/A")}\n` +
        `User ID: ${user.id}` +
        adminQuickCommands(user.id) +
        `\n\n${safeText(text)}`
    );
    await notifyInactivePeriod(ctx);
    return;
  }

  // ✅ FIRST: if waiting for phone, do NOT forward to admin
  const sub = submissions[user.id];
  if (sub && sub.stage === STAGE_WAIT_PHONE) {
    const phone254 = normalizePhoneTo254(text);
    if (!phone254) {
      await ctx.reply("❌ Invalid phone. Send like 07XXXXXXXX or 2547XXXXXXXX.");
      return;
    }

    sub.phone = phone254;
    sub.stage = STAGE_WAIT_PAYMENT;

    await ctx.reply("⏳ Sending STK Push… check your phone and enter PIN.");

    try {
      await collection.mpesaStkPush({
        first_name: safeText(user.first_name || "Customer"),
        last_name: safeText(user.last_name || "User"),
        email: `${user.id}@jkturnitin.local`,
        host: PUBLIC_BASE_URL,
        amount: sub.amount,
        phone_number: sub.phone,
        api_ref: sub.api_ref
      });

      await ctx.reply(
        "✅ STK Push sent.\n\nAfter you pay, confirmation is automatic.\nIf no prompt, wait 10–20s then try again."
      );

      // (kept) admin log that STK was initiated — short and safe
      await sendAdminMessage(
        `📲 STK initiated | user ${user.id} | ${sub.kind} | ${sub.amount} KES | phone ${sub.phone} | api_ref \`${sub.api_ref}\``
      );
    } catch (err) {
      await ctx.reply(
        "❌ Failed to send STK Push.\nTry again in 1 minute, or send /start and repeat."
      );

      await sendAdminMessage(
        `❌ STK Push error | user ${user.id} | api_ref \`${sub.api_ref}\`\n${safeText(err?.message || err)}`
      );
    }
    return;
  }

  // Otherwise: forward text to admin (normal)
  await sendAdminMessage(
    `💬 Message from user:\n` +
      `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
      `Username: @${safeText(user.username || "N/A")}\n` +
      `User ID: ${user.id}` +
      adminQuickCommands(user.id) +
      `\n\n${safeText(text)}`
  );

  if (!sub) {
    await ctx.reply("Send your document first to start.");
  } else if (sub.stage === STAGE_WAIT_TYPE) {
    await ctx.reply("Please choose CHECK or RECHECK using the buttons.");
  } else if (sub.stage === STAGE_WAIT_PAYMENT) {
    await ctx.reply("Waiting for payment confirmation…");
  }
});

// =====================
// PHOTO HANDLER
// =====================
bot.on("photo", async (ctx) => {
  const user = ctx.from;

  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];
    if (!target) {
      await replyMarkdownSafe(ctx, "Use `/file <userId>` or `/file2 <userId>` first.");
      return;
    }

    const { userId, caption } = target;
    const photos = ctx.message.photo || [];
    const largest = photos[photos.length - 1];
    target.remaining = (target.remaining || 1) - 1;

    try {
      await bot.telegram.sendPhoto(userId, largest.file_id, { caption: caption || undefined });
      if (target.remaining <= 0) delete pendingFileTargets[ADMIN_ID];
      await ctx.reply(`✅ Photo sent to user ${userId}`);
    } catch (err) {
      await ctx.reply("❌ Failed to send photo: " + (err?.message || err));
    }
    return;
  }

  await sendAdminMessage(
    `🖼️ Photo from user:\n` +
      `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
      `Username: @${safeText(user.username || "N/A")}\n` +
      `User ID: ${user.id}` +
      adminQuickCommands(user.id)
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch (err) {
    console.error("Error forwarding photo:", err?.message || err);
  }

  if (isBotInactivePeriod()) {
    await notifyInactivePeriod(ctx);
    return;
  }

  await ctx.reply("✅ Received.", { reply_markup: mainKeyboard() });
});

// =====================
// EXPRESS SERVER + TELEGRAM WEBHOOK
// =====================
const app = express();

// (does not change bot logic; helps IntaSend if it sends urlencoded)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(bot.webhookCallback("/webhook"));

// Telegram webhook (Render)
const WEBHOOK_URL = `${PUBLIC_BASE_URL}/webhook`;
bot.telegram.setWebhook(WEBHOOK_URL);

// =====================
// INTASEND WEBHOOK
// =====================
app.post("/intasend/webhook", async (req, res) => {
  try {
    const payload = req.body || {};

    // ✅ Validate challenge ONLY if IntaSend sends challenge
    if (payload.challenge) {
      if (INTASEND_WEBHOOK_CHALLENGE && payload.challenge !== INTASEND_WEBHOOK_CHALLENGE) {
        return res.status(401).json({ ok: false, message: "Invalid challenge" });
      }
      return res.status(200).json({ ok: true });
    }

    const apiRef = payload.api_ref;
    const state = payload.state;

    if (!apiRef) return res.status(200).json({ ok: true });

    const ref = paymentRefs[apiRef];
    if (!ref) return res.status(200).json({ ok: true });

    if (String(state || "").toUpperCase() === "COMPLETE") {
      const { userId, kind, amount } = ref;
      const sub = submissions[userId];
      if (sub && sub.api_ref === apiRef) sub.paid = true;

      // ✅ USER MESSAGE (short, includes queue + AI <20% note)
      const userMsg =
        `✅ Payment confirmed (${amount} KES) for *${kind}*.\n` +
        `⏱ Reports take *2–8 min* (queue).\n` +
        `ℹ️ AI < *20%*: no highlights. Add AI text to reach ≥20% + request a *paid recheck*.`;

      try {
        await bot.telegram.sendMessage(userId, userMsg, { parse_mode: "Markdown" });
      } catch {}

      // ✅ ADMIN MESSAGE (short, no long debug)
      await sendAdminMessage(
        `✅ PAYMENT COMPLETE | user ${userId} | ${kind} | ${amount} KES | api_ref \`${apiRef}\``
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("IntaSend webhook error:", err?.message || err);
    return res.status(200).json({ ok: true });
  }
});

// =====================
// START SERVER
// =====================
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Webhook server listening on port ${port}`));

process.once("SIGINT", () => {
  try { bot.stop("SIGINT"); } catch {}
});
process.once("SIGTERM", () => {
  try { bot.stop("SIGTERM"); } catch {}
});
