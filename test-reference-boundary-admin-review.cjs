"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {inspectReferenceSections, prepareWithoutReferences} = require("./jk-reference-sections.js");
const scan = require("./jk-scan-text.js");

const source = [
  "Opening discussion and background content before the reference section. ".repeat(12),
  "",
  "References",
  "",
  "Barker, T. (2021). Research design and analysis. Journal of Academic Methods, 12(2), 44-58.",
  "",
  "Standards and policy.",
  "",
  "Introduction",
  "The criminal justice system serves as the backbone of societal order and explains how law enforcement, courts, and corrections work together."
].join("\n");

const inspection = inspectReferenceSections(source);
assert.equal(inspection.reviews.length, 1, "ambiguous boundary must be flagged");
const review = inspection.reviews[0];
assert.equal(review.status, undefined);
assert.equal(typeof review.sourceTextSha256, "string");
assert(review.candidates.length >= 1);
assert(source.slice(review.candidates[0].offset).startsWith("Introduction"),
  "The selectable boundary must be the next substantive section, not a citation continuation.");

assert.throws(
  () => scan.buildAiInput(source),
  e => e && e.code === "REFERENCE_BOUNDARY_REVIEW_REQUIRED" &&
    e.apiBlocked === true && e.noProviderRequests === true
);
assert.throws(
  () => scan.buildSimilarityInput(source, scan.FILTER_MODE_FILTERED),
  e => e && e.code === "REFERENCE_BOUNDARY_REVIEW_REQUIRED" && e.noProviderRequests === true
);

// Simulate the exact administrator action: accept the first candidate as the
// beginning of included body text. The decision is tied to canonical text SHA.
const selected = {
  start: review.start,
  end: review.candidates[0].offset,
  sourceTextSha256: review.sourceTextSha256,
  approvedBy: "6569201830",
  approvedAt: Date.now()
};
const ai = scan.buildAiInput(source, undefined, [selected]);
const similarity = scan.buildSimilarityInput(source, scan.FILTER_MODE_FILTERED, [selected]);
assert(ai.text.includes("Introduction"));
assert(ai.text.includes("The criminal justice system serves as the backbone"));
assert(similarity.text.includes("Introduction"));
assert(similarity.text.includes("The criminal justice system serves as the backbone"));
assert(!ai.text.includes("Research design and analysis"));
assert(!ai.text.includes("Standards and policy"));
assert(!similarity.text.includes("Research design and analysis"));
assert(!similarity.text.includes("Standards and policy"));

const phrase = "The criminal justice system serves as the backbone";
const aiAt = ai.text.indexOf(phrase);
const simAt = similarity.text.indexOf(phrase);
assert.equal(source.slice(ai.map[aiAt], ai.map[aiAt] + phrase.length), phrase);
assert.equal(source.slice(similarity.map[simAt], similarity.map[simAt] + phrase.length), phrase);

// Stale approvals must not apply to changed text.
assert.throws(
  () => scan.buildAiInput(source + " changed", undefined, [selected]),
  e => e && e.code === "REFERENCE_BOUNDARY_REVIEW_REQUIRED"
);

// Verify the admin resume workflow only offers admin callbacks, persists the
// decision and blocks already-submitted/saved provider data.
const bot = fs.readFileSync(require.resolve("./bot.js"), "utf8");
const bundle = fs.readFileSync(require.resolve("./jk-provider-job-bundle.js"), "utf8");
assert(bot.includes("REFERENCE_BOUNDARY_REVIEW_REQUIRED"));
assert(bot.includes("notifyReferenceBoundaryReview(job, file, err.referenceReview"));
assert(bot.includes("bot.action(/^JK_REF_BOUNDARY_"));
assert(bot.includes("Number(ctx.from?.id) !== ADMIN_ID"));
assert(bundle.includes("referenceBoundaryOverrides = file.referenceBoundaryOverrides || []"));
assert(bot.includes("file.referenceReviewNoProviderRequests"));
console.log("PASS: ambiguous bibliography boundary blocks AI and Similarity before provider submission.");
console.log("PASS: administrator-selected boundary resumes preparation for both inputs.");
console.log("PASS: reference entries remain excluded and original offsets are preserved.");
console.log("PASS: stale source approvals are rejected and admin-only resume guard exists.");
