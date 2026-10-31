"use strict";

// Display-only filter: never changes provider AI percentage or saved scores.
// Excludes verified structural text coordinates before drawing rectangles.
const { classifyAiStructuralText } = require("./jk-ai-structure.js");
const { getVerifiedCoverSpans } = require("./jk-ai-cover-visual-guard.cjs");
const { visualReferenceSpans } = require("./jk-ai-reference-proof.cjs");

function excludeAiNonProseRanges(ranges, document) {
  if (!Array.isArray(ranges)) return [];
  if (typeof document?.text !== "string" || !Array.isArray(document.pages)) return ranges;
  const source = document.text;
  const spans = [...classifyAiStructuralText(document), ...getVerifiedCoverSpans(document), ...visualReferenceSpans(source,document)]
    .filter(s => Number.isInteger(s.start) && Number.isInteger(s.end) &&
      s.start >= 0 && s.end > s.start && s.end <= source.length &&
      source.slice(s.start, s.end) === s.text)
    .sort((a,b)=>a.start-b.start || a.end-b.end);
  const mask = [];
  for (const s of spans) {
    const last = mask.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end,s.end);
    else mask.push({start:s.start,end:s.end});
  }
  const out=[];
  // When structural masking splits an AI range, a stand-alone whitespace
  // fragment has no detectable words to paint. Keeping it can draw a cyan
  // rectangle in a table header gap (e.g., ACTIVITY [space] Wee).
  // Preserve whitespace inside genuine text-bearing ranges: the production
  // renderer still joins those highlights into continuous visual lines.
  const appendVisibleText = (range, start, end) => {
    if (start >= end || !/\S/u.test(source.slice(start, end))) return;
    out.push({...range, start, end});
  };
  for (const range of ranges) {
    let start=Number(range?.start), end=Number(range?.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start<0 || end>source.length || end<=start) continue;
    for (const block of mask) {
      if (block.end <= start) continue;
      if (block.start >= end) break;
      if (block.start > start) appendVisibleText(range,start,Math.min(end,block.start));
      start = Math.max(start,block.end);
      if (start>=end) break;
    }
    if (start<end) appendVisibleText(range,start,end);
  }
  return out;
}
module.exports={excludeAiNonProseRanges};
