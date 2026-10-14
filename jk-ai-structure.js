"use strict";
const norm = value => String(value || "").replace(/\s+/gu, " ").trim();
const words = value => (String(value).match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []);
const connectors = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with", "without"]);
function titleLike(value) {
  const core = value.replace(/\([^)]*\)/gu, "").replace(/^\s*\d+(?:\.\d+)*[.)]?\s*/u, "");
  if (/[.!?;]/u.test(core)) return false;
  const significant = words(core).filter(w => !connectors.has(w.toLowerCase()));
  return significant.length > 0 && significant.every(w => /^\p{Lu}/u.test(w));
}
function bold(item) {
  return Number(item.fontWeight) >= 600 || /bold|semibold|demi|black/i.test(String(item.fontFamily || item.fontName || ""));
}
function labelLike(value) {
  if (titleLike(value)) return true;
  const core = value.replace(/\([^)]*\)/gu, "").trim();
  const tokens = words(core);
  return /^\p{Lu}/u.test(core) && tokens.length > 0 && tokens.length <= 12 && !/[.!?;]/u.test(core) &&
    !/\b(?:reports|denies|says|writes|argues|states|believes|experiences|feels|demonstrates|was|were|is|are|has|have)\b/iu.test(core) &&
    !/^(?:I|We|He|She|They|You|It|This|That)\b/iu.test(core);
}
function linesFor(page, source) {
  const lines = [];
  for (const item of [...(page.items || [])].sort((a, b) => a.start - b.start)) {
    if (typeof item.text !== "string" || !item.text.trim() ||
        !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start ||
        source.slice(item.start, item.end) !== item.text ||
        ![item.x, item.y, item.width, item.height].every(Number.isFinite) || item.width <= 0 || item.height <= 0) continue;
    const previous = lines.at(-1);
    if (previous && item.start >= previous.end && /^\s*$/u.test(source.slice(previous.end, item.start)) &&
        Math.abs(item.y - previous.y) <= Math.max(item.height, previous.height) * 0.4) {
      previous.items.push(item); previous.end = item.end;
      previous.x = Math.min(previous.x, item.x); previous.right = Math.max(previous.right, item.x + item.width);
      previous.height = Math.max(previous.height, item.height);
    } else lines.push({ start: item.start, end: item.end, x: item.x, right: item.x + item.width,
      y: item.y, height: item.height, items: [item] });
  }
  for (const line of lines) {
    line.text = source.slice(line.start, line.end); line.width = line.right - line.x;
    const start = source.lastIndexOf("\n", line.start - 1) + 1;
    let end = source.indexOf("\n", line.end); if (end < 0) end = source.length;
    line.isolated = norm(source.slice(start, end)) === norm(line.text);
  }
  return lines;
}
function classifyAiStructuralText(document) {
  if (!document || typeof document.text !== "string" || !Array.isArray(document.pages)) return [];
  const source = document.text, spans = [], usage = new Map();
  for (const page of document.pages) for (const item of page.items || []) {
    if (source.slice(item.start, item.end) !== item.text || !item.fontName) continue;
    usage.set(item.fontName, (usage.get(item.fontName) || 0) + words(item.text).join("").length);
  }
  const ranked = [...usage].sort((a, b) => b[1] - a[1]), total = ranked.reduce((sum, item) => sum + item[1], 0);
  const bodyFont = total && ranked[0]?.[1] / total >= 0.55 ? ranked[0][0] : null;
  const styledShare = (line, start, end) => {
    let styled = 0, letters = 0;
    for (const item of line.items) {
      const a = Math.max(start, item.start), b = Math.min(end, item.end);
      if (a >= b) continue;
      const n = (source.slice(a, b).match(/\p{L}/gu) || []).length;
      letters += n;
      if (bold(item) || (bodyFont && item.fontName !== bodyFont)) styled += n;
    }
    return letters ? styled / letters : 0;
  };
  for (let p = 0; p < document.pages.length; p++) {
    const page = document.pages[p];
    if (page.rotation || !Number.isFinite(page.width) || !Number.isFinite(page.height)) continue;
    const lines = linesFor(page, source);
    const content = lines.filter(l => l.y > page.height * 0.1 && l.y < page.height * 0.92 &&
      !/^\s*(?:\d+|Page\s+\d+(?:\s+of\s+\d+)?)\s*$/iu.test(l.text));
    const centered = line => Math.abs(line.x + line.width / 2 - page.width / 2) <= Math.max(12, line.height * 1.8);
    // A separate first-page cover needs sparse centered lines AND multiple metadata clues.
    // A first-page essay or abstract with prose is retained.
    const clues = content.filter(l => /\b(?:university|college|department|faculty|instructor|professor|student|assignment\s+due|due\s+date|course)\b/iu.test(l.text) ||
      /\b[A-Z]{2,8}\s*[- ]?\d{3,5}\b/u.test(l.text) ||
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/iu.test(l.text));
    const prose = content.some(l => words(l.text).length > 28 ||
      (words(l.text).length >= 8 && (/[.!?]["'’”)]?\s*$/u.test(l.text) ||
        /\b(?:reports|states|requires|supports|suggests|shows|explains|describes|indicates|believes|denies)\b/iu.test(l.text)) &&
        !clues.includes(l) && content.indexOf(l) > 1));
    const cover = p === 0 && document.pages.length > 1 && content.length >= 4 && content.length <= 14 &&
      clues.length >= 2 && words(content.map(l => l.text).join(" ")).length <= 180 &&
      content.filter(centered).length / content.length >= 0.8 && !prose;
    if (cover) {
      for (const line of content) spans.push({ start: line.start, end: line.end, text: line.text,
        pageNumber: page.pageNumber || p + 1, reason: "SEPARATE_COVER_PAGE" });
      continue;
    }
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (!line.isolated) continue;
      const text = norm(line.text);
      const colon = line.text.indexOf(":");
      if (colon < 0) {
        const next = lines[lineIndex + 1];
        if (next && titleLike(text) && words(text).length <= 30 &&
            styledShare(line, line.start, line.end) >= 0.8 &&
            words(next.text).length >= 8 && styledShare(next, next.start, next.end) <= 0.25 &&
            line.y - next.y >= line.height * 0.8 && line.y - next.y <= line.height * 4) {
          spans.push({ start: line.start, end: line.end, text: line.text,
            pageNumber: page.pageNumber || p + 1, reason: "FORMATTED_STANDALONE_HEADING" });
        }
        continue;
      }
      if (colon < 1) continue;
      let labelStart = line.start;
      const leading = /^(?:\s|[•\uF0B7\u25CF])*/u.exec(line.text)?.[0] || "";
      labelStart += leading.length;
      const labelEnd = line.start + colon + 1;
      const label = source.slice(labelStart, labelEnd - 1).trim();
      if (label.length > 140 || words(label).length > 15 || !labelLike(label)) continue;
      const parenthesis = source.slice(labelStart, labelEnd).indexOf("(");
      const styleEnd = parenthesis > 0 ? labelStart + parenthesis : labelEnd;
      if (styledShare(line, labelStart, styleEnd) < 0.6) continue;
      const remainder = norm(line.text.slice(colon + 1));
      // A standalone section label is excluded; a run-in label excludes ONLY its prefix.
      // Long clinical answers and their original source offsets are retained.
      if (!remainder || words(remainder).length >= 2) spans.push({ start: labelStart, end: labelEnd,
        text: source.slice(labelStart, labelEnd), pageNumber: page.pageNumber || p + 1,
        reason: remainder ? "FORMATTED_RUN_IN_LABEL" : "STANDALONE_SECTION_LABEL" });
    }
  }
  return spans;
}
function excludeAiStructuralText(prepared, document) {
  if (!document || typeof document.text !== "string" || typeof prepared?.text !== "string" ||
      !Array.isArray(prepared.map) || prepared.text.length !== prepared.map.length) return prepared;
  const legacy = require("./jk-ai-headings.js").excludeAiStructuralHeadings(prepared, document);
  const map = legacy.map.slice(), chars = legacy.text.split(""), indices = new Map();
  map.forEach((source, i) => { if (Number.isInteger(source)) indices.set(source, i); });
  const spans = [...(legacy.aiStructuralHeadingSpans || [])], covers = new Set();
  for (const span of classifyAiStructuralText(document)) {
    const start = indices.get(span.start), length = span.end - span.start;
    if (!Number.isInteger(start)) continue;
    let exact = true;
    for (let offset = 0; offset < length; offset++) if (map[start + offset] !== span.start + offset ||
        chars[start + offset] !== document.text[span.start + offset]) { exact = false; break; }
    if (!exact) continue;
    for (let offset = 0; offset < length; offset++) {
      if (!/[\r\n]/u.test(chars[start + offset])) chars[start + offset] = " ";
      map[start + offset] = null;
    }
    spans.push(span); if (span.reason === "SEPARATE_COVER_PAGE") covers.add(span.pageNumber);
  }
  return { ...legacy, text: chars.join(""), map, aiHeadingPolicy: "cover-and-formatted-labels-v2",
    aiStructuralHeadingsExcluded: spans.length, aiCoverPagesExcluded: covers.size, aiStructuralHeadingSpans: spans };
}
module.exports = { classifyAiStructuralText, excludeAiStructuralText };
