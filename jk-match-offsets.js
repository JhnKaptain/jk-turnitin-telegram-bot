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


// The returned Quetext document may contain '?' substitutions for mathematical
// Unicode or other provider-only changes. Accept an affected match ONLY with
// verified provider offsets, unique surrounding context, and substantial
// agreement with the original document. This does not modify saved inputs.
function quetextReview(message) {
  const error = new Error("Quetext alignment requires review: " + message);
  error.code = "QUETEXT_ALIGNMENT_REVIEW";
  throw error;
}

function alignQuetextChangedText(input, match, providerText) {
  const target = normalizedText(String(match?.text ?? "")).text.trim();
  if (!target || !Number.isInteger(match?.start) ||
      !Number.isInteger(match?.end) || match.start < 0 ||
      match.end <= match.start) quetextReview("invalid provider match or offsets");

  // A common short passage in two unrelated documents is not sufficient proof.
  const original = normalizedText(input), returned = normalizedText(providerText);
  const sampleSize = 48, sampleStep = 96;
  let checked = 0, agreed = 0;
  for (let at = 0; at + sampleSize <= original.text.length; at += sampleStep) {
    checked++;
    if (returned.text.includes(original.text.slice(at, at + sampleSize))) agreed++;
  }
  if (checked < 5 || agreed / checked < 0.9) {
    // Preserve the global safety threshold. Recover individual passages only
    // when a separate verifier proves offsets, uniqueness and dual-side context.
    const proof = require("./jk-quetext-local-proof.cjs")
      .alignByVerifiedLocalContext(input, match, providerText);
    if (proof) return { ...match, ...proof, reportedStart: match.start,
      alignmentMethod: "VERIFIED_LOCAL_CONTEXT" };
    quetextReview("returned document differs too substantially to verify");
  }

  const positions = new Map();
  for (const unit of ["utf16", "codepoint"]) {
    const points = unit === "codepoint" ? Array.from(providerText) : null;
    if (unit === "codepoint" && match.end > points.length) continue;
    if (unit === "utf16" && match.end > providerText.length) continue;
    const start = unit === "utf16" ? match.start : points.slice(0, match.start).join("").length;
    const end = unit === "utf16" ? match.end : points.slice(0, match.end).join("").length;
    if (normalizedText(providerText.slice(start, end)).text.trim() !== target) continue;

    const i = returned.starts.findIndex((v, k) =>
      v >= start && returned.ends[k] <= end && returned.text[k] !== " ");
    const j = i + target.length;
    if (i < 0 || j > returned.text.length ||
        returned.text.slice(i, j) !== target ||
        returned.ends[j - 1] > end) continue;

    const before = returned.text.slice(Math.max(0, i - 72), i);
    const after = returned.text.slice(j, j + 72);
    if (before.length + after.length < 48) continue;

    let at = 0;
    while ((at = original.text.indexOf(target, at)) !== -1) {
      const left = original.text[at - 1], right = original.text[at + target.length];
      const boundary = (!left || !/[\p{L}\p{N}]/u.test(left)) &&
        (!right || !/[\p{L}\p{N}]/u.test(right));
      const correctContext = original.text.slice(Math.max(0, at - before.length), at) === before &&
        original.text.slice(at + target.length, at + target.length + after.length) === after;
      if (boundary && correctContext) {
        const from = original.starts[at], to = original.ends[at + target.length - 1];
        if (Number.isInteger(from) && Number.isInteger(to)) {
          positions.set(from + ":" + to, { start: from, end: to });
        }
      }
      at++;
    }
  }
  if (positions.size !== 1) quetextReview("no unique match with verified provider offsets and context");
  return { ...match, ...positions.values().next().value,
    reportedStart: match.start, alignmentMethod: "VERIFIED_PROVIDER_CONTEXT" };
}

function alignQuetextMatch(input, match, providerText) {
  // Quetext returns the exact text it analyzed. When present, use its
  // verified offset/text correspondence instead of repeated-text guessing.
  if (typeof providerText === "string") {
    const { alignAiRanges } = require("./jk-ai-offsets-verified.cjs");
    try {
      const mapped = alignAiRanges({input:String(input ?? ""), providerText,
        ranges:[match], offsetUnit:"auto"})[0];
      return {...mapped, alignmentMethod:"RETURNED_FULL_TEXT", reportedStart:match.start};
    } catch (error) {
      if (error.code !== "AI_ALIGNMENT_REVIEW") throw error;
      if (error.message.includes("returned full text differs beyond whitespace")) {
        return alignQuetextChangedText(String(input ?? ""), match, providerText);
      }
      quetextReview(error.message.replace(/^AI alignment requires review:\s*/, ""));
    }
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
