const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const newAiNote =
  "\u2139\uFE0F AI Writing Report Unavailable\n\n" +
  "\u{1F4CC} Turnitin AI may not show when:\n\n" +
  "\u{1F4DD} Essay/prose content is below 300 words or above 30,000 words\n" +
  "\u{1F310} File language is not English, Spanish, or Japanese\n" +
  "\u{1F4C4} File type is not .docx, .pdf, .txt, or .rtf\n\n" +
  "\u2705 If AI is unavailable, only the similarity report may be provided.";

const patterns = [
  /\u2139\uFE0F AI Writing Report Unavailable[\s\S]*?only the similarity report may be provided\./g,
  /ℹ️ AI Writing Report Unavailable[\s\S]*?only the similarity report may be provided\./g,
  /AI writing detection is unavailable for this submission\.[\s\S]*?more than 30,000 words/g,
  /ℹ️ AI writing detection is unavailable for this submission\.[\s\S]*?more than 30,000 words/g
];

let changed = false;

for (const pattern of patterns) {
  if (pattern.test(code)) {
    code = code.replace(pattern, newAiNote);
    changed = true;
    break;
  }
}

if (!changed) {
  throw new Error("AI unavailable note text not found. Search for: AI Writing Report Unavailable");
}

fs.writeFileSync(path, code, "utf8");
console.log("AI unavailable note updated successfully.");
