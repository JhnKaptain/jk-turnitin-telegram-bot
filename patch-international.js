const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function mustReplace(label, oldText, newText) {
  if (!code.includes(oldText)) {
    throw new Error("Could not find block: " + label);
  }
  code = code.replace(oldText, newText);
}

function replaceOptional(label, oldText, newText) {
  if (code.includes(oldText)) {
    code = code.replace(oldText, newText);
  } else {
    console.log("Skipped optional block: " + label);
  }
}

function mustReplaceRegex(label, regex, newText) {
  if (!regex.test(code)) {
    throw new Error("Could not find regex block: " + label);
  }
  code = code.replace(regex, newText);
}

function replaceOptionalRegex(label, regex, newText) {
  if (regex.test(code)) {
    code = code.replace(regex, newText);
  } else {
    console.log("Skipped optional regex block: " + label);
  }
}

// 1) Add payment-method stage
replaceOptional(
  "payment method stage",
  'const STAGE_WAIT_RESELLER_CODE = "WAIT_RESELLER_CODE";\nconst STAGE_WAIT_PHONE = "WAIT_PHONE";',
  'const STAGE_WAIT_RESELLER_CODE = "WAIT_RESELLER_CODE";\nconst STAGE_WAIT_PAYMENT_METHOD = "WAIT_PAYMENT_METHOD";\nconst STAGE_WAIT_PHONE = "WAIT_PHONE";'
);

// 2) Add international payment variables
replaceOptional(
  "international variables",
  'const DISCOUNT_TIME_VISIBLE = readBoolEnv("DISCOUNT_TIME_VISIBLE", false);\nconst DISCOUNT_START_EAT = normalizeHHMM(process.env.DISCOUNT_START_EAT, "");\nconst DISCOUNT_END_EAT = normalizeHHMM(process.env.DISCOUNT_END_EAT, "");',
  'const DISCOUNT_TIME_VISIBLE = readBoolEnv("DISCOUNT_TIME_VISIBLE", false);\nconst DISCOUNT_START_EAT = normalizeHHMM(process.env.DISCOUNT_START_EAT, "");\nconst DISCOUNT_END_EAT = normalizeHHMM(process.env.DISCOUNT_END_EAT, "");\n\nconst INTERNATIONAL_PAYMENT_ENABLED = readBoolEnv("INTERNATIONAL_PAYMENT_ENABLED", true);\nconst INTERNATIONAL_CHECK_PRICE_USD = readFloatEnv("INTERNATIONAL_CHECK_PRICE_USD", 2);\nconst INTERNATIONAL_CURRENCY = String(process.env.INTERNATIONAL_CURRENCY || "USD").trim().toUpperCase();\nconst INTERNATIONAL_METHODS_TEXT = String(\n  process.env.INTERNATIONAL_METHODS_TEXT || "PayPal/PyUSD, ACH, or SEPA"\n).trim();'
);

// 3) Update paid message to support USD/KES
mustReplace(
  "paidMsgBatch currency",
  '  paidMsgBatch: (amount, summary) =>\n    `✅ Payment confirmed (${amount} KES).\\n\\n${summary}\\n\\n⏱ ${reportProcessingTimeText()}`',
  '  paidMsgBatch: (amount, summary, currency = "KES") =>\n    `✅ Payment confirmed (${amount} ${currency}).\\n\\n${summary}\\n\\n⏱ ${reportProcessingTimeText()}`'
);

