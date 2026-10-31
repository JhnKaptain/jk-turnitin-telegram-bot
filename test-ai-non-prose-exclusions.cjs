"use strict";
// Turnitin-style AI "qualifying text": only prose sentences are scored.
// Table of contents / list of tables, short table cells and short bullet or
// numbered items must never be sent to the AI provider or painted cyan; full
// sentences (in lists, tables, justified or two-column prose) must remain.
// Fixtures are real LibreOffice -> PDF.js geometry of synthetic Word files.
// Offline: no provider, Telegram or Render calls.
const assert = require("node:assert/strict");
const { classifyNonProse } = require("./jk-ai-non-prose.cjs");
const { excludeAiNonProseRanges } = require("./jk-ai-visual-mask.cjs");
const { buildAiInput } = require("./jk-scan-text.js");

const flagged = doc => {
  const spans = classifyNonProse(doc);
  const by = {};
  for (const s of spans) (by[s.reason] ||= []).push(s.text.trim());
  return { spans, by };
};

// 1. Non-prose structures are recognized.
const layout = require("./test-fixtures/non-prose-word-layout.json").document;
const { spans, by } = flagged(layout);
for (const entry of ["Table of Contents"]) assert(by.TABLE_OF_CONTENTS_HEADING.includes(entry));
for (const entry of ["1. Introduction", "2.1 Supply Chain Integration", "References", "List of Tables",
  "Table 1: Supplier Scores", "Table 2: Risk Register"]) {
  assert(by.TABLE_OF_CONTENTS_ENTRY.includes(entry), "TOC entry " + entry);
}
for (const entry of ["Information sharing", "Demand forecasting accuracy", "Adopt S&OP", "Track forecast bias"]) {
  assert(by.SHORT_LIST_ITEM.includes(entry), "short list item " + entry);
}
for (const entry of ["Supplier", "Lead time", "Alpha Ltd", "82", "6 weeks", "Risk", "Mitigation",
  "Port congestion", "Diversify shipping routes", "Single sourcing"]) {
  assert(by.SHORT_TABLE_CELL.includes(entry), "short table cell " + entry);
}
const text = layout.text;
const kept = [
  "Firms that integrate planning with suppliers",              // full-sentence bullet
  "Collaborative forecasting allows partners",                 // full-sentence bullet
  "The company should qualify a second",                       // prose table cell
  "Supply chain resilience depends on how organisations",      // body prose
  "Key drivers identified in the literature include:"          // lead-in sentence
];
for (const phrase of kept) {
  const at = text.indexOf(phrase);
  assert(at >= 0, phrase);
  assert(!spans.some(s => s.start < at + phrase.length && s.end > at), "prose wrongly excluded: " + phrase);
}

// 2. Same decision masks AI provider input and painted highlights.
const prepared = buildAiInput(text, layout, []);
for (const phrase of ["Alpha Ltd", "Information sharing", "Diversify shipping routes", "2.1 Supply Chain Integration"]) {
  const at = text.indexOf(phrase);
  assert(at >= 0, phrase);
  assert(!prepared.map.some(n => n === at), "AI input still contains " + phrase);
}
assert(prepared.text.includes("Firms that integrate planning with suppliers"));
assert(prepared.text.includes("The company should qualify a second"));
const everything = [{ start: 0, end: text.length }];
const painted = excludeAiNonProseRanges(everything, layout);
for (const s of spans) {
  assert(!painted.some(r => r.start < s.end && r.end > s.start), "painted non-prose: " + s.text);
}
for (const phrase of kept) {
  const at = text.indexOf(phrase);
  assert(painted.some(r => r.start <= at && r.end >= at + phrase.length), "prose not painted: " + phrase);
}

// 3. No false positives: justified prose, two-column prose, long numbered and
//    bulleted sentences, a prose-only table, a sentence ending in a number.
const stress = require("./test-fixtures/prose-stress-word-layout.json").document;
assert.deepEqual(classifyNonProse(stress).map(s => [s.reason, s.text.trim()]),
  [["LOCAL_HEADING", "Introduction"]], "prose was classified as non-prose");

console.log("PASS: table of contents, list of tables, short table cells and short list items excluded");
console.log("PASS: full-sentence bullets, prose table cells and body prose kept in AI input and paint");
console.log("PASS: justified, two-column, numbered-paragraph and prose-table writing never excluded");
