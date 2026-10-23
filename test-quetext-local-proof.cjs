"use strict";
const assert = require("node:assert/strict");
const { alignByVerifiedLocalContext: align } = require("./jk-quetext-local-proof.cjs");
const { alignQuetextMatch } = require("./jk-match-offsets.js");
const p = "A unique opening description with several details about the particular text. These further details establish what the specific textual portion is intended to communicate in this one passage. ";
const q = " Next section describes objectives in enough detail to confirm the original context. Further notes about requirements make the ending portion distinct and discoverable without guesses. ";
const target = "unique academic passage within a complicated sentence";
const original = "Intro filler ".repeat(120) + p + "prefix" + target + q + " End filler.".repeat(180);
// Use a mostly identical document with bounded provider-only text changes.
const returned = original
  .replace("Intro filler ".repeat(18), "Changed provider prefix ".repeat(18))
  .replace(" End filler.".repeat(22), " Altered suffix.".repeat(22));
const where = returned.indexOf(target);
const match = { start: where, end: where + target.length, text: target };
const verified = {start: original.indexOf(target), end: original.indexOf(target) + target.length};
assert.deepEqual(align(original, match, returned), verified);
const accepted = alignQuetextMatch(original, match, returned);
assert.equal(accepted.start, verified.start);
assert.equal(accepted.end, verified.end);
assert.equal(accepted.alignmentMethod, "VERIFIED_LOCAL_CONTEXT");
assert.equal(align(original, {...match, start: match.start + 1, end: match.end + 1}, returned), null);
assert.equal(align(original, match, "Different document ".repeat(200) + target), null);
const repeatedOriginal = original + " another location " + p + "prefix" + target + q;
assert.equal(align(repeatedOriginal, match, returned), null);
const editedOriginal = original.replace(p, "DIFFERENT PRECEDING CONTENT ".repeat(8)).replace(q, "DIFFERENT FOLLOWING CONTENT ".repeat(8));
assert.equal(align(editedOriginal, match, returned), null);
const providerEdited = returned.replace("within a complicated", "within an altered");
assert.equal(align(original, match, providerEdited), null);
// Even exact shared passages must not authenticate unrelated documents.
const foreignOriginal = "Original context A. ".repeat(150) + p + "prefix" + target + q + "Original ending A. ".repeat(150);
const foreignReturned = "Foreign context B. ".repeat(150) + p + "prefix" + target + q + "Foreign ending B. ".repeat(150);
const foreignOffset = foreignReturned.indexOf(target);
assert.equal(align(foreignOriginal, {start:foreignOffset, end:foreignOffset+target.length, text:target}, foreignReturned), null);
console.log("PASS: strict Quetext local-context fallback and negative safety cases; offline only.");
