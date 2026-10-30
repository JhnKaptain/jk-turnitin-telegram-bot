"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const scan=require("./jk-scan-text.js");
const content=[];
for(let i=0;i<10;i++)content.push("The analysis evaluates equitable learning, access to education and assessment practices across student groups.");
content.push("References");
const names=["Au, W.","Chan, C. K. Y.","Chaudhry, I. S.","Dawson, P.","Nieminen, J.","Nieminen, J.","Nieminen, J.","Nieminen, J.","Nieminen, J.","St-Onge, C.","Tai, J.","Tai, J.","Tai, J.","Tai, J."];
for(let i=0;i<names.length;i++){
 content.push(names[i]+" (202"+(i%6)+"). Fair assessment and student equity: A scholarly review of institutional practices.");
 content.push("Journal of Higher Education Research, 12(4), 112-131. https://doi.org/10.1023/example."+i);
}
const restart="Leadership commitment plays a pivotal role in ensuring adherence to cybersecurity";
content.push(restart);
content.push("policies. When leaders prioritize cybersecurity and demonstrate their commitment through actions");
content.push("and resources, it sets a positive example for the entire organization.");
content.push("This organizational culture supports effective communication, risk management and training.");
content.push("Leadership-driven practices are essential for sustaining effective security measures.");
let text="",items=[],page=8,y=720;
for(let i=0;i<content.length;i++){
 const line=content[i];
 if(line===restart){page=12;y=720;}
 else if(line==="References"){page=9;y=720;}
 else if(page>=9 && page<12 && y<90){page++;y=720;}
 const start=text.length;text+=line+"\n";
 items.push({start,end:start+line.length,text:line,pageNumber:page,x:/^(Journal|policies\.)/.test(line)?110:72,y,height:11,width:500});
 y-=25.3;
}
const layout={text,pages:[...new Set(items.map(i=>i.pageNumber))].map(pageNumber=>({pageNumber,items:items.filter(x=>x.pageNumber===pageNumber)}))};
const report=inspectReferenceSections(text,-1,[],layout);
assert.equal(report.ranges.length,0,"Ambiguous end must not be silently removed");
assert.equal(report.reviews.length,1,JSON.stringify(report.reviews));
assert.equal(report.reviews[0].entriesFound,14);
assert.equal(report.reviews[0].candidates[0]?.offset,text.indexOf(restart),
  "Offer beginning of actual prose, not last reference or a missing option");
assert.throws(()=>scan.buildAiInput(text,layout),e=>e?.code==="REFERENCE_BOUNDARY_REVIEW_REQUIRED");
assert.throws(()=>scan.buildSimilarityInput(text,scan.FILTER_MODE_FILTERED,[],layout),e=>e?.code==="REFERENCE_BOUNDARY_REVIEW_REQUIRED");
const bot=fs.readFileSync(require.resolve("./bot.js"),"utf8");
assert(bot.includes("JK_REF_BOUNDARY_CANCEL_"));
assert(bot.includes('file.referenceBoundaryReviewStatus = "CANCELLED"'));
assert(bot.includes('file.providerStatus = "CANCELLED"'));
assert(bot.includes('review.timeoutExpiredAt = now'));
assert(!bot.includes('timeout.makeTreatRemainderAsReferencesOverride(review, now)'));
assert(bot.includes('file.referenceBoundaryReviewStatus === "CANCELLED"'));
const timeout=require("./jk-reference-review-timeout.cjs");
const now=Date.now();
const file={referenceBoundaryReviewStatus:"PENDING_ADMIN",referenceReviewNoProviderRequests:true,
  referenceBoundaryReview:{start:100,sourceLength:200,sourceTextSha256:"a".repeat(64),autoResolveAt:now-1000}};
assert(timeout.isAutoResolveDue(file,now));
file.referenceBoundaryReview.timeoutExpiredAt=now;
assert(!timeout.isAutoResolveDue(file,now));
console.log("PASS: unheaded post-reference body is selectable; pending cancel and timeout never make paid provider requests.");
