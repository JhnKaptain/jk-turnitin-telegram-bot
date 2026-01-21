/**
 * JK Turnitin Reports Bot — Telegraf + Express Webhook
 * + IntaSend STK Push + Webhook confirmation
 *
 * FIXES INCLUDED:
 * ✅ Fast ACK to IntaSend then async processing
 * ✅ Robust payload parsing (JSON, urlencoded, rawBody fallback)
 * ✅ Accept multiple paid states (COMPLETE/COMPLETED/SUCCESS/PAID etc)
 * ✅ Admin messages are plain text (no Markdown parse failures)
 * ✅ Recovery of userId/kind from api_ref if server restarts
 * ✅ Phone-number flow handled BEFORE forwarding to admin
 * ✅ Inactive window: 02:30–05:59 EAT
 */

require("dotenv").config();

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

const intasend = new IntaSend(
  INTASEND_PUBLISHABLE_KEY,
  INTASEND_SECRET_KEY,
  INTASEND_TEST
);
const collection = intasend.collection();

const pendingFileTargets = {};
const submissions = {}; // userId -> {stage, kind, amount, api_ref, phone, paid, createdAt}
const paymentRefs = {}; // api_ref -> {userId, kind, amount}

// Stages
const STAGE_WAIT_TYPE = "WAIT_TYPE";
const STAGE_WAIT_PHONE = "WAIT_PHONE";
const STAGE_WAIT_PAYMENT = "WAIT_PAYMENT";

// =====================
// HELPERS
// =====================
// Inactive 02:30–05:59 EAT (UTC+3) => UTC 23:30–02:59, end exclusive at 03:00
const INACTIVE_START_UTC = "23:30"; // 02:30 EAT
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
  return "\n\nQuick commands (tap & copy):\n" + `/file2 ${userId}\n` + `/reply ${userId} `;
}

/**
 * Admin logs as PLAIN TEXT (no parse_mode) to avoid Markdown parse failures
 */
async function sendAdminMessage(text) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text);
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
    "⏳ Turnitin checks are paused right now.\nWe’ll resume Turnitin reports at *6:00 AM EAT*.\n\nIf so urgent, *voice call on WhatsApp 0701730921*.",
    { reply_markup: mainKeyboard() }
  );
}

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

function extractAmount(payload) {
  return (
    payload.amount ||
    payload.invoice?.amount ||
    payload.data?.amount ||
    payload.payload?.amount ||
    null
  );
}

function extractCurrency(payload) {
  return (
    payload.currency ||
    payload.invoice?.currency ||
    payload.data?.currency ||
    payload.payload?.currency ||
    "KES"
  );
}

/**
 * Recover data from api_ref if memory lost:
 * api_ref = JK_<KIND>_<USERID>_<TS>
 */
function recoverRefFromApiRef(apiRef) {
  const m = /^JK_(CHECK|RECHECK)_(\d+)_/.exec(String(apiRef || ""));
  if (!m) return null;
  return { kind: m[1], userId: Number(m[2]) };
}

const PAID_STATES = new Set([
  "COMPLETE",
  "COMPLETED",
  "SUCCESS",
  "SUCCESSFUL",
  "PAID"
]);

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

  if (isBotInactivePeriod() && user.id !== ADMIN_ID) return notifyInactivePeriod(ctx);

  if (user.id === ADMIN_ID) {
    await replyMarkdownSafe(
      ctx,
      "👋 Admin mode is ready.\n\n📩 Reply as bot:\n`/reply <userId> <message>`\n\n📁 Send file(s) as bot:\n`/file <userId> Optional caption`\n`/file2 <userId> Optional caption`"
    );
    return;
  }

  await replyMarkdownSafe(ctx, WELCOME_MESSAGE, { reply_markup: mainKeyboard() });

  await sendAdminMessage(
    `🔥 New user started the bot:\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nUser ID: ${user.id}` + adminQuickCommands(user.id)
  );
});

