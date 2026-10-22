"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {layoutFidelityNote}=require("./jk-upload-layout-note.cjs");
assert.equal(layoutFidelityNote("report.pdf"),"");
assert.equal(layoutFidelityNote("report.PDF"),"");
for(const ext of ["docx","doc","odt","rtf"]) {
 const n=layoutFidelityNote("paper."+ext);
 assert.match(n,/export it to PDF/i);
 assert.match(n,/page breaks/i);
}
const bot=fs.readFileSync("bot.js","utf8");
const marker='require("./jk-upload-layout-note.cjs").layoutFidelityNote(storedFile.file_name)';
assert(bot.includes(marker));
console.log("PASS: PDF remains unchanged; Office uploaders receive page-fidelity advice.");
