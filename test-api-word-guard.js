"use strict";

const fs = require("fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync(
  "jk-provider-pipeline.js",
  "utf8"
);

const start = source.indexOf(
  "// JK_SHARED_API_WORD_GUARD_V1"
);

const end = source.indexOf(
  "  const result = {",
  start
);

if (start < 0 || end <= start) {
  throw new Error(
    "Shared API word guard not found."
  );
}

const guard = source.slice(start, end);

const validate = new Function(
  "document",
  "similarityPrepared",
  "aiPrepared",
  "runSimilarity",
  "runAi",
  guard + "\nreturn true;"
);

function words(n) {
  return Array(n).fill("word").join(" ");
}

function test(label, original, similarity, ai, blocked) {
  let error = null;

  try {
    validate(
      {
        text: words(original),
        wordCount: original
      },
      { text: words(similarity) },
      { text: words(ai) },
      true,
      true
    );
  } catch (err) {
    error = err;
  }

  const actualBlocked =
    error?.code === "API_MANUAL_REVIEW_REQUIRED";

  assert.equal(
    actualBlocked,
    blocked,
    label + ": unexpected result"
  );

  console.log(
    "PASS:",
    label,
    actualBlocked ? "MANUAL REQUIRED" : "API ALLOWED"
  );
}

test("3000 words", 3000, 3000, 3000, false);
test("4500 words", 4500, 4500, 4500, false);
test("4799 words", 4799, 4799, 4799, false);
test("4800 words", 4800, 4800, 4800, true);
test("5000 words", 5000, 5000, 5000, true);
test("Quetext input oversized", 4700, 4800, 4700, true);
test("Sapling input oversized", 4700, 4700, 4800, true);
test("Empty original document", 0, 0, 0, true);

console.log(
  "\nALL WORD-LIMIT TESTS PASSED. NO API REQUESTS MADE."
);
