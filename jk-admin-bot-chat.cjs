"use strict";
/*
  JK_ADMIN_BOT_CHAT_V1
  --------------------
  The admin's Telegram chat with the bot, in the web panel:

  - Every message the bot sends the admin (and later edits of it) is copied into
    a feed, with its buttons. Nothing changes on Telegram.
  - From the panel the admin can type anything they would type to the bot
    (/plagiarism, /mode, a reply while in reply mode...) and tap the buttons on
    those messages. Both are fed to the bot as if they came from the admin's
    Telegram, so every existing command and button works without extra code.
  - Each message gets a category (payment, failed check, customer message...),
    used for filters and for phone notifications.
*/
const crypto = require("crypto");
const fs = require("fs");

const MAX_ENTRIES = 400;
const WEB_CALLBACK_PREFIX = "web-";

const CATEGORIES = {
  payment: { label: "💳 Payment proofs and payment problems", on: true },
  failed: { label: "❌ Checks failed after all retries", on: true },
  message: { label: "💬 Customer messages", on: true },
  shop: { label: "🛍 Shop orders and shop messages", on: true },
  attention: { label: "⚠️ Needs attention (manual review, cancellations)", on: true },
  provider: { label: "🔌 Provider responses (Sapling, Quetext, JK SimilarityCheck)", on: true },
  broadcast: { label: "📢 Broadcast and discount prompts", on: true },
  orders: { label: "✅ New paid orders and new users", on: false },
  retrying: { label: "🔁 Automatic retries in progress", on: false },
  other: { label: "Other bot messages", on: false }
};

function classify(text) {
  const t = String(text || "");
  const first = t.split("\n").find(l => l.trim()) || "";
  if (/Support message|Message from user|Website message|Website customer message/i.test(first)) return "message";
  if (/SEND TO ALL|broadcast|discount/i.test(t) && /broadcast|discount/i.test(first + t.slice(0, 300))) return "broadcast";
  if (/Automatic retries used up|Automatic retry stopped|retries stopped by admin/i.test(t)) return "failed";
  if (/Automatic retry \d+\/\d+ in about/i.test(t)) return "retrying";
  if (/proof|M-Pesa message received|screenshot received|Auto-confirm|PAYMENT ATTEMPT FAILED|STK Push error|payment opened|international manual payment|checkout error|Payment watcher|IntaSend/i.test(first)) return "payment";
  if (/MANUAL|APPROVAL REQUIRED|cancellation request|cancelled submission|REFERENCE BOUNDARY|review required|needs? (admin )?review/i.test(first)) return "attention";
  if (/FAILED|failed|error/.test(first)) return "failed";
  if (/Sapling|Quetext|SimilarityCheck|Copyleaks|provider|AI CHECK COMPLETE|REPORTS READY|REPORTS DELIVERED|credits?/i.test(first)) return "provider";
  if (/^✅ PAID|New user started|PAYMENT COMPLETE/i.test(first)) return "orders";
  return "other";
}

