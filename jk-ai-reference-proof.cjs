"use strict";

// Independent safeguard for a *specific, unambiguous* reference layout.
// The primary bibliography parser remains authoritative for other formats.
// This proof is deliberately strict: a late "List of References" heading,
// at least five author-year citation starts, at least two DOI/URL lines,
// and a separate named Generative AI declaration must all be present.
// If uncertain, return null and defer to the existing administrator review.
function verifiedListOfReferences(source) {
  const text = String(source ?? "");
  const heading = /^[ \t]*LIST[ \t]+OF[ \t]+REFERENCES?[ \t]*:[ \t]*(?=\r?\n|$)/gim;
  const hits = [...text.matchAll(heading)];
  if (hits.length !== 1) return null;
  const start = hits[0].index;
  if (start < text.length * 0.45) return null;
  const declaration = /^[ \t]*GENERATIVE[ \t]+AI[ \t]+USE[ \t]+DECLARATION[ \t]*:[ \t]*MANDATORY[ \t]*(?=\r?\n|$)/gim;
  const endings = [...text.matchAll(declaration)].filter(m => m.index > start);
  if (endings.length !== 1) return null;
  const end = endings[0].index;
  if (end <= start + 250 || end - start > 15000) return null;
  const inside = text.slice(start,end);
  const citations = (inside.match(/(?:^|\n)[ \t]*[\p{Lu}][\p{L}\p{M}'’.-]{1,65},[ \t]+(?:[\p{Lu}][\p{L}\p{M}'’.-]*[.,]?[ \t]*){1,5}[\s\S]{0,130}?\((?:19|20)\d{2}[a-z]?\)/gmu)||[]).length;
  const dated = (inside.match(/\((?:19|20)\d{2}[a-z]?\)/gu)||[]).length;
  const doi = (inside.match(/(?:https?:\/\/|doi\s*:)/giu)||[]).length;
  if (citations < 5 || dated < 7 || doi < 2) return null;
  // Never classify independent question/section content within a bibliography.
  if (/^[ \t]*(?:QUESTION[ \t]+(?:ONE|TWO|THREE|FOUR|\d+)|TASK[ \t]+\d+|CHAPTER[ \t]+\d+|APPENDIX\b|INTRODUCTION[ \t]*:|CONCLUSION[ \t]*:)/gimu.test(inside)) return null;
  return {start,end,reason:"VERIFIED_EXPLICIT_REFERENCE_LIST_BEFORE_DECLARATION",citations,dated,doi};
}
function verifyPreparedReferenceIsolation(prepared, source, label="AI") {
  const proof=verifiedListOfReferences(source);
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
function visualReferenceSpans(source) {
  const proof=verifiedListOfReferences(source);
  return proof?[{start:proof.start,end:proof.end,text:source.slice(proof.start,proof.end),reason:proof.reason}]:[];
}
module.exports={verifiedListOfReferences,verifyPreparedReferenceIsolation,visualReferenceSpans};