// 4) Add payment method keyboards
replaceOptional(
  "payment method keyboards",
  'function uploadContinueKeyboard() {\n  return Markup.inlineKeyboard([\n    [Markup.button.callback("✅ Done Uploading", "DONE_UPLOADING")],\n    [Markup.button.callback("❌ Cancel document", "TYPE_CANCEL")]\n  ]);\n}',
  'function uploadContinueKeyboard() {\n  return Markup.inlineKeyboard([\n    [Markup.button.callback("✅ Done Uploading", "DONE_UPLOADING")],\n    [Markup.button.callback("❌ Cancel document", "TYPE_CANCEL")]\n  ]);\n}\n\nfunction paymentMethodKeyboard() {\n  const rows = [\n    [Markup.button.callback("\\u{1F1F0}\\u{1F1EA} Kenya M-Pesa", "PAYMENT_METHOD_MPESA")]\n  ];\n\n  if (INTERNATIONAL_PAYMENT_ENABLED) {\n    rows.push([Markup.button.callback("\\u{1F30D} International Payment", "PAYMENT_METHOD_INTL")]);\n  }\n\n  rows.push([Markup.button.callback("❌ Cancel payment attempt", "PAYMENT_CANCEL")]);\n\n  return Markup.inlineKeyboard(rows);\n}\n\nfunction internationalPayKeyboard(checkoutUrl) {\n  return Markup.inlineKeyboard([\n    [Markup.button.url("\\u{1F30D} Pay Internationally", checkoutUrl)],\n    [Markup.button.callback("❌ Cancel payment attempt", "PAYMENT_CANCEL")]\n  ]);\n}'
);

// 5) Add IntaSend checkout helpers before intasendRequest
replaceOptional(
  "checkout helpers",
  'async function intasendRequest(endpoint, body) {',
  'function formatPaymentMoney(amount, currency) {\n  const n = Number(amount);\n  const clean = Number.isFinite(n)\n    ? (Number.isInteger(n) ? String(n) : n.toFixed(2))\n    : String(amount || "0");\n\n  return `${clean} ${currency || "KES"}`;\n}\n\nfunction calculateInternationalAmount(sub) {\n  const counts = getSubmissionCounts(sub);\n  const amount = counts.checks * INTERNATIONAL_CHECK_PRICE_USD;\n  return Number(amount.toFixed(2));\n}\n\nfunction isInternationalCheckOnly(sub) {\n  const counts = getSubmissionCounts(sub);\n  return counts.total > 0 && counts.checks === counts.total;\n}\n\nfunction extractCheckoutUrl(payload) {\n  return (\n    payload?.url ||\n    payload?.checkout_url ||\n    payload?.payment_link ||\n    payload?.data?.url ||\n    payload?.data?.checkout_url ||\n    payload?.data?.payment_link ||\n    payload?.checkout?.url ||\n    null\n  );\n}\n\nasync function intasendCheckoutRequest(endpoint, body) {\n  const checkoutToken = INTASEND_PUBLISHABLE_KEY || INTASEND_SECRET_KEY;\n\n  const res = await fetch(`${INTASEND_API_BASE}${endpoint}`, {\n    method: "POST",\n    headers: {\n      accept: "application/json",\n      "content-type": "application/json",\n      Authorization: `Bearer ${checkoutToken}`\n    },\n    body: JSON.stringify(body || {})\n  });\n\n  const text = await res.text();\n  let data;\n\n  try {\n    data = text ? JSON.parse(text) : {};\n  } catch {\n    data = { raw: text };\n  }\n\n  if (!res.ok) {\n    const err = new Error(\n      (data && (data.detail || data.message || JSON.stringify(data))) || `HTTP ${res.status}`\n    );\n    err.status = res.status;\n    err.payload = data;\n    throw err;\n  }\n\n  return data;\n}\n\nasync function intasendCreateCheckout({ amount, currency, api_ref, user }) {\n  return intasendCheckoutRequest("/checkout/", {\n    amount: String(amount),\n    currency,\n    api_ref,\n    first_name: safeText(user?.first_name || ""),\n    last_name: safeText(user?.last_name || ""),\n    comment: "JK Turnitin International Payment",\n    host: PUBLIC_BASE_URL,\n    redirect_url: PUBLIC_BASE_URL,\n    channel: "WEBSITE"\n  });\n}\n\nasync function intasendRequest(endpoint, body) {'
);

