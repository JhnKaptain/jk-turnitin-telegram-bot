/**
 * JK Turnitin Reports Bot — Telegraf + Express Webhook
 * + IntaSend STK Push (default) + Webhook confirmation
 *
 * HARD FIXES:
 * ✅ NO prompts during inactive hours (12:00 AM – 6:00 AM EAT)
 *    - users can still send docs/photos/text → forwarded to admin
 *    - bot does NOT show type buttons, does NOT accept phone, does NOT STK
 * ✅ Handles IntaSend webhook states COMPLETE + FAILED/CANCELLED/EXPIRED/PENDING
 * ✅ Adds Resend STK / Change phone / Cancel buttons (prevents “stuck waiting”)
 * ✅ Adds payment timeout reminders
 * ✅ Persists payment refs to disk (reduces missed confirmations after restart)
 * ✅ Admin messages PLAIN TEXT by default (no Markdown parse errors)
 * ✅ Admin receives ONLY key messages: start, document received, PAYMENT COMPLETE/FAILED
 *
 * PRICING + SETTINGS:
 * ✅ CHECK price: 140 KES
 * ✅ RECHECK price: 130 KES
 * ✅ Inactive window: 12:00 AM – 6:00 AM EAT (resume 6:00 AM)
 * ✅ Queue message: reports take 10–20 minutes (queue)
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const moment = require("moment");
const IntaSend = require("intasend-node");
const qs = require("querystring");

// =====================
// ENV + CONSTANTS
// =====================
const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error("❌ BOT_TOKEN is missing in .env file");
  process.exit(1);
}

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://jk-turnitin-telegram-bot-1.onrender.com";

const INTASEND_WEBHOOK_CHALLENGE =
  process.env.INTASEND_WEBHOOK_CHALLENGE || "";

// IMPORTANT: For live use set INTASEND_TEST_ENVIRONMENT=false
const INTASEND_TEST =
  String(process.env.INTASEND_TEST_ENVIRONMENT || "true").toLowerCase() === "true";

const INTASEND_PUBLISHABLE_KEY = process.env.INTASEND_PUBLISHABLE_KEY || "";
const INTASEND_SECRET_KEY = process.env.INTASEND_SECRET_KEY || "";
if (!INTASEND_PUBLISHABLE_KEY || !INTASEND_SECRET_KEY) {
  console.error("❌ Missing INTASEND_PUBLISHABLE_KEY or INTASEND_SECRET_KEY in environment variables");
  process.exit(1);
}

// ⭐ Your Telegram numeric ID
const ADMIN_ID = 6569201830;

// 💰 Pricing (UPDATED)
const CHECK_PRICE_KES = 140;
const RECHECK_PRICE_KES = 130;

// OPTIONAL fallback till (only used if STK fails repeatedly)
const FALLBACK_TILL = "6164915"; // if you decide to use fallback, keep it here

// Buttons
const KEY_SEND_DOC = "📄 Send Document";
const KEY_SEND_MPESA = "🧾 Payment Help";
const KEY_CANCEL = "❌ Cancel / New submission";

// Stages
const STAGE_WAIT_TYPE = "WAIT_TYPE";
const STAGE_WAIT_PHONE = "WAIT_PHONE";
const STAGE_WAIT_PAYMENT = "WAIT_PAYMENT";

// Payment retry limits
const STK_RESEND_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
const STK_MAX_RESENDS = 3;
const PAYMENT_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes after STK, if no confirmation -> reminder

// =====================
// BOT STATE
// =====================
const bot = new Telegraf(botToken);

const intasend = new IntaSend(
  INTASEND_PUBLISHABLE_KEY,
  INTASEND_SECRET_KEY,
  INTASEND_TEST
);
const collection = intasend.collection();

const pendingFileTargets = {};

// submissions[userId] = {
//   stage, kind, amount, api_ref, phone, paid,
//   createdAt, stkSentAt, resendCount, invoiceId
// }
const submissions = {};

// paymentRefs[api_ref] = { userId, kind, amount, createdAt }
let paymentRefs = {};
const confirmedRefs = new Set(); // prevent double confirmations

// =====================
// PERSISTENCE (DISK)
// =====================
const STORE_FILE = path.join(__dirname, "paymentRefs.store.json");

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") paymentRefs = parsed;
    }
  } catch (e) {
    console.error("⚠️ Failed to load store:", e?.message || e);
  }
}

function saveStore() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(paymentRefs, null, 2), "utf8");
  } catch (e) {
    console.error("⚠️ Failed to save store:", e?.message || e);
  }
}

function putPaymentRef(api_ref, value) {
  paymentRefs[api_ref] = value;
  saveStore();
}

function getPaymentRef(api_ref) {
  return paymentRefs[api_ref] || null;
}

loadStore();

// Cleanup old refs (keep store small)
function cleanupOldPaymentRefs() {
  const now = Date.now();
  const cutoff = 7 * 24 * 60 * 60 * 1000; // 7 days
  let changed = false;
  for (const [k, v] of Object.entries(paymentRefs)) {
    if (!v?.createdAt) continue;
    if (now - v.createdAt > cutoff) {
      delete paymentRefs[k];
      changed = true;
    }
  }
  if (changed) saveStore();
}
setInterval(cleanupOldPaymentRefs, 6 * 60 * 60 * 1000); // every 6 hours

// =====================
// HELPERS
// =====================

/**
 * ✅ Inactive window: 12:00 AM – 6:00 AM EAT
 * EAT = UTC+3
 * So UTC inactive = 21:00 – 03:00 (end exclusive)
 */
