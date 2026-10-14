"use strict";
const fs = require("fs"), path = require("path"), assert = require("node:assert/strict");
async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 4 && args[0] === "--bundle" && args[2] === "--output", "Expected --bundle PATH --output PATH.");
  const bundlePath = path.resolve(args[1]), outputPath = path.resolve(args[3]);
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  require("./jk-low-ai-review.cjs").validateBundle(bundle);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await require("./jk-report-renderer-max.js").renderAdminLowScoreAiReview({ bundle, bundlePath, outputPath });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
