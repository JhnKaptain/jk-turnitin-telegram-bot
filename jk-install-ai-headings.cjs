"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const helper = "\"use strict\";\n\n// Conservative layout heuristic, not a reproduction of Turnitin's parser.\nfunction excludeAiStructuralHeadings(prepared, document) {\n  if (!document || !Array.isArray(document.pages) ||\n      typeof document.text !== \"string\" ||\n      typeof prepared?.text !== \"string\" ||\n      !Array.isArray(prepared.map) ||\n      prepared.map.length !== prepared.text.length) return prepared;\n\n  const usage = new Map();\n  let total = 0;\n  for (const page of document.pages) {\n    for (const item of page.items || []) {\n      if (!item.fontName || !Number.isInteger(item.start) ||\n          !Number.isInteger(item.end) ||\n          document.text.slice(item.start, item.end) !== item.text) continue;\n      const count = (item.text.match(/\\p{L}/gu) || []).length;\n      usage.set(item.fontName, (usage.get(item.fontName) || 0) + count);\n      total += count;\n    }\n  }\n  const ranked = [...usage].sort((a, b) => b[1] - a[1]);\n  if (!total || !ranked.length || ranked[0][1] / total < 0.75) return prepared;\n  const bodyFont = ranked[0][0];\n  const spans = [];\n  const connectors = new Set([\n    \"a\", \"an\", \"and\", \"as\", \"at\", \"by\", \"for\", \"from\", \"in\", \"of\",\n    \"on\", \"or\", \"the\", \"to\", \"with\", \"without\"\n  ]);\n\n  for (const page of document.pages) {\n    if (page.rotation || !Number.isFinite(page.width)) continue;\n    const items = page.items || [];\n    for (let i = 0; i < items.length; i++) {\n      const item = items[i], next = items[i + 1], continuation = items[i + 2];\n      if (!item.fontName || item.fontName === bodyFont ||\n          !next || !continuation || next.fontName !== bodyFont ||\n          continuation.fontName !== bodyFont || !next.hasEOL) continue;\n      if (![item.x, item.y, item.width, item.height, next.y, continuation.y]\n          .every(Number.isFinite) || item.height <= 0 || item.width <= 0) continue;\n      if (!Number.isInteger(item.start) || !Number.isInteger(item.end) ||\n          item.start < 0 || item.end <= item.start ||\n          document.text.slice(item.start, item.end) !== item.text) continue;\n      const text = item.text.trim();\n      // Only a complete isolated line; no run-in headings or split text items.\n      const lineStart = document.text.lastIndexOf(\"\\n\", item.start - 1) + 1;\n      let lineEnd = document.text.indexOf(\"\\n\", item.end);\n      if (lineEnd < 0) lineEnd = document.text.length;\n      if (document.text.slice(lineStart, lineEnd).trim() !== text) continue;\n      // Keep sentences, questions and ambiguous lowercase labels for analysis.\n      if (/[.!?;]$/.test(text) || /[.!?]/.test(text.replace(/^\\d+[.)]\\s*/, \"\"))) continue;\n      const words = text.match(/\\p{L}[\\p{L}\\p{M}'\u2019\\-]*/gu) || [];\n      const significant = words.filter(word => !connectors.has(word.toLowerCase()));\n      if (significant.length < 2 ||\n          !significant.every(word => /^\\p{Lu}/u.test(word))) continue;\n      if (item.width > page.width * 0.8 ||\n          Math.abs(item.x + item.width / 2 - page.width / 2) > item.height * 1.5) continue;\n      if (item.y - next.y < item.height * 1.1 ||\n          item.y - next.y > item.height * 3.5 ||\n          next.y - continuation.y < item.height * 0.8 ||\n          next.y - continuation.y > item.height * 3.5) continue;\n      if (!/^\\s*\\n\\s*$/u.test(document.text.slice(item.end, next.start))) continue;\n      if (i > 0) {\n        const previous = items[i - 1];\n        const pageNumber = /^\\d+$/.test(previous.text.trim());\n        if (!pageNumber && (previous.fontName !== bodyFont || previous.hasEOL ||\n            !/[.!?][\"'\u2019\u201d)]?\\s*$/.test(previous.text))) continue;\n      }\n      spans.push({ start: item.start, end: item.end, text, pageNumber: page.pageNumber });\n    }\n  }\n\n  // Mask only fully mapped, exact spans. Nulls prevent highlights crossing them.\n  const indices = new Map();\n  prepared.map.forEach((source, index) => {\n    if (Number.isInteger(source)) indices.set(source, index);\n  });\n  const chars = prepared.text.split(\"\");\n  const map = prepared.map.slice();\n  const excluded = [];\n  for (const span of spans) {\n    const start = indices.get(span.start);\n    if (!Number.isInteger(start)) continue;\n    let valid = true;\n    for (let offset = 0; offset < span.end - span.start; offset++) {\n      if (map[start + offset] !== span.start + offset ||\n          chars[start + offset] !== document.text[span.start + offset]) {\n        valid = false;\n        break;\n      }\n    }\n    if (!valid) continue;\n    for (let offset = 0; offset < span.end - span.start; offset++) {\n      chars[start + offset] = \" \";\n      map[start + offset] = null;\n    }\n    excluded.push(span);\n  }\n  return {\n    ...prepared,\n    text: chars.join(\"\"), map,\n    aiHeadingPolicy: \"centered-distinct-font-title-case-v1\",\n    aiStructuralHeadingsExcluded: excluded.length,\n    aiStructuralHeadingSpans: excluded\n  };\n}\n\nmodule.exports = { excludeAiStructuralHeadings };\n";
const tests = "\"use strict\";\nconst assert = require(\"node:assert/strict\");\nconst { excludeAiStructuralHeadings } = require(\"./jk-ai-headings\");\nconst { mapProviderRangesToSource } = require(\"./jk-scan-text\");\n\nfunction fixture(label = \"Potential Conflict\", options = {}) {\n  const lines = [\n    \"The organisation supports effective teamwork and community participation.\",\n    label,\n    \"Staff disagreement about programme priorities requires careful consideration and discussion.\",\n    \"Managers can address these concerns through mediation and consultation with their employees.\",\n    \"Further consultation helps employees identify shared priorities and agree on practical improvements.\",\n    \"The review process should consider staffing capacity and maintain regular communication with teams.\"\n  ];\n  const text = lines.join(\"\\n\");\n  let start = 0;\n  const items = lines.map((line, i) => {\n    const item = { text: line, start, end: start + line.length,\n      fontName: i === 1 ? \"heading\" : \"body\", height: 12,\n      x: i === 1 ? 256 : 72, y: 700 - i * 27.6,\n      width: i === 1 ? 100 : 450, hasEOL: i === 2 };\n    start += line.length + 1;\n    return item;\n  });\n  Object.assign(items[1], options);\n  const document = { text, pages: [{ pageNumber: 1, width: 612, height: 792, rotation: 0, items }] };\n  return { document, prepared: { text, map: Array.from(text, (_, i) => i) } };\n}\n\nfunction run() {\n  for (const label of [\"Potential Conflict\", \"Two Recommendations for Future Adaptability\",\n    \"Communication Approach's Influence on Goal\",\n    \"A Detailed Analysis of Organisational Communication and Its Influence on Community Participation\"]) {\n    const { document, prepared } = fixture(label);\n    const result = excludeAiStructuralHeadings(prepared, document);\n    assert.equal(result.aiStructuralHeadingsExcluded, 1);\n    assert.equal(result.text.length, prepared.text.length);\n    assert.equal(result.map.length, result.text.length);\n    assert.equal(prepared.text, document.text);\n    const span = result.aiStructuralHeadingSpans[0];\n    assert(result.map.slice(span.start, span.end).every(x => x === null));\n    assert.equal(result.text.slice(span.start, span.end).trim(), \"\");\n    const mapped = mapProviderRangesToSource(result,\n      [{ start: 0, end: result.text.length }], \"utf16\");\n    assert(mapped.every(r => r.end <= span.start || r.start >= span.end));\n    const bodyStart = document.pages[0].items[2].start;\n    const body = mapProviderRangesToSource(result,\n      [{ start: bodyStart, end: document.text.length }], \"utf16\");\n    assert.equal(body.length, 1);\n    assert.equal(document.text.slice(body[0].start, body[0].end),\n      document.text.slice(bodyStart));\n  }\n  for (const [label, options] of [\n    [\"Potential Conflict\", { x: 72 }],\n    [\"Potential Conflict\", { fontName: \"body\" }],\n    [\"Teams improve service.\", {}],\n    [\"Can Teams Improve Service?\", {}],\n    [\"Teams improve service\", {}],\n    [\"Potential Conflict\", { y: 500 }],\n    [\"Potential Conflict\", { end: 1 }]\n  ]) {\n    const { document, prepared } = fixture(label, options);\n    const result = excludeAiStructuralHeadings(prepared, document);\n    assert.equal(result.aiStructuralHeadingsExcluded || 0, 0);\n    assert.equal(result.text, prepared.text);\n    assert.deepEqual(result.map, prepared.map);\n  }\n  const sample = fixture();\n  sample.prepared.map[sample.document.pages[0].items[1].start] = null;\n  assert.equal(excludeAiStructuralHeadings(sample.prepared, sample.document)\n    .aiStructuralHeadingsExcluded, 0);\n  assert.strictEqual(excludeAiStructuralHeadings(sample.prepared, null), sample.prepared);\n  if (require(\"fs\").readFileSync(require.resolve(\"./jk-scan-text\"), \"utf8\")\n      .includes(\"JK_AI_STRUCTURAL_HEADINGS_V1\")) {\n    const integration = fixture();\n    const prepared = require(\"./jk-scan-text\").buildAiInput(\n      integration.document.text, integration.document);\n    assert.equal(prepared.aiStructuralHeadingsExcluded, 1);\n    assert(!prepared.text.includes(\"Potential Conflict\"));\n    assert(prepared.text.includes(\"Staff disagreement\"));\n    assert.equal(prepared.text.length, prepared.map.length);\n    console.log(\"PASS: actual buildAiInput integration.\");\n  }\n  console.log(\"PASS: heading exclusion, long labels, body preservation, null barriers, source mapping and conservative fallbacks. No API requests.\");\n}\n\nif (require.main === module) run();\nmodule.exports = { run };\n";
const oldHook = "  return require(\"./jk-ai-line-wraps.js\")\n    .joinAiVisualLineWraps(excluded, document);";
const newHook = "  // JK_AI_STRUCTURAL_HEADINGS_V1\n  const prose = require(\"./jk-ai-headings.js\")\n    .excludeAiStructuralHeadings(excluded, document);\n\n  return require(\"./jk-ai-line-wraps.js\")\n    .joinAiVisualLineWraps(prose, document);";
const scanPath = path.resolve("jk-scan-text.js");
const helperPath = path.resolve("jk-ai-headings.js");
const testPath = path.resolve("test-ai-headings.js");

