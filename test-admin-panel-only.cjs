"use strict";
// JK_ADMIN_PANEL_ONLY_V1: the admin side runs from the panel. Forwarded proofs
// and files show in Bot chat; with "Admin messages on Telegram" off, nothing for
// the admin goes to Telegram, yet every alert, button, file and command reply
// works from the panel. Customers are unaffected. Real Telegraf, fake Telegram.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Telegraf, Markup, Telegram } = require("telegraf");
const { createBotChat } = require("./jk-admin-bot-chat.cjs");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-panel-only-"));
  try {
    const ADMIN = 6569201830, CUSTOMER = 5189765792;
    const api = [];
    let id = 500;
    Telegram.prototype.callApi = async function (method, p) {
      api.push([method, String(p.chat_id)]);
      if (method === "forwardMessage") {
        return { message_id: ++id, chat: { id: p.chat_id }, date: 0, caption: "Paid 150",
          photo: [{ file_id: "SMALL", file_size: 10 }, { file_id: "BIG_PHOTO", file_size: 900 }] };
      }
      if (method === "copyMessage") return { message_id: ++id };
      return { message_id: ++id, chat: { id: p.chat_id }, date: 0, text: p.text };
    };
    let off = false;
    const alerts = [];
    const downloads = [];
    const chat = createBotChat({
      file: path.join(dir, "chat.json"), adminId: ADMIN, filesDir: path.join(dir, "files"),
      telegramOff: () => off,
      downloadTelegramFile: async fileId => { downloads.push(fileId); return Buffer.from("TG:" + fileId); },
      onEntry: e => alerts.push(e.category)
    });
    chat.install(Telegram);
    const bot = new Telegraf("1:FAKE");
    bot.botInfo = { id: 1, is_bot: true, username: "jkbot", first_name: "JK" };
    chat.trackIncoming(bot);
    let confirmed = 0;
    bot.on("photo", async ctx => { // a payment screenshot from a customer
      await ctx.telegram.sendMessage(ADMIN, "🖼️ Payment screenshot received\nUser ID: " + ctx.from.id,
        { reply_markup: { inline_keyboard: [[{ text: "✅ Confirm", callback_data: "PAID_" + ctx.from.id }]] } });
      await ctx.telegram.forwardMessage(ADMIN, ctx.chat.id, ctx.message.message_id);
    });
    bot.on("document", async ctx => { // a customer's document copied to the admin with buttons
      await ctx.telegram.copyMessage(ADMIN, ctx.chat.id, ctx.message.message_id,
        { caption: "📄 New document\nUser ID: " + ctx.from.id, reply_markup: { inline_keyboard: [[{ text: "💬 Reply", callback_data: "R" }]] } });
    });
    bot.action(/^PAID_(\d+)$/, async ctx => {
      confirmed++;
      await ctx.answerCbQuery("Payment confirmed");
      await ctx.editMessageText("✅ PAID\nUser ID: " + ctx.match[1]);
      await ctx.telegram.sendMessage(Number(ctx.match[1]), "✅ Payment confirmed"); // to the customer
    });
    bot.command("mode", ctx => ctx.reply("⚙️ Bot status: ONLINE"));
    const from = { id: CUSTOMER, is_bot: false, first_name: "Mary", last_name: "W" };
    const cchat = { id: CUSTOMER, type: "private", first_name: "Mary" };
    let mid = 1000;
    const photoUpdate = () => ({ update_id: ++mid, message: { message_id: mid, from, chat: cchat, date: 0, caption: "Paid 150",
      photo: [{ file_id: "SMALL", file_size: 10 }, { file_id: "BIG_PHOTO", file_size: 900 }] } });
    const docUpdate = () => ({ update_id: ++mid, message: { message_id: mid, from, chat: cchat, date: 0,
      document: { file_id: "DOC_FILE", file_name: "Essay.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } } });

    // 1. Telegram on: a forwarded screenshot shows with its image; a copied document with its file.
    await bot.handleUpdate(photoUpdate());
    let feed = chat.feed().entries;
    const fwd = feed.at(-1);
    assert.match(fwd.text, /^↪ Forwarded from customer \(Mary W\)\n\nPaid 150/);
    assert.equal(fwd.category, "payment");
    assert.deepEqual(fwd.attachments.map(a => [a.kind, a.fileId]), [["photo", "BIG_PHOTO"]], "largest photo");
    const img = await chat.attachment(fwd.id, 0);
    assert.equal(img.buffer.toString(), "TG:BIG_PHOTO");
    assert.equal(img.mime, "image/jpeg");
    await bot.handleUpdate(docUpdate());
    const copied = chat.feed().entries.at(-1);
    assert.equal(copied.text, "📄 New document\nUser ID: " + CUSTOMER);
    assert.deepEqual(copied.attachments.map(a => [a.name, a.fileId]), [["Essay.docx", "DOC_FILE"]], "file found from the customer's message");
    assert.equal(copied.buttons[0][0].text, "💬 Reply");

    // 2. Telegram off: nothing for the admin reaches Telegram; customers still do.
    off = true;
    api.length = 0;
    await bot.handleUpdate(photoUpdate());
    assert.deepEqual(api.filter(([, c]) => c === String(ADMIN)), [], "no admin calls to Telegram");
    feed = chat.feed().entries;
    const proof = feed.at(-2), fwd2 = feed.at(-1);
    assert(proof.messageId < 0 && proof.panelOnly, "panel-only message");
    assert.equal(fwd2.attachments[0].fileId, "BIG_PHOTO", "screenshot still viewable (from the customer's message)");
    assert(alerts.includes("payment"), "notifications still fire");

    // Its button works from the panel: handled as the admin, edited in the panel, customer messaged on Telegram.
    const r = await chat.press(bot, proof.id, "PAID_" + CUSTOMER);
    assert.equal(r.toast, "Payment confirmed");
    assert.equal(confirmed, 1);
    assert.equal(chat.feed().entries.find(e => e.id === proof.id).text, "✅ PAID\nUser ID: " + CUSTOMER, "edited in the panel");
    assert.deepEqual(api, [["sendMessage", String(CUSTOMER)]], "only the customer's message went to Telegram");

    // Commands from the panel answer in the panel.
    await chat.sendText(bot, "/mode");
    assert.equal(chat.feed().entries.at(-1).text, "⚙️ Bot status: ONLINE");
    assert.equal(api.length, 1);

    // Files the bot sends the admin are kept and downloadable (Buffer, path, stream, file id).
    const pdf = path.join(dir, "report.pdf");
    fs.writeFileSync(pdf, "%PDF-path");
    await bot.telegram.sendDocument(ADMIN, { source: Buffer.from("%PDF-buffer"), filename: "Essay_similarity.pdf" }, { caption: "⏳ REPORTS READY" });
    await bot.telegram.sendDocument(ADMIN, { source: pdf, filename: "Essay_ai.pdf" });
    await bot.telegram.sendDocument(ADMIN, { source: fs.createReadStream(pdf), filename: "stream.pdf" });
    const sent = await bot.telegram.sendDocument(ADMIN, "TELEGRAM_FILE_ID");
    assert(sent.message_id < 0, "the bot gets a message id back as usual");
    feed = chat.feed().entries.slice(-4);
    assert.equal((await chat.attachment(feed[0].id, 0)).buffer.toString(), "%PDF-buffer");
    assert.equal((await chat.attachment(feed[0].id, 0)).name, "Essay_similarity.pdf");
    assert.equal((await chat.attachment(feed[1].id, 0)).buffer.toString(), "%PDF-path");
    assert.equal((await chat.attachment(feed[2].id, 0)).buffer.toString(), "%PDF-path");
    assert.equal((await chat.attachment(feed[3].id, 0)).buffer.toString(), "TG:TELEGRAM_FILE_ID");
    assert.deepEqual(api.filter(([, c]) => c === String(ADMIN)), [], "still nothing to the admin's Telegram");
    await assert.rejects(chat.attachment(feed[0].id, 5), /not found/);

    // Media groups and deletes also stay local.
    const group = await bot.telegram.sendMediaGroup(ADMIN, [{ type: "document", media: { source: Buffer.from("A"), filename: "a.pdf" } },
      { type: "document", media: { source: Buffer.from("B"), filename: "b.pdf" } }]);
    assert.equal(group.length, 2);
    await bot.telegram.deleteMessage(ADMIN, group[0].message_id);
    assert.equal(chat.feed().entries.find(e => e.messageId === group[0].message_id).deleted, true);

    // 3. Back on: the admin's Telegram gets messages again.
    off = false;
    await bot.telegram.sendMessage(ADMIN, "🔥 New user started bot");
    assert.deepEqual(api.at(-1), ["sendMessage", String(ADMIN)]);

    // 4. Wiring in bot.js.
    const src = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
    assert(src.includes("telegramOff: () => !adminTelegramOn(),"));
    assert(src.includes("downloadTelegramFile: fileId => downloadTelegramFileBuffer(fileId),"));
    assert(src.includes("adminBotChat.trackIncoming(bot);"));
    assert(src.indexOf("adminBotChat.trackIncoming(bot);") < src.indexOf("bot.use(async (ctx, next) =>"), "tracks before the bot's handlers");
    assert(src.includes("process.env.ADMIN_TELEGRAM") && src.includes("adminTelegram: { on: adminTelegramOn, forced: adminTelegramForced, set: setAdminTelegram },"));

    console.log("PASS: forwarded screenshots and copied documents show in Bot chat with their images/files.");
    console.log("PASS: Telegram off: nothing for the admin goes to Telegram; alerts, buttons, edits, commands and files work from the panel.");
    console.log("PASS: customers unaffected; Telegram on again restores admin messages.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
