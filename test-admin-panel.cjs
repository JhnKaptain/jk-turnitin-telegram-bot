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
  const shopCalls = [];
  let shopUrl = "https://shop.example.com";
  const shopOrders = {
    ORD_1700000000001_1: { id: "ORD_1700000000001_1", productName: "Grammarly", amount: 350, paymentState: "COMPLETE",
      paymentPhone: "254712345678", createdAt: 3, paymentConfirmedAt: 3, messages: [] },
    ORD_1700000000002_2: { id: "ORD_1700000000002_2", productName: "Chegg", amount: 500, paymentState: "COMPLETE", createdAt: 2,
      messages: [{ at: 10, from: "support", text: "Login: a" }, { at: 20, from: "client", text: "It says wrong password" }] },
    ORD_1700000000003_3: { id: "ORD_1700000000003_3", productName: "Quillbot", amount: 200, paymentState: "COMPLETE", createdAt: 1,
      messages: [{ at: 10, from: "support", text: "Done" }] },
    ORD_1700000000004_4: { id: "ORD_1700000000004_4", productName: "Turnitin", amount: 100, paymentState: "PENDING", createdAt: 4 },
    ORD_1700000000999_9: { id: "ORD_1700000000999_9", productName: "Old", paymentState: "COMPLETE", createdAt: 0, messages: [] }
  };
  const env = { ADMIN_PANEL_PASSWORD: "" };
  const jobs = { job1: { jobId: "job1", userId: 111, createdAt: 1, status: "API_FAILED", files: [
    { jkSubmissionId: "trn:oid:::1:1234567890", file_name: "Essay.docx", providerStatus: "FAILED",
      providerError: "JK SimilarityCheck is temporarily unavailable (HTTP 502).\nstack...",
      providerRetryAt: Date.now() + 60000, providerRetryCount: 1, providerBundleFile: path.join(run, "bundle.json") }
  ] } };
  const refs = { r1: { userId: 222, amount: 100, status: "PENDING", paymentMethod: "MPESA", createdAt: 2, files: [{}],
    pendingProof: { type: "mpesa-text", amount: 100, code: "QJK4ABCD12", detectedTime: "18/11/26 1:05 PM", confidence: "High" } } };
  const panelDeps = {
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
    sendAdmin: async t => calls.push(["admin", t]),
    deleteFiles: async (ids, by) => { calls.push(["delete", ids, by]); return { deleted: ids, skipped: [] }; },
    // JK_ADMIN_ORDER_DESK_V1
    messages: require("./jk-admin-messages.cjs").createMessageLog(path.join(dir, "admin-messages.json")),
    notes: { AI_UNAVAILABLE: "ℹ️ AI unavailable note", CLEAN_COPY: "🚫 Remove logo/name reminder" },
    replyToUser: async (u, t) => calls.push(["reply", u, t]),
    sendNote: async (u, k) => { calls.push(["note", u, k]); return "label"; },
    sendFileToUser: async (u, f, c) => calls.push(["deliver", u, f.name, f.buffer.length, c]),
    finishDelivery: async (u, n) => { calls.push(["done", u, n]); return { jobId: "job1" }; },
    customerOriginal: async f => ({ buffer: Buffer.from("ORIGINAL"), name: f.file_name }),
    processingMaxMinutes: () => 20,
    // JK_ADMIN_OTHER_SERVICES_V1: website shop orders
    shop: { enabled: () => true, key: () => "K".repeat(20), serviceUrl: () => shopUrl, readOrders: () => shopOrders },
    fetchImpl: async (url, init) => {
      shopCalls.push([url, init.method, init.headers.Authorization, init.headers["X-File-Name"] || null,
        Buffer.isBuffer(init.body) ? init.body.length : JSON.parse(init.body || "{}").text]);
      if (String(url).includes("ORD_1700000000999_9")) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
  };
  const panel = createAdminPanel(panelDeps);
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
    const ov = await (await req("/admin/api/overview?view=all", { headers: S })).json();
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
    const sent = await req("/admin/api/send", { method: "PUT",
      headers: { ...S, "X-To-User": "5189765792", "X-File-Name": "Report.pdf", "X-Caption": encodeURIComponent("Your report") }, body: "PDFDATA" });
    assert.equal(sent.status, 200);
    assert.deepEqual(calls.at(-1), ["deliver", "5189765792", "Report.pdf", 7, "Your report"]);

    // 10b. Delete selected files: valid report IDs only, passed to the shared delete.
    const del = (body) => req("/admin/api/files/delete", { method: "POST", headers: { ...S, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await del({ ids: [] })).status, 400);
    assert.equal((await del({ ids: ["../x"] })).status, 400);
    const dr = await (await del({ ids: ["1234567890"] })).json();
    assert.deepEqual(dr.deleted, ["1234567890"]);
    assert.deepEqual(calls.at(-1), ["delete", ["1234567890"], "admin-web-panel"]);
    jobs.job1.files[0].providerFilesDeletedAt = 9;
    // Orders whose files are all deleted leave the lists; search still finds them.
    const hidden = await (await req("/admin/api/overview?view=all", { headers: S })).json();
    assert(!hidden.jobs.some(j => j.jobId === "job1"), "fully deleted order hidden");
    const ov2 = await (await req("/admin/api/overview?view=all&q=1234567890", { headers: S })).json();
    assert.equal(ov2.jobs[0].files[0].deleted, 9);
    assert.deepEqual(ov2.jobs[0].files[0].reports, [], "no report links once deleted");

    // 10c. Order desk: Needs action, customer file, conversation, reply, notes, send files.
    jobs.job2 = { jobId: "job2", userId: 333, name: "Mary W", username: "maryw", createdAt: Date.now() - 3600000,
      paidAt: Date.now() - 3600000, status: "MANUAL_REQUIRED", route: "PENDING", amount: 150, files: [
        { jkSubmissionId: "trn:oid:::1:2222222222", file_name: "Thesis.docx", providerStatus: "MANUAL_REQUIRED" }] };
    jobs.job3 = { jobId: "job3", userId: 444, createdAt: Date.now() - 600000, paidAt: Date.now() - 600000,
      status: "API_PROCESSING", files: [] }; // within 20 min: nothing to do
    jobs.job4 = { jobId: "job4", userId: 555, createdAt: Date.now() - 7200000, status: "DELIVERED",
      deliveredAt: Date.now(), files: [] };
    let act = await (await req("/admin/api/overview?view=action", { headers: S })).json();
    assert.deepEqual(act.jobs.map(j => j.jobId), ["job2"]);
    assert.deepEqual(act.jobs[0].needs, ["Manual report needed"]);
    assert.equal(act.jobs[0].name, "Mary W");
    assert.equal(act.counts.action, 1);
    assert.equal(act.notes.CLEAN_COPY, "🚫 Remove logo/name reminder");
    // Search covers name, user ID, report ID and file name.
    for (const q of ["mary", "333", "2222222222", "thesis"]) {
      const r = await (await req("/admin/api/overview?view=all&q=" + q, { headers: S })).json();
      assert.deepEqual(r.jobs.map(j => j.jobId), ["job2"], q);
    }
    // A customer message with no reply puts that customer in Needs action.
    panelDeps.messages.log(555, "customer", "Hello, where is my report?");
    panelDeps.messages.log(777, "customer", "Do you check Arabic?");
    act = await (await req("/admin/api/overview?view=action", { headers: S })).json();
    assert(act.jobs.find(j => j.jobId === "job4").needs.includes("Customer waiting for a reply"));
    assert.deepEqual(act.waiting.map(w => w.userId), ["777"]);
    assert.equal(act.waiting[0].last, "Do you check Arabic?");
    assert.equal(act.counts.action, 3);

    const orig = await req("/admin/api/files/2222222222/original", { headers: S });
    assert.equal(orig.status, 200);
    assert.equal(await orig.text(), "ORIGINAL");
    assert.match(orig.headers.get("content-disposition"), /Thesis\.docx/);
    assert.equal((await req("/admin/api/files/2222222222/original")).status, 403, "panel header required");
    assert.equal((await req("/admin/api/files/1234567890/original", { headers: S })).status, 410, "deleted file");

    const J = { ...S, "Content-Type": "application/json" };
    assert.equal((await req("/admin/api/users/abc/reply", { method: "POST", headers: J, body: JSON.stringify({ text: "hi" }) })).status, 400);
    assert.equal((await req("/admin/api/users/333/reply", { method: "POST", headers: J, body: JSON.stringify({ text: " " }) })).status, 400);
    assert.equal((await req("/admin/api/users/333/reply", { method: "POST", headers: J, body: JSON.stringify({ text: "Your report is ready" }) })).status, 200);
    assert.deepEqual(calls.at(-1), ["reply", "333", "Your report is ready"]);
    assert.equal((await req("/admin/api/users/333/note", { method: "POST", headers: J, body: JSON.stringify({ kind: "toString" }) })).status, 400);
    assert.equal((await req("/admin/api/users/333/note", { method: "POST", headers: J, body: JSON.stringify({ kind: "CLEAN_COPY" }) })).status, 200);
    assert.deepEqual(calls.at(-1), ["note", "333", "CLEAN_COPY"]);
    const dv = await req("/admin/api/users/9000000000000123/deliver", { method: "PUT",
      headers: { ...S, "X-File-Name": encodeURIComponent("../Mary report.pdf"), "X-Caption": encodeURIComponent("Here you go") }, body: "PDF!" });
    assert.equal(dv.status, 200, "website customers too");
    assert.deepEqual(calls.at(-1), ["deliver", "9000000000000123", "Mary report.pdf", 4, "Here you go"]);
    assert.equal((await req("/admin/api/users/333/deliver", { method: "PUT", headers: { ...S, "X-File-Name": "a.pdf" }, body: "" })).status, 400);
    const done = await (await req("/admin/api/users/333/deliver/done", { method: "POST", headers: J, body: JSON.stringify({ count: 2 }) })).json();
    assert.equal(done.delivered, "job1");
    assert.deepEqual(calls.at(-1), ["done", "333", 2]);
    const th = await (await req("/admin/api/users/555/thread", { headers: S })).json();
    assert.equal(th.messages[0].text, "Hello, where is my report?");
    assert(th.waiting);

    // 10d. Free scans never fill Needs action; Mark done clears an order until the customer writes again.
    jobs.job5 = { jobId: "job5", userId: 666, adminFreeScan: true, createdAt: Date.now(), status: "API_FAILED",
      files: [{ jkSubmissionId: "trn:oid:::1:5555555555", providerStatus: "FAILED" }] };
    act = await (await req("/admin/api/overview?view=action", { headers: S })).json();
    assert(!act.jobs.some(j => j.jobId === "job5"), "free scans stay out of Needs action");
    assert.equal((await req("/admin/api/jobs/job2/done", { method: "POST", headers: J, body: "{}" })).status, 200);
    act = await (await req("/admin/api/overview?view=action", { headers: S })).json();
    assert(!act.jobs.some(j => j.jobId === "job2"), "marked done");
    await new Promise(r => setTimeout(r, 5));
    panelDeps.messages.log(333, "customer", "One more question");
    act = await (await req("/admin/api/overview?view=action", { headers: S })).json();
    assert.deepEqual(act.jobs.find(j => j.jobId === "job2").needs, ["Customer waiting for a reply"], "back when the customer writes");
    await req("/admin/api/jobs/job2/done", { method: "POST", headers: J, body: JSON.stringify({ done: false }) });
    assert.equal((await req("/admin/api/jobs/nope/done", { method: "POST", headers: J, body: "{}" })).status, 404);

    // 10e. Other services: website shop orders.
    let shop = await (await req("/admin/api/shop?view=action", { headers: S })).json();
    assert.deepEqual(shop.orders.map(o => [o.id, o.needs]), [
      ["ORD_1700000000001_1", ["Paid — not delivered yet"]],
      ["ORD_1700000000002_2", ["Customer waiting for a reply"]],
      ["ORD_1700000000999_9", ["Paid — not delivered yet"]]]);
    assert.equal(shop.counts.action, 3);
    assert.equal(shop.orders[1].messages[1].from, "customer");
    shop = await (await req("/admin/api/shop?view=all&q=quill", { headers: S })).json();
    assert.deepEqual(shop.orders.map(o => o.id), ["ORD_1700000000003_3"]);
    shop = await (await req("/admin/api/shop?view=paid", { headers: S })).json();
    assert(!shop.orders.some(o => o.id === "ORD_1700000000004_4"), "unpaid hidden from Paid");
    // Mark done
    await req("/admin/api/shop/ORD_1700000000001_1/done", { method: "POST", headers: J, body: "{}" });
    shop = await (await req("/admin/api/shop?view=action", { headers: S })).json();
    assert(!shop.orders.some(o => o.id === "ORD_1700000000001_1"));
    assert.equal((await req("/admin/api/shop/bad/done", { method: "POST", headers: J, body: "{}" })).status, 400);
    // Reply and file go through the shop service with the shared key.
    assert.equal((await req("/admin/api/shop/ORD_1700000000002_2/reply", { method: "POST", headers: J, body: JSON.stringify({ text: "Try again now" }) })).status, 200);
    assert.deepEqual(shopCalls.at(-1), ["https://shop.example.com/api/admin/orders/ORD_1700000000002_2/reply", "POST", "Bearer " + "K".repeat(20), null, "Try again now"]);
    assert.equal((await req("/admin/api/shop/ORD_1700000000002_2/file", { method: "PUT",
      headers: { ...S, "X-File-Name": encodeURIComponent("Guide.pdf") }, body: "PDF" })).status, 200);
    assert.deepEqual(shopCalls.at(-1).slice(1), ["PUT", "Bearer " + "K".repeat(20), encodeURIComponent("Guide.pdf"), 3]);
    // Shop not updated yet → clear message; address unknown → clear message.
    const old = await req("/admin/api/shop/ORD_1700000000999_9/reply", { method: "POST", headers: J, body: JSON.stringify({ text: "x" }) });
    assert.equal(old.status, 502);
    assert.match((await old.json()).error, /deploy the shop update/);
    shopUrl = null;
    const unknown = await req("/admin/api/shop/ORD_1700000000002_2/reply", { method: "POST", headers: J, body: JSON.stringify({ text: "x" }) });
    assert.equal(unknown.status, 503);
    shopUrl = "https://shop.example.com";

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

  // 12b. Paid orders never show payment buttons (those live on the Payments tab).
  const client = fs.readFileSync(path.join(__dirname, "jk-admin-panel.client.js"), "utf8");
  const ordersPart = client.slice(client.indexOf("function renderOrders"), client.indexOf("function updateDeleteBar"));
  assert(!ordersPart.includes("data-confirm") && !ordersPart.includes("data-cancel"), "no Confirm/Cancel pay on order cards");
  assert(client.slice(client.indexOf("function renderPayments")).includes("data-confirm"), "still on the Payments tab");

  // 13. Bot wiring: panel installed, uploads readable by the pipeline, free scan builds the admin job.
  const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  assert(bot.includes("adminPanel.install(app, express);"));
  assert(bot.includes("require(\"./jk-admin-panel.cjs\").isPanelFileId(fileId)"));
  assert(bot.includes("async function startAdminWebFreeScan(") && bot.includes("job.adminFreeScan = true;"));
  assert(bot.includes("retryNow") || fs.readFileSync(path.join(__dirname, "jk-provider-auto-retry.cjs"), "utf8").includes("async function retryNow("));

  console.log("PASS: /admin is off without a 12+ character password; secure headers, header + session on every call.");
  console.log("PASS: 5 wrong passwords lock an address; authenticator codes (RFC 6238); secure session cookie; logout.");
  console.log("PASS: order desk: Needs action inbox, search, customer file, conversation, reply, notes, send files + done.");
  console.log("PASS: free scans out of Needs action; Mark done until the customer writes again.");
  console.log("PASS: other services: shop orders inbox, search, Mark done, reply + file via the shop service.");
  console.log("PASS: fully deleted orders hidden (search finds them); no pay buttons on paid order cards.");
  console.log("PASS: orders, report downloads (no path tricks), retry/stop, confirm/cancel, upload + free scan, send file.");
})().catch(error => { console.error(error); process.exitCode = 1; });
