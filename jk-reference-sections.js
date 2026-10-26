"use strict";

const crypto = require("node:crypto");

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
  let match;
  while ((match = re.exec(source))) {
    const full = match[0];
    if (!full) break;
    const text = full.replace(/(?:\r\n|\n|\r)$/, "");
    out.push({text, start: match.index, end: match.index + text.length,
      next: match.index + full.length});
  }
  return out;
}

function paragraphsFor(source) {
  const out = [];
  let current = null;
  for (const line of lineRecords(source)) {
    if (!line.text.trim()) {
      if (current) {
        current.text = current.lines.join("\n");
        delete current.lines;
        out.push(current);
        current = null;
      }
      continue;
    }
    if (!current) current = {start: line.start, end: line.end, lines: [line.text.trim()]};
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
  if (!hasReferenceEvidence(source.slice(start, line.start))) return false;

  let nextIndex = index + 1;
  while (nextIndex < lines.length && !lines[nextIndex].text.trim()) nextIndex++;
  const next = nextIndex < lines.length ? lines[nextIndex].text.trim() : "";
  const previous = index > 0 ? lines[index - 1].text.trim() : "";
  const blankBefore = !previous;
  const blankAfter = nextIndex > index + 1 ||
    (index + 1 < lines.length && !lines[index + 1].text.trim());
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
  const meaningful = words.filter(word => !SECTION_STOPWORDS.has(word.toLowerCase()));
  const titleCase = meaningful.length > 0 && meaningful.every(word => /^\p{Lu}/u.test(word));
  const knownHeading = COMMON_SECTION_HEADING.test(text) ||
    /^\d+(?:\.\d+)*[.)]?\s+[A-Z]/u.test(text);
  const headingShape = knownHeading ||
    (titleCase && words.length <= 12 && blankBefore && blankAfter);
  if (!headingShape || /[,:;]\s*$/.test(text) || !next) return false;
  if (REFERENCE_ENTRY_START.test(next)) return false;
  return STRUCTURAL_FOLLOWER.test(next) || next.length >= 18;
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
  if (!text || isReferenceEntryParagraph(text)) return true;
  if (/^(?:journal(?: of)?|proceedings|university|institute|volume|vol\.?|issue|no\.?|pp?\.?|edition|publisher|retrieved(?: from)?|available at|doi\b|https?:|www\.)\b/iu.test(text)) return true;
  if (/^\d+\s*[-–]\s*\d+\s*\.?$/u.test(text)) return true;
  if (/^[a-z]/u.test(text) && text.length <= 140 && !/[.!?]\s+[A-Z]/u.test(text)) return true;
  return false;
}

function looksLikeSubstantiveBody(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
  if (words.length >= 8 && /\b(?:the|and|but|because|this|that|these|those|is|are|was|were|has|have|serves|shows|explains|discusses|compares|argues|suggests|provides|examines|demonstrates|remains|continues|includes|contains|while|which|who|when|where|with|from|into|their|they|we|it)\b/iu.test(text)) return true;
  return words.length >= 16;
}

function looksLikeUnheadedBodyLine(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
  if (words.length < 10) return false;
  if (!/^(?:the|this|these|those|in|on|when|while|however|therefore|according to|ultimately|moreover|it|they|we|as|for|although|unlike|similarly|germany|the united states|in contrast)\b/iu.test(text)) return false;
  if (!/\b(?:is|are|was|were|has|have|serves|shows|explains|discusses|compares|argues|suggests|provides|examines|demonstrates|remains|continues|includes|contains|indicates|means|describes|requires|supports|presents|focuses|emphasizes|uses|allows|creates|reveals|contrasts)\b/iu.test(text)) return false;
  if (/^(?:journal|volume|issue|pp?\.?|edition|publisher|retrieved|available at|doi|https?:|www\.)\b/iu.test(text)) return false;
  return true;
}

