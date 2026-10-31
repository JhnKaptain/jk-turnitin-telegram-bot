"use strict";
const assert=require("node:assert/strict");
const {verifiedListOfReferences,verifiedReferenceFromLayout}=require("./jk-ai-reference-proof.cjs");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const {excludeAiNonProseRanges}=require("./jk-ai-visual-mask.cjs");
const scan=require("./jk-scan-text.js");

// Mimic the ACTUAL PDF.js text-item splitting seen in SC60100300GS07:
// LIST OF REFERENCES is split into L, IST, space, OF, R, EFERENCES, colon,
// and GENERATIVE AI USE DECLARATION is also split by mixed font runs.
// Canonical text includes newlines between those fragments. Unlike prior
// idealized tests, the headings do not exist as contiguous strings.
const referenceItems=[
"Cachon, G. P., & Swinney, R. (2011). Fast fashion and quick response.",
"https://doi.org/10.1287/mnsc.1100.1303",
"Caro, F., & Gallien, J. (2007). Dynamic assortment with demand learning.",
"https://doi.org/10.1287/mnsc.1060.0613",
"Deming, W. E. (2000). Out of the crisis. MIT Press.",
"Fildes, R., Goodwin, P., Lawrence, M., & Nikolopoulos, K. (2009). Forecasting research.",
"https://doi.org/10.1016/j.ijforecast.2008.11.010",
"Fisher, M. L. (1997). The right supply chain for your product.",
"Hendricks, K. B., & Singhal, V. R. (2005). Supply chain disruptions.",
"https://doi.org/10.1287/mnsc.1040.0353",
"International Organization for Standardization. (2015). ISO 9001.",
"https://www.iso.org/standard/62085.html",
"Kaplan, R. S., & Norton, D. P. (1996). The balanced scorecard and strategy.",
"Lee, H. L. (2004). Triple-A supply chain.",
"Schiffauerova, A., & Thomson, V. (2006). Quality cost models.",
"Slack, N., Brandon-Jones, A., & Burgess, N. (2022). Operations management.",
"Sousa, R., & Voss, C. A. (2002). Quality management.",
"https://doi.org/10.1016/S0272-6963(01)00088-2"
];
let source="",pages=new Map(),ys=new Map();
function insert(text,page,x,customY=null){
 const start=source.length;source+=text+"\n";
 const y=customY===null?(ys.get(page)??735):customY;
 if(customY===null)ys.set(page,y-16);
 const item={text,start,end:start+text.length,pageNumber:page,x,y,height:12,width:Math.max(3,text.length*5)};
 if(!pages.has(page))pages.set(page,[]);pages.get(page).push(item);
 return item;
}
for(let i=1;i<=9;i++)insert(("Management analysis reviews forecast risk and quality accountability in global supply networks. ").repeat(7),i,72);
insert(("The author concludes with proposals for quality prevention and supplier management. ").repeat(4),10,72);
const headingStart=source.length;
const head=["L","IST"," ","OF"," R","EFERENCES",":"],x=[72.1,78.8,94.7,98.2,112.8,125.3,184.6];
head.forEach((xtext,i)=>insert(xtext,10,x[i],360));
referenceItems.forEach((s,i)=>insert(s,i<13?10:11,i%3?108:72));
const declarationStart=source.length;
const dt=["G","ENERATIVE"," AI ","USE"," ","DECLARATION",": MANDATORY"];
const dx=[72.1,82.2,141.6,162.8,183.4,187.1,263.1];
dt.forEach((s,i)=>insert(s,11,dx[i],510));
insert("Complete the required declaration whether you used AI or not.",11,72);
const doc={text:source,pages:[...pages].map(([pageNumber,items])=>({pageNumber,items,width:612,height:792}))};
assert(!source.includes("LIST OF REFERENCES:"));
assert(!source.includes("GENERATIVE AI USE DECLARATION: MANDATORY"));
const boundary=verifiedListOfReferences(source,doc);
assert(boundary, "Failed to recover split reference heading using page layout");
assert.equal(boundary.start,headingStart);
assert.equal(boundary.end,declarationStart);
const result=inspectReferenceSections(source,-1,[],doc);
assert.deepEqual(result.reviews,[]);
assert.deepEqual(result.ranges.map(x=>[x.start,x.end]),[[headingStart,declarationStart]]);
for(const input of [scan.buildAiInput(source,doc),
 scan.buildSimilarityInput(source,scan.FILTER_MODE_FILTERED,[],doc)]){
 assert(input.text.includes("Management analysis reviews"));
 assert(!input.text.includes("Cachon, G."));
 assert(!input.text.includes("Sousa, R."));
 assert(input.text.includes("Complete the required declaration"));
}
const visible=excludeAiNonProseRanges([{start:0,end:source.length}],doc);
assert(visible.some(r=>r.start<headingStart && r.end===headingStart));
assert(visible.some(r=>r.start===declarationStart && r.end>declarationStart));
assert(visible.every(r=>r.end<=headingStart||r.start>=declarationStart));
assert.equal(verifiedReferenceFromLayout(source,{text:source,pages:[]}),null);
console.log("PASS: real mixed-style PDF run fragments do not leak bibliography into AI/Similarity or visual highlights");
