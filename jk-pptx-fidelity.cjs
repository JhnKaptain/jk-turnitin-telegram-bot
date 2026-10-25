"use strict";
const {spawnSync} = require("node:child_process");
function review(reason) {
  const e = new Error("PPTX layout/text fidelity requires manual review: " + reason);
  e.code = "PPTX_FIDELITY_REVIEW";
  e.apiBlocked = true;
  throw e;
}
function tokens(text) {
  return String(text || "").normalize("NFKC").toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
}
function auditPptxPdf(inputFile, document) {
  const py = String.raw`import sys,zipfile,re,xml.etree.ElementTree as E,json
f=sys.argv[1]
with zipfile.ZipFile(f) as z:
    names=[n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide[1-9][0-9]*\.xml",n)]
    # Use Presentation slide order from ppt/presentation.xml + relationships.
    pres=E.fromstring(z.read("ppt/presentation.xml"))
    rels=E.fromstring(z.read("ppt/_rels/presentation.xml.rels"))
    relmap={r.attrib["Id"]:r.attrib["Target"] for r in rels}
    rid="{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    slideList=pres.find("{http://schemas.openxmlformats.org/presentationml/2006/main}sldIdLst")
    ordered=[]
    if slideList is not None:
        for item in slideList:
            target=relmap.get(item.attrib.get(rid))
            if not target: raise ValueError("Missing PPTX slide relationship")
            target=target.lstrip("/")
            name=("ppt/"+target if not target.startswith("ppt/") else target)
            name=name.replace("ppt/../","")
            if name not in names: raise ValueError("Invalid PPTX slide relationship")
            ordered.append(name)
    if len(ordered)!=len(names): raise ValueError("PPTX slide count mismatch")
    t="{http://schemas.openxmlformats.org/drawingml/2006/main}t"
    out=[]
    for name in ordered:
        root=E.fromstring(z.read(name))
        strings=[x.text or "" for x in root.iter(t)]
        out.append(" ".join(strings))
    print(json.dumps(out,ensure_ascii=False))
`;
  const checked = spawnSync("python3",["-c",py,inputFile],{encoding:"utf8",timeout:15000,maxBuffer:4*1024*1024});
  if (checked.status !== 0 || checked.error) review("Cannot inspect original slide XML.");
  let slides;
  try {slides = JSON.parse(checked.stdout);} catch {review("Invalid PPTX slide audit response.");}
  if (!Array.isArray(slides) || !slides.length ||
      slides.length !== document.pageCount || slides.length !== document.pages?.length)
    review("Converted PDF page count does not match original slide count.");
  let sourceWords=0,seenWords=0;
  for(let i=0;i<slides.length;i++) {
    const expected=tokens(slides[i]);
    const page=document.pages[i];
    const actual=tokens(document.text.slice(page.start,page.end));
    if(expected.length > 0 && actual.length === 0) review("Slide "+(i+1)+" lost all selectable text.");
    // Check counts as bags; avoids false mismatch when Impress lays out
    // separate text boxes in a different visual reading order.
    const present=new Map();
    for(const word of actual)present.set(word,(present.get(word)||0)+1);
    let missing=0;
    for(const word of expected) {
      const available=present.get(word)||0;
      if(available) {present.set(word,available-1);seenWords++;}
      else missing++;
    }
    sourceWords+=expected.length;
    if(expected.length>=5 && missing/expected.length>0.15)
      review("Slide "+(i+1)+" lost too much searchable text.");
  }
  if(sourceWords < 1) review("Presentation has no selectable text.");
  if(sourceWords>=10 && seenWords/sourceWords<0.92)
    review("Insufficient original slide text verified in converted PDF.");
  return {slideCount:slides.length,sourceWords,verifiedWords:seenWords};
}
module.exports={auditPptxPdf};