function hasReferenceEntryAfterHeading(source, start, lines) {
  const headingIndex = lines.findIndex(line => line.start <= start && start <= line.end);
  if (headingIndex < 0) return false;
  let examined = 0;
  for (let i = headingIndex + 1; i < lines.length && examined < 12; i++) {
    const text = lines[i].text.trim();
    if (!text) continue;
    examined++;
    if (isReferenceEntryParagraph(text)) return true;
    if (KNOWN_TERMINATOR.test(text) || COMMON_SECTION_HEADING.test(text) ||
        STRUCTURAL_FOLLOWER.test(text)) return false;
  }
  return false;
}

function candidatePreview(source, offset) {
  return String(source.slice(offset, Math.min(source.length, offset + 200)))
    .replace(/\s+/gu, " ").trim().slice(0, 180);
}

function buildReviewCandidates(source, start, lines, firstCandidateOffset) {
  const offsets = [];
  const add = offset => {
    if (!Number.isInteger(offset) || offset <= start || offset >= source.length) return;
    if (!offsets.includes(offset)) offsets.push(offset);
  };
  add(firstCandidateOffset);
  let entries = 0;
  for (const line of lines) {
    if (line.start <= start || !line.text.trim()) continue;
    const text = line.text.trim();
    if (REFERENCE_HEADING.test(text)) break;
    if (isReferenceEntryParagraph(text)) {
      entries++;
      continue;
    }
    if (entries > 0 && (KNOWN_TERMINATOR.test(text) ||
        isLikelySectionHeading(lines, lines.indexOf(line), start, source) ||
        looksLikeSubstantiveBody(text) || looksLikeUnheadedBodyLine(text))) {
      add(line.start);
    }
    if (offsets.length >= 3) break;
  }
  return offsets.slice(0, 3).map((offset, index) => ({
    id: index + 1,
    offset,
    preview: candidatePreview(source, offset)
  }));
}

function inspectBoundary(source, start, lines) {
  const index = lines.findIndex(line => line.start <= start && start <= line.end);
  if (index < 0) {
    return {status: "REVIEW", reason: "The reference heading could not be located safely.", candidateOffset: null, entriesFound: 0};
  }
  let entriesFound = 0;
  let firstCandidate = null;
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    const text = line.text.trim();
    if (!text) continue;

    if (KNOWN_TERMINATOR.test(text)) {
      return {status: "AUTO", end: line.start, reason: "Recognized section terminator.", entriesFound};
    }
    if (isLikelySectionHeading(lines, i, start, source)) {
      return {status: "AUTO", end: line.start, reason: "Recognized following section.", entriesFound};
    }
    if (isReferenceEntryParagraph(text)) {
      entriesFound++;
      continue;
    }

    if (entriesFound > 0 &&
        (looksLikeUnheadedBodyLine(text) ||
         (looksLikeSubstantiveBody(text) && !looksLikeReferenceContinuation(text)))) {
      return {status: "AUTO", end: line.start, reason: "Substantive prose resumes.", entriesFound};
    }

    if (looksLikeReferenceContinuation(text)) continue;

    firstCandidate = line.start;
    return {
      status: "REVIEW",
      reason: entriesFound
        ? "Text after the last recognizable reference entry is ambiguous."
        : "The reference heading is present, but the following entries or ending boundary could not be verified.",
      candidateOffset: firstCandidate,
      entriesFound
    };
  }

  if (entriesFound > 0) {
    return {status: "AUTO", end: source.length, reason: "Verified reference entries continue to end of document.", entriesFound};
  }

  return {
    status: "REVIEW",
    reason: "No recognizable reference entries or safe section boundary were found.",
    candidateOffset: firstCandidate,
    entriesFound
  };
}

