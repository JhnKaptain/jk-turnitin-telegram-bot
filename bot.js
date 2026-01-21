/**
 * JK Turnitin Reports Bot — Telegraf + Express Webhook + IntaSend M-Pesa
 * Includes:
 * - Inactive period (02:00–05:59 EAT) with forwarding still enabled
 * - Admin reply/file/file2 commands
 * - CHECK/RECHECK selection after doc
 * - IntaSend checkout link + optional STK push
 * - IntaSend webhook confirmation
 * - ✅ Readable IntaSend errors (no more Buffer hex)
 */

require("dotenv").config();

const { Telegraf } = require("telegraf");
const express = require("express");
const moment = require("moment");
const IntaSend = require("intasend-node");

// =====================
// ENV
// =====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://jk-turnitin-telegram-bot-1.onrender.com";

const INTASEND_PUBLISHABLE_KEY = process.env.INTASEND_PUBLISHABLE_KEY;
const INTASEND_SECRET_KEY = process.env.INTASEND_SECRET_KEY;
const INTASEND_TEST = (process.env.INTASEND_TEST || "true").toLowerCase() === "true";
const INTASEND_WEBHOOK_CHALLENGE = process.env.INTASEND_WEBHOOK_CHALLENGE;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing in .env");
  process.exit(1);
}
if (!INTASEND_PUBLISHABLE_KEY || !INTASEND_SECRET_KEY) {
  console.error("❌ Missing INTASEND keys in .env (INTASEND_PUBLISHABLE_KEY / INTASEND_SECRET_KEY)");
}
if (!INTASEND_WEBHOOK_CHALLENGE) {
  console.error("❌ Missing INTASEND_WEBHOOK_CHALLENGE in .env");
}

// =====================
// CONSTANTS
// =====================
const ADMIN_ID = 6569201830;

// Prices
const CHECK_PRICE_KES = 70;
const RECHECK_PRICE_KES = 65;

// Buttons
const KEY_SEND_DOC = "📄 Send Document";
const KEY_PAYMENT_HELP = "💳 Payment (Link / STK)";
const KEY_CANCEL = "❌ Cancel / New submission";

// Legacy note only (not used for verification)
const MPESA_PHONE = "0741924396";

// =====================
// BOT + INTASEND
// =====================
const bot = new Telegraf(BOT_TOKEN);

const intasend = new IntaSend(INTASEND_PUBLISHABLE_KEY, INTASEND_SECRET_KEY, INTASEND_TEST);
const collection = intasend.collection();

// =====================
// STATE (in-memory)
// NOTE: resets if Render restarts.
// =====================
// submissions[userId] = {
//   userId, submissionId, type, amount, status,
//   doc: { chatId, messageId, fileId, fileName },
//   apiRef, checkoutUrl, invoiceId,
//   awaitingPhoneForStk, createdAt
// }
const submissions = {};
const pendingFileTargets = {};

// =====================
// INACTIVE HOURS
// 02:00–05:59 EAT => 23:00–02:59 UTC, end is 03:00 exclusive
// =====================
const INACTIVE_START_UTC = "23:00";
const INACTIVE_END_UTC = "03:00";

function isTimeInWindowUTC(currentHHMM, startHHMM, endHHMM) {
  if (startHHMM < endHHMM) return currentHHMM >= startHHMM && currentHHMM < endHHMM;
  return currentHHMM >= startHHMM || currentHHMM < endHHMM;
}

function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm");
  return isTimeInWindowUTC(currentTime, INACTIVE_START_UTC, INACTIVE_END_UTC);
}

