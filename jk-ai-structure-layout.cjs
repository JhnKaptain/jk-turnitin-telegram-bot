"use strict";
// AI-only supplemental structural recognition in canonical, exact source offsets.
// No title dictionaries or customer-specific strings. Similarity never imports this.
// The renderer and AI input builder both call classifyAiStructuralText(), so one
// classifier decision is shared without changing original provider scores.
const words = s => (String(s||"").match(/\p{L}[\p{L}\p{M}'’\-]*/gu)||[]);
const norm = s => String(s||"").replace(/\s+/gu," ").trim();
const bold = i => Number(i.fontWeight)>=600 || /bold|semibold|demi|black/i.test(String(i.fontFamily||i.fontName||""));
function valid(i,source) {
 return Number.isInteger(i.start)&&Number.isInteger(i.end)&&i.start>=0&&i.end>i.start&&
 source.slice(i.start,i.end)===i.text&&[i.x,i.y,i.width,i.height].every(Number.isFinite)&&
 i.width>0&&i.height>0&&norm(i.text);
}
function classifyLayoutStructures(document) {
 if(!document||typeof document.text!=="string"||!Array.isArray(document.pages))return [];
 const source=document.text, out=[];
 const usage=new Map();let total=0;
 for(const page of document.pages)for(const i of page.items||[]){
  if(!valid(i,source)||!i.fontName)continue;
  const n=(i.text.match(/\p{L}/gu)||[]).length;
  usage.set(i.fontName,(usage.get(i.fontName)||0)+n);total+=n;
 }
 const ordered=[...usage].sort((a,b)=>b[1]-a[1]);
 const bodyFont=total&&ordered[0]?.[1]/total>=0.55?ordered[0][0]:null;
 const add=(i,p,reason)=>out.push({start:i.start,end:i.end,text:i.text,pageNumber:p,reason});
 for(let pi=0;pi<document.pages.length;pi++){
  const page=document.pages[pi];
  if(page.rotation||!Number.isFinite(page.width)||!Number.isFinite(page.height))continue;
  const p=page.pageNumber||pi+1;
  const items=(page.items||[]).filter(i=>valid(i,source)&&
    i.y>page.height*.055&&i.y<page.height*.965);
  const positioned=[...items].sort((a,b)=>b.y-a.y||a.x-b.x);
  const alt=i=>Boolean(i.fontName&&bodyFont&&i.fontName!==bodyFont)||bold(i);
  // A complete, short line in a distinct typeface, followed by actual prose;
  // unlike title-case heuristics, this covers ordinary sentence-case headings.
  // Conditions prevent masking bold sentences, in-paragraph emphasis, and citations.
  for(let k=0;k<positioned.length;k++){
   const i=positioned[k],s=norm(i.text),w=words(s).length;
   if(!alt(i)||w<1||w>13||s.length>125||/[.!?;:]\s*$/u.test(s)||
       /\b(?:reports|suggests|demonstrates|explains|concluded|showed|however|therefore)\b/iu.test(s))continue;
   const lineStart=source.lastIndexOf("\n",i.start-1)+1;
   let lineEnd=source.indexOf("\n",i.end);if(lineEnd<0)lineEnd=source.length;
   if(norm(source.slice(lineStart,lineEnd))!==s)continue;
   let followed=false;
   for(let j=k+1;j<Math.min(positioned.length,k+4);j++){
    const n=positioned[j],dy=i.y-n.y;
    if(dy<=i.height*.7)continue;
    if(dy>i.height*7)break;
    // Allow a heading plus one subtitle immediately before prose.
    if(n.fontName===bodyFont&&words(n.text).length>=9&&
       Math.abs(i.x-n.x)<Math.max(20,page.width*.08)) {followed=true;break;}
    if(!alt(n)||words(n.text).length>14)break;
   }
   if(followed)add(i,p,"LAYOUT_STANDALONE_HEADING");
  }
  // Conservative sparse, centred front-matter cover: no narrative body lines.
  // Never infer a cover from page number alone, or hide a mixed first page.
  if(pi===0&&positioned.length>=6&&positioned.length<=25){
   const relevant=positioned.filter(i=>!/^\d+$/u.test(norm(i.text)));
   const centered=i=>Math.abs(i.x+i.width/2-page.width/2)<=Math.max(15,i.height*2);
   const centeredRate=relevant.filter(centered).length/Math.max(1,relevant.length);
   const hasMeta=relevant.some(i=>/\b(?:student\s*(?:number|id)|word\s*count)\b/iu.test(i.text))&&
        relevant.some(i=>/\b(?:project|assignment|report|university|college|school)\b/iu.test(i.text));
   const narrative=relevant.some(i=>words(i.text).length>=20||
        (/[.!?]\s*$/u.test(norm(i.text))&&words(i.text).length>=9));
   if(centeredRate>=.78&&hasMeta&&!narrative)
    for(const i of relevant)add(i,p,"LAYOUT_SEPARATE_COVER");
  }
  // Detect a repeatable multi-column table, not just a particular timetable.
  // Three distinct aligned header columns and recurrent same-x cell anchors
  // are required. Do not mask explanatory prose above or below a table.
  const headerCandidates=[];
  for(let k=0;k<positioned.length;k++){
   const a=positioned[k];
   if(!alt(a)||a.x>page.width*.3||words(a.text).length>5||/[.!?;]\s*$/u.test(norm(a.text)))continue;
   const row=positioned.filter(i=>Math.abs(i.y-a.y)<=Math.max(2,a.height*.22)&&
      i.x>=a.x-3&&i.height<=a.height+2&&words(i.text).length>=1&&words(i.text).length<=6&&
      !/[.!?;]\s*$/u.test(norm(i.text))).sort((a,b)=>a.x-b.x);
   const cols=[];
   for(const i of row)if(!cols.length||i.x-cols.at(-1).x>=45)cols.push(i);
   if(cols.length<3||cols.at(-1).x-cols[0].x<page.width*.35)continue;
   // Require the actual header to be formatted or shorter than body text.
   if(cols.filter(alt).length<Math.min(2,cols.length))continue;
   headerCandidates.push(cols);
  }
  const seenHeaders=new Set();
  for(const columns of headerCandidates){
   const header=columns[0],hkey=header.y.toFixed(1);
   if(seenHeaders.has(hkey))continue;seenHeaders.add(hkey);
   const maxDepth=Math.min(page.height*.58,460);
   const below=items.filter(i=>i.y<header.y-header.height*.6&&i.y>header.y-maxDepth&&
       i.height<=header.height+0.8);
   const columnCells=columns.map(c=>below.filter(i=>Math.abs(i.x-c.x)<=2.8));
   const isWeek=columns.filter(c=>/^week\s*\d+$/iu.test(norm(c.text))).length>=3;
   const wellPopulated=columnCells.filter(cells=>cells.length>=2).length>=2&&
     columnCells.reduce((n,cells)=>n+cells.length,0)>=8;
   const schedule=isWeek&&columnCells[0].length>=3;
   if(!wellPopulated&&!schedule)continue;
   // Determine table bounds only from stable cell-column anchors. Do not mask
   // entire vertical regions, since body prose may follow the table.
   const cellItems=columnCells.flat();
   if(!cellItems.length)continue;
   const minY=Math.min(...cellItems.map(i=>i.y));
   for(const h of columns)add(h,p,"LAYOUT_TABLE_HEADER");
   const unique=new Set();
   for(const i of cellItems){
    if(i.y<minY-1||unique.has(i.start))continue;
    unique.add(i.start);add(i,p,"LAYOUT_TABLE_CELL");
   }
   // Recognize adjacent Table # / italic caption immediately above header.
   const captions=positioned.filter(i=>i.y>header.y+header.height*.7&&
      i.y<header.y+header.height*7&&i.x<=header.x+14&&
      (/(?:^|\s)table\s+\d+[.:]?\s*$/iu.test(norm(i.text)) ||
        (alt(i)&&words(i.text).length<=6&&i.width<page.width*.4)));
   for(const i of captions)add(i,p,"LAYOUT_TABLE_CAPTION");
  }
 }
 const seen=new Set();
 return out.filter(s=>{const key=s.start+":"+s.end;if(seen.has(key))return false;seen.add(key);return true;});
}
module.exports={classifyLayoutStructures};
