"use strict";
const assert = require("node:assert/strict");
const {inspectReferenceSections} = require("./jk-reference-sections.js");
const scan = require("./jk-scan-text.js");
const entries=[
["Australian Association of National Advertisers. (2021). Code of ethics. https://aana.com.au/code-of-","ethics/"],
["Australian Communications and Media Authority. (2026, October 19). ACMA publishes initial industry","guidance on new rules prohibiting notable people in gambling advertising.","https://www.acma.gov.au/articles/2026-10/acma-publishes-initial-industry-guidance-new-rules-","prohibiting-notable-people-gambling-advertising"],
["Australian Competition and Consumer Commission. (n.d.). Social media promotions.","https://www.accc.gov.au/consumers/advertising-and-promotions/social-media-promotions"],
["Australian Competition and Consumer Commission. (2023, December 7). Scrutiny of influencers and","businesses for misleading advertising and online reviews continues."],
["Australian Competition and Consumer Commission. (2026a, June 12). Hismile pays penalties for false"],
["Australian Competition and Consumer Commission. (2026b, March 24). PhotobookShop pays penalties"],
["Australian Influencer Marketing Council. (n.d.). Best practice. https://aimco.org.au/best-practice"],
["Black, J., & Barney, R. D. (1985). The case against mass media codes of ethics."],
["Boerman, S. C., Willemsen, L. M., & van der Aa, E. P. (2017). This post is sponsored."],
["Booth, H. (2026, March 30). Tropeaka advert probed by standards agency."],
["Dunn, A. (2003). Ethics impossible? Advertising and the infomercial."],
["Evans, N. J., Phua, J., Lim, J., & Jun, H. (2017). Disclosing Instagram influencer advertising."],
["Friestad, M., & Wright, P. (1994). The persuasion knowledge model."],
["Hudders, L., De Jans, S., & De Veirman, M. (2021). Commercialization of media stars."],
["LBB Editorial. (2025, October 8). AANA to launch public review of code of ethics."],
["Liquor & Gaming NSW. (2026, March 4). Social media influencer gambling products."],
["Lou, C., & Yuan, S. (2019). Influencer marketing and credibility."],
["Roy Morgan. (2026, July 15). Disclosure matters."],
["Spence, E. H., & Quinn, A. (2008). Information ethics as a guide for new media."],
["Victorian Auditor-General. (2026, October). Government advertising and communications."]
];
assert.equal(entries.length,20);
const sourceLines=[
  ...Array.from({length:22},()=> "The discussion explores influencer advertising regulation, accountability and ethical implications."),
  "References"
];
const meta=sourceLines.map(text=>({text,continued:false}));
for(const entry of entries)for(let j=0;j<entry.length;j++)meta.push({text:entry[j],continued:j>0});
let source="", page=10,y=720,items=[];
for(let i=0;i<meta.length;i++){
 const {text,continued}=meta[i];
 if(text==="References"){page=10;y=680;}
 if(page>9 && y<80){page++;y=720;}
 let start=source.length; source+=text+"\n";
 items.push({start,end:start+text.length,text,x:continued?108:72,y,height:11,width:text.length*4.3,pageNumber:page});
 y-=25.3;
}
const layout={text:source,pages:[...new Set(items.map(x=>x.pageNumber))].map(pageNumber=>({pageNumber,items:items.filter(x=>x.pageNumber===pageNumber)}))};
const decision=inspectReferenceSections(source,-1,[],layout);
assert.equal(decision.reviews.length,0,JSON.stringify(decision.reviews));
assert.equal(decision.ranges.length,1,JSON.stringify(decision.ranges));
assert.equal(decision.ranges[0].end,source.length);
for(const p of [scan.buildAiInput(source,layout),scan.buildSimilarityInput(source,scan.FILTER_MODE_FILTERED,[],layout)]){
  const covered=p.removedReferenceRanges||[];
  assert.equal(covered.length,1);
  assert(!p.text.includes("Social media promotions."),"n.d. citation leaked");
  assert(!p.text.includes("Best practice."),"second n.d. citation leaked");
  assert(p.text.includes("influencer advertising regulation"),"essay body lost");
}
console.log("PASS: 20 APA author-date bibliography items including two undated corporate authors; no boundary reviews, zero leakage in AI and filtered similarity.");
