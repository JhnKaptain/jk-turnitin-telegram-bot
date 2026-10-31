"use strict";
// Regressions found by cross-checking freshly generated production reports.
// Fixtures carry REAL PDF.js geometry and the AI ranges production painted
// (student prose letters scrambled in place; detectors verified to decide
// identically on the scrambled copy). Offline: no provider/Telegram calls.
const assert = require("node:assert/strict");
const { referenceExclusionSpans, excludeAiNonProseRanges } = require("./jk-ai-visual-mask.cjs");
const { classifyNonProse } = require("./jk-ai-non-prose.cjs");
const { detectFourQuestionTemplate } = require("./jk-ai-provided-assessment.cjs");
const scan = require("./jk-scan-text.js");

const headingTexts = doc => {
  const out = [];
  for (const s of classifyNonProse(doc).filter(x => x.reason === "LOCAL_HEADING")) {
    const last = out.at(-1);
    if (last && s.start - last.end <= 2 && last.page === s.pageNumber) {
      last.text += doc.text.slice(last.end, s.end); last.end = s.end;
    } else out.push({ page: s.pageNumber, start: s.start, end: s.end, text: s.text });
  }
  return out.map(h => h.text.replace(/\s+/gu, " ").trim());
};
// Characters production painted that the current renderer no longer paints.
const unpainted = fixture => {
  const doc = fixture.document;
  const before = new Set(), after = new Set();
  for (const r of fixture.productionAiRanges) for (let i = r.start; i < r.end; i++) if (/\S/u.test(doc.text[i])) before.add(i);
  for (const r of excludeAiNonProseRanges(fixture.productionAiRanges, doc)) for (let i = r.start; i < r.end; i++) after.add(i);
  return [...before].filter(i => !after.has(i));
};
const textOf = (doc, chars) => {
  const lines = new Set();
  for (const i of chars) {
    const a = doc.text.lastIndexOf("\n", i) + 1, b = doc.text.indexOf("\n", i);
    lines.add(doc.text.slice(a, b < 0 ? undefined : b).trim());
  }
  return [...lines];
};

// 1. Presentation outline: no bibliography; headings left at the bottom of a
//    page ("Corrections" / "Type of System") were painted cyan.
{
  const fixture = require("./test-fixtures/presentation-outline-real-geometry.json");
  const doc = fixture.document;
  assert.deepEqual(referenceExclusionSpans(doc), [], "outline has no reference list");
  const headings = headingTexts(doc);
  for (const h of ["Introduction", "Courts Structure of Courts", "Corrections Type of System", "Conclusion"]) {
    assert(headings.includes(h), "heading not recognized: " + h);
  }
  assert.deepEqual(textOf(doc, unpainted(fixture)).sort(), ["Corrections", "Type of System"],
    "only the page-bottom headings may lose paint; essay prose must stay painted");
}

// 2. Communication with Colleagues: two separate reference lists in the
//    middle of the document, and a later task in a different font whose
//    headings were painted cyan.
{
  const fixture = require("./test-fixtures/communication-colleagues-real-geometry.json");
  const doc = fixture.document, text = doc.text;
  const refs = referenceExclusionSpans(doc).sort((a, b) => a.start - b.start);
  const first = text.indexOf("References\nAvari, P.");
  const second = text.indexOf("References\nArthur, L.");
  assert(first > 0 && second > first);
  assert(refs.some(r => r.start === first && text.slice(r.end).startsWith("Guiding Children’s Behaviour")));
  assert(refs.some(r => r.start === second && text.slice(r.end).startsWith("Teaching Resources, Strategies")));
  for (const [label, prepared] of [
    ["AI", scan.buildAiInput(text, doc, [])],
    ["Similarity", scan.buildSimilarityInput(text, scan.FILTER_MODE_FILTERED, [], doc)]
  ]) {
    const sent = new Set(prepared.map.filter(Number.isInteger));
    for (const r of refs) for (let i = r.start; i < r.end; i++) {
      assert(!(sent.has(i) && /\S/u.test(text[i])), label + " input contains bibliography text");
    }
  }
  const painted = excludeAiNonProseRanges(fixture.productionAiRanges, doc);
  assert(!painted.some(p => refs.some(r => p.start < r.end && p.end > r.start)), "bibliography painted");
  assert.deepEqual(textOf(doc, unpainted(fixture)).sort(), [
    "1. Transition Strategies",
    "1.1 Welcoming Children Through Activity Choices",
    "1.2 Verbal Prompts for Gathering on the Carpet",
    "Purpose",
    "Teaching Resources, Strategies and Transitions"
  ], "only the later task's headings may lose paint; essay prose must stay painted");
}

