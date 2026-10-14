"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { validateBundle } = require("./jk-low-ai-review.cjs");
const idOf = file => /^trn:oid:::1:([1-9]\d{9})$/.exec(String(file?.jkSubmissionId || ""))?.[1];

function eligible(file, options = {}) {
  if (options.runAi === false) return null;
  const id = idOf(file);
  const filename = file?.providerBundleFile;
  if (!id || typeof filename !== "string" || !path.isAbsolute(filename)) return null;
  try {
    const bundle = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (bundle.reportIdentity?.jkSubmissionId !== file.jkSubmissionId) return null;
    const percent = validateBundle(bundle);
    return { id, filename, percent, name: bundle.reportIdentity.filename || "Document",
      changed: fs.statSync(filename).mtimeMs };
  } catch { return null; }
}

function replyMarkup(options) {
  if (!["ready", "delivered"].includes(options.stage)) return { inline_keyboard: [] };
  const item = eligible(options.file, options);
  return { inline_keyboard: item ? [[{ text: "AI HIGHLIGHTS", callback_data: "AIHL:" + item.id }]] : [] };
}

function resolveFile(jobs, id) {
  const found = [];
  for (const job of Object.values(jobs || {})) {
    for (const file of job?.files || []) if (idOf(file) === id) found.push(file);
  }
  if (found.length !== 1) return null;
  return eligible(found[0]);
}

function runChild(filename) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "jk-low-ai-review.cjs"), "--bundle", filename],
      { stdio: ["ignore", "ignore", "pipe"], shell: false });
    let errorText = "";
    child.stderr.on("data", chunk => { errorText = (errorText + chunk.toString()).slice(-1500); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(errorText.trim() || "PDF generation failed.")));
  });
}

function register(bot, { adminId, getJobs, run = runChild }) {
  const active = new Set();
  const adminOnly = ctx => Number(ctx.from?.id) === Number(adminId) && Number(ctx.chat?.id) === Number(adminId);
  const answer = (ctx, text) => ctx.answerCbQuery(text).catch(() => {});
  bot.action(/^AIHL:([1-9]\d{9})$/, async ctx => {
    if (!adminOnly(ctx)) return answer(ctx, "Admin only.");
    const id = ctx.match[1];
    if (active.has(id)) return answer(ctx, "This PDF is already being prepared.");
    if (active.size >= 2) return answer(ctx, "Two PDFs are being prepared. Try again shortly.");
    const item = resolveFile(getJobs(), id);
    if (!item) return answer(ctx, "Saved results are unavailable, expired or not eligible.");
    active.add(id);
    await answer(ctx, "Preparing AI HIGHLIGHTS for your admin chat.");
    // Run outside the callback lifetime; only the existing admin-only worker sends the PDF.
    Promise.resolve().then(() => run(item.filename)).catch(async error => {
      console.error("AI HIGHLIGHTS button failed:", error.message);
      await bot.telegram.sendMessage(adminId,
        "AI HIGHLIGHTS could not be prepared for " + item.name + ".\n" + String(error.message).slice(0, 600));
    }).catch(error => console.error("AI HIGHLIGHTS error notice failed:", error.message))
      .finally(() => active.delete(id));
  });
  bot.command("aihighlights", async ctx => {
    if (!adminOnly(ctx)) return;
    const entries = [];
    const seen = new Set();
    for (const job of Object.values(getJobs() || {})) {
      for (const file of job?.files || []) {
        const item = eligible(file);
        if (!item || seen.has(item.id) || !resolveFile(getJobs(), item.id)) continue;
        seen.add(item.id);
        entries.push(item);
      }
    }
    entries.sort((a, b) => b.changed - a.changed);
    const latest = entries.slice(0, 10);
    if (!latest.length) return ctx.reply("No saved reports are currently eligible for AI HIGHLIGHTS.");
    return ctx.reply("AI HIGHLIGHTS — select a saved report:", { reply_markup: {
      inline_keyboard: latest.map(item => [{ text: item.name.slice(0, 70), callback_data: "AIHL:" + item.id }])
    } });
  });
}
module.exports = { eligible, replyMarkup, resolveFile, register };
