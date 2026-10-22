"use strict";

// Visual-only guard for a high-confidence, separate first-page academic cover.
// Does not alter AI input, provider data, similarity matching or detection scores.
// Ambiguous and mixed cover/body pages deliberately return no extra mask.
const norm = value => String(value || "").replace(/\s+/gu, " ").trim();
const words = value => String(value || "").match(/\p{L}[\p{L}\p{M}'’\-]*/gu) || [];

function inspectVisualCover(document) {
  const no = reason => ({ verified: false, reason, spans: [], lineCount: 0 });
  if (typeof document?.text !== "string" || !Array.isArray(document.pages) || document.pages.length < 2)
    return no("NO_SEPARATE_FIRST_PAGE");
  const page = document.pages[0];
  if (!page || page.rotation || !Number.isFinite(page.width) || !Number.isFinite(page.height) ||
      page.width <= 0 || page.height <= 0 || !Array.isArray(page.items)) return no("INVALID_LAYOUT");
  const text = document.text;
  const valid = page.items.filter(item => typeof item?.text === "string" && norm(item.text) &&
    Number.isInteger(item.start) && Number.isInteger(item.end) &&
    item.start >= 0 && item.end > item.start && item.end <= text.length &&
    text.slice(item.start, item.end) === item.text &&
    [item.x, item.y, item.width, item.height].every(Number.isFinite) &&
    item.width > 0 && item.height > 0);
  if (valid.length < 3 || valid.length < page.items.filter(i => norm(i?.text)).length * 0.85)
    return no("INSUFFICIENT_EXACT_OFFSETS");
  const visible = valid.filter(i => i.y > page.height * 0.07 && i.y < page.height * 0.94 &&
    !/^\s*(?:\d{1,3}|page\s+\d+(?:\s+of\s+\d+)?)\s*$/iu.test(i.text));
  if (!visible.length) return no("NO_CONTENT");
  // Combine PDF text fragments by shared baselines. The source offsets still
  // remain item-exact and are used individually when making visual masks.
  const byY = [...visible].sort((a,b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of byY) {
    const line = lines.at(-1);
    if (line && Math.abs(item.y - line.y) <= Math.min(item.height, line.height) * 0.34) {
      line.items.push(item);
    } else {
      lines.push({ y: item.y, height: item.height, items: [item] });
    }
  }
  for (const line of lines) {
    line.items.sort((a,b) => a.x - b.x);
    line.text = norm(line.items.map(i => i.text).join(" "));
    line.x = Math.min(...line.items.map(i => i.x));
    line.right = Math.max(...line.items.map(i => i.x + i.width));
    line.wordCount = words(line.text).length;
  }
  if (lines.length < 3 || lines.length > 18) return no("NOT_SPARSE_LINES");
  const combined = lines.map(l => l.text).join(" ");
  if (words(combined).length > 145) return no("NOT_SPARSE_WORDS");
  const lineTexts = lines.map(l => l.text);
  const patterns = {
    affiliation: /\b(?:university|college|school\s+of|department\s+of|faculty\s+of|institute\s+of)\b/iu,
    student: /\b(?:student\s*(?:name|number|id|no\.?|registration)|registration\s*(?:number|no\.?|id)|submitted\s+by|prepared\s+by|candidate\s*(?:name|number))\b/iu,
    staff: /\b(?:instructor|professor|lecturer|supervisor|tutor|submitted\s+to|faculty\s+name)\b/iu,
    course: /\b(?:course\s*(?:name|code|title|number|unit)?\s*:|unit\s*code\s*:|module\s*code\s*:|[A-Z]{2,8}[- ]?\d{3,5}\b)/u,
    assessment: /\b(?:assignment|assessment|individual\s+(?:research\s+)?report|research\s+project|term\s+paper|dissertation|thesis|word\s*count)\b/iu,
    date: /\b(?:submission\s+date|due\s+date|date\s+of\s+submission|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/iu
  };
  const present = Object.fromEntries(Object.entries(patterns).map(([k,p]) => [k,lineTexts.some(s => p.test(s))]));
  const distinct = Object.values(present).filter(Boolean).length;
  const identity = present.student || present.staff || present.affiliation;
  const academic = present.course || present.assessment;
  // An unlabelled student name between a title and assignment details is common
  // on dedicated cover pages. This additional *visual-only* case must have
  // unusually strong geometry, not just a title or an early first-page position.
  // Source text and provider detection scores remain unchanged.
  const stronglyCentered = lines.filter(l =>
    Math.abs((l.x + l.right) / 2 - page.width / 2) <= Math.max(18, l.height * 2.5)
  ).length / lines.length >= 0.80;
  const academicBelow = candidate => lines.some(l =>
    l.y < candidate.y && l.y < page.height * 0.42 &&
    /\b(?:assignment|assessment|course|project|report|dissertation|thesis)\b/iu.test(l.text));
  const bareName = line => line.wordCount >= 2 && line.wordCount <= 4 &&
    line.text.length <= 65 &&
    /^[\p{L}\p{M}'’ .-]+$/u.test(line.text) &&
    words(line.text).every(w => /^\p{Lu}/u.test(w)) &&
    !/\b(?:assignment|assessment|course|project|report|research|university|college|strategy|strategic|plan|planning|department|faculty|school|abstract|introduction)\b/iu.test(line.text);
  const isolatedMiddleName = lines.some((line, index) => {
    if (!index || index >= lines.length - 2 || !bareName(line) ||
        line.y <= page.height * 0.27 || line.y >= page.height * 0.68) return false;
    const prev = lines[index - 1], next = lines[index + 1];
    const beforeGap = prev.y - line.y;
    const afterGap = line.y - next.y;
    return beforeGap >= Math.max(line.height, prev.height) * 5 &&
      afterGap >= Math.max(line.height, next.height) * 5 &&
      academicBelow(line);
  });
  // Requires a separate top title, an isolated central name, and lower
  // assessment details. All text lines must be sparse and predominantly centred.
  // Mixed cover/body submissions fail the narrative and line-density checks below.
  const geometryIdentity = !identity && present.assessment &&
    lines.length >= 5 && lines.length <= 12 && stronglyCentered &&
    lines.every(l => l.wordCount <= 9) &&
    lines[0].y >= page.height * 0.72 &&
    lines.at(-1).y <= page.height * 0.42 && isolatedMiddleName;
  if (!academic || (!identity && !geometryIdentity) ||
      (identity && distinct < 2)) return no("METADATA_NOT_CONCLUSIVE");
  // Reject narrative paragraphs even when a paper starts with university/author
  // details. False positives here would damage working first-page body highlights.
  const narrative = /\b(?:this\s+(?:paper|study|essay|research|report)|in\s+(?:this|the)\s+(?:paper|study)|we\s+(?:argue|examine|analyse|analyze|found)|the\s+(?:results|findings|analysis)\s+(?:show|suggest|indicate)|however|therefore|furthermore|moreover)\b/iu;
  if (lines.some(l => l.wordCount >= 21 ||
      (l.wordCount >= 9 && /[.!?][”"')]*\s*$/u.test(l.text)) ||
      (l.wordCount >= 8 && narrative.test(l.text)))) return no("NARRATIVE_PRESENT");
  // Consecutive long lines at ordinary single-line spacing are likely prose.
  for (let i = 1; i < lines.length; i++) {
    if (lines[i-1].wordCount >= 8 && lines[i].wordCount >= 8 &&
        lines[i-1].y - lines[i].y <= Math.max(lines[i].height, lines[i-1].height) * 1.85 &&
        Math.abs(lines[i-1].x - lines[i].x) < 23) return no("PARAGRAPH_LIKE_LINES");
  }
  const centered = lines.filter(l => Math.abs((l.x + l.right)/2 - page.width/2) <= Math.max(18,l.height*2.5)).length;
  const centeredRate = centered / lines.length;
  const separated = lines.some((l,i) => i > 0 && lines[i-1].y - l.y >= Math.max(l.height,lines[i-1].height)*2.8);
  // Left-aligned covers qualify only with 3+ distinct metadata categories,
  // plus a visible gap separating academic title/identity sections.
  if (!(centeredRate >= 0.45 || (distinct >= 3 && separated))) return no("GEOMETRY_NOT_CONCLUSIVE");
  const spans = valid.map(i => ({ start:i.start,end:i.end,text:i.text,
    pageNumber:page.pageNumber || 1,reason:"VERIFIED_VISUAL_ONLY_COVER" }));
  return { verified:true,reason:"VERIFIED_DEDICATED_COVER",spans,lineCount:lines.length };
}
function getVerifiedCoverSpans(document) { return inspectVisualCover(document).spans; }
module.exports = { inspectVisualCover, getVerifiedCoverSpans };
