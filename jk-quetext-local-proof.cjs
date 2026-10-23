"use strict";
// Strict, offline-only fallback for Quetext results whose returned full text
// differs from the submitted text. Never infer a passage by offset proximity.
const indexed = value => {
  let text = "";
  const starts = [], ends = [];
  for (const item of value.matchAll(/\S+|\s+/gu)) {
    if (/^\s/u.test(item[0])) {
      text += " "; starts.push(item.index); ends.push(item.index + item[0].length);
    } else {
      for (let i = 0; i < item[0].length; i++) {
        text += item[0][i]; starts.push(item.index + i); ends.push(item.index + i + 1);
      }
    }
  }
  return { text, starts, ends };
};
const normalize = value => indexed(value).text.trim();

function findUnique(text, fragment) {
  const at = text.indexOf(fragment);
  return at >= 0 && text.indexOf(fragment, at + 1) < 0 ? at : -1;
}

// Require two unique, provider-verifiable contextual anchors on each side.
// Allow limited text insertions/deletions between anchors and the match.
function anchorsOnSide(returned, original, providerAt, canonicalAt, length, side) {
  let count = 0;
  let previousProvider = -Infinity;
  for (let distance = 0; distance <= 360; distance += 12) {
    const at = side === "left" ? providerAt - 48 - distance : providerAt + length + distance;
    if (at < 0 || at + 48 > returned.length) continue;
    const fragment = returned.slice(at, at + 48);
    if ((fragment.match(/\p{L}/gu) || []).length < 14 || !/\s/u.test(fragment)) continue;
    if (findUnique(returned, fragment) !== at) continue;
    const alignedAt = findUnique(original, fragment);
    if (alignedAt < 0) continue;
    if (side === "left" ? alignedAt + 48 > canonicalAt : alignedAt < canonicalAt + length) continue;
    const providerGap = side === "left" ? providerAt - (at + 48) : at - (providerAt + length);
    const canonicalGap = side === "left" ? canonicalAt - (alignedAt + 48) : alignedAt - (canonicalAt + length);
    if (Math.abs(providerGap - canonicalGap) > 360) continue;
    if (Math.abs(at - previousProvider) < 24) continue;
    previousProvider = at;
    if (++count >= 2) return true;
  }
  return false;
}

// Reject different documents that merely share an isolated passage. This
// remains stricter than local-only evidence but permits bounded text changes.
// Percentages describe sampled document agreement, NEVER similarity scores.
function broadAgreement(input, providerText) {
  const source = indexed(input).text.trim();
  const returned = indexed(providerText).text.trim();
  const samples = Array.from({ length: 4 }, () => ({ checked: 0, matched: 0 }));
  for (let at = 0; at + 48 <= source.length; at += 96) {
    const quarter = Math.min(3, Math.floor(4 * at / source.length));
    const group = samples[quarter];
    group.checked++;
    if (returned.includes(source.slice(at, at + 48))) group.matched++;
  }
  const checked = samples.reduce((sum, part) => sum + part.checked, 0);
  const matched = samples.reduce((sum, part) => sum + part.matched, 0);
  return checked >= 16 && matched / checked >= 0.8 &&
    samples.every(part => part.checked >= 3 && part.matched / part.checked >= 0.65);
}

function alignByVerifiedLocalContext(input, match, providerText) {
  if (typeof input !== "string" || typeof providerText !== "string" ||
      typeof match?.text !== "string" || !Number.isInteger(match.start) ||
      !Number.isInteger(match.end) || match.start < 0 || match.end <= match.start) return null;

  if (!broadAgreement(input, providerText)) return null;
  const target = normalize(match.text);
  if (target.length < 24 || (target.match(/\p{L}/gu) || []).length < 12) return null;
  const original = indexed(input), returned = indexed(providerText);
  const where = findUnique(original.text, target);
  if (where < 0) return null;
  const start = original.starts[where];
  const end = original.ends[where + target.length - 1];
  if (!Number.isInteger(start) || !Number.isInteger(end) ||
      normalize(input.slice(start, end)) !== target) return null;

  const matches = new Map();
  for (const unit of ["utf16", "codepoint"]) {
    const points = unit === "codepoint" ? Array.from(providerText) : null;
    if (match.end > (points ? points.length : providerText.length)) continue;
    const a = points ? points.slice(0, match.start).join("").length : match.start;
    const b = points ? points.slice(0, match.end).join("").length : match.end;
    if (normalize(providerText.slice(a, b)) !== target) continue;
    const i = returned.starts.findIndex((v, k) =>
      v >= a && returned.ends[k] <= b && returned.text[k] !== " ");
    const j = i + target.length;
    if (i < 0 || j > returned.text.length || returned.text.slice(i, j) !== target ||
        returned.ends[j - 1] > b) continue;
    // Distant anchors alone can be shared by unrelated passages. Require
    // substantial unchanged text immediately touching the provider match.
    let nearLeft = 0, nearRight = 0;
    while (nearLeft < 128 && i - nearLeft > 0 && where - nearLeft > 0 &&
        returned.text[i - nearLeft - 1] === original.text[where - nearLeft - 1]) nearLeft++;
    while (nearRight < 128 && i + target.length + nearRight < returned.text.length &&
        where + target.length + nearRight < original.text.length &&
        returned.text[i + target.length + nearRight] === original.text[where + target.length + nearRight]) nearRight++;
    if (nearLeft + nearRight < 48 || Math.max(nearLeft, nearRight) < 40) continue;
    if (!anchorsOnSide(returned.text, original.text, i, where, target.length, "left") ||
        !anchorsOnSide(returned.text, original.text, i, where, target.length, "right")) continue;
    matches.set(start + ":" + end, { start, end });
  }
  return matches.size === 1 ? matches.values().next().value : null;
}

module.exports = { alignByVerifiedLocalContext };
