const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-wording-only-1min-proof", code, "utf8");

// Restore original actual timing if the previous patch changed it
code = code.replace(
  "const PAYMENT_TIMEOUT_MS = 1 * 60 * 1000;",
  "const PAYMENT_TIMEOUT_MS = 6 * 60 * 1000;"
);

code = code.replace(
  'const TZ_OTHER_PROOF_WAIT_MINUTES = Math.max(1, readIntEnv("TZ_OTHER_PROOF_WAIT_MINUTES", 1));',
  'const TZ_OTHER_PROOF_WAIT_MINUTES = Math.max(1, readIntEnv("TZ_OTHER_PROOF_WAIT_MINUTES", 2));'
);

// Payment Help wording only
const paymentHelpRegex = /  paymentHelp:\n    `[\s\S]*?`,\n  askPhoneBatch:/;

const paymentHelpReplacement = `  paymentHelp:
    \`🧾 Payment help:

Default method: *STK Push*.

If STK delays or fails, pay manually via:
*Buy Goods Till:* \${TILL_NUMBER}

If payment is not confirmed within *1 minute*, send the M-Pesa confirmation message or payment screenshot here.

🔁 Recheck is only available when the same file was checked and paid within the last 24 hours.\${RESALE_ENABLED && !isDiscountPublicActive() ? \`\\n\\n🏷️ \${RESALE_LABEL_TITLE} requires a code.\${discountTimeLineForMessage()}\` : ""}\${RESALE_ENABLED && isDiscountPublicActive() ? \`\\n\\n🏷️ \${RESALE_LABEL_TITLE} is active.\${discountTimeLineForMessage()}\` : ""}\`,
  askPhoneBatch:`;

if (!paymentHelpRegex.test(code)) throw new Error("paymentHelp block not found.");
code = code.replace(paymentHelpRegex, paymentHelpReplacement);

// STK sent message wording only
const stkSentRegex = /  stkSentWithTill: \(\) =>\n    `[\s\S]*?`,\n  paidMsgBatch:/;

const stkSentReplacement = `  stkSentWithTill: () =>
    \`✅ STK Push sent. Check your phone and enter PIN.

If STK delays or fails, pay manually via:
*Buy Goods Till:* \${TILL_NUMBER}

If payment is not confirmed within *1 minute*, send the M-Pesa confirmation message or payment screenshot here.\`,
  paidMsgBatch:`;

if (!stkSentRegex.test(code)) throw new Error("stkSentWithTill block not found.");
code = code.replace(stkSentRegex, stkSentReplacement);

// Till notice formatting
const tillNoticeFunction = `function mpesaTillNoticeMessage() {
  return [
    "🧾 *M-Pesa Payment Notice*",
    "",
    "The M-Pesa STK prompt gateway is currently experiencing technical issues.",
    "",
    "Please pay manually via *Buy Goods Till Number:*",
    "*" + TILL_NUMBER + "*",
    "",
    "If payment is not confirmed within *1 minute*, send the M-Pesa confirmation message or payment screenshot here for verification.",
    "",
    "STK prompts will resume once the gateway is stable."
  ].join("\\n");
}`;

const tillFnRegex = /function mpesaTillNoticeMessage\(\) \{[\s\S]*?\n\}/;

if (tillFnRegex.test(code)) {
  code = code.replace(tillFnRegex, tillNoticeFunction);
}

// Keep auto reminder timing unchanged, but improve wording when it appears
code = code.replace(
  /`⏳ Payment not confirmed yet\.\\n\\nYou may pay via:\\n\$\{tillLine\(\)\}\\n\\nThen send the M-Pesa message or screenshot here\.`/g,
  "`⏳ Payment not confirmed yet.\\n\\nIf you already paid and confirmation takes more than *1 minute*, send the M-Pesa confirmation message or payment screenshot here.\\n\\nManual payment:\\n*Buy Goods Till:* ${TILL_NUMBER}`"
);

// Tanzania wording only; actual reminder timing remains 2 minutes unless env says otherwise
code = code.replace(
  '"If not confirmed, send the payment message or screenshot here.",',
  '"If confirmation takes more than 1 minute, send the payment message or screenshot here.",'
);

fs.writeFileSync(path, code, "utf8");
console.log("Applied wording-only 1-minute proof instruction. Actual timing preserved.");
