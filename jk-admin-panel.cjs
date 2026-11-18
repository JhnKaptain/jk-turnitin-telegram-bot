"use strict";
/*
  JK_ADMIN_WEB_PANEL_V1
  ---------------------
  A web version of the Telegram admin tools, served by this bot service at /admin.
  Useful when Telegram is unreachable from the admin's phone.

  - Off until ADMIN_PANEL_PASSWORD (12+ characters) is set. ADMIN_PANEL_TOTP_SECRET
    (base32) adds an authenticator-app code to the login.
  - 5 failed logins from one address lock it for 15 minutes; 30 failures in an hour
    lock every login for 15 minutes and alert the admin on Telegram.
  - Sessions: random token, HttpOnly + Secure + SameSite=Strict cookie, 12 hours,
    kept in memory (a restart logs the admin out). Every API call also needs the
    X-Admin-Panel header, so other sites cannot trigger actions.
  - Uploaded free-scan files are kept on DATA_DIR/admin-web-uploads for 14 days.
  - Every action reuses the bot's own functions (the same ones the Telegram buttons
    call), so results are identical whichever way the admin works.
*/

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FILE_PREFIX = "adminweb:";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const SESSION_MS = 12 * 60 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const PER_IP_FAILURES = 5;
const GLOBAL_FAILURES_PER_HOUR = 30;
const UPLOAD_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const ID_RE = /^[a-z0-9]{24}$/;

const idOf = file => /^trn:oid:::1:([1-9]\d{9})$/.exec(String(file?.jkSubmissionId || ""))?.[1] || null;
const firstLine = v => String(v || "").split("\n")[0].slice(0, 400);

function isPanelFileId(value) {
  return typeof value === "string" && value.startsWith(FILE_PREFIX);
}

// RFC 6238 time-based one-time code (30 s steps, 6 digits, SHA-1), +/- one step.
function base32Decode(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(text || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = "";
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error("ADMIN_PANEL_TOTP_SECRET is not valid base32.");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpAt(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}

function totpValid(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ""))) return false;
  const step = Math.floor(now / 30000);
  return [-1, 0, 1].some(d => safeEqual(totpAt(secret, step + d), String(code)));
}

