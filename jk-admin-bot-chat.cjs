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
const path = require("path");

const MAX_ENTRIES = 400;
const WEB_CALLBACK_PREFIX = "web-";

const CATEGORIES = {
  payment: { label: "💳 Payment proofs and payment problems", on: true },
  failed: { label: "❌ Checks failed after all retries", on: true },
  freescan: { label: "🧪 Free scans finished", on: true }, // JK_FREESCAN_DONE_ALERT_V1
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

// Files on a message (Telegram message object or a customer message we saw).
function attachmentsOf(m) {
  if (!m) return [];
  const out = [];
  if (Array.isArray(m.photo) && m.photo.length) {
    const big = m.photo[m.photo.length - 1];
    out.push({ kind: "photo", name: "photo.jpg", fileId: big.file_id, mime: "image/jpeg", size: big.file_size || null });
  }
  for (const key of ["document", "video", "audio", "voice", "animation"]) {
    const f = m[key];
    if (f?.file_id) out.push({ kind: key, name: f.file_name || key, fileId: f.file_id, mime: f.mime_type || "", size: f.file_size || null });
  }
  return out;
}

const SEND_METHODS = /^(sendMessage|sendDocument|sendPhoto|sendVideo|sendAudio|sendAnimation|sendVoice)$/;
// Calls addressed to the admin chat that panel-only mode answers itself.
const LOCAL_METHODS = /^(sendMessage|sendDocument|sendPhoto|sendVideo|sendAudio|sendAnimation|sendVoice|sendMediaGroup|copyMessage|forwardMessage|editMessageText|editMessageCaption|editMessageReplyMarkup|deleteMessage|sendChatAction|pinChatMessage|unpinChatMessage)$/;
const FILE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

function createBotChat({ file, adminId, now = () => Date.now(), onEntry = () => {},
  // JK_ADMIN_PANEL_ONLY_V1
  filesDir = null,                // where panel-only files are kept (30 days)
  telegramOff = () => false,      // true: the admin chat lives in the panel only
  downloadTelegramFile = null     // fileId -> Buffer (files that are on Telegram)
} = {}) {
  let state = { seq: 0, entries: [] };
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved && Array.isArray(saved.entries)) state = { seq: Number(saved.seq) || 0, entries: saved.entries.slice(-MAX_ENTRIES) };
  } catch {}
  const toasts = new Map();
  let timer = null;
  let localSeq = 0;
  const nextLocalId = () => -(now() % 1e9) * 10 - (localSeq++ % 10) - 1; // never clashes with Telegram ids

  // Recent customer messages, so a forward/copy to the admin can be shown with
  // its photo/file even when nothing goes through Telegram (panel-only mode).
  const incomingFile = String(file).replace(/\.json$/, "") + "-incoming.json";
  let incoming = {};
  try { incoming = JSON.parse(fs.readFileSync(incomingFile, "utf8")) || {}; } catch {}
  let incomingTimer = null;
  function remember(message) {
    if (!message?.chat?.id || !message.message_id) return;
    const key = message.chat.id + ":" + message.message_id;
    incoming[key] = {
      at: now(), text: String(message.text || message.caption || "").slice(0, 2000),
      from: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || null,
      attachments: attachmentsOf(message)
    };
    const keys = Object.keys(incoming);
    if (keys.length > 1500) for (const k of keys.slice(0, keys.length - 1200)) delete incoming[k];
    clearTimeout(incomingTimer);
    incomingTimer = setTimeout(() => {
      try { fs.writeFileSync(incomingFile + ".tmp", JSON.stringify(incoming)); fs.renameSync(incomingFile + ".tmp", incomingFile); } catch {}
    }, 1500);
    incomingTimer.unref?.();
  }
  function trackIncoming(bot) {
    bot.use((ctx, next) => {
      try {
        const m = ctx.message;
        if (m && String(ctx.chat?.id) !== String(adminId) && ctx.chat?.type === "private") remember(m);
      } catch {}
      return next();
    });
  }

  // Panel-only files (sent by the bot to the admin while Telegram is off).
  async function keepFile(input, name) {
    if (!filesDir) return null;
    let src = input?.source ?? input;
    const fileName = String(input?.filename || name || (typeof src === "string" ? path.basename(src) : "file")).replace(/[\/\\\r\n"]/g, "_").slice(0, 160) || "file";
    let buffer = null;
    if (Buffer.isBuffer(src)) buffer = src;
    else if (typeof src === "string" && !/^https?:\/\//.test(src) && src.includes(path.sep) && fs.existsSync(src)) buffer = fs.readFileSync(src);
    else if (src && typeof src.pipe === "function") { const chunks = []; for await (const c of src) chunks.push(Buffer.from(c)); buffer = Buffer.concat(chunks); }
    if (!buffer) return null;
    fs.mkdirSync(filesDir, { recursive: true });
    const stored = now() + "-" + crypto.randomBytes(6).toString("hex") + "-" + fileName;
    fs.writeFileSync(path.join(filesDir, stored), buffer, { mode: 0o600 });
    return { local: stored, name: fileName, size: buffer.length };
  }
  function cleanupFiles() {
    if (!filesDir) return;
    try {
      for (const n of fs.readdirSync(filesDir)) {
        const at = Number(n.split("-")[0]);
        if (at && now() - at > FILE_KEEP_MS) fs.rmSync(path.join(filesDir, n), { force: true });
      }
    } catch {}
  }
  const ct = setInterval(cleanupFiles, 24 * 3600 * 1000); ct.unref?.();

  // A file attached to a send call (file id, path, Buffer or stream).
  async function attachmentFromPayload(method, payload, { readStreams }) {
    const key = { sendDocument: "document", sendPhoto: "photo", sendVideo: "video", sendAudio: "audio", sendAnimation: "animation", sendVoice: "voice" }[method];
    if (!key) return [];
    const input = payload[key];
    const kind = key;
    const mime = kind === "photo" ? "image/jpeg" : "";
    if (typeof input === "string" && !/^https?:\/\//.test(input) && !input.includes(path.sep)) {
      return [{ kind, name: kind === "photo" ? "photo.jpg" : "Document", fileId: input, mime }];
    }
    const src = input?.source ?? input;
    if (!readStreams && src && typeof src.pipe === "function") return [];
    const kept = await keepFile(input, kind === "photo" ? "photo.jpg" : null).catch(() => null);
    return kept ? [{ kind, mime, ...kept }] : [];
  }

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
  function observe(method, payload, result, { telegramError = null, ...extra } = {}) {
    if (!payload || String(payload.chat_id) !== String(adminId)) return;
    if (/^(sendMessage|sendDocument|sendPhoto|sendVideo|sendAudio|sendAnimation)$/.test(method)) {
      // The bot resends without formatting when Telegram rejects Markdown: that
      // retry updates the copy made from the failed attempt instead of adding one.
      const norm = v => String(v || "").replace(/[*_`\\\s]/g, "");
      const text = plain(payload.text ?? payload.caption ?? "", payload.parse_mode);
      const failed = state.entries.slice(-5).reverse().find(e => e.telegramError && now() - e.at < 60000 && norm(e.text) === norm(text));
      if (failed) {
        if (!telegramError) {
          failed.messageId = Number(result?.message_id) || null;
          delete failed.telegramError;
          failed.text = text;
          failed.buttons = buttonsOf(payload.reply_markup);
          save();
        }
        return;
      }
      const attachments = extra.attachments || attachmentsOf(result);
      const doc = result?.document || result?.video || result?.audio || null;
      const fileName = attachments[0]?.name || doc?.file_name || (method === "sendPhoto" ? "Photo" : method === "sendDocument" ? "Document" : null);
      add({
        messageId: extra.localId || Number(result?.message_id) || null,
        text: plain(payload.text ?? payload.caption ?? "", payload.parse_mode),
        file: method === "sendMessage" ? null : fileName,
        attachments,
        buttons: buttonsOf(payload.reply_markup),
        ...(telegramError ? { telegramError } : {}),
        ...(extra.localId ? { panelOnly: true } : {})
      });
      return;
    }
    // A customer's message forwarded or copied to the admin (payment proofs,
    // screenshots, uploaded documents): shown with its text and files.
    if (method === "forwardMessage" || method === "copyMessage") {
      const seen = incoming[payload.from_chat_id + ":" + payload.message_id] || null;
      const fromResult = attachmentsOf(result);
      const original = String(result?.text || result?.caption || seen?.text || "");
      const text = method === "copyMessage" && payload.caption !== undefined
        ? plain(payload.caption, payload.parse_mode)
        : "↪ Forwarded from customer" + (seen?.from ? " (" + seen.from + ")" : "") + (original ? "\n\n" + original : "");
      add({
        messageId: extra.localId || Number(result?.message_id) || null,
        text, attachments: fromResult.length ? fromResult : (seen?.attachments || []),
        file: (fromResult[0] || seen?.attachments?.[0])?.name || null,
        buttons: buttonsOf(payload.reply_markup),
        category: method === "forwardMessage" ? "payment" : undefined,
        ...(telegramError ? { telegramError } : {}),
        ...(extra.localId ? { panelOnly: true } : {})
      });
      return;
    }
    const id = Number(payload.message_id);
    const entry = id ? [...state.entries].reverse().find(e => e.messageId === id) : null;
    if (!entry) return;
    if (telegramError && !/^editMessage(Text|Caption)$/.test(method)) return;
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
      const toAdmin = payload && String(payload.chat_id) === String(adminId);
      // JK_ADMIN_PANEL_ONLY_V1: Telegram off for the admin — the panel is the chat.
      if (toAdmin && LOCAL_METHODS.test(method) && telegramOff()) return localCall(method, payload);
      let result;
      try {
        result = await original.call(this, method, payload, opts);
      } catch (error) {
        // Telegram refused or could not be reached: the panel still gets the
        // message (and the notification), marked as not delivered to Telegram.
        try {
          const attachments = toAdmin ? await attachmentFromPayload(method, payload, { readStreams: false }) : [];
          observe(method, payload, null, { telegramError: String(error?.message || error).slice(0, 200), attachments: attachments.length ? attachments : undefined });
        } catch {}
        throw error;
      }
      try { observe(method, payload, result); } catch (error) { console.error("Bot chat copy failed:", error.message); }
      return result;
    };
    proto.__jkBotChat = true;
  }

  // Answers an admin-chat call without Telegram (panel-only mode), returning
  // what Telegram would, so the bot's code carries on unchanged.
  async function localCall(method, payload) {
    const chat = { id: Number(adminId), type: "private" };
    const date = Math.floor(now() / 1000);
    if (SEND_METHODS.test(method)) {
      const localId = nextLocalId();
      const attachments = await attachmentFromPayload(method, payload, { readStreams: true });
      observe(method, payload, null, { localId, attachments });
      const a = attachments[0];
      return { message_id: localId, chat, date, text: payload.text, caption: payload.caption,
        ...(a ? { document: { file_id: a.fileId || "panel-only", file_name: a.name } } : {}) };
    }
    if (method === "sendMediaGroup") {
      const out = [];
      for (const media of payload.media || []) {
        const m = { photo: "sendPhoto", document: "sendDocument", video: "sendVideo", audio: "sendAudio" }[media.type] || "sendDocument";
        out.push(await localCall(m, { chat_id: payload.chat_id, [media.type || "document"]: media.media, caption: media.caption, parse_mode: media.parse_mode }));
      }
      return out;
    }
    if (method === "copyMessage" || method === "forwardMessage") {
      const localId = nextLocalId();
      observe(method, payload, null, { localId });
      return method === "copyMessage" ? { message_id: localId } : { message_id: localId, chat, date };
    }
    if (/^editMessage/.test(method)) {
      observe(method, payload, null);
      return { message_id: Number(payload.message_id), chat, date, text: payload.text };
    }
    if (method === "deleteMessage") { observe(method, payload, null); return true; }
    return true; // chat actions, pins
  }

  // A file shown in the panel: kept here, or fetched from Telegram.
  async function attachment(entryId, index) {
    const entry = state.entries.find(e => e.id === Number(entryId));
    const a = entry?.attachments?.[Number(index)];
    if (!a) { const e = new Error("File not found."); e.status = 404; throw e; }
    if (a.local) {
      const full = path.join(filesDir || "", path.basename(a.local));
      if (!filesDir || !fs.existsSync(full)) { const e = new Error("This file is no longer kept (30 days)."); e.status = 410; throw e; }
      return { buffer: fs.readFileSync(full), name: a.name, mime: a.mime || "" };
    }
    if (a.fileId && typeof downloadTelegramFile === "function") {
      return { buffer: await downloadTelegramFile(a.fileId), name: a.name, mime: a.mime || "" };
    }
    const e = new Error("This file is not available in the panel."); e.status = 404; throw e;
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
    if (!entry || !button) { const e = new Error("That button is no longer available."); e.status = 404; throw e; }
    const id = WEB_CALLBACK_PREFIX + crypto.randomBytes(8).toString("hex");
    // JK_BOTCHAT_BUTTONS_ACT_V1: no "Tapped …" line; the result shows instead.
    const update = {
      update_id: nextUpdateId(),
      callback_query: {
        id, from: adminFrom(), chat_instance: "jk-admin-web", data: button.data,
        message: { message_id: entry.messageId || nextUpdateId(), from: { id: 0, is_bot: true, first_name: "Bot" }, chat: adminChat(),
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

  // JK_CHAT_DELETE_V1: delete chosen Bot chat messages (ids) or all of them,
  // with any files kept for them. Telegram's own copies are not touched.
  function remove({ ids = [], all = false } = {}) {
    const gone = state.entries.filter(e => all || ids.includes(e.id));
    state.entries = all ? [] : state.entries.filter(e => !ids.includes(e.id));
    for (const e of gone) for (const a of e.attachments || []) {
      if (a.local && filesDir) { try { fs.rmSync(path.join(filesDir, path.basename(a.local)), { force: true }); } catch {} }
    }
    if (gone.length) save();
    return { removed: gone.length };
  }

  return { install, observe, add, sendText, press, feed, entries: () => state.entries, classify, trackIncoming, attachment, localCall, remove };
}

module.exports = { createBotChat, classify, buttonsOf, plain, attachmentsOf, CATEGORIES, WEB_CALLBACK_PREFIX };
