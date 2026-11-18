"use strict";
// JK_ADMIN_WEB_PANEL_V1: /admin end to end on a real local server with fake bot
// functions. No Telegram, M-Pesa or provider requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createAdminPanel, totpAt, totpValid, isPanelFileId } = require("./jk-admin-panel.cjs");

(async () => {
  // 1. Authenticator codes: RFC 6238 test vector (secret "12345678901234567890").
  const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpAt(SECRET, 1), "287082");
  assert.equal(totpValid(SECRET, "287082", 59 * 1000), true);
  assert.equal(totpValid(SECRET, "000000", 59 * 1000), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-admin-panel-"));
  const run = path.join(dir, "provider-runs", "job1-0");
  fs.mkdirSync(path.join(run, "reports"), { recursive: true });
  fs.writeFileSync(path.join(run, "bundle.json"), "{}");
  fs.writeFileSync(path.join(run, "reports", "Essay_similarity.pdf"), "%PDF-1.4 fake");

  const calls = [];
  const env = { ADMIN_PANEL_PASSWORD: "" };
  const jobs = { job1: { jobId: "job1", userId: 111, createdAt: 1, status: "API_FAILED", files: [
    { jkSubmissionId: "trn:oid:::1:1234567890", file_name: "Essay.docx", providerStatus: "FAILED",
      providerError: "JK SimilarityCheck is temporarily unavailable (HTTP 502).\nstack...",
      providerRetryAt: Date.now() + 60000, providerRetryCount: 1, providerBundleFile: path.join(run, "bundle.json") }
  ] } };
  const refs = { r1: { userId: 222, amount: 100, status: "PENDING", paymentMethod: "MPESA", createdAt: 2, files: [{}],
    pendingProof: { type: "mpesa-text", amount: 100, code: "QJK4ABCD12", detectedTime: "18/11/26 1:05 PM", confidence: "High" } } };
  const panel = createAdminPanel({
    DATA_DIR: dir, MAX_BATCH_FILES: 10, env,
    bot: { telegram: { sendDocument: async (to, doc, extra) => calls.push(["send", to, doc.filename, doc.source.length, extra.caption]) } },
    getPaidJobs: () => jobs, getPaymentRefs: () => refs,
    isPaymentRefClosed: r => r.status === "COMPLETE",
    confirmPayment: async (u, s) => { calls.push(["confirm", u, s]); return { ok: true, message: "done" }; },
    cancelPayment: async (u, s) => { calls.push(["cancel", u, s]); return { ok: true, message: "done" }; },
    autoRetry: () => ({
      retryNow: async id => { calls.push(["retry", id]); return { ok: true }; },
      stop: async id => { calls.push(["stop", id]); return { stopped: true, running: false }; }
    }),
    startFreeScan: async o => { calls.push(["scan", o]); return { jobId: "jw", files: o.uploads.length }; },
    supportedScanUpload: n => /\.(pdf|docx|doc|pptx)$/i.test(n),
    freeScanEnabled: () => true,
    isWebUserId: id => String(id).startsWith("9"),
    sendAdmin: async t => calls.push(["admin", t])
  });
  const app = express();
  panel.install(app, express);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = "http://127.0.0.1:" + server.address().port;
  const P = { "X-Admin-Panel": "1" };
  const req = (p, o = {}) => fetch(base + p, { ...o, headers: { ...(o.headers || {}) } });
  const login = (pw, ip, code) => req("/admin/api/login", { method: "POST",
    headers: { ...P, "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify({ password: pw, code }) });

  try {
    // 2. Off until a strong password is set.
    assert.equal((await req("/admin")).status, 404);
    env.ADMIN_PANEL_PASSWORD = "short";
    assert.equal((await req("/admin")).status, 404, "12+ characters required");
    env.ADMIN_PANEL_PASSWORD = "correct horse battery";
    const page = await req("/admin");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("cache-control"), "no-store");

    // 3. API needs the panel header and a session.
    assert.equal((await req("/admin/api/overview")).status, 403);
    assert.equal((await req("/admin/api/overview", { headers: P })).status, 401);

    // 4. Wrong passwords: 5 tries lock that address; other addresses unaffected.
    for (let i = 0; i < 5; i++) assert.equal((await login("nope", "1.1.1.1")).status, 401);
    assert.equal((await login("correct horse battery", "1.1.1.1")).status, 429, "locked");

    // 5. Correct login: secure session cookie.
    const ok = await login("correct horse battery", "2.2.2.2");
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\/admin/);
    const S = { ...P, Cookie: cookie.split(";")[0] };

    // 6. Overview: orders with first-line errors, retry state, reports; pending payments with proof.
    const ov = await (await req("/admin/api/overview", { headers: S })).json();
    const f = ov.jobs[0].files[0];
    assert.equal(f.id, "1234567890");
    assert.equal(f.error, "JK SimilarityCheck is temporarily unavailable (HTTP 502).", "first line only");
    assert.deepEqual(f.reports, ["Essay_similarity.pdf"]);
    assert.equal(ov.payments[0].proof.code, "QJK4ABCD12");

    // 7. Report download: listed files only, no path tricks.
    const pdf = await req("/admin/api/files/1234567890/reports/Essay_similarity.pdf", { headers: S });
    assert.equal(pdf.status, 200);
    assert.equal(await pdf.text(), "%PDF-1.4 fake");
    assert.equal((await req("/admin/api/files/1234567890/reports/..%2Fbundle.json", { headers: S })).status, 404);

    // 8. Retry / stop / confirm / cancel reuse the bot's functions.
    await req("/admin/api/files/1234567890/retry", { method: "POST", headers: S });
    await req("/admin/api/files/1234567890/stop", { method: "POST", headers: S });
    await req("/admin/api/payments/222/confirm", { method: "POST", headers: S });
    await req("/admin/api/payments/222/cancel", { method: "POST", headers: S });
    assert.deepEqual(calls.slice(-4), [["retry", "1234567890"], ["stop", "1234567890"],
      ["confirm", "222", "admin-web-panel"], ["cancel", "222", "admin-web-panel"]]);

    // 9. Upload + free scan: unsupported types refused; stored file readable by the pipeline.
    const bad = await req("/admin/api/uploads", { method: "PUT", headers: { ...S, "X-File-Name": "virus.exe" }, body: "x" });
    assert.equal(bad.status, 400);
    const up = await (await req("/admin/api/uploads", { method: "PUT",
      headers: { ...S, "X-File-Name": encodeURIComponent("My Essay.pdf") }, body: "%PDF-1.4 essay" })).json();
    assert.match(up.uploadId, /^[a-z0-9]{24}$/);
    const scan = await (await req("/admin/api/free-scan", { method: "POST", headers: { ...S, "Content-Type": "application/json" },
      body: JSON.stringify({ uploads: [up.uploadId], service: "SIMILARITY", excludeBibliography: true, excludeQuotes: true }) })).json();
    assert.equal(scan.files, 1);
    const sc = calls.at(-1)[1];
    assert.equal(sc.type, "SIMILARITY");
    assert.deepEqual(sc.similarityOptions, { excludeBibliography: true, excludeQuotes: true });
    assert(isPanelFileId(sc.uploads[0].fileId));
    assert.equal(panel.readUpload(sc.uploads[0].fileId).toString(), "%PDF-1.4 essay");
    const expired = await req("/admin/api/free-scan", { method: "POST", headers: { ...S, "Content-Type": "application/json" },
      body: JSON.stringify({ uploads: ["a".repeat(24)] }) });
    assert.equal(expired.status, 400);

    // 10. Send a file: numeric Telegram IDs only; website customers refused.
    assert.equal((await req("/admin/api/send", { method: "PUT", headers: { ...S, "X-To-User": "abc", "X-File-Name": "r.pdf" }, body: "x" })).status, 400);
    assert.equal((await req("/admin/api/send", { method: "PUT", headers: { ...S, "X-To-User": "912345678", "X-File-Name": "r.pdf" }, body: "x" })).status, 400);
    const sent = await req("/admin/api/send", { method: "PUT",
      headers: { ...S, "X-To-User": "5189765792", "X-File-Name": "Report.pdf", "X-Caption": encodeURIComponent("Your report") }, body: "PDFDATA" });
    assert.equal(sent.status, 200);
    assert.deepEqual(calls.at(-1), ["send", "5189765792", "Report.pdf", 7, "Your report"]);

    // 11. Logout ends the session.
    await req("/admin/api/logout", { method: "POST", headers: S });
    assert.equal((await req("/admin/api/overview", { headers: S })).status, 401);

    // 12. Authenticator code required when configured.
    env.ADMIN_PANEL_TOTP_SECRET = SECRET;
    assert.equal((await login("correct horse battery", "3.3.3.3", "000000")).status, 401);
    assert.equal((await login("correct horse battery", "4.4.4.4", totpAt(SECRET, Math.floor(Date.now() / 30000)))).status, 200);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 13. Bot wiring: panel installed, uploads readable by the pipeline, free scan builds the admin job.
  const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  assert(bot.includes("adminPanel.install(app, express);"));
  assert(bot.includes("require(\"./jk-admin-panel.cjs\").isPanelFileId(fileId)"));
  assert(bot.includes("async function startAdminWebFreeScan(") && bot.includes("job.adminFreeScan = true;"));
  assert(bot.includes("retryNow") || fs.readFileSync(path.join(__dirname, "jk-provider-auto-retry.cjs"), "utf8").includes("async function retryNow("));

  console.log("PASS: /admin is off without a 12+ character password; secure headers, header + session on every call.");
  console.log("PASS: 5 wrong passwords lock an address; authenticator codes (RFC 6238); secure session cookie; logout.");
  console.log("PASS: orders, report downloads (no path tricks), retry/stop, confirm/cancel, upload + free scan, send file.");
})().catch(error => { console.error(error); process.exitCode = 1; });
