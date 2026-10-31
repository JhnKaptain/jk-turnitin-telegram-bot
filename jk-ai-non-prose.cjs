"use strict";
// AI-only non-prose recognition, following Turnitin's "qualifying text" rule:
// only prose sentences in long-form writing are scored. Tables of contents /
// lists of figures, short table cells and short bullet / numbered list items
// are not prose. Full-sentence bullets and prose paragraphs inside tables are
// KEPT. Every decision uses real PDF geometry (exact item offsets); canonical
// text is never changed. Similarity never imports this module.
//
// Spans are consumed by classifyAiStructuralText(), so the same decision masks
// AI provider input and the painted cyan highlights (display-only for saved
// bundles: stored provider scores are never recalculated).

const norm = s => String(s ?? "").replace(/\s+/gu, " ").trim();
const wc = s => (String(s ?? "").match(/\p{L}[\p{L}\p{M}'’\-]*/gu) || []).length;
const SENTENCE_END = /[.!?]["'’”)\]]?$/u;
const SEGMENT_GAP = 18;            // pt between table cells / TOC title and page number
const TOC_HEADING = /^(?:table\s+of\s+contents?|contents|list\s+of\s+(?:figures|tables|illustrations|abbreviations|acronyms|appendices|charts|exhibits))\s*:?$/iu;
const PAGE_REF = /^(?:\d{1,4}|[ivxlcdm]{1,7})$/iu;
const LEADER_ENTRY = /^(.{2,160}?)\s*(?:[.·…_]\s?){4,}\s*(?:\d{1,4}|[ivxlcdm]{1,7})$/iu;
const BULLET = /^(?:[•●▪■◦○‣⁃∙·•‣⁃∙▪▫●○◦➢►▶✓✔–—*\-]|[-])$/u;
const NUMBER_MARK = /^(?:\(?\d{1,2}[.)]|\(?[a-z][.)]|\(?(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)[.)])$/iu;

function defragmentSmallCaps(value) {
  return String(value ?? "").replace(/(^|[^\p{L}\p{N}])(\p{Lu}) (?=\p{L}{2,})/gu, "$1$2");
}
// Prose sentence: enough words and a sentence ending, or clearly long-form.
function isProse(text) {
  const t = norm(text), w = wc(t);
  return (w >= 8 && SENTENCE_END.test(t)) || w >= 20;
}

function visualLines(page, source) {
  const items = (page.items || []).filter(i =>
    Number.isInteger(i?.start) && Number.isInteger(i?.end) && i.end > i.start &&
    source.slice(i.start, i.end) === i.text &&
    [i.x, i.y, i.width, i.height].every(Number.isFinite) &&
    i.y > page.height * 0.05 && i.y < page.height * 0.96)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of items) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - item.y) <= Math.max(1.5, 0.45 * Math.max(line.height, item.height || 1))) {
      line.items.push(item);
      line.height = Math.max(line.height, item.height || 0);
    } else lines.push({ y: item.y, height: item.height || 10, items: [item] });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.words = line.items.filter(i => norm(i.text));
    line.segments = [];
    for (const item of line.words) {
      const seg = line.segments.at(-1), prev = seg?.items.at(-1);
      if (seg && item.x - (prev.x + prev.width) < SEGMENT_GAP) seg.items.push(item);
      else line.segments.push({ x: item.x, items: [item] });
    }
    for (const seg of line.segments) seg.text = norm(seg.items.map(i => i.text).join(" "));
    line.text = norm(line.words.map(i => i.text).join(" "));
    line.x = line.words[0]?.x ?? 0;
  }
  return lines.filter(line => line.words.length);
}

function tocEntry(line, page) {
  if (LEADER_ENTRY.test(line.text) && wc(line.text) <= 25) return true;
  const segs = line.segments;
  if (segs.length < 2) return false;
  const last = segs.at(-1), title = norm(segs.slice(0, -1).map(s => s.text).join(" "));
  return PAGE_REF.test(last.text) && last.x >= page.width * 0.6 &&
    wc(title) >= 1 && wc(title) <= 20 && !SENTENCE_END.test(title);
}

function classifyTableOfContents(lines, page, add) {
  for (let k = 0; k < lines.length; k++) {
    const heading = TOC_HEADING.test(lines[k].text) || TOC_HEADING.test(defragmentSmallCaps(lines[k].text));
    const start = heading ? k + 1 : k;
    const block = [];
    let entries = 0;
    for (let j = start; j < lines.length; j++) {
      const line = lines[j], prev = lines[j - 1];
      if (block.length && prev && prev.y - line.y > Math.max(line.height, 8) * 3.2) break;
      if (tocEntry(line, page)) { block.push(line); entries++; continue; }
      // A long entry title can wrap; its page number is on the next line.
      const next = lines[j + 1];
      if (block.length && next && tocEntry(next, page) && line.segments.length === 1 &&
          wc(line.text) <= 15 && !SENTENCE_END.test(line.text)) { block.push(line); continue; }
      break;
    }
    if (entries >= (heading ? 2 : 3)) {
      if (heading) lines[k].words.forEach(i => add(i, "TABLE_OF_CONTENTS_HEADING"));
      block.forEach(line => line.words.forEach(i => add(i, "TABLE_OF_CONTENTS_ENTRY")));
      k = start + block.length - 1;
    }
  }
}

function listMarker(line) {
  const first = line.words[0], second = line.words[1];
  if (!first || !second) return null;
  const mark = norm(first.text);
  const gap = second.x - (first.x + first.width);
  if ((BULLET.test(mark) || NUMBER_MARK.test(mark) || (mark === "o" && gap >= 6)) && gap >= 2) {
    return { textX: second.x, markerX: first.x };
  }
  return null;
}

