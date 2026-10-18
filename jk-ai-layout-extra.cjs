"use strict";
// Pure, offline experimental classifier. All exclusions retain source coordinates.
const norm = s => String(s).replace(/\s+/gu, " ").trim();
const wc = s => (s.match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []).length;
const bold = i => Number(i.fontWeight) >= 600 || /bold|semibold|demi/iu.test(i.fontFamily || i.fontName || "");
function classifyExtra(document) {
  const spans = [], source = document.text;
  // Extracted PDF items often lack fontWeight; identify the dominant body font
  // using the actual document and treat another font as styled only when
  // it is positioned like a centered title (checked below).
  const fontUsage = new Map();
  for (const page of document.pages || []) for (const item of page.items || []) {
    if (!item.fontName || source.slice(item.start, item.end) !== item.text) continue;
    fontUsage.set(item.fontName, (fontUsage.get(item.fontName) || 0) +
      (String(item.text).match(/\p{L}/gu) || []).length);
  }
  const orderedFonts = [...fontUsage].sort((a, b) => b[1] - a[1]);
  const totalLetters = orderedFonts.reduce((sum, row) => sum + row[1], 0);
  const bodyFont = totalLetters && orderedFonts[0]?.[1] / totalLetters >= .55 ? orderedFonts[0][0] : null;
  const styled = item => bold(item) || Boolean(bodyFont && item.fontName && item.fontName !== bodyFont);
  const add = (i, p, reason) => spans.push({start:i.start,end:i.end,text:source.slice(i.start,i.end),pageNumber:p,reason});
  for (const [pi,page] of document.pages.entries()) {
    if (page.rotation || !Number.isFinite(page.width) || !Number.isFinite(page.height)) continue;
    const items = (page.items || []).filter(i => Number.isInteger(i.start) && Number.isInteger(i.end) &&
      i.start >= 0 && i.end > i.start && source.slice(i.start,i.end) === i.text &&
      [i.x,i.y,i.width,i.height].every(Number.isFinite) && i.width > 0 && i.height > 0 &&
      i.y > page.height * .1 && i.y < page.height * .94 && norm(i.text) && !/^\d+$/u.test(norm(i.text)));
    const p = page.pageNumber || pi + 1;
    const centered = i => Math.abs(i.x+i.width/2-page.width/2) <= Math.max(12,i.height*1.8);
    const sorted = [...items].sort((a,b)=>b.y-a.y || a.x-b.x);
    // Centered, bold title groups need a separate following block. A question mark
    // is permitted here, but never makes an ordinary question into a heading.
    for (let k=0;k<sorted.length;k++) {
      const first=sorted[k];
      if (!styled(first) || !centered(first) || wc(first.text)>25 || /[.!;]/u.test(first.text)) continue;
      const group=[first]; let j=k+1;
      while(j<sorted.length && group.length<4) {
        const n=sorted[j], prev=group.at(-1), gap=prev.y-n.y;
        if (!styled(n)||!centered(n)||gap<first.height*.7||gap>first.height*2.5||/[.!;]/u.test(n.text)) break;
        group.push(n);j++;
      }
      const next=sorted[j], combined=norm(group.map(i=>i.text).join(" "));
      if (wc(combined)<2 || wc(combined)>45 || !next || group.at(-1).y-next.y<first.height*1.5) continue;
      if (!/^\p{Lu}/u.test(combined) || /\b(?:I|We|My|Our)\b/u.test(combined)) continue;
      const followedByTitleAndIdentity = k < 2 && styled(next) && centered(next) &&
        /^(?:research proposal|research report|project report|dissertation|thesis)$/iu.test(combined) &&
        sorted.slice(j+1,j+5).some(i=>/^(?:Name\s*:|Student(?:’s|'s)?\s+Name)/iu.test(norm(i.text)));
      if (!followedByTitleAndIdentity && !/^(?:Name\s*:|Student|Institution|Course|Professor|Date)/iu.test(norm(next.text)) &&
          !(wc(next.text)>=8 && !styled(next))) continue;
      group.forEach(i=>add(i,p,"FORMATTED_TITLE_GROUP")); k=j-1;
    }
    // A timetable is recognized from geometry plus multiple week columns and X
    // markers, not by excluding every table or every short line on a page.
    const activity=items.find(i=>/^(?:activity|task)$/iu.test(norm(i.text)));
    if (!activity) continue;
    const headers=items.filter(i=>i.x>activity.x+activity.width && Math.abs(i.y-activity.y)<activity.height*.5 &&
      /^(?:week\s*\d+|wee)$/iu.test(norm(i.text)));
    if(headers.length<3) continue;
    const columns=headers.map(i=>i.x);
    const markers=items.filter(i=>/^x$/iu.test(norm(i.text)) && i.y<activity.y && columns.some(x=>Math.abs(i.x-x)<8));
    if(markers.length<2) continue;
    const firstColumnEnd=Math.min(...columns)-4;
    const markerRows=[...new Set(markers.map(i=>i.y))].sort((a,b)=>b-a);
    const labelItems=[];
    for(let r=0;r<markerRows.length;r++) {
      const top=markerRows[r], bottom=markerRows[r+1] ?? top-activity.height*5;
      const row=items.filter(i=>i.x>=activity.x-3 && i.x+i.width<firstColumnEnd && i.y<=top+2 && i.y>bottom+2)
        .sort((a,b)=>b.y-a.y);
      const label=norm(row.map(i=>i.text).join(" "));
      if(!row.length || wc(label)>12 || /\b(?:is|are|was|were|we|they|because|therefore|shows|reports)\b/iu.test(label)) continue;
      // Only activity labels; prose cells and unrelated text below remain intact.
      if(!/^(?:draft|devise|brainstorm|review|collect|analyse|analyze|submit|revise|prepare|conduct|write|edit|finalise|finalize)\b/iu.test(label)) continue;
      labelItems.push(...row);
      markers.filter(m=>Math.abs(m.y-top)<2).forEach(i=>add(i,p,"TIMETABLE_MARKER"));
    }
    if(!labelItems.length) continue;
    add(activity,p,"TIMETABLE_HEADER");
    for(const h of headers) {
      add(h,p,"TIMETABLE_HEADER");
      if(norm(h.text).toLowerCase()==="wee") for(const i of items) if(Math.abs(i.x-h.x)<3 && h.y-i.y>0 && h.y-i.y<h.height*2.5 && /^k\s*\d+$/iu.test(norm(i.text))) add(i,p,"TIMETABLE_HEADER");
    }
    labelItems.forEach(i=>add(i,p,"TIMETABLE_LABEL"));
  }
  return spans;
}
module.exports={classifyExtra};
