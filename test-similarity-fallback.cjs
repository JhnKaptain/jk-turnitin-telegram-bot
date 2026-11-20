"use strict";
// JK_SIMILARITY_FALLBACK_V1: a file whose similarity check keeps failing is
// retried twice on the chosen checker, then once on the other checker (that
// file only), then stops at RETRY NOW (back on the chosen checker).
// Offline: fake clock, timers, health and job runner.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAutoRetry, isSimilarityFailure, statusLine } = require("./jk-provider-auto-retry.cjs");

const SIM = "Similarity provider did not return a usable result. ";

(async () => {
  // 1. Which failures can switch checker.
  assert(isSimilarityFailure(SIM + "JK SimilarityCheck is temporarily unavailable (HTTP 502)."));
  assert(isSimilarityFailure(SIM + "Quetext: not enough credits to scan this document"), "Quetext credits");
  assert(isSimilarityFailure(SIM + "Quetext login failed (session expired)"), "Quetext login");
  assert(isSimilarityFailure(SIM + "No usable similarity score"));
  assert(!isSimilarityFailure(SIM + "Text too short to scan"), "bad document: never switched");
  assert(!isSimilarityFailure(SIM + "No readable text in the document"));
  assert(!isSimilarityFailure("Quetext match cannot be aligned safely"));
  assert(!isSimilarityFailure("❌ INDEPENDENT AI DETECTION FAILED: Sapling HTTP 502"), "AI failures are not similarity failures");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-fallback-"));
  try {
    function harness({ chosen, healthy = () => true }) {
      let clock = 1_000_000;
      const timers = [];
      const admin = [];
      const ranWith = [];
      const file = { jkSubmissionId: "trn:oid:::1:1234567890", file_name: "Essay.docx", providerStatus: "FAILED",
        providerBundleFile: path.join(dir, "bundle-" + Math.random() + ".json") };
      const job = { jobId: "J1", files: [file] };
      let nextError = SIM + "JK SimilarityCheck is temporarily unavailable (HTTP 502).";
      const retry = createAutoRetry({
        getJobs: () => ({ J1: job }),
        save: () => {},
        runJob: async () => {
          ranWith.push(file.providerSimilarityFallback || chosen.name);
          if (nextError) { file.providerStatus = "FAILED"; retry.onFailure(job, file, nextError); } else file.providerStatus = "COMPLETE";
        },
        sendAdmin: async t => admin.push(t),
        healthUrl: "https://simcheck.example/v1/health",
        fetchImpl: async () => ({ ok: healthy() }),
        fallbackFor: () => (chosen.name === "jksimilarity" ? "quetext" : "jksimilarity"),
        usesSimcheck: f => (f.providerSimilarityFallback || chosen.name) === "jksimilarity",
        now: () => clock,
        setTimer: (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length; }
      });
      const tick = async () => {
        timers.sort((a, b) => a.at - b.at);
        const t = timers.shift();
        clock = t.at;
        await t.fn();
        await new Promise(r => setImmediate(r));
      };
      return { retry, file, job, admin, ranWith, tick, setError: e => { nextError = e; }, clock: () => clock, timers };
    }

    // 2. JK SimilarityCheck chosen, keeps failing: JK, JK, then Quetext, then RETRY NOW.
    {
      const chosen = { name: "jksimilarity" };
      const h = harness({ chosen });
      let d = h.retry.onFailure(h.job, h.file, SIM + "JK SimilarityCheck is temporarily unavailable (HTTP 502).");
      assert.deepEqual([d.attempt, d.fallback], [1, null]);
      await h.tick(); // retry 1
      await h.tick(); // retry 2 (fails -> schedules retry 3 with fallback)
      assert.equal(h.file.providerSimilarityFallback, "quetext");
      assert.match(statusLine(h.file, h.clock()), /Automatic retry 3\/3 in about 5 min using Quetext \(this file only\)/);
      await h.tick(); // retry 3 on Quetext, fails
      assert.deepEqual(h.ranWith, ["jksimilarity", "jksimilarity", "quetext"]);
      assert.equal(h.file.providerRetryExhausted, true);
      assert.equal(h.file.providerSimilarityFallback, null, "after the fallback fails, back to the chosen checker");
      assert.match(statusLine(h.file, h.clock()), /RETRY NOW/);
      assert.equal(chosen.name, "jksimilarity", "setting never changed");
      // RETRY NOW: the chosen checker again.
      h.setError(null);
      await h.retry.retryNow("1234567890");
      assert.equal(h.ranWith.at(-1), "jksimilarity");
    }

    // 3. Fallback succeeds: the next file (and this file's later runs) use the chosen checker.
    {
      const chosen = { name: "jksimilarity" };
      const h = harness({ chosen });
      h.retry.onFailure(h.job, h.file, SIM + "HTTP 502");
      await h.tick(); await h.tick();
      h.setError(null);
      await h.tick();
      assert.deepEqual(h.ranWith, ["jksimilarity", "jksimilarity", "quetext"]);
      assert.equal(h.file.providerStatus, "COMPLETE");
    }

    // 4. JK SimilarityCheck down the whole time: retries wait for it (no wasted runs);
    //    when the wait ends, the file goes to Quetext instead of stopping.
    {
      const chosen = { name: "jksimilarity" };
      let up = false;
      const h = harness({ chosen, healthy: () => up });
      h.retry.onFailure(h.job, h.file, SIM + "JK SimilarityCheck is temporarily unavailable (HTTP 503).");
      for (let i = 0; i < 12 && !h.ranWith.length; i++) await h.tick();
      assert.deepEqual(h.ranWith, ["quetext"], "no JK runs while down; then Quetext");
      assert(h.admin.some(t => /Trying Quetext for 1 file\(s\) now \(these files only; your setting is unchanged\)/.test(t)));
      assert(h.clock() - 1_000_000 >= 10 * 60000, "after the ~10 minute wait");
    }

    // 5. Quetext chosen (e.g. out of credits): Quetext, Quetext, then JK SimilarityCheck.
    //    Quetext retries never wait on JK SimilarityCheck's health.
    {
      const chosen = { name: "quetext" };
      let up = false;
      const h = harness({ chosen, healthy: () => up });
      h.setError(SIM + "Quetext: not enough credits to scan this document");
      const d = h.retry.onFailure(h.job, h.file, SIM + "Quetext: not enough credits to scan this document");
      assert.equal(d.scheduled, true, "Quetext credit/login failures are now retried");
      await h.tick(); await h.tick();
      assert.deepEqual(h.ranWith, ["quetext", "quetext"], "ran although JK SimilarityCheck is down");
      assert.equal(h.file.providerSimilarityFallback, "jksimilarity");
      up = true;
      h.setError(null);
      await h.tick();
      assert.deepEqual(h.ranWith, ["quetext", "quetext", "jksimilarity"]);
    }

    // 6. Not a similarity failure (temporary, e.g. a network blip elsewhere): retried, never switched.
    {
      const chosen = { name: "jksimilarity" };
      const h = harness({ chosen });
      h.setError("fetch failed");
      h.retry.onFailure(h.job, h.file, "fetch failed");
      await h.tick(); await h.tick(); await h.tick();
      assert.deepEqual(h.ranWith, ["jksimilarity", "jksimilarity", "jksimilarity"]);
    }

    // 7. A document that cannot be read: not retried, not switched.
    {
      const h = harness({ chosen: { name: "jksimilarity" } });
      assert.equal(h.retry.onFailure(h.job, h.file, SIM + "Text too short to scan").scheduled, false);
    }

    // 8. The checker router: a one-file override, without touching the saved setting.
    const plagiarism = require("./providers/plagiarism.js");
    const calls = [];
    plagiarism.PROVIDERS.quetext.load = () => ({ checkPlagiarism: async a => { calls.push(["quetext", a.provider]); return { ok: 1 }; } });
    plagiarism.PROVIDERS.jksimilarity.load = () => ({ checkPlagiarism: async a => { calls.push(["jksimilarity", a.provider]); return { ok: 2 }; } });
    process.env.DATA_DIR = dir;
    plagiarism.setProvider("jksimilarity");
    await plagiarism.checkPlagiarism({ text: "x" });
    await plagiarism.checkPlagiarism({ text: "x", provider: "quetext" });
    await plagiarism.checkPlagiarism({ text: "x", provider: null });
    assert.deepEqual(calls, [["jksimilarity", undefined], ["quetext", undefined], ["jksimilarity", undefined]], "override used once; not passed on");
    assert.equal(plagiarism.currentProvider().name, "jksimilarity", "setting unchanged");
    assert.equal(plagiarism.otherProvider("quetext"), "jksimilarity");
    assert.equal(plagiarism.otherProvider("jksimilarity"), "quetext");
    // No more immediate switch on any failure.
    process.env.PLAGIARISM_FALLBACK = "quetext";
    plagiarism.PROVIDERS.jksimilarity.load = () => ({ checkPlagiarism: async () => { throw new Error("HTTP 502"); } });
    await assert.rejects(plagiarism.checkPlagiarism({ text: "x" }), /HTTP 502/);
    assert.equal(calls.length, 3, "Quetext not called immediately");
    delete process.env.PLAGIARISM_FALLBACK;

    // 9. Wiring: the file's fallback reaches the similarity step; success clears it.
    const bundle = fs.readFileSync(path.join(__dirname, "jk-provider-job-bundle.js"), "utf8");
    const pipeline = fs.readFileSync(path.join(__dirname, "jk-provider-pipeline.js"), "utf8");
    const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
    assert(bundle.includes("similarityProvider: file?.providerSimilarityFallback || null"));
    assert(pipeline.includes("similarityProvider = null") && pipeline.includes("provider: similarityProvider,"));
    assert(bot.includes("fallbackFor: () => require(\"./providers/plagiarism.js\").otherProvider("));
    assert(bot.includes("usesSimcheck: file => (file.providerSimilarityFallback ||"));
    assert(bot.includes("file.providerSimilarityFallbackUsed = file.providerSimilarityFallback;") && bot.includes("file.providerSimilarityFallback = null;"));

    console.log("PASS: similarity failures: 2 retries on the chosen checker, the 3rd on the other (this file only), then RETRY NOW.");
    console.log("PASS: both directions (JK SimilarityCheck <-> Quetext); Quetext credit/login failures now retried; health wait ends in the fallback.");
    console.log("PASS: never switched for unreadable documents, AI failures or other errors; setting never changes; RETRY NOW uses the chosen checker.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