// =====================
// HELPERS
// =====================
function mainKeyboard() {
  return {
    keyboard: [[{ text: KEY_SEND_DOC }], [{ text: KEY_PAYMENT_HELP }], [{ text: KEY_CANCEL }]],
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

function getReplyContextLine(message) {
  const r = message?.reply_to_message;
  if (!r) return "";
  if (r.document) return `\n↩️ Replying to: document "${safeText(r.document.file_name || "document")}"`;
  if (r.photo) return `\n↩️ Replying to: photo`;
  if (typeof r.text === "string" && r.text.trim()) return `\n↩️ Replying to: "${safeText(r.text).slice(0, 80)}"`;
  if (typeof r.caption === "string" && r.caption.trim())
    return `\n↩️ Replying to caption: "${safeText(r.caption).slice(0, 80)}"`;
  return "\n↩️ Replying to a previous message";
}

function adminQuickCommands(userId) {
  return "\n\nQuick commands (tap & copy):\n" + `\`/file2 ${userId}\`\n` + `\`/reply ${userId} \``;
}

async function sendAdminMessage(text) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Admin message error:", err?.message || err);
  }
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

function newSubmissionId(userId) {
  return `sub_${userId}_${Date.now()}`;
}
function buildApiRef(submissionId) {
  return submissionId;
}

function chooseTypeKeyboard(userId) {
  return {
    inline_keyboard: [
      [{ text: `✅ CHECK (${CHECK_PRICE_KES} KES)`, callback_data: `TYPE_CHECK:${userId}` }],
      [{ text: `♻️ RECHECK (${RECHECK_PRICE_KES} KES)`, callback_data: `TYPE_RECHECK:${userId}` }],
      [{ text: "❌ Cancel", callback_data: `TYPE_CANCEL:${userId}` }]
    ]
  };
}

function normalizeKenyanPhone(input) {
  const raw = (input || "").trim().replace(/\s+/g, "").replace(/[^\d+]/g, "");
  if (/^07\d{8}$/.test(raw)) return "254" + raw.slice(1);
  if (/^\+2547\d{8}$/.test(raw)) return raw.slice(1);
  if (/^2547\d{8}$/.test(raw)) return raw;
  if (/^01\d{8}$/.test(raw)) return "254" + raw.slice(1);
  if (/^\+2541\d{8}$/.test(raw)) return raw.slice(1);
  if (/^2541\d{8}$/.test(raw)) return raw;
  return null;
}

// ✅ Turn Buffer/odd SDK errors into readable text
function readableErr(err) {
  const raw = err?.response?.data || err?.body || err?.message || err;
  return Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
}

// =====================
// BOT NAME ONLINE/OFFLINE (RATE LIMIT SAFE)
// =====================
let lastOnlineStatus = null;
const BOT_NAME_MIN_ATTEMPT_INTERVAL_MS = 5 * 60 * 1000;
let lastBotNameAttemptAt = 0;
let nextBotNameAllowedAt = 0;

function extractRetryAfterSeconds(err) {
  const ra = err?.response?.parameters?.retry_after;
  if (typeof ra === "number") return ra;
  const msg = (err?.message || "").toLowerCase();
  const m = msg.match(/retry after\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

async function updateBotNameForCurrentStatus() {
  const now = Date.now();
  if (now < nextBotNameAllowedAt) return;
  if (now - lastBotNameAttemptAt < BOT_NAME_MIN_ATTEMPT_INTERVAL_MS) return;

  const desiredStatus = isBotInactivePeriod() ? "OFFLINE" : "ONLINE";
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
      console.error(`❌ setMyName 429. Retry after ${retryAfter}s.`);
      return;
    }
    console.error("❌ setMyName error:", err?.message || err);
  }
}

bot.use(async (ctx, next) => {
  try {
    await updateBotNameForCurrentStatus();
  } catch {}
  return next();
});

// =====================
// INTASEND PAYMENT HELPERS
// =====================
async function createMpesaCheckoutLink(submission) {
  try {
    const resp = await collection.charge({
      first_name: "Telegram",
      last_name: "User",
      email: `${submission.userId}@telegram.local`,
      host: WEBHOOK_URL,
      amount: submission.amount,
      currency: "KES",
      api_ref: submission.apiRef,
      method: "M-PESA",
      redirect_url: `${WEBHOOK_URL}/paid`
    });

    submission.invoiceId = resp.invoice_id || resp.id || submission.invoiceId;
    submission.checkoutUrl = resp.url || resp.checkout_url || resp.link || resp.payment_url || null;

    return submission.checkoutUrl;
  } catch (err) {
    console.error("INTASEND CHARGE ERROR:", readableErr(err));
    throw err;
  }
}

async function sendStkPush(submission, phone254) {
  try {
    return await collection.mpesaStkPush({
      phone_number: phone254,
      amount: submission.amount,
      currency: "KES",
      api_ref: submission.apiRef
    });
  } catch (err) {
    console.error("INTASEND STK ERROR:", readableErr(err));
    throw err;
  }
}

async function sendPaymentInstructions(ctx, submission) {
  await replyMarkdownSafe(
    ctx,
    `✅ *Payment request created*\n\n` +
      `*Type:* ${submission.type}\n` +
      `*Amount:* ${submission.amount} KES\n\n` +
      `🔗 *Pay using M-Pesa link (recommended):*\n${submission.checkoutUrl}\n\n` +
      `📲 *Optional STK Push:* reply with your phone number (e.g. \`07XXXXXXXX\`).\n\n` +
      `ℹ️ The bot will confirm automatically after payment.`,
    { reply_markup: mainKeyboard() }
  );
  submission.awaitingPhoneForStk = true;
}

// =====================
// WEBHOOK SETUP (Telegram)
// =====================
bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`);
updateBotNameForCurrentStatus();
setInterval(updateBotNameForCurrentStatus, 10 * 60 * 1000);

// =====================
// /start
// =====================
const WELCOME_MESSAGE = `
JK Turnitin Reports Bot

1️⃣ Send your document as a *file* (DOC/PDF)
2️⃣ Choose *CHECK* or *RECHECK*
3️⃣ Pay via *M-Pesa link* (or request STK push)
4️⃣ Bot confirms automatically and we process

💰 Pricing
• Check: ${CHECK_PRICE_KES} KES
• Recheck: ${RECHECK_PRICE_KES} KES
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
      "👋 Admin mode.\n\n" +
        "📩 Reply as bot:\n`/reply <userId> <message>`\n\n" +
        "📁 Send file/photo as bot:\n" +
        "`/file <userId> caption`  → next 1\n" +
        "`/file2 <userId> caption` → next 2"
    );
    return;
  }

  await replyMarkdownSafe(ctx, WELCOME_MESSAGE, { reply_markup: mainKeyboard() });

  await sendAdminMessage(
    `🔥 New user started bot:\n` +
      `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
      `Username: @${safeText(user.username || "N/A")}\n` +
      `User ID: ${user.id}` +
      adminQuickCommands(user.id)
  );
});

// =====================
// BUTTON HANDLERS
// =====================
bot.hears(KEY_SEND_DOC, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(
    ctx,
    "📄 Send your document as a *file*:\n" +
      "Tap 📎 → *File* → select DOC/PDF → send.\n\n" +
      "✅ Do not send as a photo.",
    { reply_markup: mainKeyboard() }
  );
});

bot.hears(KEY_PAYMENT_HELP, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(
    ctx,
    "💳 Payment:\n\n" +
      "✅ Use the M-Pesa link sent after your document.\n" +
      "📲 Or reply with your phone number to get STK push.\n\n" +
      `Legacy note (not used for verification): ${MPESA_PHONE}`,
    { reply_markup: mainKeyboard() }
  );
});

bot.hears(KEY_CANCEL, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  const user = ctx.from;
  delete submissions[user.id];

  await sendAdminMessage(
    "❌ User cancelled:\n" +
      `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
      `Username: @${safeText(user.username || "N/A")}\n` +
      `User ID: ${user.id}\n` +
      `Time (EAT): ${moment().utcOffset(3).format("YYYY-MM-DD HH:mm")}` +
      adminQuickCommands(user.id)
  );

  await ctx.reply("❌ Cancelled. Send a new document to start again.", { reply_markup: mainKeyboard() });
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
    await bot.telegram.sendMessage(userId, replyText);
    await ctx.reply(`✅ Sent to ${userId}`);
  } catch (err) {
    await ctx.reply("❌ Failed: " + err.message);
  }
});

