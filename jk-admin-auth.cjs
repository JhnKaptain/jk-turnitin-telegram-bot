"use strict";
/*
  JK_ADMIN_EMAIL_LOGIN_V1: admin panel sign-in with email + password, password
  change in the panel, and "Forgot password?" with a code sent by email.

  - ADMIN_PANEL_EMAIL (Render): the admin's email. When set, sign-in needs it.
  - The password starts as ADMIN_PANEL_PASSWORD (Render). Changing it in the
    panel stores a scrypt hash on the disk (DATA_DIR/admin-panel-auth.json);
    the plain password is never stored.
  - Render is the master reset: when ADMIN_PANEL_PASSWORD on Render is changed,
    it replaces any password set in the panel.
  - Reset codes: 6 digits, emailed, valid 10 minutes, single use, 5 tries, at
    most one every 2 minutes and 5 per day. The forgot form answers the same
    way whatever email is typed, so it can't be used to find the admin email.
*/
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MIN_LENGTH = 12;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_GAP_MS = 2 * 60 * 1000;
const CODES_PER_DAY = 5;
const CODE_TRIES = 5;

const sha256 = v => crypto.createHash("sha256").update(String(v)).digest("hex");
function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
const normEmail = v => String(v || "").trim().toLowerCase();

function createAdminAuth({ dataDir, env = process.env, now = () => Date.now(), sendEmail = null }) {
  const file = path.join(path.resolve(dataDir), "admin-panel-auth.json");
  const envPassword = () => String(env.ADMIN_PANEL_PASSWORD || "");
  const envFingerprint = () => sha256("jk-admin-panel:" + envPassword());
  const adminEmail = () => normEmail(env.ADMIN_PANEL_EMAIL);
  let reset = null;          // { codeHash, expires, tries }
  const sent = [];           // times codes were sent (rate limit)

  function read() {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  }
  // The stored panel password, unless Render's password changed since (master reset).
  function stored() {
    const s = read();
    if (!s?.hash) return null;
    if (s.envFingerprint !== envFingerprint()) {
      try { fs.rmSync(file, { force: true }); } catch {}
      return null;
    }
    return s;
  }
  const configured = () => Boolean(stored()) || envPassword().length >= MIN_LENGTH;
  const emailRequired = () => Boolean(adminEmail());

  function checkPassword(pass) {
    const s = stored();
    if (s) {
      const hash = crypto.scryptSync(String(pass), Buffer.from(s.salt, "hex"), 64);
      return crypto.timingSafeEqual(hash, Buffer.from(s.hash, "hex"));
    }
    return envPassword().length >= MIN_LENGTH && safeEqual(pass, envPassword());
  }
  function checkEmail(email) {
    return !emailRequired() || safeEqual(normEmail(email), adminEmail());
  }

  function validNew(pass) {
    const p = String(pass || "");
    if (p.length < MIN_LENGTH) return "Use at least " + MIN_LENGTH + " characters.";
    if (p.length > 200) return "That password is too long.";
    if (emailRequired() && normEmail(p).includes(adminEmail().split("@")[0])) return "Don't use your email in the password.";
    if (/^(.)\1+$/.test(p)) return "Choose a less predictable password.";
    return null;
  }
  function setPassword(pass) {
    const problem = validNew(pass);
    if (problem) { const e = new Error(problem); e.status = 400; throw e; }
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(pass), salt, 64);
    const tmp = file + ".tmp";
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ hash: hash.toString("hex"), salt: salt.toString("hex"),
      envFingerprint: envFingerprint(), changedAt: now() }), { mode: 0o600 });
    fs.renameSync(tmp, file);
    reset = null;
  }

  const emailReady = () => emailRequired() && typeof sendEmail === "function";

  // Always answers { ok: true } (no hint whether the email matched), except when
  // email reset isn't set up at all.
  async function requestReset(email) {
    if (!emailReady()) {
      const e = new Error("Email reset isn't set up. Change ADMIN_PANEL_PASSWORD on Render instead."); e.status = 503; throw e;
    }
    if (!safeEqual(normEmail(email), adminEmail())) return { ok: true };
    const t = now();
    while (sent.length && sent[0] < t - 86400000) sent.shift();
    if ((sent.length && t - sent[sent.length - 1] < CODE_GAP_MS) || sent.length >= CODES_PER_DAY) return { ok: true };
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
    reset = { codeHash: sha256("jk-reset:" + code), expires: t + CODE_TTL_MS, tries: 0 };
    sent.push(t);
    await sendEmail({
      to: adminEmail(),
      subject: "JK Admin password reset code: " + code,
      text: "Your JK Admin panel password reset code is: " + code + "\n\n" +
        "It works once and expires in 10 minutes.\n\n" +
        "If you didn't ask for this, ignore this email: your password stays the same."
    });
    return { ok: true };
  }

  function completeReset(email, code, newPass) {
    const fail = msg => { const e = new Error(msg || "That code is wrong or has expired. Ask for a new one."); e.status = 400; return e; };
    if (!reset || !checkEmail(email) || !emailRequired()) throw fail();
    if (now() > reset.expires || reset.tries >= CODE_TRIES) { reset = null; throw fail(); }
    reset.tries++;
    if (!/^\d{6}$/.test(String(code || "")) || !safeEqual(sha256("jk-reset:" + code), reset.codeHash)) {
      if (reset.tries >= CODE_TRIES) reset = null;
      throw fail();
    }
    const problem = validNew(newPass);
    if (problem) { reset.tries--; throw fail(problem); }
    setPassword(newPass);
  }

  return { configured, emailRequired, emailReady, checkPassword, checkEmail, setPassword, requestReset, completeReset, validNew,
    usingPanelPassword: () => Boolean(stored()) };
}

// Email through SMTP (e.g. Gmail with an app password). Off without SMTP_USER/SMTP_PASS.
function createMailer({ env = process.env, nodemailer = null } = {}) {
  const user = String(env.SMTP_USER || "").trim();
  const pass = String(env.SMTP_PASS || "").replace(/\s+/g, "");
  if (!user || !pass) return null;
  const port = Number(env.SMTP_PORT || 465);
  const transport = (nodemailer || require("nodemailer")).createTransport({
    host: String(env.SMTP_HOST || "smtp.gmail.com").trim(), port, secure: port === 465,
    auth: { user, pass }, connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000
  });
  const from = String(env.SMTP_FROM || "").trim() || "JK Admin <" + user + ">";
  return ({ to, subject, text }) => transport.sendMail({ from, to, subject, text });
}

module.exports = { createAdminAuth, createMailer, MIN_LENGTH };
