"use strict";
// Real cases that went to administrator review with only "Cancel":
//  - Taask 1.docx: discussion post -> References (1 entry) -> "Hello Jeimy,"
//    reply -> References (1 entry) -> "Task 2" ... A short greeting or bare
//    task heading before new writing was not recognized as a boundary.
//  - Tiktok Research Project.docx: page number "10" on the line above
//    "Reference list" was read as part of a "10. Reference list" heading, and
//    a wrapped lower-case title line was mistaken for a prose sentence.
// Offline: no provider, Telegram or Render calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { inspectReferenceSections } = require("./jk-reference-sections.js");
const scan = require("./jk-scan-text.js");

const inspect = doc => inspectReferenceSections(doc.text, scan.findBibliographyStart(doc.text), [], doc);
const lineAt = (text, offset) => text.slice(offset, (text.indexOf("\n", offset) + 1 || text.length + 1) - 1);

// 1. Discussion posts with two short reference lists and a Task 2.
{
  const doc = require("./test-fixtures/discussion-posts-task2-real-geometry.json").document;
  const text = doc.text;
  const result = inspect(doc);
  assert.deepEqual(result.reviews, [], "no administrator review");
  assert.equal(result.ranges.length, 2, "both reference lists excluded");
  assert(text.slice(result.ranges[0].start).startsWith("References\nNelson, F. M."));
  assert(text.slice(result.ranges[1].start).startsWith("References\n\nHawk, K."));
  const afterFirst = lineAt(text, result.ranges[0].end);
  const afterSecond = lineAt(text, result.ranges[1].end);
  assert(afterFirst.split(/\s+/).length <= 3 && afterFirst.endsWith(","), "first list ends before the greeting line: " + afterFirst);
  assert(/^\S+ 2$/u.test(afterSecond), "second list ends before the 'Task 2' line: " + afterSecond);
  const ai = scan.buildAiInput(text, doc, []).text;
  assert(!ai.includes("Nelson, F. M., Jacob") && !ai.includes("Hawk, K., McCormack"), "references excluded from AI input");
  assert(ai.includes(afterFirst) && ai.includes(afterSecond), "greeting and Task 2 heading kept");
}

// 2. Harvard list whose page number sits on the line above the heading.
{
  const doc = require("./test-fixtures/harvard-pagenumber-heading-real-geometry.json").document;
  const text = doc.text;
  const result = inspect(doc);
  assert.deepEqual(result.reviews, [], "no administrator review, no phantom '10' heading");
  assert.equal(result.ranges.length, 1);
  assert(text.slice(result.ranges[0].start).startsWith("Reference list\nBläse, R."), "heading starts at 'Reference list', not at '10'");
  assert.equal(result.ranges[0].end, text.length, "40-entry list runs to the end of the document");
  const ai = scan.buildAiInput(text, doc, []).text;
  for (const entry of ["Bläse, R., Filser", "Chan, T.K.H.", "Zhong, B., Jie, D."]) assert(!ai.includes(entry), entry);
}

// 3. Short greeting / heading lines before new writing, any wording.
const essay = "The organisation should redesign its supply chain so that planning, sourcing and quality decisions reflect demand variability across every market.\n".repeat(20);
const refs = [
  "References",
  "Nelson, F. M., Jacob, P. A., & Arifin, H. H. (2026). Public support for plea-bargaining in",
  "serious economic crimes in Indonesia. Sriwijaya Law Review, 290–312.",
  "https://doi.org/10.28946/slrev.v10i2.4951"
].join("\n") + "\n";
const reply = "Your suggestion about the introduction of free rehabilitation is quite logical as an approach to the problem of drug policies, and the evidence supports it.\n";
for (const opener of ["Hello Jeimy,", "Hi Maria,", "Dear Professor Smith,", "Task 2", "Response to Peer 1", "Discussion Reply", "Part B"]) {
  const text = essay + refs + opener + "\n" + reply;
  const result = inspectReferenceSections(text, -1, [], null);
  assert.deepEqual(result.reviews, [], "no review before: " + opener);
  assert.equal(result.ranges.length, 1, opener);
  assert.equal(result.ranges[0].end, text.indexOf(opener + "\n"), "list ends at: " + opener);
}

// 4. Safety: a short line + prose that is followed by more entries in the
//    same list is still mixed content and goes to review, with a resume
//    option offered (never "Cancel" only).
{
  const mixed = essay + refs + "Hello Jeimy,\n" + reply +
    "Hawk, K., McCormack, R., & Edelman, E. J. (2022). Perspectives about emergency department care. JAMA Network Open, 5(1), e2144955.\n";
  const result = inspectReferenceSections(mixed, -1, [], null);
  assert.equal(result.ranges.length, 0);
  assert.equal(result.reviews.length, 1, "mixed content still fails closed");
  assert(result.reviews[0].candidates.length >= 1, "administrator is offered a resume point, not only Cancel");
}

// 5. Review timeout is 6 minutes and the Telegram text follows the setting.
const timeout = require("./jk-reference-review-timeout.cjs");
assert.equal(timeout.REFERENCE_BOUNDARY_AUTO_RESOLVE_MS, 6 * 60 * 1000);
const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
assert(bot.includes('"You have " + Math.round(require("./jk-reference-review-timeout.cjs").REFERENCE_BOUNDARY_AUTO_RESOLVE_MS / 60000) + " minutes'));
assert(!bot.includes("You have 10 minutes to select"));

console.log("PASS: real discussion-post file: both lists excluded, resumes at the greeting and at Task 2, no review");
console.log("PASS: real Harvard file: page number above 'Reference list' ignored, 40 entries excluded, no review");
console.log("PASS: greeting / Task / Response / Part openers end a list automatically; mixed lists still fail closed with a resume option");
console.log("PASS: reference review timeout is 6 minutes, message follows the setting");