function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function createAdminPanel(d) {
  const now = d.now || (() => Date.now());
  const env = d.env || process.env;
  const uploadRoot = path.join(path.resolve(d.DATA_DIR), "admin-web-uploads");
  const sessions = new Map();
  const failures = new Map();   // ip -> { count, until }
  const recentFailures = [];    // timestamps, for the global lock
  let globalLockUntil = 0;

  const password = () => String(env.ADMIN_PANEL_PASSWORD || "");
  const totpSecret = () => String(env.ADMIN_PANEL_TOTP_SECRET || "").trim();
  const configured = () => password().length >= 12;

  // --- auth -------------------------------------------------------------
  function clientIp(req) {
    return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .split(",")[0].trim();
  }

  function cookieToken(req) {
    const m = /(?:^|;\s*)jk_admin=([a-f0-9]{64})/.exec(String(req.headers.cookie || ""));
    return m ? m[1] : null;
  }

  function sessionValid(req) {
    const token = cookieToken(req);
    const exp = token && sessions.get(token);
    if (!exp) return false;
    if (exp < now()) { sessions.delete(token); return false; }
    return true;
  }

  async function login({ ip, pass, code }) {
    if (!configured()) return { ok: false, status: 404, error: "Admin panel is not configured." };
    const t = now();
    if (globalLockUntil > t) return { ok: false, status: 429, error: "Too many failed logins. Try again in 15 minutes." };
    const rec = failures.get(ip);
    if (rec && rec.until > t) return { ok: false, status: 429, error: "Too many failed logins. Try again in 15 minutes." };
    const passOk = safeEqual(pass, password());
    const codeOk = !totpSecret() || totpValid(totpSecret(), code, t);
    if (passOk && codeOk) {
      failures.delete(ip);
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, t + SESSION_MS);
      return { ok: true, token };
    }
    const expired = rec && rec.until && rec.until <= t;
    const next = { count: (expired ? 0 : rec?.count || 0) + 1, until: 0 };
    if (next.count >= PER_IP_FAILURES) next.until = t + LOCK_MS;
    failures.set(ip, next);
    recentFailures.push(t);
    while (recentFailures.length && recentFailures[0] < t - 3600000) recentFailures.shift();
    if (recentFailures.length >= GLOBAL_FAILURES_PER_HOUR && globalLockUntil <= t) {
      globalLockUntil = t + LOCK_MS;
      try {
        await d.sendAdmin?.("⚠️ Admin web panel: " + recentFailures.length +
          " failed logins in the last hour. All logins locked for 15 minutes.");
      } catch {}
    }
    return { ok: false, status: 401, error: "Wrong password or code." };
  }

  // --- data -------------------------------------------------------------
  function reportsFor(file) {
    if (!file?.providerBundleFile) return [];
    const dir = path.join(path.dirname(file.providerBundleFile), "reports");
    try {
      return fs.readdirSync(dir).filter(n => /\.pdf$/i.test(n)).sort();
    } catch { return []; }
  }

  function findFile(id) {
    for (const job of Object.values(d.getPaidJobs() || {})) {
      for (const file of job?.files || []) if (idOf(file) === id) return { job, file };
    }
    return null;
  }

  // JK_ADMIN_ORDER_DESK_V1: why an order needs the admin (empty = nothing to do).
  const CLOSED = new Set(["DELIVERED", "CLOSED", "CANCELLED", "ADMIN_CANCELLED"]);
  const ACTION_DAYS = 7;
  function actionReasons(job) {
    const status = String(job.status || "").toUpperCase();
    const reasons = [];
    const waitingSince = d.messages?.waiting(job.userId);
    if (waitingSince) reasons.push("Customer waiting for a reply");
    if (now() - Number(job.createdAt || job.paidAt || 0) > ACTION_DAYS * 86400000) return reasons;
    if (CLOSED.has(status)) return reasons;
    const live = (job.files || []).filter(f => !f.providerFilesDeletedAt);
    const waitingRetry = live.some(f => f.providerStatus === "FAILED" && f.providerRetryAt && !f.providerRetryStopped);
    if (status === "CANCEL_REQUESTED") reasons.push("Customer asked to cancel");
    if (/MANUAL/.test(status) || live.some(f => f.providerStatus === "MANUAL_REQUIRED")) reasons.push("Manual report needed");
    else if (job.route === "MANUAL" && !job.adminFreeScan) reasons.push("Manual order");
    if (!waitingRetry && (/FAILED|PARTIAL$/.test(status) || live.some(f => f.providerStatus === "FAILED"))) reasons.push("Check failed");
    const maxMin = Number(d.processingMaxMinutes?.() || 20);
    if (!job.adminFreeScan && !reasons.length && job.paidAt && now() - Number(job.paidAt) > maxMin * 60000) {
      reasons.push("Not delivered after " + maxMin + " min");
    }
    return reasons;
  }

  function overview(query = {}) {
    const view = ["action", "all", "free"].includes(query.view) ? query.view : "action";
    const q = String(query.q || "").trim().toLowerCase().slice(0, 80);
    const matches = job => !q || [job.userId, job.name, job.username, job.jobId,
      ...(job.files || []).flatMap(f => [f.file_name, idOf(f)])]
      .some(v => String(v ?? "").toLowerCase().includes(q));
    const all = Object.values(d.getPaidJobs() || {})
      .filter(j => j && Array.isArray(j.files))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const counts = { action: 0 };
    const reasonsOf = new Map(all.map(j => [j, actionReasons(j)]));
    for (const r of reasonsOf.values()) if (r.length) counts.action++;
    const jobs = all
      .filter(j => view === "all" || (view === "free" ? j.adminFreeScan : reasonsOf.get(j).length))
      .filter(matches)
      .slice(0, 60)
      .map(job => ({
        jobId: job.jobId,
        name: job.name && job.name !== "N/A" ? job.name : null,
        username: job.username && job.username !== "N/A" ? job.username : null,
        web: d.isWebUserId?.(job.userId) === true,
        paidAt: job.paidAt || null,
        deliveredAt: job.deliveredAt || null,
        needs: reasonsOf.get(job),
        userId: job.userId,
        createdAt: job.createdAt || null,
        status: job.status || null,
        adminFreeScan: job.adminFreeScan === true,
        amount: job.amount ?? null,
        files: job.files.map(f => ({
          id: idOf(f),
          name: f.file_name || f.fileName || "Document",
          type: f.type || null,
          status: f.providerStatus || null,
          error: f.providerStatus === "FAILED" ? firstLine(f.providerError) : null,
          retryAt: f.providerRetryAt || null,
          retryCount: f.providerRetryCount || 0,
          retryStopped: f.providerRetryStopped === true,
          retryExhausted: f.providerRetryExhausted === true,
          similarity: f.providerSimilarityPercent ?? null,
          ai: f.providerAiPercent ?? null,
          deleted: f.providerFilesDeletedAt || null,
          reports: f.providerFilesDeletedAt ? [] : reportsFor(f)
        }))
      }));
    const payments = Object.entries(d.getPaymentRefs() || {})
      .filter(([, r]) => r && !d.isPaymentRefClosed(r))
      .sort((a, b) => Number(b[1].createdAt || 0) - Number(a[1].createdAt || 0))
      .slice(0, 40)
      .map(([apiRef, r]) => ({
        apiRef,
        userId: r.userId,
        name: r.name || null,
        amount: r.amount ?? null,
        currency: r.currency || "KES",
        method: r.paymentMethod || null,
        status: r.status || null,
        createdAt: r.createdAt || null,
        files: Array.isArray(r.files) ? r.files.length : 0,
        proof: r.pendingProof ? {
          type: r.pendingProof.type || null,
          amount: r.pendingProof.amount ?? null,
          code: r.pendingProof.code || null,
          time: r.pendingProof.detectedTime || null,
          confidence: r.pendingProof.confidence || null,
          duplicateCode: r.pendingProof.duplicateCode === true,
          autoConfirmAt: r.pendingProof.autoConfirmAt || null
        } : null
      }));
    // Customers who wrote but have no order in this list.
    const listed = new Set(jobs.map(j => String(j.userId)));
    const waiting = view === "action" ? (d.messages?.waitingUsers() || [])
      .filter(w => !listed.has(String(w.userId)) && (!q || String(w.userId).includes(q)))
      .map(w => ({ ...w, last: (d.messages.thread(w.userId).at(-1) || {}).text || "" })) : [];
    counts.action += (d.messages?.waitingUsers() || []).filter(w => !all.some(j => String(j.userId) === String(w.userId) && reasonsOf.get(j).length)).length;
    return { view, jobs, waiting, counts, notes: d.notes || {}, payments, freeScanEnabled: d.freeScanEnabled(), now: now() };
  }

  // --- uploads ----------------------------------------------------------
  function saveUpload(name, buffer) {
    if (!d.supportedScanUpload(name)) {
      const e = new Error("Only PDF, DOCX, DOC and PPTX documents are supported."); e.status = 400; throw e;
    }
    if (!buffer.length) { const e = new Error("The file is empty."); e.status = 400; throw e; }
    if (buffer.length > MAX_UPLOAD_BYTES) { const e = new Error("The file is larger than 20 MB."); e.status = 413; throw e; }
    const id = crypto.randomBytes(12).toString("hex");
    const dir = path.join(uploadRoot, id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const safeName = path.basename(String(name)).replace(/[^\w.\- ()]/g, "_").slice(0, 160) || "document";
    fs.writeFileSync(path.join(dir, "file"), buffer, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ name: safeName, size: buffer.length, at: now() }));
    return { uploadId: id, name: safeName, size: buffer.length };
  }

  function uploadMeta(id) {
    if (!ID_RE.test(String(id))) return null;
    try { return JSON.parse(fs.readFileSync(path.join(uploadRoot, id, "meta.json"), "utf8")); } catch { return null; }
  }

  function readUpload(fileId) {
    const id = String(fileId).slice(FILE_PREFIX.length);
    if (!ID_RE.test(id)) throw new Error("Invalid admin upload id.");
    return fs.readFileSync(path.join(uploadRoot, id, "file"));
  }

  function removeUpload(fileId) {
    const id = String(fileId).slice(FILE_PREFIX.length);
    if (!ID_RE.test(id)) return false;
    fs.rmSync(path.join(uploadRoot, id), { recursive: true, force: true });
    return true;
  }

  function cleanupUploads() {
    let removed = 0;
    try {
      for (const id of fs.readdirSync(uploadRoot)) {
        const meta = uploadMeta(id);
        if (!meta || now() - Number(meta.at || 0) > UPLOAD_KEEP_MS) {
          fs.rmSync(path.join(uploadRoot, id), { recursive: true, force: true });
          removed++;
        }
      }
    } catch {}
    return removed;
  }

  // --- routes -----------------------------------------------------------
  function install(app, express) {
    const html = fs.readFileSync(path.join(__dirname, "jk-admin-panel.html"), "utf8");
    const js = fs.readFileSync(path.join(__dirname, "jk-admin-panel.client.js"), "utf8");
    const secure = (res) => {
      res.set("Cache-Control", "no-store");
      res.set("X-Frame-Options", "DENY");
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Referrer-Policy", "no-referrer");
      res.set("Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'");
    };
    const guard = (req, res, next) => {
      secure(res);
      if (!configured()) return res.status(404).json({ error: "Admin panel is not configured." });
      if (req.get("X-Admin-Panel") !== "1") return res.status(403).json({ error: "Missing panel header." });
      if (!sessionValid(req)) return res.status(401).json({ error: "Please log in." });
      next();
    };
    const handle = fn => async (req, res) => {
      try { await fn(req, res); }
      catch (error) { res.status(error.status || 500).json({ error: firstLine(error.message || error) }); }
    };

    app.get("/admin", (req, res) => {
      secure(res);
      if (!configured()) return res.status(404).type("text/plain").send("Admin panel is not configured.");
      res.type("html").send(html.replace("__TOTP__", totpSecret() ? "1" : "0"));
    });
    app.get("/admin/app.js", (req, res) => { secure(res); res.type("application/javascript").send(js); });

    app.post("/admin/api/login", express.json({ limit: "4kb" }), handle(async (req, res) => {
      secure(res);
      if (req.get("X-Admin-Panel") !== "1") return res.status(403).json({ error: "Missing panel header." });
      const r = await login({ ip: clientIp(req), pass: String(req.body?.password || ""), code: String(req.body?.code || "") });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      res.set("Set-Cookie", `jk_admin=${r.token}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`);
      res.json({ ok: true });
    }));
    app.post("/admin/api/logout", guard, (req, res) => {
      sessions.delete(cookieToken(req));
      res.set("Set-Cookie", "jk_admin=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
      res.json({ ok: true });
    });

    app.get("/admin/api/overview", guard, handle(async (req, res) => res.json(overview(req.query || {}))));

    // JK_ADMIN_ORDER_DESK_V1: the Telegram order buttons, on the web.
    const UID_RE = /^[1-9]\d{0,16}$/;
    const uidOf = req => {
      const uid = String(req.params.uid || "");
      if (!UID_RE.test(uid)) { const e = new Error("Invalid customer ID."); e.status = 400; throw e; }
      return uid;
    };
    const header = (req, name, max) => {
      try { return decodeURIComponent(String(req.get(name) || "")).slice(0, max); }
      catch { return ""; }
    };

    app.get("/admin/api/files/:id/original", guard, handle(async (req, res) => {
      const found = findFile(String(req.params.id));
      if (!found) return res.status(404).json({ error: "File not found." });
      if (found.file.providerFilesDeletedAt) return res.status(410).json({ error: "This file was deleted." });
      const { buffer, name } = await d.customerOriginal(found.file);
      res.set("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(name));
      res.type("application/octet-stream").send(buffer);
    }));

    app.get("/admin/api/users/:uid/thread", guard, handle(async (req, res) => {
      const uid = uidOf(req);
      res.json({ userId: uid, messages: d.messages?.thread(uid) || [], waiting: d.messages?.waiting(uid) || null });
    }));

    app.post("/admin/api/users/:uid/reply", guard, express.json({ limit: "16kb" }), handle(async (req, res) => {
      const uid = uidOf(req);
      const text = String(req.body?.text || "").trim().slice(0, 3500);
      if (!text) return res.status(400).json({ error: "Write a message first." });
      await d.replyToUser(uid, text);
      res.json({ ok: true });
    }));

    app.post("/admin/api/users/:uid/note", guard, express.json({ limit: "4kb" }), handle(async (req, res) => {
      const uid = uidOf(req);
      const kind = String(req.body?.kind || "");
      if (!Object.prototype.hasOwnProperty.call(d.notes || {}, kind)) return res.status(400).json({ error: "Unknown note." });
      res.json({ ok: true, label: await d.sendNote(uid, kind) });
    }));

    // Send files one per request (like uploading in a /filebatch), then "done".
    app.put("/admin/api/users/:uid/deliver", guard,
      express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES + 1024 }),
      handle(async (req, res) => {
        const uid = uidOf(req);
        const name = path.basename(header(req, "X-File-Name", 160)).replace(/[\r\n"\\/]/g, "_");
        const caption = header(req, "X-Caption", 1000);
        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (!name) return res.status(400).json({ error: "File name missing." });
        if (!buffer.length) return res.status(400).json({ error: "The file is empty." });
        await d.sendFileToUser(uid, { buffer, name }, caption);
        res.json({ ok: true });
      }));

    app.post("/admin/api/users/:uid/deliver/done", guard, express.json({ limit: "4kb" }), handle(async (req, res) => {
      const uid = uidOf(req);
      const count = Math.max(0, Math.min(50, Number(req.body?.count) || 0));
      const job = await d.finishDelivery(uid, count);
      res.json({ ok: true, delivered: job ? job.jobId : null });
    }));

    app.post("/admin/api/files/:id/retry", guard, handle(async (req, res) => {
      const r = await d.autoRetry().retryNow(String(req.params.id));
      res.status(r.ok ? 200 : 409).json(r);
    }));
    app.post("/admin/api/files/:id/stop", guard, handle(async (req, res) => {
      const r = await d.autoRetry().stop(String(req.params.id));
      res.status(r.stopped ? 200 : 404).json(r);
    }));
    // JK_DELETE_FILES_NOW_V1: delete the stored copies of selected files.
    app.post("/admin/api/files/delete", guard, express.json({ limit: "16kb" }), handle(async (req, res) => {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      if (!ids.length || ids.length > 200 || ids.some(id => !/^[1-9]\d{9}$/.test(id))) {
        return res.status(400).json({ error: "Choose 1 to 200 files." });
      }
      if (typeof d.deleteFiles !== "function") return res.status(501).json({ error: "Deleting is not available." });
      res.json(await d.deleteFiles(ids, "admin-web-panel"));
    }));

    app.get("/admin/api/files/:id/reports/:name", guard, handle(async (req, res) => {
      const found = findFile(String(req.params.id));
      const name = String(req.params.name);
      if (!found || !reportsFor(found.file).includes(name)) return res.status(404).json({ error: "Report not found." });
      const file = path.join(path.dirname(found.file.providerBundleFile), "reports", name);
      res.set("Content-Disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
      res.type("application/pdf").send(fs.readFileSync(file));
    }));

    app.post("/admin/api/payments/:userId/confirm", guard, handle(async (req, res) => {
      res.json(await d.confirmPayment(String(req.params.userId), "admin-web-panel"));
    }));
    app.post("/admin/api/payments/:userId/cancel", guard, handle(async (req, res) => {
      res.json(await d.cancelPayment(String(req.params.userId), "admin-web-panel"));
    }));

    app.put("/admin/api/uploads", guard,
      express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES + 1024 }),
      handle(async (req, res) => {
        const name = decodeURIComponent(String(req.get("X-File-Name") || ""));
        res.json(saveUpload(name, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)));
      }));
    app.post("/admin/api/free-scan", guard, express.json({ limit: "16kb" }), handle(async (req, res) => {
      if (!d.freeScanEnabled()) return res.status(409).json({ error: "Admin Free Scan is disabled." });
      const ids = Array.isArray(req.body?.uploads) ? req.body.uploads.map(String) : [];
      if (!ids.length || ids.length > d.MAX_BATCH_FILES) {
        return res.status(400).json({ error: `Add between 1 and ${d.MAX_BATCH_FILES} files.` });
      }
      if (new Set(ids).size !== ids.length) return res.status(400).json({ error: "Duplicate files in the batch." });
      const uploads = ids.map(id => ({ id, meta: uploadMeta(id) }));
      if (uploads.some(u => !u.meta)) return res.status(400).json({ error: "An uploaded file has expired. Upload it again." });
      const service = String(req.body?.service || "CHECK").toUpperCase();
      if (!["CHECK", "SIMILARITY", "AI_ONLY"].includes(service)) return res.status(400).json({ error: "Unknown service." });
      const result = await d.startFreeScan({
        uploads: uploads.map(u => ({ fileId: FILE_PREFIX + u.id, name: u.meta.name, size: u.meta.size })),
        type: service === "SIMILARITY" ? "SIMILARITY" : "CHECK",
        adminAiOnly: service === "AI_ONLY",
        similarityOptions: {
          excludeBibliography: req.body?.excludeBibliography !== false,
          excludeQuotes: req.body?.excludeQuotes === true
        }
      });
      res.json({ ok: true, ...result });
    }));

    app.put("/admin/api/send", guard,
      express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES + 1024 }),
      handle(async (req, res) => {
        const to = String(req.get("X-To-User") || "").trim();
        const name = decodeURIComponent(String(req.get("X-File-Name") || "")).replace(/[\r\n"]/g, "").slice(0, 160);
        const caption = decodeURIComponent(String(req.get("X-Caption") || "")).slice(0, 1000);
        if (!/^[1-9]\d{4,16}$/.test(to)) return res.status(400).json({ error: "Enter the customer's user ID (numbers only)." });
        if (!name) return res.status(400).json({ error: "File name missing." });
        const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (!buf.length) return res.status(400).json({ error: "The file is empty." });
        if (d.sendFileToUser) await d.sendFileToUser(to, { buffer: buf, name }, caption);
        else await d.bot.telegram.sendDocument(to, { source: buf, filename: name }, caption ? { caption } : {});
        res.json({ ok: true });
      }));

    cleanupUploads();
    const t = setInterval(cleanupUploads, 24 * 60 * 60 * 1000);
    t.unref?.();
  }

  return { install, login, sessionValid, overview, saveUpload, readUpload, removeUpload, uploadMeta, cleanupUploads, configured };
}

module.exports = { createAdminPanel, isPanelFileId, totpAt, totpValid, base32Decode, FILE_PREFIX };
