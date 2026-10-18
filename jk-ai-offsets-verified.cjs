"use strict";
// Pure alignment only: no filesystem writes, provider calls, rendering or delivery.
function indexWhitespace(value) {
  let text=""; const starts=[],ends=[];
  for(const m of value.matchAll(/\S+|\s+/gu)) {
    if(/^\s/u.test(m[0])) {text+=" ";starts.push(m.index);ends.push(m.index+m[0].length);}
    else for(let j=0;j<m[0].length;j++){text+=m[0][j];starts.push(m.index+j);ends.push(m.index+j+1);}
  }
  while(text.startsWith(" ")){text=text.slice(1);starts.shift();ends.shift();}
  while(text.endsWith(" ")){text=text.slice(0,-1);starts.pop();ends.pop();}
  return {text,starts,ends};
}
const normalized=s=>indexWhitespace(s).text;
function fail(message){const e=new Error("AI alignment requires review: "+message);e.code="AI_ALIGNMENT_REVIEW";throw e;}
function utf16Position(text,n,unit) {
  if(!Number.isInteger(n)||n<0) fail("invalid offset");
  if(unit==="utf16") {if(n>text.length)fail("offset out of bounds");return n;}
  const points=Array.from(text); if(n>points.length)fail("code-point offset out of bounds");
  return points.slice(0,n).join("").length;
}
function alignAiRanges({input, ranges, providerText, offsetUnit="auto"}) {
  if(typeof input!=="string" || !Array.isArray(ranges))fail("missing input or ranges");
  if(!["auto","utf16","codepoint"].includes(offsetUnit))fail("unsupported offset unit");
  const canonical=indexWhitespace(input);
  if(providerText!==undefined && (typeof providerText!=="string" || normalized(providerText)!==canonical.text))
    fail("returned full text differs beyond whitespace");
  const basis=providerText===undefined?input:providerText, indexed=indexWhitespace(basis);
  return ranges.map(range=>{
    const target=range.sentence ?? range.text;
    if(typeof target!=="string"||!normalized(target)||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end>basis.length||range.end<=range.start)
      fail("invalid range or sentence");
    const needle=normalized(target), proofs=[];
    for(const unit of offsetUnit==="auto"?["utf16","codepoint"]:[offsetUnit]) {
      let start,end;
      try {start=utf16Position(basis,range.start,unit);end=utf16Position(basis,range.end,unit);} catch(e){if(e.code!=="AI_ALIGNMENT_REVIEW")throw e;continue;}
      if(normalized(basis.slice(start,end))!==needle)continue;
      // Locate normalized characters actually inside this proven provider span.
      const a=indexed.starts.findIndex((v,k)=>v>=start && indexed.ends[k]<=end && indexed.text[k]!==" ");
      let b=indexed.ends.length-1;
      while(b>=a && (indexed.ends[b]>end || indexed.text[b]===" "))b--;
      if(a<0||b<a||indexed.text.slice(a,b+1)!==needle)continue;
      const s=canonical.starts[a], e=canonical.ends[b];
      if(normalized(input.slice(s,e))===needle)proofs.push({start:s,end:e,method:providerText===undefined?"EXACT_INPUT":"FULL_TEXT_WHITESPACE_MAP",unit});
    }
    const unique=[...new Map(proofs.map(p=>[p.start+":"+p.end,p])).values()];
    if(unique.length>1)fail("UTF-16 and code-point interpretations disagree");
    if(unique.length===1)return {...range,...unique[0],reportedStart:range.start,reportedEnd:range.end};
    // Without a full returned text, unique textual evidence can repair a bad
    // offset. Repeated occurrences are deliberately never resolved by proximity.
    if(providerText!==undefined)fail("range does not match returned text at its offset");
    const matches=[];let at=0;
    while((at=canonical.text.indexOf(needle,at))!==-1){
      const left=canonical.text[at-1], right=canonical.text[at+needle.length];
      if((!left||!/[\p{L}\p{N}]/u.test(left))&&(!right||!/[\p{L}\p{N}]/u.test(right)))matches.push(at);
      at++;
    }
    if(matches.length!==1)fail(matches.length+" text candidates; stronger evidence needed");
    const a=matches[0];return {...range,start:canonical.starts[a],end:canonical.ends[a+needle.length-1],
      reportedStart:range.start,reportedEnd:range.end,method:"UNIQUE_VERIFIED_TEXT"};
  });
}
function mapAiRangesToSource(prepared,source,ranges) {
  if(typeof source!=="string"||typeof prepared?.text!=="string"||!Array.isArray(prepared.map)||prepared.map.length!==prepared.text.length)fail("invalid source map");
  let prev=-1;
  prepared.map.forEach((v,i)=>{if(v===null)return;if(!Number.isInteger(v)||v<=prev||v<0||v>=source.length ||
    (prepared.text[i]!==source[v] && !(/\s/u.test(prepared.text[i])&&/\s/u.test(source[v]))))fail("source map failed verification");prev=v;});
  const result=[];
  for(const range of ranges){
    if(!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end>prepared.text.length||range.end<=range.start)fail("mapped range out of bounds");
    let run=null;
    const flush=()=>{if(run){result.push({...range,start:run.start,end:run.end});run=null;}};
    for(let i=range.start;i<range.end;i++) {const n=prepared.map[i];if(n===null){flush();continue;}
      if(run && n!==run.end)flush();if(!run)run={start:n,end:n+1};else run.end=n+1;
    }flush();
  }
  return result;
}
module.exports={alignAiRanges,mapAiRangesToSource,indexWhitespace};
