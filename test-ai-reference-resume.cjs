"use strict";
const assert = require("node:assert/strict");
const scan = require("./jk-scan-text.js");

const first = "First assignment content with original discussion and meaningful body paragraphs. ".repeat(20);
const source = [
  first,
  "",
  "References",
  "",
  "Hall, J. H., Lewis, M., Simpson, C., & Rice, C. (Eds.). (2024). Introduction to belief systems. Lynn University Digital Press.",
  "",
  "Humane World for Animals. (2025). Farm animal welfare: A risk consideration for financial institutions.",
  "",
  "Introduction",
  "",
  "The criminal justice system serves as the backbone of societal order, ensuring that laws are enforced, disputes are adjudicated, and corrections are administered justly.",
  "This paper compares the German and United States systems across three principal dimensions: policing, courts, and corrections.",
  "",
  "Introduction of Country",
  "",
  "Germany is known for its rich cultural history and stable political system. This paragraph must remain in the AI analysis after the first bibliography.",
  "",
  "Police",
  "",
  "In Germany, the police system is organized at both national and state levels. This substantive content must remain included.",
  "",
  "Conclusion",
  "",
  "The comparison reveals significant contrasts in structure, philosophy, and practice across policing, courts, and corrections."
].join("\n");

const ai = scan.buildAiInput(source);
assert(ai.text.includes("The criminal justice system serves as the backbone"),
  "AI input incorrectly truncated the essay after References.");
assert(ai.text.includes("Introduction of Country"));
assert(ai.text.includes("Police"));
assert(ai.text.includes("Conclusion"));
assert(!ai.text.includes("Hall, J. H., Lewis, M."));
assert(!ai.text.includes("Humane World for Animals. (2025)."));
for (const phrase of [
  "The criminal justice system serves as the backbone",
  "Germany is known for its rich cultural history",
  "In Germany, the police system is organized",
  "The comparison reveals significant contrasts"
]) {
  const at = ai.text.indexOf(phrase);
  assert(at >= 0, "Expected substantive section missing: " + phrase);
  assert(Number.isInteger(ai.map[at]));
  assert.equal(source.slice(ai.map[at], ai.map[at] + phrase.length), phrase,
    "AI source mapping broke for: " + phrase);
}

const similarity = scan.buildSimilarityInput(source, scan.FILTER_MODE_FILTERED);
assert(similarity.text.includes("The criminal justice system serves as the backbone"),
  "Similarity input incorrectly truncated the essay after References.");
assert(!similarity.text.includes("Introduction to belief systems. Lynn University Digital Press."));
console.log("PASS: AI and similarity inputs retain all substantive content after a reference block.");
console.log("PASS: bibliography entries excluded and post-reference source mapping intact.");
