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

function alignQuetextMatch(input, match) {
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

module.exports = { alignQuetextMatch };
