const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-remove-paystack", code, "utf8");

function mustReplaceRegex(label, regex, replacement) {
  if (!regex.test(code)) {
    throw new Error("Could not find: " + label);
  }
  code = code.replace(regex, replacement);
  console.log("Removed/updated: " + label);
}

function replaceOptionalRegex(label, regex, replacement) {
  if (regex.test(code)) {
    code = code.replace(regex, replacement);
    console.log("Removed/updated: " + label);
  } else {
    console.log("Skipped: " + label);
  }
}

function replaceOptional(label, oldText, newText) {
  if (code.includes(oldText)) {
    code = code.replace(oldText, newText);
    console.log("Removed/updated: " + label);
  } else {
    console.log("Skipped: " + label);
  }
}

// 1) Remove crypto require used only for Paystack
replaceOptionalRegex(
  "crypto require",
  /\nconst crypto = require\("crypto"\);\n/,
  "\n"
);

// 2) Remove Paystack env variables and gateway selector
mustReplaceRegex(
  "Paystack env variables",
  /const INTERNATIONAL_GATEWAY = String\(process\.env\.INTERNATIONAL_GATEWAY \|\| "INTASEND"\)[\s\S]*?const PAYSTACK_EMAIL_DOMAIN = String\(process\.env\.PAYSTACK_EMAIL_DOMAIN \|\| "jkturnitin\.local"\)[\s\S]*?\|\| "jkturnitin\.local";\n\n/,
  ""
);

// 3) Remove Paystack email stage
replaceOptional(
  "Paystack email stage constant",
  'const STAGE_WAIT_INTERNATIONAL_EMAIL = "WAIT_INTERNATIONAL_EMAIL";\n',
  ""
);

