"use strict";

// Independent safeguard for a *specific, unambiguous* reference layout.
// The primary bibliography parser remains authoritative for other formats.
// This proof is deliberately strict: a late "List of References" heading,
// at least five author-year citation starts, at least two DOI/URL lines,
// and a separate named Generative AI declaration must all be present.
// If uncertain, return null and defer to the existing administrator review.
function layoutHeadings(layoutDocument) {
  const rows=[];
  for(const page of layoutDocument?.pages||[]) {
    const items=(page.items||[]).filter(item =>
      Number.isInteger(item?.start) && Number.isInteger(item?.end) &&
      Number.isFinite(item?.x) && Number.isFinite(item?.y) &&
      typeof item?.text==="string" && item.end>item.start)
      .sort((a,b)=>a.start-b.start);
    // A styled Word heading may consist of many font-run fragments with
    // slightly different baselines. Canonical PDF.js text can contain a
    // newline between fragments even while they occupy one visual line.
    for(let i=0;i<items.length;i++) {
      let joined="",last=null;
      for(let j=i;j<Math.min(i+20,items.length);j++) {
        const x=items[j];
        if(last) {
          const tolerance=0.9*Math.max(Number(last.height)||1,Number(x.height)||1);
          if(Math.abs(x.y-items[i].y)>tolerance ||
             x.x+2<last.x) break;
        }
        joined+=x.text;
        last=x;
        const compact=joined.replace(/[^\p{L}\p{N}]/gu,"").toUpperCase();
        const kind=compact==="LISTOFREFERENCES"||compact==="LISTOFREFERENCE"
          ?"REFERENCE_HEADING":
          compact==="GENERATIVEAIUSEDECLARATIONMANDATORY"
          ?"DECLARATION":null;
        if(kind) {
          rows.push({kind,start:items[i].start,end:x.end,
            pageNumber:Number(page.pageNumber||x.pageNumber)});
          break;
        }
      }
    }
  }
  // Different leading sub-runs can yield duplicate detections; require
  // exactly one candidate of each type after removing identical endpoints.
  return [...new Map(rows.map(row=>[row.kind+":"+row.end,row])).values()];
}
function verifiedReferenceFromLayout(source,layoutDocument) {
  if(!Array.isArray(layoutDocument?.pages))return null;
  const marks=layoutHeadings(layoutDocument);
  const starts=marks.filter(x=>x.kind==="REFERENCE_HEADING");
  const ends=marks.filter(x=>x.kind==="DECLARATION");
  if(starts.length!==1||ends.length!==1)return null;
  const start=starts[0].start,end=ends[0].start;
  if(start<source.length*.45||end<=start+250||end-start>15000)return null;
  const inside=source.slice(start,end);
  const dated=(inside.match(/\((?:19|20)\d{2}[a-z]?\)/gu)||[]).length;
  const doi=(inside.match(/(?:https?:\/\/|doi\s*:)/giu)||[]).length;
  // Date / URL proof remains mandatory. Never use visual placement alone to
  // delete text, nor assume all content following a reference heading is a
  // bibliography. An unfamiliar ending goes to administrator review.
  if(dated<7||doi<2)return null;
  const startsByAuthor=(inside.match(/(?:^|\n)\s*[\p{Lu}][\p{L}\p{M}.'’\-]{1,65},[^\n]{0,180}\((?:19|20)\d{2}[a-z]?\)/gmu)||[]).length;
  if(startsByAuthor<5)return null;
  if(/^[ \t]*(?:QUESTION[ \t]+(?:ONE|TWO|THREE|FOUR|\d+)|TASK[ \t]+\d+|CHAPTER[ \t]+\d+|APPENDIX\b)/gimu.test(inside))return null;
  return {start,end,dated,doi,citations:startsByAuthor,reason:"VERIFIED_VISUAL_REFERENCE_HEADING_AND_DECLARATION"};
}

function verifiedListOfReferences(source, layoutDocument = null) {
  const text = String(source ?? "");
  const heading = /^[ \t]*LIST[ \t]+OF[ \t]+REFERENCES?[ \t]*:[ \t]*(?=\r?\n|$)/gim;
  const hits = [...text.matchAll(heading)];
  if (hits.length !== 1) return verifiedReferenceFromLayout(text,layoutDocument);
  const start = hits[0].index;
  if (start < text.length * 0.45) return null;
  const declaration = /^[ \t]*GENERATIVE[ \t]+AI[ \t]+USE[ \t]+DECLARATION[ \t]*:[ \t]*MANDATORY[ \t]*(?=\r?\n|$)/gim;
  const endings = [...text.matchAll(declaration)].filter(m => m.index > start);
  if (endings.length !== 1) return verifiedReferenceFromLayout(text,layoutDocument);
  const end = endings[0].index;
  if (end <= start + 250 || end - start > 15000) return verifiedReferenceFromLayout(text,layoutDocument);
  const inside = text.slice(start,end);
  const citations = (inside.match(/(?:^|\n)[ \t]*[\p{Lu}][\p{L}\p{M}'’.-]{1,65},[ \t]+(?:[\p{Lu}][\p{L}\p{M}'’.-]*[.,]?[ \t]*){1,5}[\s\S]{0,130}?\((?:19|20)\d{2}[a-z]?\)/gmu)||[]).length;
  const dated = (inside.match(/\((?:19|20)\d{2}[a-z]?\)/gu)||[]).length;
  const doi = (inside.match(/(?:https?:\/\/|doi\s*:)/giu)||[]).length;
  if (citations < 5 || dated < 7 || doi < 2) return verifiedReferenceFromLayout(text,layoutDocument);
  // Never classify independent question/section content within a bibliography.
  if (/^[ \t]*(?:QUESTION[ \t]+(?:ONE|TWO|THREE|FOUR|\d+)|TASK[ \t]+\d+|CHAPTER[ \t]+\d+|APPENDIX\b|INTRODUCTION[ \t]*:|CONCLUSION[ \t]*:)/gimu.test(inside)) return null;
  return {start,end,reason:"VERIFIED_EXPLICIT_REFERENCE_LIST_BEFORE_DECLARATION",citations,dated,doi};
}
function verifyPreparedReferenceIsolation(prepared, source, label="AI", document=null) {
  const proof=verifiedListOfReferences(source,document);
  if (!proof) return null;
  const existing=Array.isArray(prepared?.removedReferenceRanges)
    ? prepared.removedReferenceRanges : [];
  const contained=existing.some(r=>Number.isInteger(r.start)&&Number.isInteger(r.end)&&
    r.start<=proof.start&&r.end>=proof.end);
  if (!contained) {
    const error=new Error(label+": verified bibliography was not excluded from provider input");
    error.code="REFERENCE_EXCLUSION_INTEGRITY_FAILED";
    error.noProviderRequests=true;
    error.apiBlocked=true;
    throw error;
  }
  const map=Array.isArray(prepared?.map)?prepared.map:[];
  if(map.some(n=>Number.isInteger(n)&&n>=proof.start&&n<proof.end)) {
    const error=new Error(label+": verified bibliography leaked through source mapping");
    error.code="REFERENCE_EXCLUSION_INTEGRITY_FAILED";
    error.noProviderRequests=true;
    error.apiBlocked=true;
    throw error;
  }
  return proof;
}
function visualReferenceSpans(source,document=null) {
  const proof=verifiedListOfReferences(source,document);
  return proof?[{start:proof.start,end:proof.end,text:source.slice(proof.start,proof.end),reason:proof.reason}]:[];
}
module.exports={verifiedListOfReferences,verifyPreparedReferenceIsolation,visualReferenceSpans,verifiedReferenceFromLayout,layoutHeadings};
