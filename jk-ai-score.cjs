"use strict";
/*
  JK_AI_SCORE_ROUNDING_V1: the AI score is never shown with decimals, and every
  rule uses the whole-number score (0.5 and above rounds up):
    rounds to 0      -> "0%": no star, no AI highlights
    rounds to 1-19   -> "*%": AI HIGHLIGHTS available
    rounds to 20+    -> the number, with the normal highlighted AI report
*/
function aiRounded(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}
function aiBand(value) {
  const r = aiRounded(value);
  if (r === null) return null;
  return r === 0 ? "zero" : r < 20 ? "star" : "normal";
}
const isStarred = value => aiBand(value) === "star";
module.exports = { aiRounded, aiBand, isStarred };
