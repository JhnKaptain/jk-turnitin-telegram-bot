"use strict";
const assert = require("node:assert/strict");
const {inspectReferenceSections, prepareWithoutReferences} = require("./jk-reference-sections.js");

const source = [
  "Opening material sets out the first assignment and explains its context clearly. ".repeat(8),
  "",
  "References",
  "",
  "Barker, T. (2021). Research design and analysis. Journal of Academic Methods, 12(2), 44-58.",
  "",
  "This section begins here.",
  "The first assignment body continues with detailed substantive discussion for the original task.",
  "",
  "References",
  "",
  "Smith, J. (2022). Education and classroom practice. Journal of Education, 8(1), 10-21.",
  "",
  "This second section begins here.",
  "The second assignment body must also remain available for AI and similarity analysis.",
  "",
  "References",
  "",
  "Jones, R. (2023). Student behaviour and support. Teaching Review, 3(2), 66-78.",
  "",
  "This third section begins here.",
  "The final body section must remain included after the third bibliography."
].join("\n");

const overrides = [];
const reviewsSeen = [];
for (let step = 1; step <= 3; step++) {
  const current = inspectReferenceSections(source, -1, overrides);
  const review = current.reviews[0];
  assert(review, "Expected administrator review #" + step);
  assert(review.candidates.length, "Review needs selectable boundary candidates.");
  assert(!current.ranges.some(r => r.start === review.start),
    "Ambiguous block must not be silently excluded.");
  const candidate = review.candidates.find(c =>
    source.slice(c.offset).startsWith(
      step === 1 ? "This section begins here." :
      step === 2 ? "This second section begins here." :
      "This third section begins here."
    )) || review.candidates[0];

  const expectedStarts = source.split("References").slice(0, step).length;
  assert(review.start > (overrides.length ? overrides[overrides.length-1].start : -1));
  reviewsSeen.push({step, start: review.start, candidate: candidate.offset});
  overrides.push({
    start: review.start,
    end: candidate.offset,
    sourceTextSha256: current.sourceTextSha256,
    approvedBy: "6569201830",
    approvedAt: Date.now()
  });
}

const final = inspectReferenceSections(source, -1, overrides);
assert.equal(final.reviews.length, 0, "All three reviewed boundaries should now be resolved.");
assert.equal(final.ranges.length, 3, "Three bibliography blocks must be excluded independently.");
assert(final.ranges.every(r => r.manual === true));

const prepared = prepareWithoutReferences(source, t => ({
  text: t, map: Array.from({length:t.length},(_,i)=>i)
}), -1, overrides);

for (const citation of [
  "Barker, T. (2021). Research design and analysis.",
  "Smith, J. (2022). Education and classroom practice.",
  "Jones, R. (2023). Student behaviour and support."
]) assert(!prepared.text.includes(citation), "Reference was not excluded: " + citation);

for (const body of [
  "This section begins here.",
  "The first assignment body continues",
  "This second section begins here.",
  "The second assignment body must also remain",
  "This third section begins here.",
  "The final body section must remain included"
]) assert(prepared.text.includes(body), "Body content was excluded: " + body);

assert.equal(prepared.map.length, prepared.text.length);
for (let i=0;i<prepared.map.length;i++) {
  if (Number.isInteger(prepared.map[i])) assert.equal(prepared.text[i],source[prepared.map[i]]);
}
console.log("PASS: three separate bibliography blocks can be reviewed sequentially.");
console.log("PASS: each admin choice excludes only its selected reference block.");
console.log("PASS: substantive text between and after reference blocks remains included.");
console.log("PASS: source offsets remain mapped to original text.");