function classifyLists(lines, add) {
  for (let k = 0; k < lines.length; k++) {
    const marker = listMarker(lines[k]);
    if (!marker) continue;
    const item = [lines[k]];
    for (let j = k + 1; j < lines.length; j++) {
      const line = lines[j], prev = lines[j - 1];
      if (prev.y - line.y > Math.max(line.height, 8) * 1.8 || listMarker(line) ||
          Math.abs(line.x - marker.textX) > 3) break;
      item.push(line);
    }
    const body = norm(item.map(line => line.text).join(" ")).slice(norm(lines[k].words[0].text).length);
    if (!isProse(body)) item.forEach(line => line.words.forEach(i => add(i, "SHORT_LIST_ITEM")));
    k += item.length - 1;
  }
}

// Table cell runs: consecutive lines of one column belonging to one cell. A
// line continues the cell only if the previous line visibly wrapped (it
// filled the column width) or the new line starts in lower case. Separate
// short rows ("Port congestion" / "Single sourcing") stay separate cells.
function cellRuns(rows, anchor) {
  const segs = rows.map(row => ({ row, seg: row.segments.find(s => Math.abs(s.x - anchor) <= 4) }))
    .filter(entry => entry.seg);
  const right = seg => seg.items.at(-1).x + seg.items.at(-1).width;
  const colRight = Math.max(...segs.map(entry => right(entry.seg)));
  const colWidth = Math.max(1, colRight - anchor);
  const runs = [];
  for (const { row, seg } of segs) {
    const run = runs.at(-1);
    const wrapped = run && right(run.segs.at(-1)) >= colRight - colWidth * 0.25;
    const continues = run && run.lastY - row.y <= row.height * 1.9 &&
      (wrapped || /^[\p{Ll}\p{N}]/u.test(seg.text));
    if (continues) { run.segs.push(seg); run.lastY = row.y; }
    else runs.push({ segs: [seg], lastY: row.y });
  }
  return runs;
}

function classifyTables(lines, add) {
  const multi = line => line.segments.length >= 2;
  for (let k = 0; k < lines.length; k++) {
    if (!multi(lines[k])) continue;
    const block = [lines[k]];
    const anchors = lines[k].segments.map(s => s.x);
    for (let j = k + 1; j < lines.length; j++) {
      const line = lines[j], prev = block.at(-1);
      if (prev.y - line.y > Math.max(line.height, 8) * 2.6) break;
      const aligned = line.segments.every(s => anchors.some(a => Math.abs(a - s.x) <= 4));
      if (multi(line) && aligned) { block.push(line); continue; }
      // A wrapped cell in a later column (earlier columns empty on this line).
      if (line.segments.length === 1 && line.x > anchors[0] + 20 &&
          anchors.some(a => Math.abs(a - line.x) <= 4)) { block.push(line); continue; }
      // A merged single-cell row directly under the table ("Question Answer"):
      // short, not a sentence, starting at the table's left edge.
      if (line.segments.length === 1 && Math.abs(line.x - anchors[0]) <= 4 &&
          wc(line.text) <= 6 && !SENTENCE_END.test(line.text) && !/[:;,]$/u.test(line.text) &&
          prev.y - line.y <= Math.max(line.height, 8) * 1.6) { block.push(line); continue; }
      break;
    }
    const rows = block.filter(multi);
    const shared = anchors.slice(1).some(a =>
      rows.filter(r => r.segments.some(s => Math.abs(s.x - a) <= 4)).length >= 2);
    // A single row qualifies only as label/value fragments with a wide gap.
    const singleRow = rows.length === 1 && rows[0].segments.every(s =>
      wc(s.text) <= 8 && !SENTENCE_END.test(s.text)) &&
      rows[0].segments.slice(1).every((s, i) => {
        const left = rows[0].segments[i].items.at(-1);
        return s.x - (left.x + left.width) >= 36;
      });
    if (!(rows.length >= 2 && shared) && !singleRow) continue;
    for (const anchor of anchors) {
      for (const run of cellRuns(block, anchor)) {
        const text = norm(run.segs.map(s => s.text).join(" "));
        const lineWords = wc(text) / run.segs.length;
        const prose = wc(text) >= 10 && /[.!?](?:["'’”)\]])?(?:\s|$)/u.test(text) && lineWords >= 4;
        if (!prose) run.segs.forEach(s => s.items.forEach(i => add(i, "SHORT_TABLE_CELL")));
      }
    }
    k += block.length - 1;
  }
}

function classifyNonProse(document) {
  if (!document || typeof document.text !== "string" || !Array.isArray(document.pages)) return [];
  const source = document.text, spans = [], seen = new Set();
  for (let p = 0; p < document.pages.length; p++) {
    const page = document.pages[p];
    if (page.rotation || !Number.isFinite(page.width) || !Number.isFinite(page.height)) continue;
    const pageNumber = page.pageNumber || p + 1;
    const add = (item, reason) => {
      if (seen.has(item.start)) return;
      seen.add(item.start);
      spans.push({ start: item.start, end: item.end, text: item.text, pageNumber, reason });
    };
    const lines = visualLines(page, source);
    classifyTableOfContents(lines, page, add);
    classifyLists(lines, add);
    classifyTables(lines, add);
  }
  return spans.sort((a, b) => a.start - b.start);
}

module.exports = { classifyNonProse, isProse };
