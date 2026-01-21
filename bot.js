/**
 * JK Turnitin Reports Bot — Telegraf + Express Webhook
 * + IntaSend STK Push (default) + Webhook confirmation
 *
 * FIXES INCLUDED:
 * ✅ Phone-number flow handled BEFORE forwarding to admin (so admin won’t receive the phone number)
 * ✅ STK Push is default (no checkout link needed)
 * ✅ IntaSend webhook FIX: supports GET/POST challenge + JSON/urlencoded bodies + robust parsing
 * ✅ Admin STK response is SHORT (no long JSON dump)
 * ✅ Payment confirmation sent to BOTH user + admin when state becomes COMPLETE
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

const INTASEND_PUBLISHABLE_KEY = process.env.INTASEND_PUBLISHABLE_KEY || "";
const INTASEND_SECRET_KEY = process.env.INTASEND_SECRET_KEY || "";
if (!INTASEND_PUBLISHABLE_KEY || !INTASEND_SECRET_KEY) {
  console.error("❌ Missing INTASEND_PUBLISHABLE_KEY or INTASEND_SECRET_KEY in environment variables");
  process.exit(1);
}

// ⭐ Your Telegram numeric ID
const ADMIN_ID = 6569201830;

// 💰 Pricing
const CHECK_PRICE_KES = 70;
const RECHECK_PRICE_KES = 65;

// Buttons
const KEY_SEND_DOC = "📄 Send Document";
const KEY_SEND_MPESA = "🧾 Send Mpesa Text / Screenshot";
const KEY_CANCEL = "❌ Cancel / New submission";

// =====================
// BOT STATE
// =====================
const bot = new Telegraf(botToken);

const intasend = new IntaSend(INTASEND_PUBLISHABLE_KEY, INTASEND_SECRET_KEY, INTASEND_TEST);
const collection = intasend.collection();

const pendingFileTargets = {};

// userId -> { stage, docMsgId, kind, amount, api_ref, phone, paid, createdAt }
const submissions = {};
// api_ref -> { userId, kind, amount }
const paymentRefs = {};

const STAGE_WAIT_TYPE = "WAIT_TYPE";
const STAGE_WAIT_PHONE = "WAIT_PHONE";
const STAGE_WAIT_PAYMENT = "WAIT_PAYMENT";

// =====================
// HELPERS
// =====================
const INACTIVE_START_UTC = "23:00"; // 02:00 EAT
const INACTIVE_END_UTC = "03:00"; // 05:59 EAT ends at 02:59 UTC (03:00 exclusive)

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

function makeApiRef(userId, kind) {
  return `JK_${kind}_${userId}_${Date.now()}`;
}

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

// compact IntaSend response summary for admin
function summarizeIntaSendResp(resp) {
  const id = resp?.id || "";
  const invoiceId = resp?.invoice?.invoice_id || resp?.invoice_id || "";
  const state = resp?.invoice?.state || resp?.state || "";
  const amount = resp?.invoice?.amount || resp?.amount || "";
  const currency = resp?.invoice?.currency || resp?.currency || "";

  const parts = [];
  if (id) parts.push(`id: ${id}`);
  if (invoiceId) parts.push(`invoice_id: ${invoiceId}`);
  if (state) parts.push(`state: ${state}`);
  if (amount) parts.push(`amount: ${amount}${currency ? ` ${currency}` : ""}`);

  return parts.length ? parts.join(" | ") : "(no summary fields)";
}

// robust payload getter (handles json, urlencoded, and raw string)
function getWebhookPayload(req) {
  let payload = req.body;

  // If express gave us a raw string, try parse JSON
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }

  // If body is empty but rawBody exists, try parse
  if ((!payload || (typeof payload === "object" && Object.keys(payload).length === 0)) && req.rawBody) {
    try {
      payload = JSON.parse(req.rawBody);
    } catch {
      // ignore
    }
  }

  if (!payload || typeof payload !== "object") payload = {};
  return payload;
}

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
  return payload.invoice_id || payload.invoice?.invoice_id || payload.data?.invoice_id || payload.payload?.invoice_id || "";
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

  if (isBotInactivePeriod() && user.id !== ADMIN_ID) {
    await notifyInactivePeriod(ctx);
    return;
  }

  if (user.id === ADMIN_ID) {
    await replyMarkdownSafe(
      ctx,
      "👋 Admin mode is ready.\n\n" +
        "📩 Reply as bot:\n`/reply <userId> <message>`\n\n" +
        "📁 Send file(s) as bot:\n" +
        "`/file <userId> Optional caption` (next 1)\n" +
        "`/file2 <userId> Optional caption` (next 2)"
    );
    return;
  }

  await replyMarkdownSafe(ctx, WELCOME_MESSAGE, { reply_markup: mainKeyboard() });

  await sendAdminMessage(
    `🔥 New user started the bot:\n` +
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
    "📄 Tap 📎 → *File* → select DOC/PDF → send here.\n(Please don’t send as a photo.)",
    { reply_markup: mainKeyboard() }
  );
});

bot.hears(KEY_SEND_MPESA, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  await replyMarkdownSafe(
    ctx,
    "✅ No need to forward Mpesa SMS.\nSend a document → choose CHECK/RECHECK → enter phone → get STK prompt.",
    { reply_markup: mainKeyboard() }
  );
});

bot.hears(KEY_CANCEL, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  const userId = ctx.from.id;
  delete submissions[userId];

  await sendAdminMessage(
    "❌ User cancelled submission:\n" +
      `Name: ${safeText(ctx.from.first_name)} ${safeText(ctx.from.last_name)}\n` +
      `Username: @${safeText(ctx.from.username || "N/A")}\n` +
      `User ID: ${userId}\n` +
      `Time (EAT): ${moment().utcOffset(3).format("YYYY-MM-DD HH:mm")}` +
      adminQuickCommands(userId)
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

  // admin send doc to user
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
      await ctx.reply("❌ Failed: " + (err?.message || err));
    }
    return;
  }

  // user doc -> forward to admin
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
    console.error("Forward doc error:", err?.message || err);
  }

  if (isBotInactivePeriod()) {
    await notifyInactivePeriod(ctx);
    return;
  }

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

  await ctx.reply("📄 File received.\n\nChoose:", typeInlineKeyboard());
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
  await ctx.reply(`✅ CHECK (${CHECK_PRICE_KES} KES).\nSend phone (07XXXXXXXX or 2547XXXXXXXX).`, {
    reply_markup: mainKeyboard()
  });
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
  await ctx.reply(`🔁 RECHECK (${RECHECK_PRICE_KES} KES).\nSend phone (07XXXXXXXX or 2547XXXXXXXX).`, {
    reply_markup: mainKeyboard()
  });
});

bot.action("TYPE_CANCEL", async (ctx) => {
  delete submissions[ctx.from.id];
  await ctx.answerCbQuery("Cancelled");
  await ctx.reply("❌ Cancelled. Send a new document to start again.", { reply_markup: mainKeyboard() });
});

// =====================
// TEXT HANDLER (phone processing first)
// =====================
bot.on("text", async (ctx) => {
  const user = ctx.from;
  const text = (ctx.message.text || "").trim();

  if (text.startsWith("/")) return;
  if (user.id === ADMIN_ID) return;

  // inactive: forward + notify
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

  const sub = submissions[user.id];

  // ✅ if waiting for phone: handle it here and don't forward to admin
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
      const resp = await collection.mpesaStkPush({
        first_name: safeText(user.first_name || "Customer"),
        last_name: safeText(user.last_name || "User"),
        email: `${user.id}@jkturnitin.local`,
        host: PUBLIC_BASE_URL,
        amount: sub.amount,
        phone_number: sub.phone,
        api_ref: sub.api_ref
      });

      await ctx.reply("✅ STK Push sent. Pay on your phone — confirmation is automatic.");

      await sendAdminMessage(
        `📲 STK Push initiated:\n` +
          `User ID: ${user.id}\n` +
          `Type: ${sub.kind}\n` +
          `Amount: ${sub.amount} KES\n` +
          `Phone: ${sub.phone}\n` +
          `api_ref: ${sub.api_ref}\n\n` +
          `Summary: ${summarizeIntaSendResp(resp)}`
      );
    } catch (err) {
      await ctx.reply("❌ STK Push failed. Try again in 1 minute.");
      await sendAdminMessage(
        `❌ STK Push error:\nUser ID: ${user.id}\napi_ref: ${sub.api_ref}\n\n${safeText(err?.message || err)}`
      );
    }
    return;
  }

  // normal: forward to admin
  await sendAdminMessage(
    `💬 Message from user:\n` +
      `Name: ${safeText(user.first_name)} ${safeText(user.last_name)}\n` +
      `Username: @${safeText(user.username || "N/A")}\n` +
      `User ID: ${user.id}` +
      adminQuickCommands(user.id) +
      `\n\n${safeText(text)}`
  );

  if (!sub) {
    await ctx.reply("Send your document first to start.", { reply_markup: mainKeyboard() });
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

  // admin send photo to user
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
      await ctx.reply("❌ Failed: " + (err?.message || err));
    }
    return;
  }

  // user photo -> forward to admin
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
    console.error("Forward photo error:", err?.message || err);
  }

  if (isBotInactivePeriod()) {
    await notifyInactivePeriod(ctx);
    return;
  }

  await ctx.reply("✅ Received.", { reply_markup: mainKeyboard() });
});

// =====================
// EXPRESS SERVER + TELEGRAM + INTASEND WEBHOOKS
// =====================
const app = express();

// ✅ IMPORTANT: accept JSON + urlencoded (webhooks often use form encoding)
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ capture raw body (helps if provider posts raw JSON as text)
app.use((req, res, next) => {
  let data = "";
  req.on("data", (chunk) => (data += chunk));
  req.on("end", () => {
    if (data && !req.rawBody) req.rawBody = data;
    next();
  });
});

// Telegram webhook
app.use(bot.webhookCallback("/webhook"));
bot.telegram.setWebhook(`${PUBLIC_BASE_URL}/webhook`);

// =====================
// INTASEND WEBHOOK (THOROUGH FIX)
// Supports:
//   - GET /intasend/webhook?challenge=...
//   - POST with JSON or urlencoded body
//   - POST with { challenge: ... } handshake
// =====================
app.all("/intasend/webhook", async (req, res) => {
  try {
    // 1) GET challenge
    const qChallenge = req.query?.challenge;
    if (qChallenge) {
      if (INTASEND_WEBHOOK_CHALLENGE && qChallenge !== INTASEND_WEBHOOK_CHALLENGE) {
        return res.status(401).send("Invalid challenge");
      }
      return res.status(200).send(qChallenge); // simplest echo
    }

    const payload = getWebhookPayload(req);

    // 2) POST challenge
    if (payload.challenge) {
      if (INTASEND_WEBHOOK_CHALLENGE && payload.challenge !== INTASEND_WEBHOOK_CHALLENGE) {
        return res.status(401).send("Invalid challenge");
      }
      return res.status(200).json({ challenge: payload.challenge });
    }

    // 3) Extract fields
    const apiRef = extractApiRef(payload);
    const stateRaw = extractState(payload);
    const invoiceId = extractInvoiceId(payload);

    const state = String(stateRaw || "").trim().toUpperCase();

    // 🔍 if webhook hit but we can’t read body, tell admin (this is key for debugging)
    if (!apiRef) {
      await sendAdminMessage(
        `⚠️ IntaSend webhook HIT but api_ref missing.\n` +
          `Method: ${req.method}\n` +
          `CT: ${safeText(req.headers["content-type"])}\n` +
          `Raw(150): ${safeText((req.rawBody || "").slice(0, 150))}`
      );
      return res.status(200).json({ ok: true });
    }

    const ref = paymentRefs[apiRef];

    // Always show admin that webhook is coming in
    await sendAdminMessage(
      `📩 IntaSend webhook:\napi_ref: \`${apiRef}\`\nstate: *${safeText(state || stateRaw)}*\ninvoice: ${safeText(invoiceId)}`
    );

    if (!ref) {
      await sendAdminMessage(`⚠️ Webhook api_ref not found in memory: \`${apiRef}\``);
      return res.status(200).json({ ok: true });
    }

    // 4) Confirm ONLY when COMPLETE
    if (state === "COMPLETE") {
      const { userId, kind, amount } = ref;
      const sub = submissions[userId];
      if (sub && sub.api_ref === apiRef) sub.paid = true;

      const userMsg =
        `✅ Payment confirmed (${amount} KES) for *${kind}*.\n` +
        `⏱ Reports take *2–8 min*.\n` +
        `ℹ️ AI < *20%* shows (*) no highlights.\n` +
        `For highlights: reach ≥20% + *paid recheck*.`;

      try {
        await bot.telegram.sendMessage(userId, userMsg, { parse_mode: "Markdown" });
      } catch (e) {
        await sendAdminMessage(`❌ Could not message user ${userId}.\n${safeText(e?.message || e)}`);
      }

      await sendAdminMessage(
        `✅ PAYMENT COMPLETE:\nUser ID: ${userId}\nType: ${kind}\nAmount: ${amount} KES\napi_ref: \`${apiRef}\``
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
  try {
    bot.stop("SIGINT");
  } catch {}
});
process.once("SIGTERM", () => {
  try {
    bot.stop("SIGTERM");
  } catch {}
});
