"use strict";

// Conservative layout heuristic, not a reproduction of Turnitin's parser.
function excludeAiStructuralHeadings(prepared, document) {
  if (!document || !Array.isArray(document.pages) ||
      typeof document.text !== "string" ||
      typeof prepared?.text !== "string" ||
      !Array.isArray(prepared.map) ||
      prepared.map.length !== prepared.text.length) return prepared;

  const usage = new Map();
  let total = 0;
  for (const page of document.pages) {
    for (const item of page.items || []) {
      if (!item.fontName || !Number.isInteger(item.start) ||
          !Number.isInteger(item.end) ||
          document.text.slice(item.start, item.end) !== item.text) continue;
      const count = (item.text.match(/\p{L}/gu) || []).length;
      usage.set(item.fontName, (usage.get(item.fontName) || 0) + count);
      total += count;
    }
  }
  const ranked = [...usage].sort((a, b) => b[1] - a[1]);
  if (!total || !ranked.length || ranked[0][1] / total < 0.75) return prepared;
  const bodyFont = ranked[0][0];
  const spans = [];
  const connectors = new Set([
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "of",
    "on", "or", "the", "to", "with", "without"
  ]);

  for (const page of document.pages) {
    if (page.rotation || !Number.isFinite(page.width)) continue;
    const items = page.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i], next = items[i + 1], continuation = items[i + 2];
      if (!item.fontName || item.fontName === bodyFont ||
          !next || !continuation || next.fontName !== bodyFont ||
          continuation.fontName !== bodyFont || !next.hasEOL) continue;
      if (![item.x, item.y, item.width, item.height, next.y, continuation.y]
          .every(Number.isFinite) || item.height <= 0 || item.width <= 0) continue;
      if (!Number.isInteger(item.start) || !Number.isInteger(item.end) ||
          item.start < 0 || item.end <= item.start ||
          document.text.slice(item.start, item.end) !== item.text) continue;
      const text = item.text.trim();
      // Only a complete isolated line; no run-in headings or split text items.
      const lineStart = document.text.lastIndexOf("\n", item.start - 1) + 1;
      let lineEnd = document.text.indexOf("\n", item.end);
      if (lineEnd < 0) lineEnd = document.text.length;
      if (document.text.slice(lineStart, lineEnd).trim() !== text) continue;
      // Keep sentences, questions and ambiguous lowercase labels for analysis.
      if (/[.!?;]$/.test(text) || /[.!?]/.test(text.replace(/^\d+[.)]\s*/, ""))) continue;
      const words = text.match(/\p{L}[\p{L}\p{M}'’\-]*/gu) || [];
      const significant = words.filter(word => !connectors.has(word.toLowerCase()));
      if (significant.length < 2 ||
          !significant.every(word => /^\p{Lu}/u.test(word))) continue;
      if (item.width > page.width * 0.8 ||
          Math.abs(item.x + item.width / 2 - page.width / 2) > item.height * 1.5) continue;
      if (item.y - next.y < item.height * 1.1 ||
          item.y - next.y > item.height * 3.5 ||
          next.y - continuation.y < item.height * 0.8 ||
          next.y - continuation.y > item.height * 3.5) continue;
      if (!/^\s*\n\s*$/u.test(document.text.slice(item.end, next.start))) continue;
      if (i > 0) {
        const previous = items[i - 1];
        const pageNumber = /^\d+$/.test(previous.text.trim());
        if (!pageNumber && (previous.fontName !== bodyFont || previous.hasEOL ||
            !/[.!?]["'’”)]?\s*$/.test(previous.text))) continue;
      }
      spans.push({ start: item.start, end: item.end, text, pageNumber: page.pageNumber });
    }
  }

  // Mask only fully mapped, exact spans. Nulls prevent highlights crossing them.
  const indices = new Map();
  prepared.map.forEach((source, index) => {
    if (Number.isInteger(source)) indices.set(source, index);
  });
  const chars = prepared.text.split("");
  const map = prepared.map.slice();
  const excluded = [];
  for (const span of spans) {
    const start = indices.get(span.start);
    if (!Number.isInteger(start)) continue;
    let valid = true;
    for (let offset = 0; offset < span.end - span.start; offset++) {
      if (map[start + offset] !== span.start + offset ||
          chars[start + offset] !== document.text[span.start + offset]) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    for (let offset = 0; offset < span.end - span.start; offset++) {
      chars[start + offset] = " ";
      map[start + offset] = null;
    }
    excluded.push(span);
  }
  return {
    ...prepared,
    text: chars.join(""), map,
    aiHeadingPolicy: "centered-distinct-font-title-case-v1",
    aiStructuralHeadingsExcluded: excluded.length,
    aiStructuralHeadingSpans: excluded
  };
}

module.exports = { excludeAiStructuralHeadings };
