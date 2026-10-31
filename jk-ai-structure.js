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
// Mixed first pages: require a short opening identity block, multiple metadata
// clues and a clear body boundary. Never infer a cover block from page number alone.
function openingCoverBlock(lines, page, source) {
  const narrative = /\b(?:reports|states|requires|supports|suggests|shows|explains|describes|indicates|believes|denies|argues|examines|discusses|investigates|analyzes|analyses|found|findings|results|concludes|demonstrates|provides|aims)\b/iu;
  const metadata = line => {
    const text = norm(line.text);
    if (words(text).length > 20 || narrative.test(text)) return false;
    return /^(?:student(?:\s+name)?|name|instructor|professor|faculty(?:\s+name)?|course|department|institution|assignment\s+due\s+date|due\s+date|date)\s*:/iu.test(text) ||
      /^(?:student\s+name|faculty\s+name|assignment\s+due\s+date)$/iu.test(text) ||
      /\b(?:university|college|school\s+of|department\s+of)\b/iu.test(text) ||
      /\b[A-Z]{2,8}\s*[- ]?\d{3,5}\b/u.test(text) ||
      /^(?:(?:Date|Due\s+Date):\s*)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}$/iu.test(text);
  };
  const candidates = lines.filter(l => l.y > page.height * 0.1 && l.y < page.height * 0.94 &&
    !/^\s*(?:\d+|Page\s+\d+(?:\s+of\s+\d+)?)\s*$/iu.test(l.text));
  // Canonical reading order must also agree with the page's vertical order.
  if (candidates.some((l, i) => i && l.y >= candidates[i - 1].y)) return [];
  const prefix = [];
  let boundary;
  for (let i = 0; i < candidates.length && i <= 12; i++) {
    const line = candidates[i], text = norm(line.text), count = words(text).length;
    const next = candidates[i + 1];
    const prose = !metadata(line) && (narrative.test(text) ||
      (count >= 8 && /[.!?]["'’”)]?\s*$/u.test(text)) ||
      (count >= 8 && next && !metadata(next) && count + words(next.text).length >= 20 &&
        Math.abs(line.x - next.x) <= 18 && line.y - next.y <= line.height * 3.5));
    if (prose || /^(?:abstract|introduction|background|discussion|subjective|objective)\s*:?$/iu.test(text)) {
      boundary = line; break;
    }
    // Short title/name lines may accompany metadata; uncertain text stops recognition.
    if (!line.isolated || !count || count > 24 ||
        (!metadata(line) && !titleLike(text) && !/^(?:Dr\.|Prof\.)\s+\p{Lu}[\p{L}\s.'’-]+$/u.test(text))) return [];
    prefix.push(line);
  }
  if (!boundary || prefix.length < 3 || prefix.length > 12 ||
      prefix.filter(metadata).length < 2 ||
      words(prefix.map(l => l.text).join(" ")).length > 160) return [];
  const last = prefix.at(-1);
  if (last.y - boundary.y < Math.max(last.height, boundary.height) * 1.5) return [];
  // The body boundary must lead into real prose, rather than another cover label.
  const tail = candidates.slice(candidates.indexOf(boundary), candidates.indexOf(boundary) + 4);
  if (!tail.some(l => !metadata(l) && words(l.text).length >= 8)) return [];
  return prefix;
}
// A dedicated essay cover can contain a supplied assignment question rather
// than an institution/student identity block. Exclude only a verifiable full
// cover page; never exclude a mixed first page containing original prose.
function standaloneEssayPromptCover(lines, page, pageCount) {
  if (pageCount < 2 || !Array.isArray(lines)) return null;
  const content = lines.filter(line =>
    line.y > page.height * 0.07 && line.y < page.height * 0.96 &&
    !/^\s*(?:\d+|Page\s+\d+(?:\s+of\s+\d+)?)\s*$/iu.test(line.text)
  );
  if (content.length < 6 || content.length > 20 ||
      content.some((line, i) => !line.isolated ||
        (i > 0 && line.y >= content[i - 1].y))) return null;

  const centered = line =>
    Math.abs(line.x + line.width / 2 - page.width / 2) <=
    Math.max(28, line.height * 3);
  const assignment = /^(?:(?:research|critical|reflective)\s+)?(?:essay|assignment|assessment|paper)\s*[-–—:]\s*(?:question|task)\s*(?:no\.?\s*)?[\dA-Z]+$/iu;
  const count = /^word\s*count\s*(?:\([^)]{0,90}\))?\s*:\s*\d[\d,]*(?:\s*words?)?$/iu;
  const date = /^(?:(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})$/iu;
  const taskAt = content.findIndex(line => assignment.test(norm(line.text)));
  const countAt = content.findIndex(line => count.test(norm(line.text)));
  const dateAt = content.findIndex(line => date.test(norm(line.text)));
  if (taskAt < 1 || taskAt > 3 || countAt < taskAt + 2 ||
      countAt > content.length - 2 || dateAt !== content.length - 1 ||
      dateAt !== countAt + 1) return null;

  const title = content.slice(0, taskAt);
  const questionLines = content.slice(taskAt + 1, countAt);
  const question = norm(questionLines.map(line => line.text).join(" "));
  if (!title.every(line => centered(line) &&
        words(line.text).length >= 1 && words(line.text).length <= 20) ||
      !centered(content[taskAt]) || !centered(content[countAt]) ||
      !centered(content[dateAt]) || questionLines.length > 10 ||
      words(content.map(line => line.text).join(" ")).length > 190 ||
      !/^(?:what|how|why|to what extent|in what ways)\b/iu.test(question) ||
      !/\?/u.test(question)) return null;

  // Require a genuinely separated question block followed by the two final
  // administrative lines. Even one extra essay paragraph invalidates this
  // full-page exclusion rather than silently discarding prose.
  if (content[taskAt].y - questionLines[0].y <
        Math.max(content[taskAt].height, questionLines[0].height) ||
      questionLines.at(-1).y - content[countAt].y <
        Math.max(questionLines.at(-1).height, content[countAt].height) * 1.4 ||
      content[countAt].y - content[dateAt].y <
        Math.max(content[countAt].height, content[dateAt].height)) return null;
  return {lines: content, wholePage: true};
}

// Recognise a common assessment cover with a course code and explicit word count.
// Only its centred identity block is excluded on mixed pages. A trailing quoted
// research question is excluded only when it completes a separate sparse cover.
function assessmentCoverBlock(lines, page, pageCount) {
  const content = lines.filter(l => l.y > page.height * 0.1 && l.y < page.height * 0.94 &&
    !/^\s*(?:\d+|Page\s+\d+(?:\s+of\s+\d+)?)\s*$/iu.test(l.text));
  if (content.length < 4 || content.some((l, i) => i && l.y >= content[i - 1].y)) return null;
  const centered = l => Math.abs(l.x + l.width / 2 - page.width / 2) <= Math.max(12, l.height * 1.8);
  const first = content.slice(0, 3);
  if (!first.every(l => l.isolated && centered(l)) || words(first[0].text).length < 4 ||
      words(first[0].text).length > 35 || !titleLike(norm(first[0].text)) ||
      !titleLike(norm(first[1].text)) || words(first[1].text).length < 2 || words(first[1].text).length > 6 ||
      !/^[A-Z]{2,8}\s*[- ]?\d{3,5}\b/u.test(norm(first[2].text)) ||
      !/\b(?:assessment|assignment|report|project|dissertation|thesis)\b/iu.test(first[2].text) ||
      words(first[2].text).length > 20) return null;
  if (!/^word\s+count\s*:\s*\d[\d,]*\b/iu.test(norm(content[3].text))) return null;
  const prefix = first.slice();
  let countText = "", end = 3;
  for (; end < Math.min(content.length, 6); end++) {
    const line = content[end];
    if (!line.isolated || !centered(line)) return null;
    countText += " " + norm(line.text); prefix.push(line);
    const opens = (countText.match(/\(/g) || []).length;
    const closes = (countText.match(/\)/g) || []).length;
    if (closes > opens) return null;
    if (opens === closes) { end++; break; }
  }
  if ((countText.match(/\(/g) || []).length !== (countText.match(/\)/g) || []).length ||
      !/^\s*word\s+count\s*:\s*\d[\d,]*(?:\s*\((?:including|excluding)\b[^()]{0,300}\))?\s*$/iu.test(countText) ||
      words(countText).length > 45) return null;
  for (let i = 1; i < prefix.length; i++) {
    const gap = prefix[i - 1].y - prefix[i].y;
    if (gap < prefix[i].height * 0.8 || gap > prefix[i].height * 5) return null;
  }
  const tail = content.slice(end);
  if (!tail.length) return { lines: prefix, wholePage: pageCount > 1 };
  const last = prefix.at(-1);
  if (last.y - tail[0].y < Math.max(last.height, tail[0].height) * 1.5) return null;
  const question = norm(tail.map(l => l.text).join(" "));
  const quotedQuestion = /^[“"](?:How|What|Why|To what extent|In what ways)\b[^.!?]{15,700}\?[”"]$/iu.test(question);
  const sparseQuestion = pageCount > 1 && tail.length <= 5 && quotedQuestion &&
    tail.every(l => l.isolated) && words(question).length <= 100 &&
    tail.every((l, i) => !i || (Math.abs(l.x - tail[i - 1].x) <= 18 &&
      tail[i - 1].y - l.y <= Math.max(l.height, tail[i - 1].height) * 3));
  return sparseQuestion ? { lines: content, wholePage: true } : { lines: prefix, wholePage: false };
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
    const essayPromptCover = p === 0 ? standaloneEssayPromptCover(lines, page, document.pages.length) : null;
    const assessment = essayPromptCover || (p === 0 ? assessmentCoverBlock(lines, page, document.pages.length) : null);
    if (assessment?.wholePage) {
      for (const line of assessment.lines) spans.push({ start: line.start, end: line.end, text: line.text,
        pageNumber: page.pageNumber || p + 1, reason: "SEPARATE_COVER_PAGE" });
      continue;
    }
    const mixedBlock = p === 0 ? (assessment?.lines || openingCoverBlock(lines, page, source)) : [];
    for (const line of mixedBlock) spans.push({ start: line.start, end: line.end, text: line.text,
      pageNumber: page.pageNumber || p + 1, reason: "OPENING_COVER_INFORMATION" });
    // A separate first-page cover needs sparse centered lines AND multiple metadata clues.
    // A first-page essay or abstract with prose is retained.
    const clues = content.filter(l => /\b(?:university|college|department|faculty|instructor|professor|student|assignment\s+due|due\s+date|course)\b/iu.test(l.text) ||
      /\b[A-Z]{2,8}\s*[- ]?\d{3,5}\b/u.test(l.text) ||
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/iu.test(l.text));
    const prose = content.some(l => words(l.text).length > 28 ||
      (words(l.text).length >= 8 && (/[.!?]["'’”)]?\s*$/u.test(l.text) ||
        /\b(?:reports|states|requires|supports|suggests|shows|explains|describes|indicates|believes|denies)\b/iu.test(l.text)) &&
        !clues.includes(l) && content.indexOf(l) > 1));
    const cover = !mixedBlock.length && document.pages.length > 1 && content.length >= 4 && content.length <= 14 &&
      clues.length >= 2 && words(content.map(l => l.text).join(" ")).length <= 180 &&
      content.filter(centered).length / content.length >= 0.8 && !prose;
    if (cover) {
      for (const line of content) spans.push({ start: line.start, end: line.end, text: line.text,
        pageNumber: page.pageNumber || p + 1, reason: "SEPARATE_COVER_PAGE" });
      continue;
    }
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (!line.isolated || mixedBlock.includes(line)) continue;
      const text = norm(line.text);
      if (/^(?:Timescale|Timeline|Research Schedule)$/iu.test(text) && styledShare(line, line.start, line.end) >= 0.8) {
        spans.push({start:line.start,end:line.end,text:line.text,pageNumber:page.pageNumber || p+1,reason:"FORMATTED_SCHEDULE_HEADING"});
      }
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
  return spans.concat(
    require("./jk-ai-layout-extra.cjs").classifyExtra(document),
    require("./jk-ai-structure-layout.cjs").classifyLayoutStructures(document),
    require("./jk-ai-provided-assessment.cjs").classifyProvidedAssessmentTemplate(document)
  );
}
function excludeAiStructuralText(prepared, document) {
  if (!document || typeof document.text !== "string" || typeof prepared?.text !== "string" ||
      !Array.isArray(prepared.map) || prepared.text.length !== prepared.map.length) return prepared;
  const legacy = require("./jk-ai-headings.js").excludeAiStructuralHeadings(prepared, document);
  const map = legacy.map.slice(), chars = legacy.text.split(""), indices = new Map();
  map.forEach((source, i) => { if (Number.isInteger(source)) indices.set(source, i); });
  const spans = [...(legacy.aiStructuralHeadingSpans || [])], covers = new Set(), blocks = new Set();
  for (const span of classifyAiStructuralText(document)) {
    const start = prepared.map.indexOf(span.start), length = span.end - span.start;
    if (!Number.isInteger(start) || start < 0) continue;
    let exact = true;
    for (let offset = 0; offset < length; offset++) if (prepared.map[start + offset] !== span.start + offset ||
        prepared.text[start + offset] !== document.text[span.start + offset]) { exact = false; break; }
    if (!exact) continue;
    for (let offset = 0; offset < length; offset++) {
      if (!/[\r\n]/u.test(chars[start + offset])) chars[start + offset] = " ";
      map[start + offset] = null;
    }
    spans.push(span); if (span.reason === "SEPARATE_COVER_PAGE") covers.add(span.pageNumber);
    if (span.reason === "OPENING_COVER_INFORMATION") blocks.add(span.pageNumber);
  }
  // Multiple conservative classifiers can identify the SAME source span.
  // Keep text masking and null barriers unchanged; count each exact source
  // interval once. Prefer a descriptive reason over the legacy unlabelled one.
  const uniqueBySource = new Map();
  for (const span of spans) {
    const key = `${span.start}:${span.end}`;
    const prior = uniqueBySource.get(key);
    if (!prior) uniqueBySource.set(key, span);
    else if (!prior.reason && span.reason) uniqueBySource.set(key, span);
  }
  const uniqueSpans = [...uniqueBySource.values()];
  return { ...legacy, text: chars.join(""), map, aiHeadingPolicy: "isolated-layout-v5",
    aiStructuralHeadingsExcluded: uniqueSpans.length, aiCoverPagesExcluded: covers.size, aiCoverBlocksExcluded: blocks.size, aiStructuralHeadingSpans: uniqueSpans };
}
module.exports = { classifyAiStructuralText, excludeAiStructuralText };
