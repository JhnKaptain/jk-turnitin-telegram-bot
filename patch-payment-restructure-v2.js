const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-payment-restructure-v2", code, "utf8");

function replaceBetween(start, end, replacement) {
  const a = code.indexOf(start);
  if (a === -1) throw new Error("Start anchor not found: " + start);
  const b = code.indexOf(end, a);
  if (b === -1) throw new Error("End anchor not found: " + end);
  code = code.slice(0, a) + replacement + "\n\n" + code.slice(b);
}

function replaceFirstMatching(patterns, replacement, label) {
  for (const pattern of patterns) {
    if (code.includes(pattern)) {
      code = code.replace(pattern, replacement);
      return true;
    }
  }
  throw new Error("Could not replace " + label);
}

// Label cleanup
code = code.replace(
  'process.env.INTERNATIONAL_METHODS_TEXT || "PesaLink or available bank checkout methods"',
  'process.env.INTERNATIONAL_METHODS_TEXT || "Kenyan bank/PesaLink checkout"'
);

// Tanzania / Other Countries defaults
const bankNameAnchor = 'const INTERNATIONAL_BANK_ACCOUNT_NAME = String(process.env.INTERNATIONAL_BANK_ACCOUNT_NAME || "").trim();';

if (!code.includes("const TZ_OTHER_PAYMENT_ENABLED")) {
  code = code.replace(
    bankNameAnchor,
    bankNameAnchor + `

const TZ_OTHER_PAYMENT_ENABLED = readBoolEnv("TZ_OTHER_PAYMENT_ENABLED", true);
const TZ_OTHER_SAFARICOM_NUMBER = String(process.env.TZ_OTHER_SAFARICOM_NUMBER || "0741924396")
  .replace(/[^0-9+]/g, "")
  .trim();
const TZ_OTHER_AIRTEL_NUMBER = String(process.env.TZ_OTHER_AIRTEL_NUMBER || "0788060948")
  .replace(/[^0-9+]/g, "")
  .trim();
const TZ_OTHER_RECIPIENT_NAME = String(process.env.TZ_OTHER_RECIPIENT_NAME || "JOHN WANJALA").trim();
const TZ_OTHER_PROOF_WAIT_MINUTES = Math.max(1, readIntEnv("TZ_OTHER_PROOF_WAIT_MINUTES", 3));
const TZ_OTHER_CURRENCY = String(
  process.env.TZ_OTHER_CURRENCY || (process.env.INTERNATIONAL_CURRENCY ? INTERNATIONAL_CURRENCY : "KES")
).trim().toUpperCase();`
  );
} else if (!code.includes("const TZ_OTHER_CURRENCY")) {
  code = code.replace(
    'const TZ_OTHER_PROOF_WAIT_MINUTES = Math.max(1, readIntEnv("TZ_OTHER_PROOF_WAIT_MINUTES", 3));',
    `const TZ_OTHER_PROOF_WAIT_MINUTES = Math.max(1, readIntEnv("TZ_OTHER_PROOF_WAIT_MINUTES", 3));
const TZ_OTHER_CURRENCY = String(
  process.env.TZ_OTHER_CURRENCY || (process.env.INTERNATIONAL_CURRENCY ? INTERNATIONAL_CURRENCY : "KES")
).trim().toUpperCase();`
  );
}

// Payment method buttons
replaceBetween(
  "function paymentMethodKeyboard() {",
  "function internationalPayKeyboard(checkoutUrl) {",
`function paymentMethodKeyboard() {
  const rows = [
    [Markup.button.callback("\\u{1F1F0}\\u{1F1EA} M-Pesa STK", "PAYMENT_METHOD_MPESA")]
  ];

  if (INTERNATIONAL_PAYMENT_ENABLED) {
    rows.push([Markup.button.callback("\\u{1F3E6} Kenyan Bank Payment", "PAYMENT_METHOD_INTL")]);
  }

  if (TZ_OTHER_PAYMENT_ENABLED) {
    rows.push([Markup.button.callback("\\u{1F1F9}\\u{1F1FF} Tanzania / Other Countries", "PAYMENT_METHOD_TZ_OTHER")]);
  }

  rows.push([Markup.button.callback("\\u274C Cancel payment attempt", "PAYMENT_CANCEL")]);

  return Markup.inlineKeyboard(rows);
}`
);

