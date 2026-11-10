"use strict";
// JK_TOC_TAB_ALIGNED_V1: Word tables of contents built with tabs (page number
// just after the title, mid-page; sometimes glued: "LITERATURE REVIEW8";
// roman numerals: "DECLARATION i") must be excluded from AI scoring, while
// body prose ending in a number stays in. Real LibreOffice -> PDF.js geometry.
const assert = require("node:assert/strict");
const { classifyNonProse } = require("./jk-ai-non-prose.cjs");
const doc = require("./test-fixtures/toc-tab-aligned-word-layout.json").document;

const spans = classifyNonProse(doc);
const toc = spans.filter(s => s.reason.startsWith("TABLE_OF_CONTENTS")).map(s => s.text.trim());
for (const entry of ["TABLE OF CONTENTS", "DECLARATION", "ABSTRACT", "CHAPTER ONE: INTRODUCTION",
  "1.1 Background to the Study", "CHAPTER TWO: LITERATURE REVIEW8", "REFERENCES", "APPENDICES",
  "2.5 Limitations of PSA-based Assessment, Overdiagnosis and Risk-based Strategies"]) {
  assert(toc.some(t => t.startsWith(entry)), "TOC entry excluded: " + entry);
}
const tocPage = doc.pages[0];
const covered = new Set(spans.map(s => s.start));
const left = tocPage.items.filter(i => i.text.trim() && !covered.has(i.start));
assert.deepEqual(left.map(i => i.text), [], "every table-of-contents line is excluded");

// Body prose, including sentences that end in a number, is never excluded.
for (const phrase of ["recruitment target for this study is 530", "limited specificity", "urinary testing before biopsy in 2026"]) {
  assert(!spans.some(s => s.text.includes(phrase.split(" ")[0]) && s.reason.startsWith("TABLE_OF_CONTENTS") && doc.text.slice(s.start, s.end + 60).includes(phrase)),
    "prose kept: " + phrase);
}
assert(!spans.some(s => s.pageNumber > 1 && s.reason.startsWith("TABLE_OF_CONTENTS")), "no TOC outside the contents page");

console.log("PASS: tab-aligned, glued and roman-numeral table-of-contents entries excluded from AI.");
console.log("PASS: body prose (including sentences ending in numbers) kept.");
