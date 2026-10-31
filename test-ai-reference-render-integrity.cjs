"use strict";
const assert=require("node:assert/strict");
const {verifiedListOfReferences,verifyPreparedReferenceIsolation}=require("./jk-ai-reference-proof.cjs");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const {excludeAiNonProseRanges}=require("./jk-ai-visual-mask.cjs");
const {buildAiInput,buildSimilarityInput,FILTER_MODE_FILTERED}=require("./jk-scan-text.js");

// This test covers the evidence omitted by PR #46: a provider range that
// spills into a *realistically structured*, 2-page reference list. It also
// verifies source offsets, both provider inputs, and visual highlights.
// No Sapling / Quetext request or production PDF mutation.
const sentences=[
 "The analysis recommends stronger supplier collaboration and differentiated sourcing throughout the international supply chain."
];
const bibliography=[
 "LIST OF REFERENCES:",
 "Cachon, G. P., & Swinney, R. (2011). The value of fast fashion: Quick response, enhanced",
 "design, and strategic consumer behavior. Management Science, 57(4), 778–795.",
 "https://doi.org/10.1287/mnsc.1100.1303",
 "Caro, F., & Gallien, J. (2007). Dynamic assortment with demand learning for seasonal",
 "consumer goods. Management Science, 53(2), 276–292.",
 "https://doi.org/10.1287/mnsc.1060.0613",
 "Deming, W. E. (2000). Out of the crisis. MIT Press.",
 "Fildes, R., Goodwin, P., Lawrence, M., & Nikolopoulos, K. (2009). Effective forecasting and",
 "judgmental adjustments: An empirical evaluation and strategies for improvement in",
 "supply-chain planning. International Journal of Forecasting, 25(1), 3–23.",
 "https://doi.org/10.1016/j.ijforecast.2008.11.010",
 "Fisher, M. L. (1997). What is the right supply chain for your product? Harvard Business",
 "Review, 75(2), 105–116.",
 "Hendricks, K. B., & Singhal, V. R. (2005). Association between supply chain glitches and",
 "operating performance. Management Science, 51(5), 695–711.",
 "https://doi.org/10.1287/mnsc.1040.0353",
 "International Organization for Standardization. (2015). Quality management systems—",
 "Requirements (ISO 9001:2015). https://www.iso.org/standard/62085.html",
 "Kaplan, R. S., & Norton, D. P. (1996). Linking the balanced scorecard to strategy. California",
 "Management Review, 39(1), 53–79. https://doi.org/10.2307/41165876",
 "Lee, H. L. (2004). The triple-A supply chain. Harvard Business Review, 82(10), 102–112.",
 "Schiffauerova, A., & Thomson, V. (2006). A review of research on cost of quality models and",
 "best practices. International Journal of Quality & Reliability Management, 23(6), 647–669.",
 "Slack, N., Brandon-Jones, A., & Burgess, N. (2022). Operations management (10th ed.). Pearson.",
 "Sousa, R., & Voss, C. A. (2002). Quality management re-visited: A reflective review and",
 "agenda for future research. Journal of Operations Management, 20(1), 91–109.",
 "https://doi.org/10.1016/S0272-6963(01)00088-2"
];
const declaration=[
 "GENERATIVE AI USE DECLARATION: MANDATORY",
 "Complete the Generative AI use declaration (see Word document in Stream) whether you",
 "have used AI in the preparation of this assessment or not. NOTE: Fully AI generated",
 "responses will be severely penalised.",
 "FAILURE TO COMPLETE THIS DECLARATION WILL RESULT IN YOUR ASSESSMENT NOT BEING MARKED!"
];
const rows=[];
for(let page=1;page<=9;page++){
 rows.push({page,text:"Detailed management recommendations justify differentiated sourcing and prevention systems. "+sentences[0].repeat(3)});
}
for(const text of sentences) rows.push({page:10,text});
for(const [idx,text] of bibliography.entries())rows.push({page:idx<19?10:11,text});
for(const text of declaration)rows.push({page:11,text});
let source="",pages=new Map(),yByPage=new Map();
for(const row of rows){
 const start=source.length;source+=row.text+"\n";
 const y=yByPage.get(row.page)??725;yByPage.set(row.page,y-15);
 const item={text:row.text,start,end:start+row.text.length,pageNumber:row.page,
  x:row.text==="LIST OF REFERENCES:"?72:107,y,width:410,height:11,fontName:"LiberationSans"};
 if(!pages.has(row.page))pages.set(row.page,[]);
 pages.get(row.page).push(item);
}
const doc={text:source,pages:[...pages].map(([pageNumber,items])=>({pageNumber,items,width:612,height:792,rotation:0}))};
const begin=source.indexOf("LIST OF REFERENCES:");
const end=source.indexOf("GENERATIVE AI USE DECLARATION:");
const proof=verifiedListOfReferences(source);
assert(proof,"Real bibliography shape must be independently recognized");
assert.equal(proof.start,begin);
assert.equal(proof.end,end);
const inspection=inspectReferenceSections(source,-1,[],doc);
assert.deepEqual(inspection.reviews,[]);
assert.equal(inspection.ranges.length,1);
assert.equal(inspection.ranges[0].start,begin);
assert.equal(inspection.ranges[0].end,end);
const ai=buildAiInput(source,doc);
const sim=buildSimilarityInput(source,FILTER_MODE_FILTERED,[],doc);
for(const [label,input] of [["AI",ai],["Similarity",sim]]){
 verifyPreparedReferenceIsolation(input,source,label);
 assert(!input.text.includes("Cachon, G."));
 assert(!input.text.includes("Schiffauerova, A."));
 assert(!input.text.includes("Kaplan, R."));
 assert(input.text.includes("Detailed management recommendations"));
 assert(input.text.includes("GENERATIVE AI USE DECLARATION: MANDATORY"));
 const i=input.text.indexOf("GENERATIVE AI USE DECLARATION");
 assert.equal(input.map[i],end);
}
// A stale/pre-filtered AI positive range spans ALL of pages 10 and 11,
// including the full references. The report must not paint bibliography.
const originalRange=[{start:begin-35,end:source.length}];
const painted=excludeAiNonProseRanges(originalRange,doc);
assert(painted.length>=1);
assert(painted.every(r=>r.end<=begin || r.start>=end),
 "Report paint still touches verified bibliography");
assert(painted.some(r=>r.start<begin&&r.end===begin));
assert(painted.some(r=>r.start===end&&r.end> end));
// Regression: a mapper that silently loses exclusion metadata must stop BEFORE
// a paid provider request, even when its fake input seems otherwise valid.
assert.throws(()=>verifyPreparedReferenceIsolation({
 text:source,map:Array.from({length:source.length},(_,i)=>i),removedReferenceRanges:[]
},source,"AI"),e=>e.code==="REFERENCE_EXCLUSION_INTEGRITY_FAILED" && e.noProviderRequests===true);
// An unrelated bibliography without a mandatory declaration is left to the
// existing boundary detector; this proof cannot silently delete body text.
assert.equal(verifiedListOfReferences(source.replace("GENERATIVE AI USE DECLARATION: MANDATORY","New substantive section")),null);
console.log("PASS: real-source reference page 10/11 boundaries and declaration");
console.log("PASS: AI and filtered Similarity preserve source mapping and exclude entire bibliography");
console.log("PASS: stale AI provider ranges cannot paint a single reference character");
console.log("PASS: missing exclusion metadata fails closed before provider submission");
