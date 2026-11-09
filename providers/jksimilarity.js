"use strict";

/*
  JK SimilarityCheck Plagiarism Provider
  --------------------------------------
  Drop-in alternative to providers/quetext.js.

  checkPlagiarism() returns exactly the same normalized shape as the Quetext
  provider, so the pipeline, alignment checks and report rendering work
  unchanged:

    { provider, reportId, status, score, wordCount, sentenceCount,
      inputText, matches: [{ id, start, end, text, inputTokenCount,
      percentSimilar, highlightedSnippet, source: { id, url } }], raw }

  Offsets: JK SimilarityCheck counts characters as Unicode code points;
  this module converts them to JavaScript (UTF-16) offsets into the exact
  text that was sent, which is what the pipeline expects from Quetext.

  Environment:
    JK_SIMILARITY_URL       base URL, e.g. https://check.example.com
    JK_SIMILARITY_API_KEY   API key issued by JK SimilarityCheck (JK_API_KEYS there)
    JK_SIMILARITY_MIN_WORDS optional smallest match (otherwise the service default)
*/

const DEFAULT_POLL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function config() {
  const baseUrl = String(process.env.JK_SIMILARITY_URL || "").trim().replace(/\/+$/u, "");
  const apiKey = String(process.env.JK_SIMILARITY_API_KEY || "").trim();
  if (!baseUrl) throw new Error("JK_SIMILARITY_URL is not configured.");
  if (!apiKey) throw new Error("JK_SIMILARITY_API_KEY is not configured.");
  return { baseUrl, apiKey };
}

async function jkRequest(path, { method = "GET", json = undefined } = {}) {
  const { baseUrl, apiKey } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = { Authorization: "Bearer " + apiKey };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(baseUrl + path, {
      method,
      body: json !== undefined ? JSON.stringify(json) : undefined,
      headers,
      signal: controller.signal
    });
  } catch (error) {
    throw new Error("JK SimilarityCheck request failed: " + (error?.name === "AbortError" ? "timed out" : error?.message || error));
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 204) return null;
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    const detail = typeof data?.detail === "string"
      ? data.detail
      : Array.isArray(data?.detail) ? data.detail.map(d => d?.msg).filter(Boolean).join(", ") : raw.slice(0, 200);
    const error = new Error("JK SimilarityCheck HTTP " + response.status + ": " + (detail || "request failed"));
    error.status = response.status;
    throw error;
  }
  return data;
}

/*
  Code-point offsets (Python) -> UTF-16 offsets (JavaScript) for `text`.
*/
function codePointToUtf16Index(text) {
  const index = [0];
  let utf16 = 0;
  for (const ch of text) {
    utf16 += ch.length;
    index.push(utf16);
  }
  return index;
}

function countSentences(text) {
  const found = String(text || "").match(/[^.!?\n]+[.!?]+/gu);
  return found ? found.length : 0;
}

/*
  Report -> Quetext-identical shape.
*/
function normalizeJkReport(report, inputText) {
  const text = String(inputText ?? report?.text ?? "");
  const toUtf16 = codePointToUtf16Index(text);
  // Only listed sources are kept: unlisted ones are fully overlapped by a higher-ranked
  // source (Turnitin: "overlapping sources will not be displayed").
  const listed = new Map((report?.sources || []).map(source => [source.id, source]));
  const TYPES = { publication: "database", web: "internet", wikipedia: "internet", submission: "batch" };
  const matches = [];
  for (const match of report?.matches || []) {
    if (match?.counted === false || !listed.has(match?.source_id)) continue;
    const listedSource = listed.get(match.source_id);
    const startCp = Number(match?.start);
    const endCp = Number(match?.end);
    if (!Number.isInteger(startCp) || !Number.isInteger(endCp) || endCp <= startCp || endCp >= toUtf16.length) continue;
    const start = toUtf16[startCp];
    const end = toUtf16[endCp];
    matches.push({
      id: "match-" + (matches.length + 1),
      start,
      end,
      text: text.slice(start, end),
      inputTokenCount: Number.isFinite(Number(match?.words)) ? Number(match.words) : null,
      percentSimilar: 100,
      highlightedSnippet: String(match?.source_excerpt || ""),
      source: {
        id: String(match.source_id),
        url: listedSource.url || null,
        title: listedSource.title || null,
        type: TYPES[listedSource.type] || "internet"
      }
    });
  }
  // A zero score is not evidence of originality when both primary discovery
  // channels failed. Surface the real failure to the bot instead of issuing a
  // deceptively clean 0% report.
  const unavailable = new Set((report?.sources_unavailable || []).map(x => String(x).toLowerCase()));
  const zeroScore = Number(report?.similarity_exact ?? report?.similarity) === 0;
  const noMatches = !Array.isArray(report?.matches) || report.matches.length === 0;
  const noCandidates = Number(report?.candidate_sources ?? 0) === 0;
  if (zeroScore && noMatches && noCandidates &&
      unavailable.has("core") && unavailable.has("web")) {
    const err = new Error(
      "INCOMPLETE SOURCE COVERAGE: CORE and Serper searches failed. " +
      "This is NOT a verified 0% similarity result. Review provider availability and daily search limits before retrying."
    );
    err.code = "SIMILARITY_COVERAGE_INCOMPLETE";
    err.reportId = report?.id || null;
    err.sourcesUnavailable = [...unavailable];
    throw err;
  }
  const raw = { ...(report || {}) };
  delete raw.text; // the input is kept separately as inputText
  return {
    provider: "jksimilarity",
    reportId: report?.id ? String(report.id) : null,
    status: "completed",
    score: Number.isFinite(Number(report?.similarity_exact)) ? Number(report.similarity_exact) : null,
    wordCount: Number.isFinite(Number(report?.word_count)) ? Number(report.word_count) : null,
    sentenceCount: countSentences(text),
    inputText: text,
    matches,
    raw
  };
}

