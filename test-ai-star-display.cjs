"use strict";
// JK_AI_SCORE_ROUNDING_V1: AI scores are whole numbers (0.5 rounds up) and every
// rule uses the rounded score: 0 -> "0%" (no highlights); 1-19 -> "*%" (AI
// HIGHLIGHTS); 20+ -> the number with the normal highlighted report.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { aiRounded, aiBand, isStarred } = require("./jk-ai-score.cjs");
const { summary } = require("./jk-provider-admin-status.js");

// 1. The rule.
const cases = [[0, "zero", 0], [0.4, "zero", 0], [0.49, "zero", 0], [0.5, "star", 1], [0.9, "star", 1], [12.3, "star", 12],
  [19.4, "star", 19], [19.49, "star", 19], [19.5, "normal", 20], [19.6, "normal", 20], [20, "normal", 20], [57.5, "normal", 58]];
for (const [v, band, r] of cases) {
  assert.equal(aiBand(v), band, String(v));
  assert.equal(aiRounded(v), r, String(v));
}
assert.equal(aiBand(null), null);
assert.equal(isStarred(0.5), true);
assert.equal(isStarred(0.4), false);
assert.equal(isStarred(19.6), false);

// 2. Admin message: whole numbers only; "*%" with the rounded number for 1-19.
const line = aiPercent => summary({ job: { userId: 5189765792 }, file: { file_name: "Essay.docx", providerSimilarityPercent: 0 },
  stage: "delivered", rendered: { aiAvailable: true, aiPercent }, runAi: true }).split("\n").find(l => l.startsWith("AI: "));
assert.equal(line(0.4), "AI: 0%");
assert.equal(line(0.5), "AI: *% (1%)");
assert.equal(line(19.4), "AI: *% (19%)");
assert.equal(line(19.6), "AI: 20%");
// The admin-only AI HIGHLIGHTS line appears only for "*%" results.
const full = v => summary({ job: { userId: 1 }, file: { file_name: "E.docx", providerBundleFile: "/var/data/x/bundle.json" },
  stage: "delivered", rendered: { aiAvailable: true, aiPercent: v }, runAi: true });
assert(!/AI HIGHLIGHTS/.test(full(0.4)), "0.4 -> 0%: no highlights");
assert(/AI HIGHLIGHTS/.test(full(0.5)), "0.5 -> 1%: highlights");
assert(!/AI HIGHLIGHTS/.test(full(19.6)), "19.6 -> 20%: normal report, not the star");

// 3. AI HIGHLIGHTS eligibility (admin button and paid customer highlights).
const { validateBundle } = require("./jk-low-ai-review.cjs");
const text = "This is a saved sentence for testing highlights.";
const bundle = p => ({ aiDetection: { available: true, provider: "sapling", percent: p,
  ranges: [{ id: 0, start: 0, end: text.length, sentence: text, score: 0.9, providerStart: 0, providerEnd: text.length }] },
  canonicalDocument: { text } });
assert.throws(() => validateBundle(bundle(0.4)), /shown as \*%/);
assert.equal(validateBundle(bundle(0.5)), 0.5);
assert.equal(validateBundle(bundle(19.4)), 19.4);
assert.throws(() => validateBundle(bundle(19.6)), /shown as \*%/);

// 4. Report and panel use the same rounded rule.
const renderer = fs.readFileSync(path.join(__dirname, "jk-report-renderer-max.js"), "utf8");
assert(renderer.includes('const low = ai.available && require("./jk-ai-score.cjs").isStarred(value);'));
assert(renderer.includes('require("./jk-ai-score.cjs").aiRounded(ai.percent) >= 20 || bundle.__adminLowScoreReview === true'));
assert(!/value > 0 && value < 20/.test(renderer));
assert(fs.readFileSync(path.join(__dirname, "jk-admin-panel.client.js"), "utf8").includes("Math.round(f.ai) >= 1 && Math.round(f.ai) < 20 ? '*% ('"));
console.log("PASS: AI score rounded to whole numbers; 0 -> 0%, 1-19 -> *% with AI HIGHLIGHTS, 20+ -> normal report (19.6 -> 20%).");
console.log("PASS: same rule in the report, AI HIGHLIGHTS eligibility, the admin message and the panel.");
