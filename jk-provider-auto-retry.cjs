"use strict";
/*
  JK_PROVIDER_AUTO_RETRY_V1
  -------------------------
  A check that fails because a provider was briefly unreachable (simcheck
  restarting: HTTP 502/503/504, "fetch failed", connection reset, timeout) is
  retried automatically: up to 3 times, 2, 3 and 5 minutes apart (about 10
  minutes in all). Before each attempt the similarity service must report
  healthy; otherwise the attempt waits 1 more minute, giving up 10 minutes
  after the first failure. Then the admin gets RETRY NOW.

  - The same stored job is rerun through the same path (same Telegram file).
  - The failed attempt's saved provider results are moved aside (renamed, not
    deleted) so the pipeline does not refuse the rerun.
  - Pending retries are stored on the file, so they survive a bot restart.
  - Non-temporary failures (alignment, review, bad input) are never retried.
  - When automatic retries are used up, the admin gets a RETRY NOW button.
  - Customers are not messaged about failures; their report arrives later.

  JK_SIMILARITY_FALLBACK_V1: when the failure is in the similarity check itself
  (either checker, including Quetext credit/login problems), retries 1 and 2 use
  the chosen checker and retry 3 uses the other one, for that file only. If the
  chosen checker never comes back healthy, the wait ends in that fallback retry.
  If the fallback fails too: RETRY NOW, which goes back to the chosen checker.
  Documents that cannot be read are never retried or switched.
*/

const fs = require("fs");

const DELAYS_MINUTES = [2, 3, 5];
const HEALTH_WAIT_MINUTES = 1;
const GIVE_UP_MINUTES = 10;
const TRANSIENT = /HTTP 50[0234]\b|temporarily unavailable|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network error|scan timed out|The operation was aborted/i;
const NEVER = /cannot be aligned|ambiguous interpretations|manual review|reference boundary|Unsupported|exceeds/i;
const SIMILARITY = /Similarity provider did not return a usable result/i;
// The document itself is the problem: the other checker would fail too.
const BAD_INPUT = /too short|too few words|not enough text|no (readable |extractable )?text|empty document|could not (be )?(read|extract)|unreadable|password[- ]protected|corrupt/i;
const LABELS = { quetext: "Quetext", jksimilarity: "JK SimilarityCheck" };

const idOf = file => /^trn:oid:::1:([1-9]\d{9})$/.exec(String(file?.jkSubmissionId || ""))?.[1] || null;
const minutes = n => n * 60 * 1000;

function isTransient(error) {
  const text = String(error?.message || error || "");
  return TRANSIENT.test(text) && !NEVER.test(text);
}

// A failure of the similarity check that the other checker could solve.
function isSimilarityFailure(error) {
  const text = String(error?.message || error || "");
  return SIMILARITY.test(text) && !NEVER.test(text) && !BAD_INPUT.test(text);
}