function plain(text, parseMode) {
  let s = String(text || "");
  if (/html/i.test(String(parseMode || ""))) {
    s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  } else if (/markdown/i.test(String(parseMode || ""))) {
    s = s.replace(/\\([_*`\[\]()~>#+\-=|{}.!])/g, "$1").replace(/(^|[^\\])[*`]+/g, "$1");
  }
  return s.slice(0, 4000);
}

function buttonsOf(markup) {
  let m = markup;
  if (typeof m === "string") { try { m = JSON.parse(m); } catch { return []; } }
  const rows = Array.isArray(m?.inline_keyboard) ? m.inline_keyboard : [];
  return rows.map(row => (row || []).map(b => (
    b.callback_data ? { text: String(b.text || ""), data: String(b.callback_data) }
      : b.url ? { text: String(b.text || ""), url: String(b.url) } : null
  )).filter(Boolean)).filter(r => r.length);
}

function createBotChat({ file, adminId, now = () => Date.now(), onEntry = () => {} }) {
  let state = { seq: 0, entries: [] };
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved && Array.isArray(saved.entries)) state = { seq: Number(saved.seq) || 0, entries: saved.entries.slice(-MAX_ENTRIES) };
  } catch {}
  const toasts = new Map();
  let timer = null;

  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(state));
        fs.renameSync(tmp, file);
      } catch (error) { console.error("Bot chat save failed:", error.message); }
    }, 800);
    timer.unref?.();
  }

  function add(entry) {
    const e = { id: ++state.seq, at: now(), from: "bot", buttons: [], ...entry };
    if (!e.category) e.category = e.from === "bot" ? classify(e.text) : "you";
    state.entries.push(e);
    if (state.entries.length > MAX_ENTRIES) state.entries.splice(0, state.entries.length - MAX_ENTRIES);
    save();
    try { onEntry(e, { isNew: true }); } catch {}
    return e;
  }

  // Called for every Telegram API call; only the admin chat is copied.
  function observe(method, payload, result) {
    if (!payload || String(payload.chat_id) !== String(adminId)) return;
    if (/^(sendMessage|sendDocument|sendPhoto|sendVideo|sendAudio|sendAnimation)$/.test(method)) {
      const doc = result?.document || result?.video || result?.audio || null;
      const fileName = doc?.file_name || (method === "sendPhoto" ? "Photo" : method === "sendDocument" ? "Document" : null);
      add({
        messageId: Number(result?.message_id) || null,
        text: plain(payload.text ?? payload.caption ?? "", payload.parse_mode),
        file: method === "sendMessage" ? null : fileName,
        buttons: buttonsOf(payload.reply_markup)
      });
      return;
    }
    const id = Number(payload.message_id);
    const entry = id ? [...state.entries].reverse().find(e => e.messageId === id) : null;
    if (!entry) return;
    if (method === "deleteMessage") { entry.deleted = true; entry.buttons = []; save(); return; }
    if (/^editMessage(Text|Caption)$/.test(method)) {
      const before = entry.text;
      entry.text = plain(payload.text ?? payload.caption ?? "", payload.parse_mode);
      entry.editedAt = now();
      if (payload.reply_markup !== undefined) entry.buttons = buttonsOf(payload.reply_markup);
      else entry.buttons = []; // Telegram drops the keyboard when an edit sends none
      const was = entry.category;
      entry.category = classify(entry.text);
      save();
      // "Failed after all retries" usually arrives as an edit of the first failure message.
      if (entry.category === "failed" && was !== "failed" && before !== entry.text) {
        try { onEntry(entry, { isNew: false }); } catch {}
      }
      return;
    }
    if (method === "editMessageReplyMarkup") { entry.buttons = buttonsOf(payload.reply_markup); save(); }
  }

  // Patch Telegraf's shared API call (each update gets its own Telegram client).
  function install(TelegramClass) {
    const proto = TelegramClass.prototype;
    if (proto.__jkBotChat) return;
    const original = proto.callApi;
    proto.callApi = async function (method, payload = {}, opts) {
      if (method === "answerCallbackQuery" && String(payload?.callback_query_id || "").startsWith(WEB_CALLBACK_PREFIX)) {
        toasts.set(String(payload.callback_query_id), String(payload.text || ""));
        return true; // a button pressed in the web panel: answered there, not on Telegram
      }
      const result = await original.call(this, method, payload, opts);
      try { observe(method, payload, result); } catch (error) { console.error("Bot chat copy failed:", error.message); }
      return result;
    };
    proto.__jkBotChat = true;
  }

  let updateSeq = 0;
  const nextUpdateId = () => 7_000_000_000 + (now() % 1_000_000_000) * 10 + (updateSeq++ % 10);
  const adminFrom = () => ({ id: Number(adminId), is_bot: false, first_name: "Admin", language_code: "en" });
  const adminChat = () => ({ id: Number(adminId), type: "private", first_name: "Admin" });

  async function withTimeout(promise, ms) {
    let t;
    try {
      return await Promise.race([promise, new Promise(resolve => { t = setTimeout(() => resolve("timeout"), ms); })]);
    } finally { clearTimeout(t); }
  }

  // Text typed in the panel, handled exactly like a message from the admin's Telegram.
  async function sendText(bot, text) {
    const clean = String(text || "").trim().slice(0, 4000);
    if (!clean) { const e = new Error("Type a command or a message."); e.status = 400; throw e; }
    add({ from: "you", text: clean, category: "you" });
    const command = /^\/[A-Za-z0-9_]+(@\w+)?/.exec(clean);
    const update = {
      update_id: nextUpdateId(),
      message: {
        message_id: nextUpdateId(), from: adminFrom(), chat: adminChat(), date: Math.floor(now() / 1000), text: clean,
        ...(command ? { entities: [{ type: "bot_command", offset: 0, length: command[0].length }] } : {})
      }
    };
    const outcome = await withTimeout(bot.handleUpdate(update).then(() => "done"), 25000)
      .catch(error => { add({ from: "bot", text: "⚠️ " + String(error?.message || error), category: "other" }); return "error"; });
    return { ok: true, finished: outcome === "done" };
  }

  // A button on one of the bot's messages, pressed in the panel.
  async function press(bot, entryId, data) {
    const entry = state.entries.find(e => e.id === Number(entryId));
    const button = entry && entry.buttons.flat().find(b => b.data === String(data));
    if (!entry || !button || !entry.messageId) { const e = new Error("That button is no longer available."); e.status = 404; throw e; }
    const id = WEB_CALLBACK_PREFIX + crypto.randomBytes(8).toString("hex");
    add({ from: "you", text: "Tapped “" + button.text + "”", category: "you" });
    const update = {
      update_id: nextUpdateId(),
      callback_query: {
        id, from: adminFrom(), chat_instance: "jk-admin-web", data: button.data,
        message: { message_id: entry.messageId, from: { id: 0, is_bot: true, first_name: "Bot" }, chat: adminChat(),
          date: Math.floor(entry.at / 1000), text: entry.text,
          ...(entry.buttons.length ? { reply_markup: { inline_keyboard: entry.buttons.map(r => r.map(b => b.data ? { text: b.text, callback_data: b.data } : { text: b.text, url: b.url })) } } : {}) }
      }
    };
    const outcome = await withTimeout(bot.handleUpdate(update).then(() => "done"), 25000)
      .catch(error => { add({ from: "bot", text: "⚠️ " + String(error?.message || error), category: "other" }); return "error"; });
    const toast = toasts.get(id) || "";
    toasts.delete(id);
    return { ok: true, toast, finished: outcome === "done" };
  }

  // The latest 150 messages (edits included, since entries are updated in place).
  function feed() {
    return { seq: state.seq, entries: state.entries.slice(-150) };
  }

  return { install, observe, add, sendText, press, feed, entries: () => state.entries, classify };
}

module.exports = { createBotChat, classify, buttonsOf, plain, CATEGORIES, WEB_CALLBACK_PREFIX };
