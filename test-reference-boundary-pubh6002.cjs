"use strict";
const assert = require("node:assert/strict");
const scan = require("./jk-scan-text.js");
const {inspectReferenceSections} = require("./jk-reference-sections.js");

// Public-data-free structural reconstruction of the uploaded 38-page PUBH6002
// document. It reproduces the PDF visual lines, wrapped entries, a page break,
// and the following appendix, without committing the student's coursework.
const source = [
  "Evidence summary table: APA reference | Findings | Relevance",
  "Australian Bureau of Statistics. (2024). Example table citation in the evidence summary.",
  "The analysis describes food security in regional communities and interprets the evidence.",
  "",
  "4. Reflection",
  "The assessment compares evidence from national surveys, program reviews, and local projects.",
  "",
  "References",
  "",
  "Australian Bureau of Statistics. (2024, November 26). 10 insights into health of Aboriginal and Torres",
  "Strait Islander peoples for 2022-23 [Media release]. https://www.abs.gov.au/media-centre/media-",
  "releases/10-insights-health-aboriginal-and-torres-strait-islander-peoples-2022-23",
  "",
  "Australian Bureau of Statistics. (2025, September 5). Food insecurity, 2023.",
  "https://www.abs.gov.au/statistics/health-and-nutrition/food-insecurity/2023",
  "",
  "Bryce, S., Scales, I., Herron, L.-M., Wigginton, B., Lewis, M., Lee, A., & Ngaanyatjarra Pitjantjatjara",
  "Yankunytjatjara (NPY) Women's Council. (2020). Maitjara Wangkanyi: Insights from an",
  "ethnographic study of food practices of households in remote Australian Aboriginal communities.",
  "International Journal of Environmental Research and Public Health, 17(21), Article 8109.",
  "https://doi.org/10.3390/ijerph17218109",
  "",
  "Child Family Community Australia. (2020). Understanding food insecurity in Australia (CFCA Paper",
  "No. 55). Australian Institute of Family Studies. https://aifs.gov.au/resources/policy-and-practice-",
  "papers/understanding-food-insecurity-australia",
  "",
  "Commonwealth Scientific and Industrial Research Organisation. (2025). Towards a state of the food",
  "system report for Australia. Australian Policy Online. https://apo.org.au/node/330900",
  "",
  "Davies, A., Gwynn, J., Allman-Farinelli, M., Flood, V., Dickson, M., Turner, N., & Lock, M.",
  "(2023). Programs addressing food security for First Nations peoples: A scoping review.",
  "Nutrients, 15(14), Article 3127. https://doi.org/10.3390/nu15143127",
  "",
  "Yamagigu Consulting. (2026). Consultation report: National strategy for food security in remote First",
  "Nations communities. National Indigenous Australians Agency.",
  "https://www.niaa.gov.au/sites/default/files/documents/2026-01/national-strategy-food-fecurity-",
  "remote-first-nations-communities-final-report.pdf",
  "",
  "Appendix A: Screenshot evidence",
  "Each figure shows the tool, search terms, and result as part of the supplementary evidence.",
  "Figure 1.",
  "Copilot prompt requesting government and university reports"
].join("\n");

const starts = source.indexOf("\nReferences\n") + 1;
const appendix = source.indexOf("Appendix A: Screenshot evidence");
const pieces = source.split("\n");
let pos = 0;
let y = 760;
let pageNumber = 29;
const pages = new Map();
for (const line of pieces) {
  if (line === "Appendix A: Screenshot evidence") {pageNumber = 32; y = 750;}
  else if (line.startsWith("Child Family Community")) {pageNumber = 30; y = 740;}
  else if (line.startsWith("Yamagigu Consulting")) {pageNumber = 31; y = 720;}
  if (line.trim()) {
    if (!pages.has(pageNumber)) pages.set(pageNumber, []);
    pages.get(pageNumber).push({text:line,start:pos,end:pos+line.length,
      pageNumber,x:/^(?:References|Appendix A)/.test(line)?220 :
        /^(?:Strait Islander|releases\/|https?:|Yankunytjatjara|ethnographic study|International Journal|No\. 55|papers\/|system report|\(2023\)|Nations communities|remote-first)/.test(line)?93:72,
      y,width:Math.max(20,line.length*5),height:10});
    y -= 12;
  } else y -= 12;
  pos += line.length + 1;
}
const layout = {text:source,pages:[...pages].map(([num,items])=>({pageNumber:num,items}))};
const result = inspectReferenceSections(source,-1,[],layout);
assert.deepEqual(result.reviews,[],JSON.stringify(result.reviews));
assert.equal(result.ranges.length,1,JSON.stringify(result.ranges));
assert.equal(result.ranges[0].start,starts);
assert.equal(result.ranges[0].end,appendix,"Bibliography must end exactly before appendix.");
const ai = scan.buildAiInput(source,layout);
const sim = scan.buildSimilarityInput(source,scan.FILTER_MODE_FILTERED,[],layout);
for (const prepared of [ai,sim]) {
  assert(prepared.text.includes("Evidence summary table"));
  assert(prepared.text.includes("The assessment compares evidence"));
  assert(prepared.text.includes("Appendix A: Screenshot evidence"));
  assert(prepared.text.includes("Each figure shows the tool"));
  for (const item of ["Bryce, S.","International Journal of Environmental Research","Yamagigu Consulting.","remote-first-nations-communities-final-report.pdf"]) {
    assert(!prepared.text.includes(item),"Bibliography leaked into provider input: "+item);
  }
  const n = prepared.text.indexOf("Appendix A: Screenshot evidence");
  assert(n>=0 && Number.isInteger(prepared.map[n]));
  assert.equal(prepared.map[n],appendix,"Appendix offset must point to original canonical text.");
  for (let i=0;i<prepared.text.length;i++) {
    if (Number.isInteger(prepared.map[i])) assert.equal(prepared.text[i],source[prepared.map[i]]);
  }
}
assert(source.includes("International Journal of Environmental Research"));
assert(source.includes("Yamagigu Consulting."));
console.log("PASS: PUBH6002-shaped wrapped citations are excluded without admin review.");
console.log("PASS: appendix and substantive body survive in AI and filtered Similarity.");
console.log("PASS: original text is unchanged and provider offsets map to canonical text.");
