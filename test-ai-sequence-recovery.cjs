"use strict";
const assert = require("node:assert/strict");
const { inferGlobalAiSelections, selfTest } = require("./jk-recover-reviewed-results.cjs");
const { recover, candidates } = require("./jk-recover-provider-results.js");
const norm = s => s.replace(/\s+/gu, " ").trim();
function make() {
  const sentences = [
    "The earlier assessment considers the symptoms and their duration in context.",
    "If I could conduct the session again, I would spend more time exploring the onset, duration, and impact of Ms.",
    "Branning’s suspicious beliefs, while using a calm, nonconfrontational approach to strengthen rapport.",
    "Her young age,",
    "workplace stress, social environment, and possible consequences should be considered when developing an individualized treatment plan."
  ];
  let at = 0;
  const scores = sentences.map(sentence => { const s = { sentence, start: at, end: at + sentence.length, score: 0.9 }; at = s.end + 1; return s; });
  const text = "🙂\n" + " ".repeat(900) + sentences[0] + "\n" + " ".repeat(250) + sentences.slice(1).join("\n\n") + "\n ";
  return { version: 1, canonicalDocument: { text }, preparedInputs: { similarity: { text, map: Array.from({ length: text.length }, (_, i) => i) }, ai: { text, map: Array.from({ length: text.length }, (_, i) => i) } }, providerResults: {
    similarity: { status: "fulfilled", value: { score: 8, matches: [] } },
    ai: { status: "fulfilled", value: { percent: 82, score: 0.9, ranges: scores.slice(1), sentenceScores: scores } }
  } };
}
const deps = {
  alignSaplingRange: (input, entry) => { const found = candidates(input, entry.sentence, entry.start); assert.equal(found.length, 1); return found[0]; },
  alignQuetextMatch: () => { throw new Error("Unexpected similarity range"); },
  mapProviderRangesToSource: require("./jk-scan-text.js").mapProviderRangesToSource,
  normalizeQuetextResult: value => ({ available: true, percent: value.score }),
  normalizeSaplingResult: (value, prepared) => {
    for (const r of value.ranges) assert.equal(norm(prepared.text.slice(r.start, r.end)), norm(r.sentence));
    return { available: true, percent: value.percent, ranges: value.ranges };
  }
};
selfTest();
const saved = make(), unchanged = JSON.stringify(saved);
const initial = recover(saved, new Map(), deps);
assert.equal(initial.issues.length, 4);
const selected = inferGlobalAiSelections(saved, initial.issues);
assert.equal(selected.size, 4);
assert(selected.get("ai:1") - saved.providerResults.ai.value.ranges[0].start > 512);
const result = recover(saved, selected, deps);
assert.equal(result.issues.length, 0); assert.equal(result.aiDetection.percent, 82); assert.equal(result.similarityDetection.percent, 8);
assert.equal(JSON.stringify(saved), unchanged);
// Repeat a short sentence elsewhere: only the unique complete sequence can select it.
saved.preparedInputs.ai.text += "\nHer young age,\n";
saved.canonicalDocument.text = saved.preparedInputs.ai.text;
saved.preparedInputs.ai.map = Array.from({ length: saved.canonicalDocument.text.length }, (_, i) => i);
assert.equal(inferGlobalAiSelections(saved, initial.issues).size, 4);
// A missing sentence within the affected sequence is rejected.
const changed = make(); changed.preparedInputs.ai.text = changed.preparedInputs.ai.text.replace("Branning’s suspicious beliefs", "Unexpected different wording");
assert(!inferGlobalAiSelections(changed, initial.issues).has("ai:1"));
// All occurrences duplicated: no unique proof, no guess.
const duplicate = make(); duplicate.preparedInputs.ai.text += "\n" + duplicate.preparedInputs.ai.text;
assert.equal(inferGlobalAiSelections(duplicate, initial.issues).size, 0);
const reordered = make(); reordered.providerResults.ai.value.sentenceScores.reverse();
assert.equal(inferGlobalAiSelections(reordered, initial.issues).size, 0);
// Invalid explicit selection or a map that disagrees with source still fails.
const invalid = recover(make(), new Map([["ai:1", selected.get("ai:1") + 1]]), deps);
assert(invalid.issues.some(i => i.key === "ai:1"));
const corrupt = make(); corrupt.canonicalDocument.text = "x".repeat(corrupt.canonicalDocument.text.length);
assert(recover(corrupt, selected, deps).issues.length);
// Partial input outside a matching tail is allowed; changes within that tail are not.
const tail = make(); tail.preparedInputs.ai.text = tail.preparedInputs.ai.text.replace("The earlier assessment", "Different opening assessment");
const tailSelected = inferGlobalAiSelections(tail, initial.issues);
assert(tailSelected.has("ai:4"));
console.log("PASS: distant AI ranges, whitespace gaps, Unicode, last-sentence recovery, repeated short text, rejected ambiguity/changed sequences, source verification and unchanged saved scores.");
console.log("Mock audit tests only. No provider requests, PDF generation or Telegram deliveries.");
