"use strict";
/*
  JK_WEBSITE_MOVE_NOTICE_V1: the "we're moving to our website / get the app"
  note added to the reports-delivered message for Telegram customers.
  - Automatic deliveries: at most once per customer every 24 hours.
  - The admin's done batch (or "mark delivered" in the panel): always.
  - Website customers never get it (they are already on the site).
*/
const fs = require("fs");

const DAY_MS = 24 * 60 * 60 * 1000;
const TEXT = [
  "📢 We're moving to our website",
  "Soon JK Turnitin will run only on our website: https://jkacademictoolshub.com",
  "Same service and prices. Pay with M-Pesa and download your reports right there.",
  "",
  "📲 Get the app: open the website in Chrome and tap “📲 App” at the top. On iPhone: Safari → Share → Add to Home Screen."
].join("\n");

function createWebsiteNotice({ file, now = () => Date.now(), isWebUser = () => false }) {
  let sent = null;
  function load() {
    if (sent) return sent;
    try { sent = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { sent = {}; }
    return sent;
  }
  function save() {
    const t = now();
    for (const [k, at] of Object.entries(sent)) if (t - at > 7 * DAY_MS) delete sent[k];
    try { fs.writeFileSync(file + ".tmp", JSON.stringify(sent)); fs.renameSync(file + ".tmp", file); } catch {}
  }
  // "" or "\n\n" + the note. force: the admin's done batch.
  function forUser(userId, { force = false } = {}) {
    if (!userId || isWebUser(userId)) return "";
    const s = load();
    const key = String(userId);
    const last = Number(s[key] || 0);
    if (!force && last && now() - last < DAY_MS) return ""; // already told today
    s[key] = now();
    save();
    return "\n\n" + TEXT;
  }
  return { forUser };
}

module.exports = { createWebsiteNotice, TEXT };
