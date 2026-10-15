"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");

const norm = value => String(value || "").replace(/\s+/gu, " ").trim();
function indexed(value) {
  let text = "";
  const starts = [], ends = [];
  for (const part of value.matchAll(/\S+|\s+/gu)) {
    if (/^\s/u.test(part[0])) {
      text += " "; starts.push(part.index); ends.push(part.index + part[0].length);
    } else {
      for (let i = 0; i < part[0].length; i++) {
        text += part[0][i]; starts.push(part.index + i); ends.push(part.index + i + 1);
      }
    }
  }
  return { text, starts, ends };
}

function inferSelections(checkpoint, issues, findCandidates) {
  const selections = new Map();
  const prepared = checkpoint.preparedInputs?.ai;
  const scores = checkpoint.providerResults?.ai?.value?.sentenceScores;
  const ranges = checkpoint.providerResults?.ai?.value?.ranges;
  if (!prepared || !Array.isArray(scores) || !Array.isArray(ranges)) return selections;
  // Only use a complete, ordered, nonoverlapping provider sentence sequence.
  if (!scores.every((s, i) => typeof s.sentence === "string" && norm(s.sentence) &&
      Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start &&
      (!i || s.start >= scores[i - 1].end))) return selections;
  const anchors = scores.map(s => {
    if ((s.sentence.match(/\p{L}/gu) || []).length < 12 ||
        norm(s.sentence).split(" ").length < 2) return null;
    const found = findCandidates(prepared.text, s.sentence, s.start);
    return found.length === 1 ? found[0] : null;
  });

  for (const issue of issues) {
    if (!issue.key.startsWith("ai:")) continue;
    const entry = ranges[Number(issue.key.split(":")[1]) - 1];
    if (!entry) continue;
    const indexes = scores.map((s, i) => s.start === entry.start && s.end === entry.end &&
      norm(s.sentence) === norm(entry.sentence) ? i : -1).filter(i => i >= 0);
    if (indexes.length !== 1) continue;
    const index = indexes[0];
    let left = index - 1, right = index + 1;
    while (left >= 0 && !anchors[left]) left--;
    while (right < scores.length && !anchors[right]) right++;
    if (left < 0 || right === scores.length || right - left > 30) continue;
    const first = anchors[left], last = anchors[right];
    if (first.end > last.start || last.end - first.start > 4000) continue;

    // Verify EVERY intermediate sentence together, not just a guessed shift.
    const texts = scores.slice(left, right + 1).map(s => norm(s.sentence));
    const expected = texts.join(" ");
    const actual = indexed(prepared.text.slice(first.start, last.end));
    if (actual.text !== expected) continue;
    const offset = texts.slice(0, index - left).reduce((sum, s) => sum + s.length + 1, 0);
    const length = texts[index - left].length;
    const start = first.start + actual.starts[offset];
    const end = first.start + actual.ends[offset + length - 1];
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    const found = findCandidates(prepared.text, entry.sentence, entry.start);
    if (found.some(c => c.start === start && c.end === end)) selections.set(issue.key, start);
  }
  return selections;
}

// JK_AI_GLOBAL_SEQUENCE_RECOVERY_V1
// A distant occurrence is accepted only when the whole provider sequence, or
// a bounded suffix including neighbouring sentences, matches uniquely verbatim
// after whitespace normalization. Never use nearest-distance guessing.
function inferGlobalAiSelections(checkpoint, issues) {
  const selected = new Map();
  const prepared = checkpoint.preparedInputs?.ai;
  const state = checkpoint.providerResults?.ai;
  const scores = state?.value?.sentenceScores;
  const ranges = state?.value?.ranges;
  if (state?.status !== "fulfilled" || typeof prepared?.text !== "string" ||
      !Array.isArray(scores) || !scores.length || !Array.isArray(ranges) ||
      !scores.every((s, i) => typeof s.sentence === "string" && norm(s.sentence) &&
        Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start &&
        (!i || s.start >= scores[i - 1].end))) return selected;
  const input = indexed(prepared.text);
  function uniqueSequence(left, right) {
    const parts = scores.slice(left, right + 1).map(s => norm(s.sentence));
    if (parts.filter(s => (s.match(/\p{L}/gu) || []).length >= 20 && s.split(" ").length >= 5).length < 2) return null;
    const needle = parts.join(" ");
    if (needle.length < 100) return null;
    const at = input.text.indexOf(needle);
    if (at < 0 || input.text.indexOf(needle, at + 1) !== -1) return null;
    // No substring matches inside a larger word or punctuation token.
    if ((at && !/\s/u.test(input.text[at - 1])) ||
        (at + needle.length < input.text.length && !/\s/u.test(input.text[at + needle.length]))) return null;
    return { parts, at, left };
  }
  const whole = uniqueSequence(0, scores.length - 1);
  for (const issue of issues) {
    if (!/^ai:[1-9]\d*$/.test(issue.key)) continue;
    const entry = ranges[Number(issue.key.slice(3)) - 1];
    if (!entry) continue;
    const matches = scores.map((s, i) => s.start === entry.start && s.end === entry.end &&
      norm(s.sentence) === norm(entry.sentence) ? i : -1).filter(i => i >= 0);
    if (matches.length !== 1) continue;
    const index = matches[0];
    // Trailing runs have no right anchor, so verify the complete remaining
    // provider sequence plus at least one preceding sentence.
    const tail = scores.length - index <= 30 ? uniqueSequence(Math.max(0, index - 2), scores.length - 1) : null;
    const proof = whole || tail;
    if (!proof) continue;
    const relative = index - proof.left;
    const offset = proof.at + proof.parts.slice(0, relative).reduce((sum, text) => sum + text.length + 1, 0);
    const start = input.starts[offset], end = input.ends[offset + proof.parts[relative].length - 1];
    if (Number.isInteger(start) && Number.isInteger(end) && norm(prepared.text.slice(start, end)) === norm(entry.sentence)) {
      selected.set(issue.key, start);
    }
  }
  return selected;
}

