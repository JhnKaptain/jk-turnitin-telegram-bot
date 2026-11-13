"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {reportSourceGutters}=require("./jk-report-source-gutters.cjs");
const sourcePage=(height,...lines)=>({width:612,height,elements:lines.map(([bottom,h],i)=>({text:"Body sentence "+i,style:{bottom,height:h,left:60,width:200}}))});
assert.deepEqual(reportSourceGutters([sourcePage(792,[75,12],[680,12])]),{top:0,bottom:0});
assert.deepEqual(reportSourceGutters([sourcePage(792,[1.4,12],[680,12])]),{top:0,bottom:63});
assert.deepEqual(reportSourceGutters([sourcePage(792,[75,12],[740,12])]),{top:6,bottom:0});
assert.deepEqual(reportSourceGutters([sourcePage(792,[2,12],[770,12])]),{top:36,bottom:62});
assert.deepEqual(reportSourceGutters([sourcePage(842,[2,12])]),{top:0,bottom:62});
assert.deepEqual(reportSourceGutters([sourcePage(842,[90,12])]),{top:0,bottom:0});
assert.deepEqual(reportSourceGutters([sourcePage(792,[55,12],[731.6,12])]),{top:0,bottom:9});
assert.deepEqual(reportSourceGutters([sourcePage(792,[90,12],[731.6,12])]),{top:0,bottom:0});
assert.deepEqual(reportSourceGutters([{height:792,elements:[{text:"",style:{bottom:0,height:12}}]}]),{top:0,bottom:0});
// End.docx's real source first text starts at ~48.4pt, already clear.
assert.equal(reportSourceGutters([sourcePage(792,[10,12],[731.6,12])]).top,0);
const renderer=fs.readFileSync(path.join(__dirname,"jk-report-renderer-max.js"),"utf8");
const {fitReportSourcePage, assertReportTemplatePages, HEADER_BAND, FOOTER_BAND}=require("./jk-report-page-geometry.cjs");
const template=(width,height,gutters)=>fitReportSourcePage(width,height,gutters);
const letter=template(612,792,{top:0,bottom:0});
assert.deepEqual([letter.pageWidth,letter.pageHeight,letter.sourceScale,letter.sourceX,letter.sourceY],[612,792,1,0,0],
  "clean Letter documents keep the established page geometry and original 1:1 scale");
const oversized=template(2592,1761,{top:0,bottom:0});
assert.equal(oversized.pageWidth,612);
assert.equal(oversized.pageHeight,792);
assert(oversized.sourceScale>0 && oversized.sourceScale<1);
assert(Math.abs(oversized.sourceScale*2592-612)<0.01,"slide/poster stays proportional, not stretched");
assert(oversized.sourceY>=FOOTER_BAND,"poster graphics clear branded footer");
assert(Math.abs(oversized.sourceY+oversized.sourceScale*1761-(792-HEADER_BAND))<1e-7,
  "full-bleed Human Rights banner begins just below the standard report header, not centered low");
assert(Math.abs(oversized.sourceY-330.2083333333333)<1e-7,
  "2592x1761 real poster moves up by 133.1pt versus the previous centered layout");
const a4=template(595,842,{top:0,bottom:0});
assert.equal(a4.pageWidth,612);assert.equal(a4.pageHeight,792);
assert(a4.sourceX>0 && a4.sourceY>=FOOTER_BAND,"A4 fits horizontally with safe footer clearance");
assert(Math.abs(a4.sourceY+842*a4.sourceScale-(792-HEADER_BAND))<1e-7,
  "A4 begins at the same header tolerance as poster and ordinary Letter content");
const crowded=template(612,792,{top:36,bottom:62});
assert(crowded.sourceScale<1,"text hitting the header/footer must not overlap the shell");
assert(crowded.sourceY>=FOOTER_BAND &&
  Math.abs(crowded.sourceY+crowded.sourceScale*792-(792-HEADER_BAND))<1e-7);
for(const [w,h] of [[612,792],[595,842],[792,612],[2592,1761],[7680,4320]]){
 const g=template(w,h,{top:8,bottom:9});
 assert.equal(g.pageWidth,612); assert.equal(g.pageHeight,792);
 assert(g.sourceX>=0 && g.sourceX+w*g.sourceScale<=612+1e-7);
 assert(g.sourceY>=FOOTER_BAND);
 assert(Math.abs(g.sourceY+h*g.sourceScale-(792-HEADER_BAND))<1e-7,
   "fitted pages must share the normal report header tolerance");
}
assert.throws(()=>template(0,792),/Invalid original PDF page dimensions/);
assert.throws(()=>template(612,Infinity),/Invalid original PDF page dimensions/);
const mkPage=(width,height)=>({getWidth:()=>width,getHeight:()=>height});
assert.equal(assertReportTemplatePages({getPages:()=>[mkPage(612,792),mkPage(612,792)]}),2);
assert.throws(()=>assertReportTemplatePages({getPages:()=>[
  mkPage(612,792),mkPage(2592,1761)]}),/template violation: page 2/);
assert.equal(renderer.split("assertReportTemplatePages(doc);").length-1,2,
  "both AI and similarity PDFs must pass final physical page-size audit");
for(const token of [
 'require("./jk-report-source-gutters.cjs")',
 'require("./jk-report-page-geometry.cjs")',
 'const sourceGutters = reportSourceGutters([original]);',
 'const geometry = fitReportSourcePage(',
 'geometry.pageWidth,',
 'geometry.pageHeight',
 'const { sourceScale, sourceX, sourceY } = geometry;',
 'width:\\n            sourceWidth *\\n            sourceScale'
])assert(renderer.includes(token.replaceAll('\\n','\n')),token);
console.log("PASS: normal margins and actual end.docx top whitespace unchanged.");
console.log("PASS: minimal extra footer clearance only when needed; no oversized top gutter.");
console.log("PASS: all report pages stay 612x792, slide/PPTX/A4 proportional fitting, shell-safe headers/footers.");
console.log("Offline only. No provider APIs, customer deliveries or Render deployment.");
