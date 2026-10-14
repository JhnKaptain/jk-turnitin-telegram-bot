"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const norm = v => String(v || "").replace(/\s+/gu, " ").trim();

function validateBundle(bundle) {
  const ai = bundle.aiDetection;
  assert(ai && ai.available !== false && ai.provider === "sapling", "Saved Sapling result required.");
  assert(ai.percent !== null && ai.percent !== undefined && ai.percent !== "", "Saved AI percentage missing.");
  const percent = Number(ai.percent);
  assert(Number.isFinite(percent) && percent > 0 && percent < 20,
    "This option is only for saved AI results above 0% and below 20%.");
  const source = bundle.canonicalDocument?.text;
  assert(typeof source === "string", "Canonical source text missing.");
  assert(Array.isArray(ai.ranges) && ai.ranges.length, "No saved positive ranges to highlight. No new scan will be requested.");
  const groups = new Map();
  for (const range of ai.ranges) {
    assert(Number.isInteger(range.start) && Number.isInteger(range.end) &&
      range.start >= 0 && range.end > range.start && range.end <= source.length,
      "Invalid saved AI range.");
    assert(typeof range.sentence === "string" && norm(range.sentence), "Saved range wording missing; review required.");
    assert(Number.isFinite(range.score) && range.score >= 0.5, "Range is not a saved positive result.");
    const key = JSON.stringify([range.id, range.providerStart, range.providerEnd, range.sentence]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(range);
  }
  for (const ranges of groups.values()) {
    ranges.sort((a, b) => a.start - b.start);
    assert(ranges.every((r, i) => !i || r.start >= ranges[i - 1].end), "Overlapping duplicate AI fragments.");
    assert.equal(norm(ranges.map(r => source.slice(r.start, r.end)).join(" ")),
      norm(ranges[0].sentence), "Saved highlight wording disagrees with original text. Recover offsets first.");
  }
  return percent;
}

async function sendAdmin(filename, caption, options = {}) {
  const token = options.token || process.env.BOT_TOKEN;
  const admin = options.adminId || process.env.ADMIN_ID || "6569201830";
  assert(token, "BOT_TOKEN missing. PDF is saved locally; no message sent.");
  assert(/^\d+$/.test(String(admin || "")), "ADMIN_ID missing or invalid. No message sent.");
  const telegram = options.telegram || new (require("telegraf").Telegraf)(token).telegram;
  await telegram.sendDocument(Number(admin), {
    source: fs.createReadStream(filename), filename: path.basename(filename)
  }, { caption });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--list") {
    const root = path.join(process.env.DATA_DIR || "/var/data", "provider-runs");
    const eligible = [];
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const filename = path.join(root, entry.name, "bundle.json");
        if (!fs.existsSync(filename)) continue;
        try {
          const bundle = JSON.parse(fs.readFileSync(filename, "utf8"));
          const percent = validateBundle(bundle);
          const escaped = Array.from(filename, c => [34, 36, 92, 96].includes(c.charCodeAt(0))
            ? String.fromCharCode(92) + c : c).join("");
          eligible.push({ file: bundle.reportIdentity?.filename, percent,
            submission: bundle.reportIdentity?.jkSubmissionId,
            command: 'node jk-low-ai-review.cjs --bundle "' + escaped + '"',
            changed: fs.statSync(filename).mtimeMs });
        } catch (error) {
          // Unavailable, ineligible or unverified results are not offered.
        }
      }
    }
    eligible.sort((a, b) => b.changed - a.changed);
    console.log(JSON.stringify(eligible.slice(0, 20).map(({ changed, ...item }) => item), null, 2));
    console.log("Read-only list. No scans, PDF generation or Telegram deliveries.");
    return;
  }
  assert(args.length === 2 && args[0] === "--bundle",
    "Usage: node jk-low-ai-review.cjs --bundle /absolute/path/bundle.json OR --list");
  const bundlePath = path.resolve(args[1]);
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const percent = validateBundle(bundle);
  // Read once and pass this exact in-memory copy to the renderer.
  const outputDir = fs.mkdtempSync(path.join(path.dirname(bundlePath), "admin-low-ai-review-"));
  const outputPath = path.join(outputDir, "AI_HIGHLIGHTS.pdf");
  await require("./jk-report-renderer-max.js").renderAdminLowScoreAiReview({ bundle, bundlePath, outputPath });
  console.log("Review PDF:", outputPath);
  await sendAdmin(outputPath,
    "ADMIN REVIEW ONLY: Sapling " + percent + "% (below 20%). Supplementary highlights from saved results. Not a Turnitin report. No rescan or client delivery triggered.");
  console.log("Sent only to ADMIN_ID. Original bundle and job status unchanged. No provider requests.");
}
module.exports = { validateBundle, sendAdmin };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
