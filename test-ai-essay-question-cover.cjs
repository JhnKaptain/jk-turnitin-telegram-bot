"use strict";
const assert=require("node:assert/strict");
const {buildAiInput}=require("./jk-scan-text.js");
const {classifyAiStructuralText}=require("./jk-ai-structure.js");
const title="Going Ashore: Mobile Aspirations and the Desire for Mooring";
const question="What do researchers mean by mobile aspirations? Critically evaluate this concept with reference to your own experiences of youth mobility, in both temporal and spatial dimensions. To what extent is this concept able to make sense of your experience?";
const normal="In discussions of work, going ashore expresses a desire for stable employment. I examine the spatial and temporal dimensions of this experience and the institutional conditions of study abroad.";
function build(mixed=false){
 const blocks=[
 [{t:title,y:710,center:true},{t:"in a Chinese Student's Return",y:692,center:true},
 {t:"Research Essay – Question 7",y:644,center:true},
 {t:"What do researchers mean by mobile aspirations? Critically evaluate this",y:604},
 {t:"concept with reference to your own experiences of youth mobility, in both temporal and spatial",y:585},
 {t:"dimensions. To what extent is this concept able to make sense of your experience?",y:566},
 {t:"Word count (essay body): 2,055",y:490,center:true},
 {t:"27 October 2026",y:445,center:true},
 ...(mixed?[{t:normal,y:400}]:[])],
 [{t:normal,y:720},{t:normal,y:695}]
 ];
 let text="",pages=[];for(let p=0;p<blocks.length;p++){const items=[];for(let x of blocks[p]){const start=text.length;text+=x.t+"\n";const w=x.t.length*4.0;items.push({text:x.t,start,end:start+x.t.length,x:x.center?(612-w)/2:72,y:x.y,width:w,height:12,fontName:p===0?"cover":"body",hasEOL:true});}pages.push({pageNumber:p+1,width:612,height:792,rotation:0,items});text+="\n";}
 return {text,pages};
}
const d=build(false),r=buildAiInput(d.text,d);
const spans=classifyAiStructuralText(d).filter(x=>x.reason==="SEPARATE_COVER_PAGE");
assert.equal(spans.length,8,"Full standalone cover not detected");
for(const x of [title,"Research Essay – Question 7","What do researchers mean","Word count (essay body): 2,055","27 October 2026"]) assert(!r.text.includes(x),"Cover leaked: "+x);
assert(r.text.includes(normal),"Real prose lost");
const m=build(true),mixed=buildAiInput(m.text,m);
assert(mixed.text.includes(normal),"Mixed-page prose lost");
assert.equal(classifyAiStructuralText(m).filter(x=>x.reason==="SEPARATE_COVER_PAGE").length,0,"Mixed first page must not be wholly excluded");
console.log("PASS: assignment-question cover excluded; essay prose and mixed first pages protected.");