function check(filename, args = ["--check", filename]) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) throw result.error || new Error("Check failed: " + filename);
}

if (process.argv.includes("--audit")) {
  const file = process.argv[process.argv.indexOf("--audit") + 1];
  if (!file) throw new Error("Supply a bundle.json path after --audit.");
  const bundle = JSON.parse(fs.readFileSync(file, "utf8"));
  const document = bundle.canonicalDocument;
  if (!document?.text) throw new Error("Canonical document missing.");
  const prepared = require(scanPath).buildAiInput(document.text, document);
  if (prepared.aiHeadingPolicy !== "centered-distinct-font-title-case-v1") {
    throw new Error("Heading patch is not installed here.");
  }
  console.log(JSON.stringify({
    submission: bundle.reportIdentity?.jkSubmissionId,
    storedAiPercentUnchanged: bundle.aiDetection?.percent,
    headingsExcluded: prepared.aiStructuralHeadingsExcluded,
    spans: prepared.aiStructuralHeadingSpans,
    mapLengthMatches: prepared.text.length === prepared.map.length
  }, null, 2));
  console.log("Read-only preparation preview. No provider requests, file changes or reports sent.");
} else {
  const original = fs.readFileSync(scanPath, "utf8");
  const normalized = original.replace(/\r\n/g, "\n");
  const installed = normalized.includes("JK_AI_STRUCTURAL_HEADINGS_V1");
  if (!installed && normalized.split(oldHook).length !== 2) {
    throw new Error("Expected buildAiInput hook not found exactly once. Nothing changed.");
  }
  for (const [file, expected] of [[helperPath, helper], [testPath, tests]]) {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== expected) {
      throw new Error("Existing file differs: " + file + ". Nothing changed.");
    }
  }
  const helperExisted = fs.existsSync(helperPath);
  const testExisted = fs.existsSync(testPath);
  const backup = scanPath + ".heading-policy-backup-" + Date.now();
  try {
    if (!installed) fs.writeFileSync(backup, original, { flag: "wx" });
    fs.writeFileSync(helperPath, helper);
    fs.writeFileSync(testPath, tests);
    if (!installed) fs.writeFileSync(scanPath, normalized.replace(oldHook, newHook));
    check(helperPath);
    check(scanPath);
    check(testPath);
    check(testPath, [testPath]);
    if (fs.existsSync("test-api-word-guard.js")) {
      check("test-api-word-guard.js", ["test-api-word-guard.js"]);
    }
    console.log("PASS: heading policy installed and tested. No provider requests or deliveries.");
    if (!installed) console.log("Original scan-text backup: " + path.basename(backup));
  } catch (error) {
    if (!installed) fs.writeFileSync(scanPath, original);
    if (!helperExisted && fs.existsSync(helperPath)) fs.unlinkSync(helperPath);
    if (!testExisted && fs.existsSync(testPath)) fs.unlinkSync(testPath);
    console.error("Installation failed; original files restored.");
    throw error;
  }
}
