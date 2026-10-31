"use strict";

const crypto = require("node:crypto");

// Word small-caps headings are exported as a full-size capital followed by a
// separately positioned run of smaller capitals. PDF.js canonical extraction
// therefore yields "L IST OF R EFERENCES:" or "G ENERATIVE AI USE ...".
// Canonical offsets must not change, so heading recognition (never the
// source text) also tests a defragmented copy of the visual line.
function defragmentSmallCaps(value) {
  return String(value ?? "").replace(/(^|[^\p{L}\p{N}])(\p{Lu}) (?=\p{L}{2,})/gu, "$1$2");
}
// Letter-spaced headings ("R E F E R E N C E S", "W O R K S  C I T E D"):
// single letters separated by single spaces, words separated by wider gaps.
function collapseLetterSpacing(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:\p{L} )+\p{L}[.:]?$|^(?:\p{L} )+\p{L}(?:\s{2,}(?:\p{L} )+\p{L})+[.:]?$/u.test(text)) return text;
  return text.split(/\s{2,}/u).map(word => word.replace(/ /gu, "")).join(" ");
}
function fragmentTolerant(pattern) {
  return {
    source: pattern.source,
    test: value => pattern.test(String(value ?? "")) ||
      pattern.test(defragmentSmallCaps(value)) ||
      pattern.test(collapseLetterSpacing(value))
  };
}

// Bibliography heading vocabulary (APA, Harvard, Chicago, MLA, IEEE,
// Vancouver, OSCOLA and common course variants, plus the main languages the
// service receives). Optional "6.", "6.0", "Chapter 6:" prefixes and a
// trailing period / colon. The whole line must be the heading.
const REFERENCE_HEADING_WORDS = "harvard\\s+reference\\s+list|apa\\s+reference\\s+list|list\\s+of\\s+(?:references?|sources|works\\s+cited)|reference\\s+list|references?(?:\\s+(?:and|&)\\s+bibliography)?|references?\\s+cited|reference\\s+sources|bibliography(?:\\s+(?:and|&)\\s+references?)?|annotated\\s+bibliography|works\\s+cited|works\\s+consulted|sources(?:\\s+(?:cited|consulted|used))?|literature\\s+cited|citations|further\\s+reading|table\\s+of\\s+cases|table\\s+of\\s+legislation|table\\s+of\\s+authorities|marejeleo|referencias|bibliograf[ií]a|r[eé]f[eé]rences|bibliographie|literaturverzeichnis|quellenverzeichnis|referências";
const REFERENCE_HEADING_PREFIX = "(?:(?:chapter|section|part)\\s+\\d{1,3}\\s*[:.\\-]?\\s+|\\d{1,3}(?:\\.\\d{1,2})*[.)]?\\s+)?";
const REFERENCE_HEADING = fragmentTolerant(new RegExp("^" + REFERENCE_HEADING_PREFIX + "(?:" + REFERENCE_HEADING_WORDS + ")\\s*[.:]?\\s*$", "iu"));
const KNOWN_TERMINATOR = fragmentTolerant(/^(?:\d{1,3}[.)]\s+)?(?:(?:appendix|appendices|glossary|acknowledgements?|acknowledgments?|exhibits|(?:generative\s+)?ai\s+(?:use|usage|assistance|tools?)\s+(?:declaration|statement|acknowledg(?:e)?ment|disclosure))(?:\s*:\s*[^\n]*)?(?:\s+.*)?|(?:tables?|figures?|charts?)(?:\s+\d+.*)?)\s*:?\s*$/i);
const STRUCTURAL_FOLLOWER = /^(?:date|context|children|apst|purpose|overview|learning objectives|introduction|background|stimulus behaviour|strategies used|reflection|references|appendix|appendices|table of contents)\s*:?\s*$|^\d+(?:\.\d+)*[.)]?\s+[A-Z]/i;