// JK_QUETEXT_RETURNED_INPUT_RECOVERY_V1
function inferQuetextSelections(checkpoint, issues, findCandidates) {
  const selected = new Map();
  const prepared = checkpoint.preparedInputs?.similarity;
  const state = checkpoint.providerResults?.similarity;
  const provider = state?.value;
  if (state?.status !== "fulfilled" || typeof prepared?.text !== "string" ||
      typeof provider?.inputText !== "string" || !Array.isArray(provider.matches)) return selected;
  function trimmed(value) {
    const result = indexed(value);
    const leading = result.text.length - result.text.trimStart().length;
    const length = result.text.trim().length;
    return {
      text: result.text.trim(),
      starts: result.starts.slice(leading, leading + length),
      ends: result.ends.slice(leading, leading + length)
    };
  }
  const from = trimmed(provider.inputText), to = trimmed(prepared.text);
  if (from.text !== to.text) return selected;
  for (const issue of issues) {
    if (!issue.key.startsWith("similarity:")) continue;
    const entry = provider.matches[Number(issue.key.split(":")[1]) - 1];
    if (!entry || !Number.isInteger(entry.start) || !Number.isInteger(entry.end) ||
        entry.start < 0 || entry.end <= entry.start || entry.end > provider.inputText.length) continue;
    const passage = provider.inputText.slice(entry.start, entry.end);
    if (!norm(entry.text) || norm(passage) !== norm(entry.text)) continue;
    const first = passage.search(/\S/u);
    const trailing = passage.match(/\s*$/u)[0].length;
    const left = from.starts.indexOf(entry.start + first);
    const right = from.ends.indexOf(entry.end - trailing);
    if (left < 0 || right < left) continue;
    const start = to.starts[left], end = to.ends[right];
    if (findCandidates(prepared.text, entry.text, entry.start)
        .some(candidate => candidate.start === start && candidate.end === end)) {
      selected.set(issue.key, start);
    }
  }
  return selected;
}

