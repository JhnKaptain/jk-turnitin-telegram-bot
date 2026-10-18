"use strict";

// JKW verified Sapling offset mapping. Never use Quetext's fuzzy aligner for
// Sapling sentences; otherwise Sapling errors are mislabelled as Quetext.
const { alignAiRanges } = require("./jk-ai-offsets-verified.cjs");

function alignSaplingResultRanges(preparedText, normalizedResult) {
  const input = String(preparedText ?? "");
  const ranges = Array.isArray(normalizedResult?.ranges) ? normalizedResult.ranges : [];
  const providerText = normalizedResult?.raw?.text;
  if (providerText !== undefined && typeof providerText !== "string") {
    throw new Error("Sapling AI returned a non-string full-text field.");
  }
  return alignAiRanges({
    input,
    ranges,
    ...(providerText === undefined ? {} : { providerText }),
    offsetUnit: "auto"
  });
}

// Retained for existing third-party module imports, but cannot use the full
// provider-returned text. Production normalization must use the above API.
function alignSaplingRange(input, range, providerText) {
  return alignAiRanges({ input: String(input ?? ""), ranges: [range],
    ...(typeof providerText === "string" ? { providerText } : {}),
    offsetUnit: "auto" })[0];
}

module.exports = { alignSaplingRange, alignSaplingResultRanges };
