"use strict";
/*
  JK_TILL_AUTO_CONFIRM_V1
  -----------------------
  An M-Pesa till payment proof (pasted message) is confirmed automatically when
  the admin has neither confirmed nor cancelled it within 4 minutes, and every
  check passes:

    - High confidence: amount matches, code found, recipient matches,
      "paid to" message, code never used before;
    - the payment time includes a date and is after the last file was sent
      (1 minute tolerance: M-Pesa times have minute precision);
    - the payment was made at most 30 minutes before the proof arrived;
    - amount at most TILL_AUTO_CONFIRM_MAX_KES (default 1,000);
    - at most one automatic confirmation per customer per 24 hours.

  Screenshots are never auto-confirmed. The confirmation uses the admin's own
  confirm path. Pending auto-confirmations survive a bot restart.
  TILL_AUTO_CONFIRM=0 switches it off.

  The bot only sees the pasted message, never the till itself: a well-made fake
  message can pass these checks. The 4-minute window and the limits above are
  the safeguards; verifying against real payment data (Daraja) removes the risk.
*/

const WAIT_MS = 4 * 60 * 1000;
const TOLERANCE_MS = 60 * 1000;
const MAX_AGE_MS = 30 * 60 * 1000;
const PER_USER_WINDOW_MS = 24 * 60 * 60 * 1000;
const EAT_OFFSET_HOURS = 3; // Kenya, no daylight saving

// "14/11/26 2:31 AM", "14/11/2026 14:31", "14-11-26 2:31 PM" (day/month/year, Kenya time).
// Returns epoch ms, or null when there is no date or the value is invalid.
function parseMpesaTime(value) {
  const m = /^\s*([0-3]?\d)[\/.-]([01]?\d)[\/.-](\d{2}|\d{4})\s+([0-2]?\d):([0-5]\d)\s*(AM|PM)?\s*$/i.exec(String(value || ""));
  if (!m) return null;
  let [, d, mo, y, h, mi, ap] = m;
  let year = Number(y.length === 2 ? "20" + y : y);
  let hour = Number(h);
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (/pm/i.test(ap) ? 12 : 0);
  } else if (hour > 23) return null;
  const day = Number(d), month = Number(mo);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day, hour - EAT_OFFSET_HOURS, Number(mi));
  const back = new Date(ms + EAT_OFFSET_HOURS * 3600 * 1000);
  return back.getUTCDate() === day && back.getUTCMonth() === month - 1 ? ms : null;
}

// Time check used for every till proof (auto-confirm or not).
function timeWarnings(proof) {
  const paidAt = parseMpesaTime(proof?.detectedTime);
  if (paidAt === null) return ["Payment date and time not detected"];
  const warnings = [];
  if (Number.isFinite(proof.filesSentAt) && paidAt < proof.filesSentAt - TOLERANCE_MS) {
    warnings.push("Payment time is BEFORE the file was sent");
  }
  if (Number.isFinite(proof.receivedAt)) {
    if (paidAt > proof.receivedAt + 2 * TOLERANCE_MS) warnings.push("Payment time is in the future");
    if (paidAt < proof.receivedAt - MAX_AGE_MS) warnings.push("Payment is more than 30 minutes older than the proof");
  }
  return warnings;
}

