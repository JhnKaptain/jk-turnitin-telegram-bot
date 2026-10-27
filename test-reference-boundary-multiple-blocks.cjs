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
  "Introduction",
  "The first assignment body continues with detailed substantive discussion for the original task.",
  "",
  "References",
  "",
  "Smith, J. (2022). Education and classroom practice. Journal of Education, 8(1), 10-21.",
  "",
  "Discussion",
  "The second assignment body must also remain available for AI and similarity analysis.",
  "",
  "References",
  "",
  "Jones, R. (2023). Student behaviour and support. Teaching Review, 3(2), 66-78.",
  "",
  "Conclusion",
  "The final body section must remain included after the third bibliography."
].join("\n");

const inspected = inspectReferenceSections(source);
assert.equal(inspected.reviews.length, 0,
  "Explicit substantive headings should resolve all three bibliography boundaries automatically.");
assert.equal(inspected.ranges.length, 3, "Three separate bibliography blocks must be excluded independently.");
assert(inspected.ranges.every(r => r.manual === false));

const prepared = prepareWithoutReferences(source, t => ({
  text: t, map: Array.from({length:t.length},(_,i)=>i)
}));
for (const citation of [
  "Barker, T. (2021). Research design and analysis.",
  "Smith, J. (2022). Education and classroom practice.",
  "Jones, R. (2023). Student behaviour and support."
]) assert(!prepared.text.includes(citation), "Reference was not excluded: " + citation);

for (const body of [
  "Introduction",
  "The first assignment body continues",
  "Discussion",
  "The second assignment body must also remain",
  "Conclusion",
  "The final body section must remain included"
]) assert(prepared.text.includes(body), "Body content was excluded: " + body);

assert.equal(prepared.map.length, prepared.text.length);
for(let i=0;i<prepared.map.length;i++) {
  if(Number.isInteger(prepared.map[i])) assert.equal(prepared.text[i],source[prepared.map[i]]);
}
console.log("PASS: three separate bibliography blocks are excluded independently.");
console.log("PASS: substantive sections between and after references remain included.");
console.log("PASS: source offsets remain mapped to original text.");