// 6) Replace moveBatchToPhoneStep with payment-method step plus M-Pesa step
mustReplaceRegex(
  "moveBatchToPhoneStep",
  /async function moveBatchToPhoneStep\(ctx, sub\) \{[\s\S]*?\n\}\n\nasync function finalizeFileTypeSelection/,
  'async function moveBatchToPaymentMethodStep(ctx, sub) {\n  const counts = getSubmissionCounts(sub);\n\n  if (counts.total === 0) {\n    await ctx.reply("❌ Please upload at least one file first.", { reply_markup: mainKeyboard() });\n    return;\n  }\n\n  sub.amount = calculateSubmissionAmount(sub);\n  sub.currency = "KES";\n  sub.batchId = sub.batchId || makeBatchId(ctx.from.id);\n  sub.stage = STAGE_WAIT_PAYMENT_METHOD;\n  sub.currentFileIndex = null;\n\n  const summary = formatBatchSummary(sub);\n  const internationalLine = INTERNATIONAL_PAYMENT_ENABLED\n    ? `\\n\\u{1F30D} International CHECK: *${formatPaymentMoney(calculateInternationalAmount(sub), INTERNATIONAL_CURRENCY)}*`\n    : "";\n\n  await replyMarkdownSafe(\n    ctx,\n    `📦 Batch summary\\n\\n${summary}\\n\\n\\u{1F1F0}\\u{1F1EA} Kenya M-Pesa: *${sub.amount} KES*${internationalLine}\\n\\nChoose payment method.`,\n    {\n      reply_markup: paymentMethodKeyboard().reply_markup\n    }\n  );\n}\n\nasync function moveBatchToPhoneStep(ctx, sub) {\n  sub.amount = calculateSubmissionAmount(sub);\n  sub.currency = "KES";\n  sub.batchId = sub.batchId || makeBatchId(ctx.from.id);\n  sub.stage = STAGE_WAIT_PHONE;\n  sub.paymentMethod = "MPESA";\n\n  const summary = formatBatchSummary(sub);\n\n  await replyMarkdownSafe(ctx, MESSAGES.askPhoneBatch(summary, sub.amount), {\n    reply_markup: mainKeyboard()\n  });\n}\n\nasync function finalizeFileTypeSelection'
);

// 7) Existing places that finished uploads should now ask payment method
code = code.replaceAll(
  "await moveBatchToPhoneStep(ctx, sub);",
  "await moveBatchToPaymentMethodStep(ctx, sub);"
);

