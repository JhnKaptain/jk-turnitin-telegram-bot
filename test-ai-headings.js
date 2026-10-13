"use strict";
const assert = require("node:assert/strict");
const { excludeAiStructuralHeadings } = require("./jk-ai-headings");
const { mapProviderRangesToSource } = require("./jk-scan-text");

function fixture(label = "Potential Conflict", options = {}) {
  const lines = [
    "The organisation supports effective teamwork and community participation.",
    label,
    "Staff disagreement about programme priorities requires careful consideration and discussion.",
    "Managers can address these concerns through mediation and consultation with their employees.",
    "Further consultation helps employees identify shared priorities and agree on practical improvements.",
    "The review process should consider staffing capacity and maintain regular communication with teams."
  ];
  const text = lines.join("\n");
  let start = 0;
  const items = lines.map((line, i) => {
    const item = { text: line, start, end: start + line.length,
      fontName: i === 1 ? "heading" : "body", height: 12,
      x: i === 1 ? 256 : 72, y: 700 - i * 27.6,
      width: i === 1 ? 100 : 450, hasEOL: i === 2 };
    start += line.length + 1;
    return item;
  });
  Object.assign(items[1], options);
  const document = { text, pages: [{ pageNumber: 1, width: 612, height: 792, rotation: 0, items }] };
  return { document, prepared: { text, map: Array.from(text, (_, i) => i) } };
}

function run() {
  for (const label of ["Potential Conflict", "Two Recommendations for Future Adaptability",
    "Communication Approach's Influence on Goal",
    "A Detailed Analysis of Organisational Communication and Its Influence on Community Participation"]) {
    const { document, prepared } = fixture(label);
    const result = excludeAiStructuralHeadings(prepared, document);
    assert.equal(result.aiStructuralHeadingsExcluded, 1);
    assert.equal(result.text.length, prepared.text.length);
    assert.equal(result.map.length, result.text.length);
    assert.equal(prepared.text, document.text);
    const span = result.aiStructuralHeadingSpans[0];
    assert(result.map.slice(span.start, span.end).every(x => x === null));
    assert.equal(result.text.slice(span.start, span.end).trim(), "");
    const mapped = mapProviderRangesToSource(result,
      [{ start: 0, end: result.text.length }], "utf16");
    assert(mapped.every(r => r.end <= span.start || r.start >= span.end));
    const bodyStart = document.pages[0].items[2].start;
    const body = mapProviderRangesToSource(result,
      [{ start: bodyStart, end: document.text.length }], "utf16");
    assert.equal(body.length, 1);
    assert.equal(document.text.slice(body[0].start, body[0].end),
      document.text.slice(bodyStart));
  }
  for (const [label, options] of [
    ["Potential Conflict", { x: 72 }],
    ["Potential Conflict", { fontName: "body" }],
    ["Teams improve service.", {}],
    ["Can Teams Improve Service?", {}],
    ["Teams improve service", {}],
    ["Potential Conflict", { y: 500 }],
    ["Potential Conflict", { end: 1 }]
  ]) {
    const { document, prepared } = fixture(label, options);
    const result = excludeAiStructuralHeadings(prepared, document);
    assert.equal(result.aiStructuralHeadingsExcluded || 0, 0);
    assert.equal(result.text, prepared.text);
    assert.deepEqual(result.map, prepared.map);
  }
  const sample = fixture();
  sample.prepared.map[sample.document.pages[0].items[1].start] = null;
  assert.equal(excludeAiStructuralHeadings(sample.prepared, sample.document)
    .aiStructuralHeadingsExcluded, 0);
  assert.strictEqual(excludeAiStructuralHeadings(sample.prepared, null), sample.prepared);
  if (require("fs").readFileSync(require.resolve("./jk-scan-text"), "utf8")
      .includes("JK_AI_STRUCTURAL_HEADINGS_V1")) {
    const integration = fixture();
    const prepared = require("./jk-scan-text").buildAiInput(
      integration.document.text, integration.document);
    assert.equal(prepared.aiStructuralHeadingsExcluded, 1);
    assert(!prepared.text.includes("Potential Conflict"));
    assert(prepared.text.includes("Staff disagreement"));
    assert.equal(prepared.text.length, prepared.map.length);
    console.log("PASS: actual buildAiInput integration.");
  }
  console.log("PASS: heading exclusion, long labels, body preservation, null barriers, source mapping and conservative fallbacks. No API requests.");
}

if (require.main === module) run();
module.exports = { run };