const INACTIVE_START_UTC = "21:00"; // 00:00 EAT
const INACTIVE_END_UTC = "03:00";   // 06:00 EAT (end exclusive)

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

// Admin quick commands (Markdown only)
function adminQuickCommands(userId) {
  return `\n\n\`/file2 ${userId}\`\n\`/reply ${userId}\``;
}

// Admin logs as plain text
async function sendAdminMessage(text) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text);
  } catch (err) {
    console.error("Error sending message to admin:", err?.message || err);
  }
}

// Admin message with Markdown (only when needed)
async function sendAdminMessageMarkdown(text) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Admin markdown send failed:", err?.message || err);
    try { await bot.telegram.sendMessage(ADMIN_ID, text); } catch {}
  }
}

function makeApiRef(userId, kind) {
  return `JK_${kind}_${userId}_${Date.now()}`;
}

/**
 * Accepts Kenyan numbers:
 * - 07XXXXXXXX  -> 2547XXXXXXXX
 * - 01XXXXXXXX  -> 2541XXXXXXXX
 * - 2547XXXXXXXX / +2547XXXXXXXX
 * - 2541XXXXXXXX / +2541XXXXXXXX
 * - 7XXXXXXXX / 1XXXXXXXX -> 2547XXXXXXXX / 2541XXXXXXXX (optional convenience)
 */
function normalizePhoneTo254(phoneRaw) {
  const t = String(phoneRaw || "").trim().replace(/\s+/g, "");
  if (!t) return null;

  if (t.startsWith("+")) {
    const x = t.slice(1);
    if (/^254(?:7|1)\d{8}$/.test(x)) return x;
    return null;
  }

  if (/^254(?:7|1)\d{8}$/.test(t)) return t;
  if (/^0(?:7|1)\d{8}$/.test(t)) return "254" + t.slice(1);
  if (/^(?:7|1)\d{8}$/.test(t)) return "254" + t;

  return null;
}

function typeInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`✅ CHECK (${CHECK_PRICE_KES} KES)`, "TYPE_CHECK")],
    [Markup.button.callback(`🔁 RECHECK (${RECHECK_PRICE_KES} KES)`, "TYPE_RECHECK")],
    [Markup.button.callback("❌ Cancel", "TYPE_CANCEL")]
  ]);
}

function paymentWaitKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔁 Resend STK Push", "STK_RESEND")],
    [Markup.button.callback("📞 Change phone number", "STK_CHANGE_PHONE")],
    [Markup.button.callback("❌ Cancel", "TYPE_CANCEL")]
  ]);
}

