"use strict";

const REFERENCE_HEADING = /^(reference list|references?|bibliography|works cited|table of cases|table of legislation)\s*:?\s*$/i;
const KNOWN_TERMINATOR = /^(?:(?:appendix|appendices|glossary|acknowledgements?|acknowledgments?|exhibits)(?:\s+.*)?|(?:tables?|figures?|charts?)(?:\s+\d+.*)?)\s*:?\s*$/i;
const STRUCTURAL_FOLLOWER = /^(?:date|context|children|apst|purpose|overview|learning objectives|introduction|background|stimulus behaviour|strategies used|reflection|references|appendix|appendices|table of contents)\s*:?\s*$|^\d+(?:\.\d+)*[.)]?\s+[A-Z]/i;

function lineRecords(source) {
  const out = [];
  const re = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let m;
  while ((m = re.exec(source))) {
    const full = m[0];
    if (!full) break;
    const text = full.replace(/(?:\r\n|\n|\r)$/, "");
    out.push({text, start: m.index, end: m.index + text.length,
      next: m.index + full.length});
  }
  return out;
}

function hasReferenceEvidence(source) {
  return /\b(?:19|20)\d{2}[a-z]?\b|https?:\/\/|doi\s*:/i.test(source) ||
    /\b(?:journal|volume|edition|pp?\.\s*\d|et al\.)\b/i.test(source);
}

function isLikelySectionHeading(lines, index, start, source) {
  const line = lines[index];
  const text = line.text.trim();
  if (!text || text.length < 3 || text.length > 100) return false;
  if (REFERENCE_HEADING.test(text) || KNOWN_TERMINATOR.test(text)) return false;
  if (/^(?:https?:\/\/|doi\s*:|www\.)/i.test(text)) return false;
  if (/\b(?:19|20)\d{2}[a-z]?\b|https?:\/\/|doi\s*:/i.test(text)) return false;
  if (/^[A-Z][A-Za-z'’.-]{1,50},\s/.test(text)) return false;
  if (/^[\[(]?\d+[\])\.]\s+[A-Z]/.test(text) && !/^\d+(?:\.\d+)+/.test(text)) {
    // Numbered section heading is possible; reference lists are usually
    // author/date entries and are rejected by the reference-evidence checks.
  }
  if (line.start < start + 24) return false;

  const preceding = source.slice(start, line.start);
  if (!hasReferenceEvidence(preceding)) return false;

  const previous = index > 0 ? lines[index - 1].text.trim() : "";
  let nextIndex = index + 1;
  while (nextIndex < lines.length && !lines[nextIndex].text.trim()) nextIndex++;
  const next = nextIndex < lines.length ? lines[nextIndex].text.trim() : "";
  const blankBefore = previous === "";
  const blankAfter = nextIndex > index + 1 ||
    (index + 1 < lines.length && !lines[index + 1].text.trim());
  const structuralNext = STRUCTURAL_FOLLOWER.test(next) ||
    /^(?:date|context|children|apst|purpose)\s*:/i.test(next);
  // Conservative by design: close a reference block only when the next
  // nonblank line confirms a recognizable section structure. Title-cased
  // article/journal titles alone are not sufficient evidence.
  if (!structuralNext) return false;

  // Reject likely reference continuation lines ending in bibliographic
  // punctuation and lines that look like authors, URLs, identifiers or years.
  if (/[,:;]\s*$/.test(text)) return false;
  return true;
}

function findSectionBoundary(source, start, lines) {
  const index = lines.findIndex(line => line.start >= start);
  if (index < 0) return source.length;

  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.start <= start) continue;
    const text = line.text.trim();
    if (!text) continue;

    if (KNOWN_TERMINATOR.test(text)) return line.start;

    // A later standalone structural heading closes this bibliography block.
    // It remains in the analysis text and can itself contain a later
    // References section that will be detected independently.
    if (isLikelySectionHeading(lines, i, start, source)) return line.start;
  }
  return source.length;
}

function findReferenceSections(source, fallbackStart = -1) {
  source = String(source || "");
  const lines = lineRecords(source);
  const headings = [];
  const re = /(^|\n)[ \t]*(reference list|references?|bibliography|works cited|table of cases|table of legislation)[ \t]*:?[ \t]*(?=\r?\n|$)/gim;
  let match;
  while ((match = re.exec(source))) {
    const start = match.index + match[1].length;
    if (start >= source.length * 0.30) headings.push(start);
  }

  // Preserve conservative flattened-heading fallback used by PDF extraction.
  if (!headings.length && Number.isInteger(fallbackStart) &&
      fallbackStart >= 0 && fallbackStart < source.length) {
    headings.push(fallbackStart);
  }

  const ranges = [];
  let excludedUntil = -1;
  for (const start of [...new Set(headings)].sort((a,b) => a-b)) {
    if (start < excludedUntil) continue;
    const end = findSectionBoundary(source, start, lines);
    if (end > start) {
      ranges.push({start,end});
      excludedUntil = end;
    }
  }
  return ranges;
}

function prepareWithoutReferences(rawText, builder, fallbackStart = -1) {
  const source = String(rawText || "");
  const ranges = findReferenceSections(source, fallbackStart);
  if (!ranges.length) return builder(source);

  let text = "";
  const map = [];
  let cursor = 0;

  for (const range of ranges) {
    for (let i = cursor; i < range.start; i++) {
      text += source[i];
      map.push(i);
    }
    if (text.length) {
      text += "\n";
      map.push(Number.NaN);
    }
    cursor = range.end;
  }

  for (let i = cursor; i < source.length; i++) {
    text += source[i];
    map.push(i);
  }

  const prepared = builder(text);
  const composed = prepared.map.map(index =>
    Number.isInteger(index) && index >= 0 ? map[index] : Number.NaN
  );
  const quoteRanges = (prepared.removedQuoteRanges || [])
    .map(range => ({
      ...range,
      start: map[range.start],
      end: map[range.end - 1] + 1
    }))
    .filter(range =>
      Number.isFinite(range.start) && Number.isFinite(range.end)
    );

  return {
    ...prepared,
    map: composed,
    removedQuoteRanges: quoteRanges,
    originalLength: source.length,
    bibliographyStart: ranges[0].start,
    removedReferenceRanges: ranges
  };
}

module.exports = { findReferenceSections, prepareWithoutReferences };