const SECTION_STOPWORDS = new Set([
  "a","an","and","as","at","by","for","from","in","into","of","on","or",
  "the","to","with","without","vs","versus"
]);
const COMMON_SECTION_HEADING = fragmentTolerant(/^(?:cyber security(?:\s*&\s*data privacy)?|abstract|introduction(?:\s+(?:of|to)\b.*)?|background|overview(?:\s+of\b.*)?|basic overview(?:\s+of\b.*)?|purpose|objective(?:s)?|literature review|related work|method(?:s|ology)?|results?|discussion|conclusion|summary|police|courts|corrections|structure of\b.*|origin of\b.*|current issues and concerns|legal philosophy|type of system|alternatives to incarceration|handling juveniles|guiding children(?:['’]s)? behaviour|teaching resources(?:,?\s+strategies)?(?:\s+and transitions)?|main point\s+\d+|chapter\s+\d+.*|part\s+\d+.*)$/i);
const REFERENCE_ENTRY_START = /^(?:\[\d+\]\s*)?(?:[A-Z][\p{L}'’.-]{1,50},\s*[A-Z]|\S.{0,100}\((?:19|20)\d{2}[a-z]?\)\s*[.,]|https?:\/\/|www\.|doi\s*:)/u;

function lineRecords(source, layoutDocument = null) {
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

  // Attach PDF-layout evidence to each canonical visual line. This lets the
  // bibliography detector distinguish a hanging-indent citation continuation
  // from a genuine new prose paragraph without changing canonical text offsets.
  const items = [];
  for (const page of layoutDocument?.pages || []) {
    for (const item of page.items || []) {
      if (!Number.isInteger(item?.start) || !Number.isInteger(item?.end) ||
          item.end <= item.start || !Number.isFinite(item.x) ||
          !Number.isFinite(item.y) || !Number.isFinite(item.height)) continue;
      items.push({
        start: item.start, end: item.end, x: item.x, y: item.y,
        height: item.height, pageNumber: Number(item.pageNumber || page.pageNumber || 0)
      });
    }
  }
  items.sort((a, b) => a.start - b.start);
  if (items.length) {
    let cursor = 0;
    for (const line of out) {
      const first = line.start + (line.text.match(/^\s*/u)?.[0].length || 0);
      while (cursor < items.length && items[cursor].end <= first) cursor++;
      const item = items[cursor];
      if (item && item.start <= first && first < item.end) {
        line.layoutX = item.x;
        line.layoutY = item.y;
        line.layoutHeight = item.height;
        line.layoutPage = item.pageNumber;
      } else if (item && item.start >= first && item.start <= line.end) {
        line.layoutX = item.x;
        line.layoutY = item.y;
        line.layoutHeight = item.height;
        line.layoutPage = item.pageNumber;
      }
    }
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

// Explicit labels for independent assignments, not generic publication titles.
// The following text must actually introduce prose, rather than a new citation.
function isIndependentAssignmentHeading(lines, index) {
  const text = String(lines[index]?.text || "").trim();
  // A new mini-case often begins with numbered questions and formula images,
  // not a prose paragraph. Recognize its explicit title only when the next
  // text is a question and the layout proves a separate section.
  if (/^mini[\s-]*case\s+\d{1,3}(?:\s*[:.\-]\s*[^\n]{1,80})?$/iu.test(text)) {
    const headingLine = lines[index];
    const next = lines.slice(index + 1).find(line => line.text.trim());
    const previous = lines.slice(0, index).reverse().find(line => line.text.trim());
    if (!next || !/^question\s+\d{1,3}\b/iu.test(next.text.trim())) return false;
    const startsNewPage = Number(headingLine?.layoutPage || 0) > 0 &&
      Number(previous?.layoutPage || 0) > 0 &&
      headingLine.layoutPage !== previous.layoutPage;
    const isCenteredHeading = Number.isFinite(headingLine?.layoutX) &&
      Number.isFinite(next.layoutX) && headingLine.layoutX >= next.layoutX + 45;
    return startsNewPage || isCenteredHeading;
  }
  if (!/^(?:Task\s+\d{1,3}(?:\s*[:.\-]\s*|\s+)[^\n]{3,90}|Study\s*:\s*[^\n]{3,75})$/iu.test(text)) return false;
  const subsequent = lines.slice(index + 1).filter(line => line.text.trim()).slice(0, 3);
  if (!subsequent.length || isReferenceEntryStart(subsequent[0].text)) return false;
  const prose = subsequent.map(line => line.text.trim()).join(" ");
  return looksLikeSubstantiveBody(prose) && prose.length >= 55;
}

function isLikelySectionHeading(lines, index, start, source) {
  const line = lines[index];
  const text = line.text.trim();
  if (!text || text.length < 3 || text.length > 100) return false;
  if (REFERENCE_HEADING.test(text) || KNOWN_TERMINATOR.test(text)) return false;
  // Task and Study headings can contain publication years, e.g. Study: Milgram (1963).
  if (isIndependentAssignmentHeading(lines, index)) return true;
  if (/^(?:https?:\/\/|doi\s*:|www\.)/i.test(text)) return false;
  if (/\b(?:19|20)\d{2}[a-z]?\b|https?:\/\/|doi\s*:/i.test(text)) return false;
  if (/^[A-Z][\p{L}'’.-]{1,50},\s/u.test(text)) return false;
  // Bibliographic publication titles sometimes resemble title-case section headings.
  if (/^(?:international\s+)?(?:journal\s+of\b|journal\b|proceedings\b|review\s+of\b)/iu.test(text)) return false;
  if (line.start < start + 24) return false;
  if (!hasReferenceEvidence(source.slice(start, line.start))) return false;

  let nextIndex = index + 1;
  while (nextIndex < lines.length && !lines[nextIndex].text.trim()) nextIndex++;
  const next = nextIndex < lines.length ? lines[nextIndex].text.trim() : "";
  const previousLine = index > 0 ? lines[index - 1] : null;
  const previous = previousLine?.text.trim() || "";
  const blankBefore = !previous;
  const blankAfter = nextIndex > index + 1 ||
    (index + 1 < lines.length && !lines[index + 1].text.trim());
  const nextLine = lines[nextIndex];
  const visualHeight = Math.max(Number(line.layoutHeight || 0), Number(previousLine?.layoutHeight || 0), Number(nextLine?.layoutHeight || 0), 1);
  const visualGapBefore = previousLine && line.layoutY !== undefined && previousLine.layoutY !== undefined
    ? Math.abs(line.layoutY - previousLine.layoutY) : 0;
  const visualGapAfter = nextLine && line.layoutY !== undefined && nextLine.layoutY !== undefined
    ? Math.abs(line.layoutY - nextLine.layoutY) : 0;
  const pageBreakBefore = Boolean(previousLine?.layoutPage && line.layoutPage &&
    previousLine.layoutPage !== line.layoutPage);
  const visualBreakBefore = Boolean(previousLine?.layoutPage && previousLine.layoutPage === line.layoutPage && visualGapBefore >= visualHeight * 1.5);
  const visualBreakAfter = Boolean(nextLine?.layoutPage && nextLine.layoutPage === line.layoutPage && visualGapAfter >= visualHeight * 1.35);
  const separatedVisually = visualBreakAfter;
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
  const meaningful = words.filter(word => !SECTION_STOPWORDS.has(word.toLowerCase()));
  const titleCase = meaningful.length > 0 && meaningful.every(word => /^\p{Lu}/u.test(word));
  const knownHeading = COMMON_SECTION_HEADING.test(text) ||
    /^\d+(?:\.\d+)*[.)]?\s+[A-Z]/u.test(text);
  const followsWithSubstantiveBody = looksLikeSubstantiveBody(next) || looksLikeUnheadedBodyLine(next);
  const headingShape = (knownHeading && (blankBefore || visualBreakBefore ||
      (pageBreakBefore && (/^(?:date|context|children|apst)\s*:/iu.test(next) ||
        STRUCTURAL_FOLLOWER.test(next) || followsWithSubstantiveBody)) ||
      KNOWN_TERMINATOR.test(text))) ||
    (titleCase && words.length <= 12 && (blankBefore || visualBreakBefore) &&
      (blankAfter || separatedVisually || followsWithSubstantiveBody));
  if (!headingShape || /[,:;]\s*$/.test(text) || !next) return false;
  // A DOI, URL, new reference entry, or citation metadata following the title
  // strongly suggests a wrapped bibliographic entry, not a new essay section.
  if (REFERENCE_ENTRY_START.test(next) || isReferenceEntryParagraph(next) ||
      /^(?:https?:\/\/|www\.|doi\b|(?:international\s+)?journal\s+of\b|(?:vol\.?|volume|pp?\.?|article\s+\d+)\b)/iu.test(next)) return false;
  return STRUCTURAL_FOLLOWER.test(next) || next.length >= 18;
}

function isReferenceEntryStart(value) {
  const raw = String(value || "").replace(/\s+/gu, " ").trim();
  // A stray opening quote (pasted entry) or an MLA title-first entry.
  const text = raw.replace(/^[‘’'"“”]+/u, "");
  if (!text || /^(?:\[\d+\]\s*)?(?:https?:\/\/|www\.|doi\s*:)/iu.test(text)) return false;

  // MLA title-first entry: a quoted title, then the container and a year/URL.
  if (/^["“‘'][^"”’']{3,200}["”’']\.?\s+[A-Z]/u.test(raw) &&
      /\b(?:19|20)\d{2}\b|https?:\/\/|www\.|doi/iu.test(raw)) return true;

  // Chicago bibliography / MLA with the year outside parentheses, including
  // corporate authors: "World Health Organization. Musculoskeletal Health.
  // Geneva: WHO, 2021." / "Elliott, Anthony. The Routledge Companion ... 2010."
  if (/^(?:[\p{Lu}][\p{L}\p{M}&'’.-]*\s+){1,8}[\p{Lu}][\p{L}\p{M}&'’.-]*\.\s+[\p{Lu}][^\n]{5,}?(?:,\s*|\(|\s)(?:19|20)\d{2}[a-z]?(?:[.):;,]|$)/u.test(text) &&
      !/\b(?:I|we|my|our)\b/u.test(text.split(". ")[0])) return true;

  // Vancouver: "1. Brophy RH, Fillingham YA. Title..." (initials without periods;
  // the year usually wraps to a later line).
  if (/^\d{1,3}\.\s+[\p{Lu}][\p{L}\p{M}'’-]+(?:\s+[\p{Lu}][\p{L}\p{M}'’-]+)?\s+[A-Z]{1,3}(?:,\s+[\p{Lu}][\p{L}\p{M}'’-]+\s+[A-Z]{1,3})*(?:,\s+et\s+al)?\.\s+[\p{Lu}]/u.test(text)) return true;

  // OSCOLA (law): cases, statutes, books, journal articles.
  if (/^[\p{Lu}][\p{L}\p{M}'’-]+(?:\s+[\p{Lu}][\p{L}\p{M}'’.-]+){1,3},\s+['‘"“][\p{Lu}]/u.test(text)) return true; // Emily Jackson, 'Informed consent...'

  if (/\bv\.?\s+[\p{Lu}][^\n]{0,120}?[\[(](?:19|20)\d{2}[\])]/u.test(text)) return true;           // Donoghue v Stevenson [1932] AC 562
  if (/^[\p{Lu}][^\n]{2,100}?\b(?:Act|Regulations|Order|Rules|Code|Convention|Directive|Treaty)\s+(?:19|20)\d{2}\b/u.test(text)) return true; // Human Rights Act 1998, s 6
  if (/\((?:\d+(?:st|nd|rd|th)\s+edn?,?\s+)?[^()]{0,80}?\b(?:19|20)\d{2}\)\.?$/u.test(text) && /^[\p{Lu}][\p{L}\p{M}'’-]+\s+[\p{Lu}]/u.test(text)) return true; // Jonathan Herring, Medical Law (9th edn, OUP 2022).
  if (/\((?:19|20)\d{2}\)\s+\d{1,4}\s+[\p{Lu}]/u.test(text) || /\[(?:19|20)\d{2}\]\s+(?:\d+\s+)?[A-Z]{2,6}\b/u.test(text)) return true; // (2009) 17 Medical Law Review 76 / [2015] UKSC 11

  // Conventional author-first entries, including personal author lists.
  if (/^(?:\[\d+\]\s*)?[A-Z][\p{L}'’.-]{1,50},\s*(?:[A-Z]\.?|[A-Z][\p{L}'’.-]+)\b/u.test(text)) return true;

  // Corporate/institutional authors may contain internal periods ("U.S.")
  // before the date. Match the period directly attached to a publication year
  // rather than stopping at the first abbreviation period.
  if (/^.{2,140}\.\s*\((?:(?:19|20)\d{2}[a-z]?(?:,\s*[^)]*)?|n\.\s*d\.(?:-[a-z])?)\)/iu.test(text)) return true;

  // Harvard corporate authors need not put a period before the date:
  // British Psychological Society (2021) BPS Code of Human Research Ethics.
  if (/^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,9}\s+\((?:(?:19|20)\d{2}[a-z]?|n\.\s*d\.(?:-[a-z])?)\)\s+\S/iu.test(text)) return true;

  // Institutional Harvard authors often have no period before the date, may
  // include a comma in their name, and may use n.d.-a / n.d.-b suffixes.
  // Restrict this shape to title-case name tokens to avoid absorbing prose.
  if (/^[\p{Lu}][\p{L}\p{M}\p{N}&.'’\-]{1,60}(?:\s+(?:of|and|for|the|[\p{Lu}][\p{L}\p{M}\p{N}&.'’\-]{1,60})|,\s*[\p{Lu}][\p{L}\p{M}\p{N}&.'’\-]{1,60}){1,15}\s+\((?:(?:19|20)\d{2}[a-z]?|n\.\s*d\.(?:-[a-z])?)\)\s+\S/iu.test(text)) return true;
  // Legal company suffixes are lower-case in many Harvard bibliographies.
  // This covers, for example, Greggs plc (2026), without treating prose as an author.
  if (/^[\p{Lu}][\p{L}\p{M}\p{N}&.'’\-]{1,60}\s+(?:plc|ltd|inc\.?|llc)\s+\((?:(?:19|20)\d{2}[a-z]?|n\.\s*d\.(?:-[a-z])?)\)\s+\S/iu.test(text)) return true;
  // Single-token institutional/organization author, e.g. StataCorp (n.d.-a).
  if (/^[\p{Lu}][\p{L}\p{M}\p{N}&]{2,65}\s+\((?:(?:19|20)\d{2}[a-z]?|n\.\s*d\.(?:-[a-z])?)\)\s+\S/iu.test(text)) return true;

  // Chicago-style references commonly place the year outside parentheses.
  if (/^.{2,140}\.\s+(?:19|20)\d{2}[a-z]?\.\s/u.test(text)) return true;

  // Chicago author-year citations place the year immediately after an author
  // name without a preceding period (e.g. "Elliott, Anthony. 2010.").
  if (/^[\p{Lu}][\p{L}\p{M}'’.-]+,\s+.{2,130}?\.\s+(?:19|20)\d{2}[a-z]?\.\s/u.test(text)) return true;

  // IEEE-style numbered references may wrap the publication year / DOI
  // onto a later visual line. Recognize the distinctive initial-plus-surname
  // author list without requiring citation metadata on the FIRST line.
  // Restrict this shape to bracketed numbers plus author punctuation; a
  // numbered question or ordinary list item must not be treated as a citation.
  if (/^\[\d{1,3}\]\s+(?:[A-Z]\.\s*){1,3}[\p{Lu}][\p{L}\p{M}'’-]+(?:\s+[\p{Lu}][\p{L}\p{M}'’-]+){0,3}(?:,|\s+and\s+[A-Z]\.)/u.test(text)) return true;

  // Numbered references are common in technical and medical documents.
  if (/^(?:\[\d+\]|\d+[.)])\s+.{8,}/u.test(text) &&
      /\b(?:19|20)\d{2}[a-z]?\b|https?:\/\/|doi\b/iu.test(text)) return true;

  return false;
}

function isReferenceEntryParagraph(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (!text) return false;
  if (/^(?:\[\d+\]\s*)?(?:https?:\/\/|www\.|doi\s*:)/iu.test(text)) return true;
  if (/\b(?:https?:\/\/|doi\s*:\s*10\.\d{4,9}\/)/iu.test(text)) return true;
  return isReferenceEntryStart(text);
}

function looksLikeReferenceContinuation(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (!text) return true;
  if (/^(?:https?:\/\/|www\.|doi\s*:)/iu.test(text)) return true;
  if (/^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:19|20)\d{2}\b/iu.test(text)) return true;
  if (/^(?:(?:international\s+)?journal(?:\s+of)?|proceedings|university|institute|volume|vol\.?|issue|no\.?|pp?\.?|edition|publisher|retrieved(?: from)?|available at|doi\b|https?:|www\.)/iu.test(text)) return true;
  // A justified APA citation can wrap without a hanging indent. Translator,
  // editor and publication-number metadata are strong citation continuation
  // evidence even when abbreviations contain ". Capitalized" punctuation.
  if (/(?:\([^)]{0,110}\b(?:Trans|Eds?|Publication\s+No)\.[^)]*\)|\[(?:Doctoral\s+dissertation|Master(?:'s|’s)?\s+thesis)\b[^\]]*\])/iu.test(text)) return true;
  if (/^(?:dissertation|thesis),\s+.{6,180}\]\.?\s+[A-Z][^\n]{5,180}$/iu.test(text)) return true;
  if (/^\d+\s*[-–]\s*\d+\s*\.?$/u.test(text)) return true;
  if (/^[a-z]/u.test(text) && text.length <= 180 && !/[.!?]\s+[A-Z]/u.test(text)) return true;
  if (/^(?:annual report|form 10-k|year ended|article\s+\d+|review of|edited by|translated by|edited\b|in\s+.+\(\s*eds?\.?\))/iu.test(text)) return true;
  return false;
}

function looksLikeSubstantiveBody(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || [];
  if (words.length >= 8 && /\b(?:the|and|but|because|this|that|these|those|is|are|was|were|has|have|serves|shows|explains|discusses|compares|argues|suggests|provides|examines|demonstrates|remains|continues|includes|contains|while|which|who|when|where|with|from|into|their|they|we|it)\b/iu.test(text)) return true;
  return words.length >= 16;
}

// Text found between two reference entries is bibliographic when it carries
// citation metadata and contains no genuine prose sentence. A wrapped title
// / journal / DOI line (e.g. "(CPPD) disease: a review. Open access
// rheumatology: research and reviews, 33-41. https://doi.org/...") must not
// be mistaken for substantive writing just because it contains "and".
const CITATION_METADATA = /https?:\/\/|\bwww\.|\bdoi\s*:|\b10\.\d{4,9}\/|\b\d+\s*\(\s*\d+(?:[-–]\d+)?\s*\)|\b\d+\s*[-–]\s*\d+\b|\bpp?\.\s*\d|\((?:19|20)\d{2}[a-z]?\)|\b(?:journal|press|publishing|publishers?|proceedings|vol\.|edition|ed\.|eds?\.|retrieved|available at|statpearls|university)\b/iu;
function isBibliographicGap(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (!text || !CITATION_METADATA.test(text)) return false;
  const sentences = text.split(/(?<=[.!?])\s+(?=[\p{Lu}])/u);
  // A real prose sentence: long, and itself free of citation metadata.
  return !sentences.some(sentence => {
    const words = sentence.match(/[\p{L}][\p{L}'’-]*/gu) || [];
    return words.length >= 12 && !CITATION_METADATA.test(sentence);
  });
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

// A reference list can end mid-page, with substantial whitespace before a
// new unheaded paragraph.  Detect the transition using actual PDF geometry.
// The start must be a complete prose sentence after bibliographic metadata;
// this is used for an admin REVIEW, never an automatic exclusion.
function isStrongPostReferenceProse(lines, index, previousLine, activeEntryLine) {
  const line = lines[index];
  const text = String(line?.text || "").trim();
  if (!line || !previousLine || !activeEntryLine ||
      isReferenceEntryStart(text) || looksLikeReferenceContinuation(text) ||
      !/^[A-Z][a-z]/u.test(text)) return false;
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length < 9 ||
      !/\b(?:plays?|demonstrates?|shows?|explains?|argues?|provides?|influences?|supports?|requires?|creates?|promotes?|encourages?|enables?|prioritizes?|examines?|helps?|sets?|involves?|affects?)\b/iu.test(text)) return false;
  const next = lines.slice(index + 1).find(item => item.text.trim());
  if (!next || next.text.trim().length < 25 ||
      isReferenceEntryStart(next.text.trim()) ||
      /^(?:https?:\/\/|www\.|doi\s*:)/iu.test(next.text.trim())) return false;
  const pageGap = Number(line.layoutPage || 0) !== Number(previousLine.layoutPage || 0) &&
    Number(line.layoutPage || 0) > 0 && Number(previousLine.layoutPage || 0) > 0;
  const height = Math.max(Number(line.layoutHeight || 0), Number(previousLine.layoutHeight || 0), 1);
  const hugeSamePageGap = Number(line.layoutPage || 0) > 0 &&
    line.layoutPage === previousLine.layoutPage &&
    Number.isFinite(line.layoutY) && Number.isFinite(previousLine.layoutY) &&
    Math.abs(line.layoutY - previousLine.layoutY) >= height * 4;
  if (!pageGap && !hugeSamePageGap) return false;
  const precedingText = previousLine.text.trim();
  if (!/(?:https?:\/\/|doi\b|\bAvailable at\b|\d[.)]\s*$)/iu.test(precedingText)) return false;
  return !isVisualReferenceContinuation(line, previousLine, activeEntryLine);
}

function isPageMarkerLine(line) {
  return /^(?:\d{1,4}|Page\s+\d{1,4}(?:\s+of\s+\d{1,4})?)$/iu.test(String(line?.text || "").trim());
}

function buildReviewCandidates(source, start, lines, firstCandidateOffset) {
  const offsets = [];
  const add = offset => {
    if (!Number.isInteger(offset) || offset <= start || offset >= source.length) return;
    if (!offsets.includes(offset)) offsets.push(offset);
  };
  let entries = 0;
  let activeEntryLine = null;
  let previousNonblankLine = lines.find(line => line.start <= start && start <= line.end) || null;
  // An unheaded essay may restart on the page after a long bibliography.
  // Check the detector's original ambiguous offset for sustained prose;
  // offer it for manual approval, but never silently choose it.
  const candidateIndex = lines.findIndex(line => line.start === firstCandidateOffset);
  if (candidateIndex > 0) {
    const candidate = lines[candidateIndex];
    const prior = lines.slice(0, candidateIndex).reverse().find(line => line.text.trim() && !isPageMarkerLine(line));
    const next = lines.slice(candidateIndex + 1).find(line => line.text.trim() && !isPageMarkerLine(line));
    const samePageGap = prior && candidate.layoutPage && candidate.layoutPage === prior.layoutPage &&
      Number.isFinite(candidate.layoutY) && Number.isFinite(prior.layoutY) &&
      Math.abs(candidate.layoutY - prior.layoutY) >=
        4 * Math.max(Number(candidate.layoutHeight || 0), Number(prior.layoutHeight || 0), 1);
    const referencesBefore = lines.slice(0, candidateIndex)
      .filter(line => line.start > start && isReferenceEntryStart(line.text)).length;
    const lineText = candidate.text.trim();
    const pageBreak = prior && candidate.layoutPage && prior.layoutPage &&
      candidate.layoutPage !== prior.layoutPage;
    const blankBefore = !lines[candidateIndex - 1].text.trim();
    const wordCount = (lineText.match(/[\p{L}\p{N}]+/gu) || []).length;
    const textLooksLikeProse = (looksLikeSubstantiveBody(lineText) || wordCount >= 10) &&
      /^[A-Z][a-z]/u.test(lineText) &&
      /\b(?:plays?|demonstrates?|shows?|explains?|argues?|provides?|influences?|supports?|requires?|creates?|promotes?|encourages?|enables?|prioritizes?|examines?|helps?)\b/iu.test(lineText);
    if (referencesBefore >= 2 && (pageBreak || blankBefore || samePageGap) &&
        textLooksLikeProse &&
        !isReferenceEntryStart(lineText) &&
        !looksLikeReferenceContinuation(lineText) &&
        next && next.text.trim().length >= 25 &&
        !isReferenceEntryStart(next.text.trim())) {
      add(candidate.start);
      return offsets.map((offset, index) => ({
        id: index + 1, offset, preview: candidatePreview(source, offset)
      }));
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.start <= start || !line.text.trim()) continue;
    const text = line.text.trim();
    if (isPageMarkerLine(line)) continue;
    if (REFERENCE_HEADING.test(text)) break;

    // First identify new reference entries and their continuation lines.
    // Do not test headings before this: a cited work may itself be titled "Introduction".
    if (isReferenceEntryStart(text)) {
      entries++;
      activeEntryLine = line;
      previousNonblankLine = line;
      continue;
    }
    // Never mistake a known end-of-bibliography section for an entry continuation.
    if (entries > 0 && KNOWN_TERMINATOR.test(text)) {
      add(line.start);
      break;
    }
    // After a real visual/structural break, a section heading takes priority.
    // Citation titles like "Introduction to..." without a break remain continuations.
    if (isLikelySectionHeading(lines, i, start, source)) {
      if (entries > 0) {
        add(line.start);
        break;
      }
      previousNonblankLine = line;
      continue;
    }

    if (entries >= 2 &&
        isStrongPostReferenceProse(lines, i, previousNonblankLine, activeEntryLine)) {
      add(line.start);
      break;
    }

    if (entries > 0 &&
        (looksLikeReferenceContinuation(text) ||
         isVisualReferenceContinuation(line, previousNonblankLine, activeEntryLine))) {
      previousNonblankLine = line;
      continue;
    }

    const baselineGap = previousNonblankLine &&
      Number.isFinite(line.layoutY) && Number.isFinite(previousNonblankLine.layoutY)
      ? Math.abs(line.layoutY - previousNonblankLine.layoutY) : 0;
    const lineHeight = Math.max(Number(line.layoutHeight || 0), Number(previousNonblankLine?.layoutHeight || 0), 1);
    const visualParagraphBreak = Boolean(line.layoutPage && line.layoutPage === previousNonblankLine?.layoutPage &&
      baselineGap >= lineHeight * 1.5);
    // Do not offer a publisher/title fragment as the beginning of body text.
    // Prose must start like an independent paragraph and not lead straight
    // into another citation. Ambiguous lines have no clickable resume point.
    const nextText = lines.slice(i + 1).find(record => record.text.trim())?.text.trim() || "";
    const nextIsCitation = isReferenceEntryStart(nextText) ||
      /^(?:https?:\/\/|www\.|doi\s*:)/iu.test(nextText);
    if (entries > 0 && visualParagraphBreak &&
        looksLikeUnheadedBodyLine(text) &&
        !looksLikeReferenceContinuation(text) &&
        !isVisualReferenceContinuation(line, previousNonblankLine, activeEntryLine) &&
        !nextIsCitation) {
      add(line.start);
      break;
    }

    previousNonblankLine = line;
  }

  // Never offer an arbitrary first ambiguous offset. An empty option list is
  // safer than allowing the admin to resume inside a citation or URL.
  return offsets.slice(0, 3).map((offset, index) => ({
    id: index + 1,
    offset,
    preview: candidatePreview(source, offset)
  }));
}

function isVisualReferenceContinuation(line, previousLine, entryLine) {
  if (!line || !previousLine) return false;
  if (!Number.isFinite(line.layoutY) || !Number.isFinite(previousLine.layoutY) ||
      !Number.isFinite(line.layoutHeight) || !Number.isFinite(previousLine.layoutHeight) ||
      !line.layoutPage || line.layoutPage !== previousLine.layoutPage) return false;

  const baselineGap = Math.abs(previousLine.layoutY - line.layoutY);
  const lineHeight = Math.max(line.layoutHeight, previousLine.layoutHeight, 1);
  const text = line.text.trim();
  const previous = previousLine.text.trim();
  const firstEntryX = Number.isFinite(entryLine?.layoutX) ? entryLine.layoutX : null;
  const hangingIndent = firstEntryX !== null && Number.isFinite(line.layoutX) &&
    line.layoutX >= firstEntryX + Math.max(3.5, lineHeight * 0.3);
  const previousIsOpen = /(?:[,;:]|\b(?:in|of|and|for|with|from|by|the|a|an|to|on|at|as|ended|including|edited|translated|vol\.?|issue|pp\.?)|[-–—])\s*$/iu.test(previous);
  const conventionalContinuation = /^(?:and\b|or\b|of\b|in\b|for\b|with\b|from\b|by\b|the\b|a\b|an\b|to\b|on\b|at\b|as\b|edited\s+by\b|translated\s+by\b|journal\b|proceedings\b|university\b|institute\b|volume\b|vol\.?\b|issue\b|no\.?\b|pp?\.?\b|pages?\b|publisher\b|retrieved\b|available\b|doi\b|https?:|www\.)/iu.test(text);
  // Preserve the original ordinary-spacing evidence that passed earlier
  // boundary regressions. Allow double-spaced lines only with the stronger
  // positive proof of a hanging indent belonging to an active citation.
  if (hangingIndent && baselineGap <= lineHeight * 3.25) return true;
  if (baselineGap > lineHeight * 1.6) return false;
  const normalLineStep = baselineGap <= lineHeight * 1.35;
  return hangingIndent || previousIsOpen || conventionalContinuation || normalLineStep;
}

// An IEEE reference often occupies multiple *double-spaced* visual lines.
// Recognize only bibliographic continuation evidence inside a live numbered
// author entry. Never infer a continuation past a complete terminal year/DOI,
// over a page gap, or into a new heading or reference entry.
function isIeeeWrappedCitationContinuation(line, previousLine, activeEntryLine) {
  const active = String(activeEntryLine?.text || "").trim();
  const value = String(line?.text || "").trim();
  const preceding = String(previousLine?.text || "").trim();
  if (!/^\[\d{1,3}\]\s+(?:[A-Z]\.\s*){1,3}[\p{Lu}]/u.test(active) ||
      !value || !previousLine || !line ||
      isReferenceEntryStart(value) || REFERENCE_HEADING.test(value) ||
      KNOWN_TERMINATOR.test(value) || COMMON_SECTION_HEADING.test(value) ||
      STRUCTURAL_FOLLOWER.test(value)) return false;
  if (Number(line.layoutPage || 0) <= 0 || line.layoutPage !== previousLine.layoutPage ||
      !Number.isFinite(line.layoutY) || !Number.isFinite(previousLine.layoutY)) return false;
  const height = Math.max(Number(line.layoutHeight || 0), Number(previousLine.layoutHeight || 0), 1);
  if (Math.abs(line.layoutY - previousLine.layoutY) > height * 3.25) return false;
  // Once the previous line closes with a year (or completed DOI), the next
  // prose paragraph cannot be silently absorbed into the bibliography.
  if (/(?:19|20)\d{2}[a-z]?\.\s*$/iu.test(preceding) ||
      /(?:https?:\/\/\S+|10\.\d{4,9}\/\S+)\.?\s*$/iu.test(preceding)) return false;
  return /(?:\b(?:19|20)\d{2}\b|(?:\b(?:vol|pp|doi|proc|art|no|conf|technol)\s*\.?\b)|[”"]\s*,?|^10\.\d{4,9}\/)/iu.test(value);
}

function inspectBoundary(source, start, lines) {
  const index = lines.findIndex(line => line.start <= start && start <= line.end);
  if (index < 0) {
    return {status: "REVIEW", reason: "The reference heading could not be located safely.", candidateOffset: null, entriesFound: 0};
  }
  let entriesFound = 0;
  let firstCandidate = null;
  let activeEntryLine = null;
  let previousNonblankLine = lines[index];

  // A citation can span many extracted PDF visual lines or cross a page.
  // Do not raise a review at the FIRST unfamiliar line: keep examining
  // subsequent reference entries and an independently recognizable boundary.
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    const text = line.text.trim();
    if (!text || /^(?:\d{1,4}|Page\s+\d{1,4}(?:\s+of\s+\d{1,4})?)$/iu.test(text)) continue;

    // A wrapped continuation line can itself begin like a citation
    // ("Østerås, N. (2024). EULAR recommendations..."). With a hanging indent
    // it sits at the continuation x, not the entry x: keep it in the entry.
    const indentedContinuation = Boolean(activeEntryLine && previousNonblankLine &&
      Number.isFinite(line.layoutX) && Number.isFinite(activeEntryLine.layoutX) &&
      line.layoutPage && line.layoutPage === previousNonblankLine.layoutPage &&
      line.layoutX >= activeEntryLine.layoutX + Math.max(3.5, Number(line.layoutHeight || 0) * 0.3) &&
      Number.isFinite(line.layoutY) && Number.isFinite(previousNonblankLine.layoutY) &&
      Math.abs(line.layoutY - previousNonblankLine.layoutY) <=
        Math.max(Number(line.layoutHeight || 0), Number(previousNonblankLine.layoutHeight || 0), 1) * 3.25);
    if (indentedContinuation && !KNOWN_TERMINATOR.test(text)) {
      previousNonblankLine = line;
      continue;
    }

    // Numbered lists (Vancouver, numbered APA): the next consecutive number
    // after a recognized numbered entry starts the next entry, even when the
    // year wraps to a later line.
    const sequentialNumbered = Boolean(activeEntryLine && (() => {
      const prev = /^(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s/u.exec(String(activeEntryLine.text || "").trim());
      const cur = /^(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+\S/u.exec(text);
      if (!prev || !cur) return false;
      return Number(prev[1] ?? prev[2]) + 1 === Number(cur[1] ?? cur[2]);
    })());

    if (isReferenceEntryStart(text) || sequentialNumbered) {
      // A substantial, unexplained paragraph between citation entries might
      // be a genuine body section. Never silently swallow it just because
      // another citation follows. Request review instead.
      if (firstCandidate !== null &&
          looksLikeSubstantiveBody(source.slice(firstCandidate, line.start)) &&
          !isBibliographicGap(source.slice(firstCandidate, line.start))) {
        return {
          status: "REVIEW",
          reason: "Potential substantive writing occurs between reference entries.",
          candidateOffset: firstCandidate, entriesFound
        };
      }
      entriesFound++;
      activeEntryLine = line;
      previousNonblankLine = line;
      // A brief unrecognized fragment between consecutive entries is
      // consistent with wrapped bibliographic metadata, not proof of prose.
      if (firstCandidate !== null) firstCandidate = null;
      continue;
    }

    // The appendix/glossary belongs to the ORIGINAL document and resumes
    // analysis. It is never removed from the report or original file.
    if (entriesFound > 0 && KNOWN_TERMINATOR.test(text)) {
      if (firstCandidate !== null && entriesFound < 2) {
        return {status: "REVIEW", reason: "Insufficient evidence to resolve the final reference continuation before the following section.", candidateOffset: firstCandidate, entriesFound};
      }
      return {status: "AUTO", end: line.start, reason: "Recognized section terminator.", entriesFound};
    }

    // A hanging-indented citation title can look like a title-case heading.
    // Check the strong active-entry continuation geometry BEFORE deciding
    // that a bibliographic title starts a new academic section.
    if (entriesFound > 0 &&
        !KNOWN_TERMINATOR.test(text) &&
        !COMMON_SECTION_HEADING.test(text) &&
        !STRUCTURAL_FOLLOWER.test(text) &&
        !isReferenceEntryStart(text) &&
        isVisualReferenceContinuation(line, previousNonblankLine, activeEntryLine) &&
        Number.isFinite(line.layoutX) &&
        Number.isFinite(activeEntryLine?.layoutX) &&
        line.layoutX >= activeEntryLine.layoutX +
          Math.max(3.5, Number(line.layoutHeight || 0) * 0.3)) {
      previousNonblankLine = line;
      continue;
    }

    if (entriesFound > 0 && isLikelySectionHeading(lines, i, start, source)) {
      // If an unresolved line immediately precedes a heading, do not
      // silently swallow a potentially substantive paragraph.
      if (firstCandidate !== null) {
        return {status: "REVIEW", reason: "Text between the last reference and the following heading remains ambiguous.", candidateOffset: firstCandidate, entriesFound};
      }
      return {status: "AUTO", end: line.start, reason: "Recognized following section.", entriesFound};
    }

    // A same-page multi-paragraph whitespace gap after the final DOI may
    // introduce new unheaded substantive writing, even with no blank lines.
    // Require administrator review at the EXACT first prose line.
    if (entriesFound >= 2 &&
        isStrongPostReferenceProse(lines, i, previousNonblankLine, activeEntryLine)) {
      return {status: "REVIEW",
        reason: "Substantive prose resumes after a large visual gap following references.",
        candidateOffset: line.start, entriesFound};
    }

    // Even when a new citation immediately follows, a long independent
    // prose sentence is not safe to erase as a bibliography continuation.
    // It may be a body segment separating two reference blocks.
    if (entriesFound > 0 && looksLikeUnheadedBodyLine(text)) {
      const nextText = lines.slice(i + 1).find(record => record.text.trim())?.text.trim() || "";
      if (isReferenceEntryStart(nextText)) {
        return {
          status: "REVIEW",
          reason: "A possible substantive paragraph appears before another reference entry.",
          candidateOffset: line.start, entriesFound
        };
      }
    }

    // A Chicago chapter title may begin in title case while the previous
    // citation line ends with "In". Keep the wrapped title with the reference.
    const preceding = String(previousNonblankLine?.text || "").trim();
    if (entriesFound > 0 &&
        /\b(?:in|of|and|for|with|from|by|the|a|an|to|at|as)\s*$/iu.test(preceding) &&
        !KNOWN_TERMINATOR.test(text) && !isReferenceEntryStart(text)) {
      previousNonblankLine = line;
      continue;
    }

    if (entriesFound > 0 &&
        (isIeeeWrappedCitationContinuation(line, previousNonblankLine, activeEntryLine) ||
         looksLikeReferenceContinuation(text) ||
         isVisualReferenceContinuation(line, previousNonblankLine, activeEntryLine))) {
      previousNonblankLine = line;
      continue;
    }

    if (entriesFound === 0 && isReferenceEntryParagraph(text)) {
      entriesFound++;
      activeEntryLine = line;
      previousNonblankLine = line;
      continue;
    }

    // A substantive paragraph without a heading can restart scanning,
    // provided the immediately following text does not indicate that the
    // paragraph is actually a wrapped reference title.
    const next = lines.slice(i + 1).find(record => record.text.trim())?.text.trim() || "";
    const nextIsBibliographic = Boolean(next &&
      (isReferenceEntryParagraph(next) ||
       /^(?:https?:\/\/|www\.|doi\b|(?:international\s+)?journal\s+of\b|vol\.?\b|pp?\.?\b)/iu.test(next)));
    if (entriesFound > 0 && !nextIsBibliographic &&
        (looksLikeUnheadedBodyLine(text) ||
         (looksLikeSubstantiveBody(text) && !looksLikeReferenceContinuation(text)))) {
      if (firstCandidate !== null) {
        return {status: "REVIEW", reason: "Substantive text may resume after an uncertain bibliography continuation.", candidateOffset: firstCandidate, entriesFound};
      }
      // Prose followed by further citation entries is mixed content: never
      // leave those later entries in the provider input silently.
      const upcoming = lines.slice(i + 1).filter(record => record.text.trim()).slice(0, 10);
      if (upcoming.some(record => isReferenceEntryStart(record.text.trim()))) {
        return {status: "REVIEW", reason: "Potential substantive writing occurs between reference entries.", candidateOffset: line.start, entriesFound};
      }
      return {status: "AUTO", end: line.start, reason: "Substantive prose resumes.", entriesFound};
    }

    // Unknown line: remember it, but do not interrupt a bibliography just
    // because one wrapped publisher/title/author line is unrecognized.
    if (firstCandidate === null) firstCandidate = line.start;
    previousNonblankLine = line;
  }

  if (entriesFound > 0 && firstCandidate === null) {
    return {status: "AUTO", end: source.length, reason: "Verified reference entries continue to end of document.", entriesFound};
  }

  if (entriesFound > 0 && firstCandidate !== null) {
    const tail = source.slice(firstCandidate);
    // The unresolved tail is itself citation text (e.g. a corporate Chicago
    // entry "World Health Organization. ... Geneva: WHO, 2021.").
    if (isBibliographicGap(tail)) {
      return {status: "AUTO", end: source.length, reason: "Bibliographic text continues to end of document.", entriesFound};
    }
    // Only short non-prose lines remain (word count, signature, "End").
    // They are neither references nor substantive writing: stop before them.
    const tailLines = tail.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
    const prose = tailLines.some(line => (line.match(/[\p{L}][\p{L}'’-]*/gu) || []).length >= 12 ||
      looksLikeUnheadedBodyLine(line));
    if (!prose && tailLines.length <= 6) {
      return {status: "AUTO", end: firstCandidate, reason: "Short non-prose lines follow the references.", entriesFound};
    }
  }

  return {
    status: "REVIEW",
    reason: entriesFound
      ? "The final bibliography continuation is ambiguous and has no verified ending."
      : "No recognizable reference entries or safe section boundary were found.",
    candidateOffset: firstCandidate,
    entriesFound
  };
}

// Repeated multi-page documents may appear after their own bibliography
// (for example a PDF with the entire slide deck appended a second time).
// Require three consecutive, materially populated pages matching an earlier
// triple before auto-resolving a replayed document boundary. A loose heading guess must
// never hide the first pages of the repeated document.
function replayedDocumentStart(start, lines, layoutDocument) {
  const pages = Array.isArray(layoutDocument?.pages) ? layoutDocument.pages : [];
  if (pages.length < 5) return null;
  const heading = lines.find(line => line.start <= start && start <= line.end);
  const headingPage = Number(heading?.layoutPage || 0);
  const index = pages.findIndex((page, i) =>
    Number(page?.pageNumber || i + 1) === headingPage);
  if (index < 3 || index + 3 >= pages.length) return null;
  const signatures = pages.map(page => (page?.items || [])
    .filter(item => Number.isInteger(item?.start) && typeof item?.text === "string")
    .sort((a, b) => a.start - b.start)
    .map(item => item.text.trim())
    .filter(text => text && !/^\d{1,4}$/u.test(text))
    .join(" ").replace(/\s+/gu, " ").toLowerCase().trim());
  const a = signatures[index + 1];
  const b = signatures[index + 2];
  const c = signatures[index + 3];
  // Three independent matching pages, not merely a shared title template.
  if (a.length < 70 || b.length < 100 || c.length < 70 ||
      a === b || a === c || b === c) return null;
  for (let prior = 0; prior + 2 < index; prior++) {
    if (signatures[prior] !== a || signatures[prior + 1] !== b ||
        signatures[prior + 2] !== c) continue;
    const offsets = (pages[index + 1].items || [])
      .map(item => item?.start).filter(Number.isInteger);
    if (!offsets.length) return null;
    const offset = Math.min(...offsets);
    if (offset > start) return offset;
  }
  return null;
}

function inspectReferenceSections(source, fallbackStart = -1, overrides = [], layoutDocument = null) {
  source = String(source || "");
  const lines = lineRecords(source, layoutDocument);
  const sourceTextSha256 = crypto.createHash("sha256").update(source, "utf8").digest("hex");
  const starts = [];
  const verifiedExplicitList = require("./jk-ai-reference-proof.cjs").verifiedListOfReferences(source,layoutDocument);
  const seen = new Set();
  const re = new RegExp("(^|\\n)[ \\t]*" + REFERENCE_HEADING_PREFIX + "(?:" + REFERENCE_HEADING_WORDS + ")[ \\t]*[.:]?[ \\t]*(?=\\r?\\n|$)", "gimu");
  let match;
  while ((match = re.exec(source))) {
    const start = match.index + match[1].length;
    if (hasReferenceEntryAfterHeading(source, start, lines)) starts.push(start);
  }
  // Same standalone headings when the PDF fragmented them (small caps,
  // per-letter runs). The heading line itself must still be nothing but a
  // recognized bibliography title, and real reference entries must follow.
  // Generic words ("Sources", "Further Reading", "Citations") also title
  // ordinary prose sections, so only an unmistakable bibliography heading
  // may fail closed when its entries are not recognized.
  const CORE_REFERENCE_HEADING = fragmentTolerant(new RegExp("^" + REFERENCE_HEADING_PREFIX +
    "(?:list\\s+of\\s+references?|reference\\s+list|references?(?:\\s+(?:and|&)\\s+bibliography)?|bibliography(?:\\s+(?:and|&)\\s+references?)?|works\\s+cited|marejeleo|referencias|bibliograf[ií]a|r[eé]f[eé]rences|bibliographie|literaturverzeichnis|referências)\\s*[.:]?\\s*$", "iu"));
  const unverifiedHeadings = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text || starts.includes(line.start) || !REFERENCE_HEADING.test(text)) continue;
    if (hasReferenceEntryAfterHeading(source, line.start, lines)) starts.push(line.start);
    else if (CORE_REFERENCE_HEADING.test(text)) unverifiedHeadings.push(line);
  }
  if (verifiedExplicitList && !starts.includes(verifiedExplicitList.start)) starts.push(verifiedExplicitList.start);
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

    // Independently verified named bibliography ending at a mandatory
    // declaration. The adjacent authored body sections remain untouched.
    if (verifiedExplicitList && verifiedExplicitList.start === start) {
      ranges.push({start, end: verifiedExplicitList.end, manual:false});
      excludedUntil = verifiedExplicitList.end;
      continue;
    }
    const replayStart = replayedDocumentStart(start, lines, layoutDocument);
    if (Number.isInteger(replayStart)) {
      ranges.push({start, end: replayStart, manual: false});
      excludedUntil = replayStart;
      continue;
    }

    const decision = inspectBoundary(source, start, lines);
    if (decision.status === "REVIEW") {
      const headingLine = lines.find(line => line.start <= start && start <= line.end);
      reviews.push({
        start,
        heading: (headingLine?.text || "References").trim().slice(0, 80),
        // Never allow a timeout to swallow another assignment and its references.
        hasFollowingReferenceSection: starts.some(otherStart => otherStart > start),
        hasFollowingSubstantiveSection: lines.some((record, index) =>
          record.start > start && isIndependentAssignmentHeading(lines, index)),
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

  // Fail closed: a late standalone bibliography heading followed by dense
  // publication evidence must never pass to a provider unexcluded simply
  // because its entry style was not recognized. Ask the administrator (the
  // existing ten-minute review fallback applies) instead of scanning it.
  for (const line of unverifiedHeadings) {
    if (line.start < source.length * 0.4 ||
        ranges.some(range => range.start <= line.start && line.start < range.end) ||
        reviews.some(review => review.start === line.start)) continue;
    const following = source.slice(line.end, Math.min(source.length, line.end + 2500));
    const years = (following.match(/\b(?:19|20)\d{2}[a-z]?\b/gu) || []).length;
    const links = (following.match(/https?:\/\/|\bdoi\s*:|\b10\.\d{4,9}\//giu) || []).length;
    if (years < 3 && links < 1) continue;
    reviews.push({
      start: line.start,
      heading: line.text.trim().slice(0, 80),
      hasFollowingReferenceSection: starts.some(otherStart => otherStart > line.start),
      hasFollowingSubstantiveSection: lines.some((record, index) =>
        record.start > line.start && isIndependentAssignmentHeading(lines, index)),
      sourceTextSha256,
      sourceLength: source.length,
      reason: "A bibliography heading was found but its reference entries were not recognized.",
      entriesFound: 0,
      candidates: buildReviewCandidates(source, line.start, lines, null)
    });
  }
  reviews.sort((a, b) => a.start - b.start);
  return {ranges, reviews, sourceTextSha256, sourceLength: source.length};
}

function findReferenceSections(source, fallbackStart = -1, layoutDocument = null) {
  return inspectReferenceSections(source, fallbackStart, [], layoutDocument).ranges;
}

function makeReferenceReviewError(review) {
  const error = new Error("Reference/bibliography boundary requires administrator review. No provider requests were made.");
  error.code = "REFERENCE_BOUNDARY_REVIEW_REQUIRED";
  error.apiBlocked = true;
  error.noProviderRequests = true;
  error.referenceReview = review;
  return error;
}

function prepareWithoutReferences(rawText, builder, fallbackStart = -1, overrides = [], layoutDocument = null) {
  const source = String(rawText || "");
  const inspection = inspectReferenceSections(source, fallbackStart, overrides, layoutDocument);
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