async function notifyInactivePeriod(ctx) {
  await replyMarkdownSafe(
    ctx,
    "⏳ Turnitin checks are paused right now.\n" +
      "We’ll resume at *6:00 AM EAT*.\n\n" +
      "✅ You can still send your document now — it will be received.\n" +
      "⚠️ Payment prompts will only be sent after 6:00 AM.\n\n" +
      "If urgent, WhatsApp call *0701730921*.",
    { reply_markup: mainKeyboard() }
  );
}

// ====== IntaSend webhook extraction helpers ======
function extractApiRef(payload) {
  return (
    payload.api_ref ||
    payload.apiRef ||
    payload.invoice?.api_ref ||
    payload.invoice?.apiRef ||
    payload.data?.api_ref ||
    payload.data?.apiRef ||
    payload.payload?.api_ref ||
    payload.payload?.apiRef
  );
}

function extractState(payload) {
  return (
    payload.state ||
    payload.status ||
    payload.invoice?.state ||
    payload.invoice?.status ||
    payload.data?.state ||
    payload.data?.status ||
    payload.payload?.state ||
    payload.payload?.status
  );
}

function extractInvoiceId(payload) {
  return (
    payload.invoice_id ||
    payload.invoice?.invoice_id ||
    payload.data?.invoice_id ||
    payload.payload?.invoice_id ||
    ""
  );
}

function recoverRefFromApiRef(apiRef) {
  const m = /^JK_(CHECK|RECHECK)_(\d+)_/.exec(String(apiRef || ""));
  if (!m) return null;
  return { kind: m[1], userId: Number(m[2]) };
}

// Normalize state from webhook
function normalizeWebhookState(raw) {
  const s = String(raw || "").trim().toUpperCase();
  // IntaSend may send COMPLETE/COMPLETED/SUCCESS etc depending on integration
  if (["COMPLETE", "COMPLETED", "SUCCESS", "SUCCEEDED"].includes(s)) return "COMPLETE";
  if (["FAILED", "FAIL", "ERROR"].includes(s)) return "FAILED";
  if (["CANCELLED", "CANCELED"].includes(s)) return "CANCELLED";
  if (["EXPIRED", "TIMEOUT", "TIMEDOUT"].includes(s)) return "EXPIRED";
  if (["PENDING", "PROCESSING", "IN_PROGRESS", "INPROGRESS"].includes(s)) return "PENDING";
  return s || "UNKNOWN";
}

// Send user a consistent queue message after confirmation
function buildConfirmedUserMessage(kind, amount) {
  return (
    `✅ Payment confirmed${amount ? ` (${amount} KES)` : ""} for *${kind}*.\n` +
    `⏱ Reports take *10–20 minutes* (queue).`
  );
}

// Payment timeout reminder
async function schedulePaymentTimeoutReminder(userId, apiRef) {
  setTimeout(async () => {
    const sub = submissions[userId];
    if (!sub) return;
    if (sub.paid) return;
    if (sub.api_ref !== apiRef) return;
    if (sub.stage !== STAGE_WAIT_PAYMENT) return;

    await replyMarkdownSafe(
      { reply: (m, e) => bot.telegram.sendMessage(userId, m, { parse_mode: "Markdown", ...e }) },
      "⏳ Still waiting for payment confirmation.\n\n" +
        "If you did not receive the STK prompt, tap *Resend STK Push* below or *Change phone number*.",
      { reply_markup: paymentWaitKeyboard().reply_markup }
    );
  }, PAYMENT_TIMEOUT_MS);
}

// =====================
// START / WELCOME
// =====================
const WELCOME_MESSAGE = `
JK Turnitin Reports Bot

1️⃣ Send your document as a *file* (DOC/PDF).
2️⃣ Choose CHECK or RECHECK.
3️⃣ Enter your Safaricom number to receive an STK prompt.

💰 Pricing
• Check: ${CHECK_PRICE_KES} KES
• Recheck: ${RECHECK_PRICE_KES} KES
`;