replaceBetween(
  "function internationalPayKeyboard(checkoutUrl) {",
  "function paymentWaitKeyboard() {",
`function internationalPayKeyboard(checkoutUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.url("\\u{1F3E6} Pay via Kenyan Bank", checkoutUrl)],
    [Markup.button.callback("\\u274C Cancel payment attempt", "PAYMENT_CANCEL")]
  ]);
}`
);

replaceBetween(
  "function paymentWaitKeyboard() {",
  "async function replyMarkdownSafe(ctx, message, extra = {}) {",
`function paymentWaitKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("\\u{1F501} Resend STK Push", "STK_RESEND")],
    [Markup.button.callback("\\u{1F4DE} Change phone number", "STK_CHANGE_PHONE")],
    [Markup.button.callback("\\u274C Cancel payment attempt", "PAYMENT_CANCEL")]
  ]);
}

function manualPaymentWaitKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("\\u274C Cancel payment attempt", "PAYMENT_CANCEL")]
  ]);
}`
);

// Payment method summary pricing
replaceBetween(
  "async function moveBatchToPaymentMethodStep(ctx, sub) {",
  "async function moveBatchToPhoneStep(ctx, sub) {",
`async function moveBatchToPaymentMethodStep(ctx, sub) {
  const counts = getSubmissionCounts(sub);

  if (counts.total === 0) {
    await ctx.reply("\\u274C Please upload at least one file first.", { reply_markup: mainKeyboard() });
    return;
  }

  sub.amount = calculateSubmissionAmount(sub);
  sub.currency = "KES";
  sub.batchId = sub.batchId || makeBatchId(ctx.from.id);
  sub.stage = STAGE_WAIT_PAYMENT_METHOD;
  sub.currentFileIndex = null;

  const summary = formatBatchSummary(sub);

  const bankLine = INTERNATIONAL_PAYMENT_ENABLED
    ? "\\n\\u{1F3E6} Kenyan Bank Payment: *" + sub.amount + " KES*"
    : "";

  const tzOtherLine = TZ_OTHER_PAYMENT_ENABLED
    ? (
        isInternationalCheckOnly(sub)
          ? "\\n\\u{1F1F9}\\u{1F1FF} Tanzania / Other Countries: *" + formatPaymentMoney(calculateInternationalAmount(sub), TZ_OTHER_CURRENCY) + "*"
          : "\\n\\u{1F1F9}\\u{1F1FF} Tanzania / Other Countries: not available for discount/resale"
      )
    : "";

  await replyMarkdownSafe(
    ctx,
    "\\u{1F4E6} Batch summary\\n\\n" + summary + "\\n\\n" +
      "\\u{1F1F0}\\u{1F1EA} M-Pesa STK: *" + sub.amount + " KES*" +
      bankLine +
      tzOtherLine +
      "\\n\\nChoose payment method.",
    {
      reply_markup: paymentMethodKeyboard().reply_markup
    }
  );
}`
);

// Short Kenyan bank card
replaceBetween(
  "function internationalBankFallbackLines(apiRef) {",
  "function internationalBankVerificationLine() {",
`function internationalBankFallbackLines(apiRef) {
  if (!INTERNATIONAL_BANK_FALLBACK_ENABLED || !INTERNATIONAL_BANK_ACCOUNT_NUMBER) return [];

  return [
    "",
    "Backup manual bank transfer:",
    "Bank: *" + safeText(INTERNATIONAL_BANK_NAME || "Co-operative Bank") + "*",
    "*Account Number:* *" + safeText(INTERNATIONAL_BANK_ACCOUNT_NUMBER) + "*",
    "*Payment Description:* *" + safeText(apiRef) + "*"
  ];
}`
);

