"use strict";
// Entirely offline. Uses synthetic text/layout by default. Optionally audits a
// locally held provider checkpoint WITHOUT shipping customer documents to Git.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {classifyAiStructuralText,excludeAiStructuralText}=require("./jk-ai-structure.js");
const {excludeAiNonProseRanges}=require("./jk-ai-visual-mask.cjs");
function makeDoc(pages) {
 let source="",out=[];
 for(const lines of pages){const items=[];for(const row of lines){
  const text=row.t,start=source.length;source+=text+"\n";
  items.push({text,start,end:start+text.length,x:row.x??72,y:row.y,width:row.w??Math.max(25,text.length*4.5),height:row.h??12,
    fontName:row.font??"body",hasEOL:true});
 }out.push({pageNumber:out.length+1,width:612,height:792,rotation:0,items});}
 return {text:source,pages:out};
}
const body="Packaging operations require careful comparisons of materials and recovery costs in community settings.";
const below="Normal narrative paragraphs following a table must remain eligible for the AI classification process.";
const d=makeDoc([
 [{t:"Literature review",font:"head",h:14,y:704},
  {t:"Material choices and environmental performance",font:"head",h:12,y:678},
  {t:body,y:655},{t:body,y:638},{t:body,y:621},
  {t:"Business feasibility and reuse systems",font:"head",y:585},
  {t:body,y:560},{t:body,y:541}],
 [{t:"Appendix selected published data",font:"head",h:14,y:695},
  {t:body,y:673},{t:body,y:655},
  {t:"Study",font:"head",h:11,x:76,y:609,w:35},
  {t:"Published data",font:"head",h:11,x:181,y:609,w:81},
  {t:"Interpretive limit",font:"head",h:11,x:397,y:609,w:86},
  {t:"Author A (2022)",x:76,h:11,y:570,w:90},
  {t:"Sample data for the first published study",x:181,h:11,y:570,w:180},
  {t:"The stated scope is limited",x:397,h:11,y:570,w:120},
  {t:"Author B (2023)",x:76,h:11,y:530,w:90},
  {t:"The second report contains aggregate information",x:181,h:11,y:530,w:190},
  {t:"Surveys do not establish causality",x:397,h:11,y:530,w:150},
  {t:"Author C (2024)",x:76,h:11,y:490,w:90},
  {t:"A third result measured participation",x:181,h:11,y:490,w:170},
  {t:"The sample was geographically limited",x:397,h:11,y:490,w:150},
  {t:"Author D (2025)",x:76,h:11,y:450,w:90},
  {t:"The fourth analysis includes a secondary dataset",x:181,h:11,y:450,w:192},
  {t:"Associations do not prove causality",x:397,h:11,y:450,w:150},
  {t:below,y:395},{t:body,y:375},{t:body,y:357}],
]);
const spans=classifyAiStructuralText(d);
const includes=(value,reason)=>spans.some(s=>s.text===value&&s.reason===reason);
assert(includes("Literature review","LAYOUT_STANDALONE_HEADING"));
assert(includes("Material choices and environmental performance","LAYOUT_STANDALONE_HEADING"));
assert(includes("Business feasibility and reuse systems","LAYOUT_STANDALONE_HEADING"));
assert(includes("Appendix selected published data","LAYOUT_STANDALONE_HEADING"));
assert(includes("Published data","LAYOUT_TABLE_HEADER"));
assert(includes("Author C (2024)","LAYOUT_TABLE_CELL"));
assert(!spans.some(s=>s.text===body||s.text===below),"body prose was incorrectly excluded");
const identity={text:d.text,map:[...d.text].map((_,i)=>i)};
const prepared=excludeAiStructuralText(identity,d);
assert.equal(prepared.map.length,d.text.length);
assert.equal(prepared.text.length,d.text.length);
const protectedStart=d.text.indexOf("Literature review");
for(let i=protectedStart;i<protectedStart+"Literature review".length;i++)assert.equal(prepared.map[i],null);
for(const excerpt of [body,below]){
 const at=d.text.indexOf(excerpt);
 assert(at>=0);for(let i=at;i<at+excerpt.length;i++)assert.equal(prepared.map[i],i,`narrative char incorrectly masked at ${i}`);
}
const visible=excludeAiNonProseRanges([{start:0,end:d.text.length,kind:"test"}],d);
const contains=i=>visible.some(r=>r.start<=i&&i<r.end);
assert(!contains(d.text.indexOf("Author C (2024)")));
assert(!contains(d.text.indexOf("Literature review")));
assert(contains(d.text.indexOf(below)));
console.log("PASS: sentence-case headings, native-looking 3-column table, shared input/render mask, original offsets, paragraph preservation. Offline only.");
if(process.env.JK_PACKAGING_CHECKPOINT){
 const p=process.env.JK_PACKAGING_CHECKPOINT;assert(fs.existsSync(p),"checkpoint not found");
 const j=JSON.parse(fs.readFileSync(p,"utf8")),c=j.canonicalDocument;
 const got=classifyAiStructuralText(c);
 const textSet=new Set(got.map(s=>s.text.trim()));
 for(const name of ["Literature review","Material choices and environmental performance","Business feasibility and reuse systems","Consumer acceptance and behaviour","Data collection and analysis","Study","Published data","Interpretive limit","Project Timetable"])
  assert(textSet.has(name),`production heading/table item not classified: ${name}`);
 const excluded=new Set(got.map(s=>s.start+":"+s.end));
 const narratives=["Circular economy thinking provides a useful framework for examining packaging changes. Zhu",
 "The project plan structures the research into related activities, with verification taking place even",
 "The extracts below reproduce published aggregate results and sample sizes. They are secondary"];
 for(const bodyText of narratives){const i=c.pages.flatMap(p=>p.items).find(x=>x.text.startsWith(bodyText));
  assert(i,"production narrative missing");assert(!excluded.has(i.start+":"+i.end),"production narrative excluded");}
 assert.equal(j.providerResults.ai.value.percent,45.6);
 assert.equal(j.providerResults.similarity.value.score,2);
 console.log("PASS: saved production Packaging layout, sentence-case headings, two different tables, unchanged scores. No provider calls or writes.");
}
