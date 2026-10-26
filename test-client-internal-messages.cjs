"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const bot = fs.readFileSync(require.resolve("./bot.js"), "utf8");

// Internal report/provider workflow must never be exposed by customer notices.
assert(!bot.includes("Similarity-only files need administrator approval before the API scan."));
assert(!bot.includes("Eligible full-check files continue automatically. You will receive your report after processing."));
assert(!bot.includes("Similarity approval customer notice failed:"));

// Keep the approval request in the administrator workflow.
assert(bot.includes("SIMILARITY-ONLY API APPROVAL REQUIRED"));
assert(bot.includes("bot.telegram.sendMessage(ADMIN_ID"));
assert(bot.includes("Approve Quetext Only"));
console.log("PASS: no customer-facing similarity approval/API notice; admin approval remains available.");
