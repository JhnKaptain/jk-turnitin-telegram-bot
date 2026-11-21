"use strict";
// JK_ADMIN_RELAY_V1: PDFs made by helper programs (AI HIGHLIGHTS, RECOVER REPORTS)
// are handed back to the bot, which sends them: they reach the panel's Bot chat
// (downloadable) and follow the Telegram on/off switch. Offline.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseRelayed, sendRelayed, PREFIX } = require("./jk-admin-relay.cjs");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-relay-"));
  try {
    const pdf = path.join(dir, "AI HIGHLIGHTS - Essay.pdf");
    fs.writeFileSync(pdf, "%PDF-1.4 highlights");

    // 1. A helper started by the bot hands the PDF back (no Telegram token needed).
    const script = path.join(dir, "helper.cjs");
    fs.writeFileSync(script, `require(${JSON.stringify(path.join(__dirname, "jk-low-ai-review.cjs"))}).sendAdmin(${JSON.stringify(pdf)}).then(() => console.log("done"));`);
    const env = { ...process.env, BOT_TOKEN: "" };
    let r = spawnSync(process.execPath, [script], { env: { ...env, JK_ADMIN_RELAY: "1" }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const docs = parseRelayed(r.stdout);
    assert.deepEqual(docs, [{ file: pdf, filename: "AI HIGHLIGHTS - Essay.pdf", caption: "" }]);
    // Run by hand (no relay): it still tries to send itself (here: no token, so it says so).
    r = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
    assert.match(r.stderr, /BOT_TOKEN missing/);

    // 2. Only existing absolute files are accepted.
    assert.deepEqual(parseRelayed(PREFIX + JSON.stringify({ file: "relative.pdf" }) + "\n" +
      PREFIX + JSON.stringify({ file: path.join(dir, "missing.pdf") }) + "\n" + PREFIX + "{bad json\nnoise"), []);

    // 3. The bot sends what was handed back: it lands in Bot chat with the file (Telegram off).
    const { Telegraf, Telegram } = require("telegraf");
    const { createBotChat } = require("./jk-admin-bot-chat.cjs");
    const api = [];
    Telegram.prototype.callApi = async function (method, p) { api.push([method, p.chat_id]); return { message_id: 9 }; };
    const chat = createBotChat({ file: path.join(dir, "chat.json"), adminId: 42, filesDir: path.join(dir, "files"), telegramOff: () => true });
    chat.install(Telegram);
    const bot = new Telegraf("1:FAKE");
    const sent = await sendRelayed(docs, bot.telegram, 42);
    assert.equal(sent, 1);
    const entry = chat.feed().entries.at(-1);
    assert.equal(entry.attachments[0].name, "AI HIGHLIGHTS - Essay.pdf");
    assert.equal((await chat.attachment(entry.id, 0)).buffer.toString(), "%PDF-1.4 highlights", "downloadable in the panel");
    assert.deepEqual(api, [], "nothing went to Telegram while it is off");

    // 4. Wiring: both buttons start their helpers in relay mode and send the results.
    const hl = fs.readFileSync(path.join(__dirname, "jk-ai-highlights-button.cjs"), "utf8");
    const rec = fs.readFileSync(path.join(__dirname, "jk-provider-recovery-button.cjs"), "utf8");
    const rpr = fs.readFileSync(path.join(__dirname, "jk-recover-provider-results.js"), "utf8");
    for (const src of [hl, rec]) {
      assert(src.includes('env: { ...process.env, JK_ADMIN_RELAY: "1" }'), "helper started in relay mode");
      assert(src.includes('require("./jk-admin-relay.cjs").sendRelayed(documents, bot.telegram, adminId)'), "results sent by the bot");
    }
    assert(rpr.includes('if (options.sendAdmin && require("./jk-admin-relay.cjs").relaying()) {'), "recovery hands PDFs back");
    console.log("PASS: helper PDFs (AI HIGHLIGHTS, RECOVER REPORTS) are handed back and sent by the bot.");
    console.log("PASS: they appear in Bot chat as downloads and follow the Telegram on/off switch; manual runs unchanged.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