function createAutoRetry({
  getJobs,
  save,
  runJob,
  sendAdmin = async () => {},
  refreshStatus = async () => {},   // re-renders the admin status message for (job, file)
  healthUrl = null,
  // JK_SIMILARITY_FALLBACK_V1: file -> the other checker's name (null = no fallback),
  // and file -> whether its next attempt runs on JK SimilarityCheck (health gate).
  fallbackFor = null,
  usesSimcheck = null,
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
    const similarity = isSimilarityFailure(error);
    if (!job || !file || (!isTransient(error) && !similarity) || file.providerAutoResubmitBlocked) {
      return { scheduled: false };
    }
    // JK_RETRY_STOP_BUTTON_V1: the admin stopped automatic retries for this file.
    if (file.providerRetryStopped) {
      file.providerRetryAt = null;
      save();
      return { scheduled: false, stopped: true };
    }
    const count = Number(file.providerRetryCount || 0);
    if (!file.providerRetryFirstFailedAt) file.providerRetryFirstFailedAt = now();
    if (count >= DELAYS_MINUTES.length) {
      file.providerRetryAt = null;
      file.providerRetryExhausted = true;
      file.providerSimilarityFallback = null; // RETRY NOW goes back to the chosen checker
      save();
      return { scheduled: false, exhausted: true };
    }
    file.providerRetryCount = count + 1;
    file.providerRetryReason = similarity ? "similarity" : "transient";
    file.providerRetryAt = now() + minutes(DELAYS_MINUTES[count]);
    file.providerRetryExhausted = false;
    // The last automatic retry of a similarity failure uses the other checker.
    let fallback = null;
    if (similarity && file.providerRetryCount === DELAYS_MINUTES.length && typeof fallbackFor === "function") {
      fallback = fallbackFor(file) || null;
      file.providerSimilarityFallback = fallback;
    }
    save();
    schedule(job.jobId, file.providerRetryAt);
    return { scheduled: true, attempt: file.providerRetryCount, at: file.providerRetryAt, fallback };
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
      (force || (!file.providerRetryStopped && file.providerRetryAt && file.providerRetryAt <= now())));
    if (!due.length) return { ran: false, reason: "nothing-due" };

    // Only wait for JK SimilarityCheck's health when this attempt will use it.
    const needsHealth = typeof usesSimcheck === "function" ? due.some(f => usesSimcheck(f)) : true;
    if (!force && needsHealth && !(await healthy())) {
      const first = Math.min(...due.map(f => f.providerRetryFirstFailedAt || now()));
      if (now() - first < minutes(GIVE_UP_MINUTES)) {
        const later = now() + minutes(HEALTH_WAIT_MINUTES);
        for (const file of due) file.providerRetryAt = later;
        save();
        schedule(jobId, later);
        return { ran: false, reason: "unhealthy-waiting" };
      }
      // JK_SIMILARITY_FALLBACK_V1: still down after the wait: similarity failures
      // that have not tried the other checker go to it now (this file only).
      const toFallback = [];
      for (const file of due) {
        const other = file.providerRetryReason === "similarity" && !file.providerSimilarityFallback &&
          typeof fallbackFor === "function" ? fallbackFor(file) : null;
        if (other) {
          file.providerSimilarityFallback = other;
          file.providerRetryCount = DELAYS_MINUTES.length;
          file.providerRetryAt = now();
          toFallback.push(file);
        } else {
          file.providerRetryAt = null;
          file.providerRetryExhausted = true;
          file.providerSimilarityFallback = null;
        }
      }
      save();
      if (toFallback.length) {
        await sendAdmin(`🔁 Similarity service still unavailable.\nJob: ${jobId}\nTrying ${LABELS[toFallback[0].providerSimilarityFallback] || toFallback[0].providerSimilarityFallback} for ${toFallback.length} file(s) now (these files only; your setting is unchanged).`);
        schedule(jobId, now());
        return { ran: false, reason: "unhealthy-fallback" };
      }
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
      const pending = (job?.files || [])
        .filter(f => !f?.providerRetryStopped)
        .map(f => f?.providerRetryAt).filter(Number.isFinite);
      if (pending.length) schedule(job.jobId, Math.min(...pending));
    }
  }

  // Stops automatic retries for one file. A retry already running finishes,
  // but nothing is scheduled after it. RETRY NOW still works afterwards.
  async function stop(id) {
    const found = findBySubmission(id);
    if (!found) return { stopped: false, reason: "not-found" };
    const { job, file } = found;
    const running = job.providerRetryRunning === true;
    file.providerRetryStopped = true;
    file.providerRetryAt = null;
    file.providerRetryExhausted = false;
    save();
    // Keep the job's timer only for other files that still have a retry waiting.
    const others = (job.files || [])
      .filter(f => f !== file && !f.providerRetryStopped)
      .map(f => f.providerRetryAt).filter(Number.isFinite);
    if (others.length) schedule(job.jobId, Math.min(...others));
    else { clearTimeout(timers.get(job.jobId)); timers.delete(job.jobId); }
    await refreshStatus(job, file);
    return { stopped: true, running };
  }

  function findBySubmission(id) {
    for (const job of Object.values(getJobs() || {})) {
      for (const file of job?.files || []) if (idOf(file) === id) return { job, file };
    }
    return null;
  }

  // RETRY NOW, shared by the Telegram button and the admin web panel.
  async function retryNow(id) {
    const found = findBySubmission(id);
    if (!found) return { ok: false, reason: "not-found" };
    found.file.providerRetryCount = 0;
    found.file.providerSimilarityFallback = null; // manual retry: the chosen checker
    found.file.providerRetryFirstFailedAt = now();
    found.file.providerRetryExhausted = false;
    found.file.providerRetryStopped = false;
    save();
    const result = await attempt(found.job.jobId, { force: true });
    return { ok: result.ran === true, reason: result.reason || null };
  }

  function register(bot, adminId) {
    bot.action(/^PRETRY:([1-9]\d{9})$/, async ctx => {
      if (Number(ctx.from?.id) !== Number(adminId)) return ctx.answerCbQuery("Admin only.");
      if (!findBySubmission(ctx.match[1])) return ctx.answerCbQuery("Check not found.", { show_alert: true });
      await ctx.answerCbQuery("Retrying now…");
      const result = await retryNow(ctx.match[1]);
      if (!result.ok && result.reason !== "busy-or-missing") {
        await sendAdmin("Retry not started: " + String(result.reason || "unknown").replace(/-/g, " ") + ".");
      }
    });

    // JK_RETRY_STOP_BUTTON_V1
    bot.action(/^PRSTOP:([1-9]\d{9})$/, async ctx => {
      if (Number(ctx.from?.id) !== Number(adminId)) return ctx.answerCbQuery("Admin only.");
      const result = await stop(ctx.match[1]);
      if (!result.stopped) return ctx.answerCbQuery("Check not found.", { show_alert: true });
      await ctx.answerCbQuery(result.running
        ? "Stopped. The attempt already running will finish; no more retries."
        : "Automatic retries stopped.");
    });
  }

  return { isTransient, onFailure, attempt, resume, stop, retryNow, replyMarkup, register, schedule };
}