bot.command("file", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").split(" ");
  if (parts.length < 2) return ctx.reply("Usage: /file <userId> Optional caption");

  const userId = parts[1];
  const caption = parts.slice(2).join(" ");
  pendingFileTargets[ADMIN_ID] = { userId, caption, remaining: 1 };

  await replyMarkdownSafe(ctx, `✅ Next file/photo will go to user ${userId}.`);
});

bot.command("file2", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").split(" ");
  if (parts.length < 2) return ctx.reply("Usage: /file2 <userId> Optional caption");

  const userId = parts[1];
  const caption = parts.slice(2).join(" ");
  pendingFileTargets[ADMIN_ID] = { userId, caption, remaining: 2 };

  await replyMarkdownSafe(ctx, `✅ Next 2 files/photos will go to user ${userId}.`);
});

// =====================
// CALLBACK QUERY: choose CHECK/RECHECK
// =====================
bot.on("callback_query", async (ctx) => {
  try {
    const data = ctx.callbackQuery?.data || "";
    const user = ctx.from;
    const [tag, targetUserId] = data.split(":");

    if (!targetUserId || String(user.id) !== String(targetUserId)) {
      await ctx.answerCbQuery("Not for you.");
      return;
    }

    const submission = submissions[user.id];

    // ✅ Better message than "No pending submission"
    if (!submission || submission.status !== "WAITING_TYPE") {
      await ctx.answerCbQuery("This request expired. Please resend the document.", { show_alert: true });
      return;
    }

    if (tag === "TYPE_CANCEL") {
      delete submissions[user.id];
      await ctx.answerCbQuery("Cancelled.");
      await ctx.reply("❌ Cancelled. Send a new document to start again.", { reply_markup: mainKeyboard() });
      return;
    }

    submission.type = tag === "TYPE_CHECK" ? "CHECK" : "RECHECK";
    submission.amount = tag === "TYPE_CHECK" ? CHECK_PRICE_KES : RECHECK_PRICE_KES;
    submission.apiRef = buildApiRef(submission.submissionId);
    submission.status = "CREATING_LINK";

    await ctx.answerCbQuery("Creating payment link...");

    const url = await createMpesaCheckoutLink(submission);

    if (!url) {
      submission.status = "ERROR";
      await ctx.reply("❌ Failed to create payment link. Try again later.", { reply_markup: mainKeyboard() });
      return;
    }

    submission.status = "AWAITING_PAYMENT";
    await sendPaymentInstructions(ctx, submission);

    await sendAdminMessage(
      `🧾 Payment link created:\n` +
        `User ID: ${user.id}\n` +
        `Type: ${submission.type}\n` +
        `Amount: ${submission.amount} KES\n` +
        `api_ref: ${submission.apiRef}` +
        adminQuickCommands(user.id)
    );
  } catch (err) {
    console.error("callback_query error:", readableErr(err));
  }
});