bot.start(async (ctx) => {
  const user = ctx.from;

  if (user.id === ADMIN_ID) {
    await replyMarkdownSafe(
      ctx,
      "👋 Admin mode is ready.\n\n📩 Reply as bot:\n`/reply <userId> <message>`\n\n📁 Send file(s) as bot:\n`/file <userId> Optional caption`\n`/file2 <userId> Optional caption`"
    );
    return;
  }

  if (isBotInactivePeriod()) {
    await notifyInactivePeriod(ctx);
    // still log start to admin
    await sendAdminMessage(
      `🔥 New user started bot (inactive hours):\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
        user.username || "N/A"
      )}\nUser ID: ${user.id}`
    );
    await sendAdminMessageMarkdown(adminQuickCommands(user.id));
    return;
  }

  await replyMarkdownSafe(ctx, WELCOME_MESSAGE, { reply_markup: mainKeyboard() });

  await sendAdminMessage(
    `🔥 New user started the bot:\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nUser ID: ${user.id}`
  );
  await sendAdminMessageMarkdown(adminQuickCommands(user.id));
});

// =====================
// BUTTON HANDLERS
// =====================
bot.hears(KEY_SEND_DOC, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(
    ctx,
    "📄 Tap 📎 → *File* → select DOC/PDF → send here.\n(Please don’t send as a photo.)",
    { reply_markup: mainKeyboard() }
  );
});

bot.hears(KEY_SEND_MPESA, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(
    ctx,
    "🧾 Payment help:\n\n" +
      "✅ Default method: *STK Push*\n" +
      "Send a document → choose CHECK/RECHECK → enter phone → receive STK prompt.\n\n" +
      "If STK prompt delays, you can tap *Resend STK Push* once available.",
    { reply_markup: mainKeyboard() }
  );
});

bot.hears(KEY_CANCEL, async (ctx) => {
  const userId = ctx.from.id;

  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) {
    // allow cancel anyway, but just clear local
    delete submissions[userId];
    return notifyInactivePeriod(ctx);
  }

  delete submissions[userId];

  await sendAdminMessage(
    `❌ User cancelled submission:\nName: ${safeText(ctx.from.first_name)} ${safeText(ctx.from.last_name)}\nUsername: @${safeText(
      ctx.from.username || "N/A"
    )}\nUser ID: ${userId}\nTime (EAT): ${moment().utcOffset(3).format("YYYY-MM-DD HH:mm")}`
  );
  await sendAdminMessageMarkdown(adminQuickCommands(userId));

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
    await ctx.reply(`✅ Message sent to user ${userId}`);
  } catch (err) {
    await ctx.reply("❌ Failed: " + (err?.message || err));
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

  // ADMIN sending doc to user (always allowed)
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];
    if (!target) return replyMarkdownSafe(ctx, "Use `/file <userId>` or `/file2 <userId>` first.");

    const { userId, caption } = target;
    const doc = ctx.message.document;

    target.remaining = (target.remaining || 1) - 1;

    try {
      await bot.telegram.sendDocument(userId, doc.file_id, { caption: caption || undefined });
      if (target.remaining <= 0) delete pendingFileTargets[ADMIN_ID];
      await ctx.reply(`✅ File sent to user ${userId}`);
    } catch (err) {
      await ctx.reply("❌ Failed: " + (err?.message || err));
    }
    return;
  }

  // USER doc: ALWAYS forward to admin (even inactive)
  await sendAdminMessage(
    `📨 Document from user:\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nUser ID: ${user.id}`
  );
  await sendAdminMessageMarkdown(adminQuickCommands(user.id));

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch (err) {
    console.error("Forward doc error:", err?.message || err);
  }

  // ✅ If inactive: DO NOT start payment flow
  if (isBotInactivePeriod()) {
    await notifyInactivePeriod(ctx);
    return;
  }

  // Start submission flow
  submissions[user.id] = {
    stage: STAGE_WAIT_TYPE,
    kind: null,
    amount: null,
    api_ref: null,
    phone: null,
    paid: false,
    createdAt: Date.now(),
    stkSentAt: null,
    resendCount: 0,
    invoiceId: ""
  };

  await ctx.reply("📄 File received.\n\nChoose:", typeInlineKeyboard());
});