// 3. Supplied four-question template with Word small-caps headings
//    ("Q UESTION O NE (25 MARKS):"), as PDF.js extracts SC60100300GS07.
function templateDoc(smallCaps) {
  const q = n => smallCaps ? "Q UESTION " + n[0] + " " + n.slice(1) + " (25 MARKS):" : "QUESTION " + n + " (25 MARKS):";
  const lines = [
    "INSTRUCTIONS - READ THESE BEFORE YOU START:",
    "This document is pre-formatted, DO NOT change anything in this document other than inserting your responses.",
    "Complete ALL the highlighted MY RESPONSE sections and answer ALL FOUR QUESTIONS in the document provided.",
    "Student Name MY RESPONSE", "Student ID number MY RESPONSE", "Student Campus MY RESPONSE",
    "Please read every question carefully and provide the actual word count for each answer in the table.",
    "ANSWER ALL OF THE FOLLOWING QUESTIONS"
  ];
  const answer = "The organisation should redesign its supply chain so that planning, sourcing and quality decisions reflect demand variability and risk across every market.";
  ["ONE", "TWO", "THREE", "FOUR"].forEach((n, i) => {
    lines.push(q(n) + " Evaluate the operations strategy and recommend improvements.",
      "Response Word Count " + (700 + i), "Question Answer");
    for (let j = 0; j < 10; j++) lines.push(answer);
  });
  lines.push(smallCaps ? "G ENERATIVE AI USE DECLARATION: MANDATORY" : "GENERATIVE AI USE DECLARATION: MANDATORY",
    "Complete the Generative AI use declaration (see Word document in Stream) whether you have used AI.",
    "FAILURE TO COMPLETE THIS DECLARATION WILL RESULT IN YOUR ASSESSMENT NOT BEING MARKED!");
  let text = "";
  const pages = [1, 2, 3, 4, 5].map(pageNumber => ({ pageNumber, width: 595, height: 842, items: [] }));
  lines.forEach((line, i) => {
    const start = text.length; text += line + "\n";
    const page = pages[Math.min(4, Math.floor(i / 12))];
    page.items.push({ text: line, start, end: start + line.length, pageNumber: page.pageNumber,
      x: 72, y: 780 - (i % 12) * 50, width: 450, height: 11, fontName: "body" });
  });
  return { text, pages };
}
for (const smallCaps of [false, true]) {
  const doc = templateDoc(smallCaps);
  const result = detectFourQuestionTemplate(doc);
  assert.equal(result.verified, true, "template not verified (smallCaps=" + smallCaps + "): " + result.reason);
  assert.equal(result.intervals.filter(i => i.reason === "VERIFIED_SUPPLIED_QUESTION_AND_TABLE").length, 4);
  assert(result.intervals.some(i => i.reason === "VERIFIED_SUPPLIED_DECLARATION_INSTRUCTIONS"));
  const prepared = scan.buildAiInput(doc.text, doc, []);
  assert(prepared.text.includes("The organisation should redesign its supply chain"), "answers must stay analysable");
  assert(!/QUESTION|Q UESTION|pre-formatted|MY RESPONSE/u.test(prepared.text), "supplied template reached AI input");
}

console.log("PASS: real outline report: page-bottom headings unpainted, all essay prose kept");
console.log("PASS: real two-bibliography report: both reference lists excluded from AI + Similarity input and paint");
console.log("PASS: mixed-font later task headings unpainted, all essay prose kept");
console.log("PASS: supplied four-question template verified with plain and Word small-caps headings");
