"use strict";
const assert=require("node:assert/strict");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const scan=require("./jk-scan-text.js");

// Layout measurements from the real 6-page Week 2 Mini case.docx converted
// with LibreOffice: reference p2 y=541.709/569.309/596.909 and Mini-Case 2
// p3 y=72.509 followed by Question 1 p3 y=100.109.
const cases=[
 {text:"The idea behind the Time Value of Money is essential because present money can earn interest.",page:1,x:72.1,y:692},
 {text:"The difference between compound interest and simple interest lies in their calculations.",page:1,x:72.1,y:660},
 {text:"An annuity due typically has a higher present value and future value than an ordinary annuity.",page:2,x:72.1,y:470},
 {text:"Reference",page:2,x:272.15,y:514.10876},
 {text:"Subjectmoney. (2014, October 21). Time value of money finance - TVM formulas &",page:2,x:72.1,y:541.70874},
 {text:"calculations - Annuities, present value, future value [Video]. YouTube.",page:2,x:108.1,y:569.3087},
 {text:"https://www.youtube.com/watch?v=m3azU7gYHc0",page:2,x:108.1,y:596.90875},
 {text:"Mini-Case 2",page:3,x:266.6,y:72.50874},
 {text:"Question 1",page:3,x:72.1,y:100.10878},
 {text:"i)",page:3,x:72.1,y:124},
 {text:"Thus, saving 4 dollars consistently each day and investing the accumulated finances yearly will result to about $1,983,015.85 at the age of 67.",page:3,x:72.1,y:420},
 {text:"ii)",page:4,x:72.1,y:90},
 {text:"Thus, delaying savings from retirement until the age of 42 lessens the retirement balance to about $194,667.45.",page:4,x:72.1,y:450},
 {text:"iii)",page:4,x:72.1,y:520},
 {text:"Thus, the financier beginning at age 42 should deposit about $14,872.56 each year.",page:4,x:72.1,y:600},
 {text:"Question 2",page:4,x:270,y:670},
 {text:"Option 1",page:4,x:270,y:710},
 {text:"The 30 payments that remains will incorporate an ordinary annuity as the initial payment is received at the end of the first period.",page:5,x:72.1,y:530},
 {text:"My recommendation to my neighbor is to consider Option 1, which provides a PV of about $829,862.34 higher than Option 2.",page:6,x:72.1,y:560}
];
let source="",items=[];
for (const item of cases) {
  const start=source.length;
  source+=item.text+"\n";
  items.push({...item,start,end:start+item.text.length,pageNumber:item.page,height:13.284,width:400});
}
const pages=[...new Set(items.map(x=>x.pageNumber))].map(pageNumber=>({pageNumber,items:items.filter(x=>x.pageNumber===pageNumber)}));
const layout={text:source,pages};
const decision=inspectReferenceSections(source,-1,[],layout);
const referenceStart=source.indexOf("Reference\n");
const boundary=source.indexOf("Mini-Case 2\n");
assert.equal(decision.ranges.length,1,JSON.stringify(decision));
assert.equal(decision.reviews.length,0,JSON.stringify(decision));
assert.equal(decision.ranges[0].start,referenceStart);
assert.equal(decision.ranges[0].end,boundary,"Reference exclusion must stop at Mini-Case 2.");
for(const prepared of [
  scan.buildAiInput(source,layout),
  scan.buildSimilarityInput(source,scan.FILTER_MODE_FILTERED,[],layout)
]){
  assert(!prepared.text.includes("Subjectmoney."),"Reference leaked to provider input");
  assert(!prepared.text.includes("m3azU7gYHc0"),"Reference URL leaked to provider input");
  for(const phrase of ["Mini-Case 2","Question 1","saving 4 dollars","Question 2","recommendation to my neighbor"]){
    assert(prepared.text.includes(phrase),"Later substantive section lost: "+phrase);
  }
  const mapped=prepared.map;
  const expectedAt=boundary;
  const ix=prepared.text.indexOf("Mini-Case 2");
  if(ix>=0)assert.equal(mapped[ix],expectedAt,"Preserve exact source offset for Mini-Case heading");
}
console.log("PASS: real Word page-2/3 measurements; single YouTube reference excluded while Mini-Case 2 and all calculations retained.");
