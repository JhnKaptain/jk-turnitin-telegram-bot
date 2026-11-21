"use strict";
// JK_AI_STAR_DISPLAY_V1: the admin status shows the AI score the way the report
// does: above 0 and below 20 is "*%" (with the exact score), never a rounded
// "0%" or "20%" that hides an AI HIGHLIGHTS-eligible result.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { summary } = require("./jk-provider-admin-status.js");

const line = aiPercent => summary({ job: { userId: 5189765792 }, file: { file_name: "Essay.docx", providerSimilarityPercent: 0 },
  stage: "delivered", rendered: { aiAvailable: true, aiPercent }, runAi: true }).split("\n").find(l => l.startsWith("AI: "));

assert.equal(line(0), "AI: 0%", "true zero stays 0%");
assert.equal(line(0.4), "AI: *% (exact 0.4%)", "was shown as 0%");
assert.equal(line(0.004), "AI: *% (exact below 0.01%)", "tiny but positive is still starred");
assert.equal(line(12.345), "AI: *% (exact 12.35%)");
assert.equal(line(19.6), "AI: *% (exact 19.6%)", "was shown as 20%");
assert.equal(line(20), "AI: 20%");
assert.equal(line(20.4), "AI: 20%");
assert.equal(line(57.5), "AI: 58%");

// Same rule as the report's "*% detected as AI" and the AI HIGHLIGHTS check.
const renderer = fs.readFileSync(path.join(__dirname, "jk-report-renderer-max.js"), "utf8");
assert(renderer.includes("const low = ai.available && value > 0 && value < 20;"));
assert(fs.readFileSync(path.join(__dirname, "jk-low-ai-review.cjs"), "utf8").includes("percent > 0 && percent < 20"));
assert(fs.readFileSync(path.join(__dirname, "jk-admin-panel.client.js"), "utf8").includes("f.ai > 0 && f.ai < 20 ? '*% ('"));
console.log("PASS: admin AI score shown like the report: *% (exact) above 0 and below 20; 0% only for a true zero.");
