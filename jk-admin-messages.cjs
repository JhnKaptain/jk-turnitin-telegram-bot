"use strict";
/*
  JK_ADMIN_ORDER_DESK_V1: a small per-customer message log so the web panel can
  show the conversation next to an order (customer support messages, website
  chat messages, and everything the admin sends: replies, notes, files).
  Stored in one JSON file on the persistent disk; at most 100 messages per
  customer and 90 days, so it stays small.
*/
const crypto = require("crypto");
const fs = require("fs");

const PER_USER = 100;
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

function createMessageLog(file, { now = () => Date.now() } = {}) {
  let store = {};
  try { store = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch {}
  let timer = null;
  // JK_CHAT_DELETE_V1: every message gets an id (older ones on load), so the
  // admin can delete chosen messages from the panel.
  const newId = () => crypto.randomBytes(6).toString("hex");
  for (const list of Object.values(store)) for (const m of list || []) if (m && !m.id) m.id = newId();

  function save() {
    clearTimeout(timer);
    timer = setTimeout(flush, 500);
    timer.unref?.();
  }
  function flush() {
    clearTimeout(timer); timer = null;
    try {
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(store));
      fs.renameSync(tmp, file);
    } catch (error) {
      console.error("Admin message log save failed:", error.message);
    }
  }

  // from: "customer" | "admin"; kind: "text" | "note" | "file"
  function log(userId, from, text, kind = "text") {
    const uid = String(userId || "").trim();
    if (!/^[1-9]\d{0,19}$/.test(uid)) return;
    const t = now();
    const list = (store[uid] || []).filter(m => t - m.at < KEEP_MS);
    list.push({ id: newId(), at: t, from: from === "customer" ? "customer" : "admin", kind, text: String(text || "").slice(0, 2000) });
    store[uid] = list.slice(-PER_USER);
    save();
  }

  const thread = userId => (store[String(userId)] || []).slice();
  // A customer is waiting when their latest message has no admin message after it.
  function waiting(userId) {
    const list = store[String(userId)] || [];
    const last = list[list.length - 1];
    return last && last.from === "customer" ? last.at : null;
  }
  function waitingUsers() {
    return Object.keys(store).filter(uid => waiting(uid)).map(uid => ({ userId: uid, since: waiting(uid) }));
  }

  // Delete chosen messages (ids) or the whole conversation (all: true).
  function remove(userId, { ids = [], all = false } = {}) {
    const uid = String(userId);
    const list = store[uid] || [];
    const keep = all ? [] : list.filter(m => !ids.includes(m.id));
    const removed = list.length - keep.length;
    if (keep.length) store[uid] = keep; else delete store[uid];
    if (removed) save();
    return { removed };
  }

  return { log, thread, waiting, waitingUsers, flush, remove };
}

module.exports = { createMessageLog };
