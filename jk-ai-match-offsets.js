"use strict";

const { alignQuetextMatch } = require("./jk-match-offsets.js");

function alignSaplingRange(input, range) {
  const text = String(input ?? "");
  const target = String(range?.sentence ?? "");
  const reported = range?.start;

  if (
    !target.trim() ||
    !Number.isInteger(reported) ||
    reported < 0
  ) {
    throw new Error("Invalid Sapling sentence text or offset.");
  }

  const candidates = [];

  // Accept either offset convention only when its substring agrees.
  if (text.slice(reported, reported + target.length) === target) {
    candidates.push({
      start: reported,
      end: reported + target.length,
      alignmentMethod: "EXACT_UTF16"
    });
  }

  const symbols = Array.from(text);

  if (
    reported <= symbols.length &&
    symbols.slice(reported, reported + Array.from(target).length)
      .join("") === target
  ) {
    const start = symbols.slice(0, reported).join("").length;

    if (!candidates.some(item => item.start === start)) {
      candidates.push({
        start,
        end: start + target.length,
        alignmentMethod: "EXACT_CODEPOINT"
      });
    }
  }

  if (candidates.length > 1) {
    throw new Error("Sapling offset has ambiguous interpretations.");
  }

  // Existing verifier permits whitespace differences and requires
  // one nearby occurrence when the reported offset does not agree.
  const aligned = candidates[0] || alignQuetextMatch(text, {
    start: reported,
    text: target
  });

  return {
    ...range,
    start: aligned.start,
    end: aligned.end,
    reportedProviderStart: reported,
    reportedProviderEnd: range.end,
    alignmentMethod: aligned.alignmentMethod,
    verifiedOffsetType: "utf16"
  };
}

module.exports = { alignSaplingRange };
