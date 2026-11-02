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

// 3b. Essay with "Question 1 ... Works Cited ... Question 2: Title ... Works
//     Cited". Line wraps depend on the fonts available to LibreOffice; with
//     some fonts the admin was offered a mid-paragraph inclusion point. The
//     numbered question heading now ends the first list automatically.
for (const name of ["two-works-cited-question-heading-real-geometry", "two-works-cited-question-heading-dejavu-real-geometry"]) {
  const doc = require("./test-fixtures/" + name + ".json").document;
  const text = doc.text;
  const result = inspect(doc);
  assert.deepEqual(result.reviews, [], name + ": no administrator review");
  assert.equal(result.ranges.length, 2, name + ": both Works Cited lists excluded");
  assert(/^Question 2: From \S+ to \S+\n/u.test(text.slice(result.ranges[0].end)), name + ": resumes at the Question 2 heading");
  assert.equal(result.ranges[1].end, text.length);
  const ai = scan.buildAiInput(text, doc, []).text;
  for (const entry of ["Fearon, J. D. (1995)", "Wendt, A. (1992)", "Art, R. J. (n.d.)"]) assert(!ai.includes(entry), name + ": excluded " + entry);
  const q2 = text.indexOf("\n", text.indexOf("Question 2: From ")) + 1;
  assert(ai.includes(text.slice(q2, q2 + 40).split("\n")[0]), name + ": first Question 2 paragraph scanned");
}
for (const heading of ["Question 2: From Power to Influence", "Part B: Reflection on Practice", "Section 3 - Comparative Analysis", "Question 4. Policy Options"]) {
  const text = essay + refs + heading + "\n" + reply + reply;
  const result = inspectReferenceSections(text, -1, [], null);
  assert.deepEqual(result.reviews, [], "no review before: " + heading);
  assert.equal(result.ranges[0].end, text.indexOf(heading + "\n"), "list ends at: " + heading);
}

// 3c. Research manuscript: ~60 APA references with full given names, the
//     year wrapped to the next line and long sentence-like titles. Was sent
//     to review with the first reference offered as the "inclusion" point.
{
  const doc = require("./test-fixtures/manuscript-fullname-apa-real-geometry.json").document;
  const text = doc.text;
  const result = inspect(doc);
  assert.deepEqual(result.reviews, [], "manuscript: no administrator review");
  assert.equal(result.ranges.length, 1);
  assert(text.slice(result.ranges[0].start).startsWith("References\nAl Halbusi, Hussam,"), "starts at the heading");
  assert.equal(result.ranges[0].end, text.length, "whole list to the end");
  const ai = scan.buildAiInput(text, doc, []).text;
  for (const entry of ["Al Halbusi, Hussam, Al-Sulaiti", "Moderating role of big data and knowledge management",
    "Zournatzidou, Georgia. (2025)", "Isomorphism and Collective Rationality"]) assert(!ai.includes(entry), "excluded: " + entry);
  assert(ai.length > 40000, "manuscript body kept");
}
{
  // A student paragraph after a reference without a DOI is never absorbed,
  // even when one of its lines ends with "(Barney, 1991, pp. 99–120).".
  const list = "References\nAl Halbusi, Hussam, Al-Sulaiti, Khalid Ibrahim, Alalwan, Ali Abdallah, & Al-Busaidi, Adil S.\n" +
    "(2025). AI capability and green innovation impact on sustainable performance:\n" +
    "Moderating role of big data and knowledge management. Technological Forecasting and\n" +
    "Social Change, 210, 123897. https://doi.org/10.1016/j.techfore.2024.123897\n" +
    "ClarityAI. (2025). Sustainable Finance Regulatory Outlook 2025.\n";
  const tail = "Firms in the region adopted green bonds slowly because regulators issued guidance late, as earlier studies\n" +
    "confirm that resources shape sustained advantage (Barney, 1991, pp. 99–120).\n" +
    "The remaining sections discuss implications for managers and for policy makers in detail.\n";
  const text = essay + list + tail;
  const result = inspectReferenceSections(text, -1, [], null);
  assert(result.reviews.length || result.ranges.every(r => r.end <= text.indexOf("Firms in the region")), "prose after the list is kept");
}

// 3d. Outline repeated over 40 pages: each reference list (5 entries, last
//     one closed by a DOI) is followed by a short title line and the next
//     heading ("Case Profile" / "Part III. Outline"). Was 10 reviews.
{
  const doc = require("./test-fixtures/repeated-outline-short-title-real-geometry.json").document;
  const text = doc.text;
  const result = inspect(doc);
  assert.deepEqual(result.reviews, [], "repeated outline: no administrator review");
  assert.equal(result.ranges.length, 11, "every reference list excluded");
  for (const range of result.ranges.slice(0, -1)) {
    const next = text.slice(range.end, range.end + 60);
    assert(/^\S+ \S+\n(?:\S+ \d+ of \d+\n\n)?Part \S+\. /u.test(next), "list ends at the short title line, not later: " + JSON.stringify(next));
  }
  const ai = scan.buildAiInput(text, doc, []).text;
  assert(!ai.includes("Crego, C., & Widiger") && !ai.includes("https://doi.org/10.1037/per0000550"), "references excluded");
}
{
  // Still fails closed when the text before the heading is a real sentence.
  const list = "References\nCrego, C., & Widiger, T. A. (2016). Cleckley's psychopaths: Revisited. Journal of Abnormal\nPsychology, 125 (1), 75-87. https://doi.org/10.1037/abn0000126\n";
  const text = essay + list + "I reviewed these sources carefully before writing the outline below.\nPart II. Methods\n" + reply + reply;
  const result = inspectReferenceSections(text, -1, [], null);
  assert(result.reviews.length || result.ranges.every(r => r.end <= text.indexOf("I reviewed these sources")), "a sentence before the heading is not swallowed");
}

// 3e. Chicago bibliography of web and archive sources: "Cincinnati Art
//     Museum. Identity. ... n.d. Accessed ...", a quoted photograph title
//     first, URLs wrapped over lines with %, & and =, "Publisher's
//     description", a wrapped title line that looks like an entry. Was a
//     review with only "treat remainder as references".
{
  const doc = require("./test-fixtures/chicago-web-bibliography-real-geometry.json").document;
  const text = doc.text;
  const result = inspect(doc);
  assert.deepEqual(result.reviews, [], "Chicago web bibliography: no administrator review");
  assert.equal(result.ranges.length, 1);
  assert(text.slice(result.ranges[0].start).startsWith("BIBLIOGRAPHY\n"));
  assert.equal(result.ranges[0].end, text.length, "every entry to the end excluded");
  const ai = scan.buildAiInput(text, doc, []).text;
  for (const entry of ["Cincinnati Art Museum. Identity", "Intellect. “The Making", "UBC Press. “Just Above", "Civil Rights Act of 1964. Public Law", "%5Cd1312%5Cu17813125"])
    assert(!ai.includes(entry), "excluded: " + entry);
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
console.log("PASS: real two-list essay (two fonts): numbered Question/Part/Section headings end a Works Cited list, no review");
console.log("PASS: real manuscript with full-given-name APA references: whole list excluded, no review; prose after a DOI-less entry kept");
console.log("PASS: real repeated outline: 11 lists end at the short title line before the next heading, no review");
console.log("PASS: real Chicago web-source bibliography (n.d., quoted titles, wrapped URLs): whole list excluded, no review");
console.log("PASS: reference review timeout is 6 minutes, message follows the setting");
