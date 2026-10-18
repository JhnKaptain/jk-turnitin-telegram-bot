"use strict";
// Pure local regression: no network, no provider SDK, no file writes.
const assert = require("node:assert/strict");
const { excludeAiStructuralText } = require("./jk-ai-structure.js");
const { buildAiInput } = require("./jk-scan-text.js");

function makeDocument(pagesToCreate) {
  const document = { text: "", pages: [] };
  const titleIntervals = [];
  const bodyLines = [
    "The organisation supports effective teamwork and community participation.",
    "Staff disagreement about programme priorities requires careful consideration and discussion.",
    "Managers can address these concerns through mediation and consultation with their employees.",
    "Further consultation helps employees identify shared priorities and agree on practical improvements.",
    "The review process should consider staffing capacity and maintain regular communication with teams."
  ];
  for (let pageNumber = 1; pageNumber <= pagesToCreate; pageNumber++) {
    const lines = [bodyLines[0], "Potential Conflict", ...bodyLines.slice(1)];
    const items = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], start = document.text.length;
      document.text += line + "\n";
      if (i === 1) titleIntervals.push({ start, end: start + line.length });
      items.push({ text: line, start, end: start + line.length,
        fontName: i === 1 ? "heading" : "body", height: 12,
        x: i === 1 ? 256 : 72, y: 700 - i * 27.6,
        width: i === 1 ? 100 : 450, hasEOL: i === 2 });
    }
    document.pages.push({ pageNumber, width: 612, height: 792, rotation: 0, items });
    document.text += "\n";
  }
  return { document, titleIntervals, bodyLines };
}

function check(pages) {
  const { document, titleIntervals, bodyLines } = makeDocument(pages);
  const original = JSON.stringify(document);
  const prepared = { text: document.text,
    map: Array.from({ length: document.text.length }, (_, i) => i) };
  const result = excludeAiStructuralText(prepared, document);
  assert.equal(result.aiStructuralHeadingsExcluded, pages,
    "Must count each physical heading once, even if multiple classifiers find it");
  assert.equal(result.aiStructuralHeadingSpans.length, pages);
  const pairs = result.aiStructuralHeadingSpans.map(s => `${s.start}:${s.end}`);
  assert.equal(new Set(pairs).size, pages, "Duplicate coordinates in metadata");
  for (const { start, end } of titleIntervals) {
    assert(result.aiStructuralHeadingSpans.some(s => s.start === start && s.end === end));
    assert(result.map.slice(start, end).every(x => x === null), "Heading map barrier lost");
    assert.equal(result.text.slice(start, end).trim(), "", "Heading still in AI input");
  }
  assert(result.aiStructuralHeadingSpans.every(s => typeof s.reason === "string" && s.reason.length > 0),
    "Prefer informative classifier reasons over legacy unlabeled spans");
  for (const body of bodyLines) {
    const at = document.text.indexOf(body);
    assert(at >= 0);
    assert(result.text.includes(body), "Body text wrongly excluded");
    assert.deepEqual(result.map.slice(at, at + body.length),
      Array.from({ length: body.length }, (_, i) => at + i), "Body source mapping changed");
  }
  assert.equal(result.text.length, prepared.text.length);
  assert.equal(result.map.length, prepared.map.length);
  assert.equal(JSON.stringify(document), original, "Document mutated");
  assert.deepEqual(prepared.map, Array.from({ length: prepared.text.length }, (_, i) => i),
    "Prepared input mutated");
  // Confirm the actual scan-preparation entrypoint reports the same unique count.
  const built = buildAiInput(document.text, document);
  assert.equal(built.aiStructuralHeadingsExcluded, pages,
    "buildAiInput must not reintroduce duplicate exclusions");
  assert.equal(built.text.length, built.map.length);
  for (const title of titleIntervals) {
    assert(built.map.slice(title.start, title.end).every(x => x === null));
  }
}

check(1);
check(2); // Identical heading words at DIFFERENT coordinates must stay distinct.
console.log("PASS: headings counted once per exact source interval; repeated text in separate positions retained; body text and source maps preserved; buildAiInput integration. Offline only.");
