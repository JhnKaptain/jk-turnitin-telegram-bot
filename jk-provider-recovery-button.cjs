"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const idOf = file => /^trn:oid:::1:([1-9]\d{9})$/.exec(String(file?.jkSubmissionId || ""))?.[1];

function eligible(file) {
  const id = idOf(file);
  const filename = file?.providerResultsFile ||
    (file?.providerBundleFile ? file.providerBundleFile + ".provider-results.json" : "");
  if (!id || !path.isAbsolute(filename) || !filename.endsWith(".provider-results.json")) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (saved.version !== 1 || saved.providerResults?.similarity?.status !== "fulfilled" ||
        !Number.isFinite(saved.providerResults.similarity.value?.score) ||
        typeof saved.canonicalDocument?.text !== "string" ||
        typeof saved.preparedInputs?.similarity?.text !== "string") return null;
    return { id, filename, name: file.file_name || file.fileName || "Document",
      changed: fs.statSync(filename).mtimeMs };
  } catch { return null; }
}
function resolveFile(jobs, id) {
  const found = [];
  for (const job of Object.values(jobs || {})) {
    for (const file of job?.files || []) if (idOf(file) === id) found.push(file);
  }
  return found.length === 1 ? eligible(found[0]) : null;
}
function replyMarkup(options) {
  const item = options.stage === "review" ? eligible(options.file) : null;
  return { inline_keyboard: item ? [[{ text: "RECOVER REPORTS", callback_data: "RECV:" + item.id }]] : [] };
}
function runChild(filename) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      [path.join(__dirname, "jk-recover-reviewed-results.cjs"), "--checkpoint", filename],
      { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let detail = "";
    const capture = chunk => { detail = (detail + chunk.toString()).slice(-1500); };
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) return resolve();
      console.error("Saved report recovery stopped:", detail);
      reject(new Error(code === 2
        ? "Some offsets still require review. No new scan or client delivery was triggered."
        : "Recovery failed. Check service logs; saved results remain available."));
    });
  });
}
function register(bot, { adminId, getJobs, run = runChild }) {
  const active = new Set();
  const adminOnly = ctx => Number(ctx.from?.id) === Number(adminId) && Number(ctx.chat?.id) === Number(adminId);
  const answer = (ctx, text) => ctx.answerCbQuery(text).catch(() => {});
  bot.action(/^RECV:([1-9]\d{9})$/, async ctx => {
    if (!adminOnly(ctx)) return answer(ctx, "Admin only.");
    const id = ctx.match[1];
    if (active.has(id)) return answer(ctx, "Recovery is already running for this file.");
    if (active.size) return answer(ctx, "Another recovery is running. Try again shortly.");
    const item = resolveFile(getJobs(), id);
    if (!item) return answer(ctx, "Completed similarity results are missing or expired. Recovery cannot start a scan.");
    active.add(id);
    await answer(ctx, "Recovering saved reports to your admin chat.");
    Promise.resolve().then(() => run(item.filename)).catch(async error => {
      console.error("Recovery button failed:", error.message);
      await bot.telegram.sendMessage(adminId,
        "Recovery requires review: " + item.name + "\n" + String(error.message).slice(0, 600));
    }).catch(error => console.error("Recovery error notice failed:", error.message))
      .finally(() => active.delete(id));
  });
  bot.command("recoverreports", async ctx => {
    if (!adminOnly(ctx)) return;
    const jobs = getJobs() || {}, entries = [], seen = new Set();
    for (const job of Object.values(jobs)) {
      for (const file of job?.files || []) {
        // Also allow already-completed reports with saved verified provider results.
        // Recovery is admin-only and never resubmits to paid providers.
        const item = eligible(file);
        if (!item || seen.has(item.id) || !resolveFile(jobs, item.id)) continue;
        seen.add(item.id); entries.push(item);
      }
    }
    entries.sort((a, b) => b.changed - a.changed);
    const latest = entries.slice(0, 10);
    if (!latest.length) return ctx.reply("No saved provider results are available to recover without another scan.");
    return ctx.reply("RECOVER REPORTS - select saved results (admin preview only, no provider charges):", { reply_markup: {
      inline_keyboard: latest.map(item => [{ text: item.name.slice(0, 70), callback_data: "RECV:" + item.id }])
    } });
  });
}
module.exports = { eligible, resolveFile, replyMarkup, register };
