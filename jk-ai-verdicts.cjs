"use strict";
/*
  JK_AI_VERDICT_FREEZE_V1
  -----------------------
  A resubmitted essay keeps the AI verdict of every sentence that is unchanged.

  - The last successful AI check per owner is stored on the bot's disk
    (DATA_DIR/ai-verdicts), for 30 days. Only a short hash of each sentence and
    its final flag are kept, never the text.
  - A new check is matched to that baseline by sentence text. If at least 70%
    of its sentences appear in the baseline, the matched sentences keep their
    stored flag; only new or edited sentences use the fresh Sapling score.
  - Flagged ranges and the headline percentage are recalculated from the final
    flags, using the same formula as Sapling (flagged characters / all
    characters). Nothing extra is shown on the report.
  - A check below 70% overlap is a new essay: scored fresh, baseline replaced.
  - Failed checks never reach this module, so they never replace a baseline.
*/

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FLAG_THRESHOLD = 0.5;        // Sapling's AI-positive line
const MIN_OVERLAP = 0.7;           // share of sentences that must match the baseline
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const norm = value => String(value ?? "").replace(/\s+/gu, " ").trim();
const sha = value => crypto.createHash("sha256").update(value).digest("hex");

function sentenceKey(sentence) {
  return sha(norm(sentence)).slice(0, 32);
}

function ownerFile(dir, owner) {
  return path.join(path.resolve(dir), "ai-verdicts", sha("owner:" + String(owner)).slice(0, 32) + ".json");
}

function loadBaseline(dir, owner, now = Date.now()) {
  if (!dir || !owner) return null;
  const file = ownerFile(dir, owner);
  if (!fs.existsSync(file)) return null;
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null; // unreadable record: treat as no baseline, never as an error
  }
  if (!record || record.v !== 1 || !Array.isArray(record.sentences)) return null;
  if (!(now - Number(record.savedAt) <= RETENTION_MS)) return null;
  return record;
}

function saveBaseline(dir, owner, sentences, now = Date.now()) {
  if (!dir || !owner) return;
  const file = ownerFile(dir, owner);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record = {
    v: 1,
    savedAt: now,
    sentences: sentences.map(s => ({ k: sentenceKey(s.sentence), f: s.flag ? 1 : 0 }))
  };
  const temp = file + ".tmp-" + crypto.randomBytes(6).toString("hex");
  fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600, flag: "wx" });
  fs.renameSync(temp, file);
}

// Applies the baseline to a provider AI result. Returns a new result object;
// the input is not modified. With no usable baseline it is returned unchanged.
function applyFreeze(result, baseline) {
  const sentences = Array.isArray(result?.sentenceScores) ? result.sentenceScores : [];
  const freshFlags = sentences.map(s => Number(s.score) >= FLAG_THRESHOLD);
  if (!baseline || sentences.length === 0) {
    return { result, flags: freshFlags, stats: { mode: "fresh", sentences: sentences.length } };
  }

  const queues = new Map();
  for (const item of baseline.sentences) {
    if (!queues.has(item.k)) queues.set(item.k, []);
    queues.get(item.k).push(item.f === 1);
  }

  const matched = sentences.map(s => {
    const queue = queues.get(sentenceKey(s.sentence));
    return queue && queue.length ? { frozen: queue.shift() } : null;
  });
  const overlap = matched.filter(Boolean).length / sentences.length;
  if (overlap < MIN_OVERLAP) {
    return { result, flags: freshFlags, stats: { mode: "new-essay", overlap: round(overlap), sentences: sentences.length } };
  }

  let suppressed = 0, added = 0;
  const flags = sentences.map((s, i) => {
    const fresh = Number(s.score) >= FLAG_THRESHOLD;
    if (!matched[i]) return fresh;
    if (matched[i].frozen !== fresh) {
      if (fresh) suppressed++; else added++;
    }
    return matched[i].frozen;
  });

  // Sapling's own fraction is the starting point, so unchanged text reproduces it
  // exactly. Only the change caused by the frozen flags is applied on top.
  const chars = s => [...String(s.sentence ?? "")].length;
  const total = sentences.reduce((n, s) => n + chars(s), 0) || 1;
  const frozenChars = sentences.reduce((n, s, i) => n + (flags[i] ? chars(s) : 0), 0);
  const freshChars = sentences.reduce((n, s, i) => n + (freshFlags[i] ? chars(s) : 0), 0);
  const base = Number(result?.aiFraction);
  const aiFraction = Number.isFinite(base)
    ? base + (frozenChars - freshChars) / total
    : frozenChars / total;
  const ranges = sentences.filter((_, i) => flags[i]);

  const frozen = {
    ...result,
    ranges,
    aiFraction,
    percent: Math.round(aiFraction * 1000) / 10
  };
  return {
    result: frozen,
    flags,
    stats: {
      mode: "frozen",
      overlap: round(overlap),
      sentences: sentences.length,
      unchangedKept: matched.filter(Boolean).length,
      suppressedFlags: suppressed,
      restoredFlags: added
    }
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

module.exports = {
  FLAG_THRESHOLD,
  MIN_OVERLAP,
  RETENTION_MS,
  sentenceKey,
  loadBaseline,
  saveBaseline,
  applyFreeze
};
