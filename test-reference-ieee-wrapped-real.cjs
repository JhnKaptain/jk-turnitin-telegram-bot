"use strict";
const assert = require("node:assert/strict");
const { inspectReferenceSections } = require("./jk-reference-sections.js");
const scan = require("./jk-scan-text.js");

// Actual source-derived layout and reference opening lines from
// MN624 Assignment 2.docx, page 26. Publication years and DOIs are
// on following visual lines, not necessarily the opening author line.
// All assertions run offline; no provider API requests.
const lines = [
  ["Digital Forensic Investigation and E-Discovery at Apex Technologies", 2, 130],
  ["Task 1: Memory Forensics Using Volatility Framework", 2, 155],
  ["The Cridex memory image was analysed with Volatility 3 under read-only conditions.", 2, 190],
  ["Task 2: Acquisition and Investigation of a Virtual Machine Image", 9, 140],
  ["The evidence source was a Windows XP disk image examined using Autopsy.", 9, 180],
  ["Task 3: Network Intrusion Analysis Using Packet Capture Tools", 16, 140],
  ["Packet analysis was performed with Wireshark and protocol filters.", 16, 180],
  ["Task 4: Digital Communication and Mobile Device Evidence in e-Discovery", 21, 140],
  ["The sample holds no real email, and missing Message-ID metadata weakens interpretation.", 25, 650],
  ["References", 26, 72.5],
  ["[1] M. Daghmehchi Firoozjaei, A. H. Lashkari, and A. A. Ghorbani, “Memory forensics", 26, 100.1],
  ["tools: A comparative analysis,” J. Cyber Secur. Technol., vol. 6, no. 3, pp. 149–173, 2022.", 26, 127.7],
  ["[2] I. Shakhsheer, I. Mashaqi, M. Abdallah, and A. Awad, “Automated forensic analysis", 26, 155.3],
  ["following memory content using Volatility framework,” in Proc. 2023 Int. Conf. Innovation", 26, 182.9],
  ["Intell. Informat., Comput., Technol. (3ICT), Sakhir, Bahrain, Nov. 2023, doi:", 26, 210.5],
  ["10.1109/3ICT60104.2023.10391513.", 26, 238.1],
  ["[3] J. Dyson and S. Zargari, “Memory forensics: Comparing the correctness of memory", 26, 265.7],
  ["captures from locked Windows 10 machines using different boot capture vectors,” Latin-", 26, 293.3],
  ["Amer. J. Comput., vol. 9, no. 2, 2022.", 26, 320.9],
  ["[4] S. Ostrovskaya and O. Skulkin, Practical Memory Forensics. Birmingham, U.K.: Packt", 26, 348.5],
  ["Publishing, 2022.", 26, 376.1],
  ["[5] I. Kara, “Fileless malware threats: Recent advances, analysis approach through memory", 26, 403.7],
  ["forensics and research challenges,” Expert Syst. Appl., vol. 214, Art. no. 119133, 2022.", 26, 431.3]
];
let text = "", pages = new Map();
for (const [line, pageNumber, top] of lines) {
  const start = text.length;
  text += line + "\n";
  if (!pages.has(pageNumber)) pages.set(pageNumber, []);
  pages.get(pageNumber).push({text:line,start,end:start+line.length,pageNumber,x:72,y:792-top,height:13.3,width:400});
}
const layout = {text,pages:[...pages].map(([pageNumber,items])=>({pageNumber,items}))};
const result = inspectReferenceSections(text,-1,[],layout);
assert.deepEqual(result.reviews,[],JSON.stringify(result.reviews));
assert.equal(result.ranges.length,1,JSON.stringify(result.ranges));
assert.equal(result.ranges[0].start,text.indexOf("References\n"));
assert.equal(result.ranges[0].end,text.length);
assert.equal(text.match(/^\[\d\]/gm).length,5);
for(const prepared of [
  scan.buildAiInput(text,layout),
  scan.buildSimilarityInput(text,scan.FILTER_MODE_FILTERED,[],layout)
]){
  assert(prepared.text.includes("The sample holds no real email"));
  assert(!prepared.text.includes("Daghmehchi"));
  assert(!prepared.text.includes("Ostrovskaya"));
  assert(!prepared.text.includes("forensics and research challenges"));
  const first=prepared.text.indexOf("The sample holds no real email");
  assert.equal(text.slice(prepared.map[first],prepared.map[first]+9),"The sampl");
}
// Regression against prose that merely starts with a bracketed list number.
const listText = [
  "An analytical report about digital forensics and file recovery.",
  "References",
  "[1] Analyze the evidence carefully before drawing a conclusion.",
  "[2] A. Result is shown in the following table.",
  "References can include source documents but these are instructions."
].join("\n");
const check=inspectReferenceSections(listText);
assert.equal(check.ranges.length,0,"Numbered ordinary prose cannot be silently excluded as references");
console.log("PASS: actual page-26 IEEE author starts, wrapped years, and source maps");
console.log("PASS: ordinary numbered prose is not silently treated as IEEE citations");
