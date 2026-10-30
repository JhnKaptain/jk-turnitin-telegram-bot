"use strict";
const assert = require("node:assert/strict");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const scan = require("./jk-scan-text.js");

// Reproduces the user's *real DOCX* page-11 geometry as measured from its
// LibreOffice PDF: 13.284pt line boxes, final DOI at y=108.058 and the first
// unheaded prose at y=653.308 on the SAME page (gap=545.25pt).
// This is not a verbatim uploaded private document or a paid provider test.
const lead = "The review examines equitable assessment designs and academic standards in higher education.";
const entries = Array.from({length:15},(_,i)=>[
  "Scholar"+i+", A. (202"+(i%6)+"). Inclusive assessment and equitable learning opportunities in higher education.",
  "Assessment & Evaluation in Higher Education, 48(3), 390-402.",
  "https://doi.org/10.1080/02602938.2022."+String(20779100+i)
]);
entries[14][0]="Tai, J., Mahoney, P., Ajjawi, R., Bearman, M., Dargusch, J., Dracup, M., & Harris, L. (2023).";
entries[14][1]="sociomaterial analysis. Assessment & Evaluation in Higher Education, 48(3), 390-402.";
entries[14][2]="https://doi.org/10.1080/02602938.2022.20779103";
const resume = "Leadership commitment plays a pivotal role in ensuring adherence to cybersecurity";
const prose = [
  resume,
  "policies. When leaders prioritize cybersecurity and demonstrate their commitment through actions",
  "and resources, it sets a positive example for the entire organization.",
  "This top-down approach influences employees attitudes towards cybersecurity.",
  "A strong security culture encourages employees to report potential threats."
];
const data=[{text:lead,page:2,x:72.1,y:700},
  {text:"References",page:9,x:290,y:710}];
let page=9,y=680;
for (let i=0;i<entries.length;i++){
  if(i===8){page=10;y=710;}
  if(i===14){page=11;y=163.258;}
  for(let j=0;j<3;j++){
    data.push({text:entries[i][j],page,x:j?108.1:72.1,y});
    y-=27.6;
  }
}
const last=data[data.length-1];
last.page=11;last.y=108.058;
data.push(...prose.map((text,i)=>({text,page:i<2?11:12,x:i===0?108.1:72.1,y:i===0?653.308:i===1?680.908:700-(i-2)*27.6})));
let text="",items=[];for(const line of data){const start=text.length;text+=line.text+"\n";items.push({start,end:start+line.text.length,text:line.text,pageNumber:line.page,x:line.x,y:line.y,height:13.284,width:450});}
const layout={text,pages:[...new Set(items.map(i=>i.pageNumber))].map(pageNumber=>({pageNumber,items:items.filter(i=>i.pageNumber===pageNumber)}))};
const inspected=inspectReferenceSections(text,-1,[],layout);
assert.equal(inspected.ranges.length,0,"Do not auto-decide an ambiguous boundary.");
assert.equal(inspected.reviews.length,1,JSON.stringify(inspected.reviews));
assert.equal(inspected.reviews[0].candidates[0]?.offset,text.indexOf(resume),
  "Include-from must begin at first Leadership sentence on same page after large vertical gap.");
assert.equal(inspected.reviews[0].candidates[0]?.preview.startsWith(resume),true);
assert.throws(()=>scan.buildAiInput(text,layout),e=>e?.code==="REFERENCE_BOUNDARY_REVIEW_REQUIRED");
assert.throws(()=>scan.buildSimilarityInput(text,scan.FILTER_MODE_FILTERED,[],layout),e=>e?.code==="REFERENCE_BOUNDARY_REVIEW_REQUIRED");
const approved=[{start:inspected.reviews[0].start,end:text.indexOf(resume),sourceTextSha256:inspected.sourceTextSha256}];
for(const prepared of [scan.buildAiInput(text,layout,approved),scan.buildSimilarityInput(text,scan.FILTER_MODE_FILTERED,approved,layout)]){
 assert(prepared.text.includes(resume),"Substantive post-reference prose must be included.");
 assert(!prepared.text.includes("Tai, J."),"Last reference must be excluded.");
}
console.log("PASS: 545.25-point SAME-PAGE gap after final DOI produces correct include-from boundary, and preserved prose mapping.");