// =====================
// BUTTON HANDLERS
// =====================
bot.hears(KEY_SEND_DOC, async (ctx) => {
  if (isBotInactivePeriod() && ctx.from.id !== ADMIN_ID) return notifyInactivePeriod(ctx);
  await replyMarkdownSafe(ctx, "📄 Tap 📎 → *File* → select DOC/PDF → send here.\n(Please don’t send as a photo.)", {
    reply_markup: mainKeyboard()
  });
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
    `❌ User cancelled submission:\nName: ${safeText(ctx.from.first_name)} ${safeText(ctx.from.last_name)}\nUsername: @${safeText(
      ctx.from.username || "N/A"
    )}\nUser ID: ${userId}\nTime (EAT): ${moment().utcOffset(3).format("YYYY-MM-DD HH:mm")}` + adminQuickCommands(userId)
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

  await sendAdminMessage(
    `📨 Document from user:\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nUser ID: ${user.id}` + adminQuickCommands(user.id)
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch (err) {
    console.error("Forward doc error:", err?.message || err);
  }

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);

  submissions[user.id] = {
    stage: STAGE_WAIT_TYPE,
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
  if (!sub || sub.stage !== STAGE_WAIT_TYPE) return ctx.answerCbQuery("No pending submission.");

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
  if (!sub || sub.stage !== STAGE_WAIT_TYPE) return ctx.answerCbQuery("No pending submission.");

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

  if (isBotInactivePeriod()) {
    await sendAdminMessage(
      `💬 Message from user (inactive period):\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
        user.username || "N/A"
      )}\nUser ID: ${user.id}` +
        adminQuickCommands(user.id) +
        `\n\n${safeText(text)}`
    );
    return notifyInactivePeriod(ctx);
  }

  const sub = submissions[user.id];

  // waiting for phone (DO NOT forward phone to admin)
  if (sub && sub.stage === STAGE_WAIT_PHONE) {
    const phone254 = normalizePhoneTo254(text);
    if (!phone254) return ctx.reply("❌ Invalid phone. Send like 07XXXXXXXX or 2547XXXXXXXX.");

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
        `📲 STK Push initiated:\nUser ID: ${user.id}\nType: ${sub.kind}\nAmount: ${sub.amount} KES\nPhone: ${sub.phone}\napi_ref: ${sub.api_ref}\n\nSummary: ${summarizeIntaSendResp(resp)}`
      );
    } catch (err) {
      await ctx.reply("❌ STK Push failed. Try again in 1 minute.");
      await sendAdminMessage(
        `❌ STK Push error:\nUser ID: ${user.id}\napi_ref: ${sub.api_ref}\n\n${safeText(err?.message || err)}`
      );
    }
    return;
  }

  // normal forward
  await sendAdminMessage(
    `💬 Message from user:\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nUser ID: ${user.id}` +
      adminQuickCommands(user.id) +
      `\n\n${safeText(text)}`
  );

  if (!sub) return ctx.reply("Send your document first to start.", { reply_markup: mainKeyboard() });
  if (sub.stage === STAGE_WAIT_TYPE) return ctx.reply("Please choose CHECK or RECHECK using the buttons.");
  if (sub.stage === STAGE_WAIT_PAYMENT) return ctx.reply("Waiting for payment confirmation…");
});

