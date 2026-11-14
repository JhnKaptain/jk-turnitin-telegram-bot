"use strict";
/*
  JK_PROVIDER_AUTO_RETRY_V1
  -------------------------
  A check that fails because a provider was briefly unreachable (simcheck
  restarting: HTTP 502/503/504, "fetch failed", connection reset, timeout) is
  retried automatically: up to 3 times, after 2, 8 and 20 minutes. Before each
  attempt the similarity service must report healthy; otherwise the attempt
  waits 2 more minutes, giving up 60 minutes after the first failure.

  - The same stored job is rerun through the same path (same Telegram file).
  - The failed attempt's saved provider results are moved aside (renamed, not
    deleted) so the pipeline does not refuse the rerun.
  - Pending retries are stored on the file, so they survive a bot restart.
  - Non-temporary failures (alignment, review, bad input) are never retried.
  - When automatic retries are used up, the admin gets a RETRY NOW button.
  - Customers are not messaged about failures; their report arrives later.
*/

const fs = require("fs");

const DELAYS_MINUTES = [2, 8, 20];
const HEALTH_WAIT_MINUTES = 2;
const GIVE_UP_MINUTES = 60;
const TRANSIENT = /HTTP 50[0234]\b|temporarily unavailable|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network error|scan timed out|The operation was aborted/i;
const NEVER = /cannot be aligned|ambiguous interpretations|manual review|reference boundary|Unsupported|exceeds/i;

const idOf = file => /^trn:oid:::1:([1-9]\d{9})$/.exec(String(file?.jkSubmissionId || ""))?.[1] || null;
const minutes = n => n * 60 * 1000;

function isTransient(error) {
  const text = String(error?.message || error || "");
  return TRANSIENT.test(text) && !NEVER.test(text);
}

