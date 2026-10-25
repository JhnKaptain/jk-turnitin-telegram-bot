"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {auditPptxPdf} = require("./jk-pptx-fidelity.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "jk-pptx-test-"));
try {
  const filename = path.join(root, "sample.pptx");
  const py = String.raw`import sys,zipfile
out=sys.argv[1]
presentation='<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>'
rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>'
def slide(text):
  return '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>'+text+'</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
with zipfile.ZipFile(out,"w") as z:
 z.writestr("ppt/presentation.xml",presentation)
 z.writestr("ppt/_rels/presentation.xml.rels",rels)
 z.writestr("ppt/slides/slide1.xml",slide("Alpha Beta Gamma Delta Echo"))
 z.writestr("ppt/slides/slide2.xml",slide("Theta Lambda Mu Nu Omicron"))
`;
  const made=spawnSync("python3",["-c",py,filename],{encoding:"utf8"});
  assert.equal(made.status,0,made.stderr);
  const good={
    pageCount:2,
    text:"Alpha Beta Gamma Delta Echo\n\nTheta Lambda Mu Nu Omicron",
    pages:[{start:0,end:27},{start:29,end:55}]
  };
  // Derive exact boundaries, do not guess spaces and indices.
  const first="Alpha Beta Gamma Delta Echo";
  good.pages=[
    {start:0,end:first.length},
    {start:first.length+2,end:good.text.length}
  ];
  assert.equal(auditPptxPdf(filename,good).slideCount,2);
  assert.throws(()=>auditPptxPdf(filename,{...good,pageCount:3}),/slide count/);
  assert.throws(()=>auditPptxPdf(filename,{...good,text:"Other text",pages:[
    {start:0,end:5},{start:5,end:10}]}),/searchable text|text/);
  assert.throws(()=>auditPptxPdf(filename,{...good,text:"Alpha Beta Gamma Delta Echo\n\n",
    pages:[{start:0,end:first.length},{start:first.length+2,end:first.length+2}]}),/lost all selectable text/);
  const bot=fs.readFileSync(path.join(__dirname,"bot.js"),"utf8");
  assert.match(bot,/needsSimilarityApiApproval\(job,file\)/);
  assert.match(bot,/JK_SIM_APPROVE_/);
  assert.match(bot,/similarityApiApprovedAt/);
  assert.match(bot,/if \(needsSimilarityApiApproval\(job,file\)\)/);
  console.log("PASS: PPTX slide-order/content audits, no-text rejection, and similarity admin guards.");
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
