"use strict";

const REFERENCE_HEADING = /^(reference list|references?|bibliography|works cited|table of cases|table of legislation)\s*:?\s*$/i;
const KNOWN_TERMINATOR = /^(?:(?:appendix|appendices|glossary|acknowledgements?|acknowledgments?|exhibits)(?:\s+.*)?|(?:tables?|figures?|charts?)(?:\s+\d+.*)?)\s*:?\s*$/i;
const STRUCTURAL_FOLLOWER = /^(?:date|context|children|apst|purpose|overview|learning objectives|introduction|background|stimulus behaviour|strategies used|reflection|references|appendix|appendices|table of contents)\s*:?\s*$|^\d+(?:\.\d+)*[.)]?\s+[A-Z]/i;

const SECTION_STOPWORDS = new Set([
  "a","an","and","as","at","by","for","from","in","into","of","on","or",
  "the","to","with","without","vs","versus"
]);
const COMMON_SECTION_HEADING = /^(?:abstract|introduction(?:\s+(?:of|to)\b.*)?|background|overview(?:\s+of\b.*)?|basic overview(?:\s+of\b.*)?|purpose|objective(?:s)?|literature review|related work|method(?:s|ology)?|results?|discussion|conclusion|summary|police|courts|corrections|structure of\b.*|origin of\b.*|current issues and concerns|legal philosophy|type of system|alternatives to incarceration|handling juveniles|guiding children(?:['’]s)? behaviour|teaching resources(?:,?\s+strategies)?(?:\s+and transitions)?|main point\s+\d+|chapter\s+\d+.*|part\s+\d+.*)$/i;
const REFERENCE_ENTRY_START = /^(?:\[\d+\]\s*)?(?:[A-Z][\p{L}'’.-]{1,50},\s*[A-Z]|\S.{0,100}\((?:19|20)\d{2}[a-z]?\)\s*[.,]|https?:\/\/|www\.|doi\s*:)/u;

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
  if (/^[A-Z][\p{L}'’.-]{1,50},\s/u.test(text)) return false;
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

  // Detect the heading itself. Real sections commonly start with a heading
  // such as "Introduction" and then an ordinary body paragraph.
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
  const meaningful = words.filter(word =>
    !SECTION_STOPWORDS.has(word.toLowerCase()));
  const titleCase = meaningful.length > 0 &&
    meaningful.every(word => /^\p{Lu}/u.test(word));
  const knownHeading = COMMON_SECTION_HEADING.test(text) ||
    /^\d+(?:\.\d+)*[.)]?\s+[A-Z]/u.test(text);
  const headingShape = knownHeading ||
    (titleCase && words.length <= 12 && blankBefore && blankAfter);

  if (!headingShape || /[,:;]\s*$/.test(text)) return false;
  if (!next) return false;

  // Do not treat a reference entry as the body following a candidate heading.
  const structuralNext = STRUCTURAL_FOLLOWER.test(next);
  const referenceNext = REFERENCE_ENTRY_START.test(next);
  const bodyNext = next.length >= 18 &&
    !REFERENCE_HEADING.test(next) &&
    !KNOWN_TERMINATOR.test(next) &&
    !referenceNext;

  return structuralNext || bodyNext;
}

function paragraphsFor(source) {
  const lines = lineRecords(source);
  const out = [];
  let current = null;
  for (const line of lines) {
    if (!line.text.trim()) {
      if (current) {
        current.text = current.lines.join("\n");
        delete current.lines;
        out.push(current);
        current = null;
      }
      continue;
    }
    if (!current) current = { start: line.start, end: line.end, lines: [line.text.trim()] };
    else {
      current.end = line.end;
      current.lines.push(line.text.trim());
    }
  }
  if (current) {
    current.text = current.lines.join("\n");
    delete current.lines;
    out.push(current);
  }
  return out;
}

function isReferenceEntryParagraph(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (!text) return false;
  if (/^(?:\[\d+\]\s*)?(?:https?:\/\/|www\.|doi\s*:)/iu.test(text)) return true;
  if (/\b(?:https?:\/\/|doi\s*:\s*10\.\d{4,9}\/)/iu.test(text)) return true;
  if (/^(?:\[\d+\]\s*)?[A-Z][\p{L}'’.-]{1,50},\s*(?:[A-Z]\.?|[A-Z][\p{L}'’.-]+)\b/u.test(text)) return true;
  if (/^[A-Z][^.!?]{1,100}\.\s*\((?:19|20)\d{2}[a-z]?\)/u.test(text)) return true;
  if (/^[A-Z][^.!?]{1,100}\s+\((?:19|20)\d{2}[a-z]?\)/u.test(text)) return true;
  if (/^(?:\[\d+\]|\d+[.)])\s+.{8,}/u.test(text) &&
      /\b(?:19|20)\d{2}[a-z]?\b|https?:\/\/|doi\b/iu.test(text)) return true;
  return false;
}

function looksLikeReferenceContinuation(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
  if (!text || isReferenceEntryParagraph(text)) return true;
  if (text.length <= 85 && words.length <= 12 &&
      !/\b(?:I|we|they|he|she|it|this|these|those|the|because|however|therefore|although|is|are|was|were|has|have|serves|shows|explains|discusses|compares|argues|suggests|provides|examines|demonstrates|remains|continues|includes|contains)\b/iu.test(text)) {
    return true;
  }
  return false;
}

function looksLikeSubstantiveBody(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
  if (words.length >= 8 && /\b(?:the|and|but|because|this|that|these|those|is|are|was|were|has|have|serves|shows|explains|discusses|compares|argues|suggests|provides|examines|demonstrates|remains|continues|includes|contains|while|which|who|when|where|with|from|into|their|they|we|it)\b/iu.test(text)) return true;
  return words.length >= 16;
}

function looksLikeUnheadedBodyLine(value) {
  const text = String(value || "").replace(/\\s+/gu, " ").trim();
  const words = text.match(/[\\p{L}\\p{N}][\\p{L}\\p{N}'’.-]*/gu) || [];
  if (words.length < 10) return false;
  if (!/^(?:the|this|these|those|in|on|when|while|however|therefore|according to|ultimately|moreover|it|they|we|as|for|although|unlike|similarly|germany|the united states|in contrast)\\b/iu.test(text)) return false;
  if (!/\\b(?:is|are|was|were|has|have|serves|shows|explains|discusses|compares|argues|suggests|provides|examines|demonstrates|remains|continues|includes|contains|indicates|means|describes|requires|supports|presents|focuses|emphasizes|uses|allows|creates|reveals|contrasts)\\b/iu.test(text)) return false;
  if (/^(?:journal|volume|issue|pp?\\.?|edition|publisher|retrieved|available at|doi|https?:|www\\.)\\b/iu.test(text)) return false;
  return true;
}

function findSectionBoundary(source, start, lines) {
  const index = lines.findIndex(line => line.start >= start);
  if (index < 0) return source.length;

  const paragraphs = paragraphsFor(source);
  const headingParagraph = paragraphs.findIndex(p =>
    p.start <= start && start < p.end);

  // Detect the no-heading case at line level as well as paragraph level.
  // PDF/DOCX extraction may place the first body paragraph on the next line
  // without an empty line separating it from the last reference entry.
  let lineConfirmedEntries = 0;
  for (let i = index + 1; i < lines.length; i++) {
    const text = lines[i].text.trim();
    if (!text) continue;
    if (KNOWN_TERMINATOR.test(text)) return lines[i].start;
    if (isLikelySectionHeading(lines, i, start, source)) return lines[i].start;
    if (isReferenceEntryParagraph(text)) {
      lineConfirmedEntries++;
      continue;
    }
    if (lineConfirmedEntries > 0 && looksLikeUnheadedBodyLine(text)) {
      return lines[i].start;
    }
  }

  // First preserve the strong explicit-heading/known-terminator behavior.
  // Also remember which paragraphs look like actual bibliography entries.
  let confirmedEntries = 0;
  const firstParagraph = headingParagraph >= 0
    ? headingParagraph + 1
    : paragraphs.findIndex(p => p.start > start);

  for (let p = Math.max(0, firstParagraph); p < paragraphs.length; p++) {
    const paragraph = paragraphs[p];
    if (paragraph.start <= start) continue;

    const firstLine = lines.findIndex(line => line.start >= paragraph.start);
    if (firstLine >= 0) {
      const line = lines[firstLine];
      const text = paragraph.text.trim();

      if (KNOWN_TERMINATOR.test(text)) return paragraph.start;

      if (isLikelySectionHeading(lines, firstLine, start, source))
        return paragraph.start;

      if (isReferenceEntryParagraph(text)) {
        confirmedEntries++;
        continue;
      }

      // New, titleless substantive prose after confirmed reference entries
      // ends the exclusion block. A heading is not required. If the following
      // text is ambiguous (short publisher/continuation line), keep scanning
      // rather than guessing that it is body content.
      if (confirmedEntries > 0 && looksLikeSubstantiveBody(text) &&
          !looksLikeReferenceContinuation(text)) {
        return paragraph.start;
      }
    }
  }
  return source.length;
}

function hasReferenceEntryAfterHeading(source, start, lines) {
  const headingIndex = lines.findIndex(line =>
    line.start <= start && start <= line.end);
  if (headingIndex < 0) return false;

  // Validate each exact heading against real reference-entry evidence nearby.
  // This allows early bibliographies without mistaking a table-of-contents
  // label for a bibliography, because TOC headings are not followed by
  // author/date, DOI, URL, or numbered reference entries.
  let examined = 0;
  for (let i = headingIndex + 1; i < lines.length && examined < 12; i++) {
    const text = lines[i].text.trim();
    if (!text) continue;
    examined++;

    if (isReferenceEntryParagraph(text)) return true;
    if (KNOWN_TERMINATOR.test(text) ||
        COMMON_SECTION_HEADING.test(text) ||
        STRUCTURAL_FOLLOWER.test(text)) return false;
  }
  return false;
}

function findReferenceSections(source, fallbackStart = -1) {
  source = String(source || "");
  const lines = lineRecords(source);
  const headings = [];
  const re = /(^|\n)[ \t]*(reference list|references?|bibliography|works cited|table of cases|table of legislation)[ \t]*:?[ \t]*(?=\r?\n|$)/gim;
  let match;
  while ((match = re.exec(source))) {
    const start = match.index + match[1].length;
    if (hasReferenceEntryAfterHeading(source, start, lines)) headings.push(start);
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
  if (!ranges.length) return builder(source, { skipBibliographyFilter: false });

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

  const prepared = builder(text, { skipBibliographyFilter: true });
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