function createAutoRetry({
  getJobs,
  save,
  runJob,
  sendAdmin = async () => {},
  healthUrl = null,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  setTimer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }
}) {
  const timers = new Map();

  function schedule(jobId, at) {
    clearTimeout(timers.get(jobId));
    timers.set(jobId, setTimer(() => {
      timers.delete(jobId);
      attempt(jobId).catch(error => console.error("Auto-retry failed:", error?.message || error));
    }, Math.max(0, at - now())));
  }

  // Called from the job runner when a file fails. Returns what was decided.
  function onFailure(job, file, error) {
    if (!job || !file || !isTransient(error) || file.providerAutoResubmitBlocked) {
      return { scheduled: false };
    }
    const count = Number(file.providerRetryCount || 0);
    if (!file.providerRetryFirstFailedAt) file.providerRetryFirstFailedAt = now();
    if (count >= DELAYS_MINUTES.length) {
      file.providerRetryAt = null;
      file.providerRetryExhausted = true;
      return { scheduled: false, exhausted: true };
    }
    file.providerRetryCount = count + 1;
    file.providerRetryAt = now() + minutes(DELAYS_MINUTES[count]);
    file.providerRetryExhausted = false;
    save();
    schedule(job.jobId, file.providerRetryAt);
    return { scheduled: true, attempt: file.providerRetryCount, at: file.providerRetryAt };
  }

  async function healthy() {
    const url = typeof healthUrl === "function" ? healthUrl() : healthUrl;
    if (!url || typeof fetchImpl !== "function") return true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function moveSavedResultsAside(file) {
    const saved = file.providerBundleFile ? file.providerBundleFile + ".provider-results.json" : "";
    if (saved && fs.existsSync(saved)) {
      fs.renameSync(saved, saved.replace(/\.provider-results\.json$/, `.failed-${now()}.provider-results.json`));
    }
  }

  async function attempt(jobId, { force = false } = {}) {
    const job = getJobs()[jobId];
    if (!job || job.providerRetryRunning) return { ran: false, reason: "busy-or-missing" };
    const due = (job.files || []).filter(file =>
      String(file?.providerStatus || "").toUpperCase() === "FAILED" &&
      !file.providerAutoResubmitBlocked &&
      (force || (file.providerRetryAt && file.providerRetryAt <= now())));
    if (!due.length) return { ran: false, reason: "nothing-due" };

    if (!force && !(await healthy())) {
      const first = Math.min(...due.map(f => f.providerRetryFirstFailedAt || now()));
      if (now() - first < minutes(GIVE_UP_MINUTES)) {
        const later = now() + minutes(HEALTH_WAIT_MINUTES);
        for (const file of due) file.providerRetryAt = later;
        save();
        schedule(jobId, later);
        return { ran: false, reason: "unhealthy-waiting" };
      }
      for (const file of due) { file.providerRetryAt = null; file.providerRetryExhausted = true; }
      save();
      await sendAdmin(`⚠️ Automatic retry stopped: similarity service still unavailable.\nJob: ${jobId}\nUse RETRY NOW once it is healthy.`);
      return { ran: false, reason: "unhealthy-gave-up" };
    }

    job.providerRetryRunning = true;
    try {
      for (const file of due) {
        moveSavedResultsAside(file);
        file.providerStatus = null;
        file.providerError = null;
        file.providerRetryAt = null;
      }
      save();
      await runJob(jobId);
      return { ran: true, files: due.length };
    } finally {
      job.providerRetryRunning = false;
      save();
    }
  }

  // Re-arms retries that were pending when the bot restarted.
  function resume() {
    for (const job of Object.values(getJobs() || {})) {
      const pending = (job?.files || []).map(f => f?.providerRetryAt).filter(Number.isFinite);
      if (pending.length) schedule(job.jobId, Math.min(...pending));
    }
  }

  function findBySubmission(id) {
    for (const job of Object.values(getJobs() || {})) {
      for (const file of job?.files || []) if (idOf(file) === id) return { job, file };
    }
    return null;
  }

  function register(bot, adminId) {
    bot.action(/^PRETRY:([1-9]\d{9})$/, async ctx => {
      if (Number(ctx.from?.id) !== Number(adminId)) return ctx.answerCbQuery("Admin only.");
      const found = findBySubmission(ctx.match[1]);
      if (!found) return ctx.answerCbQuery("Check not found.", { show_alert: true });
      found.file.providerRetryCount = 0;
      found.file.providerRetryFirstFailedAt = now();
      found.file.providerRetryExhausted = false;
      save();
      await ctx.answerCbQuery("Retrying now…");
      const result = await attempt(found.job.jobId, { force: true });
      if (!result.ran && result.reason !== "busy-or-missing") {
        await sendAdmin("Retry not started: " + result.reason.replace(/-/g, " ") + ".");
      }
    });
  }

  return { isTransient, onFailure, attempt, resume, replyMarkup, register, schedule };
}

// Admin status button, shown once automatic retries are not pending.
function replyMarkup({ file, stage }) {
  const id = idOf(file);
  const show = stage === "failed" && id && !file.providerAutoResubmitBlocked &&
    !file.providerRetryAt && String(file.providerStatus || "").toUpperCase() === "FAILED";
  return { inline_keyboard: show ? [[{ text: "RETRY NOW", callback_data: "PRETRY:" + id }]] : [] };
}

function statusLine(file, nowMs = Date.now()) {
  if (file?.providerRetryAt && file.providerRetryAt > nowMs) {
    const mins = Math.max(1, Math.ceil((file.providerRetryAt - nowMs) / 60000));
    return `Automatic retry ${file.providerRetryCount}/${DELAYS_MINUTES.length} in about ${mins} min.`;
  }
  if (file?.providerRetryExhausted) return "Automatic retries used up. Tap RETRY NOW when the service is healthy.";
  return null;
}

module.exports = { createAutoRetry, isTransient, statusLine, replyMarkup, DELAYS_MINUTES };