// =====================
// PHOTO HANDLER
// =====================
bot.on("photo", async (ctx) => {
  const user = ctx.from;

  // ADMIN sending photo (always allowed)
  if (user.id === ADMIN_ID) {
    const target = pendingFileTargets[ADMIN_ID];
    if (!target) return replyMarkdownSafe(ctx, "Use `/file <userId>` or `/file2 <userId>` first.");

    const { userId, caption } = target;
    const photos = ctx.message.photo || [];
    const largest = photos[photos.length - 1];

    target.remaining = (target.remaining || 1) - 1;

    try {
      await bot.telegram.sendPhoto(userId, largest.file_id, { caption: caption || undefined });
      if (target.remaining <= 0) delete pendingFileTargets[ADMIN_ID];
      await ctx.reply(`✅ Photo sent to user ${userId}`);
    } catch (err) {
      await ctx.reply("❌ Failed: " + (err?.message || err));
    }
    return;
  }

  // USER photo: ALWAYS forward to admin (even inactive)
  await sendAdminMessage(
    `🖼️ Photo from user:\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nUser ID: ${user.id}`
  );
  await sendAdminMessageMarkdown(adminQuickCommands(user.id));

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch (err) {
    console.error("Forward photo error:", err?.message || err);
  }

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  await ctx.reply("✅ Received.", { reply_markup: mainKeyboard() });
});

// =====================
// INLINE TYPE SELECTION
// =====================
bot.action("TYPE_CHECK", async (ctx) => {
  const userId = ctx.from.id;

  if (isBotInactivePeriod()) {
    await ctx.answerCbQuery("Paused. Resume 6AM EAT.");
    return notifyInactivePeriod(ctx);
  }

  const sub = submissions[userId];
  if (!sub || sub.stage !== STAGE_WAIT_TYPE) return ctx.answerCbQuery("No pending submission.");

  sub.kind = "CHECK";
  sub.amount = CHECK_PRICE_KES;
  sub.api_ref = makeApiRef(userId, "CHECK");
  putPaymentRef(sub.api_ref, { userId, kind: sub.kind, amount: sub.amount, createdAt: Date.now() });
  sub.stage = STAGE_WAIT_PHONE;

  await ctx.answerCbQuery("CHECK selected");
  await ctx.reply(
    `✅ CHECK (${CHECK_PRICE_KES} KES).\nSend phone (07XXXXXXXX or 01XXXXXXXX or 2547XXXXXXXX or 2541XXXXXXXX).`,
    { reply_markup: mainKeyboard() }
  );
});

bot.action("TYPE_RECHECK", async (ctx) => {
  const userId = ctx.from.id;

  if (isBotInactivePeriod()) {
    await ctx.answerCbQuery("Paused. Resume 6AM EAT.");
    return notifyInactivePeriod(ctx);
  }

  const sub = submissions[userId];
  if (!sub || sub.stage !== STAGE_WAIT_TYPE) return ctx.answerCbQuery("No pending submission.");

  sub.kind = "RECHECK";
  sub.amount = RECHECK_PRICE_KES;
  sub.api_ref = makeApiRef(userId, "RECHECK");
  putPaymentRef(sub.api_ref, { userId, kind: sub.kind, amount: sub.amount, createdAt: Date.now() });
  sub.stage = STAGE_WAIT_PHONE;

  await ctx.answerCbQuery("RECHECK selected");
  await ctx.reply(
    `🔁 RECHECK (${RECHECK_PRICE_KES} KES).\nSend phone (07XXXXXXXX or 01XXXXXXXX or 2547XXXXXXXX or 2541XXXXXXXX).`,
    { reply_markup: mainKeyboard() }
  );
});

bot.action("TYPE_CANCEL", async (ctx) => {
  delete submissions[ctx.from.id];
  await ctx.answerCbQuery("Cancelled");
  await ctx.reply("❌ Cancelled. Send a new document to start again.", { reply_markup: mainKeyboard() });
});

