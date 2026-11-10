"use strict";
/*
  Offline test for the JK SimilarityCheck provider and the provider switch.
  A local mock server stands in for the JK SimilarityCheck API (code-point offsets,
  exactly as the real service returns them).
*/
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vm = require("node:vm");

const COPIED = "Tesla cut prices on its Model 3 and Model Y vehicles in the United States on Friday";
const TEXT =
  "Café pricing 🚗 in Zürich — 𝑥² note.\r\nOur essay starts here with original thoughts. " +
  COPIED + ". Then more original writing follows.";

function codePointIndex(text, sub) {
  const at = text.indexOf(sub);
  return Array.from(text.slice(0, at)).length; // code points before the match
}

function startServer() {
  const state = { checks: 0, deleted: [], received: null, next502: false };
  const server = http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (req.headers.authorization !== "Bearer test-key-0123456789abcdef") return send(401, { detail: "Missing or invalid API key" });
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/v1/checks/text") {
        if (state.next502) {
          state.next502 = false;
          res.writeHead(502, { "Content-Type": "text/html" });
          res.end("<!DOCTYPE html><html><title>502</title></html>");
          return;
        }
        state.received = JSON.parse(raw);
        state.checks += 1;
        return send(202, { id: "chk_test1", status: "queued" });
      }
      if (req.method === "GET" && req.url === "/v1/checks/chk_test1") {
        return send(200, { id: "chk_test1", status: "completed", similarity: 42 });
      }
      if (req.method === "GET" && req.url === "/v1/checks/chk_test1/report") {
        const text = state.received.text;
        const start = codePointIndex(text, COPIED);
        return send(200, {
          id: "chk_test1",
          similarity: 42,
          similarity_exact: 41.67,
          word_count: 30,
          sources: [
            { id: "web:https://news.example/a", url: "https://news.example/a", type: "web", title: "News page", percent: 41.67 },
            { id: "doi:10.1/x", url: "https://doi.org/10.1/x", type: "publication", title: "A Journal Article", percent: 5 }
          ],
          matches: [
            { source_id: "web:https://news.example/a", start, end: start + Array.from(COPIED).length, words: 16,
              counted: true, source_excerpt: COPIED },
            { source_id: "web:https://news.example/a", start: 0, end: 4, words: 1, counted: false, source_excerpt: "" },
            { source_id: "overlapped:not-listed", start, end: start + 10, words: 9, counted: true, source_excerpt: "" }
          ],
          text
        });
      }
      if (req.method === "DELETE" && req.url === "/v1/checks/chk_test1") {
        state.deleted.push("chk_test1");
        res.writeHead(204);
        return res.end();
      }
      if (req.url === "/v1/health") return send(200, { status: "ok", sources: ["cited", "web"] });
      if (req.url === "/v1/checks") return send(200, { checks: [] });
      return send(404, { detail: "Not found" });
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, state })));
}

