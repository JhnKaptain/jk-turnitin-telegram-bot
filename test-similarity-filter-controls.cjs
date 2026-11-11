"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const scan = require("./jk-scan-text.js");
const filters = require("./jk-similarity-filter-options.cjs");

const sample = [
  "Opening academic text discusses the effect of the data in schools.",
  'Researchers wrote "distinctive quoted words must remain measurable" during analysis.',
  "The final discussion considers the evidence and draws important conclusions.",
  "",
  "References",
  "Smith, J. (2025). Academic evidence and learning. Journal Name."
].join("\n");
const cases = [
  [{excludeBibliography: true, excludeQuotes: false}, true, false],
  [{excludeBibliography: true, excludeQuotes: true}, false, false],
  [{excludeBibliography: false, excludeQuotes: true}, false, true],
  [{excludeBibliography: false, excludeQuotes: false}, true, true],
];
for (const [opts, keepsQuote, keepsRefs] of cases) {
  const prepared = scan.buildSimilarityInput(sample, filters.similarityFiltersMode(opts), [], null, opts);
  assert.equal(prepared.text.includes("distinctive quoted words"), keepsQuote, "quoted passage selection");
  assert.equal(prepared.text.includes("Journal Name"), keepsRefs, "reference passage selection");
  assert(prepared.text.includes("Opening academic text"), "keep body prose");
  assert.equal(prepared.map.length, prepared.text.length, "canonical UTF-16 mapping kept");
  assert.equal(filters.normalizeSimilarityFilters(opts).excludeQuotes, opts.excludeQuotes);
}
assert.equal(filters.similarityFiltersMode({excludeBibliography: false, excludeQuotes: false}), "UNFILTERED");
assert.equal(filters.similarityFiltersMode({excludeBibliography: false, excludeQuotes: true}), "FILTERED");
assert.equal(filters.similarityFiltersSummary({excludeBibliography: true, excludeQuotes: false}), "Bibliography");
assert.equal(filters.similarityFiltersSummary({excludeBibliography: false, excludeQuotes: true}), "Quotes");
assert.equal(filters.similarityFilterButtons({excludeBibliography: true, excludeQuotes: false}).quotes, "☐ Exclude quotes");
assert.equal(filters.toggleSimilarityFilter({excludeBibliography: true, excludeQuotes: false}, "quotes").excludeQuotes, true);
const ai = scan.buildAiInput(sample);
assert(ai.text.includes("distinctive quoted words"), "AI always retains quotations");
assert(!ai.text.includes("Journal Name"), "AI must always exclude bibliography");

const bot = fs.readFileSync("./bot.js", "utf8");
const pipeline = fs.readFileSync("./jk-provider-pipeline.js", "utf8");
const jobBundle = fs.readFileSync("./jk-provider-job-bundle.js", "utf8");
const provider = fs.readFileSync("./providers/jksimilarity.js", "utf8");
for (const action of ["SIM_FILTER_TOGGLE_BIB", "SIM_FILTER_TOGGLE_QUOTES",
  "SIM_FILTER_CONTINUE", "ADMIN_FREE_SCAN_TOGGLE_BIB",
  "ADMIN_FREE_SCAN_TOGGLE_QUOTES", "ADMIN_FREE_SCAN_CONTINUE"]) {
  assert(bot.includes(action), action + " handler or callback missing");
}
assert(bot.includes("similarityOptions: effectiveSimilarityOptions(file)"), "persisted flags must reach job");
assert(pipeline.includes("similarityOptions: selectedFilters"), "pipeline must transmit flags to API");
assert(pipeline.includes("selectedFilters.excludeBibliography"), "bibliography isolation proof must be conditional");
assert(jobBundle.includes("similarityOptions,"), "job bundle must carry per-document settings");
assert(provider.includes("exclude_bibliography: filters.excludeBibliography"), "API must receive actual reference selection");
assert(provider.includes("exclude_quotes: filters.excludeQuotes"), "API must receive actual quote selection");
assert(bot.includes("Select at least one exclusion."), "unfiltered client-policy safeguard");
assert(!bot.includes("Quotations and the reference/bibliography section will not count toward the similarity percentage."), "old wordy prompt removed");
console.log("PASS: independent similarity controls across four modes and source mapping.");
console.log("PASS: AI quotation/reference exclusions unchanged and provider flags propagated.");
console.log("PASS: client/admin toggles, continue actions, and customer unfiltered safeguard.");
