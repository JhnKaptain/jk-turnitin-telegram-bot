"use strict";
const assert=require("node:assert/strict");
const {inspectReferenceSections}=require("./jk-reference-sections.js");
const scan=require("./jk-scan-text.js");
const source=[
"Context and reflection about teaching practice. ".repeat(18),
"References",
"Avari, P., Hamel, E., Schachter, R. E., & Hatton-Bowers, H. (2023). Communication with families:",
"Understanding the perspectives of early childhood teachers. Journal of Early Childhood",
"Research, 21(2), 241–255. https://doi.org/10.1177/1476718X221140747",
"Kambouri, M., Wilson, T., Pieridou, M., Quinn, S. F., & Liu, J. (2022). Making partnerships work:",
"Proposing a model to support parent-practitioner partnerships in the early years. Early",
"Childhood Education Journal, 50(4), 639–661.",
"Ruming, N., & McFarland, L. (2022). ‘When we sat together, it just worked’: Supporting",
"individual and collaborative reflective practice in a team of early childhood educators.",
"Australasian Journal of Early Childhood, 47(1), 32–47.",
"Skene, K., O’Farrelly, C. M., Byrne, E. M., Kirby, N., Stevens, E. C., & Ramchandani, P. G. (2022).",
"Can guidance during play enhance children’s learning and development in educational",
"contexts? A systematic review and meta-analysis. Child Development, 93(4), 1162–1180.",
"https://doi.org/10.1111/cdev.13730",
"Guiding Children’s Behaviour",
"Date: 19 October 2026",
"Context: Outdoor Play – Mini Trampoline",
"The real reflection examines how educators can support children's participation.",
"Another substantive discussion builds upon those observations.",
"References",
"Arthur, L., Beecher, B., Death, E., & Dockett, S. (2025). Programming and planning in early",
"childhood settings (9th ed.). Cengage Learning Australia.",
"Porter, L. (2016). Young children’s behaviour: Guidance approaches for early childhood",
"educators (4th ed.). Allen & Unwin.",
"Teaching Resources, Strategies and Transitions",
"Purpose",
"Substantive writing about daily classroom practice continues in this document."
].join("\n");
let pos=0,items=[],page=7,y=740; const fresh=new Set(["Avari,","Kambouri,","Ruming,","Skene,","Arthur,","Porter,"]);
for(const line of source.split("\n")){
 if(line==="Guiding Children’s Behaviour"){page=8;y=730}
 if(line==="References"&&items.some(i=>i.text==="References")){page=13;y=740}
 if(line==="Teaching Resources, Strategies and Transitions"){page=14;y=720}
 const first=[...fresh].some(t=>line.startsWith(t));
 const cont=(page===7||page===13)&&!first&&line!=="References";
 const x=line==="References"?280:cont?126:90;
 items.push({start:pos,end:pos+line.length,text:line,x,y,height:12,width:line.length*4,pageNumber:page});
 pos+=line.length+1;y-=page===7?27:page===13?16:20;
}
const pages=[...new Set(items.map(i=>i.pageNumber))].map(pageNumber=>({pageNumber,items:items.filter(i=>i.pageNumber===pageNumber)}));
const layout={text:source,pages};const decision=inspectReferenceSections(source,-1,[],layout);
assert.equal(decision.reviews.length,0,JSON.stringify(decision.reviews));
assert.equal(decision.ranges.length,2,JSON.stringify(decision.ranges));
assert.equal(decision.ranges[0].end,source.indexOf("Guiding Children’s Behaviour"));
assert.equal(decision.ranges[1].end,source.indexOf("Teaching Resources, Strategies and Transitions"));
const prepared=[scan.buildAiInput(source,layout),scan.buildSimilarityInput(source,scan.FILTER_MODE_FILTERED,[],layout)];
for(const p of prepared){for(const q of ["Understanding the perspectives","Ruming, N.","Can guidance during play","Porter, L.","educators (4th ed.)"])assert(!p.text.includes(q),"reference leaked "+q);for(const t of ["Guiding Children’s Behaviour","The real reflection","Teaching Resources, Strategies and Transitions","Substantive writing about daily"])assert(p.text.includes(t),"body missing "+t)}
console.log("PASS: six APA entries across two sections, double-spacing and hanging indent; all following substantive text included.");
