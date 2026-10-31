"use strict";
// Real case: Case_Study_Evaluating_and_Managing_Cardiovascular_Conditions.docx.
// One APA entry was pasted with different formatting (no hanging indent,
// smaller font, wider line spacing, stray opening quote). Its wrapped line
// "(CPPD) disease: a review. Open access rheumatology: research and reviews,
// 33-41." was treated as possible substantive writing because it contains
// "and", so the whole bibliography went to administrator review.
// Offline: no provider, Telegram or Render calls.
const assert = require("node:assert/strict");
const { inspectReferenceSections } = require("./jk-reference-sections.js");
const scan = require("./jk-scan-text.js");

const doc = require("./test-fixtures/cardio-case-study-real-geometry.json").document;
const text = doc.text;
const heading = text.indexOf("References\nBrophy, R. H.");
assert(heading > 0);
const inspection = inspectReferenceSections(text, scan.findBibliographyStart(text), [], doc);
assert.deepEqual(inspection.reviews, [], "no administrator review for a plain APA list");
assert.deepEqual(inspection.ranges.map(r => [r.start, r.end]), [[heading, text.length]], "whole bibliography excluded");
for (const [label, prepared] of [
  ["AI", scan.buildAiInput(text, doc, [])],
  ["Similarity", scan.buildSimilarityInput(text, scan.FILTER_MODE_FILTERED, [], doc)]
]) {
  for (const entry of ["Brophy, R. H.", "Cowley, S., & McCarthy", "(CPPD) disease", "Mohseni, M.", "Kirichenko"]) {
    assert(!prepared.text.includes(entry), label + " input still contains " + entry);
  }
  assert(prepared.map.includes(heading - 5), label + " lost the essay text before the references");
}

// Safety net unchanged: a genuine prose paragraph between two entries still
// goes to administrator review, even when it mentions a year.
const body = "The patient presented with knee pain and the clinician reviewed the history carefully.\n".repeat(40);
const refs = [
  "References",
  "Smith, M. H., & Berman, J. R. (2022). What is rheumatoid arthritis? Jama, 327(12), 1194-1194.",
  "Brown, A., & Lee, K. (2019). Supply chains. Management Review, 12(1), 33–41.",
  "In my clinical placement I observed that nurses explained every medication to the patient before giving it, which reduced anxiety considerably.",
  "Taylor, P. (2021). Nursing practice. Journal of Care, 4(2), 1–9. https://doi.org/10.1000/abc"
].join("\n");
const mixed = body + refs + "\n";
const mixedInspection = inspectReferenceSections(mixed, -1, [], null);
assert.equal(mixedInspection.ranges.length, 0, "prose between entries must not be swallowed silently");
assert.equal(mixedInspection.reviews.length, 1, "prose between entries still triggers administrator review");

// A wrapped title/journal line WITHOUT a hanging indent between entries is bibliographic.
const wrapped = body + [
  "References",
  "Cowley, S., & McCarthy, G. (2023). Diagnosis and treatment of calcium pyrophosphate deposition",
  "(CPPD) disease: a review. Open access rheumatology: research and reviews, 33-41.",
  "https://doi.org/10.2147/OARRR.S389664",
  "Mohseni, M., Mabrouk, A., & Li, D. (2024). Pes anserine bursitis. In StatPearls [Internet]. StatPearls",
  "Publishing. https://www.ncbi.nlm.nih.gov/books/NBK532941/",
  "Smith, M. H., & Berman, J. R. (2022). What is rheumatoid arthritis? Jama, 327(12), 1194-1194."
].join("\n") + "\n";
const wrappedInspection = inspectReferenceSections(wrapped, -1, [], null);
assert.equal(wrappedInspection.reviews.length, 0);
assert.equal(wrappedInspection.ranges[0]?.end, wrapped.length);

console.log("PASS: real cardio case study: whole APA bibliography excluded automatically, no admin review");
console.log("PASS: wrapped citation lines with journal/pages/DOI are bibliographic, not substantive writing");
console.log("PASS: a genuine prose paragraph between entries still goes to administrator review");
