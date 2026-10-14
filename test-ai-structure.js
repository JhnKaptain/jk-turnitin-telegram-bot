"use strict";
const assert = require("node:assert/strict");
const { excludeAiStructuralText } = require("./jk-ai-structure");
const { mapProviderRangesToSource, buildAiInput } = require("./jk-scan-text");
function fixture({ cover = true, centeredProse = false, broken = false } = {}) {
  const document = { text: "", pages: [] };
  function page(rows, pageNumber) {
    const start = document.text.length, items = [];
    for (const row of rows) {
      const fragments = row.fragments || [{ text: row.text, fontName: row.fontName || "body" }];
      let x = row.x ?? 72;
      for (const fragment of fragments) {
        const start = document.text.length, width = fragment.text.length * 5;
        document.text += fragment.text;
        items.push({ text: fragment.text, start, end: document.text.length, fontName: fragment.fontName,
          x, y: row.y, width, height: 12, hasEOL: false }); x += width;
      }
      items.at(-1).hasEOL = true; document.text += "\n";
    }
    document.pages.push({ pageNumber, start, end: document.text.length, width: 612, height: 792, rotation: 0, items });
    document.text += "\n";
  }
  if (cover) {
    const texts = ["Week (enter week #): (Enter assignment title)", "Student Name", "College of Nursing-PMHNP, Walden University",
      "NRNP 6635: Psychopathology and Diagnostic Reasoning", "Faculty Name", "Assignment Due Date"];
    page(texts.map((text, i) => ({ text, x: (612 - text.length * 5) / 2, y: 570 - i * 55,
      fontName: i ? "body" : "heading" })), 1);
    if (centeredProse) {
      const p = document.pages[0], text = "The patient reports sustained distress and impaired functioning in daily life.";
      const start = document.text.length;
      document.text += text + "\n";
      p.items.push({ text, start, end: start + text.length, x: (612 - text.length * 5) / 2,
        y: 200, width: text.length * 5, height: 12, fontName: "body", hasEOL: true });
      p.end = document.text.length;
    }
  }
  const rows = [
    { text: "Subjective:", fontName: "heading", y: 700 },
    { y: 660, fragments: [{ text: "CC", fontName: "heading" }, { text: " (chief complaint): “Mr. Nehring wants to fire me.”", fontName: "body" }] },
    { y: 620, fragments: [{ text: "HPI:", fontName: "heading" }, { text: " Ms. Branning reports reduced functioning and conflict with her employer.", fontName: "body" }] },
    { text: "Past Psychiatric History:", fontName: "heading", y: 580 },
    { y: 540, fragments: [{ text: "Medication trials:", fontName: "heading" }, { text: " Ms. Branning reports no previous psychotropic medication trials.", fontName: "body" }] },
    ...Array.from({ length: 8 }, (_, i) => ({ text: "The assessment considers symptoms, duration, functioning and relevant medical explanations.", y: 500 - i * 28 }))
  ];
  page(rows, cover ? 2 : 1);
  if (broken) document.pages.at(-1).items[0].end = 1;
  const prepared = { text: document.text, map: Array.from({ length: document.text.length }, (_, i) => i) };
  return { document, prepared };
}
function run() {
  const { document, prepared } = fixture(); const original = JSON.stringify(document);
  const result = excludeAiStructuralText(prepared, document);
  assert.equal(result.aiCoverPagesExcluded, 1);
  for (const text of ["Student Name", "Faculty Name", "Assignment Due Date", "Subjective:", "Past Psychiatric History:", "HPI:", "Medication trials:", "CC (chief complaint):"]) {
    const start = document.text.indexOf(text);
    assert(result.map.slice(start, start + text.length).every(x => x === null), text);
  }
  for (const body of ["Ms. Branning reports reduced functioning", "Ms. Branning reports no previous psychotropic", "“Mr. Nehring wants to fire me.”"]) {
    const start = document.text.indexOf(body); assert(result.text.includes(body));
    const mapped = mapProviderRangesToSource(result, [{ start, end: start + body.length }], "utf16");
    assert.equal(mapped.length, 1); assert.equal(document.text.slice(mapped[0].start, mapped[0].end), body);
  }
  assert.equal(result.text.length, prepared.text.length); assert.equal(result.map.length, result.text.length);
  assert.equal(JSON.stringify(document), original); assert.equal(prepared.text, document.text);
  const all = mapProviderRangesToSource(result, [{ start: 0, end: result.text.length }], "utf16");
  assert(all.every(range => result.aiStructuralHeadingSpans.every(span => range.end <= span.start || range.start >= span.end)));
  assert.equal(excludeAiStructuralText(fixture({ cover: false }).prepared, fixture({ cover: false }).document).aiCoverPagesExcluded, 0);
  const prose = fixture({ centeredProse: true });
  assert.equal(excludeAiStructuralText(prose.prepared, prose.document).aiCoverPagesExcluded, 0);
  const noLayout = { text: "A normal first-page essay explains the argument.", map: Array.from({ length: 48 }, (_, i) => i) };
  assert.strictEqual(excludeAiStructuralText(noLayout, null), noLayout);
  const input = buildAiInput(document.text, document);
  assert.equal(input.aiCoverPagesExcluded, 1); assert(!input.text.includes("Student Name"));
  assert(input.text.includes("Ms. Branning reports reduced functioning"));
  // A left-aligned one-word heading can be identified by formatting and following prose.
  const paragraph = "A careful assessment considers the patient's symptoms and current functioning.";
  const text = "Discussion\n" + paragraph;
  const bare = { text, pages: [{ pageNumber: 1, width: 612, height: 792, rotation: 0, items: [
    { text: "Discussion", start: 0, end: 10, fontName: "heading", x: 72, y: 700, width: 60, height: 12 },
    { text: paragraph, start: 11, end: text.length, fontName: "body", x: 72, y: 672, width: 450, height: 12 }
  ] }] };
  const barePrepared = { text, map: Array.from({ length: text.length }, (_, i) => i) };
  assert(excludeAiStructuralText(barePrepared, bare).aiStructuralHeadingSpans.some(s => s.text === "Discussion"));
  const narrative = "She reports: The patient describes ongoing stress and anxiety at work.";
  const proseDoc = { text: narrative, pages: [{ pageNumber: 1, width: 612, height: 792, rotation: 0, items: [
    { text: "She reports:", start: 0, end: 12, fontName: "heading", x: 72, y: 700, width: 60, height: 12 },
    { text: narrative.slice(12), start: 12, end: narrative.length, fontName: "body", x: 132, y: 700, width: 390, height: 12 }
  ] }] };
  const prosePrepared = { text: narrative, map: Array.from({ length: narrative.length }, (_, i) => i) };
  assert.equal(excludeAiStructuralText(prosePrepared, proseDoc).text, narrative);
  // Nulls must never become source offset zero, even in a whole-input provider range.
  const blocked = mapProviderRangesToSource({ text: "    body", map: [null, null, null, null, 20, 21, 22, 23] },
    [{ start: 0, end: 8 }], "utf16");
  assert.deepEqual(blocked.map(({ start, end }) => ({ start, end })), [{ start: 20, end: 24 }]);
  console.log("PASS: separate cover page, standalone headings, mixed-font clinical labels, preserved answers, unchanged source mapping, null barriers and actual buildAiInput integration. No API requests.");
}
module.exports = { run, fixture };
if (require.main === module) run();
