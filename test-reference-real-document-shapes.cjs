"use strict";
const assert = require("node:assert/strict");
const {inspectReferenceSections} = require("./jk-reference-sections.js");
const scan = require("./jk-scan-text.js");

// Reference-boundary replay models from the three actual user-supplied documents.
// Canonical line offsets, real reference formats and measured page positions.
// All checks are local: no Sapling, Quetext, Telegram, or external requests.
function fixture(records) {
  let text = "";
  const pages = new Map();
  for (const record of records) {
    const start = text.length;
    text += record.text + "\n";
    const item = {
      text: record.text, start, end: start + record.text.length,
      pageNumber: record.page, x: record.x ?? 72.1,
      y: record.y ?? 710, height: record.height ?? 13.284,
      width: Math.max(12, record.text.length * 4)
    };
    if (!pages.has(record.page)) pages.set(record.page, []);
    pages.get(record.page).push(item);
  }
  return {text, layout: {text, pages: [...pages].map(([pageNumber, items])=>({pageNumber,items}))}};
}

// Inclusive Assessment, real page 11: 15 APA references, last DOI at y108.058,
// independent cybersecurity paragraph at y653.308, hanging-like indent x108.
// The administrator must be offered the FIRST sentence, not only exclude-to-end.
{
  const rec = [{text:"The thematic analysis examines equity and academic standards in university assessment.",page:8},
    {text:"References",page:9,x:280,y:710}];
  let page=9,y=690;
  for(let i=0;i<15;i++){
    if(i===8){page=10;y=700;}
    if(i===14){page=11;y=163.258;}
    rec.push({text:"Scholar, A. (2024). Inclusive assessments, equity and academic standards.",page,x:72.1,y});
    y-=27.6;
    rec.push({text:"Higher Education Research & Development, 45(4), 1047-1062.",page,x:108.1,y});
    y-=27.6;
    rec.push({text:"https://doi.org/10.1080/02602938.2022."+String(20779000+i),page,x:108.1,y});
    y-=27.6;
  }
  rec[rec.length-1].page=11;
  rec[rec.length-1].y=108.058;
  const restart="Leadership commitment plays a pivotal role in ensuring adherence to cybersecurity";
  rec.push({text:restart,page:11,x:108.1,y:653.308});
  rec.push({text:"policies. When leaders prioritize cybersecurity and demonstrate their commitment through actions",page:11,x:72.1,y:680.908});
  rec.push({text:"and resources, it sets a positive example for the entire organization. This top-down approach influences employees.",page:12,x:72.1,y:710});
  const {text,layout}=fixture(rec), result=inspectReferenceSections(text,-1,[],layout);
  assert.equal(result.ranges.length,0,"Do not silently exclude uncertain unheaded prose");
  assert.equal(result.reviews.length,1,JSON.stringify(result.reviews));
  assert.equal(result.reviews[0].entriesFound,15);
  assert.equal(result.reviews[0].candidates[0]?.offset,text.indexOf(restart),
    "Include-from must point to first substantive cybersecurity sentence");
  assert.throws(()=>scan.buildAiInput(text,layout),e=>e?.code==="REFERENCE_BOUNDARY_REVIEW_REQUIRED");
  const approved=[{
    start:result.reviews[0].start,end:text.indexOf(restart),
    sourceTextSha256:result.sourceTextSha256
  }];
  for(const prepared of [
    scan.buildAiInput(text,layout,approved),
    scan.buildSimilarityInput(text,scan.FILTER_MODE_FILTERED,approved,layout)
  ]){
    assert(prepared.text.includes(restart));
    assert(!prepared.text.includes("Scholar, A."));
    assert.equal(text[prepared.map[prepared.text.indexOf(restart)]],"L");
  }
}

