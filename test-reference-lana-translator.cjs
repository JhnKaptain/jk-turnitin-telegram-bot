"use strict";
const assert=require("node:assert/strict");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const scan=require("./jk-scan-text.js");
const body="A research proposal explores Iraqi federalism and energy governance through constitutional and fiscal perspectives. ".repeat(22);
const refs=[
["Alkadiri, R. (2010). Oil and the question of federalism in Iraq. International Affairs, 86(6), 1315-","1328. https://www.jstor.org/stable/40929764"],
["Alkadiri, R. (2020). Federalism and Iraq's constitutional stalemate [Research paper]. Chatham","House. https://www.chathamhouse.org/2020/11/federalism-and-iraqs-constitutional-stalemate"],
["Constitution of the Republic of Iraq. (2005)."],
["Naji, A. (2025). The oil dispute between Baghdad and Erbil: A constitutional and economic","analysis (M. Alnofali, Trans.). Al-Bayan Center for Planning and Studies.","https://www.bayancenter.org"],
["Ottaway, M. (2024, July 16). Iraq and the demise of federalism. Wilson Center.","https://www.wilsoncenter.org/article/iraq-and-demise-federalism"],
["Smeekens, D., & Keil, S. (2022). The Iraqi oil and gas dispute between Baghdad and Erbil: A","commentary on the Iraqi Federal Supreme Court judgment of 15 February 2022 (IFF Working","Paper Online No. 31). Institute of Federalism, University of Fribourg.","https://doi.org/10.51363/unifr.diff.2022.31"],
["Wahab, B. A. (2015). Oil federalism in Iraq: Resource curse, patronage networks and stability.","Case studies of Baghdad, Kurdistan and the advent of ISIS (Publication No. 3706699) [Doctoral","dissertation, George Mason University]. ProQuest Dissertations and Theses."]
];
const parts=[body,"References"];for(const entry of refs)parts.push(...entry);
let source="",items=[],y=690;for(const t of parts){const start=source.length;source+=t+"\n";items.push({text:t,start,end:start+t.length,x:72.1,y,height:13.3,width:Math.max(20,t.length*4.2),pageNumber:7});y-=20.7;if(t==="References")y-=9;}
const layout={text:source,pages:[{pageNumber:7,items}]};
const check=inspectReferenceSections(source,-1,[],layout);
assert.deepEqual(check.reviews,[],JSON.stringify(check.reviews));
assert.equal(check.ranges.length,1,JSON.stringify(check.ranges));
assert.equal(check.ranges[0].end,source.length,"Seven references must run to EOF");
for(const prepared of [scan.buildAiInput(source,layout),scan.buildSimilarityInput(source,scan.FILTER_MODE_FILTERED,[],layout)]){
assert(prepared.text.includes("research proposal explores"));
for(const phrase of ["Naji, A.","analysis (M. Alnofali, Trans.).","Paper Online No.","Wahab, B.","Case studies of Baghdad"])assert(!prepared.text.includes(phrase),"Reference leak: "+phrase);
}
const split=source.replace("Naji, A. (2025). The oil dispute between Baghdad and Erbil: A constitutional and economic\nanalysis", "Naji, A. (2025). The oil dispute between Baghdad and Erbil: A constitutional and economic\nanalysis");
const fake={text:split,pages:[{pageNumber:7,items}]};
assert.equal(check.ranges[0].start,source.indexOf("References"));
console.log("PASS: Lana-shaped seven-reference bibliography including left-aligned translator line excluded to EOF without review.");