replaceBetween(
  "function buildInternationalPaymentMessage({ intlAmount, currency, apiRef }) {",
  "async function startInternationalPayment(ctx, sub) {",
`function buildInternationalPaymentMessage({ intlAmount, currency, apiRef }) {
  const amountText = formatPaymentMoney(intlAmount, currency);

  const lines = [
    "\\u{1F3E6} Kenyan Bank Payment",
    "",
    "Amount: *" + amountText + "*",
    "Reference: *" + safeText(apiRef) + "*",
    "",
    "Tap *Pay via Kenyan Bank* and complete the checkout.",
    "Use *PesaLink* or the available Kenyan bank option.",
    "",
    "Put the *Reference Number* in *Payment Description*.",
    "The bot confirms automatically after successful payment.",
    "",
    "If it does not confirm within 3 minutes, send payment proof here.",
    ...internationalBankFallbackLines(apiRef)
  ];

  return lines.join("\\n");
}`
);

// Kenyan Bank Payment now uses NORMAL Kenya prices
replaceBetween(
  "async function startInternationalPayment(ctx, sub) {",
  "async function handleInternationalPaymentProofText(ctx, sub, text) {",
`async function startInternationalPayment(ctx, sub) {
  const userId = ctx.from.id;

  if (!INTERNATIONAL_PAYMENT_ENABLED) {
    await ctx.reply("\\u{1F3E6} Kenyan Bank Payment is not available right now.", {
      reply_markup: paymentMethodKeyboard().reply_markup
    });
    return;
  }

  const apiRef = makePaymentAttemptRef(userId);
  const summary = formatBatchSummary(sub);
  const bankAmount = calculateSubmissionAmount(sub);
  const currency = "KES";

  putPaymentRef(apiRef, {
    userId,
    batchId: sub.batchId,
    kind: getBatchKindLabel(sub),
    amount: bankAmount,
    currency,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    summary,
    phone: null,
    name: getUserFullName(ctx.from),
    username: ctx.from.username || "N/A",
    invoiceId: null,
    status: "PENDING",
    lastState: "PENDING",
    mode: INTASEND_TEST ? "TEST" : "LIVE",
    paymentMethod: "KENYAN_BANK",
    pendingProof: null,
    files: (sub.files || []).map((file) => ({
      file_id: file.file_id || null,
      file_unique_id: file.file_unique_id || null,
      file_name: file.file_name || null,
      type: file.type || null,
      price: file.price || null,
      recheckEligible: Boolean(file.recheckEligible)
    }))
  });

  try {
    const checkout = await intasendCreateCheckout({
      amount: bankAmount,
      currency,
      api_ref: apiRef,
      user: ctx.from
    });

    const checkoutUrl = extractCheckoutUrl(checkout);
    const checkoutInvoiceId = extractInvoiceId(checkout);

    if (!checkoutUrl) {
      throw new Error("Checkout link was not returned by IntaSend.");
    }

    sub.api_ref = apiRef;
    sub.invoiceId = checkoutInvoiceId || null;
    sub.stage = STAGE_WAIT_PAYMENT;
    sub.paymentMethod = "KENYAN_BANK";
    sub.amount = bankAmount;
    sub.currency = currency;
    sub.paymentAttempts.push(apiRef);

    updatePaymentRef(apiRef, {
      invoiceId: checkoutInvoiceId || null,
      checkoutUrl,
      checkoutResponseAt: Date.now(),
      rawResponseSnapshot: {
        url: checkoutUrl,
        invoice_id: checkoutInvoiceId || null,
        api_ref: apiRef,
        amount: bankAmount,
        currency
      }
    });

    await ctx.reply(
      buildInternationalPaymentMessage({ intlAmount: bankAmount, currency, apiRef }),
      {
        parse_mode: "Markdown",
        reply_markup: internationalPayKeyboard(checkoutUrl).reply_markup
      }
    );

    startStatusPolling({ userId, apiRef, invoiceId: checkoutInvoiceId || null });
    scheduleManualProofReminder(
      userId,
      apiRef,
      "KENYAN_BANK",
      "If Kenyan bank payment is not confirmed yet, send payment proof here."
    );
  } catch (err) {
    updatePaymentRef(apiRef, {
      status: "FAILED_TO_CREATE_CHECKOUT",
      failureSource: "kenyan-bank-checkout",
      failureMessage: safeText(err?.message || err),
      failureStatus: err?.status || null,
      failurePayload: err?.payload || null
    });

    await ctx.reply(
      "\\u274C Kenyan Bank Payment link could not be created right now.\\n\\nPlease choose M-Pesa STK or Tanzania / Other Countries payment.",
      { reply_markup: paymentMethodKeyboard().reply_markup }
    );

    await sendAdminMessage(
      "\\u274C Kenyan bank checkout error\\nUser ID: " + userId +
        "\\nName: " + getUserFullName(ctx.from) +
        "\\nUsername: @" + safeText(ctx.from.username || "N/A") +
        "\\nAmount: " + formatPaymentMoney(bankAmount, currency) +
        "\\nError: " + safeText(err?.message || err),
      { adminButtons: "replyOnly" }
    );
  }
}`
);