// Moral Identity, pages 15-17 and final references on page 38.
// Harvard heading is numbered; appendix is a *separate* numbered section.
// Later citations use StataCorp (n.d.-a) and institutional Harvard authors.
{
  const rows=[
    {text:"The response offers a balanced critical evaluation of investment appraisal.",page:14},
    {text:"9. Harvard Reference List",page:15},
    {text:"Berk, J. and DeMarzo, P. (2024) Corporate finance. 6th global edn.",page:15},
    {text:"Brealey, R.A., Myers, S.C., Allen, F. and Edmans, A. (2023) Principles of corporate finance.",page:15},
    {text:"Greggs plc (2026) Annual report and accounts 2025. Available at:",page:15},
    {text:"https://corporate.greggs.co.uk/investors/results-and-regulatory-news",page:15},
    {text:"Trigeorgis, L. and Reuer, J.J. (2017) Real options theory in strategic management.",page:15},
    {text:"10. Appendix: Original Prescribed Prompt and Initial Copilot Output",page:17},
    {text:"Appendix A1: Original Prescribed Prompt",page:17},
    {text:"I am a final-year undergraduate student studying corporate finance.",page:17},
    {text:"Residential Property Prices in Norwich",page:21},
    {text:"The analysis uses 1585 observations to estimate conditional property prices.",page:21},
    {text:"References",page:38},
    {text:"StataCorp (n.d.-a) Regress: Linear regression. Stata Base Reference Manual. Available at:",page:38},
    {text:"https://www.stata.com/manuals/rregress.pdf",page:38},
    {text:"StataCorp (n.d.-b) Regress postestimation: Postestimation tools for regress.",page:38},
    {text:"University of East Anglia, School of Economics (2026a) Take-home assignment: Autumn semester 2026.",page:38},
    {text:"University of East Anglia, School of Economics (2026b) Take-home assignment hints.",page:38},
    {text:"University of East Anglia, School of Economics (n.d.) Lecture notes (weeks 1-7).",page:38}
  ];
  const {text,layout}=fixture(rows), r=inspectReferenceSections(text,-1,[],layout);
  assert.equal(r.reviews.length,0,JSON.stringify(r.reviews));
  assert.equal(r.ranges.length,2,JSON.stringify(r.ranges));
  assert.equal(r.ranges[0].start,text.indexOf("9. Harvard Reference List"));
  assert.equal(r.ranges[0].end,text.indexOf("10. Appendix:"));
  assert.equal(r.ranges[1].start,text.lastIndexOf("References\n"));
  assert.equal(r.ranges[1].end,text.length);
  for(const prepared of [scan.buildAiInput(text,layout),scan.buildSimilarityInput(text,scan.FILTER_MODE_FILTERED,[],layout)]){
    assert(prepared.text.includes("10. Appendix:"));
    assert(prepared.text.includes("Residential Property Prices in Norwich"));
    assert(!prepared.text.includes("StataCorp (n.d.-a)"));
    assert(!prepared.text.includes("Berk, J. and DeMarzo"));
  }
}

// Orientation: the full 16-page presentation was appended a second time.
// A new copy starts immediately after slide 16's bibliography. The full
// second copy and its citations should remain visible; both bibliography
// blocks should be excluded from provider text (not from original PDF).
{
  const slides=[
    ["Welcome to AT&T","New Employee Orientation & Onboarding","Connecting people to greater possibility"],
    ["Today's Agenda","Meet & Greet, Our Company, Our Direction and Our People","Welcome, icebreaker, introductions, AT&T, business units, culture and next steps"],
    ["Fun Team Introductions","Meet your onboarding team","Share your name and your role"],
    ["About AT&T","Headquartered in Dallas, Texas","Provides 5G wireless, fiber internet, and secure business connectivity"],
    ["Watch: Who We Are","Watch this short video about AT&T","Open the AT&T YouTube channel"],
    ["Organizational Structure","Board of Directors","CEO and business divisions"],
    ["Business Units","Advanced Connectivity","Legacy Services and Latin America"],
    ["Technology We Use","5G Network","AT&T Fiber, FirstNet and Dynamic Defense"],
    ["Purpose, Vision & Strategy","Connecting people to greater possibility","Bring connectivity to everyone"],
    ["Culture, Inclusion & Diversity","35K employees in groups","Everyone can bring their unique perspective"],
    ["Community Involvement","Supporting the digital divide","Hiring technicians"],
    ["Our Mission","Bring connectivity to everyone","Wherever they live"],
    ["Your First 90 Days","Days 1 through 30","Days 31 through 90"],
    ["Questions?","What did you hear today that surprised you?","Who will you reach out to first?"],
    ["Welcome to the team!","Meet your manager","Contact HR any time"],
    ["References","AT&T. (n.d.-a). AT&T corporate profile. https://about.att.com/pages/corporate-profile",
      "AT&T. (n.d.-b). AT&T culture and inclusion. https://about.att.com/pages/inclusion",
      "Databahn. (n.d.). AT&T org chart report. https://www.databahn.com/pages/att-org-chart",
      "Zacks. (2026). AT&T Q4 2025 results. https://www.zacks.com/stock/news/2824447/"]
  ];
  const rows=[];
  for(let repetition=0;repetition<2;repetition++){
    slides.forEach((slide,i)=>{
      const page=repetition*16+i+1;
      let y=30;
      for(const item of slide){
        rows.push({text:item,page,x:item==="References"?290:44,y});
        y+=20;
      }
    });
  }
  const {text,layout}=fixture(rows),r=inspectReferenceSections(text,-1,[],layout);
  assert.equal(r.reviews.length,0,JSON.stringify(r.reviews));
  assert.equal(r.ranges.length,2,JSON.stringify(r.ranges));
  assert.equal(r.ranges[0].start,text.indexOf("References\n"));
  assert.equal(r.ranges[0].end,text.indexOf("Welcome to AT&T",text.indexOf("References\n")+1));
  assert.equal(r.ranges[1].end,text.length);
  for(const prepared of [scan.buildAiInput(text,layout),scan.buildSimilarityInput(text,scan.FILTER_MODE_FILTERED,[],layout)]){
    assert.equal(prepared.text.split("Welcome to AT&T").length-1,2,
      "Both presentations must remain included");
    assert(!prepared.text.includes("Databahn. (n.d.)"));
  }
}
console.log("PASS: actual-format Inclusive, Moral Identity and repeated-slide reference boundaries.");
