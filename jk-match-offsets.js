"use strict";

function normalizedText(value) {
  let text = "";
  const starts = [], ends = [];
  const re = /\S+|\s+/gu;
  let match;

  while ((match = re.exec(value))) {
    if (/^\s/u.test(match[0])) {
      text += " ";
      starts.push(match.index);
      ends.push(match.index + match[0].length);
    } else {
      for (let i = 0; i < match[0].length; i++) {
        text += match[0][i];
        starts.push(match.index + i);
        ends.push(match.index + i + 1);
      }
    }
  }

  return { text, starts, ends };
}

function alignQuetextMatch(input, match, providerText) {
  // Quetext returns the exact text it analyzed. When present, use its
  // verified offset/text correspondence instead of repeated-text guessing.
  if (typeof providerText === "string") {
    const { alignAiRanges } = require("./jk-ai-offsets-verified.cjs");
    const mapped = alignAiRanges({input:String(input ?? ""), providerText,
      ranges:[match], offsetUnit:"auto"})[0];
    return {...mapped, alignmentMethod:"RETURNED_FULL_TEXT", reportedStart:match.start};
  }
  const value = String(input || "");
  const target = String(match?.text || "");
  const reported = match?.start;

  if (!target || !Number.isInteger(reported) ||
      reported < 0 || reported > value.length) {
    throw new Error("Quetext match has invalid text or offset.");
  }

  if (value.slice(reported, reported + target.length) === target) {
    return {
      ...match,
      start: reported,
      end: reported + target.length,
      reportedStart: reported,
      alignmentMethod: "EXACT"
    };
  }

  const norm = normalizedText(value);
  const needle = normalizedText(target.trim()).text;
  if (!needle) throw new Error("Quetext match is whitespace only.");

  const candidates = [];
  let pos = 0;

  while ((pos = norm.text.indexOf(needle, pos)) !== -1) {
    const start = norm.starts[pos];
    const end = norm.ends[pos + needle.length - 1];

    if (Math.abs(start - reported) <= 512) {
      candidates.push({ start, end });
    }
    pos++;
  }

  if (candidates.length !== 1) {
    throw new Error(
      "Quetext match cannot be aligned safely: " +
      candidates.length +
      " candidates within 512 characters of offset " + reported
    );
  }

  const { start, end } = candidates[0];

  if (normalizedText(value.slice(start, end)).text !== needle) {
    throw new Error("Verified substring does not match returned text.");
  }

  return {
    ...match,
    start,
    end,
    reportedStart: reported,
    alignmentMethod: "VERIFIED_TEXT"
  };
}

function alignQuetextResultMatches(input, result) {
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  return matches.map(m => alignQuetextMatch(input, m, result?.inputText));
}
module.exports = { alignQuetextMatch, alignQuetextResultMatches };
