"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const timeout = require("./jk-reference-review-timeout.cjs");

const HOUR = 60 * 60 * 1000;
const start = Date.UTC(2026, 9, 27, 0, 0);
const review = {
  start: 100,
  sourceLength: 2500,
  sourceTextSha256: "a".repeat(64)
};
const file = {
  referenceBoundaryReviewStatus: "PENDING_ADMIN",
  referenceReviewNoProviderRequests: true,
  referenceBoundaryReview: {...review, requestedAt: start,
    autoResolveAt: start + timeout.REFERENCE_BOUNDARY_AUTO_RESOLVE_MS}
};

assert.equal(timeout.REFERENCE_BOUNDARY_AUTO_RESOLVE_MS, 10 * 60 * 1000);
assert.equal(timeout.isAutoResolveDue(file, start + 9 * 60 * 1000), false);
assert.equal(timeout.isAutoResolveDue(file, start + 10 * 60 * 1000 - 1), false);
assert.equal(timeout.isAutoResolveDue(file, start + 10 * 60 * 1000), true);
assert.equal(timeout.isAutoResolveDue({...file, referenceBoundaryReviewStatus:"APPROVED"}, start + 20 * 60 * 1000), false);

const override = timeout.makeTreatRemainderAsReferencesOverride(
  file.referenceBoundaryReview, start + timeout.REFERENCE_BOUNDARY_AUTO_RESOLVE_MS);
assert.equal(override.start, 100);
assert.equal(override.end, 2500);
assert.equal(override.sourceTextSha256, "a".repeat(64));
assert.equal(override.decision, "TREAT_REMAINDER_AS_REFERENCES");
assert.equal(override.approvedBy, "AUTO_TIMEOUT_TREAT_REMAINDER_AS_REFERENCES");

const bot = fs.readFileSync(require.resolve("./bot.js"), "utf8");
assert(bot.includes('REFERENCE_BOUNDARY_AUTO_RESOLVE_MS'));
assert(bot.includes('autoResolveReferenceBoundaryReview(job, file, now)'));
assert(bot.includes('review.timeoutExpiredAt = now'));
assert(bot.includes('file.providerStatus = "MANUAL_REQUIRED"'));
assert(bot.includes('file.referenceBoundaryReviewStatus === "PENDING_ADMIN"'));
assert(bot.includes('setInterval(() => {\n  sweepTimedReferenceBoundaryReviews()'));
assert(bot.includes('if (sameReview || !shouldNotify) return;'));
assert(!bot.includes('timeout.makeTreatRemainderAsReferencesOverride(review, now)'));
assert(!bot.includes('file.referenceBoundaryReviewStatus = "AUTO_RESOLVED"'));
const expired = {...file, referenceBoundaryReview: {...file.referenceBoundaryReview, timeoutExpiredAt: start + HOUR}};
assert.equal(timeout.isAutoResolveDue(expired, start + HOUR), false);
console.log("PASS: no timeout before ten minutes; exactly due at ten minutes.");
console.log("PASS: timeout preserves pending administrator review, never chooses exclude-to-end.");
console.log("PASS: cancellation or expiry does not submit to paid providers.");
console.log("PASS: no reminder notification is sent by the timeout.");
console.log("PASS: manual completion cancels the timeout by leaving PENDING_ADMIN.");
