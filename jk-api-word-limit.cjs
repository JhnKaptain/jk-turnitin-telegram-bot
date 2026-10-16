"use strict";
function readApiWordLimit(env = process.env) {
  const raw = String(env.API_MAX_WORDS ?? "").trim();
  if (!raw) return 5000;
  const limit = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(limit) || limit < 1) {
    const error = new Error("API_MAX_WORDS must be a positive whole number. API submission blocked.");
    error.code = "API_MANUAL_REVIEW_REQUIRED";
    error.apiBlocked = true;
    throw error;
  }
  return limit;
}
module.exports = { readApiWordLimit };
