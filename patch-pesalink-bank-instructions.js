const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-pesalink-bank-instructions", code, "utf8");

function replaceOnce(label, oldText, newText) {
  if (!code.includes(oldText)) {
    throw new Error("Could not find: " + label);
  }
  code = code.replace(oldText, newText);
  console.log("Updated: " + label);
}

function insertBefore(label, anchor, addition) {
  if (code.includes(addition.trim().split("\n")[0])) {
    console.log("Skipped: " + label);
    return;
  }
  if (!code.includes(anchor)) {
    throw new Error("Could not find anchor: " + label);
  }
  code = code.replace(anchor, addition + "\n\n" + anchor);
  console.log("Updated: " + label);
}

function replaceRegex(label, regex, replacement) {
  if (!regex.test(code)) {
    throw new Error("Could not find: " + label);
  }
  code = code.replace(regex, replacement);
  console.log("Updated: " + label);
}

// 1) Change default international wording away from PayPal/card.
code = code.replace(
  'process.env.INTERNATIONAL_METHODS_TEXT || "PayPal/PyUSD, ACH, or SEPA"',
  'process.env.INTERNATIONAL_METHODS_TEXT || "PesaLink or available bank checkout methods"'
);

// 2) Add manual fallback bank variables.
// Account name is NOT displayed to clients. It is only for admin verification if set in Render.
if (!code.includes('const INTERNATIONAL_BANK_FALLBACK_ENABLED = readBoolEnv("INTERNATIONAL_BANK_FALLBACK_ENABLED", true);')) {
  replaceOnce(
    "international bank fallback env vars",
    'const INTERNATIONAL_METHODS_TEXT = String(\n  process.env.INTERNATIONAL_METHODS_TEXT || "PesaLink or available bank checkout methods"\n).trim();',
    'const INTERNATIONAL_METHODS_TEXT = String(\n  process.env.INTERNATIONAL_METHODS_TEXT || "PesaLink or available bank checkout methods"\n).trim();\n\nconst INTERNATIONAL_BANK_FALLBACK_ENABLED = readBoolEnv("INTERNATIONAL_BANK_FALLBACK_ENABLED", true);\nconst INTERNATIONAL_BANK_NAME = String(process.env.INTERNATIONAL_BANK_NAME || "Co-operative Bank").trim();\nconst INTERNATIONAL_BANK_ACCOUNT_NUMBER = String(\n  process.env.INTERNATIONAL_BANK_ACCOUNT_NUMBER || "01102610456001"\n).replace(/[^0-9A-Za-z-]/g, "").trim();\nconst INTERNATIONAL_BANK_ACCOUNT_NAME = String(process.env.INTERNATIONAL_BANK_ACCOUNT_NAME || "").trim();'
  );
}

// 3) Add international message helper.
insertBefore(
  "international payment message helper",
  "async function startInternationalPayment(ctx, sub) {",
  String.raw`function internationalBankFallbackLines(apiRef) {
  if (!INTERNATIONAL_BANK_FALLBACK_ENABLED || !INTERNATIONAL_BANK_ACCOUNT_NUMBER) return [];

  return [
    "",
    "Backup only (manual bank transfer):",
    "Bank: *" + safeText(INTERNATIONAL_BANK_NAME || "Co-operative Bank") + "*",
    "Account: *" + safeText(INTERNATIONAL_BANK_ACCOUNT_NUMBER) + "*",
    "Reference: *" + safeText(apiRef) + "*",
    "",
    "After manual bank payment, send a screenshot here."
  ];
}

function internationalBankVerificationLine() {
  if (!INTERNATIONAL_BANK_ACCOUNT_NAME) return "";
  return "\nExpected bank recipient: " + safeText(INTERNATIONAL_BANK_ACCOUNT_NAME);
}

function buildInternationalPaymentMessage({ intlAmount, currency, apiRef }) {
  const amountText = formatPaymentMoney(intlAmount, currency);

  const lines = [
    "\u{1F30D} International payment",
    "",
    "Amount: *" + amountText + "*",
    "Reference: *" + safeText(apiRef) + "*",
    "",
    "Recommended automatic method:",
    "Tap *Pay Internationally*, choose *PesaLink* or available bank checkout, then complete in your banking app.",
    "",
    "If asked, choose *Send to Another Bank* > *Co-operative Bank*.",
    "",
    "\u26A0\uFE0F Enter BOTH the account number and the *Reference Number* shown on the checkout page.",
    "The *Reference Number* is important for automatic confirmation.",
    "",
    "The bot will confirm automatically after successful payment.",
    "",
    "If it does not confirm within 2 minutes, send payment proof here.",
    "",
    "For non-KES accounts, your bank can convert. Make sure the final received amount is *" + amountText + "*.",
    ...internationalBankFallbackLines(apiRef)
  ];

  return lines.join("\n");
}`
);