function selfTest() {
  const a = "1 15 Dec 2026 Written structure";
  const b = "# Action Goal Deadline Evidence";
  const c = "4 Hold the first two planned difficult";
  const sentences = [a, b, c, "the plan where needed.", "1 and", "2", "28 Feb 2027 Review notes"];
  const earlier = b + "\nUnrelated text.\n";
  const text = earlier + sentences.join("\n\n");
  let at = earlier.length;
  const scores = sentences.map((sentence, i) => {
    const shift = i === 0 ? 21 : 23;
    const s = { sentence, start: at - shift, end: at - shift + sentence.length };
    at += sentence.length + 2; return s;
  });
  const checkpoint = { preparedInputs: { ai: { text } },
    providerResults: { ai: { value: { sentenceScores: scores, ranges: [scores[1], scores[4], scores[5]] } } } };
  const find = (input, target, reported) => {
    const h = indexed(input), needle = norm(target), found = [];
    let p = 0;
    while ((p = h.text.indexOf(needle, p)) !== -1) {
      const start = h.starts[p], end = h.ends[p + needle.length - 1];
      if (Math.abs(start - reported) <= 512) found.push({ start, end });
      p++;
    }
    return found;
  };
  const issues = ["ai:1", "ai:2", "ai:3"].map(key => ({ key }));
  const selected = inferSelections(checkpoint, issues, find);
  assert.equal(selected.size, 3);
  for (const [key, start] of selected) {
    assert.equal(start, checkpoint.providerResults.ai.value.ranges[Number(key.slice(3)) - 1].start + 23);
  }
  const original = checkpoint.preparedInputs.ai.text;
  checkpoint.preparedInputs.ai.text = original.replace("the plan where needed.", "Unexpected replacement.");
  assert.equal(inferSelections(checkpoint, [{ key: "ai:2" }], find).size, 0);
  checkpoint.preparedInputs.ai.text = original;
  checkpoint.providerResults.ai.value.sentenceScores = scores.slice().reverse();
  assert.equal(inferSelections(checkpoint, issues, find).size, 0);
  const phrase = "In Alfred the Great: Asser's Life of King";
  const qInput = "🙂 First reference. " + phrase + "\nNext details.\n\nSecond reference. " + phrase + "\nOther details.";
  const qPrepared = "\n\n" + qInput.replace(/\n/g, "\n\n");
  const firstStart = qInput.indexOf(phrase);
  const secondStart = qInput.lastIndexOf(phrase);
  const q = { preparedInputs: { similarity: { text: qPrepared } },
    providerResults: { similarity: { status: "fulfilled", value: {
      inputText: qInput, matches: [firstStart, secondStart].map(start => ({
        start, end: start + phrase.length, text: phrase
      }))
    } } } };
  const qIssues = [{ key: "similarity:1" }, { key: "similarity:2" }];
  const qSelected = inferQuetextSelections(q, qIssues, find);
  assert.equal(qSelected.size, 2);
  assert.equal(qSelected.get("similarity:1"), qPrepared.indexOf(phrase));
  assert.equal(qSelected.get("similarity:2"), qPrepared.lastIndexOf(phrase));
  q.preparedInputs.similarity.text = qPrepared.replace("Next details", "Different wording");
  assert.equal(inferQuetextSelections(q, qIssues, find).size, 0);
  q.preparedInputs.similarity.text = qPrepared;
  q.providerResults.similarity.value.matches[0].start++;
  assert(!inferQuetextSelections(q, qIssues, find).has("similarity:1"));
  console.log("PASS: Quetext repeated references, whitespace mapping, Unicode offsets and rejection of changed text/bad offsets.");
  console.log("PASS: changing offsets, repeated headers/cells, full-sequence verification and rejection of inconsistent evidence.");
}

function main() {
  selfTest();
  if (process.argv.includes("--self-test")) return;
  const args = process.argv.slice(2);
  const auditOnly = args.includes("--audit-only");
  const filtered = args.filter(a => a !== "--audit-only");
  assert(filtered.length === 2 && filtered[0] === "--checkpoint",
    "Usage: node jk-recover-reviewed-results.cjs --checkpoint PATH [--audit-only]");
  const filename = path.resolve(filtered[1]);
  const checkpoint = JSON.parse(fs.readFileSync(filename, "utf8"));
  const existing = require(path.join(__dirname, "jk-recover-provider-results.js"));
  const deps = {
    ...require(path.join(__dirname, "jk-match-offsets.js")),
    ...require(path.join(__dirname, "jk-ai-match-offsets.js")),
    ...require(path.join(__dirname, "jk-scan-text.js")),
    ...require(path.join(__dirname, "jk-provider-pipeline.js"))
  };
  const initial = existing.recover(checkpoint, new Map(), deps);
  const selections = inferSelections(checkpoint, initial.issues, existing.candidates);
  for (const [key, start] of inferQuetextSelections(checkpoint, initial.issues, existing.candidates)) {
    selections.set(key, start);
  }
  for (const [key, start] of inferGlobalAiSelections(checkpoint, initial.issues)) {
    selections.set(key, start);
  }
  const verified = existing.recover(checkpoint, selections, deps);
  for (const [key, start] of selections) console.log("Verified recovery selection:", key, "=>", start);
  if (verified.issues.length) {
    for (const issue of verified.issues) console.log(JSON.stringify(issue, null, 2));
    console.log("REVIEW REQUIRED. No reports written or sent. No provider requests.");
    process.exitCode = 2; return;
  }
  console.log("PASS: all positive ranges verified against saved input and original source.");
  if (auditOnly) { console.log("Audit only. No changes, scans or deliveries."); return; }
  const childArgs = [path.join(__dirname, "jk-recover-provider-results.js"),
    "--checkpoint", filename, "--send-admin"];
  for (const [key, start] of selections) childArgs.push("--select", key + ":" + start);
  const result = spawnSync(process.execPath, childArgs, { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
module.exports = { inferSelections, inferGlobalAiSelections, selfTest };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
