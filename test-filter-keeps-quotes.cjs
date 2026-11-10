"use strict";
// JK_FILTER_KEEPS_QUOTES_V1: the filtered similarity option leaves out the
// reference list but keeps quotations, unless JK_SIMILARITY_FILTER_QUOTES=1.
const assert = require("node:assert/strict");
const scan = require("./jk-scan-text.js");

const sample = [
  "Opening sentence of the essay body.",
  "They argue that femtech “reinforces gendered social hierarchies rather than dismantling them” (Mishra, 2024).",
  'Another writer says "straight quoted words stay in the text" here.',
  "",
  "References",
  "Mishra, P. (2024). Femtech apps. Current Sociology."
].join("\n");

delete process.env.JK_SIMILARITY_FILTER_QUOTES;
assert.equal(scan.similarityFiltersQuotes(), false);
const kept = scan.buildSimilarityInput(sample, scan.FILTER_MODE_FILTERED);
assert(kept.text.includes("reinforces gendered social hierarchies"), "curly-quoted text kept");
assert(kept.text.includes("straight quoted words stay in the text"), "straight-quoted text kept");
assert(!kept.text.includes("Current Sociology"), "reference list still removed");
assert.equal(kept.removedQuoteRanges.length, 0);

process.env.JK_SIMILARITY_FILTER_QUOTES = "1";
assert.equal(scan.similarityFiltersQuotes(), true);
const removed = scan.buildSimilarityInput(sample, scan.FILTER_MODE_FILTERED);
assert(!removed.text.includes("reinforces gendered social hierarchies"), "quotes removed when enabled");
assert(!removed.text.includes("Current Sociology"));
delete process.env.JK_SIMILARITY_FILTER_QUOTES;

const unfiltered = scan.buildSimilarityInput(sample, scan.FILTER_MODE_UNFILTERED);
assert(unfiltered.text.includes("Current Sociology") && unfiltered.text.includes("reinforces"));

console.log("PASS: filtered similarity keeps quotations and removes references by default.");
console.log("PASS: JK_SIMILARITY_FILTER_QUOTES=1 restores quote removal; unfiltered unchanged.");
