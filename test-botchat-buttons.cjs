"use strict";
// JK_BOTCHAT_BUTTONS_ACT_V1: buttons in Bot chat do their job without a
// "Tapped …" line; Filebatch and Reply open the panel's own boxes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Telegraf, Telegram } = require("telegraf");
const { createBotChat } = require("./jk-admin-bot-chat.cjs");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-bc-buttons-"));
  try {
    let id = 1;
    Telegram.prototype.callApi = async function (m, p) { return { message_id: ++id, chat: { id: p.chat_id }, date: 0 }; };
    const chat = createBotChat({ file: path.join(dir, "c.json"), adminId: 42 });
    chat.install(Telegram);
    const bot = new Telegraf("1:FAKE"); bot.botInfo = { id: 1, is_bot: true, username: "b", first_name: "B" };
    bot.action("ADMIN_AI_NOTE_5", async ctx => { await ctx.answerCbQuery("AI note sent"); await ctx.reply("✅ AI unavailable note sent to 5"); });
    await bot.telegram.sendMessage(42, "💬 Support message from user\nUser ID: 5",
      { reply_markup: { inline_keyboard: [[{ text: "ℹ️ AI Unavail", callback_data: "ADMIN_AI_NOTE_5" }]] } });
    const before = chat.feed().entries.length;
    const r = await chat.press(bot, chat.feed().entries.at(-1).id, "ADMIN_AI_NOTE_5");
    assert.equal(r.toast, "AI note sent");
    const added = chat.feed().entries.slice(before);
    assert.deepEqual(added.map(e => e.text), ["✅ AI unavailable note sent to 5"], "only the result, no 'Tapped …' line");
    assert(!chat.feed().entries.some(e => /^Tapped/.test(e.text)));

    const client = fs.readFileSync(path.join(__dirname, "jk-admin-panel.client.js"), "utf8");
    assert(client.includes("const fb = /^ADMIN_FILEBATCH_(\\d+)$/.exec(t.dataset.bdata || \"\");") && client.includes("if (fb) return openDrawer(fb[1], true);"));
    assert(client.includes("if (rp) return openDrawer(rp[1], false);"));
    assert(client.includes("const fbc = /^\\/filebatch\\s+(\\d{3,17})(?:\\s+([\\s\\S]+))?$/i.exec(text);"));
    assert(client.includes('toast(r.toast || ("✓ " + t.textContent.trim()));'));
    console.log("PASS: Bot chat buttons show their result (no 'Tapped …'); Filebatch/Reply and /filebatch, /reply open the panel's boxes.");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
