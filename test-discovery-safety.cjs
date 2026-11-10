"use strict";
// Offline, provider-free invariants for similarity discovery and AI exclusions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const scan = require("./jk-scan-text.js");
const integrity = require("./jk-reference-integrity.cjs");

const sample = [
  "The investigation examines social inequality, emerging technologies and academic research ethics across many public institutions.",
  'The author writes: "Quoted scientific evidence should remain visible to AI detection even when similarity quotes are excluded."',
  "The concluding observations encourage independent learning, evidence checking and responsible research conduct."
].join("\n");

const ai = scan.buildAiInput(sample);
const filtered = scan.buildSimilarityInput(sample, scan.FILTER_MODE_FILTERED);
const unfiltered = scan.buildSimilarityInput(sample, scan.FILTER_MODE_UNFILTERED);

const quoted = "Quoted scientific evidence should remain visible to AI detection";
assert(ai.text.includes(quoted), "AI must always retain quotation text");
assert(!filtered.text.includes(quoted), "FILTERED similarity excludes quotations");
assert(unfiltered.text.includes(quoted), "UNFILTERED similarity retains quotations");
assert.equal(unfiltered.text, sample, "UNFILTERED similarity preserves the entire original");
assert(integrity.validateExcludedSourceMappings(ai, "AI"), "AI coordinate map must be valid");
assert(integrity.validateExcludedSourceMappings(filtered, "Similarity"), "Similarity coordinate map must be valid");

// Source-discovery data must be independent of scoring and AI preparations.
// This is an explicit static guard against accidentally changing the mature
// reference-recognition pipeline or sending original text to Sapling.
const pipeline = fs.readFileSync(path.join(__dirname, "jk-provider-pipeline.js"), "utf8");
assert(pipeline.includes("const aiPrepared =") && pipeline.includes("buildAiInput(document.text"),
  "AI must use its established, reference-excluding preparation pipeline");
assert(pipeline.includes("verifyReference(aiPrepared, document.text,"),
  "AI reference isolation must be independently verified");
assert(pipeline.includes("referenceIntegrity.validateExcludedSourceMappings(aiPrepared"),
  "AI reference mapping guard must stay active");
assert(pipeline.includes("discoveryText: document.text,"),
  "Similarity must receive original text for discovery, not scoring");
assert(pipeline.includes("discoveryReferenceRanges: (aiPrepared.removedReferenceRanges || [])"),
  "Similarity discovery must receive the reference spans already verified for AI");
assert(pipeline.includes("text:\n          similarityPrepared\n            .text,"),
  "Similarity scoring must continue using the selected filtered/unfiltered input");
assert(pipeline.includes("text:\n          aiPrepared.text"),
  "AI request must continue using its reference-excluding prepared input");
// UTF-16 positions from extracted Word text must map to Python code points.
// A non-BMP symbol before a reference heading changes the numeric offsets.
const unicodeOriginal = "😀 " + sample + "\nReferences\nSmith, J. (2024). Journal title.";
const referenceAt = unicodeOriginal.indexOf("\nReferences") + 1;
const pythonIndex = Array.from(unicodeOriginal.slice(0, referenceAt)).length;
assert.equal(pythonIndex, referenceAt - 1,
  "A leading emoji occupies two UTF-16 units but one Python code point");

const provider = fs.readFileSync(path.join(__dirname,"providers/jksimilarity.js"),"utf8");
assert(provider.includes("body.discovery_reference_ranges = discoveryReferenceRanges;"),
  "The verified spans must reach the similarity API");
console.log("PASS: AI retains quotations, excludes verified bibliography and maps offsets safely");
console.log("PASS: similarity discovery is separate from scored input and AI provider input");
