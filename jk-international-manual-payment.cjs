"use strict";

// International payments are manual, not a payment gateway. Receipt text
// never proves funds arrived: only the admin can verify actual account credit.
const METHOD_MPESA = "INTL_MPESA";
const METHOD_BINANCE = "BINANCE_USDT";
const SUPPORTED_METHODS = Object.freeze([METHOD_MPESA, METHOD_BINANCE]);

function isWorldwideManualMethod(value) {
  return SUPPORTED_METHODS.includes(String(value || ""));
}

function normalizeTransactionId(value) {
  const clean = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length >= 8 && clean.length <= 64 && /\d/.test(clean) ? clean : "";
}

function extractTransactionId(text) {
  const source = String(text || "").slice(0, 2000);
  const explicit = [
    /\b(?:transaction|transfer|payment|order)\s*(?:id|number|no\.?|ref(?:erence)?|code)\s*[:#=\- ]+\s*([A-Z0-9][A-Z0-9-]{7,63})\b/iu,
    /\b(?:M[- ]?PESA)\s*(?:transaction\s*)?(?:code|ref(?:erence)?)\s*[:#=\- ]+\s*([A-Z0-9][A-Z0-9-]{7,63})\b/iu
  ];
  for (const pattern of explicit) {
    const match = source.match(pattern);
    const code = normalizeTransactionId(match?.[1]);
    if (code) return code;
  }
  if (/^[A-Z0-9-]{8,64}$/iu.test(source.trim())) {
    return normalizeTransactionId(source.trim());
  }
  return "";
}

function quoteForMethod(method, amountKES, amountUSD) {
  if (!isWorldwideManualMethod(method)) throw new Error("Unsupported international payment method.");
  const amount = Number(method === METHOD_BINANCE ? amountUSD : amountKES);
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100 && Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001)
    throw new Error("Invalid international payment amount.");
  return {
    amount: Number(amount.toFixed(2)),
    currency: method === METHOD_BINANCE ? "USDT" : "KES"
  };
}

// Merchant-configured fixed quote rate, not a live FX feed. Round up to avoid
// charging less than the underlying KES price.
function kesToUsdt(amountKES, kesPerUsdt) {
  const amount = Number(amountKES);
  const rate = Number(kesPerUsdt);
  if (!Number.isFinite(amount) || amount <= 0 ||
      !Number.isFinite(rate) || rate < 50 || rate > 500)
    throw new Error("Invalid KES price or KES-per-USDT quote rate.");
  return Math.ceil((amount / rate) * 100 - 1e-9) / 100;
}

// A shorter customer-facing label; the full apiRef stays in the payment store.
function noteReference(apiRef) {
  const raw = String(apiRef || "");
  if (!/^JKPAY[0-9]{16,45}$/.test(raw)) throw new Error("Invalid JK payment reference.");
  return "JK" + raw.slice(-14);
}

function paymentInstructions({ method, amount, currency, reference, paymentNoteRef, mpesaNumber, binanceId, binanceName }) {
  if (!isWorldwideManualMethod(method)) throw new Error("Unsupported payment method");
  const note = paymentNoteRef || reference;
  const money = Number(amount).toFixed(2) + " " + currency;
  if (method === METHOD_MPESA) {
    return [
      "🌍 *International M-Pesa*",
      "Pay: *" + money + "*",
      "Send to: \`" + mpesaNumber + "\`",
      "JK note (if supported): \`" + note + "\`",
      "",
      "Use a remittance service that sends to Kenyan M-Pesa.",
      "Send the transfer reference here after paying.",
      "Admin verifies payment before processing."
    ].join("\n");
  }
  return [
    "🟡 *Binance Pay — USDT*",
    "Pay: *" + money + "*",
    "Binance Pay ID: \`" + binanceId + "\`",
    "Recipient: *" + binanceName + "*",
    "Note to Payee: \`" + note + "\`",
    "",
    "After paying, copy the *Binance Order ID* from Payment Details and send it here.",
    "Admin verifies the payment before processing."
  ].join("\n");
}

function manualApprovalBlock(ref, isUsed) {
  if (!isWorldwideManualMethod(ref?.paymentMethod)) return "";
  const code = normalizeTransactionId(ref?.pendingProof?.code);
  if (!code) return "Transaction ID required. Ask the customer to send a valid payment transaction ID.";
  if (typeof isUsed === "function" && isUsed(code))
    return "Transaction ID has already been used for a completed payment. Do not approve.";
  return "";
}

module.exports = {
  METHOD_MPESA, METHOD_BINANCE, SUPPORTED_METHODS,
  isWorldwideManualMethod, normalizeTransactionId, extractTransactionId,
  quoteForMethod, kesToUsdt, noteReference, paymentInstructions, manualApprovalBlock
};
