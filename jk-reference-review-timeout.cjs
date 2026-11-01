"use strict";

const REFERENCE_BOUNDARY_AUTO_RESOLVE_MS = 6 * 60 * 1000;

function getAutoResolveAt(review, now = Date.now()) {
  const existing = Number(review?.autoResolveAt);
  if (Number.isSafeInteger(existing) && existing > 0) return existing;
  // Legacy pending reviews that predate this feature receive a full grace
  // period from the first sweep; they are not expired immediately at deploy.
  return Number(now) + REFERENCE_BOUNDARY_AUTO_RESOLVE_MS;
}

function isAutoResolveDue(file, now = Date.now()) {
  if (String(file?.referenceBoundaryReviewStatus || "") !== "PENDING_ADMIN") return false;
  if (file?.referenceReviewNoProviderRequests !== true) return false;
  const review = file?.referenceBoundaryReview;
  if (!review ||
      !Number.isInteger(review.start) ||
      !Number.isInteger(review.sourceLength) ||
      review.start < 0 ||
      review.sourceLength <= review.start ||
      typeof review.sourceTextSha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(review.sourceTextSha256)) return false;
  const due = Number(review.autoResolveAt);
  return Number.isSafeInteger(due) && due > 0 && Number(now) >= due;
}

function makeTreatRemainderAsReferencesOverride(review, now = Date.now()) {
  if (!review ||
      !Number.isInteger(review.start) ||
      !Number.isInteger(review.sourceLength) ||
      review.start < 0 ||
      review.sourceLength <= review.start ||
      typeof review.sourceTextSha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(review.sourceTextSha256)) {
    throw new Error("Cannot auto-resolve an invalid reference-boundary review.");
  }
  return {
    start: review.start,
    end: review.sourceLength,
    sourceTextSha256: review.sourceTextSha256,
    approvedBy: "AUTO_TIMEOUT_TREAT_REMAINDER_AS_REFERENCES",
    approvedAt: Number(now),
    decision: "TREAT_REMAINDER_AS_REFERENCES",
    automatic: true
  };
}

module.exports = {
  REFERENCE_BOUNDARY_AUTO_RESOLVE_MS,
  getAutoResolveAt,
  isAutoResolveDue,
  makeTreatRemainderAsReferencesOverride
};
