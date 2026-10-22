"use strict";
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), os = require("os");
const { eligible, replyMarkup, register } = require("./jk-provider-recovery-button.cjs");
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jk-recovery-button-test-"));
  try {
    const filename = path.join(directory, "bundle.json.provider-results.json");
    const file = { jkSubmissionId: "trn:oid:::1:1234567890", providerResultsFile: filename,
      file_name: "Example.docx", manualReviewRequired: false, providerStatus: "COMPLETED" };
    const saved = { version: 1, canonicalDocument: { text: "Original sentence." },
      preparedInputs: { similarity: { text: "Original sentence." } },
      providerResults: { similarity: { status: "fulfilled", value: { score: 4 } } } };
    const write = () => fs.writeFileSync(filename, JSON.stringify(saved)); write();
    assert.equal(replyMarkup({ file, stage: "review" }).inline_keyboard[0][0].text, "RECOVER REPORTS");
    assert.equal(replyMarkup({ file, stage: "ready" }).inline_keyboard.length, 0);
    saved.providerResults.similarity = { status: "rejected", error: "Insufficient API credits." }; write();
    assert.equal(eligible(file), null);
    saved.providerResults.similarity = { status: "fulfilled", value: { score: 4 } }; write();
    let action, command, calls = 0, finish;
    const answers = [], replies = [], notices = [];
    const bot = { action: (pattern, fn) => { assert(pattern.test("RECV:1234567890")); action = fn; },
      command: (name, fn) => { assert.equal(name, "recoverreports"); command = fn; },
      telegram: { sendMessage: async (...args) => notices.push(args) } };
    const jobs = { job: { userId: 111, files: [file] } };
    register(bot, { adminId: 999, getJobs: () => jobs,
      run: async value => { assert.equal(value, filename); calls++; await new Promise(resolve => { finish = resolve; }); } });
    const ctx = (from, chat = from) => ({ from: { id: from }, chat: { id: chat }, match: ["RECV:1234567890", "1234567890"],
      answerCbQuery: async text => answers.push(text), reply: async (...args) => replies.push(args) });
    await action(ctx(111)); await action(ctx(999, 111)); assert.equal(calls, 0);
    await command(ctx(111)); assert.equal(replies.length, 0);
    await command(ctx(999)); assert.equal(replies[0][1].reply_markup.inline_keyboard.length, 1);
    assert.match(replies[0][0], /no provider charges/);
    await action(ctx(999)); await tick(); assert.equal(calls, 1);
    await action(ctx(999)); assert.equal(calls, 1); finish(); await tick();
    assert.equal(notices.length, 0);
    fs.unlinkSync(filename); await action(ctx(999)); assert.equal(calls, 1);
    assert(answers.some(text => text.includes("expired")));
    // A failed recovery sends only the admin a review notice.
    write();
    register(bot, { adminId: 999, getJobs: () => jobs, run: async () => { throw new Error("Offsets require review."); } });
    await action(ctx(999)); await tick();
    assert.equal(notices[0][0], 999);
    console.log("PASS: recovery button, admin-only access, credit-failure exclusion, duplicate-click protection, expired results and failure notice. Mock tests; no API requests or Telegram deliveries.");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