function inspectReferenceSections(source, fallbackStart = -1, overrides = []) {
  source = String(source || "");
  const lines = lineRecords(source);
  const sourceTextSha256 = crypto.createHash("sha256").update(source, "utf8").digest("hex");
  const starts = [];
  const seen = new Set();
  const re = /(^|\n)[ \t]*(reference list|references?|bibliography|works cited|table of cases|table of legislation)[ \t]*:?[ \t]*(?=\r?\n|$)/gim;
  let match;
  while ((match = re.exec(source))) {
    const start = match.index + match[1].length;
    if (hasReferenceEntryAfterHeading(source, start, lines)) starts.push(start);
  }
  if (!starts.length && Number.isInteger(fallbackStart) && fallbackStart >= 0 && fallbackStart < source.length) {
    starts.push(fallbackStart);
  }
  for (const override of overrides || []) {
    if (Number.isInteger(override?.start) && override.start >= 0 && override.start < source.length &&
        !starts.includes(override.start)) starts.push(override.start);
  }

  const ranges = [];
  const reviews = [];
  let excludedUntil = -1;
  for (const start of [...new Set(starts)].sort((a,b) => a-b)) {
    if (start < excludedUntil) continue;
    const override = (overrides || []).find(item => item?.start === start);
    if (override) {
      const validHash = override.sourceTextSha256 === sourceTextSha256;
      const validEnd = Number.isInteger(override.end) &&
        override.end > start && override.end <= source.length &&
        (override.end === source.length || source[override.end - 1] === "\n" ||
         source[override.end - 1] === "\r");
      if (!validHash || !validEnd) {
        reviews.push({
          start,
          heading: String(source.slice(start, start + 80)).split(/\r?\n/u)[0].trim().slice(0, 80),
          sourceTextSha256, sourceLength: source.length,
          reason: "The document text changed after the admin selected a boundary. Please review the new text.",
          candidates: buildReviewCandidates(source, start, lines, start + 1)
        });
        continue;
      }
      ranges.push({start, end: override.end, manual: true});
      excludedUntil = override.end;
      continue;
    }

    const decision = inspectBoundary(source, start, lines);
    if (decision.status === "REVIEW") {
      const headingLine = lines.find(line => line.start <= start && start <= line.end);
      reviews.push({
        start,
        heading: (headingLine?.text || "References").trim().slice(0, 80),
        sourceTextSha256,
        sourceLength: source.length,
        reason: decision.reason,
        entriesFound: decision.entriesFound,
        candidates: buildReviewCandidates(source, start, lines, decision.candidateOffset)
      });
      continue;
    }
    if (Number.isInteger(decision.end) && decision.end > start) {
      ranges.push({start, end: decision.end, manual: false});
      excludedUntil = decision.end;
    }
  }
  return {ranges, reviews, sourceTextSha256, sourceLength: source.length};
}

function findReferenceSections(source, fallbackStart = -1) {
  return inspectReferenceSections(source, fallbackStart).ranges;
}

function makeReferenceReviewError(review) {
  const error = new Error("Reference/bibliography boundary requires administrator review. No provider requests were made.");
  error.code = "REFERENCE_BOUNDARY_REVIEW_REQUIRED";
  error.apiBlocked = true;
  error.noProviderRequests = true;
  error.referenceReview = review;
  return error;
}

function prepareWithoutReferences(rawText, builder, fallbackStart = -1, overrides = []) {
  const source = String(rawText || "");
  const inspection = inspectReferenceSections(source, fallbackStart, overrides);
  if (inspection.reviews.length) {
    throw makeReferenceReviewError(inspection.reviews[0]);
  }
  const ranges = inspection.ranges;
  if (!ranges.length) return builder(source, {skipBibliographyFilter: false});

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

  const prepared = builder(text, {skipBibliographyFilter: true});
  const composed = prepared.map.map(index =>
    Number.isInteger(index) && index >= 0 ? map[index] : Number.NaN);
  const quoteRanges = (prepared.removedQuoteRanges || []).map(range => ({
    ...range,
    start: map[range.start],
    end: map[range.end - 1] + 1
  })).filter(range => Number.isFinite(range.start) && Number.isFinite(range.end));

  return {
    ...prepared,
    map: composed,
    removedQuoteRanges: quoteRanges,
    originalLength: source.length,
    bibliographyStart: ranges[0].start,
    removedReferenceRanges: ranges,
    referenceBoundaryOverridesApplied: ranges.filter(range => range.manual).length
  };
}

module.exports = {
  findReferenceSections,
  inspectReferenceSections,
  prepareWithoutReferences
};