replaceBetween(
  "async function handleInternationalPaymentProofText(ctx, sub, text) {",
  "async function handleInternationalPaymentScreenshotProof(ctx, sub) {",
`async function handleInternationalPaymentProofText(ctx, sub, text) {
  const user = ctx.from;
  const amount = formatPaymentMoney(sub.amount, sub.currency || "KES");

  await sendAdminMessage(
    "\\u{1F3E6} Kenyan bank payment proof received\\nUser ID: " + user.id +
      "\\nName: " + getUserFullName(user) +
      "\\nUsername: @" + safeText(user.username || "N/A") +
      "\\n\\nExpected amount: " + amount +
      "\\nMethod: " + INTERNATIONAL_METHODS_TEXT + internationalBankVerificationLine() +
      "\\n\\nMessage:\\n" + safeText(text),
    { adminButtons: "paymentProof" }
  );

  await ctx.reply("\\u2705 Payment proof received. Admin will verify.", {
    reply_markup: manualPaymentWaitKeyboard().reply_markup
  });
}`
);

// Add Tanzania / Other Countries manual route
replaceBetween(
  "async function handleInternationalPaymentScreenshotProof(ctx, sub) {",
  "// =====================\n// STK PUSH",
`async function handleInternationalPaymentScreenshotProof(ctx, sub) {
  const user = ctx.from;
  const amount = formatPaymentMoney(sub.amount, sub.currency || "KES");

  await sendAdminMessage(
    "\\u{1F3E6} Kenyan bank payment screenshot received\\nUser ID: " + user.id +
      "\\nName: " + getUserFullName(user) +
      "\\nUsername: @" + safeText(user.username || "N/A") +
      "\\n\\nExpected amount: " + amount +
      "\\nMethod: " + INTERNATIONAL_METHODS_TEXT + internationalBankVerificationLine(),
    { adminButtons: "paymentProof" }
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch {}

  await ctx.reply("\\u2705 Payment proof received. Admin will verify.", {
    reply_markup: manualPaymentWaitKeyboard().reply_markup
  });
}

function scheduleManualProofReminder(userId, apiRef, paymentMethod, message) {
  setTimeout(async () => {
    const ref = getPaymentRef(apiRef);
    const sub = submissions[userId];

    if (!ref) return;
    if (ref.status === "COMPLETE") return;
    if (!sub || sub.paid) return;
    if (sub.stage !== STAGE_WAIT_PAYMENT) return;
    if (String(sub.paymentMethod || "") !== String(paymentMethod || "")) return;
    if (String(sub.api_ref || "") !== String(apiRef || "")) return;

    try {
      await bot.telegram.sendMessage(
        userId,
        message || "If payment is not confirmed yet, send payment proof here.",
        { reply_markup: manualPaymentWaitKeyboard().reply_markup }
      );
    } catch {}
  }, TZ_OTHER_PROOF_WAIT_MINUTES * 60 * 1000);
}

function buildTzOtherPaymentMessage({ amount, currency, apiRef }) {
  const amountText = formatPaymentMoney(amount, currency);

  const lines = [
    "\\u{1F1F9}\\u{1F1FF} Tanzania / Other Countries",
    "",
    "Amount: *" + amountText + "*",
    "Reference: *" + safeText(apiRef) + "*",
    "",
    "Pay manually to either:",
    "Safaricom M-Pesa: *" + safeText(TZ_OTHER_SAFARICOM_NUMBER) + "*",
    "Airtel Money: *" + safeText(TZ_OTHER_AIRTEL_NUMBER) + "*",
    "Name: *" + safeText(TZ_OTHER_RECIPIENT_NAME) + "*",
    "",
    "Wait up to *" + TZ_OTHER_PROOF_WAIT_MINUTES + " minutes* for admin confirmation.",
    "If not confirmed, send the payment message or screenshot here.",
    "",
    "Other countries: send to the Safaricom M-Pesa number using Remitly, WorldRemit, Wise, Taptap Send, or similar."
  ];

  return lines.join("\\n");
}

async function startTzOtherPayment(ctx, sub) {
  const userId = ctx.from.id;

  if (!TZ_OTHER_PAYMENT_ENABLED) {
    await ctx.reply("\\u{1F1F9}\\u{1F1FF} Tanzania / Other Countries payment is not available right now.", {
      reply_markup: paymentMethodKeyboard().reply_markup
    });
    return;
  }

  if (!isInternationalCheckOnly(sub)) {
    await ctx.reply(
      "\\u{1F1F9}\\u{1F1FF} Tanzania / Other Countries payment is available for CHECK, RECHECK, or Similarity Report Only.\\n\\nDiscount/resale files should use M-Pesa STK, Kenyan Bank Payment, or contact support.",
      { reply_markup: paymentMethodKeyboard().reply_markup }
    );
    return;
  }

  const apiRef = makePaymentAttemptRef(userId);
  const summary = formatBatchSummary(sub);
  const amount = calculateInternationalAmount(sub);
  const currency = TZ_OTHER_CURRENCY;

  putPaymentRef(apiRef, {
    userId,
    batchId: sub.batchId,
    kind: (getSubmissionCounts(sub).checks + getSubmissionCounts(sub).rechecks + getSubmissionCounts(sub).similarities) + " TZ/OTHER REPORT",
    amount,
    currency,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    summary,
    phone: null,
    name: getUserFullName(ctx.from),
    username: ctx.from.username || "N/A",
    invoiceId: null,
    status: "PENDING",
    lastState: "PENDING",
    mode: "MANUAL",
    paymentMethod: "TZ_OTHER",
    pendingProof: null,
    paymentInstructions: {
      safaricom: TZ_OTHER_SAFARICOM_NUMBER,
      airtel: TZ_OTHER_AIRTEL_NUMBER,
      recipientName: TZ_OTHER_RECIPIENT_NAME
    },
    files: (sub.files || []).map((file) => ({
      file_id: file.file_id || null,
      file_unique_id: file.file_unique_id || null,
      file_name: file.file_name || null,
      type: file.type || null,
      price: file.type === "SIMILARITY" ? INTERNATIONAL_SIMILARITY_ONLY_PRICE : INTERNATIONAL_CHECK_PRICE_USD,
      recheckEligible: Boolean(file.recheckEligible)
    }))
  });

  sub.api_ref = apiRef;
  sub.invoiceId = null;
  sub.stage = STAGE_WAIT_PAYMENT;
  sub.paymentMethod = "TZ_OTHER";
  sub.amount = amount;
  sub.currency = currency;
  sub.paymentAttempts.push(apiRef);

  await ctx.reply(
    buildTzOtherPaymentMessage({ amount, currency, apiRef }),
    {
      parse_mode: "Markdown",
      reply_markup: manualPaymentWaitKeyboard().reply_markup
    }
  );

  await sendAdminMessage(
    "\\u{1F4F2} Tanzania / Other Countries payment opened\\nUser ID: " + userId +
      "\\nName: " + getUserFullName(ctx.from) +
      "\\nUsername: @" + safeText(ctx.from.username || "N/A") +
      "\\n\\nExpected amount: " + formatPaymentMoney(amount, currency) +
      "\\nRef: " + apiRef +
      "\\nSafaricom: " + TZ_OTHER_SAFARICOM_NUMBER +
      "\\nAirtel: " + TZ_OTHER_AIRTEL_NUMBER +
      "\\nExpected name: " + TZ_OTHER_RECIPIENT_NAME +
      "\\n\\nAdmin can confirm if payment arrives.",
    { adminButtons: "paymentProof" }
  );

  scheduleManualProofReminder(
    userId,
    apiRef,
    "TZ_OTHER",
    "If payment is not confirmed yet, send the payment message or screenshot here."
  );
}

async function handleTzOtherPaymentProofText(ctx, sub, text) {
  const user = ctx.from;
  const amount = formatPaymentMoney(sub.amount, sub.currency || TZ_OTHER_CURRENCY);
  const apiRef = sub.api_ref;

  if (apiRef) {
    updatePaymentRef(apiRef, {
      pendingProof: {
        type: "tz-other-text",
        message: safeText(text),
        receivedAt: Date.now()
      }
    });
  }

  await sendAdminMessage(
    "\\u{1F4F2} Tanzania / Other Countries proof received\\nUser ID: " + user.id +
      "\\nName: " + getUserFullName(user) +
      "\\nUsername: @" + safeText(user.username || "N/A") +
      "\\n\\nExpected amount: " + amount +
      "\\nSafaricom: " + TZ_OTHER_SAFARICOM_NUMBER +
      "\\nAirtel: " + TZ_OTHER_AIRTEL_NUMBER +
      "\\nExpected name: " + TZ_OTHER_RECIPIENT_NAME +
      "\\n\\nCheck sender phone, send-to number/name, amount, and reference." +
      "\\n\\nMessage:\\n" + safeText(text),
    { adminButtons: "paymentProof" }
  );

  await ctx.reply("\\u2705 Payment proof received. Admin will verify.", {
    reply_markup: manualPaymentWaitKeyboard().reply_markup
  });
}

async function handleTzOtherPaymentScreenshotProof(ctx, sub) {
  const user = ctx.from;
  const amount = formatPaymentMoney(sub.amount, sub.currency || TZ_OTHER_CURRENCY);
  const apiRef = sub.api_ref;

  if (apiRef) {
    updatePaymentRef(apiRef, {
      pendingProof: {
        type: "tz-other-screenshot",
        receivedAt: Date.now()
      }
    });
  }

  await sendAdminMessage(
    "\\u{1F4F2} Tanzania / Other Countries screenshot received\\nUser ID: " + user.id +
      "\\nName: " + getUserFullName(user) +
      "\\nUsername: @" + safeText(user.username || "N/A") +
      "\\n\\nExpected amount: " + amount +
      "\\nSafaricom: " + TZ_OTHER_SAFARICOM_NUMBER +
      "\\nAirtel: " + TZ_OTHER_AIRTEL_NUMBER +
      "\\nExpected name: " + TZ_OTHER_RECIPIENT_NAME +
      "\\n\\nCheck sender phone, send-to number/name, amount, and reference.",
    { adminButtons: "paymentProof" }
  );

  try {
    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  } catch {}

  await ctx.reply("\\u2705 Payment proof received. Admin will verify.", {
    reply_markup: manualPaymentWaitKeyboard().reply_markup
  });
}`
);