(async () => {
  const { server, state } = await startServer();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-plag-"));
  try {
    process.env.JK_SIMILARITY_URL = "http://127.0.0.1:" + server.address().port + "/";
    process.env.JK_SIMILARITY_API_KEY = "test-key-0123456789abcdef";
    process.env.DATA_DIR = dataDir;
    delete process.env.PLAGIARISM_PROVIDER;
    delete process.env.PLAGIARISM_FALLBACK;

    const jk = require("./providers/jksimilarity.js");
    const { alignQuetextResultMatches } = require("./jk-match-offsets.js");

    // 1. Quetext-identical shape, UTF-16 offsets into the exact text sent.
    const submitted = [];
    const result = await jk.checkPlagiarism({ text: TEXT, title: "Essay.docx", pollMs: 1, onSubmitted: s => submitted.push(s) });
    assert.equal(state.received.text, TEXT, "text must arrive unchanged (CR LF kept)");
    assert.equal(state.received.exclude_bibliography, false);
    assert.equal(state.received.exclude_quotes, false);
    assert.deepEqual(submitted, [{ provider: "jksimilarity", reportId: "chk_test1" }]);
    assert.equal(result.provider, "jksimilarity");
    assert.equal(result.score, 41.67);
    assert.equal(result.inputText, TEXT);
    assert.equal(state.received.discovery_text, undefined,
      "legacy unfiltered client remains API-compatible");
    assert.equal(result.matches.length, 1, "uncounted and overlapped (unlisted) matches are left out");
    const [match] = result.matches;
    assert.equal(TEXT.slice(match.start, match.end), COPIED);
    assert.equal(match.text, COPIED);
    assert.deepEqual(match.source, { id: "web:https://news.example/a", url: "https://news.example/a", title: "News page", type: "internet" });
    assert.equal(match.inputTokenCount, 16);
    assert.equal(result.raw.text, undefined, "raw copy should not duplicate the text");
    // Failed CORE + web discovery must not become a falsely clean 0% report.
    assert.throws(
      () => jk.normalizeJkReport({
        id: "chk_incomplete",
        similarity_exact: 0,
        similarity: 0,
        candidate_sources: 0,
        sources_unavailable: ["core", "web"],
        sources: [],
        matches: []
      }, TEXT),
      /INCOMPLETE SOURCE COVERAGE/,
    );
    const isolatedFailure = jk.normalizeJkReport({
      id: "chk_partial", similarity_exact: 0, candidate_sources: 0,
      sources_unavailable: ["core"], sources: [], matches: [],
    }, TEXT);
    assert.equal(isolatedFailure.score, 0, "one failed provider alone is not enough to prove total search failure");

    // 1b. Filtered reports ask the service to leave out citation entries and quotes too.
    const originalDiscoveryText = TEXT + '\nReferences\nMishra, P. (2024). 10.1177/00113921231206491';
    await jk.checkPlagiarism({
      text: TEXT, title: "Essay.docx", pollMs: 1, filtered: true,
      discoveryText: originalDiscoveryText,
      discoveryReferenceRanges: [[Array.from(TEXT).length + 1, Array.from(originalDiscoveryText).length]]
    });
    assert.deepEqual(
      state.received.discovery_reference_ranges,
      [[Array.from(TEXT).length + 1, Array.from(originalDiscoveryText).length]],
      "checked bibliography boundaries must arrive separately from scoring text"
    );
    assert.equal(state.received.exclude_bibliography, true);
    assert.equal(state.received.exclude_quotes, true);
    assert.equal(state.received.text, TEXT, "scoring offsets must still use filtered text");
    assert.equal(state.received.discovery_text, originalDiscoveryText,
      "the original is transmitted only as a discovery input");

    // 2. The bot's existing alignment accepts it unchanged.
    const [aligned] = alignQuetextResultMatches(TEXT, result);
    assert.equal(aligned.alignmentMethod, "RETURNED_FULL_TEXT");
    assert.equal(aligned.start, match.start);
    assert.equal(aligned.end, match.end);

    // 3. Switch: default Quetext, Render setting, admin choice saved to DATA_DIR.
    const plagiarism = require("./providers/plagiarism.js");
    assert.equal(plagiarism.currentProvider().name, "quetext");
    process.env.PLAGIARISM_PROVIDER = "jksimilarity";
    assert.deepEqual(plagiarism.currentProvider(), { name: "jksimilarity", label: "JK SimilarityCheck", source: "render" });
    plagiarism.setProvider("quetext", { by: 1 });
    assert.deepEqual(plagiarism.currentProvider(), { name: "quetext", label: "Quetext", source: "admin" });
    assert.ok(fs.existsSync(path.join(dataDir, "plagiarismProvider.store.json")), "choice must be saved");
    plagiarism.setProvider(null);
    assert.equal(plagiarism.currentProvider().source, "render");
    assert.throws(() => plagiarism.setProvider("copyleaks"), /Unknown plagiarism provider/u);

    // 4. The switch routes scans to the chosen provider.
    const viaSwitch = await plagiarism.checkPlagiarism({ text: TEXT, title: "Essay.docx", pollMs: 1 });
    assert.equal(viaSwitch.provider, "jksimilarity");

    // 5. Errors are clear; fallback only when enabled.
    process.env.JK_SIMILARITY_API_KEY = "wrong-key";
    await assert.rejects(plagiarism.checkPlagiarism({ text: TEXT, title: "x" }), /HTTP 401: Missing or invalid API key/u);
    process.env.PLAGIARISM_FALLBACK = "quetext";
    const quetext = require("./providers/quetext.js");
    const original = quetext.checkPlagiarism;
    quetext.checkPlagiarism = async () => ({ provider: "quetext", matches: [] });
    try {
      assert.equal((await plagiarism.checkPlagiarism({ text: TEXT, title: "x" })).provider, "quetext");
    } finally {
      quetext.checkPlagiarism = original;
    }

    // 5b. Temporary deployment errors are reported clearly without
    // automatically retrying POST and risking duplicate paid scans.
    const before502 = state.checks;
    process.env.PLAGIARISM_FALLBACK = "";
    process.env.JK_SIMILARITY_API_KEY = "test-key-0123456789abcdef";
    state.next502 = true;
    await assert.rejects(jk.createPlagiarismReport({ text: TEXT, title: "test.docx" }),
      /temporarily unavailable \(HTTP 502\)/u);
    assert.equal(state.checks, before502, "a 502 must not trigger an unsafe automatic resubmission");

    // 6. Cleanup call works.
    process.env.JK_SIMILARITY_API_KEY = "test-key-0123456789abcdef";
    await jk.deletePlagiarismReport("chk_test1");
    assert.deepEqual(state.deleted, ["chk_test1"]);

    // 7. Report shows publication titles and types; Quetext-style sources stay "Internet".
    const renderer = fs.readFileSync(path.join(__dirname, "jk-report-renderer-max.js"), "utf8");
    assert.match(renderer, /JK_SOURCE_TYPES_AND_TITLES_V1/u);
    const percentStart = renderer.indexOf("// JK_WHOLE_PERCENT_DISPLAY_V1");
    const percentEnd = renderer.indexOf("function fmtDate(v)", percentStart);
    assert.ok(percentStart >= 0 && percentEnd > percentStart);
    const formatSimilarity = vm.runInNewContext(
      renderer.slice(percentStart, percentEnd) + "\nfmtSimilarityPct;"
    );
    assert.equal(formatSimilarity(0), "0%");
    assert.equal(formatSimilarity(0.47), "<1%");
    assert.equal(formatSimilarity(0.79), "1%");
    assert.match(renderer, /fmtSimilarityPct\(score\)/u);

    // 8. Admin command text and buttons.
    const admin = require("./jk-plagiarism-provider-admin.cjs");
    assert.match(admin.describe(), /In use: JK SimilarityCheck \(from the Render setting PLAGIARISM_PROVIDER\)/u);
    assert.equal(admin.keyboard().inline_keyboard[0][1].text, "✅ JK SimilarityCheck");

    // Admin menu and dashboard make provider switching accessible without typing.
    const botCode = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
    assert.match(botCode, /command: "plagiarism", description: "Choose plagiarism provider"/u);
    assert.match(botCode, /bot\.action\("ADMIN_DASH_PLAGIARISM"/u);
    assert.match(botCode, /Markup\.button\.callback\("🔗 Plagiarism Provider", "ADMIN_DASH_PLAGIARISM"\)/u);
    assert.match(botCode, /"ADMIN_DASH_PLAGIARISM"\s*\)/u);

    console.log("JK SimilarityCheck provider: all checks passed");
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
