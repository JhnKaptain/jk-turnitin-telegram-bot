"use strict";
const assert=require("node:assert/strict");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const scan=require("./jk-scan-text.js");
const lines=[
"Task 2: Written - Research Paper Snapshot",
"Lambert et al. examined whether a short social media break affects mental health in a randomised trial.",
"The research was evaluated against its limitations and the short follow-up period.",
"Reference",
"Lambert, J., Barnstable, G., Minter, E., Cooper, J. and McEwan, D. (2022) Taking a one-",
"week break from social media improves well-being, depression, and anxiety: A randomized",
"controlled trial. Cyberpsychology, Behavior, and Social Networking, 25(5), pp. 287-293.",
"Available at: https://doi.org/10.1089/cyber.2021.0324",
"Study: Milgram (1963)",
"Milgram examined obedience to authority by asking male volunteers to administer apparent shocks.",
"The ethical issues in the study included deception, participant pressure and psychological distress.",
"References",
"Baumrind, D. (1964) Some thoughts on ethics of research after reading Milgram.",
"Available at: https://doi.org/10.1037/h0040128",
"British Psychological Society (2021) BPS Code of Human Research Ethics. Leicester.",
"Psychological Society. Available at: https://discovery.dundee.ac.uk/en/publications/bps-code-of-human-research-ethics/",
"Burger, J.M. (2009) Replicating Milgram: Would people still obey today?",
"Haslam, S.A. and Reicher, S.D. (2017) Fifty years of obedience to authority.",
"Milgram, S. (1963) Behavioral study of obedience.",
"Slater, M., Antley, A., Davison, A., Swapp, D., Guger, C., Barker, C., Pistrang, N. and",
"Sanchez-Vives, M.V. (2006) A virtual reprise of the Stanley Milgram obedience experiments.",
"Available at: https://doi.org/10.1371/journal.pone.0000039",
"Task 4 Evidence vs Misinformation - Can People Be Born Evil?",
"Jagadeesan et al. provide a review of the research on genes and environmental factors affecting criminal behaviour.",
"Different sources are evaluated against credibility, reliability, bias and evidence.",
"References",
"Aglietti, T. (n.d.) Are we born good or evil? BBC Earth. Available at:",
"https://www.bbcearth.com/news/are-we-born-good-or-evil-naughty-or-nice",
"Jagadeesan, P., Jagadeesan, R. and Ramachandran, R. (2021) Nature versus nurture.",
"Publication and Reviews, 2(10), pp. 564-579. Available at:",
"https://www.researchgate.net/publication/355443862_Nature_versus_Nurture",
"Thomson, J. (2023) The moral mystery of serial killers with no evident mental illness.",
"Available at: https://bigthink.com/thinking/are-we-born-evil/",
"Task 5: Written - Academic Skills Reflection",
"This semester I developed a new academic skill, critical thinking, which improved my assessment of sources.",
"I will use better time management and study planning to prepare future assessments earlier in the semester."
];
const source=lines.join("\n");
const positions=[source.indexOf("Reference\n"),source.indexOf("References\n"),source.lastIndexOf("References\n")];
const ends=["Study: Milgram (1963)","Task 4 Evidence","Task 5: Written"].map(t=>source.indexOf(t));
let pos=0,items=[],page=2,y=700;
for(const t of lines){
 if(t.startsWith("Study:")){page=3;y=730;}
 if(t==="References"&&page===3){page=4;y=730;}
 if(t.startsWith("Task 4")){page=5;y=730;}
 if(t==="References"&&page===5){page=6;y=730;}
 if(t.startsWith("Task 5")){page=7;y=730;}
 items.push({text:t,start:pos,end:pos+t.length,pageNumber:page,x:/^(Reference|References|Study:|Task [45])/.test(t)?210:/^(Available|https|week break|controlled trial|Psychological Society|Sanchez-Vives)/.test(t)?112:72,y,height:11,width:t.length*4});
 pos+=t.length+1;y-=26;
}
const layout={text:source,pages:[...new Set(items.map(x=>x.pageNumber))].map(pageNumber=>({pageNumber,items:items.filter(x=>x.pageNumber===pageNumber)}))};
const result=inspectReferenceSections(source,-1,[],layout);
assert.equal(result.reviews.length,0,JSON.stringify(result.reviews));
assert.equal(result.ranges.length,3,JSON.stringify(result.ranges));
for(let i=0;i<3;i++){assert.equal(result.ranges[i].start,positions[i]);assert.equal(result.ranges[i].end,ends[i]);}
for(const p of [scan.buildAiInput(source,layout),scan.buildSimilarityInput(source,scan.FILTER_MODE_FILTERED,[],layout)]){
 for(const t of ["Lambert, J.","Baumrind, D.","British Psychological Society (2021)","Aglietti, T. (n.d.)","Thomson, J."]){assert(!p.text.includes(t),"Bibliography leaked: "+t);}
 for(const t of ["Milgram examined obedience","Jagadeesan et al. provide","This semester I developed"]){assert(p.text.includes(t),"Substantive content excluded: "+t);}
}
console.log("PASS: three independent bibliographies excluded without sacrificing later Task/Study prose; provider offsets preserved.");