// Admin status buttons: STOP RETRIES while an automatic retry is waiting,
// RETRY NOW once none is waiting (used up or stopped).
function replyMarkup({ file, stage }) {
  const id = idOf(file);
  const failed = stage === "failed" && id && !file.providerAutoResubmitBlocked &&
    String(file.providerStatus || "").toUpperCase() === "FAILED";
  if (!failed) return { inline_keyboard: [] };
  if (file.providerRetryAt && !file.providerRetryStopped) {
    return { inline_keyboard: [[{ text: "STOP RETRIES", callback_data: "PRSTOP:" + id }]] };
  }
  return { inline_keyboard: [[{ text: "RETRY NOW", callback_data: "PRETRY:" + id }]] };
}

function statusLine(file, nowMs = Date.now()) {
  if (file?.providerRetryStopped) return "Automatic retries stopped by admin. Tap RETRY NOW to resend.";
  if (file?.providerRetryAt && file.providerRetryAt > nowMs) {
    const mins = Math.max(1, Math.ceil((file.providerRetryAt - nowMs) / 60000));
    const via = file.providerSimilarityFallback ? " using " + (LABELS[file.providerSimilarityFallback] || file.providerSimilarityFallback) + " (this file only)" : "";
    return `Automatic retry ${file.providerRetryCount}/${DELAYS_MINUTES.length} in about ${mins} min${via}.`;
  }
  if (file?.providerRetryExhausted) return "Automatic retries used up. Tap RETRY NOW when the service is healthy.";
  return null;
}

module.exports = { createAutoRetry, isTransient, isSimilarityFailure, statusLine, replyMarkup, DELAYS_MINUTES };