// 4) Remove Paystack helper functions
mustReplaceRegex(
  "Paystack helper functions",
  /function isPaystackInternationalGateway\(\) \{[\s\S]*?\n\}\n\nfunction extractApiRef\(payload\) \{/,
  "function extractApiRef(payload) {"
);

// 5) Remove Paystack status polling branch
replaceOptionalRegex(
  "Paystack status polling branch",
  /async function queryPaymentStatus\(invoiceId, apiRef\) \{\n\s*const existingRefForGateway = apiRef \? getPaymentRef\(apiRef\) : null;\n\n\s*if \(existingRefForGateway\?\.paymentGateway === "PAYSTACK"\) \{\n\s*return paystackVerifyTransaction\(apiRef\);\n\s*\}\n\n\s*let best = null;/,
  "async function queryPaymentStatus(invoiceId, apiRef) {\n  let best = null;"
);

// 6) Restore IntaSend-only international payment function
const intasendOnlyInternational = [
"async function startInternationalPayment(ctx, sub) {",
"  const userId = ctx.from.id;",
"",
"  if (!INTERNATIONAL_PAYMENT_ENABLED) {",
"    await ctx.reply(\"\\u{1F30D} International payment is not available right now.\", {",
"      reply_markup: paymentMethodKeyboard().reply_markup",
"    });",
"    return;",
"  }",
"",
"  if (!isInternationalCheckOnly(sub)) {",
"    await ctx.reply(",
"      \"\\u{1F30D} International payment is currently available for CHECK only.\\n\\nPlease choose \\u{1F1F0}\\u{1F1EA} Kenya M-Pesa or contact support.\",",
"      { reply_markup: paymentMethodKeyboard().reply_markup }",
"    );",
"    return;",
"  }",
"",
"  const apiRef = makePaymentAttemptRef(userId);",
"  const summary = formatBatchSummary(sub);",
"  const intlAmount = calculateInternationalAmount(sub);",
"  const currency = INTERNATIONAL_CURRENCY;",
"",
"  putPaymentRef(apiRef, {",
"    userId,",
"    batchId: sub.batchId,",
"    kind: `${getSubmissionCounts(sub).checks} INTERNATIONAL CHECK`,",
"    amount: intlAmount,",
"    currency,",
"    createdAt: Date.now(),",
"    updatedAt: Date.now(),",
"    summary,",
"    phone: null,",
"    name: getUserFullName(ctx.from),",
"    username: ctx.from.username || \"N/A\",",
"    invoiceId: null,",
"    status: \"PENDING\",",
"    lastState: \"PENDING\",",
"    mode: INTASEND_TEST ? \"TEST\" : \"LIVE\",",
"    paymentMethod: \"INTERNATIONAL\",",
"    pendingProof: null,",
"    files: (sub.files || []).map((file) => ({",
"      file_id: file.file_id || null,",
"      file_unique_id: file.file_unique_id || null,",
"      file_name: file.file_name || null,",
"      type: file.type || null,",
"      price: INTERNATIONAL_CHECK_PRICE_USD,",
"      recheckEligible: Boolean(file.recheckEligible)",
"    }))",
"  });",
"",
"  try {",
"    const checkout = await intasendCreateCheckout({",
"      amount: intlAmount,",
"      currency,",
"      api_ref: apiRef,",
"      user: ctx.from",
"    });",
"",
"    const checkoutUrl = extractCheckoutUrl(checkout);",
"",
"    if (!checkoutUrl) {",
"      throw new Error(\"Checkout link was not returned by IntaSend.\");",
"    }",
"",
"    sub.api_ref = apiRef;",
"    sub.invoiceId = null;",
"    sub.stage = STAGE_WAIT_PAYMENT;",
"    sub.paymentMethod = \"INTERNATIONAL\";",
"    sub.amount = intlAmount;",
"    sub.currency = currency;",
"    sub.paymentAttempts.push(apiRef);",
"",
"    updatePaymentRef(apiRef, {",
"      checkoutUrl,",
"      checkoutResponseAt: Date.now(),",
"      rawResponseSnapshot: {",
"        url: checkoutUrl,",
"        api_ref: apiRef,",
"        amount: intlAmount,",
"        currency",
"      }",
"    });",
"",
"    await ctx.reply(",
"      `\\u{1F30D} International payment\\n\\nAmount: *${formatPaymentMoney(intlAmount, currency)}*\\n\\nUse *${INTERNATIONAL_METHODS_TEXT}* only.\\nDo not use card payment if shown as unavailable.\\n\\nAfter paying, send payment proof here.`,",
"      {",
"        parse_mode: \"Markdown\",",
"        reply_markup: internationalPayKeyboard(checkoutUrl).reply_markup",
"      }",
"    );",
"  } catch (err) {",
"    updatePaymentRef(apiRef, {",
"      status: \"FAILED_TO_CREATE_CHECKOUT\",",
"      failureSource: \"international-checkout\",",
"      failureMessage: safeText(err?.message || err),",
"      failureStatus: err?.status || null,",
"      failurePayload: err?.payload || null",
"    });",
"",
"    await ctx.reply(",
"      \"❌ International payment link could not be created right now.\\n\\nPlease choose \\u{1F1F0}\\u{1F1EA} Kenya M-Pesa or contact support.\",",
"      { reply_markup: paymentMethodKeyboard().reply_markup }",
"    );",
"",
"    await sendAdminMessage(",
"      `❌ International checkout error\\nUser ID: ${userId}\\nName: ${getUserFullName(ctx.from)}\\nUsername: @${safeText(",
"        ctx.from.username || \"N/A\"",
"      )}\\nAmount: ${formatPaymentMoney(intlAmount, currency)}\\nError: ${safeText(err?.message || err)}`,",
"      { adminButtons: \"replyOnly\" }",
"    );",
"  }",
"}"
].join("\n");

mustReplaceRegex(
  "startInternationalPayment IntaSend only",
  /async function startInternationalPayment\(ctx, sub\) \{[\s\S]*?\n\}\n\nasync function handleInternationalPaymentProofText/,
  intasendOnlyInternational + "\n\nasync function handleInternationalPaymentProofText"
);

// 7) Remove Paystack email text handler
replaceOptionalRegex(
  "Paystack email text handler",
  /\n\s*if \(sub && sub\.stage === STAGE_WAIT_INTERNATIONAL_EMAIL\) \{\n\s*const email = normalizeEmail\(text\);\n\s*if \(!email\) return ctx\.reply\("❌ Invalid email address\. Send a valid email\."\);\n\n\s*sub\.internationalEmail = email;\n\s*await startInternationalPayment\(ctx, sub\);\n\s*return;\n\s*\}\n/,
  "\n"
);

// 8) Remove Paystack email stage from upload blockers/helpers
replaceOptional(
  "document payment block email stage",
  "    sub.stage === STAGE_WAIT_INTERNATIONAL_EMAIL ||\n",
  ""
);

replaceOptional(
  "active helper email stage",
  "    STAGE_WAIT_INTERNATIONAL_EMAIL,\n",
  ""
);

// 9) Remove Paystack routes
replaceOptionalRegex(
  "Paystack routes",
  /app\.get\("\/paystack\/callback"[\s\S]*?\napp\.get\("\/intasend\/webhook"/,
  'app.get("/intasend/webhook"'
);

// 10) Remove Paystack startup logs
replaceOptional(
  "international gateway startup log",
  '  console.log(`International gateway: ${INTERNATIONAL_GATEWAY}`);\n',
  ""
);

replaceOptional(
  "Paystack enabled startup log",
  '  console.log(`Paystack enabled: ${PAYSTACK_ENABLED ? "YES" : "NO"}`);\n',
  ""
);

replaceOptional(
  "Paystack channels startup log",
  '  console.log(`Paystack channels: ${PAYSTACK_CHANNELS.join(",") || "default"}`);\n',
  ""
);

// 11) Fix duplicated AI icon if present
code = code.replace("`ℹ️ ℹ️ AI Writing Report Unavailable", "`ℹ️ AI Writing Report Unavailable");

// 12) Final safety check
const forbidden = [
  "PAYSTACK",
  "Paystack",
  "paystack",
  "STAGE_WAIT_INTERNATIONAL_EMAIL",
  "INTERNATIONAL_GATEWAY",
  "PAYSTACK_SECRET_KEY",
  "PAYSTACK_PUBLIC_KEY"
];

const found = forbidden.filter((word) => code.includes(word));
if (found.length) {
  throw new Error("Paystack removal incomplete. Still found: " + found.join(", "));
}

fs.writeFileSync(path, code, "utf8");
console.log("Paystack removed successfully. Backup saved as bot.js.before-remove-paystack");
