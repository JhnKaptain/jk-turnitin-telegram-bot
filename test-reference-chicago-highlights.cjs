"use strict";
const assert = require("node:assert/strict");
const {inspectReferenceSections} = require("./jk-reference-sections.js");
const scan = require("./jk-scan-text.js");

// Chicago-style multi-page academic bibliography. Synthetic text; no private
// coursework content. Reproduces a report where the bibliography was highlighted
// despite FILTERED being selected after a production deploy.
const source = [
  "The discussion critically evaluates movement and institutional recognition. ".repeat(8),
  "The research analyzes how educational mobility can lead to settlement.",
  "",
  "References",
  "",
  "Archer, Paul. 2004. “The Capacity to Aspire: Culture and the Terms of Recognition.” In",
  "Culture and Public Action: A Cross-Disciplinary Dialogue on Development Policy,",
  "edited by Vera Rao and Michael Walton, 59–84. London: University Press.",
  "Publications.",
  "",
  "Elliott, Anthony, and John Urry. 2010. Mobile Lives. London: Routledge.",
  "Ellis, Carolyn, Tony E. Adams, and Arthur P. Bochner. 2011. “Autoethnography: An Overview.”",
  "Forum Qualitative Social Research 12 (1): Article",
  "10. https://doi.org/10.17169/fqs-12.1.1589.",
  "",
  "Glick Schiller, Nina, and Noel B. Salazar. 2013. “Regimes of Mobility across the Globe.”",
  "Journal of Ethnic and Migration Studies 39 (2): 183–200.",
  "https://doi.org/10.1080/1369183X.2013.723253.",
  "",
  "Martin, Fran. 2018. “Overseas Study as Zone of Suspension: Students Re-negotiating",
  "Youth, Gender, and Intimacy.” Journal of Intercultural Studies 39 (6): 688–703.",
  "https://doi.org/10.1080/07256868.2018.1533538.",
  "",
  "AI Use Declaration",
  "I used software tools to review the outline and writing. The original decisions remain mine.",
].join("\n");

const declaration = source.indexOf("AI Use Declaration");
const refs = source.indexOf("\nReferences\n") + 1;
const citeFragments = [
  "The Capacity to Aspire", "Culture and Public Action",
  "University Press", "Elliott, Anthony", "Forum Qualitative",
  "Glick Schiller, Nina", "Journal of Ethnic", "Martin, Fran",
  "https://doi.org/10.1080/07256868.2018.1533538"
];
function exercise(doc) {
  const decision = inspectReferenceSections(source,-1,[],doc);
  assert.equal(decision.reviews.length,0,"An ordinary bibliographic list must not cause admin review: "+JSON.stringify(decision.reviews));
  assert.equal(decision.ranges.length,1,JSON.stringify(decision));
  assert.equal(decision.ranges[0].start,refs);
  assert.equal(decision.ranges[0].end,declaration,"Stop at next academic declaration.");
  const inputs = [
    scan.buildAiInput(source,doc),
    scan.buildSimilarityInput(source,scan.FILTER_MODE_FILTERED,[],doc)
  ];
  for (const p of inputs) {
    assert(p.text.includes("The research analyzes how educational mobility"));
    assert(p.text.includes("AI Use Declaration"));
    for(const phrase of citeFragments) assert(!p.text.includes(phrase),"Reference leaked into provider input: "+phrase);
    const i=p.text.indexOf("AI Use Declaration");
    assert.equal(p.map[i],declaration,"Declaration source mapping broken");
  }
}
exercise(null);
let offset=0,y=740,page=8;
const pages=new Map();
for(const line of source.split("\n")) {
  if(line.startsWith("Martin, Fran")) {page=9;y=730;}
  if(line==="AI Use Declaration"){page=10;y=720;}
  if(line.trim()) {
    const hanging=/^(?:Culture and|edited by|Publications\.|Forum Qualitative|10\. https:|Journal of Ethnic|https?:|Youth, Gender)/u.test(line);
    const item={text:line,start:offset,end:offset+line.length,pageNumber:page,
      x:hanging?151:line==="References"||line==="AI Use Declaration"?250:100,
      y,height:10,width:Math.max(30,line.length*5)};
    if(!pages.has(page))pages.set(page,[]);
    pages.get(page).push(item);
    y-=12;
  } else {y-=12;}
  offset+=line.length+1;
}
exercise({text:source,pages:[...pages].map(([pageNumber,items])=>({pageNumber,items}))});
console.log("PASS: Chicago wrapped bibliography excluded across pages; AI declaration included; source maps intact.");
