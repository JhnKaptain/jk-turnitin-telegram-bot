"use strict";
// Regression for SC60100300GS07: the bibliography heading is Word small caps.
// PDF.js extraction yields "L IST OF R EFERENCES:" and "G ENERATIVE AI USE
// DECLARATION", and the page-1 instructions mention 'List of References' in a
// sentence. Before this fix no heading was recognized at all: references went
// to Sapling / filtered Quetext and every saved AI range over them was painted.
// The fixture holds the REAL extracted offsets/geometry and the AI ranges
// recovered from the production report's cyan rectangles (student prose
// letters scrambled in place). Offline: no provider, Telegram or Render calls.
const assert = require("node:assert/strict");
const fixture = require("./test-fixtures/sc60100300gs07-real-geometry.json");
const { inspectReferenceSections } = require("./jk-reference-sections.js");
const proof = require("./jk-ai-reference-proof.cjs");
const { excludeAiNonProseRanges, referenceExclusionSpans } = require("./jk-ai-visual-mask.cjs");
const scan = require("./jk-scan-text.js");
const integrity = require("./jk-reference-integrity.cjs");

const doc = fixture.document;
const text = doc.text;
const headingStart = text.indexOf("L IST OF R EFERENCES:");
const declarationStart = text.indexOf("G ENERATIVE AI USE DECLARATION: MANDATORY");
assert(headingStart > 0 && declarationStart > headingStart, "fixture must keep the real fragmented headings");
assert(text.indexOf("‘List of References’") < headingStart, "fixture must keep the page-1 inline mention");

// 1. The production detector finds exactly the bibliography, no review needed.
const inspection = inspectReferenceSections(text, scan.findBibliographyStart(text), [], doc);
assert.deepEqual(inspection.reviews, []);
assert.deepEqual(inspection.ranges, [{ start: headingStart, end: declarationStart, manual: false }]);

// 2. The independent proofs agree; an inline quoted mention is not a heading.
const headings = proof.layoutHeadings(doc);
assert.deepEqual(headings.map(h => [h.kind, h.start]),
  [["REFERENCE_HEADING", headingStart], ["DECLARATION", declarationStart]]);
assert.equal(proof.verifiedReferenceFromLayout(text, doc)?.end, declarationStart);
assert.equal(proof.verifiedListOfReferences(text, doc)?.start, headingStart);
assert.equal(proof.verifiedListOfReferences(text, doc)?.end, declarationStart);

// 3. Neither Sapling nor filtered Quetext input contains any reference entry;
//    body text before and the declaration after remain mapped to the source.
for (const [label, prepared] of [
  ["AI", scan.buildAiInput(text, doc, [])],
  ["Similarity", scan.buildSimilarityInput(text, scan.FILTER_MODE_FILTERED, [], doc)]
]) {
  integrity.validateExcludedSourceMappings(prepared, label);
  proof.verifyPreparedReferenceIsolation(prepared, text, label, doc);
  for (const entry of ["Cachon, G. P.", "Kaplan, R. S.", "Lee, H. L. (2004)", "Sousa, R., & Voss"]) {
    assert(!prepared.text.includes(entry), label + " input leaked " + entry);
  }
  assert(!prepared.map.some(n => Number.isInteger(n) && n >= headingStart && n < declarationStart));
  assert(prepared.map.includes(headingStart - 2), label + " lost the final body paragraph");
  assert(prepared.map.includes(declarationStart + 45), label + " lost text after the bibliography");
  assert.deepEqual(scan.summarizePreparedInput(prepared).removedReferenceRanges,
    [{ start: headingStart, end: declarationStart, manual: false }]);
}

// 4. Cached production AI ranges (provider saw the references) are painted
//    without a single bibliography character, and every other highlighted
//    character is preserved exactly.
const original = fixture.productionAiRanges;
assert(original.some(r => r.start < declarationStart && r.end > headingStart),
  "fixture must reproduce the production bibliography highlights");