// =====================
// PHOTO HANDLER
// =====================
bot.on("photo", async (ctx) => {
  const user = ctx.from;

  // admin send photo to user
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

  await sendAdminMessage(
    `🖼️ Photo from user:\nName: ${safeText(user.first_name)} ${safeText(user.last_name)}\nUsername: @${safeText(
      user.username || "N/A"
    )}\nUser ID: ${user.id}` + adminQuickCommands(user.id)
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch (err) {
    console.error("Forward photo error:", err?.message || err);
  }

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  await ctx.reply("✅ Received.", { reply_markup: mainKeyboard() });
});

// =====================
// EXPRESS SERVER + WEBHOOKS
// =====================
const app = express();

// raw body capture (for debugging + fallback parsing)
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

// Telegram webhook route
app.use(bot.webhookCallback("/webhook"));

// Set telegram webhook
bot.telegram.setWebhook(`${PUBLIC_BASE_URL}/webhook`).catch((e) => {
  console.error("Failed to set Telegram webhook:", e?.message || e);
});

// Health check
app.get("/", (req, res) => res.status(200).send("OK"));

// ---- IntaSend challenge (GET)
app.get("/intasend/webhook", (req, res) => {
  const qChallenge = req.query?.challenge;
  if (!qChallenge) return res.status(200).send("OK");

  if (INTASEND_WEBHOOK_CHALLENGE && qChallenge !== INTASEND_WEBHOOK_CHALLENGE) {
    return res.status(401).send("Invalid challenge");
  }
  return res.status(200).send(String(qChallenge));
});

// ---- IntaSend events (POST)
app.post("/intasend/webhook", (req, res) => {
  // ACK immediately
  res.status(200).json({ ok: true });

  setImmediate(async () => {
    try {
      // robust parse
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

      // challenge (POST) handling (do not block real events)
      if (payload.challenge) {
        if (INTASEND_WEBHOOK_CHALLENGE && payload.challenge !== INTASEND_WEBHOOK_CHALLENGE) {
          await sendAdminMessage("❌ IntaSend POST challenge invalid (ignored).");
          return;
        }
        await sendAdminMessage("✅ IntaSend POST challenge received (ignored for events).");
        return;
      }

      const apiRef = extractApiRef(payload);
      const stateRaw = extractState(payload);
      const invoiceId = extractInvoiceId(payload);
      const state = String(stateRaw || "").trim().toUpperCase();

      if (!apiRef) {
        await sendAdminMessage(
          `⚠️ IntaSend webhook HIT but api_ref missing.\nCT: ${safeText(req.headers["content-type"])}\nRaw(400): ${safeText(
            (req.rawBody || "").slice(0, 400)
          )}`
        );
        return;
      }

      await sendAdminMessage(
        `📩 IntaSend webhook:\napi_ref: ${apiRef}\nstate: ${safeText(state || stateRaw)}\ninvoice: ${safeText(invoiceId)}`
      );

      // get ref from memory
      let ref = paymentRefs[apiRef];

      // recover if restarted
      if (!ref) {
        const recovered = recoverRefFromApiRef(apiRef);
        if (recovered) {
          ref = {
            userId: recovered.userId,
            kind: recovered.kind,
            amount: null
          };
        }
      }

      if (!ref) {
        await sendAdminMessage(`⚠️ Webhook api_ref not found & not recoverable: ${apiRef}`);
        return;
      }

      const amountFromPayload = extractAmount(payload);
      const currency = extractCurrency(payload);
      const amount = ref.amount || amountFromPayload;

      // confirm on paid states
      if (PAID_STATES.has(state)) {
        const userId = ref.userId;
        const kind = ref.kind;

        const sub = submissions[userId];
        if (sub && sub.api_ref === apiRef) sub.paid = true;

        const userMsg =
          `✅ Payment confirmed (${amount || "paid"} ${currency}) for *${kind}*.\n` +
          `⏱ Reports take *2–8 min* (queue).\n` +
          `ℹ️ AI < *20%* shows (*) no highlights.\n` +
          `For highlights: reach ≥20% + *paid recheck*.`;

        try {
          await bot.telegram.sendMessage(userId, userMsg, { parse_mode: "Markdown" });
        } catch (e) {
          await sendAdminMessage(`❌ Could not message user ${userId}.\n${safeText(e?.message || e)}`);
        }

        await sendAdminMessage(
          `✅ PAYMENT CONFIRMED:\nUser ID: ${userId}\nType: ${kind}\nAmount: ${amount || "N/A"} ${currency}\napi_ref: ${apiRef}\nstate: ${state}`
        );
      }
    } catch (err) {
      console.error("Async IntaSend processing error:", err?.message || err);
      await sendAdminMessage(`❌ Webhook processing error: ${safeText(err?.message || err)}`);
    }
  });
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
