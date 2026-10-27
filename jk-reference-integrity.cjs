"use strict";
// Fail-closed, read-only validation. No report/PDF transformation and no scores changed.
function validateExcludedSourceMappings(prepared, label) {
  const ranges = Array.isArray(prepared?.removedReferenceRanges)
    ? prepared.removedReferenceRanges : [];
  const map = prepared?.map;
  if (!Array.isArray(map) || map.length !== String(prepared?.text || "").length) {
    throw new Error(label + ": input/source coordinate map is invalid");
  }
  for (const range of ranges) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) ||
        range.end <= range.start) throw new Error(label + ": invalid reference exclusion range");
  }
  for (let i = 0; i < map.length; i++) {
    const n = map[i];
    if (!Number.isFinite(n)) continue;
    if (!Number.isInteger(n) || n < 0) throw new Error(label + ": invalid source coordinate");
    if (ranges.some(r => n >= r.start && n < r.end)) {
      throw new Error(label + ": bibliography character leaked into provider input at " + n);
    }
  }
  return true;
}
function validateReturnedExclusions(result, prepared, label) {
  const ranges = Array.isArray(prepared?.removedReferenceRanges)
    ? prepared.removedReferenceRanges : [];
  if (!ranges.length) return true;
  const highlights = Array.isArray(result?.ranges) ? result.ranges : [];
  for (const h of highlights) {
    if (!Number.isFinite(h?.start) || !Number.isFinite(h?.end) || h.end <= h.start) {
      throw new Error(label + ": invalid highlight coordinate");
    }
    if (ranges.some(r => h.start < r.end && h.end > r.start)) {
      throw new Error(label + ": provider highlight overlaps excluded references");
    }
  }
  return true;
}
module.exports={validateExcludedSourceMappings,validateReturnedExclusions};