const painted = excludeAiNonProseRanges(original, doc);
assert(painted.every(r => r.end <= headingStart || r.start >= declarationStart),
  "AI highlight still paints the bibliography");
const chars = ranges => {
  const set = new Set();
  for (const r of ranges) for (let i = r.start; i < r.end; i++)
    if (i < headingStart || i >= declarationStart) set.add(i);
  return set;
};
assert.deepEqual([...chars(painted)].sort((a, b) => a - b), [...chars(original)].sort((a, b) => a - b),
  "valid AI highlights outside the bibliography changed");

// 5. Ranges saved with a provider run are honoured even if a future document
//    defeats detection (e.g. administrator-chosen boundaries).
const undetectable = { ...doc, text: text.replace("L IST OF R EFERENCES:", "Lxxx xx Rxxxxxxxxx:")
  .replace("G ENERATIVE AI USE DECLARATION", "Gxxxxxxxxx XX xxx xxxxxxxxxxx") };
const saved = [{ start: headingStart, end: declarationStart, manual: true }];
assert(referenceExclusionSpans(undetectable, saved).some(s => s.start === headingStart && s.end === declarationStart));
assert(excludeAiNonProseRanges(original, undetectable, saved)
  .every(r => r.end <= headingStart || r.start >= declarationStart));

// 6. Other fragmented (small caps / per-letter run) headings in any style.
const entries = [
  "Smith, J. (2020). Quality systems in practice. Journal of Operations, 4(2), 1–9.",
  "Brown, A., & Lee, K. (2019). Supply chains. Management Review, 12(1), 33–41.",
  "[1] A. Kumar and B. Chen, \"Edge analytics,\" IEEE Trans. Ind. Inf., vol. 9, pp. 1–8, 2021.",
  "Elliott, Anthony. 2010. The Routledge Companion. London: Routledge."
];
const body = "The organisation should improve supplier quality because the evidence shows that defects are expensive.\n".repeat(30);
for (const heading of ["R EFERENCES", "B IBLIOGRAPHY", "W ORKS C ITED", "R EFERENCE L IST:", "5. R EFERENCES"]) {
  const source = body + heading + "\n" + entries.join("\n") + "\nA PPENDIX A\nThe appendix data table follows the analysis and contains the survey responses.\n";
  const r = inspectReferenceSections(source, -1, [], null);
  assert.equal(r.reviews.length, 0, heading);
  assert.equal(r.ranges.length, 1, heading);
  assert.equal(r.ranges[0].start, source.indexOf(heading), heading);
  assert.equal(r.ranges[0].end, source.indexOf("A PPENDIX A"), heading + " must stop before the appendix");
}

// 7. Fail closed: a late bibliography heading whose entries use an unknown
//    style must reach administrator review, never a provider unexcluded.
const unknownStyle = body + "R EFERENCES\n" +
  "• smith j 2019 quality systems journal 4 12\n• brown k 2018 supply chains review 7 3\n" +
  "• lee h 2004 the triple a supply chain 82 10\n";
const failClosed = inspectReferenceSections(unknownStyle, -1, [], null);
assert.equal(failClosed.ranges.length, 0);
assert.equal(failClosed.reviews.length, 1);
assert.equal(failClosed.reviews[0].start, unknownStyle.indexOf("R EFERENCES"));
// ...but an early table-of-contents style mention does not trigger review.
const earlyMention = "R EFERENCES\nThe report is organised into three sections.\n" + body;
assert.equal(inspectReferenceSections(earlyMention, -1, [], null).reviews.length, 0);

console.log("PASS: real SC60100300GS07 geometry: fragmented small-caps bibliography detected exactly");
console.log("PASS: inline 'List of References' instruction is not a heading");
console.log("PASS: AI and filtered Similarity inputs exclude every reference; adjacent text kept");
console.log("PASS: cached production AI ranges paint zero bibliography characters; all other highlights identical");
console.log("PASS: saved exclusion ranges honoured; fragmented APA/IEEE/Chicago headings; unknown style fails closed");
