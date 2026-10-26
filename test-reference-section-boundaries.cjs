"use strict";
const assert = require("node:assert/strict");
const {findReferenceSections,prepareWithoutReferences}=require("./jk-reference-sections.js");

const sample = [
  "Introductory material that is long enough to pass the early-heading guard. ".repeat(6),
  "Reflection and analysis remain part of the first assignment.",
  "",
  "References",
  "",
  "Avari, P., Hamel, E., Schachter, R. E., & Hatton-Bowers, H. (2023). Communication with families: Understanding perspectives. Journal of Early Childhood Research, 21(2), 241-255.",
  "",
  "Kambouri, M., Wilson, T., Pieridou, M., Quinn, S. F., & Liu, J. (2022). Making partnerships work. Early Childhood Education Journal, 50(4), 639-661.",
  "",
  "Guiding Children’s Behaviour",
  "",
  "Date: 19 October 2026",
  "Context: Outdoor Play – Mini Trampoline",
  "The substantive behaviour analysis should be included for AI and similarity checking.",
  "Porter (2016) discusses guidance and children’s autonomy.",
  "",
  "References",
  "",
  "Arthur, L., Beecher, B., Death, E., & Dockett, S. (2025). Programming and planning in early childhood settings.",
  "",
  "Porter, L. (2016). Young children’s behaviour: Guidance approaches for early childhood educators.",
  "",
  "Teaching Resources, Strategies and Transitions",
  "",
  "Purpose",
  "The next assignment must also remain in the checked text.",
  "",
  "The article references Smith (2025) in its analysis, but that is not a bibliography heading.",
  "Final section content remains included."
].join("\n");

const ranges=findReferenceSections(sample);
assert.equal(ranges.length,2,JSON.stringify(ranges));
const refs=ranges.map(r=>sample.slice(r.start,r.end));
assert(refs[0].includes("Avari,"));
assert(refs[0].includes("Kambouri,"));
assert(refs[1].includes("Arthur,"));
assert(refs[1].includes("Porter,"));
assert(!ranges.some(r=>sample.slice(r.start,r.end).includes("Guiding Children’s Behaviour")));
assert(!ranges.some(r=>sample.slice(r.start,r.end).includes("Teaching Resources, Strategies and Transitions")));
const prepared=prepareWithoutReferences(sample, source=>({text:source,map:Array.from({length:source.length},(_,i)=>i)}));
assert(prepared.text.includes("Guiding Children’s Behaviour"));
assert(prepared.text.includes("The substantive behaviour analysis"));
assert(prepared.text.includes("Teaching Resources, Strategies and Transitions"));
assert(prepared.text.includes("The next assignment must also remain"));
assert(!prepared.text.includes("Communication with families: Understanding perspectives"));
assert(!prepared.text.includes("Young children’s behaviour: Guidance approaches"));
assert.equal(prepared.map.length,prepared.text.length);
for(let i=0;i<prepared.map.length;i++){
  if(Number.isInteger(prepared.map[i])) assert.equal(prepared.text[i],sample[prepared.map[i]]);
}
// Critical edge case: body prose resumes after the bibliography with no section title.
const titleless = [
  "Opening academic discussion with enough original words to exceed the early-heading cutoff. ".repeat(8),
  "",
  "References",
  "",
  "Barker, T. (2021). Research design and analysis. Journal of Academic Methods, 12(2), 44-58.",
  "",
  "The criminal justice system serves as the backbone of societal order and establishes how laws are enforced across communities. This paragraph must remain in the AI analysis even though it has no heading.",
  "The following discussion compares policing and courts, and explains why rehabilitation differs across the countries examined in this essay."
].join("\n");
const titlelessRanges = findReferenceSections(titleless);
assert.equal(titlelessRanges.length, 1, JSON.stringify(titlelessRanges));
const titlelessPrepared = prepareWithoutReferences(titleless, source => ({
  text: source, map: Array.from({length: source.length}, (_, i) => i)
}));
assert(!titlelessPrepared.text.includes("Research design and analysis"));
assert(titlelessPrepared.text.includes("The criminal justice system serves as the backbone"));
assert(titlelessPrepared.text.includes("The following discussion compares policing and courts"));
const titlelessScan = require("./jk-scan-text.js");
const aiTitleless = titlelessScan.buildAiInput(titleless);
const simTitleless = titlelessScan.buildSimilarityInput(titleless, titlelessScan.FILTER_MODE_FILTERED);
assert(aiTitleless.text.includes("The criminal justice system serves as the backbone"));
assert(simTitleless.text.includes("The criminal justice system serves as the backbone"));
assert(!aiTitleless.text.includes("Research design and analysis"));
assert(!simTitleless.text.includes("Research design and analysis"));
const bodyPhrase = "The criminal justice system serves as the backbone";
const bodyOffset = aiTitleless.text.indexOf(bodyPhrase);
assert.equal(titleless.slice(aiTitleless.map[bodyOffset], aiTitleless.map[bodyOffset] + bodyPhrase.length),
  bodyPhrase);

const proseOnly="This is substantial text. The article references Smith for a useful example. The author discusses bibliography design in the final discussion.";
assert.equal(findReferenceSections(proseOnly).length,0);
console.log("PASS: multiple bibliography blocks excluded independently.");
console.log("PASS: substantive sections after each reference list are retained.");
console.log("PASS: in-sentence uses of references do not trigger exclusion.");
console.log("PASS: prepared-to-original source mappings preserved.");
