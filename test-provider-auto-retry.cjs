"use strict";
// JK_PROVIDER_AUTO_RETRY_V1: temporary provider failures are retried automatically
// (2, 3, 5 minutes apart), only while the similarity service is healthy, through the same
// stored job; admins get RETRY NOW when retries are used up. Offline: fake timers,
// fake health checks and a fake job runner. No Telegram or provider requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAutoRetry, isTransient, statusLine, replyMarkup } = require("./jk-provider-auto-retry.cjs");

(async () => {
  // 1. Which failures are temporary.
  assert(isTransient(new Error("Similarity provider did not return a usable result. JK SimilarityCheck is temporarily unavailable (HTTP 502).")));
  assert(isTransient("fetch failed"));
  assert(isTransient("read ECONNRESET"));
  assert(!isTransient("Quetext match cannot be aligned safely"));
  assert(!isTransient("Sapling offset has ambiguous interpretations"));
  assert(!isTransient("Paid job has no stored files."));

  // Fake clock and timers.
  let clock = Date.UTC(2026, 10, 14, 0, 0);
  const timers = [];
  const setTimer = (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; };
  const advance = async ms => {
    clock += ms;
    for (const t of timers.splice(0)) {
      if (t.at <= clock) await t.fn(); else timers.push(t);
    }
    await new Promise(r => setImmediate(r));
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-retry-"));
  try {
    const bundle = path.join(dir, "bundle.json");
    const saved = bundle + ".provider-results.json";
    const file = { jkSubmissionId: "trn:oid:::1:1234567890", providerStatus: "FAILED", providerBundleFile: bundle };
    const jobs = { job1: { jobId: "job1", files: [file] } };
    let runs = 0, healthy = false, admin = [];
    const retry = createAutoRetry({
      getJobs: () => jobs,
      save: () => {},
      runJob: async () => { runs++; file.providerStatus = "FAILED"; },  // simulate failing again
      sendAdmin: async text => admin.push(text),
      healthUrl: "https://sim.example/v1/health",
      fetchImpl: async () => ({ ok: healthy }),
      now: () => clock,
      setTimer
    });

    // 2. First failure: retry 1/3 in 2 minutes; status line and no button while pending.
    fs.writeFileSync(saved, "{}");
    let d = retry.onFailure(jobs.job1, file, new Error("HTTP 502"));
    assert.deepEqual([d.scheduled, d.attempt], [true, 1]);
    assert.equal(file.providerRetryAt, clock + 2 * 60000);
    assert.match(statusLine(file, clock), /Automatic retry 1\/3 in about 2 min/);
    assert.deepEqual(replyMarkup({ file, stage: "failed" }).inline_keyboard, []);

    // 3. Service unhealthy at retry time: wait 1 more minute, do not run, keep saved results.
    await advance(2 * 60000);
    assert.equal(runs, 0);
    assert(fs.existsSync(saved), "saved results untouched while waiting");
    assert.equal(file.providerRetryAt, clock + 1 * 60000);

    // 4. Healthy: saved results moved aside (not deleted), job rerun through the same path.
    healthy = true;
    await advance(1 * 60000);
    assert.equal(runs, 1);
    assert(!fs.existsSync(saved), "pipeline will not refuse the rerun");
    assert(fs.readdirSync(dir).some(n => /\.failed-\d+\.provider-results\.json$/.test(n)), "failed results kept aside");

    // 5. Further failures: retries 2 and 3 after 3 and 5 minutes, then exhausted with a button.
    d = retry.onFailure(jobs.job1, file, "fetch failed");
    assert.deepEqual([d.attempt, file.providerRetryAt - clock], [2, 3 * 60000]);
    await advance(3 * 60000);
    assert.equal(runs, 2);
    d = retry.onFailure(jobs.job1, file, "fetch failed");
    assert.deepEqual([d.attempt, file.providerRetryAt - clock], [3, 5 * 60000]);
    await advance(5 * 60000);
    assert.equal(runs, 3);
    d = retry.onFailure(jobs.job1, file, "fetch failed");
    assert.deepEqual([d.scheduled, d.exhausted], [false, true]);
    assert.match(statusLine(file, clock), /RETRY NOW/);
    assert.equal(replyMarkup({ file, stage: "failed" }).inline_keyboard[0][0].callback_data, "PRETRY:1234567890");

    // 6. Non-temporary failure: never retried.
    const other = { jkSubmissionId: "trn:oid:::1:1234567891", providerStatus: "FAILED" };
    assert.equal(retry.onFailure({ jobId: "x", files: [other] }, other, "Quetext match cannot be aligned safely").scheduled, false);

    // 7. RETRY NOW skips the health wait (e.g. when Quetext is the active provider).
    healthy = false;
    const res = await retry.attempt("job1", { force: true });
    assert.equal(res.ran, true);
    assert.equal(runs, 4);

    // 8. Gives up 10 minutes after the first failure if the service never recovers.
    const late = { jkSubmissionId: "trn:oid:::1:1234567892", providerStatus: "FAILED", providerBundleFile: path.join(dir, "b2.json") };
    jobs.job2 = { jobId: "job2", files: [late] };
    retry.onFailure(jobs.job2, late, "HTTP 503");
    late.providerRetryFirstFailedAt = clock - 11 * 60000;
    await advance(2 * 60000);
    assert.equal(late.providerRetryExhausted, true);
    assert(admin.some(t => /Automatic retry stopped/.test(t)));

    // 9. Pending retries are re-armed after a restart.
    const pending = { jkSubmissionId: "trn:oid:::1:1234567893", providerStatus: "FAILED", providerRetryAt: clock + 60000, providerRetryCount: 1 };
    jobs.job3 = { jobId: "job3", files: [pending] };
    timers.length = 0;
    retry.resume();
    assert(timers.some(t => t.at === clock + 60000), "restart re-arms the pending retry");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 10. The bot is wired: retry scheduled on failure, cleared on success; the AI baseline
  // is saved only after a completed check, never by the pipeline itself.
  const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  const pipeline = fs.readFileSync(path.join(__dirname, "jk-provider-pipeline.js"), "utf8");
  assert(/providerAutoRetry\?\.onFailure\(job, file, err\);\s*\n\s*await updateProviderAdminStatus\(job, file, "failed"/.test(bot));
  assert(bot.includes('require("./jk-ai-verdicts.cjs").saveBaseline(dir, owner, sentences)'));
  assert(bot.indexOf("saveBaseline(dir, owner, sentences)") < bot.indexOf('"COMPLETE";', bot.indexOf("saveBaseline(dir, owner, sentences)") - 2000) + 2000);
  assert(!pipeline.includes("saveBaseline("), "pipeline never saves the baseline itself");
  assert(bot.includes("providerAutoRetry.resume();"));

  console.log("PASS: temporary failures retried 2, 3 and 5 min apart, only when the service is healthy.");
  console.log("PASS: saved results moved aside, same job rerun, RETRY NOW after retries, restart-safe.");
  console.log("PASS: non-temporary failures never retried; AI baseline saved only after a completed check.");
})().catch(error => { console.error(error); process.exitCode = 1; });
