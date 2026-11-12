"use strict";
// JK_AI_VERDICT_FREEZE_V1: unchanged sentences keep their AI verdict on resubmission.
// Synthetic sentences only; no student text is stored or committed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const v = require("./jk-ai-verdicts.cjs");

const sentences = Array.from({ length: 20 }, (_, i) => `Synthetic sentence number ${i} about topic ${i * 7}.`);
const scored = (scores) => ({
  sentenceScores: sentences.map((s, i) => ({ sentence: s, start: i * 10, end: i * 10 + 9, score: scores[i] })),
  aiFraction: 0,
  percent: 0,
  ranges: []
});
const baselineFrom = (result, now = Date.now()) => ({
  v: 1, savedAt: now,
  sentences: result.sentenceScores.map(s => ({ k: v.sentenceKey(s.sentence), f: s.score >= 0.5 ? 1 : 0 }))
});

// 1. No baseline: fresh scores, unchanged result.
const base = scored(sentences.map((_, i) => (i < 4 ? 0.9 : 0.1)));
let r = v.applyFreeze(base, null);
assert.equal(r.stats.mode, "fresh");
assert.equal(r.result, base);

// 2. Unchanged text, same scores: nothing changes.
r = v.applyFreeze(scored(base.sentenceScores.map(s => s.score)), baselineFrom(base));
assert.equal(r.stats.mode, "frozen");
assert.equal(r.stats.suppressedFlags + r.stats.restoredFlags, 0);

// 3. Unchanged sentence newly scored as AI (far from any edit) is NOT newly highlighted.
const fresh = sentences.map((_, i) => (i < 4 ? 0.9 : i === 15 ? 0.8 : 0.1));
r = v.applyFreeze(scored(fresh), baselineFrom(base));
assert.equal(r.flags[15], false, "unchanged, previously unflagged sentence stays unflagged");
assert.equal(r.stats.suppressedFlags, 1);
assert(!r.result.ranges.some(x => x.sentence === sentences[15]));

// 4. Unchanged sentence that dropped below the line stays flagged.
const dropped = sentences.map((_, i) => (i < 4 ? 0.1 : 0.1));
r = v.applyFreeze(scored(dropped), baselineFrom(base));
assert.equal(r.flags[0], true, "previously flagged, unchanged sentence stays flagged");
assert.equal(r.stats.restoredFlags, 4);

// 5. Edited sentences (new text) take their fresh score.
const edited = sentences.slice();
edited[2] = "A genuinely rewritten sentence that did not exist before.";
const editedResult = {
  ...scored(fresh),
  sentenceScores: scored(fresh).sentenceScores.map((s, i) => (i === 2 ? { ...s, sentence: edited[2], score: 0.2 } : s))
};
r = v.applyFreeze(editedResult, baselineFrom(base));
assert.equal(r.flags[2], false, "edited sentence uses its fresh score");

// 6. Under 70% overlap is a new essay: fresh scores, no freezing.
const other = { sentenceScores: Array.from({ length: 20 }, (_, i) => ({ sentence: `Entirely different text ${i} here.`, score: 0.9 })) };
r = v.applyFreeze(other, baselineFrom(base));
assert.equal(r.stats.mode, "new-essay");
assert(r.flags.every(Boolean));

// 7. Headline percentage follows the final flags (Sapling's formula: flagged chars / all chars).
r = v.applyFreeze(scored(fresh), baselineFrom(base));
const total = sentences.reduce((n, s) => n + [...s].length, 0);
const flagged = sentences.reduce((n, s, i) => n + (r.flags[i] ? [...s].length : 0), 0);
assert.equal(r.result.percent, Math.round((flagged / total) * 1000) / 10);

// 8. Baseline expires after 30 days; storage keeps hashes and flags, never text.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-verdicts-"));
try {
  v.saveBaseline(dir, "client:1", base.sentenceScores.map(s => ({ sentence: s.sentence, flag: s.score >= 0.5 })));
  assert(v.loadBaseline(dir, "client:1"), "saved baseline loads");
  assert.equal(v.loadBaseline(dir, "client:2"), null, "owners are separate");
  assert.equal(v.loadBaseline(dir, "client:1", Date.now() + 31 * 24 * 3600 * 1000), null, "expired after 30 days");
  const files = fs.readdirSync(path.join(dir, "ai-verdicts"));
  const stored = fs.readFileSync(path.join(dir, "ai-verdicts", files[0]), "utf8");
  assert(!stored.includes("Synthetic sentence"), "no sentence text on disk");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("PASS: no baseline or under 70% overlap leaves the fresh AI result unchanged.");
console.log("PASS: unchanged sentences keep their verdict in both directions; edits take fresh scores.");
console.log("PASS: headline recalculated from final flags; baseline per owner, 30 days, hashes only.");