// =====================
// STK RESEND / CHANGE PHONE
// =====================
bot.action("STK_CHANGE_PHONE", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];
  if (!sub) return ctx.answerCbQuery("No active session.");

  if (isBotInactivePeriod()) {
    await ctx.answerCbQuery("Paused. Resume 6AM EAT.");
    return notifyInactivePeriod(ctx);
  }

  sub.stage = STAGE_WAIT_PHONE;
  sub.phone = null;

  await ctx.answerCbQuery("Send new phone");
  await ctx.reply("📞 Send your phone number again (07XXXXXXXX / 01XXXXXXXX / 2547XXXXXXXX / 2541XXXXXXXX).", {
    reply_markup: mainKeyboard()
  });
});

bot.action("STK_RESEND", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];
  if (!sub) return ctx.answerCbQuery("No active session.");
  if (isBotInactivePeriod()) {
    await ctx.answerCbQuery("Paused. Resume 6AM EAT.");
    return notifyInactivePeriod(ctx);
  }

  if (sub.stage !== STAGE_WAIT_PAYMENT) return ctx.answerCbQuery("Not waiting for payment.");

  if (!sub.phone || !sub.api_ref || !sub.amount) return ctx.answerCbQuery("Missing payment details.");

  if (sub.resendCount >= STK_MAX_RESENDS) {
    await ctx.answerCbQuery("Resend limit reached.");
    await ctx.reply("⚠️ Resend limit reached. Tap *Change phone number* or cancel and start again.", {
      parse_mode: "Markdown",
      reply_markup: paymentWaitKeyboard().reply_markup
    });
    return;
  }

  if (sub.stkSentAt && Date.now() - sub.stkSentAt < STK_RESEND_COOLDOWN_MS) {
    await ctx.answerCbQuery("Please wait a bit.");
    return;
  }

  sub.resendCount += 1;

  await ctx.answerCbQuery("Resending STK...");
  await ctx.reply("⏳ Resending STK Push… check your phone and enter PIN.");

  try {
    const resp = await collection.mpesaStkPush({
      first_name: safeText(ctx.from.first_name || "Customer"),
      last_name: safeText(ctx.from.last_name || "User"),
      email: `${userId}@jkturnitin.local`,
      host: PUBLIC_BASE_URL,
      amount: sub.amount,
      phone_number: sub.phone,
      api_ref: sub.api_ref
    });

    // store invoiceId if available
    sub.invoiceId = safeText(resp?.invoice_id || resp?.invoice?.invoice_id || resp?.invoiceId || sub.invoiceId);

    sub.stkSentAt = Date.now();

    await ctx.reply("✅ STK Push resent. Pay on your phone — confirmation is automatic.", {
      reply_markup: mainKeyboard()
    });
    await ctx.reply("Waiting for payment confirmation…", {
      reply_markup: paymentWaitKeyboard().reply_markup
    });

    schedulePaymentTimeoutReminder(userId, sub.api_ref);
  } catch (err) {
    await ctx.reply("❌ STK resend failed. Try again in 1 minute or change phone number.", {
      reply_markup: paymentWaitKeyboard().reply_markup
    });

    await sendAdminMessage(
      `❌ STK RESEND error:\nUser ID: ${userId}\napi_ref: ${safeText(sub.api_ref)}\nError: ${safeText(err?.message || err)}`
    );
  }
});