async function createPlagiarismReport({ text, title, filtered = false }) {
  // Sent as JSON (not a form upload) so the text arrives exactly as sent:
  // form uploads turn line breaks into CR LF, which would shift every offset.
  // The pipeline already removes the reference section for filtered reports; `filtered`
  // also leaves out citation entries elsewhere (e.g. annotated bibliographies) and quotes.
  const body = {
    text: String(text || ""),
    filename: String(title || "document").slice(0, 255),
    exclude_bibliography: Boolean(filtered),
    exclude_quotes: Boolean(filtered)
  };
  const minWords = Number(process.env.JK_SIMILARITY_MIN_WORDS);
  if (Number.isInteger(minWords) && minWords >= 5) body.min_match_words = minWords;
  const created = await jkRequest("/v1/checks/text", { method: "POST", json: body });
  if (!created?.id) throw new Error("JK SimilarityCheck did not return a check id.");
  return { reportId: String(created.id), raw: created };
}

async function waitForPlagiarismReport(reportId, { pollMs = DEFAULT_POLL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, onProgress = null } = {}) {
  const startedAt = Date.now();
  let lastProgress = null;
  const progressOf = { queued: 0.05, processing: 0.5, completed: 1 };
  while (true) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("JK SimilarityCheck scan timed out.");
    const status = await jkRequest("/v1/checks/" + encodeURIComponent(reportId));
    if (status?.status === "failed") throw new Error("JK SimilarityCheck could not check the document: " + (status.error || "failed"));
    const progress = progressOf[status?.status] ?? null;
    if (progress !== lastProgress && typeof onProgress === "function") {
      try { onProgress(progress); } catch (error) { console.error("Progress notice failed:", error?.message || error); }
    }
    lastProgress = progress;
    if (status?.status === "completed") {
      return jkRequest("/v1/checks/" + encodeURIComponent(reportId) + "/report");
    }
    await sleep(Math.max(1000, Number(pollMs) || DEFAULT_POLL_MS));
  }
}

async function checkPlagiarism({ text, title, pollMs, timeoutMs, onProgress, onSubmitted = null, filtered = false }) {
  const created = await createPlagiarismReport({ text, title, filtered });
  if (typeof onSubmitted === "function") {
    try {
      await onSubmitted({ provider: "jksimilarity", reportId: created.reportId });
    } catch (error) {
      console.error("Submission notice failed:", error?.message || error);
    }
  }
  const report = await waitForPlagiarismReport(created.reportId, { pollMs, timeoutMs, onProgress });
  return normalizeJkReport(report, text);
}

async function getPlagiarismReport(reportId) {
  return jkRequest("/v1/checks/" + encodeURIComponent(reportId) + "/report");
}

async function deletePlagiarismReport(reportId) {
  if (!reportId) return null;
  return jkRequest("/v1/checks/" + encodeURIComponent(reportId), { method: "DELETE" });
}

/* Free connectivity test: the health endpoint plus an authenticated list call. */
async function getServiceStatus() {
  const { baseUrl } = config();
  const health = await (await fetch(baseUrl + "/v1/health")).json();
  await jkRequest("/v1/checks");
  return health;
}

module.exports = {
  checkPlagiarism,
  createPlagiarismReport,
  waitForPlagiarismReport,
  getPlagiarismReport,
  normalizeJkReport,
  deletePlagiarismReport,
  getServiceStatus,
  codePointToUtf16Index
};

if (require.main === module) {
  getServiceStatus()
    .then(health => console.log("JK SimilarityCheck reachable:", JSON.stringify(health)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