// 8) Add international payment functions before STK PUSH
replaceOptional(
  "international payment functions",
  "// =====================\n// STK PUSH\n// =====================",
  'async function startInternationalPayment(ctx, sub) {\n  const userId = ctx.from.id;\n\n  if (!INTERNATIONAL_PAYMENT_ENABLED) {\n    await ctx.reply("\\u{1F30D} International payment is not available right now.", {\n      reply_markup: paymentMethodKeyboard().reply_markup\n    });\n    return;\n  }\n\n  if (!isInternationalCheckOnly(sub)) {\n    await ctx.reply(\n      "\\u{1F30D} International payment is currently available for CHECK only.\\n\\nPlease choose \\u{1F1F0}\\u{1F1EA} Kenya M-Pesa or contact support.",\n      { reply_markup: paymentMethodKeyboard().reply_markup }\n    );\n    return;\n  }\n\n  const apiRef = makePaymentAttemptRef(userId);\n  const summary = formatBatchSummary(sub);\n  const intlAmount = calculateInternationalAmount(sub);\n  const currency = INTERNATIONAL_CURRENCY;\n\n  putPaymentRef(apiRef, {\n    userId,\n    batchId: sub.batchId,\n    kind: `${getSubmissionCounts(sub).checks} INTERNATIONAL CHECK`,\n    amount: intlAmount,\n    currency,\n    createdAt: Date.now(),\n    updatedAt: Date.now(),\n    summary,\n    phone: null,\n    name: getUserFullName(ctx.from),\n    username: ctx.from.username || "N/A",\n    invoiceId: null,\n    status: "PENDING",\n    lastState: "PENDING",\n    mode: INTASEND_TEST ? "TEST" : "LIVE",\n    paymentMethod: "INTERNATIONAL",\n    pendingProof: null,\n    files: (sub.files || []).map((file) => ({\n      file_id: file.file_id || null,\n      file_unique_id: file.file_unique_id || null,\n      file_name: file.file_name || null,\n      type: file.type || null,\n      price: INTERNATIONAL_CHECK_PRICE_USD,\n      recheckEligible: Boolean(file.recheckEligible)\n    }))\n  });\n\n  try {\n    const checkout = await intasendCreateCheckout({\n      amount: intlAmount,\n      currency,\n      api_ref: apiRef,\n      user: ctx.from\n    });\n\n    const checkoutUrl = extractCheckoutUrl(checkout);\n\n    if (!checkoutUrl) {\n      throw new Error("Checkout link was not returned by IntaSend.");\n    }\n\n    sub.api_ref = apiRef;\n    sub.invoiceId = null;\n    sub.stage = STAGE_WAIT_PAYMENT;\n    sub.paymentMethod = "INTERNATIONAL";\n    sub.amount = intlAmount;\n    sub.currency = currency;\n    sub.paymentAttempts.push(apiRef);\n\n    updatePaymentRef(apiRef, {\n      checkoutUrl,\n      checkoutResponseAt: Date.now(),\n      rawResponseSnapshot: {\n        url: checkoutUrl,\n        api_ref: apiRef,\n        amount: intlAmount,\n        currency\n      }\n    });\n\n    await ctx.reply(\n      `\\u{1F30D} International payment\\n\\nAmount: *${formatPaymentMoney(intlAmount, currency)}*\\n\\nUse *${INTERNATIONAL_METHODS_TEXT}* only.\\nDo not use card payment if shown as unavailable.\\n\\nAfter paying, send payment proof here.`,\n      {\n        parse_mode: "Markdown",\n        reply_markup: internationalPayKeyboard(checkoutUrl).reply_markup\n      }\n    );\n  } catch (err) {\n    updatePaymentRef(apiRef, {\n      status: "FAILED_TO_CREATE_CHECKOUT",\n      failureSource: "international-checkout",\n      failureMessage: safeText(err?.message || err),\n      failureStatus: err?.status || null,\n      failurePayload: err?.payload || null\n    });\n\n    await ctx.reply(\n      "❌ International payment link could not be created right now.\\n\\nPlease choose \\u{1F1F0}\\u{1F1EA} Kenya M-Pesa or contact support.",\n      { reply_markup: paymentMethodKeyboard().reply_markup }\n    );\n\n    await sendAdminMessage(\n      `❌ International checkout error\\nUser ID: ${userId}\\nName: ${getUserFullName(ctx.from)}\\nUsername: @${safeText(\n        ctx.from.username || "N/A"\n      )}\\nAmount: ${formatPaymentMoney(intlAmount, currency)}\\nError: ${safeText(err?.message || err)}`,\n      { adminButtons: "replyOnly" }\n    );\n  }\n}\n\nasync function handleInternationalPaymentProofText(ctx, sub, text) {\n  const user = ctx.from;\n  const amount = formatPaymentMoney(sub.amount, sub.currency || INTERNATIONAL_CURRENCY);\n\n  await sendAdminMessage(\n    `\\u{1F30D} International payment proof received\\nUser ID: ${user.id}\\nName: ${getUserFullName(user)}\\nUsername: @${safeText(\n      user.username || "N/A"\n    )}\\n\\nExpected amount: ${amount}\\nMethod: ${INTERNATIONAL_METHODS_TEXT}\\n\\nMessage:\\n${safeText(text)}`,\n    { adminButtons: "paymentProof" }\n  );\n\n  await ctx.reply("✅ Payment proof received. Admin will verify.", {\n    reply_markup: paymentWaitKeyboard().reply_markup\n  });\n}\n\nasync function handleInternationalPaymentScreenshotProof(ctx, sub) {\n  const user = ctx.from;\n  const amount = formatPaymentMoney(sub.amount, sub.currency || INTERNATIONAL_CURRENCY);\n\n  await sendAdminMessage(\n    `\\u{1F30D} International payment screenshot received\\nUser ID: ${user.id}\\nName: ${getUserFullName(user)}\\nUsername: @${safeText(\n      user.username || "N/A"\n    )}\\n\\nExpected amount: ${amount}\\nMethod: ${INTERNATIONAL_METHODS_TEXT}`,\n    { adminButtons: "paymentProof" }\n  );\n\n  try {\n    await bot.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);\n  } catch {}\n\n  await ctx.reply("✅ Payment proof received. Admin will verify.", {\n    reply_markup: paymentWaitKeyboard().reply_markup\n  });\n}\n\n// =====================\n// STK PUSH\n// ====================='
);

