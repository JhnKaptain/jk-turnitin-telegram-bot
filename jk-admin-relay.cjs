"use strict";
/*
  JK_ADMIN_RELAY_V1: helper programs started by the bot (AI HIGHLIGHTS, RECOVER
  REPORTS) hand their admin PDFs back to the bot instead of sending them to
  Telegram themselves. The bot then sends them like any other admin message:
  they appear in the panel's Bot chat (downloadable), notify the admin's phone,
  and follow the "Admin messages on Telegram" on/off switch.
  Run by hand (without JK_ADMIN_RELAY=1) the helpers still send directly.
*/
const fs = require("fs");
const path = require("path");

const PREFIX = "JK_ADMIN_SEND_DOCUMENT ";
const relaying = (env = process.env) => env.JK_ADMIN_RELAY === "1";

// In the helper: print one line the bot will pick up.
function relayDocument({ file, filename, caption = "" }) {
  process.stdout.write(PREFIX + JSON.stringify({ file: path.resolve(file), filename: filename || path.basename(file), caption }) + "\n");
}

// In the bot: documents a helper handed back (existing files only).
function parseRelayed(output) {
  const out = [];
  for (const line of String(output || "").split("\n")) {
    if (!line.startsWith(PREFIX)) continue;
    try {
      const item = JSON.parse(line.slice(PREFIX.length));
      if (typeof item.file === "string" && path.isAbsolute(item.file) && fs.existsSync(item.file) && fs.statSync(item.file).isFile()) {
        out.push({ file: item.file, filename: String(item.filename || path.basename(item.file)).slice(0, 200), caption: String(item.caption || "").slice(0, 1000) });
      }
    } catch {}
  }
  return out;
}

// Sends each handed-back document to the admin through the bot.
async function sendRelayed(items, telegram, adminId) {
  for (const item of items || []) {
    await telegram.sendDocument(Number(adminId), { source: fs.createReadStream(item.file), filename: item.filename },
      item.caption ? { caption: item.caption } : {});
  }
  return (items || []).length;
}

module.exports = { PREFIX, relaying, relayDocument, parseRelayed, sendRelayed };