// =====================
// TEXT HANDLER (phone processing first)
// =====================
bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = (ctx.message.text || "").trim();

  if (text.startsWith("/")) return;
  if (user.id === ADMIN_ID) return;

  // ✅ during inactive: do NOT allow phone / STK flow
  if (isBotInactivePeriod()) {
    // still forward messages to admin (optional: keep it minimal)
    await sendAdminMessage(
      `💬 Message from user (inactive hours):\nUser ID: ${user.id}\nUsername: @${safeText(user.username || "N/A")}\n\n${safeText(text)}`
    );
    return notifyInactivePeriod(ctx);
  }

  const sub = submissions[user.id];

  // If waiting payment -> keep user on controls, do not accept random text
  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    await ctx.reply("Waiting for payment confirmation…", {
      reply_markup: paymentWaitKeyboard().reply_markup
    });
    return;
  }

  // Phone entry step
  if (sub && sub.stage === STAGE_WAIT_PHONE) {
    const phone254 = normalizePhoneTo254(text);
    if (!phone254) {
      return ctx.reply("❌ Invalid phone. Send like 07XXXXXXXX / 01XXXXXXXX / 2547XXXXXXXX / 2541XXXXXXXX.");
    }

    sub.phone = phone254;

    // We only set WAIT_PAYMENT after STK call succeeds.
    await ctx.reply("⏳ Sending STK Push… check your phone and enter PIN.");

    try {
      const resp = await collection.mpesaStkPush({
        first_name: safeText(user.first_name || "Customer"),
        last_name: safeText(user.last_name || "User"),
        email: `${user.id}@jkturnitin.local`,
        host: PUBLIC_BASE_URL,
        amount: sub.amount,
        phone_number: sub.phone,
        api_ref: sub.api_ref
      });

      sub.invoiceId = safeText(resp?.invoice_id || resp?.invoice?.invoice_id || resp?.invoiceId || "");
      sub.stage = STAGE_WAIT_PAYMENT;
      sub.stkSentAt = Date.now();
      sub.resendCount = 0;

      await ctx.reply("✅ STK Push sent. Pay on your phone — confirmation is automatic.");
      await ctx.reply("Waiting for payment confirmation…", {
        reply_markup: paymentWaitKeyboard().reply_markup
      });

      schedulePaymentTimeoutReminder(user.id, sub.api_ref);
    } catch (err) {
      sub.stage = STAGE_WAIT_PHONE;

      await ctx.reply(
        "❌ STK Push failed.\n\n" +
          "Please try again in 1 minute (send your phone number again).",
        { reply_markup: mainKeyboard() }
      );

      await sendAdminMessage(
        `❌ STK Push error:\nUser ID: ${user.id}\napi_ref: ${safeText(sub.api_ref)}\nError: ${safeText(err?.message || err)}\nTestEnv: ${INTASEND_TEST}`
      );
    }
    return;
  }

  // Forward other messages to admin (minimal)
  await sendAdminMessage(
    `💬 Message from user:\nUser ID: ${user.id}\nUsername: @${safeText(user.username || "N/A")}\n\n${safeText(text)}`
  );

  if (!sub) return ctx.reply("Send your document first to start.", { reply_markup: mainKeyboard() });
  if (sub.stage === STAGE_WAIT_TYPE) return ctx.reply("Please choose CHECK or RECHECK using the buttons.");
});

// =====================
// EXPRESS SERVER + WEBHOOKS
// =====================
const app = express();

// Capture raw body for fallback parsing
app.use(
  express.json({
    limit: "2mb",
    verify: (req, res, buf) => {
      req.rawBody = buf?.toString() || "";
    }
  })
);
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      req.rawBody = buf?.toString() || "";
    }
  })
);

app.use(bot.webhookCallback("/webhook"));

bot.telegram.setWebhook(`${PUBLIC_BASE_URL}/webhook`).catch((e) => {
  console.error("Failed to set Telegram webhook:", e?.message || e);
});

// Health
app.get("/", (req, res) => res.status(200).send("OK"));

// IntaSend webhook challenge (GET)
app.get("/intasend/webhook", (req, res) => {
  const qChallenge = req.query?.challenge;
  if (!qChallenge) return res.status(200).send("OK");

  if (INTASEND_WEBHOOK_CHALLENGE && qChallenge !== INTASEND_WEBHOOK_CHALLENGE) {
    return res.status(401).send("Invalid challenge");
  }
  return res.status(200).send(qChallenge);
});