// =====================
// DOCUMENT HANDLER
// =====================
bot.on("document", async (ctx) => {
  const user = ctx.from;

  // Admin sending doc to user
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];
    if (!target) {
      await replyMarkdownSafe(ctx, "Run `/file <userId>` or `/file2 <userId>` first.");
      return;
    }

    const doc = ctx.message.document;
    target.remaining = (target.remaining || 1) - 1;

    try {
      await bot.telegram.sendDocument(target.userId, doc.file_id, { caption: target.caption || undefined });
      if (target.remaining <= 0) delete pendingFileTargets[ADMIN_ID];
      await ctx.reply(`✅ File sent to user ${target.userId}`);
    } catch (err) {
      await ctx.reply("❌ Failed: " + err.message);
    }
    return;
  }

  // User doc => forward to admin always
  const replyContext = getReplyContextLine(ctx.message);
  await sendAdminMessage(
    `📨 Document from user:\n` +
      `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
      `Username: @${safeText(user.username || "N/A")}\n` +
      `User ID: ${user.id}` +
      replyContext +
      adminQuickCommands(user.id)
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch {}

  if (isBotInactivePeriod()) {
    await notifyInactivePeriod(ctx);
    return;
  }

  // Create submission and ask type
  const submissionId = newSubmissionId(user.id);
  const doc = ctx.message.document;

  submissions[user.id] = {
    userId: user.id,
    submissionId,
    type: null,
    amount: null,
    status: "WAITING_TYPE",
    doc: {
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id,
      fileId: doc.file_id,
      fileName: doc.file_name || "document"
    },
    apiRef: null,
    checkoutUrl: null,
    invoiceId: null,
    awaitingPhoneForStk: false,
    createdAt: Date.now()
  };

  await replyMarkdownSafe(
    ctx,
    "📄 File received.\n\nChoose:\n" +
      `• CHECK (${CHECK_PRICE_KES} KES)\n` +
      `• RECHECK (${RECHECK_PRICE_KES} KES)\n`,
    { reply_markup: chooseTypeKeyboard(user.id) }
  );
});

// =====================
// PHOTO HANDLER
// =====================
bot.on("photo", async (ctx) => {
  const user = ctx.from;

  // Admin photo to user
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];
    if (!target) {
      await replyMarkdownSafe(ctx, "Run `/file <userId>` or `/file2 <userId>` first.");
      return;
    }

    const photos = ctx.message.photo || [];
    const largest = photos[photos.length - 1];
    target.remaining = (target.remaining || 1) - 1;

    try {
      await bot.telegram.sendPhoto(target.userId, largest.file_id, { caption: target.caption || undefined });
      if (target.remaining <= 0) delete pendingFileTargets[ADMIN_ID];
      await ctx.reply(`✅ Photo sent to user ${target.userId}`);
    } catch (err) {
      await ctx.reply("❌ Failed: " + err.message);
    }
    return;
  }

  // User photo => forward to admin always
  const replyContext = getReplyContextLine(ctx.message);
  await sendAdminMessage(
    `🖼️ Photo/Screenshot from user:\n` +
      `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
      `Username: @${safeText(user.username || "N/A")}\n` +
      `User ID: ${user.id}` +
      replyContext +
      adminQuickCommands(user.id)
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch {}

  if (isBotInactivePeriod()) {
    await notifyInactivePeriod(ctx);
    return;
  }

  await ctx.reply("🖼️ Received. Send your document as a file to get the M-Pesa payment link.", {
    reply_markup: mainKeyboard()
  });
});