// 4) Replace the international payment message.
replaceRegex(
  "international payment client message",
  /await ctx\.reply\(\n\s*`\\u\{1F30D\} International payment[\s\S]*?reply_markup: internationalPayKeyboard\(checkoutUrl\)\.reply_markup\n\s*\}\n\s*\);/,
  'await ctx.reply(\n      buildInternationalPaymentMessage({ intlAmount, currency, apiRef }),\n      {\n        parse_mode: "Markdown",\n        reply_markup: internationalPayKeyboard(checkoutUrl).reply_markup\n      }\n    );'
);

// 5) Add hidden admin-only verification name to international proof cards.
code = code.replace(
  'Expected amount: ${amount}\\nMethod: ${INTERNATIONAL_METHODS_TEXT}\\n\\nMessage:',
  'Expected amount: ${amount}\\nMethod: ${INTERNATIONAL_METHODS_TEXT}${internationalBankVerificationLine()}\\n\\nMessage:'
);

code = code.replace(
  'Expected amount: ${amount}\\nMethod: ${INTERNATIONAL_METHODS_TEXT}`',
  'Expected amount: ${amount}\\nMethod: ${INTERNATIONAL_METHODS_TEXT}${internationalBankVerificationLine()}`'
);

// 6) Health endpoint: show fallback status, not account name.
if (!code.includes("internationalBankFallbackEnabled: INTERNATIONAL_BANK_FALLBACK_ENABLED")) {
  code = code.replace(
    '    internationalMethodsText: INTERNATIONAL_METHODS_TEXT,\n',
    '    internationalMethodsText: INTERNATIONAL_METHODS_TEXT,\n    internationalBankFallbackEnabled: INTERNATIONAL_BANK_FALLBACK_ENABLED,\n    internationalBankName: INTERNATIONAL_BANK_NAME,\n    internationalBankAccountNumber: INTERNATIONAL_BANK_ACCOUNT_NUMBER,\n    internationalBankAccountNameSet: Boolean(INTERNATIONAL_BANK_ACCOUNT_NAME),\n'
  );
}

// 7) Startup log: do not print account name.
if (!code.includes('International bank fallback: ${INTERNATIONAL_BANK_FALLBACK_ENABLED ? "YES" : "NO"}')) {
  code = code.replace(
    '  console.log(`International similarity only price: ${INTERNATIONAL_SIMILARITY_ONLY_PRICE} ${INTERNATIONAL_CURRENCY}`);\n',
    '  console.log(`International similarity only price: ${INTERNATIONAL_SIMILARITY_ONLY_PRICE} ${INTERNATIONAL_CURRENCY}`);\n  console.log(`International bank fallback: ${INTERNATIONAL_BANK_FALLBACK_ENABLED ? "YES" : "NO"}`);\n'
  );
}

fs.writeFileSync(path, code, "utf8");
console.log("PesaLink + manual bank fallback instructions updated successfully.");
