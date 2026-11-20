"use strict";
// JK_ADMIN_EMAIL_LOGIN_V1: email + password sign-in, change password, reset by
// emailed code, Render as the master reset. Local server, fake email; offline.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createAdminPanel, totpAt } = require("./jk-admin-panel.cjs");
const { createAdminAuth, createMailer } = require("./jk-admin-auth.cjs");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jk-admin-email-"));
  const mail = [];
  const admin = [];
  const env = { ADMIN_PANEL_PASSWORD: "render password one", ADMIN_PANEL_EMAIL: "Owner@Example.com" };
  const panel = createAdminPanel({
    DATA_DIR: dir, MAX_BATCH_FILES: 10, env, bot: {},
    getPaidJobs: () => ({}), getPaymentRefs: () => ({}), isPaymentRefClosed: () => true, autoRetry: () => ({}),
    supportedScanUpload: () => true, freeScanEnabled: () => true, isWebUserId: () => false,
    sendAdmin: async t => admin.push(t),
    sendEmail: async m => { mail.push(m); }
  });
  const app = express();
  panel.install(app, express);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = "http://127.0.0.1:" + server.address().port;
  let ipN = 0;
  const post = (p, body, extra = {}) => fetch(base + p, { method: "POST",
    headers: { "X-Admin-Panel": "1", "Content-Type": "application/json", "X-Forwarded-For": "10.0.0." + (++ipN), ...extra }, body: JSON.stringify(body) });
  const login = (email, password, code) => post("/admin/api/login", { email, password, code });
  const codeFrom = m => /code is: (\d{6})/.exec(m.text)[1];

  try {
    // 1. The login page asks for the email; reset is offered.
    const page = await (await fetch(base + "/admin")).text();
    assert.match(page, /data-email="1"/);
    assert.match(page, /data-reset="1"/);

    // 2. Email + password (email not case-sensitive); a wrong email fails.
    assert.equal((await login("owner@example.com", "render password one")).status, 200);
    assert.equal((await login(" OWNER@example.com ", "render password one")).status, 200);
    const bad = await login("someone@example.com", "render password one");
    assert.equal(bad.status, 401);
    assert.match((await bad.json()).error, /Wrong email, password or code/);
    assert.equal((await login("", "render password one")).status, 401, "email required");

    // 3. Change password while signed in: other devices signed out, alerts sent.
    const c1 = (await login("owner@example.com", "render password one")).headers.get("set-cookie").split(";")[0];
    const c2 = (await login("owner@example.com", "render password one")).headers.get("set-cookie").split(";")[0];
    const S1 = { Cookie: c1 };
    assert.equal((await post("/admin/api/password/change", { current: "nope", password: "a brand new password" }, S1)).status, 400);
    assert.equal((await post("/admin/api/password/change", { current: "render password one", password: "short" }, S1)).status, 400);
    assert.equal((await post("/admin/api/password/change", { current: "render password one", password: "the new panel password 1" }, S1)).status, 200);
    assert.equal((await fetch(base + "/admin/api/overview", { headers: { "X-Admin-Panel": "1", Cookie: c2 } })).status, 401, "other device signed out");
    assert.notEqual((await fetch(base + "/admin/api/overview", { headers: { "X-Admin-Panel": "1", Cookie: c1 } })).status, 401, "this device stays in");
    assert(admin.some(t => /password changed/.test(t)));
    assert(mail.some(m => /password changed/.test(m.subject)));
    assert.equal((await login("owner@example.com", "render password one")).status, 401, "old password no longer works");
    assert.equal((await login("owner@example.com", "the new panel password 1")).status, 200);
    const stored = fs.readFileSync(path.join(dir, "admin-panel-auth.json"), "utf8");
    assert(!stored.includes("the new panel password 1"), "only a hash is stored");

    // 4. Forgot password: same answer for any email; code only to the admin email.
    mail.length = 0;
    let r = await post("/admin/api/password/forgot", { email: "stranger@example.com" });
    assert.equal(r.status, 200);
    const generic = (await r.json()).message;
    assert.equal(mail.length, 0, "no email to strangers");
    r = await post("/admin/api/password/forgot", { email: "owner@example.com" });
    assert.equal((await r.json()).message, generic, "no hint whether the email matched");
    assert.equal(mail.length, 1);
    assert.equal(mail[0].to, "owner@example.com");
    const code = codeFrom(mail[0]);
    // Another request within 2 minutes sends nothing (rate limit).
    await post("/admin/api/password/forgot", { email: "owner@example.com" });
    assert.equal(mail.length, 1);

    // Wrong code, wrong email, weak password: refused; then the right one works.
    const wrong = String((Number(code) + 1) % 1e6).padStart(6, "0");
    assert.equal((await post("/admin/api/password/reset", { email: "owner@example.com", code: wrong, password: "reset password number 1" })).status, 400);
    assert.equal((await post("/admin/api/password/reset", { email: "x@example.com", code, password: "reset password number 1" })).status, 400);
    assert.equal((await post("/admin/api/password/reset", { email: "owner@example.com", code, password: "weak" })).status, 400);
    const ok = await post("/admin/api/password/reset", { email: "owner@example.com", code, password: "reset password number 1" });
    assert.equal(ok.status, 200);
    assert.equal((await fetch(base + "/admin/api/overview", { headers: { "X-Admin-Panel": "1", Cookie: c1 } })).status, 401, "every device signed out");
    assert.equal((await login("owner@example.com", "reset password number 1")).status, 200);
    assert(admin.some(t => /reset with an email code/.test(t)));
    // The code works once.
    assert.equal((await post("/admin/api/password/reset", { email: "owner@example.com", code, password: "another password 12345" })).status, 400);

    // 5. Render is the master reset: changing ADMIN_PANEL_PASSWORD replaces the panel password.
    env.ADMIN_PANEL_PASSWORD = "render password two";
    assert.equal((await login("owner@example.com", "reset password number 1")).status, 401);
    assert.equal((await login("owner@example.com", "render password two")).status, 200);
    assert(!fs.existsSync(path.join(dir, "admin-panel-auth.json")));

    // 6. Authenticator set up: change and reset need its code too.
    const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    env.ADMIN_PANEL_TOTP_SECRET = SECRET;
    const totp = () => totpAt(SECRET, Math.floor(Date.now() / 30000));
    const c3 = (await login("owner@example.com", "render password two", totp())).headers.get("set-cookie").split(";")[0];
    assert.equal((await post("/admin/api/password/change", { current: "render password two", password: "needs the code 1234", code: "000000" }, { Cookie: c3 })).status, 400);
    assert.equal((await post("/admin/api/password/change", { current: "render password two", password: "needs the code 1234", code: totp() }, { Cookie: c3 })).status, 200);
    delete env.ADMIN_PANEL_TOTP_SECRET;

    // 7. Without ADMIN_PANEL_EMAIL: password-only sign-in as before; no email reset.
    const noEmail = createAdminAuth({ dataDir: path.join(dir, "x"), env: { ADMIN_PANEL_PASSWORD: "only a password here" } });
    assert.equal(noEmail.emailRequired(), false);
    assert.equal(noEmail.checkEmail(""), true);
    assert.equal(noEmail.checkPassword("only a password here"), true);
    await assert.rejects(noEmail.requestReset("a@b.c"), /Change ADMIN_PANEL_PASSWORD on Render/);

    // 8. Codes: 5 wrong tries cancel the code; at most 5 codes a day.
    let t = 1_000_000;
    const sentCodes = [];
    const a = createAdminAuth({ dataDir: path.join(dir, "y"), now: () => t,
      env: { ADMIN_PANEL_PASSWORD: "render password abc", ADMIN_PANEL_EMAIL: "o@e.com" }, sendEmail: async m => sentCodes.push(codeFrom(m)) });
    await a.requestReset("o@e.com");
    for (let i = 0; i < 5; i++) assert.throws(() => a.completeReset("o@e.com", "000000" === sentCodes[0] ? "111111" : "000000", "valid new password 1"));
    assert.throws(() => a.completeReset("o@e.com", sentCodes[0], "valid new password 1"), /wrong or has expired/, "cancelled after 5 tries");
    for (let i = 0; i < 6; i++) { t += 3 * 60000; await a.requestReset("o@e.com"); }
    assert.equal(sentCodes.length, 5, "5 codes a day");
    t += 11 * 60000;
    assert.throws(() => a.completeReset("o@e.com", sentCodes.at(-1), "valid new password 1"), /expired/, "10 minutes");

    // 9. Email sending: off without SMTP settings; Gmail by default.
    assert.equal(createMailer({ env: {} }), null);
    let opts = null;
    const send = createMailer({ env: { SMTP_USER: "me@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" },
      nodemailer: { createTransport: o => { opts = o; return { sendMail: async m => m }; } } });
    assert.deepEqual([opts.host, opts.port, opts.secure, opts.auth.pass], ["smtp.gmail.com", 465, true, "abcdefghijklmnop"]);
    assert.equal((await send({ to: "x@y.z", subject: "s", text: "t" })).from, "JK Admin <me@gmail.com>");

    // 10. Wiring.
    const bot = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
    assert(bot.includes('const adminMailer = require("./jk-admin-auth.cjs").createMailer();') && bot.includes("sendEmail: adminMailer,"));
    assert(JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).dependencies.nodemailer);

    console.log("PASS: email + password sign-in; change password signs other devices out; only a hash is stored.");
    console.log("PASS: email reset code: same answer for any email, once, 10 minutes, 5 tries, 5 a day; everyone signed out after.");
    console.log("PASS: Render's ADMIN_PANEL_PASSWORD is the master reset; authenticator required when set; password-only without an email.");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