// =====================
// TEXT HANDLER (STK phone capture)
// =====================
bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = (ctx.message.text || "").trim();

  if (text.startsWith("/")) return;
  if (user.id === ADMIN_ID) return;

  // Forward text to admin always
  const replyContext = getReplyContextLine(ctx.message);
  await sendAdminMessage(
    `💬 Message from user:\n` +
      `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
      `Username: @${safeText(user.username || "N/A")}\n` +
      `User ID: ${user.id}` +
      replyContext +
      adminQuickCommands(user.id) +
      `\n\n${safeText(text)}`
  );

  if (isBotInactivePeriod()) {
    await notifyInactivePeriod(ctx);
    return;
  }

  const submission = submissions[user.id];

  // If waiting for STK phone:
  if (submission && submission.awaitingPhoneForStk && submission.status === "AWAITING_PAYMENT") {
    const phone254 = normalizeKenyanPhone(text);
    if (!phone254) {
      await replyMarkdownSafe(ctx, "❌ Invalid phone.\nSend: `07XXXXXXXX` or `2547XXXXXXXX`", {
        reply_markup: mainKeyboard()
      });
      return;
    }

    try {
      submission.status = "STK_SENDING";
      await sendStkPush(submission, phone254);

      submission.status = "STK_SENT";
      submission.awaitingPhoneForStk = false;

      await replyMarkdownSafe(
        ctx,
        `📲 STK push sent to *${phone254}* for *${submission.amount} KES*.\n` +
          "Enter your M-Pesa PIN to complete.\n\n" +
          "✅ Bot will confirm automatically after payment.",
        { reply_markup: mainKeyboard() }
      );
    } catch (err) {
      submission.status = "AWAITING_PAYMENT";
      await ctx.reply("❌ Failed to send STK push. Use the payment link instead.", { reply_markup: mainKeyboard() });
    }
    return;
  }

  await replyMarkdownSafe(
    ctx,
    "✅ Noted.\n\nTo proceed:\n1) Send your document as a *file*\n2) Choose CHECK or RECHECK\n3) Pay using the link (or request STK push).",
    { reply_markup: mainKeyboard() }
  );
});

// =====================
// EXPRESS SERVER
// =====================
const app = express();
app.use(express.json());

// IntaSend webhook
app.post("/intasend/webhook", async (req, res) => {
  try {
    const payload = req.body || {};

    // challenge verification
    if (payload.challenge !== INTASEND_WEBHOOK_CHALLENGE) {
      return res.status(401).send("Invalid challenge");
    }

    const state = payload.state;
    const apiRef = payload.api_ref;
    const invoiceId = payload.invoice_id;
    const paidValue = payload.value;

    const userId = Object.keys(submissions).find((uid) => submissions[uid]?.apiRef === apiRef);
    if (!userId) return res.status(200).send("OK");

    const submission = submissions[userId];
    if (invoiceId) submission.invoiceId = invoiceId;

    if (state === "COMPLETE") {
      submission.status = "PAID";

      await bot.telegram.sendMessage(
        userId,
        `✅ Payment confirmed for *${submission.type}* (${submission.amount} KES).\n\nYour file is now queued for processing.`,
        { parse_mode: "Markdown", reply_markup: mainKeyboard() }
      );

      await sendAdminMessage(
        `✅ PAYMENT CONFIRMED:\n` +
          `User ID: ${userId}\n` +
          `Type: ${submission.type}\n` +
          `Expected: ${submission.amount} KES\n` +
          `Paid: ${paidValue ?? "N/A"}\n` +
          `api_ref: ${submission.apiRef}` +
          adminQuickCommands(userId)
      );
    } else if (state === "FAILED") {
      submission.status = "FAILED";
      await bot.telegram.sendMessage(userId, "❌ Payment failed. Please try again using the link.", {
        reply_markup: mainKeyboard()
      });
    } else {
      submission.status = state || submission.status;
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("IntaSend webhook error:", readableErr(err));
    return res.status(200).send("OK");
  }
});

// Telegram webhook
app.use(bot.webhookCallback("/webhook"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Webhook server is listening on port ${port}`));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