// IntaSend webhook (POST)
app.post("/intasend/webhook", (req, res) => {
  // ACK immediately to avoid timeouts
  res.status(200).json({ ok: true });

  setImmediate(async () => {
    try {
      let payload = req.body;

      const bodyIsEmptyObj =
        payload && typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload).length === 0;

      if (!payload || typeof payload === "string" || bodyIsEmptyObj) {
        const raw = (req.rawBody || "").trim();
        if (raw) {
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = qs.parse(raw);
          }
        } else {
          payload = {};
        }
      }

      // Optional challenge guard
      if (payload.challenge && INTASEND_WEBHOOK_CHALLENGE && payload.challenge !== INTASEND_WEBHOOK_CHALLENGE) {
        await sendAdminMessage("⚠️ IntaSend webhook: invalid challenge received.");
        return;
      }

      const apiRef = extractApiRef(payload);
      const stateRaw = extractState(payload);
      const invoiceId = extractInvoiceId(payload);

      const state = normalizeWebhookState(stateRaw);

      if (!apiRef) return;

      // Avoid double processing COMPLETE
      if (state === "COMPLETE") {
        if (confirmedRefs.has(apiRef)) return;
        confirmedRefs.add(apiRef);
      }

      // Resolve user
      let ref = getPaymentRef(apiRef);
      if (!ref) {
        const recovered = recoverRefFromApiRef(apiRef);
        if (recovered) {
          ref = { userId: recovered.userId, kind: recovered.kind, amount: null, createdAt: Date.now() };
          // store so we don’t lose it again
          putPaymentRef(apiRef, ref);
        }
      }

      if (!ref) {
        // This is a major reason confirmations “vanish”
        await sendAdminMessage(`⚠️ Webhook received but api_ref not recognized: ${apiRef}\nState: ${state}`);
        return;
      }

      const userId = ref.userId;
      const kind = ref.kind || "CHECK/RECHECK";
      const amount = ref.amount || "";

      // Update submission if present
      const sub = submissions[userId];
      if (sub && sub.api_ref === apiRef) {
        sub.invoiceId = safeText(invoiceId || sub.invoiceId);
      }

      if (state === "COMPLETE") {
        if (sub && sub.api_ref === apiRef) {
          sub.paid = true;
          sub.stage = "PAID";
        }

        // Notify user
        try {
          await bot.telegram.sendMessage(userId, buildConfirmedUserMessage(kind, amount), { parse_mode: "Markdown" });
        } catch (e) {
          await sendAdminMessage(`❌ Could not message user ${userId}. Error: ${safeText(e?.message || e)}`);
        }

        // Notify admin (key only)
        await sendAdminMessage(
          `✅ PAYMENT COMPLETE:\nUser ID: ${userId}\nType: ${kind}\nAmount: ${amount ? `${amount} KES` : "N/A"}\napi_ref: ${apiRef}\ninvoice_id: ${safeText(invoiceId)}`
        );
        await sendAdminMessageMarkdown(adminQuickCommands(userId));
        return;
      }

      // Handle failure/cancel/expiry and let user retry
      if (["FAILED", "CANCELLED", "EXPIRED"].includes(state)) {
        if (sub && sub.api_ref === apiRef) {
          sub.paid = false;
          sub.stage = STAGE_WAIT_PAYMENT; // keep them in a retry-able state
        }

        try {
          await bot.telegram.sendMessage(
            userId,
            `❌ Payment ${state.toLowerCase()} for *${kind}*.\n\n` +
              `Tap *Resend STK Push* or *Change phone number* to try again.`,
            { parse_mode: "Markdown", reply_markup: paymentWaitKeyboard().reply_markup }
          );
        } catch (e) {
          await sendAdminMessage(`❌ Could not message user ${userId}. Error: ${safeText(e?.message || e)}`);
        }

        await sendAdminMessage(
          `⚠️ PAYMENT ${state}:\nUser ID: ${userId}\nType: ${kind}\napi_ref: ${apiRef}\ninvoice_id: ${safeText(invoiceId)}`
        );
        await sendAdminMessageMarkdown(adminQuickCommands(userId));
        return;
      }

      // Pending/unknown state: don’t spam user/admin; log only if you want
      // If you want visibility, uncomment below:
      // await sendAdminMessage(`ℹ️ PAYMENT STATE: ${state}\nUser ID: ${userId}\napi_ref: ${apiRef}`);

    } catch (err) {
      console.error("Async IntaSend processing error:", err?.message || err);
    }
  });
});

// =====================
// START SERVER
// =====================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Webhook server listening on port ${port}`);
  console.log(`IntaSend test env: ${INTASEND_TEST}`);
});

// Graceful stops
process.once("SIGINT", () => {
  try { bot.stop("SIGINT"); } catch {}
});
process.once("SIGTERM", () => {
  try { bot.stop("SIGTERM"); } catch {}
});
