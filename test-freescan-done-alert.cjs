"use strict";
// JK_FREESCAN_DONE_ALERT_V1: the admin is told when a free scan finishes (Bot
// chat, pop-up, phone) under a new "🧪 Free scans finished" category that is
// on by default, also for devices set up before it existed. Offline.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

(async () => {
  const src = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  // 1. The message (runs the real function from bot.js).
  const start = src.indexOf("function freeScanDoneText(job) {");
  const end = src.indexOf("async function updateProviderAdminStatus(");
  const ctx = { require: n => require(n === "./jk-ai-score.cjs" ? path.join(__dirname, "jk-ai-score.cjs") : n), Number, String, Math };
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end), ctx);
  assert.equal(ctx.freeScanDoneText({ files: [{ file_name: "Essay.docx", providerSimilarityPercent: 12.4, providerAiPercent: 8.2 }] }),
    "🧪 Free scan finished\n• Essay.docx — Similarity 12% · AI *% (8%)\nReports are in Bot chat and under Orders → Free scans.");
  assert.equal(ctx.freeScanDoneText({ files: [
    { file_name: "A.docx", providerSimilarityPercent: 0, providerAiPercent: 0.4 },
    { file_name: "B.pdf", adminAiOnly: true, providerAiPercent: 19.6 }] }),
    "🧪 Free scan finished (2 files)\n• A.docx — Similarity 0% · AI 0%\n• B.pdf — AI 20%\nReports are in Bot chat and under Orders → Free scans.");

  // 2. Sent once, when every file of a free scan is delivered; the website note never goes to the admin.
  assert(src.includes('if (job.adminFreeScan === true && !job.freeScanDoneNotifiedAt) {'));
  assert(src.includes('adminBotChat.add({ from: "bot", category: "freescan", text: freeScanDoneText(job) });'));
  assert(src.indexOf("JK_FREESCAN_DONE_ALERT_V1: a free scan finished") > src.indexOf("    if (allDelivered) {"));
  assert(src.includes('isWebUserId(userId) || String(userId) === String(ADMIN_ID)'));

  // 3. The category: on by default; on for devices set up before it existed.
  const { CATEGORIES } = require("./jk-admin-bot-chat.cjs");
  assert.equal(CATEGORIES.freescan.on, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-freescan-alert-"));
  try {
    const file = path.join(dir, "push.json");
    const sent = [];
    const fake = { generateVAPIDKeys: () => ({ publicKey: "P", privateKey: "Q" }),
      sendNotification: async sub => { sent.push(sub.endpoint.split("/").pop()); } };
    const defaults = () => Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.on]));
    const { createAdminPush } = require("./jk-admin-push.cjs");
    const push = createAdminPush({ file, webpush: fake, defaults });
    push.publicKey();
    // An older device (saved before "known" existed) with payments only.
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.devices.push({ subscription: { endpoint: "https://fcm.googleapis.com/old", keys: { p256dh: "p", auth: "a" } }, categories: ["payment"], label: "Old", at: 1 });
    fs.writeFileSync(file, JSON.stringify(state));
    const reloaded = createAdminPush({ file, webpush: fake, defaults });
    // A new device that saw the category and left it unticked.
    reloaded.subscribe({ endpoint: "https://fcm.googleapis.com/new", keys: { p256dh: "p", auth: "a" } }, ["payment"], "New", Object.keys(CATEGORIES));
    await reloaded.send({ title: "🧪 Free scan finished" }, { category: "freescan" });
    assert.deepEqual(sent, ["old"], "older device gets it by default; a device that unticked it doesn't");
    assert(reloaded.device("https://fcm.googleapis.com/old").categories.includes("freescan"), "shown ticked on the older device");
    assert(!reloaded.device("https://fcm.googleapis.com/new").categories.includes("freescan"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  // 4. Panel shows the category.
  assert(fs.readFileSync(path.join(__dirname, "jk-admin-panel.client.js"), "utf8").includes('freescan: "🧪 Free scans"'));
  assert(fs.readFileSync(path.join(__dirname, "jk-admin-panel.cjs"), "utf8").includes("req.body?.label, Object.keys(CATS))"));
  console.log("PASS: free scan finished alert (file, similarity, AI as on the report), once per scan; no website note to the admin.");
  console.log("PASS: '🧪 Free scans finished' on by default, also on devices set up earlier; respected when unticked.");
})().catch(e => { console.error(e); process.exit(1); });
