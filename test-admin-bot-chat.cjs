"use strict";
// JK_ADMIN_BOT_CHAT_V1 + JK_ADMIN_PUSH_V1: the admin's bot chat in the web panel
// (copy, commands, buttons), phone notifications and shop events. A real
// Telegraf bot with a fake Telegram API; no network.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Telegraf, Markup, Telegram } = require("telegraf");
const { createBotChat, classify } = require("./jk-admin-bot-chat.cjs");
const { createAdminPush, summarize } = require("./jk-admin-push.cjs");
const { shopEvents } = require("./jk-shop-store.cjs");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-bot-chat-"));
  try {
    // 1. Categories from real admin message openings.
    const cases = {
      "🧾 M-Pesa message received\nUser ID: 1": "payment",
      "🖼️ Payment screenshot received\nUser ID: 1": "payment",
      "🌍 International payment proof received": "payment",
      "⚠️ PAYMENT ATTEMPT FAILED\nUser ID: 1": "payment",
      "💬 Support message from user\nUser ID: 1": "message",
      "💬 Website message\nOrder: W1": "message",
      "MANUAL REVIEW REQUIRED - API BLOCKED\nUser ID: 1": "attention",
      "⚠️ Paid cancellation request\nUser ID: 1": "attention",
      "❌ Automatic provider submission failed\nUser: 1\nAutomatic retry 1/3 in about 2 min.": "retrying",
      "❌ Automatic provider submission failed\nUser: 1\nAutomatic retries used up. Tap RETRY NOW when the service is healthy.": "failed",
      "⚠️ Automatic retry stopped: similarity service still unavailable.": "failed",
      "✅ AI CHECK COMPLETE\nFile: a.docx": "provider",
      "⏳ REPORTS READY\nFile: a.docx": "provider",
      "📢 Discount broadcast preview\nNew price KES 90": "broadcast",
      "✅ PAID\nUser: 1": "orders",
      "🔥 New user started bot\nName: A": "orders",
      "Something else": "other"
    };
    for (const [text, cat] of Object.entries(cases)) assert.equal(classify(text), cat, text);

    // 2. A real bot. Fake Telegram first, then the copy is installed on top.
    const ADMIN = 6569201830;
    const api = [];
    let nextId = 100;
    Telegram.prototype.callApi = async function (method, payload) {
      api.push([method, payload.chat_id, payload.callback_query_id || null]);
      if (method === "answerCallbackQuery") throw new Error("must not reach Telegram for web taps");
      return { message_id: ++nextId, chat: { id: payload.chat_id }, date: 0, text: payload.text,
        ...(method === "sendDocument" ? { document: { file_name: "report.pdf" } } : {}) };
    };
    const notified = [];
    const chat = createBotChat({ file: path.join(dir, "chat.json"), adminId: ADMIN, onEntry: (e, o) => notified.push([e.category, o.isNew, e.text.split("\n")[0]]) });
    chat.install(Telegram);
    chat.install(Telegram); // twice is harmless

    const bot = new Telegraf("1:FAKE");
    bot.botInfo = { id: 1, is_bot: true, username: "jkbot", first_name: "JK" };
    let provider = "Quetext";
    bot.command("plagiarism", ctx => ctx.reply("🔗 Plagiarism provider: " + provider,
      Markup.inlineKeyboard([[Markup.button.callback("Use JK SimilarityCheck", "PROV_JK")], [Markup.button.url("Docs", "https://example.com")]])));
    bot.action("PROV_JK", async ctx => {
      if (ctx.from.id !== ADMIN) return ctx.answerCbQuery("Admin only.");
      provider = "JK SimilarityCheck";
      await ctx.answerCbQuery("Switched");
      await ctx.editMessageText("🔗 Plagiarism provider: " + provider + " ✅");
    });
    bot.on("text", ctx => ctx.reply("Echo: " + ctx.message.text));

    // 3. Messages to the admin are copied (with buttons); other chats are not.
    await bot.telegram.sendMessage(ADMIN, "🧾 *M-Pesa* message received\nUser ID: 5", { parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "✅ Confirm", callback_data: "ADMIN_PAID_5" }]] } });
    await bot.telegram.sendMessage(12345, "customer text");
    await bot.telegram.sendDocument(ADMIN, { source: Buffer.from("x"), filename: "report.pdf" }, { caption: "⏳ REPORTS READY" });
    let feed = chat.feed().entries;
    assert.equal(feed.length, 2);
    assert.equal(feed[0].text, "🧾 M-Pesa message received\nUser ID: 5", "Markdown stars removed");
    assert.equal(feed[0].category, "payment");
    assert.deepEqual(feed[0].buttons, [[{ text: "✅ Confirm", data: "ADMIN_PAID_5" }]]);
    assert.equal(feed[1].file, "report.pdf");
    assert.deepEqual(notified.slice(0, 2).map(n => n[0]), ["payment", "provider"]);

    // 4. A failure that turns into "retries used up" by an edit notifies once.
    const fail = await bot.telegram.sendMessage(ADMIN, "❌ Automatic provider submission failed\nAutomatic retry 1/3 in about 2 min.");
    assert.equal(notified.at(-1)[0], "retrying");
    await bot.telegram.editMessageText(ADMIN, fail.message_id, undefined, "❌ Automatic provider submission failed\nAutomatic retries used up. Tap RETRY NOW when the service is healthy.",
      { reply_markup: { inline_keyboard: [[{ text: "RETRY NOW", callback_data: "PRETRY:1234567890" }]] } });
    assert.deepEqual(notified.at(-1).slice(0, 2), ["failed", false]);
    const edited = chat.feed().entries.find(e => e.messageId === fail.message_id);
    assert.equal(edited.category, "failed");
    assert.equal(edited.buttons[0][0].text, "RETRY NOW");
    const count = notified.length;
    await bot.telegram.editMessageText(ADMIN, fail.message_id, undefined, "❌ Automatic provider submission failed\nAutomatic retries used up. Tap RETRY NOW when the service is healthy. ");
    assert.equal(notified.length, count, "already failed: no second alert");

    // 5. A command typed in the panel runs like one from Telegram; the answer is copied.
    const r1 = await chat.sendText(bot, "/plagiarism");
    assert.equal(r1.finished, true);
    feed = chat.feed().entries;
    assert.equal(feed.at(-2).from, "you");
    const reply = feed.at(-1);
    assert.equal(reply.text, "🔗 Plagiarism provider: Quetext");
    assert.deepEqual(reply.buttons, [[{ text: "Use JK SimilarityCheck", data: "PROV_JK" }], [{ text: "Docs", url: "https://example.com" }]]);
    await chat.sendText(bot, "hello there");
    assert.equal(chat.feed().entries.at(-1).text, "Echo: hello there", "plain text reaches the bot too (reply mode etc.)");
    await assert.rejects(chat.sendText(bot, "   "), /Type a command/);

    // 6. A button tapped in the panel: handled as the admin, answered locally, message edited.
    const r2 = await chat.press(bot, reply.id, "PROV_JK");
    assert.equal(r2.toast, "Switched");
    assert.equal(provider, "JK SimilarityCheck");
    assert.equal(chat.feed().entries.find(e => e.id === reply.id).text, "🔗 Plagiarism provider: JK SimilarityCheck ✅");
    assert(!api.some(([m]) => m === "answerCallbackQuery"), "web taps never reach Telegram's answerCallbackQuery");
    await assert.rejects(chat.press(bot, reply.id, "SOMETHING_ELSE"), /no longer available/);
    await assert.rejects(chat.press(bot, 99999, "PROV_JK"), /no longer available/);

    // 7. Saved to disk and reloaded.
    await new Promise(r => setTimeout(r, 900));
    const again = createBotChat({ file: path.join(dir, "chat.json"), adminId: ADMIN });
    assert.equal(again.feed().entries.length, chat.feed().entries.length);

    // 8. Notifications: keys made once and kept; categories per device; gone devices removed.
    const sent = [];
    const fakePush = {
      generateVAPIDKeys: () => ({ publicKey: "PUB" + Math.random(), privateKey: "PRIV" }),
      sendNotification: async (sub, payload, opts) => {
        if (sub.endpoint.includes("gone")) { const e = new Error("gone"); e.statusCode = 410; throw e; }
        sent.push([sub.endpoint, JSON.parse(payload).title, opts.vapidDetails.publicKey.slice(0, 3)]);
      }
    };
    const push = createAdminPush({ file: path.join(dir, "push.json"), webpush: fakePush, log: { error() {} } });
    const key = push.publicKey();
    assert.equal(createAdminPush({ file: path.join(dir, "push.json"), webpush: fakePush }).publicKey(), key, "same keys after restart");
    const sub = ep => ({ endpoint: "https://fcm.googleapis.com/" + ep, keys: { p256dh: "p", auth: "a" } });
    assert.throws(() => push.subscribe({ endpoint: "http://x" }, []), /Invalid/);
    push.subscribe(sub("phone"), ["payment", "message"], "Android phone");
    push.subscribe(sub("laptop"), ["failed"], "Windows");
    push.subscribe(sub("gone"), ["payment"], "Old");
    const r = await push.send({ title: "🧾 M-Pesa message received" }, { category: "payment" });
    assert.deepEqual(r, { sent: 1, removed: 1 });
    assert.deepEqual(sent, [["https://fcm.googleapis.com/phone", "🧾 M-Pesa message received", "PUB"]]);
    assert.equal(push.devices(), 2, "gone device removed");
    assert.deepEqual(push.device(sub("phone").endpoint).categories, ["payment", "message"]);
    push.subscribe(sub("phone"), ["shop"], "Android phone");
    assert.deepEqual(push.device(sub("phone").endpoint).categories, ["shop"], "updated, not duplicated");
    assert.equal(push.devices(), 2);
    push.unsubscribe(sub("laptop").endpoint);
    assert.equal(push.device(sub("laptop").endpoint), null);
    assert.equal((await push.send({ title: "x" }, { endpoint: sub("phone").endpoint })).sent, 1, "test to one device");

    // 9. Lock-screen text: first line as title, next two lines as body, trimmed.
    assert.deepEqual(summarize("💬 Support message from user\nUser ID: 5\nName: Mary\nUsername: @m\n\nsecret text"),
      { title: "💬 Support message from user", body: "User ID: 5 · Name: Mary" });

    // 10. Shop events: new paid orders and new customer messages only.
    const prev = { O1: { productName: "Chegg", paymentState: "PENDING", messages: [] },
      O2: { productName: "Grammarly", paymentState: "COMPLETE", messages: [{ at: 1, from: "client", text: "hi" }] } };
    const next = { O1: { productName: "Chegg", amount: 500, paymentState: "COMPLETE", messages: [] },
      O2: { productName: "Grammarly", paymentState: "COMPLETE", messages: [{ at: 1, from: "client", text: "hi" }, { at: 2, from: "support", text: "login" }, { at: 3, from: "client", text: "thanks" }] } };
    const ev = shopEvents(prev, next);
    assert.deepEqual(ev.map(e => [e.kind, e.orderId]), [["paid", "O1"], ["message", "O2"]]);
    assert.match(ev[0].text, /New paid shop order\nChegg · KES 500/);
    assert.match(ev[1].text, /thanks/);
    assert.equal(classify(ev[0].text), "other", "shop entries are added with category shop explicitly");

    // 11. bot.js wiring.
    const src = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
    assert(src.includes('const { Telegraf, Markup, Telegram } = require("telegraf");'));
    assert(src.includes("adminBotChat.install(Telegram);"));
    // Installed on the shared prototype at load time, before the bot starts receiving or sending.
    const firstStart = Math.min(...["bot.launch(", "webhookCallback(", "setWebhook("].map(k => src.indexOf(k)).filter(i => i >= 0));
    assert(src.indexOf("adminBotChat.install(Telegram);") < firstStart, "copy installed before the bot starts");
    assert(src.includes('onEvents: events => events.forEach(ev => adminBotChat.add({ from: "bot", category: "shop", text: ev.text }))'));
    assert(src.includes("botChat: adminBotChat,") && src.includes("push: adminPush,"));
    assert(JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).dependencies["web-push"]);

    console.log("PASS: bot chat: admin messages copied with buttons and categories; edits tracked; other chats ignored.");
    console.log("PASS: commands and plain text typed in the panel run as the admin; panel taps answered locally.");
    console.log("PASS: 'retries used up' notifies once; notifications per device and category; gone devices removed.");
    console.log("PASS: shop events (new paid order, new customer message); lock-screen text trimmed.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
