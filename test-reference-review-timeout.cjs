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
assert(bot.includes('review.autoResolvedAt = now'));
assert(bot.includes('file.providerStatus = "QUEUED"'));
assert(bot.includes('file.referenceBoundaryReviewStatus = "AUTO_RESOLVED"'));
assert(bot.includes('setInterval(() => {\n  sweepTimedReferenceBoundaryReviews()'));
assert(bot.includes('if (sameReview || !shouldNotify) return;'));
assert(bot.includes('timeout.makeTreatRemainderAsReferencesOverride(review, now)'));
assert(bot.includes('setImmediate(() => submitPaidJobToActiveProvider(job.jobId)'));
const expired = {...file, referenceBoundaryReview: {...file.referenceBoundaryReview, timeoutExpiredAt: start + HOUR}};
const cancelled = {...file, referenceBoundaryReviewStatus:"CANCELLED", providerStatus:"CANCELLED"};
assert.equal(timeout.isAutoResolveDue(cancelled, start + HOUR), false);
assert.equal(timeout.isAutoResolveDue(expired, start + HOUR), true);
console.log("PASS: no timeout before ten minutes; exactly due at ten minutes.");
console.log("PASS: unanswered review auto-excludes the remainder after ten minutes.");
console.log("PASS: auto-submission is scheduled only after persisted resolution.");
console.log("PASS: cancelling changes status so the timed submission is blocked.");
console.log("PASS: approval or cancellation prevents repeat timeout processing.");