// Route screenshots to correct payment handler
const desiredPhotoBlock = `if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    if (sub.paymentMethod === "INTERNATIONAL" || sub.paymentMethod === "KENYAN_BANK") {
      await handleInternationalPaymentScreenshotProof(ctx, sub);
    } else if (sub.paymentMethod === "TZ_OTHER") {
      await handleTzOtherPaymentScreenshotProof(ctx, sub);
    } else {
      await handlePaymentScreenshotProof(ctx, sub);
    }
    return;
  }`;

if (!code.includes('sub.paymentMethod === "INTERNATIONAL" || sub.paymentMethod === "KENYAN_BANK") {
      await handleInternationalPaymentScreenshotProof(ctx, sub);')) {
  replaceFirstMatching(
    [
`if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    if (sub.paymentMethod === "INTERNATIONAL") {
      await handleInternationalPaymentScreenshotProof(ctx, sub);
    } else {
      await handlePaymentScreenshotProof(ctx, sub);
    }
    return;
  }`,
`if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    if (sub.paymentMethod === "INTERNATIONAL") {
      await handleInternationalPaymentScreenshotProof(ctx, sub);
    } else if (sub.paymentMethod === "TZ_OTHER") {
      await handleTzOtherPaymentScreenshotProof(ctx, sub);
    } else {
      await handlePaymentScreenshotProof(ctx, sub);
    }
    return;
  }`
    ],
    desiredPhotoBlock,
    "photo payment block"
  );
}

// Route text proofs to correct payment handler
const desiredTextBlock = `if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    if (sub.paymentMethod === "INTERNATIONAL" || sub.paymentMethod === "KENYAN_BANK") {
      await handleInternationalPaymentProofText(ctx, sub, text);
    } else if (sub.paymentMethod === "TZ_OTHER") {
      await handleTzOtherPaymentProofText(ctx, sub, text);
    } else {
      await handleMpesaProofText(ctx, sub, text);
    }
    return;
  }`;

if (!code.includes('sub.paymentMethod === "INTERNATIONAL" || sub.paymentMethod === "KENYAN_BANK") {
      await handleInternationalPaymentProofText(ctx, sub, text);')) {
  replaceFirstMatching(
    [
`if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    if (sub.paymentMethod === "INTERNATIONAL") {
      await handleInternationalPaymentProofText(ctx, sub, text);
    } else {
      await handleMpesaProofText(ctx, sub, text);
    }
    return;
  }`,
`if (sub && sub.stage === STAGE_WAIT_PAYMENT) {
    if (sub.paymentMethod === "INTERNATIONAL") {
      await handleInternationalPaymentProofText(ctx, sub, text);
    } else if (sub.paymentMethod === "TZ_OTHER") {
      await handleTzOtherPaymentProofText(ctx, sub, text);
    } else {
      await handleMpesaProofText(ctx, sub, text);
    }
    return;
  }`
    ],
    desiredTextBlock,
    "text payment block"
  );
}

// Rename existing bank action callback response
code = code.replace(
  'await ctx.answerCbQuery("International payment selected");',
  'await ctx.answerCbQuery("Kenyan bank selected");'
);

// Add Tanzania / Other Countries action
const actionAnchor = "\n// =====================\n// STK CONTROLS";

if (!code.includes('bot.action("PAYMENT_METHOD_TZ_OTHER"')) {
  code = code.replace(
    actionAnchor,
`

bot.action("PAYMENT_METHOD_TZ_OTHER", async (ctx) => {
  const userId = ctx.from.id;
  const sub = submissions[userId];

  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);
  if (!sub || sub.stage !== STAGE_WAIT_PAYMENT_METHOD) return ctx.answerCbQuery("No payment method needed.");

  await ctx.answerCbQuery("Tanzania / other countries selected");
  await startTzOtherPayment(ctx, sub);
});
` + actionAnchor
  );
}

// Health endpoint additions
if (!code.includes("tanzaniaOtherPaymentEnabled")) {
  code = code.replace(
    "    internationalBankAccountNameSet: Boolean(INTERNATIONAL_BANK_ACCOUNT_NAME),",
    `    internationalBankAccountNameSet: Boolean(INTERNATIONAL_BANK_ACCOUNT_NAME),
    tanzaniaOtherPaymentEnabled: TZ_OTHER_PAYMENT_ENABLED,
    tanzaniaOtherSafaricomNumber: TZ_OTHER_SAFARICOM_NUMBER,
    tanzaniaOtherAirtelNumber: TZ_OTHER_AIRTEL_NUMBER,
    tanzaniaOtherRecipientName: TZ_OTHER_RECIPIENT_NAME,
    tanzaniaOtherProofWaitMinutes: TZ_OTHER_PROOF_WAIT_MINUTES,
    tanzaniaOtherCurrency: TZ_OTHER_CURRENCY,`
  );
} else if (!code.includes("tanzaniaOtherCurrency")) {
  code = code.replace(
    "    tanzaniaOtherProofWaitMinutes: TZ_OTHER_PROOF_WAIT_MINUTES,",
    `    tanzaniaOtherProofWaitMinutes: TZ_OTHER_PROOF_WAIT_MINUTES,
    tanzaniaOtherCurrency: TZ_OTHER_CURRENCY,`
  );
}

// Startup logs
code = code.replace(
  '  console.log(`International payment enabled: ${INTERNATIONAL_PAYMENT_ENABLED ? "YES" : "NO"}`);',
  '  console.log(`Kenyan bank payment enabled: ${INTERNATIONAL_PAYMENT_ENABLED ? "YES" : "NO"}`);'
);

code = code.replace(
  '  console.log(`International check/recheck price: ${INTERNATIONAL_CHECK_PRICE_USD} ${INTERNATIONAL_CURRENCY}`);',
  '  console.log(`TZ/Other check/recheck price: ${INTERNATIONAL_CHECK_PRICE_USD} ${TZ_OTHER_CURRENCY}`);'
);

code = code.replace(
  '  console.log(`International similarity only price: ${INTERNATIONAL_SIMILARITY_ONLY_PRICE} ${INTERNATIONAL_CURRENCY}`);',
  '  console.log(`TZ/Other similarity only price: ${INTERNATIONAL_SIMILARITY_ONLY_PRICE} ${TZ_OTHER_CURRENCY}`);'
);

if (!code.includes("Tanzania / Other Countries payment:")) {
  code = code.replace(
    '  console.log(`International bank fallback: ${INTERNATIONAL_BANK_FALLBACK_ENABLED ? "YES" : "NO"}`);',
    '  console.log(`Kenyan bank fallback: ${INTERNATIONAL_BANK_FALLBACK_ENABLED ? "YES" : "NO"}`);\n  console.log(`Tanzania / Other Countries payment: ${TZ_OTHER_PAYMENT_ENABLED ? "YES" : "NO"}`);'
  );

  code = code.replace(
    '  console.log(`Kenyan bank fallback: ${INTERNATIONAL_BANK_FALLBACK_ENABLED ? "YES" : "NO"}`);',
    '  console.log(`Kenyan bank fallback: ${INTERNATIONAL_BANK_FALLBACK_ENABLED ? "YES" : "NO"}`);\n  console.log(`Tanzania / Other Countries payment: ${TZ_OTHER_PAYMENT_ENABLED ? "YES" : "NO"}`);'
  );
}

fs.writeFileSync(path, code, "utf8");
console.log("Payment restructure v2 applied.");
