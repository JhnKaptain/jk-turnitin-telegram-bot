"use strict";
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), os = require("os");
const { eligible, replyMarkup, register } = require("./jk-ai-highlights-button.cjs");
const { updateAdminStatus } = require("./jk-provider-admin-status.js");
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jk-button-test-"));
  try {
    const filename = path.join(directory, "bundle.json");
    const file = { jkSubmissionId: "trn:oid:::1:1234567890", providerBundleFile: filename, file_name: "Example.docx" };
    const bundle = { reportIdentity: { jkSubmissionId: file.jkSubmissionId, filename: file.file_name },
      canonicalDocument: { text: "Original sentence." },
      aiDetection: { provider: "sapling", available: true, percent: 12.3,
        ranges: [{ id: "s1", start: 0, end: 18, sentence: "Original sentence.", score: 0.9 }] } };
    const write = () => fs.writeFileSync(filename, JSON.stringify(bundle)); write();
    const options = { file, stage: "ready", job: { userId: 111 }, runAi: true,
      rendered: { aiAvailable: true, aiPercent: 12.3 } };
    assert.equal(replyMarkup(options).inline_keyboard[0][0].callback_data, "AIHL:1234567890");
    assert.equal(replyMarkup({ ...options, stage: "submitted" }).inline_keyboard.length, 0);
    assert.equal(replyMarkup({ ...options, runAi: false }).inline_keyboard.length, 0);
    for (const percent of [0, 20, 100]) {
      bundle.aiDetection.percent = percent; write();
      assert.equal(eligible(file), null);
    }
    bundle.aiDetection.percent = 12.3; write();
    const edits = [], sends = [];
    const statusOptions = { ...options, adminId: 999, save: () => {}, telegram: {
      sendMessage: async (...args) => { sends.push(args); return { message_id: 42 }; },
      editMessageText: async (...args) => { edits.push(args); }
    } };
    await updateAdminStatus(statusOptions);
    assert.equal(sends[0][0], 999);
    assert.equal(sends[0][2].reply_markup.inline_keyboard[0][0].text, "AI HIGHLIGHTS");
    await updateAdminStatus(statusOptions); assert.equal(edits.length, 0);
    await updateAdminStatus({ ...statusOptions, stage: "delivered" });
    assert.equal(edits[0][4].reply_markup.inline_keyboard[0][0].text, "AI HIGHLIGHTS");
    // Expiration removes the keyboard even when message text is unchanged.
    fs.unlinkSync(filename);
    await updateAdminStatus({ ...statusOptions, stage: "delivered" });
    assert.equal(edits[1][4].reply_markup.inline_keyboard.length, 0); write();
    let action, command, calls = 0, finish;
    const notices = [], answers = [], replies = [];
    const bot = { action: (pattern, handler) => { assert(pattern.test("AIHL:1234567890")); action = handler; },
      command: (name, handler) => { assert.equal(name, "aihighlights"); command = handler; },
      telegram: { sendMessage: async (...args) => notices.push(args) } };
    const jobs = { job: { userId: 111, files: [file] } };
    register(bot, { adminId: 999, getJobs: () => jobs,
      run: async value => { assert.equal(value, filename); calls++; await new Promise(resolve => { finish = resolve; }); } });
    const ctx = (from, chat = from) => ({ from: { id: from }, chat: { id: chat }, match: ["AIHL:1234567890", "1234567890"],
      answerCbQuery: async text => answers.push(text), reply: async (...args) => replies.push(args) });
    await action(ctx(111)); await action(ctx(999, 111)); assert.equal(calls, 0);
    await command(ctx(111)); assert.equal(replies.length, 0);
    await command(ctx(999)); assert.equal(replies[0][1].reply_markup.inline_keyboard.length, 1);
    await action(ctx(999)); await tick(); assert.equal(calls, 1);
    await action(ctx(999)); assert.equal(calls, 1);
    assert(answers.includes("This PDF is already being prepared."));
    finish(); await tick(); assert.equal(notices.length, 0);
    fs.unlinkSync(filename); await action(ctx(999)); assert.equal(calls, 1);
    assert(answers.some(text => text.includes("expired")));
    console.log("PASS: starred-only buttons, admin/private-chat authorization, duplicate-click protection, status edits, expired files and admin list. Mock tests; no API requests or Telegram deliveries.");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
