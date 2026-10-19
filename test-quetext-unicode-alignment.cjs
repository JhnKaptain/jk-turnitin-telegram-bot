"use strict";
// Synthetic, offline regression checks. No provider requests, PDFs, files or
// Telegram messages. Do not commit private customer checkpoints here.
const assert = require("node:assert/strict");
const { alignQuetextMatch } = require("./jk-match-offsets.js");

const phrase = "The highlighted passage contains a distinct statement about business objectives.";
const prepared = "Preface. " + "Alpha beta gamma. ".repeat(55) +
  " Mathematical symbols 𝑢𝑛𝑖𝑡 here. " +
  "Another ordinary paragraph. ".repeat(35) + phrase +
  " Sentence afterward continues safely. " + "Final explanatory text. ".repeat(60);
const returned = prepared.replace("𝑢𝑛𝑖𝑡", "????????????????????");

function match(text, target = phrase) {
  const start = text.indexOf(target);
  assert(start >= 0);
  return { start, end: start + target.length, text: target };
}
function review(action) {
  assert.throws(action, error => error.code === "QUETEXT_ALIGNMENT_REVIEW" &&
    error.message.startsWith("Quetext alignment requires review:"));
}

const aligned = alignQuetextMatch(prepared, match(returned), returned);
assert.equal(aligned.start, prepared.indexOf(phrase));
assert.equal(aligned.end, aligned.start + phrase.length);
assert.equal(aligned.alignmentMethod, "VERIFIED_PROVIDER_CONTEXT");
assert.equal(aligned.reportedStart, returned.indexOf(phrase));

const unchanged = alignQuetextMatch(prepared, match(prepared), prepared);
assert.equal(unchanged.alignmentMethod, "RETURNED_FULL_TEXT");
assert.equal(unchanged.start, prepared.indexOf(phrase));

const withoutReturned = alignQuetextMatch(prepared, match(prepared));
assert.equal(withoutReturned.start, prepared.indexOf(phrase));

// Quetext may report Unicode code-point offsets rather than UTF-16 indices.
const emoji = "🙂🙂🙂", unicodeProvider = emoji + returned;
const codePointStart = Array.from(unicodeProvider.slice(0, unicodeProvider.indexOf(phrase))).length;
const unicode = alignQuetextMatch(emoji + prepared, {
  start: codePointStart, end: codePointStart + Array.from(phrase).length, text: phrase
}, unicodeProvider);
assert.equal(unicode.start, (emoji + prepared).indexOf(phrase));

const bad = match(returned);
review(() => alignQuetextMatch(prepared, { ...bad, start: bad.start + 1, end: bad.end + 1 }, returned));
review(() => alignQuetextMatch(prepared, bad, returned.replace(phrase, "COMPLETELY DIFFERENT PASSAGE")));
review(() => alignQuetextMatch(prepared, bad, "Different content ".repeat(900) + phrase));

// Repeated target phrases are safe only when the surrounding text is unique.
const addition = "\nAnother distinct context before. " + phrase + " A different trailing context.";
const repeatedSource = prepared + addition, repeatedProvider = returned + addition;
const secondStart = repeatedProvider.lastIndexOf(phrase);
const distinct = alignQuetextMatch(repeatedSource, {
  start: secondStart, end: secondStart + phrase.length, text: phrase
}, repeatedProvider);
assert.equal(distinct.start, repeatedSource.lastIndexOf(phrase));

// Two identical blocks with identical context remain ambiguous.
const block = "Intro. " + "ABC ".repeat(40) + "MARKER to locate." + " XYZ".repeat(40);
const repeatedBlocks = block + "\n" + block;
const alteredBlocks = repeatedBlocks.replace("Intro.", "Intro?");
review(() => alignQuetextMatch(repeatedBlocks, match(alteredBlocks, "MARKER to locate."), alteredBlocks));

console.log("PASS: Quetext Unicode substitutions, verified offsets, UTF-16/code points, and repeated-text disambiguation.");
console.log("PASS: inaccurate offsets, corrupted passages, unrelated documents and ambiguous context rejected.");
console.log("Offline only: no provider calls, report rendering, customer files or Telegram deliveries.");
