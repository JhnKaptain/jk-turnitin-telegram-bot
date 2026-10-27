"use strict";
const assert=require("node:assert/strict");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const {buildAiInput,buildSimilarityInput,FILTER_MODE_FILTERED}=require("./jk-scan-text.js");
// Synthetic 19-item Chicago bibliography shaped after the proven production
// failure: 27.6pt line spacing, 13.3pt height, 36pt hanging indent,
// and a title-cased chapter/volume title that looks like a new heading.
const head=[
"Independent essay prose discusses overseas educational choices and institutional opportunities. ".repeat(15),
"References",
"Appadurai, Arjun. 2004. The Capacity to Aspire: Culture and the Terms of Recognition. In",
"Culture and Public Action: A Cross-Disciplinary Dialogue on Development Policy,",
"edited by Vijayendra Rao and Michael Walton, 59-84. Washington, DC: World Bank",
"Publications."
];
const refs=[
["Elliott, Anthony, and John Urry. 2010. Mobile Lives. London: Routledge."],
["Ellis, Carolyn, Tony E. Adams, and Arthur P. Bochner. 2011. Autoethnography: An Overview.","Forum Qualitative Social Research 12 (1): Article 10."],
["Franceschini, Ivan, and Ling Li. 2026. Victims and Villains. Aeon."],
["Glick Schiller, Nina, and Noel Salazar. 2013. Regimes of Mobility across the Globe.","Journal of Ethnic and Migration Studies 39 (2): 183-200."],
["Hannam, Kevin, Mimi Sheller, and John Urry. 2006. Editorial: Mobilities, Immobilities and Moorings."],
["Liu, Yi-Ling. 2023. Nine Viral Phrases That Explain Work Culture."],
["Martin, Fran. 2017. Rethinking Network Capital."],
["Martin, Fran. 2018. Overseas Study as Zone of Suspension.","Youth, Gender, and Intimacy. Journal of Intercultural Studies."],
["Martin, Fran, and Ana Dragojlovic. 2019. Gender, Mobility Regimes, and Social Transformation in Asia."],
["National Civil Service Administration. 2025. Recruitment policy report.","Official government publication details and website link."],
["Robertson, Shanthi. 2014. Time and Temporary Migration."],
["Robertson, Shanthi, Yi'En Cheng, and Brenda Yeoh. 2018. Introduction: Mobile Aspirations?"],
["Schewel, Kerilyn. 2020. Understanding Immobility."],
["Shamir, Ronen. 2005. Without Borders? Notes on Globalization as a Mobility Regime."],
["Shanghai Municipal Talent Work Bureau. 2025. Overseas returnees permanent residence rules.","Rules for Overseas Returnees Applying for Permanent Household Registration in Shanghai."],
["Xiang, Biao. 2013. Introduction: Return and the Reordering of Transnational Mobility in Asia.","In Return: Nationalizing Transnational Mobility in Asia.","edited by Biao Xiang, Brenda Yeoh and Mika Toyota. Duke University Press."],
["Xiang, Biao. 2021. The Nearby: A Scope of Seeing."],
["Yang, Peidong. 2018. Compromise and Complicity in International Student Mobility.","Ethnographic Case of Medical Students at a Chinese University."]
];
assert.equal(refs.length+1,19);
const lines=head.map((text,i)=>({text,entry:i===2,continuation:i>=3}));
for(const entry of refs){
 lines.push({text:entry[0],entry:true});
 for(const more of entry.slice(1))lines.push({text:more,continuation:true});
}
lines.push({text:"AI Use Declaration",terminator:true});
lines.push({text:"The author documents how computer assistance was used in academic writing.",body:true});
let source="",items=[],page=7,y=700;
for(let i=0;i<lines.length;i++){
 const v=lines[i];
 if(v.text==="References"){page=9;y=735;}
 else if(v.text==="AI Use Declaration"){page=11;y=680;}
 else if(page!==7 && y<80){page++;y=735;}
 const x=v.continuation?108.1:v.text==="References"?279.5:v.terminator?72:72.1;
 const start=source.length;source+=v.text+"\n";
 items.push({text:v.text,start,end:start+v.text.length,pageNumber:page,x,y,height:13.3,width:v.text.length*5});
 y-=27.6;
}
const layout={text:source,pages:[...new Set(items.map(it=>it.pageNumber))].map(pageNumber=>({pageNumber,items:items.filter(it=>it.pageNumber===pageNumber)}))};
const ranges=inspectReferenceSections(source,-1,[],layout);
const expectedEnd=source.indexOf("AI Use Declaration");
assert.deepEqual(ranges.reviews,[],JSON.stringify(ranges.reviews));
assert.equal(ranges.ranges.length,1,JSON.stringify(ranges.ranges));
assert.equal(ranges.ranges[0].end,expectedEnd,"Do not stop at capitalized chapter title inside the first citation.");
for(const prepared of [buildAiInput(source,layout),buildSimilarityInput(source,FILTER_MODE_FILTERED,[],layout)]){
 for(const phrase of ["Culture and Public Action","Mobile Lives","Journal of Ethnic","Shanghai Municipal","Xiang, Biao","Yang, Peidong"]){
  assert(!prepared.text.includes(phrase),"Bibliography leaked into provider input: "+phrase);
 }
 assert(prepared.text.includes("AI Use Declaration"));
 const at=prepared.text.indexOf("AI Use Declaration");
 assert.equal(prepared.map[at],expectedEnd);
}
console.log("PASS: all 19 double-spaced Chicago references excluded; cover and declaration retained; provider offsets safe.");
