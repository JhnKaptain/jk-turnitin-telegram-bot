"use strict";

function invalid(message) {
  const error = new Error(message + " API submission blocked.");
  error.code = "API_MANUAL_REVIEW_REQUIRED";
  error.apiBlocked = true;
  throw error;
}

function positive(raw, name, fallback) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) invalid(name + " must be a positive whole number.");
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) invalid(name + " must be a positive whole number.");
  return value;
}

function timeOfDay(raw, name) {
  const value = String(raw == null ? "" : raw).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid(name + " must be HH:mm (EAT).");
  const [h,m] = value.split(":").map(Number);
  return h * 60 + m;
}

function within(nowMinutes, start, end) {
  if (start === end) invalid("A 10K window must have different start/end times.");
  return start < end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end;
}

function getWordLimitState(env = process.env, now = new Date()) {
  const normal = positive(env.API_MAX_WORDS, "API_MAX_WORDS", 5000);
  const switchValue = String(env.JK_10K_WINDOW_ENABLED ?? "0").trim();
  if (!["0","1",""].includes(switchValue)) invalid("JK_10K_WINDOW_ENABLED must be 0 or 1.");
  if (switchValue !== "1") {
    return { limit: normal, normal, extended: false, window: null };
  }
  const maximum = positive(env.JK_10K_MAX_WORDS, "JK_10K_MAX_WORDS", 10000);
  if (maximum > 10000 || maximum <= normal) {
    invalid("JK_10K_MAX_WORDS must exceed API_MAX_WORDS and not exceed 10000.");
  }
  // Exactly one recurring daily EAT window. It may cross midnight.
  // Legacy WINDOW_2 variables, if still present in Render, are ignored.
  const start = timeOfDay(env.JK_10K_WINDOW_1_START_EAT,
    "JK_10K_WINDOW_1_START_EAT");
  const end = timeOfDay(env.JK_10K_WINDOW_1_END_EAT,
    "JK_10K_WINDOW_1_END_EAT");
  const when = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(when.getTime())) invalid("Word limit clock is invalid.");
  // EAT is UTC+03:00 throughout the year; use UTC getters to avoid host TZ.
  const eat = (when.getUTCHours() * 60 + when.getUTCMinutes() + 180) % 1440;
  const active = within(eat, start, end);
  return {limit: active ? maximum : normal, normal, extended: active,
    window: active ? 1 : null};
}

function readApiWordLimit(env = process.env, now = new Date()) {
  return getWordLimitState(env, now).limit;
}

module.exports = {readApiWordLimit, getWordLimitState};
