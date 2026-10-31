"use strict";
const assert=require("node:assert/strict");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const {detectFourQuestionTemplate}=require("./jk-ai-provided-assessment.cjs");
const {classifyAiStructuralText}=require("./jk-ai-structure.js");
const {excludeAiNonProseRanges}=require("./jk-ai-visual-mask.cjs");
const scan=require("./jk-scan-text.js");

// Source-derived structure of SC60100300GS07 (2).docx:
// 11 pages; four explicit question papers, Response Word Count + Question
// Answer markers, LIST OF REFERENCES:, then mandatory generative-AI notice.
// All assertions are offline. The fixture deliberately has enough substantial
// answer text so only the supplied template is removed.
const lines=[];const add=(text,page)=>lines.push({text,page});
add("152.366 Operations Management in International Business",1);
add("Semester Two, 2026",1);
add("Time-constrained Assessment (FINAL)",1);
add("30TH October to 2nd November, 2026",1);
add("INSTRUCTIONS - READ THESE BEFORE YOU START:",1);
add("This is a compulsory open book assessment and accounts for 50 percent of the overall course mark.",1);
add("INSTRUCTIONS:",1);
add("On receiving this document, SAVE IT AS A WORD FILE TO YOUR COMPUTER with your surname and course details.",1);
add("This document is pre-formatted, DO NOT change anything in this document other than inserting your responses into the appropriate areas.",1);
add("Provide your answer to each question in this document only in the area that has been highlighted MY RESPONSE.",1);
add("Complete ALL the highlighted MY RESPONSE sections and answer ALL FOUR QUESTIONS.",1);
add("By submitting this document to Stream, you tacitly declare that it is YOUR OWN ORIGINAL INDIVIDUAL WORK.",1);
add("You are required to answer ALL FOUR QUESTIONS in this document.",1);
add("Student Name MY RESPONSE",1);
add("Student ID number MY RESPONSE",1);
add("Student Campus MY RESPONSE",1);
add("ANSWER ALL OF THE FOLLOWING QUESTIONS",2);
const names=["ONE","TWO","THREE","FOUR"];
const responseSnippets=[
  "Aurora Living Group faces a fundamental mismatch between its forecasting practices and the demand characteristics of its diverse product portfolio.",
  "Aurora Living Group's commitment to world-class performance simultaneously across markets and categories is ambitious but insufficiently differentiated.",
  "Aurora Living Group's appliance sourcing consolidation demonstrates risks of prioritising purchasing efficiency without evaluating supply chain resilience.",
  "Aurora Living Group's Kea kettle incident exposes fundamental weaknesses in its quality management system and pre-shipment inspection."
];
const answerStarts=[];
for(let i=0;i<4;i++){
  add("QUESTION "+names[i]+" (25 MARKS): Evaluate the organisation's performance and explain how management should respond to operational challenges across the business.",2+i*2);
  add("Response Word Count "+[725,711,705,710][i],2+i*2);
  add("Question Answer",2+i*2);
  add((i+1)+". Critical Evaluation of the Existing Operations Strategy",2+i*2);
  answerStarts.push(responseSnippets[i]);
  for(let j=0;j<12;j++)add(responseSnippets[i]+" These findings require managerial accountability and careful cost analysis to maintain a sound international supply chain.",2+i*2+(j>=6?1:0));
}
add("LIST OF REFERENCES:",10);
add("Cachon, G. P., & Swinney, R. (2011). The value of fast fashion: Quick response, enhanced",10);
add("design, and strategic consumer behavior. Management Science, 57(4), 778–795.",10);
add("https://doi.org/10.1287/mnsc.1100.1303",10);
add("Caro, F., & Gallien, J. (2007). Dynamic assortment with demand learning for seasonal consumer goods.",10);
add("Deming, W. E. (2000). Out of the crisis. MIT Press.",10);
add("Fildes, R., Goodwin, P., Lawrence, M., & Nikolopoulos, K. (2009). Effective forecasting and",10);
add("judgmental adjustments: An empirical evaluation and strategies for improvement.",10);
add("https://doi.org/10.1016/j.ijforecast.2008.11.010",10);
add("International Organization for Standardization. (2015). Quality management systems—",10);
add("Requirements (ISO 9001:2015). https://www.iso.org/standard/62085.html",10);
add("Kaplan, R. S., & Norton, D. P. (1996). Linking the balanced scorecard to strategy.",11);
add("Sousa, R., & Voss, C. A. (2002). Quality management re-visited: A reflective review.",11);
add("https://doi.org/10.1016/S0272-6963(01)00088-2",11);
add("GENERATIVE AI USE DECLARATION: MANDATORY",11);
add("Complete the Generative AI use declaration (see Word document in Stream) whether you",11);
add("have used AI in the preparation of this assessment or not. NOTE: Fully AI generated",11);
add("responses will be severely penalised.",11);
add("FAILURE TO COMPLETE THIS DECLARATION WILL RESULT IN YOUR ASSESSMENT NOT BEING MARKED!",11);
let source="",pages=new Map(),ys=new Map();
for(const row of lines){
  const start=source.length;source+=row.text+"\n";
  const y=ys.get(row.page)??730;
  ys.set(row.page,y-14);
  const item={text:row.text,start,end:start+row.text.length,
    x:72,y,height:11,width:Math.min(460,row.text.length*5),
    pageNumber:row.page,fontName:"LiberationSans"};
  if(!pages.has(row.page))pages.set(row.page,[]);
  pages.get(row.page).push(item);
}
const document={text:source,pages:[...pages].map(([pageNumber,items])=>({
  pageNumber,items,width:612,height:792,rotation:0
}))};
const firstRef=source.indexOf("LIST OF REFERENCES:");
const declaration=source.indexOf("GENERATIVE AI USE DECLARATION:");
assert(firstRef>0&&declaration>firstRef);
const refs=inspectReferenceSections(source,-1,[],document);
assert.equal(refs.reviews.length,0,JSON.stringify(refs.reviews));
assert.equal(refs.ranges.length,1,JSON.stringify(refs.ranges));
assert.equal(refs.ranges[0].start,firstRef);
assert.equal(refs.ranges[0].end,declaration);
const verified=detectFourQuestionTemplate(document);
assert.equal(verified.verified,true,verified.reason);
assert.equal(verified.intervals.filter(i=>i.reason==="VERIFIED_SUPPLIED_QUESTION_AND_TABLE").length,4);
const structured=classifyAiStructuralText(document);
assert(structured.some(s=>s.reason==="VERIFIED_SUPPLIED_QUESTION_AND_TABLE"));
const ai=scan.buildAiInput(source,document);
const similarity=scan.buildSimilarityInput(source,scan.FILTER_MODE_FILTERED,[],document);
for(const opening of answerStarts) {
  assert(ai.text.includes(opening),"AI answer lost: "+opening);
  assert(similarity.text.includes(opening),"Similarity answer lost: "+opening);
  const at=ai.text.indexOf(opening);
  assert.equal(source.slice(ai.map[at],ai.map[at]+opening.length),opening);
}
for(const marker of ["INSTRUCTIONS - READ","QUESTION ONE (25 MARKS)","QUESTION FOUR (25 MARKS)",
 "LIST OF REFERENCES:","Cachon, G.","Kaplan, R.","GENERATIVE AI USE DECLARATION","FAILURE TO COMPLETE THIS DECLARATION"]){
  assert(!ai.text.includes(marker),"Included supplied material in AI: "+marker);
}
assert(similarity.text.includes("QUESTION ONE (25 MARKS)"),"Similarity submission must remain unchanged except bibliography");
assert(!similarity.text.includes("Cachon, G."),"Similarity bibliography leaked");
assert(similarity.text.includes("GENERATIVE AI USE DECLARATION"),"Following non-reference section removed");
const painted=excludeAiNonProseRanges([{start:0,end:source.length}],document);
const intersects=(a,b)=>painted.some(r=>r.start<b&&r.end>a);
assert(!intersects(0,source.indexOf("QUESTION ONE")));
assert(!intersects(source.indexOf("QUESTION THREE (25 MARKS)"),
                     source.indexOf("Question Answer",source.indexOf("QUESTION THREE (25 MARKS)"))+15));
assert(intersects(source.indexOf(answerStarts[1]),source.indexOf(answerStarts[1])+40));
console.log("PASS: 4 answer regions preserved; supplied instructions/prompts/declaration excluded from AI only");
console.log("PASS: LIST OF REFERENCES filter excludes exactly bibliography, preserves subsequent declaration");
console.log("PASS: source-offset map and visual masking preserve substantive answer highlights");

// Negative: generic question-and-answer prose, no explicit preformatted four-question contract.
const fake={...document,text:source.replace("This document is pre-formatted","In this essay we evaluate"),pages:[]};
assert.equal(detectFourQuestionTemplate(fake).verified,false,"Do not exclude unfamiliar answer structure");
console.log("PASS: no blanket question-prompt removal on unverified documents");