function maxAmount(env = process.env) {
  const n = Number(env.TILL_AUTO_CONFIRM_MAX_KES);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

// Why a proof can or cannot be auto-confirmed.
function eligibility(ref, { now, recentAutoConfirms = [], env = process.env }) {
  const p = ref?.pendingProof || {};
  const reasons = [];
  if (String(env.TILL_AUTO_CONFIRM || "1").trim() === "0") reasons.push("auto-confirm switched off");
  if (p.type !== "mpesa-text") reasons.push("not a pasted M-Pesa message");
  if (p.confidence !== "High") reasons.push("confidence is not High");
  if (!p.amountMatch) reasons.push("amount does not match");
  if (!p.recipientMatch) reasons.push("recipient not matched");
  if (!p.code) reasons.push("no transaction code");
  if (p.duplicateCode) reasons.push("code already used");
  if (!Number.isFinite(p.filesSentAt)) reasons.push("time the file was sent is unknown");
  reasons.push(...timeWarnings(p));
  if (!(Number(ref?.amount) > 0) || Number(ref.amount) > maxAmount(env)) reasons.push(`amount above KES ${maxAmount(env)}`);
  if (recentAutoConfirms.some(t => now - t < PER_USER_WINDOW_MS)) reasons.push("customer already auto-confirmed in the last 24 hours");
  return { ok: reasons.length === 0, reasons };
}

function createTillAutoConfirm({
  getRefs,
  save,
  confirm,          // async (userId, apiRef) => { ok, message }
  isClosed,         // ref => boolean (confirmed or cancelled)
  sendAdmin = async () => {},
  now = () => Date.now(),
  setTimer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  env = process.env
}) {
  const timers = new Map();

  function recentFor(userId) {
    return Object.values(getRefs() || {})
      .filter(r => String(r?.userId) === String(userId) && Number.isFinite(r?.tillAutoConfirmedAt))
      .map(r => r.tillAutoConfirmedAt);
  }

  // Called when a till proof arrives. Returns the admin line describing what will happen.
  function onProof(apiRef) {
    const ref = getRefs()[apiRef];
    if (!ref?.pendingProof) return null;
    const check = eligibility(ref, { now: now(), recentAutoConfirms: recentFor(ref.userId), env });
    if (!check.ok) {
      ref.pendingProof.autoConfirmAt = null;
      save();
      return "Auto-confirm: NO (" + check.reasons.join("; ") + ")";
    }
    ref.pendingProof.autoConfirmAt = now() + WAIT_MS;
    save();
    schedule(apiRef, ref.pendingProof.autoConfirmAt);
    return "Auto-confirm: YES in 4 min unless you Confirm or Cancel first";
  }

  function schedule(apiRef, at) {
    clearTimeout(timers.get(apiRef));
    timers.set(apiRef, setTimer(() => {
      timers.delete(apiRef);
      fire(apiRef).catch(error => console.error("Till auto-confirm failed:", error?.message || error));
    }, Math.max(0, at - now())));
  }

  async function fire(apiRef) {
    const ref = getRefs()[apiRef];
    const proof = ref?.pendingProof;
    if (!ref || !proof?.autoConfirmAt || isClosed(ref)) return { done: false, reason: "handled-or-missing" };
    if (now() < proof.autoConfirmAt) { schedule(apiRef, proof.autoConfirmAt); return { done: false, reason: "not-yet" }; }
    // Re-check at confirmation time: the code may have been used meanwhile.
    const check = eligibility(ref, { now: now(), recentAutoConfirms: recentFor(ref.userId), env });
    proof.autoConfirmAt = null;
    if (!check.ok) {
      save();
      await sendAdmin(`⏸ Auto-confirm skipped for user ${ref.userId}: ${check.reasons.join("; ")}. Please review.`);
      return { done: false, reason: "no-longer-eligible" };
    }
    const result = await confirm(ref.userId, apiRef);
    if (result?.ok) {
      ref.tillAutoConfirmedAt = now();
      save();
      await sendAdmin(
        `🤖 Till payment AUTO-CONFIRMED (no admin action in 4 min)\nUser: ${ref.userId}\n` +
        `Amount: ${proof.amount} KES\nCode: ${proof.code}\nPaid: ${proof.detectedTime}`
      );
      return { done: true };
    }
    save();
    await sendAdmin(`⏸ Auto-confirm did not complete for user ${ref.userId}: ${result?.message || "unknown"}`);
    return { done: false, reason: "confirm-refused" };
  }

  // Re-arms pending auto-confirmations after a restart.
  function resume() {
    for (const [apiRef, ref] of Object.entries(getRefs() || {})) {
      const at = ref?.pendingProof?.autoConfirmAt;
      if (Number.isFinite(at) && !isClosed(ref)) schedule(apiRef, at);
    }
  }

  return { onProof, fire, resume, schedule };
}

module.exports = { parseMpesaTime, timeWarnings, eligibility, createTillAutoConfirm, WAIT_MS };
