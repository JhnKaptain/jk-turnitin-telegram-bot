/**
 * JK Turnitin Reports Bot — Telegraf + Express Webhook
 * + IntaSend STK Push (default) + Webhook confirmation
 *
 * FINAL FIXES:
 * ✅ Forces valid PUBLIC_BASE_URL (required for Telegram webhook + IntaSend host)
 * ✅ Correct key selection based on INTASEND_TEST_ENVIRONMENT:
 *    - TEST uses INTASEND_TEST_PUBLISHABLE_KEY / INTASEND_TEST_SECRET_KEY
 *    - LIVE uses INTASEND_LIVE_PUBLISHABLE_KEY / INTASEND_LIVE_SECRET_KEY
 * ✅ Clear admin logs for IntaSend errors (shows real rejection reason)
 * ✅ No double prompt messages; Till note only on RESEND success
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
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing");
  process.exit(1);
}

function sanitizeBaseUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  u = u.replace(/\/+$/, "");
  if (u.startsWith("http://")) u = "https://" + u.slice("http://".length);
  if (!u.startsWith("https://")) return "";
  return u;
}

const PUBLIC_BASE_URL = sanitizeBaseUrl(
  process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || ""
);

if (!PUBLIC_BASE_URL) {
  console.error("❌ PUBLIC_BASE_URL is missing/invalid.");
  console.error("✅ Set Render env: PUBLIC_BASE_URL=https://<your-service>.onrender.com");
  process.exit(1);
}

const INTASEND_WEBHOOK_CHALLENGE = process.env.INTASEND_WEBHOOK_CHALLENGE || "";

// IMPORTANT: For live use set INTASEND_TEST_ENVIRONMENT=false
const INTASEND_TEST =
  String(process.env.INTASEND_TEST_ENVIRONMENT || "true").toLowerCase() === "true";

// ✅ STRICT key selection by environment (prevents accidental mixing)
const INTASEND_PUBLISHABLE_KEY = INTASEND_TEST
  ? (process.env.INTASEND_TEST_PUBLISHABLE_KEY || "")
  : (process.env.INTASEND_LIVE_PUBLISHABLE_KEY || "");

const INTASEND_SECRET_KEY = INTASEND_TEST
  ? (process.env.INTASEND_TEST_SECRET_KEY || "")
  : (process.env.INTASEND_LIVE_SECRET_KEY || "");

function maskKey(k) {
  const s = String(k || "");
  if (s.length <= 8) return "********";
  return s.slice(0, 4) + "..." + s.slice(-4);
}

if (!INTASEND_PUBLISHABLE_KEY || !INTASEND_SECRET_KEY) {
  console.error("❌ Missing IntaSend keys for the selected environment.");
  console.error(`   INTASEND_TEST_ENVIRONMENT=${INTASEND_TEST}`);
  console.error(
    INTASEND_TEST
      ? "   Need: INTASEND_TEST_PUBLISHABLE_KEY and INTASEND_TEST_SECRET_KEY"
      : "   Need: INTASEND_LIVE_PUBLISHABLE_KEY and INTASEND_LIVE_SECRET_KEY"
  );
  process.exit(1);
}

const ADMIN_ID = 6569201830;

// Pricing
const CHECK_PRICE_KES = 140;
const RECHECK_PRICE_KES = 130;

// Till instructions (manual)
const TILL_NUMBER = "6164915";

// Inactive window: 12:00 AM – 6:00 AM EAT (UTC+3 => UTC 21:00–03:00)
const INACTIVE_START_UTC = "21:00";
const INACTIVE_END_UTC = "03:00";

// Buttons
const KEY_SEND_DOC = "📄 Send Document";
const KEY_SEND_MPESA = "🧾 Payment Help";
const KEY_CANCEL = "❌ Cancel / New submission";

// Stages
const STAGE_WAIT_TYPE = "WAIT_TYPE";
const STAGE_WAIT_PHONE = "WAIT_PHONE";
const STAGE_WAIT_PAYMENT = "WAIT_PAYMENT";
const STAGE_PAID = "PAID";

// Retry behavior
const STK_RESEND_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
const STK_MAX_RESENDS = 3;
const PAYMENT_TIMEOUT_MS = 6 * 60 * 1000;

// =====================
// MESSAGES
// =====================
const MESSAGES = {
  welcome: (check, recheck) => `
JK Turnitin Reports Bot

1️⃣ Send your document as a *file* (DOC/PDF).
2️⃣ Choose CHECK or RECHECK.
3️⃣ Enter your Safaricom number to receive an STK prompt.

💰 Pricing
• Check: ${check} KES
• Recheck: ${recheck} KES
`,
  inactive: `
⏳ Turnitin checks are paused right now.
We’ll resume at *6:00 AM EAT*.

✅ You can still send your document now — it will be received.
⚠️ Payment prompts will only be sent after 6:00 AM.

If urgent, WhatsApp call *0701730921*.
`,
  sendDocHelp:
    "📄 Tap 📎 → *File* → select DOC/PDF → send here.\n(Please don’t send as a photo.)",
  paymentHelp:
    "🧾 Payment help:\n\n✅ Default method: *STK Push*\nSend a document → choose CHECK/RECHECK → enter phone → receive STK prompt.\n\nIf prompt delays/fails, tap *Resend STK Push*.",
  askPhone: (kind, amount) =>
    `${kind} (${amount} KES).\nSend phone (07XXXXXXXX or 01XXXXXXXX or 2547XXXXXXXX or 2541XXXXXXXX).`,
  stkSending: "⏳ Sending STK Push… check your phone and enter PIN.",
  stkSentSimple: "✅ STK Push sent. Pay on your phone — confirmation is automatic.",
  stkSentWithTill: (till) =>
    `✅ STK Push sent. Pay on your phone — confirmation is automatic.\n\n` +
    `If prompt fails, pay via Till *${till}* and send proof here.`,
  waitingConfirm: "Waiting for payment confirmation…",
  queueMsg: (kind, amount) =>
    `✅ Payment confirmed${amount ? ` (${amount} KES)` : ""} for *${kind}*.\n⏱ Reports take *10–20 minutes* (queue).`,
};

// =====================
// BOT STATE
// =====================
const bot = new Telegraf(BOT_TOKEN);

const intasend = new IntaSend(INTASEND_PUBLISHABLE_KEY, INTASEND_SECRET_KEY, INTASEND_TEST);
const collection = intasend.collection();

const pendingFileTargets = {};
const submissions = {}; // userId -> session

let paymentRefs = {};
const confirmedRefs = new Set();

// =====================
// PERSISTENCE
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

// =====================
// HELPERS
// =====================
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
  return `\n\n\`/file2 ${userId}\`\n\`/reply ${userId}\`\n\`/markpaid ${userId} MPESA_REF\``;
}
async function sendAdminMessage(text) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text);
  } catch {}
}
async function sendAdminMessageMarkdown(text) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
  } catch {
    try { await bot.telegram.sendMessage(ADMIN_ID, text); } catch {}
  }
}
function makeApiRef(userId, kind) {
  return `JK_${kind}_${userId}_${Date.now()}`;
}
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

function paymentWaitKeyboard(sub) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔁 Resend STK Push", "STK_RESEND")],
    [Markup.button.callback("📞 Change phone number", "STK_CHANGE_PHONE")],
    [Markup.button.callback("❌ Cancel", "TYPE_CANCEL")]
  ]);
}

async function notifyInactivePeriod(ctx) {
  await replyMarkdownSafe(ctx, MESSAGES.inactive.trim(), { reply_markup: mainKeyboard() });
}

function schedulePaymentTimeoutReminder(userId, apiRef) {
  setTimeout(async () => {
    const sub = submissions[userId];
    if (!sub) return;
    if (sub.paid) return;
    if (sub.api_ref !== apiRef) return;
    if (sub.stage !== STAGE_WAIT_PAYMENT) return;

    try {
      await bot.telegram.sendMessage(
        userId,
        "⏳ Still waiting for payment confirmation.\n\nIf you did not receive the STK prompt, tap *Resend STK Push*.",
        { parse_mode: "Markdown", reply_markup: paymentWaitKeyboard(sub).reply_markup }
      );
    } catch {}
  }, PAYMENT_TIMEOUT_MS);
}

// =====================
// STK PUSH
// =====================
function formatIntaSendError(err) {
  const msg = err?.message || "";
  const desc = err?.description || "";
  const response = err?.response ? JSON.stringify(err.response) : "";
  const data = err?.data ? JSON.stringify(err.data) : "";
  const body = err?.body ? JSON.stringify(err.body) : "";
  const any = JSON.stringify(err, null, 2);
  // keep it compact
  return [desc, msg, response, data, body, any].filter(Boolean).slice(0, 2).join("\n");
}

async function attemptStkPush(ctx, sub, { mode }) {
  const userId = ctx.from.id;

  if (!sub?.phone || !sub?.api_ref || !sub?.amount) {
    sub.stage = STAGE_WAIT_PHONE;
    await ctx.reply("⚠️ Missing payment details. Please send your phone number again.", { reply_markup: mainKeyboard() });
    return;
  }

  // cooldown for resend
  if (mode === "resend" && sub.stkSentAt && Date.now() - sub.stkSentAt < STK_RESEND_COOLDOWN_MS) {
    await ctx.answerCbQuery?.("Please wait a bit.");
    return;
  }

  if (mode === "resend") {
    sub.resendCount = (sub.resendCount || 0) + 1;
    if (sub.resendCount > STK_MAX_RESENDS) {
      await ctx.reply(
        `⚠️ Resend limit reached.\n\nPay via Till *${TILL_NUMBER}* and send proof here.`,
        { parse_mode: "Markdown", reply_markup: paymentWaitKeyboard(sub).reply_markup }
      );
      return;
    }
  }

  // only show "Sending..." on initial attempt
  if (mode === "initial") {
    await ctx.reply(MESSAGES.stkSending);
  }

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

    sub.invoiceId = safeText(resp?.invoice_id || resp?.invoice?.invoice_id || resp?.invoiceId || sub.invoiceId || "");
    sub.stage = STAGE_WAIT_PAYMENT;
    sub.stkSentAt = Date.now();

    // ONE message only
    if (mode === "resend") {
      await ctx.reply(MESSAGES.stkSentWithTill(TILL_NUMBER), {
        parse_mode: "Markdown",
        reply_markup: paymentWaitKeyboard(sub).reply_markup
      });
    } else {
      await ctx.reply(MESSAGES.stkSentSimple, { reply_markup: paymentWaitKeyboard(sub).reply_markup });
    }

    await ctx.reply(MESSAGES.waitingConfirm, { reply_markup: paymentWaitKeyboard(sub).reply_markup });

    schedulePaymentTimeoutReminder(userId, sub.api_ref);
  } catch (err) {
    // keep session so resend can work
    sub.stage = STAGE_WAIT_PAYMENT;

    await ctx.reply(
      "❌ STK Push failed.\nTap *Resend STK Push* to try again.",
      { parse_mode: "Markdown", reply_markup: paymentWaitKeyboard(sub).reply_markup }
    );

    await sendAdminMessage(
      `❌ STK Push rejected by IntaSend\n` +
      `Mode: ${INTASEND_TEST ? "TEST" : "LIVE"}\n` +
      `PUB: ${maskKey(INTASEND_PUBLISHABLE_KEY)}\n` +
      `SEC: ${maskKey(INTASEND_SECRET_KEY)}\n` +
      `Host: ${PUBLIC_BASE_URL}\n` +
      `User: ${userId}\n` +
      `api_ref: ${safeText(sub.api_ref)}\n` +
      `Phone: ${safeText(sub.phone)}\n` +
      `Error:\n${formatIntaSendError(err)}`
    );
  }
}

// =====================
// START
// =====================
bot.start(async (ctx) => {
  const user = ctx.from;

  if (user.id === ADMIN_ID) {
    await replyMarkdownSafe(
      ctx,
      "👋 Admin mode is ready.\n\n" +
        "📩 Reply as bot:\n`/reply <userId> <message>`\n\n" +
        "📁 Send file(s) as bot:\n`/file <userId> Optional caption`\n`/file2 <userId> Optional caption`\n\n" +
        "✅ Confirm Till/manual payments:\n`/markpaid <userId> <mpesaRef>`",
      { reply_markup: mainKeyboard() }
    );
    return;
  }

  await sendAdminMessage(
    `🔥 New user started the bot:\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nUser ID: ${user.id}`
  );
  await sendAdminMessageMarkdown(adminQuickCommands(user.id));

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(ctx, MESSAGES.welcome(CHECK_PRICE_KES, RECHECK_PRICE_KES), {
    reply_markup: mainKeyboard()
  });
});

// =====================
// MAIN BUTTONS
// =====================
bot.hears(KEY_SEND_DOC, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  await replyMarkdownSafe(ctx, MESSAGES.sendDocHelp, { reply_markup: mainKeyboard() });
});

bot.hears(KEY_SEND_MPESA, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID && isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  await replyMarkdownSafe(ctx, MESSAGES.paymentHelp, { reply_markup: mainKeyboard() });
});

bot.hears(KEY_CANCEL, async (ctx) => {
  const userId = ctx.from.id;
  delete submissions[userId];
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

// Manual Till confirmation
bot.command("markpaid", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 3) return ctx.reply("Usage: /markpaid <userId> <mpesaRef>");

  const userId = Number(parts[1]);
  const mpesaRef = parts.slice(2).join(" ");

  const sub = submissions[userId];
  if (sub) {
    sub.paid = true;
    sub.stage = STAGE_PAID;
  }

  try {
    await bot.telegram.sendMessage(
      userId,
      `✅ Payment confirmed.\nRef: *${mpesaRef}*\n⏱ Reports take *10–20 minutes* (queue).`,
      { parse_mode: "Markdown" }
    );
    await ctx.reply(`✅ Marked paid + notified user ${userId}`);
  } catch (err) {
    await ctx.reply("❌ Failed to notify user: " + (err?.message || err));
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

  // Admin sending doc to user
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

  // Always inform admin
  await sendAdminMessage(
    `📨 Document from user:\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nUser ID: ${user.id}`
  );
  await sendAdminMessageMarkdown(adminQuickCommands(user.id));

  try { await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id); } catch {}

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

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
// TYPE SELECTION
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
  await ctx.reply(`✅ ${MESSAGES.askPhone("CHECK", CHECK_PRICE_KES)}`, { reply_markup: mainKeyboard() });
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
  await ctx.reply(`🔁 ${MESSAGES.askPhone("RECHECK", RECHECK_PRICE_KES)}`, { reply_markup: mainKeyboard() });
});

bot.action("TYPE_CANCEL", async (ctx) => {
  delete submissions[ctx.from.id];
  await ctx.answerCbQuery("Cancelled");
  await ctx.reply("❌ Cancelled. Send a new document to start again.", { reply_markup: mainKeyboard() });
});

// =====================
// STK CONTROLS
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

  await ctx.answerCbQuery("Resending...");

  if (!sub.phone) {
    sub.stage = STAGE_WAIT_PHONE;
    await ctx.reply("📞 Please send your phone number again.", { reply_markup: mainKeyboard() });
    return;
  }

  await attemptStkPush(ctx, sub, { mode: "resend" });
});

// =====================
// TEXT HANDLER
// =====================
bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = (ctx.message.text || "").trim();

  if (text.startsWith("/")) return;
  if (user.id === ADMIN_ID) return;

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  const sub = submissions[user.id];

  // Phone entry
  if (sub && sub.stage === STAGE_WAIT_PHONE) {
    const phone254 = normalizePhoneTo254(text);
    if (!phone254) {
      return ctx.reply("❌ Invalid phone. Send like 07XXXXXXXX / 01XXXXXXXX / 2547XXXXXXXX / 2541XXXXXXXX.");
    }
    sub.phone = phone254;
    await attemptStkPush(ctx, sub, { mode: "initial" });
    return;
  }

  // While waiting
  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    await ctx.reply(MESSAGES.waitingConfirm, { reply_markup: paymentWaitKeyboard(sub).reply_markup });
    return;
  }

  if (!sub) return ctx.reply("Send your document first to start.", { reply_markup: mainKeyboard() });
  if (sub.stage === STAGE_WAIT_TYPE) return ctx.reply("Please choose CHECK or RECHECK using the buttons.");
});

// =====================
// EXPRESS SERVER + WEBHOOKS
// =====================
const app = express();

app.use(
  express.json({
    limit: "2mb",
    verify: (req, res, buf) => (req.rawBody = buf?.toString() || "")
  })
);
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => (req.rawBody = buf?.toString() || "")
  })
);

// Telegram webhook endpoint
app.use(bot.webhookCallback("/webhook"));

// Health
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) =>
  res.status(200).json({
    ok: true,
    timeUtc: moment.utc().format(),
    intasendTest: INTASEND_TEST,
    publicBaseUrl: PUBLIC_BASE_URL
  })
);

// IntaSend webhook challenge (GET)
app.get("/intasend/webhook", (req, res) => {
  const qChallenge = req.query?.challenge;
  if (!qChallenge) return res.status(200).send("OK");

  if (INTASEND_WEBHOOK_CHALLENGE && qChallenge !== INTASEND_WEBHOOK_CHALLENGE) {
    return res.status(401).send("Invalid challenge");
  }
  return res.status(200).send(qChallenge);
});

// IntaSend webhook (POST) – you already have this; keeping minimal ACK here
app.post("/intasend/webhook", (req, res) => {
  res.status(200).json({ ok: true });
});

// =====================
// START SERVER + SET TELEGRAM WEBHOOK
// =====================
const port = process.env.PORT || 3000;

app.listen(port, async () => {
  console.log(`Webhook server listening on port ${port}`);
  console.log(`PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}`);
  console.log(`IntaSend Mode: ${INTASEND_TEST ? "TEST" : "LIVE"}`);
  console.log(`IntaSend PUB: ${maskKey(INTASEND_PUBLISHABLE_KEY)}`);
  console.log(`IntaSend SEC: ${maskKey(INTASEND_SECRET_KEY)}`);

  const webhookUrl = `${PUBLIC_BASE_URL}/webhook`;
  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`✅ Telegram webhook set to: ${webhookUrl}`);
  } catch (e) {
    console.error("❌ Failed to set Telegram webhook:", e?.description || e?.message || e);
  }
});
