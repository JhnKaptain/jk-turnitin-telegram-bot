"use strict";
const assert = require("node:assert/strict");
const { buildAiInput, mapProviderRangesToSource } = require("./jk-scan-text.js");
const { classifyAiStructuralText } = require("./jk-ai-structure.js");
const observed = [
  ["From Purchasing Promises to Living Wages: H&M Group in Bangladesh",118.92773475,708.796875,374.14453122000015,12,"g_d12_f1"],
  ["Zhao Jiajun",277.8398475,678.199219,56.32031255999999,12,"g_d12_f2"],
  ["MGF5020 — Assessment 3: Individual Research Report",170.015625,650.6015620000001,271.9687537800002,12,"g_d12_f2"],
  ["Word count: 1996 (including abstract, headings and table caption; excluding contents and",91.20703125,623.003906,429.58593942000005,12,"g_d12_f2"],
  ["references)",279.35742375,595.406249375,53.285156400000005,12,"g_d12_f2"],
  ["“How should H&M Group enact its responsible purchasing practices to ensure living wages for",72,568.6938491075,457.01030104325196,11.00000025,"g_d12_f3"],
  ["garment workers in Bangladesh and demonstrate sustainable and responsible business ethics,",72,554.1475847075,460.72406314945795,11.00000025,"g_d12_f3"],
  ["in alignment with SDG 8?”",72,539.6013197075,127.69017019325199,11.00000025,"g_d12_f3"]
];
const body = "The analysis examines purchasing commitments and the evidence on workers’ wages in Bangladesh.";
function fixture({rows=observed, single=false, appendBody=false, badSource=false}={}) {
  const d={text:"",pages:[]};
  function addPage(data) {
    const start=d.text.length;
    const items=data.map(([text,x,y,width,height,fontName])=> {
      const start=d.text.length; d.text+=text+"\n";
      return {text,start,end:start+text.length,x,y,width,height,fontName,hasEOL:true};
    });
    d.pages.push({pageNumber:d.pages.length+1,start,end:d.text.length,width:612,height:792,rotation:0,items});
    d.text+="\n";
  }
  addPage(appendBody ? [...rows,[body,72,490,460,12,"body"]] : rows);
  if(!single) addPage(Array.from({length:15},(_,i)=>[body,72,700-i*28,460,12,"body"]));
  if(badSource) d.pages[0].items[1].text="Different Name";
  return d;
}
function assertMappedBody(document,prepared) {
  const pos=prepared.text.indexOf(body); assert(pos>=0);
  for(const unit of ["utf16","codepoint"]) {
    const start=unit==="utf16" ? pos : Array.from(prepared.text.slice(0,pos)).length;
    const length=unit==="utf16" ? body.length : Array.from(body).length;
    const ranges=mapProviderRangesToSource(prepared,[{start,end:start+length}],unit);
    assert.equal(ranges.length,1); assert.equal(document.text.slice(ranges[0].start,ranges[0].end),body);
  }
}
let d=fixture(), before=JSON.stringify(d), out=buildAiInput(d.text,d);
assert.equal(out.aiCoverPagesExcluded,1);
assert.equal(out.aiHeadingPolicy,"assessment-cover-and-formatted-labels-v4");
for(const item of d.pages[0].items) {
  assert(!out.text.includes(item.text),item.text);
  const mapped=mapProviderRangesToSource(out,[{start:0,end:out.text.length}],"utf16");
  assert(mapped.every(r=>r.end<=item.start || r.start>=item.end),"Highlight crosses excluded cover");
}
assertMappedBody(d,out); assert.equal(JSON.stringify(d),before);
assert.equal(out.map.length,out.text.length); assert.equal(out.text.length,d.text.length);
for(const options of [{appendBody:true},{single:true,appendBody:true}]) {
  d=fixture(options);out=buildAiInput(d.text,d);
  assert.equal(out.aiCoverPagesExcluded,0);assert.equal(out.aiCoverBlocksExcluded,1);
  assert(!out.text.includes("Zhao Jiajun"));assert(out.text.includes("How should H&M Group"));assertMappedBody(d,out);
}
d=fixture({single:true});out=buildAiInput(d.text,d);
assert.equal(out.aiCoverPagesExcluded,0);assert(out.text.includes("How should H&M Group"));
// Similar-looking ordinary prose cannot qualify without explicit metadata/layout evidence.
for(const change of [
  rows=>{rows[2][0]="This essay examines management decisions and organisational outcomes.";},
  rows=>{rows[3][0]="This section describes the evidence and explains the research findings.";},
  rows=>{rows[1][1]=72;},
  rows=>{rows[4][0]="references";},
  rows=>{rows[3][0]="Word count: 1996 (including evidence that proves a claim).";}
]) {
  const rows=observed.map(r=>r.slice());change(rows);d=fixture({rows});
  assert(!classifyAiStructuralText(d).some(s=>s.reason==="SEPARATE_COVER_PAGE"),"Uncertain cover excluded");
}
d=fixture({badSource:true});out=buildAiInput(d.text,d);
assert(out.text.includes("Zhao Jiajun"),"Mismatched source must be retained");
// An answer or unquoted question on a mixed page is retained.
const rows=observed.map(r=>r.slice());rows[5][0]=rows[5][0].slice(1);rows[7][0]=rows[7][0].slice(0,-1);
d=fixture({rows});out=buildAiInput(d.text,d);
assert.equal(out.aiCoverPagesExcluded,0);assert(out.text.includes("How should H&M Group"));
console.log("PASS: observed zjj cover layout, full title/name/course/word-count/question exclusion and unchanged source.");
console.log("PASS: mixed-page and single-page body preservation, source validation, UTF-16/codepoint mapping and null barriers.");
console.log("No provider requests, payments or deliveries.");
