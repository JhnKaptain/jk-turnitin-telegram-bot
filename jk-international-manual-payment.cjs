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

function paymentInstructions({ method, amount, currency, reference, mpesaNumber, binanceId, binanceName }) {
  if (!isWorldwideManualMethod(method)) throw new Error("Unsupported payment method");
  const money = Number(amount).toFixed(2) + " " + currency;
  const main = [
    "🌍 *INTERNATIONAL PAYMENT*",
    "",
    "Amount to receive: *" + money + "*",
    "Order reference: *" + reference + "*",
    ""
  ];
  if (method === METHOD_MPESA) {
    main.push(
      "*Option: M-Pesa transfer to Kenya*",
      "Destination M-Pesa: *" + mpesaNumber + "*",
      "Choose a supported remittance provider that delivers to a Kenyan M-Pesa wallet.",
      "Make sure the receiver gets *" + money + "* after any sender fees.",
      "Availability and fees depend on your country and transfer provider."
    );
  } else {
    main.push(
      "*Option: Binance Pay (USDT only)*",
      "Binance Pay ID: *" + binanceId + "*",
      "Recipient nickname supplied by merchant: *" + binanceName + "*",
      "In Binance: Pay → Send → Binance User → enter the Binance ID.",
      "Select *USDT* and pay exactly *" + money + "*.",
      "Check the recipient's identity in the Binance app before confirming.",
      "This Binance ID is *not* a blockchain deposit address; do not send an on-chain transfer to it.",
      "Use this option only where Binance Pay and USDT transfers are supported."
    );
  }
  main.push(
    "",
    "If possible, add the order reference as your payment note.",
    "After sending, reply with the *transaction ID/reference* and attach the receipt if available.",
    "Payment proof is not an approval. The admin must verify funds received before processing.",
    "Never send a PIN, password, seed phrase or verification code."
  );
  return main.join("\n");
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
  quoteForMethod, paymentInstructions, manualApprovalBlock
};