// 9) Add payment method button handlers before STK controls
replaceOptional(
  "payment method actions",
  "// =====================\n// STK CONTROLS\n// =====================",
  '// =====================\n// PAYMENT METHOD SELECTION\n// =====================\nbot.action("PAYMENT_METHOD_MPESA", async (ctx) => {\n  const userId = ctx.from.id;\n  const sub = submissions[userId];\n\n  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);\n  if (!sub || sub.stage !== STAGE_WAIT_PAYMENT_METHOD) return ctx.answerCbQuery("No payment method needed.");\n\n  await ctx.answerCbQuery("Kenya M-Pesa selected");\n  await moveBatchToPhoneStep(ctx, sub);\n});\n\nbot.action("PAYMENT_METHOD_INTL", async (ctx) => {\n  const userId = ctx.from.id;\n  const sub = submissions[userId];\n\n  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);\n  if (!sub || sub.stage !== STAGE_WAIT_PAYMENT_METHOD) return ctx.answerCbQuery("No payment method needed.");\n\n  await ctx.answerCbQuery("International payment selected");\n  await startInternationalPayment(ctx, sub);\n});\n\n// =====================\n// STK CONTROLS\n// ====================='
);

// 10) Remove STK INITIATED admin debug card if present
replaceOptionalRegex(
  "remove STK initiated debug",
  /\n\s*await sendAdminMessage\(\n\s*`STK INITIATED[\s\S]*?\n\s*\);\n\n\s*await ctx\.reply\(MESSAGES\.stkSentWithTill\(\), \{/,
  '\n\n    await ctx.reply(MESSAGES.stkSentWithTill(), {'
);

// 11) Add currency to M-Pesa payment refs
replaceOptional(
  "mpesa currency",
  "    kind: getBatchKindLabel(sub),\n    amount: sub.amount,\n    createdAt: Date.now(),",
  "    kind: getBatchKindLabel(sub),\n    amount: sub.amount,\n    currency: \"KES\",\n    createdAt: Date.now(),"
);

// 12) Payment complete messages support currency
replaceOptional(
  "payment complete user currency",
  '      MESSAGES.paidMsgBatch(ref.amount, ref.summary || "Batch payment"),\n      { parse_mode: "Markdown" }',
  '      MESSAGES.paidMsgBatch(\n        ref.amount,\n        ref.summary || "Batch payment",\n        ref.currency || "KES"\n      ),\n      { parse_mode: "Markdown" }'
);

replaceOptional(
  "payment complete admin currency",
  '  await sendAdminMessage(\n    `✅ PAID\\nUser: ${userId}\\nName: ${safeText(ref.name || "N/A")}\\nUsername: @${safeText(\n      ref.username || "N/A"\n    )}\\nPhone: ${formatPhone254ForAdmin(ref.phone || sub?.phone)}\\nAmount: ${safeText(\n      ref.amount\n    )} KES\\nType: ${safeText(ref.kind || "BATCH")}\\nRef: ${safeText(\n      invoiceId || ref.invoiceId || apiRef || "N/A"\n    )}`,',
  '  await sendAdminMessage(\n    `✅ PAID\\nUser: ${userId}\\nName: ${safeText(ref.name || "N/A")}\\nUsername: @${safeText(\n      ref.username || "N/A"\n    )}\\nPhone: ${formatPhone254ForAdmin(ref.phone || sub?.phone)}\\nAmount: ${formatPaymentMoney(\n      ref.amount,\n      ref.currency || "KES"\n    )}\\nType: ${safeText(ref.kind || "BATCH")}\\nRef: ${safeText(\n      invoiceId || ref.invoiceId || apiRef || "N/A"\n    )}`,'
);

// 13) Route proof screenshots based on payment method
replaceOptional(
  "photo proof international",
  '  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {\n    await handlePaymentScreenshotProof(ctx, sub);\n    return;\n  }',
  '  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {\n    if (sub.paymentMethod === "INTERNATIONAL") {\n      await handleInternationalPaymentScreenshotProof(ctx, sub);\n    } else {\n      await handlePaymentScreenshotProof(ctx, sub);\n    }\n    return;\n  }'
);

// 14) Route proof text based on payment method and handle payment-method stage
replaceOptional(
  "text payment stages",
  '  if (sub && sub.stage === STAGE_WAIT_PHONE) {\n    const phone254 = normalizePhoneTo254(text);\n    if (!phone254) return ctx.reply("❌ Invalid phone. Use 07XXXXXXXX or 01XXXXXXXX.");\n\n    sub.phone = phone254;\n    await attemptStkPush(ctx, sub, { mode: "initial" });\n    return;\n  }\n\n  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {\n    await handleMpesaProofText(ctx, sub, text);\n    return;\n  }',
  '  if (sub && sub.stage === STAGE_WAIT_PAYMENT_METHOD) {\n    return ctx.reply("Choose payment method.", {\n      reply_markup: paymentMethodKeyboard().reply_markup\n    });\n  }\n\n  if (sub && sub.stage === STAGE_WAIT_PHONE) {\n    const phone254 = normalizePhoneTo254(text);\n    if (!phone254) return ctx.reply("❌ Invalid phone. Use 07XXXXXXXX or 01XXXXXXXX.");\n\n    sub.phone = phone254;\n    await attemptStkPush(ctx, sub, { mode: "initial" });\n    return;\n  }\n\n  if (sub && sub.stage === STAGE_WAIT_PAYMENT) {\n    if (sub.paymentMethod === "INTERNATIONAL") {\n      await handleInternationalPaymentProofText(ctx, sub, text);\n    } else {\n      await handleMpesaProofText(ctx, sub, text);\n    }\n    return;\n  }'
);

// 15) Document handler should block uploads while payment method is being chosen
replaceOptional(
  "document payment stage block",
  '  if (sub.stage === STAGE_WAIT_PHONE || sub.stage === STAGE_WAIT_PAYMENT) {\n    return ctx.reply("⚠️ Finish payment or cancel this payment attempt first.", {\n      parse_mode: "Markdown",\n      reply_markup: paymentWaitKeyboard().reply_markup\n    });\n  }',
  '  if (\n    sub.stage === STAGE_WAIT_PAYMENT_METHOD ||\n    sub.stage === STAGE_WAIT_PHONE ||\n    sub.stage === STAGE_WAIT_PAYMENT\n  ) {\n    return ctx.reply("⚠️ Finish payment or cancel this payment attempt first.", {\n      parse_mode: "Markdown",\n      reply_markup:\n        sub.stage === STAGE_WAIT_PAYMENT_METHOD\n          ? paymentMethodKeyboard().reply_markup\n          : paymentWaitKeyboard().reply_markup\n    });\n  }'
);

// 16) Include payment-method stage in active submission helper
replaceOptional(
  "active upload helper",
  'function hasActiveSubmissionForUploads(sub) {\n  return !!sub && [\n    STAGE_WAIT_UPLOADS,\n    STAGE_WAIT_FILE_TYPE,\n    STAGE_WAIT_PHONE,\n    STAGE_WAIT_PAYMENT\n  ].includes(sub.stage);\n}',
  'function hasActiveSubmissionForUploads(sub) {\n  return !!sub && [\n    STAGE_WAIT_UPLOADS,\n    STAGE_WAIT_FILE_TYPE,\n    STAGE_WAIT_PAYMENT_METHOD,\n    STAGE_WAIT_PHONE,\n    STAGE_WAIT_PAYMENT\n  ].includes(sub.stage);\n}'
);

// 17) Warning only when first file is uploaded directly; remove warning from next-file prompt
replaceOptional(
  "remove repeated next-file warning",
  '  await ctx.reply(\n    `✅ ${typeDisplayName(kind)} saved for file ${justCompletedNumber}.\\n\\n${CLEAN_COPY_WARNING}\\n\\nSend file ${sub.files.length + 1} of ${sub.expectedFiles}.`,\n    {\n      parse_mode: "Markdown",\n      reply_markup: uploadContinueKeyboard().reply_markup\n    }\n  );',
  '  await ctx.reply(\n    `✅ ${typeDisplayName(kind)} saved for file ${justCompletedNumber}.\\n\\nSend file ${sub.files.length + 1} of ${sub.expectedFiles}.`,\n    {\n      parse_mode: "Markdown",\n      reply_markup: uploadContinueKeyboard().reply_markup\n    }\n  );'
);

replaceOptional(
  "direct first-upload warning",
  '    await ctx.reply(\n      `📦 First document received.\\n\\nChoose number of files. This is file 1.`,\n      { parse_mode: "Markdown", reply_markup: batchSizeKeyboard().reply_markup }\n    );',
  '    await ctx.reply(\n      `📦 First document received.\\n\\n${CLEAN_COPY_WARNING}\\n\\nChoose number of files. This is file 1.`,\n      { parse_mode: "Markdown", reply_markup: batchSizeKeyboard().reply_markup }\n    );'
);

replaceOptional(
  "direct first-upload warning inline",
  '    await ctx.reply(`📦 First document received.\\n\\nChoose number of files. This is file 1.`, {\n      parse_mode: "Markdown",\n      reply_markup: batchSizeKeyboard().reply_markup\n    });',
  '    await ctx.reply(`📦 First document received.\\n\\n${CLEAN_COPY_WARNING}\\n\\nChoose number of files. This is file 1.`, {\n      parse_mode: "Markdown",\n      reply_markup: batchSizeKeyboard().reply_markup\n    });'
);

// 18) Health and startup logs
replaceOptional(
  "health international vars",
  '    discountPublicEnabled: DISCOUNT_PUBLIC_ENABLED,\n    inactiveStartUtc: INACTIVE_START_UTC,',
  '    discountPublicEnabled: DISCOUNT_PUBLIC_ENABLED,\n    internationalPaymentEnabled: INTERNATIONAL_PAYMENT_ENABLED,\n    internationalCheckPriceUsd: INTERNATIONAL_CHECK_PRICE_USD,\n    internationalCurrency: INTERNATIONAL_CURRENCY,\n    internationalMethodsText: INTERNATIONAL_METHODS_TEXT,\n    inactiveStartUtc: INACTIVE_START_UTC,'
);

replaceOptional(
  "startup international logs",
  '  console.log(`Discount public enabled: ${DISCOUNT_PUBLIC_ENABLED ? "YES" : "NO"}`);\n  console.log(`Payment polling: every ${STATUS_POLL_INTERVAL_MS / 1000}s, max ${STATUS_POLL_MAX_ATTEMPTS} attempts`);',
  '  console.log(`Discount public enabled: ${DISCOUNT_PUBLIC_ENABLED ? "YES" : "NO"}`);\n  console.log(`International payment enabled: ${INTERNATIONAL_PAYMENT_ENABLED ? "YES" : "NO"}`);\n  console.log(`International check price: ${INTERNATIONAL_CHECK_PRICE_USD} ${INTERNATIONAL_CURRENCY}`);\n  console.log(`Payment polling: every ${STATUS_POLL_INTERVAL_MS / 1000}s, max ${STATUS_POLL_MAX_ATTEMPTS} attempts`);'
);

if (code.includes("STK INITIATED")) {
  throw new Error("STK INITIATED debug message is still present.");
}

fs.writeFileSync(path, code, "utf8");
console.log("Updated bot.js successfully.");
