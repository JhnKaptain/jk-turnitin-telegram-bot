"use strict";

// Highly constrained AI-only exclusion of PROVIDED question-paper material.
// A document qualifies only if it contains a complete four-question,
// preformatted assignment with four explicit response delimiters and a first
// page marked as an instruction/response template. This does not classify
// author-written essay headings, generic numbered questions or cover pages.
const ordered = ["ONE", "TWO", "THREE", "FOUR"];
const normalize = s => String(s || "").replace(/\s+/gu, " ").trim();

function detectFourQuestionTemplate(document) {
  const no = reason => ({verified:false,reason,spans:[]});
  if (typeof document?.text !== "string" || !Array.isArray(document.pages) ||
      document.pages.length < 4) return no("NO_MULTI_PAGE_TEMPLATE");
  const source=document.text;
  const question=/((?:^|\n)[ \t]*)(QUESTION[ \t]+(ONE|TWO|THREE|FOUR)\s*\(\s*\d{1,3}\s+MARKS\s*\)\s*:)/gimu;
  const headings=[...source.matchAll(question)].map(m=>({
    start:m.index+m[1].length, end:m.index+m[0].length,
    ordinal:m[3].toUpperCase()
  }));
  if (headings.length!==4 || headings.some((q,i)=>q.ordinal!==ordered[i]))
    return no("QUESTION_SEQUENCE_UNVERIFIED");

  const intro=source.slice(0,headings[0].start);
  if (intro.length<300 || intro.length>12000 ||
      !/INSTRUCTIONS\s*-\s*READ\s+THESE\s+BEFORE\s+YOU\s+START/iu.test(intro) ||
      !/this\s+document\s+is\s+pre[\s-]*formatted/iu.test(intro) ||
      !/student\s+name/iu.test(intro) ||
      (intro.match(/\bMY\s+RESPONSE\b/giu)||[]).length<3 ||
      !/ANSWER\s+ALL\s+OF\s+THE\s+FOLLOWING\s+QUESTIONS/iu.test(intro))
    return no("INSTRUCTION_PAGE_UNVERIFIED");

  const intervals=[{start:0,end:headings[0].start,reason:"VERIFIED_SUPPLIED_INSTRUCTIONS"}];
  for(let i=0;i<headings.length;i++) {
    const h=headings[i];
    const next=i+1<headings.length?headings[i+1].start:source.length;
    const block=source.slice(h.end,Math.min(next,h.end+2400));
    const wordCount=/\bResponse\s+Word\s+Count\s+(\d{2,4})\b/iu.exec(block);
    const answer=/\bQuestion\s+Answer\b/iu.exec(block);
    if(!wordCount || !answer || answer.index<=wordCount.index ||
       answer.index-wordCount.index>100 ||
       wordCount.index>1900)
      return no("RESPONSE_DELIMITER_MISSING");
    const answerStart=h.end+answer.index+answer[0].length;
    const answerSection=source.slice(answerStart,next);
    const answerWords=(answerSection.match(/\p{L}[\p{L}\p{M}'’\-]*/gu)||[]).length;
    if(answerWords<150) return no("SUBSTANTIVE_RESPONSE_UNVERIFIED");
    intervals.push({start:h.start,end:answerStart,reason:"VERIFIED_SUPPLIED_QUESTION_AND_TABLE"});
  }

  // The post-reference declaration is part of the same *provided* template
  // only when its mandatory instruction text matches. If a student has
  // written an actual declaration afterward, it remains in source input.
  const declaration=/\bGENERATIVE\s+AI\s+USE\s+DECLARATION\s*:\s*MANDATORY\b/iu.exec(source);
  if(declaration && declaration.index>headings[3].end) {
    const tail=source.slice(declaration.index,declaration.index+750);
    const hasInstruction=/Complete\s+the\s+Generative\s+AI\s+use\s+declaration\b/iu.test(tail);
    const mandatory=/FAILURE\s+TO\s+COMPLETE\s+THIS\s+DECLARATION\s+WILL\s+RESULT\s+IN\s+YOUR\s+ASSESSMENT\s+NOT\s+BEING\s+MARKED!/iu.exec(tail);
    if(hasInstruction && mandatory) intervals.push({
      start:declaration.index,
      end:declaration.index+mandatory.index+mandatory[0].length,
      reason:"VERIFIED_SUPPLIED_DECLARATION_INSTRUCTIONS"
    });
  }

  const spans=[];
  for(const page of document.pages) {
    for(const item of page.items || []) {
      if(!Number.isInteger(item?.start)||!Number.isInteger(item?.end) ||
         item.start<0||item.end<=item.start||
         source.slice(item.start,item.end)!==item.text) continue;
      for(const interval of intervals) {
        const start=Math.max(item.start,interval.start);
        const end=Math.min(item.end,interval.end);
        if(start>=end || !normalize(source.slice(start,end))) continue;
        spans.push({start,end,text:source.slice(start,end),
          pageNumber:Number(item.pageNumber||page.pageNumber||0),
          reason:interval.reason});
      }
    }
  }
  if(spans.length<12) return no("INSUFFICIENT_ITEM_MAPPING");
  return {verified:true,reason:"FOUR_ANSWER_MARKED_TEMPLATE",spans,intervals};
}
function classifyProvidedAssessmentTemplate(document) {
  return detectFourQuestionTemplate(document).spans;
}
module.exports={detectFourQuestionTemplate,classifyProvidedAssessmentTemplate};
