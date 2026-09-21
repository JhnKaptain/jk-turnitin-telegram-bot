const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function replaceOnce(label, oldText, newText) {
  if (!code.includes(oldText)) {
    throw new Error("Could not find: " + label);
  }
  code = code.replace(oldText, newText);
  console.log("Updated: " + label);
}

function replaceOptional(label, oldText, newText) {
  if (code.includes(oldText)) {
    code = code.replace(oldText, newText);
    console.log("Updated: " + label);
  } else {
    console.log("Skipped: " + label);
  }
}

function replaceRegex(label, regex, newText) {
  if (!regex.test(code)) {
    throw new Error("Could not find regex: " + label);
  }
  code = code.replace(regex, newText);
  console.log("Updated: " + label);
}

// 1) Add crypto
if (!code.includes('const crypto = require("crypto");')) {
  replaceOnce(
    "add crypto require",
    'const qs = require("querystring");',
    'const qs = require("querystring");\nconst crypto = require("crypto");'
  );
}

// 2) Add international email stage
replaceOptional(
  "add international email stage",
  'const STAGE_WAIT_PAYMENT_METHOD = "WAIT_PAYMENT_METHOD";\nconst STAGE_WAIT_PHONE = "WAIT_PHONE";',
  'const STAGE_WAIT_PAYMENT_METHOD = "WAIT_PAYMENT_METHOD";\nconst STAGE_WAIT_INTERNATIONAL_EMAIL = "WAIT_INTERNATIONAL_EMAIL";\nconst STAGE_WAIT_PHONE = "WAIT_PHONE";'
);

// 3) Add Paystack env variables
if (!code.includes('const PAYSTACK_ENABLED = readBoolEnv("PAYSTACK_ENABLED", false);')) {
  replaceOnce(
    "add paystack env variables",
    'const INTERNATIONAL_METHODS_TEXT = String(\n  process.env.INTERNATIONAL_METHODS_TEXT || "PayPal/PyUSD, ACH, or SEPA"\n).trim();',
    'const INTERNATIONAL_METHODS_TEXT = String(\n  process.env.INTERNATIONAL_METHODS_TEXT || "PayPal/PyUSD, ACH, or SEPA"\n).trim();\n\nconst INTERNATIONAL_GATEWAY = String(process.env.INTERNATIONAL_GATEWAY || "INTASEND")\n  .trim()\n  .toUpperCase();\n\nconst PAYSTACK_ENABLED = readBoolEnv("PAYSTACK_ENABLED", false);\nconst PAYSTACK_SECRET_KEY = String(process.env.PAYSTACK_SECRET_KEY || "").trim();\nconst PAYSTACK_PUBLIC_KEY = String(process.env.PAYSTACK_PUBLIC_KEY || "").trim();\nconst PAYSTACK_BASE_URL = "https://api.paystack.co";\nconst PAYSTACK_CHANNELS = String(process.env.PAYSTACK_CHANNELS || "card,apple_pay")\n  .split(",")\n  .map((item) => item.trim())\n  .filter(Boolean);\nconst PAYSTACK_EMAIL_DOMAIN = String(process.env.PAYSTACK_EMAIL_DOMAIN || "jkturnitin.local")\n  .replace(/[^a-zA-Z0-9.-]/g, "")\n  .trim() || "jkturnitin.local";'
  );
}

// 4) Add Paystack helpers
if (!code.includes("async function paystackRequest(endpoint")) {
  replaceOnce(
    "add paystack helpers",
    'function extractApiRef(payload) {',
    'function isPaystackInternationalGateway() {\n  return INTERNATIONAL_GATEWAY === "PAYSTACK" && PAYSTACK_ENABLED;\n}\n\nfunction normalizeEmail(value) {\n  const email = String(value || "").trim().toLowerCase();\n  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return "";\n  return email;\n}\n\nfunction fallbackPaystackEmail(userId) {\n  return `telegram_${userId}@${PAYSTACK_EMAIL_DOMAIN}`;\n}\n\nfunction paystackAmountSubunits(amount) {\n  const n = Number(amount);\n  if (!Number.isFinite(n) || n <= 0) return 0;\n  return Math.round(n * 100);\n}\n\nfunction normalizePaystackState(status) {\n  const s = String(status || "").trim().toLowerCase();\n  if (s === "success") return "COMPLETE";\n  if (["failed", "reversed"].includes(s)) return "FAILED";\n  if (["abandoned"].includes(s)) return "CANCELLED";\n  if (["pending", "ongoing"].includes(s)) return "PENDING";\n  return s.toUpperCase() || "UNKNOWN";\n}\n\nfunction extractPaystackCheckoutUrl(payload) {\n  return payload?.data?.authorization_url || payload?.authorization_url || null;\n}\n\nasync function paystackRequest(endpoint, { method = "GET", body = null } = {}) {\n  if (!PAYSTACK_SECRET_KEY) {\n    throw new Error("Missing PAYSTACK_SECRET_KEY.");\n  }\n\n  const res = await fetch(`${PAYSTACK_BASE_URL}${endpoint}`, {\n    method,\n    headers: {\n      authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,\n      "content-type": "application/json",\n      accept: "application/json"\n    },\n    body: body ? JSON.stringify(body) : undefined\n  });\n\n  const text = await res.text();\n  let data;\n\n  try {\n    data = text ? JSON.parse(text) : {};\n  } catch {\n    data = { raw: text };\n  }\n\n  if (!res.ok || data?.status === false) {\n    const err = new Error(data?.message || data?.raw || `Paystack HTTP ${res.status}`);\n    err.status = res.status;\n    err.payload = data;\n    throw err;\n  }\n\n  return data;\n}\n\nasync function paystackInitializeTransaction({ amount, currency, reference, user, email }) {\n  const cleanEmail = normalizeEmail(email) || fallbackPaystackEmail(user?.id || "user");\n  const amountSubunits = paystackAmountSubunits(amount);\n\n  if (!amountSubunits) throw new Error("Invalid Paystack amount.");\n\n  const body = {\n    email: cleanEmail,\n    amount: String(amountSubunits),\n    currency,\n    reference,\n    callback_url: `${PUBLIC_BASE_URL}/paystack/callback`,\n    metadata: {\n      user_id: user?.id || null,\n      telegram_name: getUserFullName(user),\n      username: user?.username || "N/A",\n      source: "telegram-bot",\n      service: "international-check"\n    }\n  };\n\n  if (PAYSTACK_CHANNELS.length > 0) body.channels = PAYSTACK_CHANNELS;\n\n  return paystackRequest("/transaction/initialize", {\n    method: "POST",\n    body\n  });\n}\n\nasync function paystackVerifyTransaction(reference) {\n  const resp = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);\n  const data = resp?.data || {};\n\n  return {\n    raw: resp,\n    invoiceId: data.id || data.reference || reference,\n    apiRef: data.reference || reference,\n    state: normalizePaystackState(data.status),\n    failedReason: data.gateway_response || data.message || null,\n    source: "paystack-verify"\n  };\n}\n\nfunction verifyPaystackWebhook(req) {\n  if (!PAYSTACK_SECRET_KEY) return false;\n  const signature = String(req.headers["x-paystack-signature"] || "").trim();\n  const raw = req.rawBody || JSON.stringify(req.body || {});\n  const computed = crypto\n    .createHmac("sha512", PAYSTACK_SECRET_KEY)\n    .update(raw)\n    .digest("hex");\n\n  return signature && computed === signature;\n}\n\nfunction extractApiRef(payload) {'
  );
}

// 5) Route status polling to Paystack when payment ref uses Paystack
if (!code.includes('const existingRefForGateway = apiRef ? getPaymentRef(apiRef) : null;')) {
  replaceOnce(
    "route status polling to Paystack",
    'async function queryPaymentStatus(invoiceId, apiRef) {\n  let best = null;',
    'async function queryPaymentStatus(invoiceId, apiRef) {\n  const existingRefForGateway = apiRef ? getPaymentRef(apiRef) : null;\n\n  if (existingRefForGateway?.paymentGateway === "PAYSTACK") {\n    return paystackVerifyTransaction(apiRef);\n  }\n\n  let best = null;'
  );
}

// 6) Replace international payment function
replaceRegex(
  "replace startInternationalPayment",
  /async function startInternationalPayment\(ctx, sub\) \{[\s\S]*?\n\}\n\nasync function handleInternationalPaymentProofText/,
  'async function startInternationalPayment(ctx, sub) {\n  const userId = ctx.from.id;\n\n  if (!INTERNATIONAL_PAYMENT_ENABLED) {\n    await ctx.reply("\\u{1F30D} International payment is not available right now.", {\n      reply_markup: paymentMethodKeyboard().reply_markup\n    });\n    return;\n  }\n\n  if (!isInternationalCheckOnly(sub)) {\n    await ctx.reply(\n      "\\u{1F30D} International payment is currently available for CHECK only.\\n\\nPlease choose \\u{1F1F0}\\u{1F1EA} Kenya M-Pesa or contact support.",\n      { reply_markup: paymentMethodKeyboard().reply_markup }\n    );\n    return;\n  }\n\n  const gateway = isPaystackInternationalGateway() ? "PAYSTACK" : "INTASEND";\n\n  if (gateway === "PAYSTACK" && !normalizeEmail(sub.internationalEmail)) {\n    sub.stage = STAGE_WAIT_INTERNATIONAL_EMAIL;\n    await ctx.reply("\\u{1F30D} Send email address for payment receipt.", {\n      reply_markup: paymentMethodKeyboard().reply_markup\n    });\n    return;\n  }\n\n  const apiRef = makePaymentAttemptRef(userId);\n  const summary = formatBatchSummary(sub);\n  const intlAmount = calculateInternationalAmount(sub);\n  const currency = INTERNATIONAL_CURRENCY;\n\n  putPaymentRef(apiRef, {\n    userId,\n    batchId: sub.batchId,\n    kind: `${getSubmissionCounts(sub).checks} INTERNATIONAL CHECK`,\n    amount: intlAmount,\n    currency,\n    createdAt: Date.now(),\n    updatedAt: Date.now(),\n    summary,\n    phone: null,\n    email: normalizeEmail(sub.internationalEmail) || null,\n    name: getUserFullName(ctx.from),\n    username: ctx.from.username || "N/A",\n    invoiceId: null,\n    status: "PENDING",\n    lastState: "PENDING",\n    mode: INTASEND_TEST ? "TEST" : "LIVE",\n    paymentMethod: "INTERNATIONAL",\n    paymentGateway: gateway,\n    pendingProof: null,\n    files: (sub.files || []).map((file) => ({\n      file_id: file.file_id || null,\n      file_unique_id: file.file_unique_id || null,\n      file_name: file.file_name || null,\n      type: file.type || null,\n      price: INTERNATIONAL_CHECK_PRICE_USD,\n      recheckEligible: Boolean(file.recheckEligible)\n    }))\n  });\n\n  try {\n    let checkout;\n    let checkoutUrl;\n    let invoiceId = null;\n\n    if (gateway === "PAYSTACK") {\n      checkout = await paystackInitializeTransaction({\n        amount: intlAmount,\n        currency,\n        reference: apiRef,\n        user: ctx.from,\n        email: sub.internationalEmail\n      });\n\n      checkoutUrl = extractPaystackCheckoutUrl(checkout);\n      invoiceId = checkout?.data?.access_code || null;\n    } else {\n      checkout = await intasendCreateCheckout({\n        amount: intlAmount,\n        currency,\n        api_ref: apiRef,\n        user: ctx.from\n      });\n\n      checkoutUrl = extractCheckoutUrl(checkout);\n      invoiceId = null;\n    }\n\n    if (!checkoutUrl) {\n      throw new Error(`${gateway} checkout link was not returned.`);\n    }\n\n    sub.api_ref = apiRef;\n    sub.invoiceId = invoiceId;\n    sub.stage = STAGE_WAIT_PAYMENT;\n    sub.paymentMethod = "INTERNATIONAL";\n    sub.paymentGateway = gateway;\n    sub.amount = intlAmount;\n    sub.currency = currency;\n    sub.paymentAttempts.push(apiRef);\n\n    updatePaymentRef(apiRef, {\n      checkoutUrl,\n      invoiceId,\n      checkoutResponseAt: Date.now(),\n      rawResponseSnapshot: {\n        url: checkoutUrl,\n        api_ref: apiRef,\n        amount: intlAmount,\n        currency,\n        gateway\n      }\n    });\n\n    if (gateway === "PAYSTACK") {\n      startStatusPolling({ userId, apiRef, invoiceId: null });\n    }\n\n    await ctx.reply(\n      `\\u{1F30D} International payment\\n\\nAmount: *${formatPaymentMoney(intlAmount, currency)}*\\n\\nUse the available checkout method.\\nAfter paying, send payment proof here.`,\n      {\n        parse_mode: "Markdown",\n        reply_markup: internationalPayKeyboard(checkoutUrl).reply_markup\n      }\n    );\n  } catch (err) {\n    updatePaymentRef(apiRef, {\n      status: "FAILED_TO_CREATE_CHECKOUT",\n      failureSource: `${gateway.toLowerCase()}-checkout`,\n      failureMessage: safeText(err?.message || err),\n      failureStatus: err?.status || null,\n      failurePayload: err?.payload || null\n    });\n\n    await ctx.reply(\n      "❌ International payment link could not be created right now.\\n\\nPlease choose \\u{1F1F0}\\u{1F1EA} Kenya M-Pesa or contact support.",\n      { reply_markup: paymentMethodKeyboard().reply_markup }\n    );\n\n    await sendAdminMessage(\n      `❌ International checkout error\\nGateway: ${gateway}\\nUser ID: ${userId}\\nName: ${getUserFullName(ctx.from)}\\nUsername: @${safeText(\n        ctx.from.username || "N/A"\n      )}\\nAmount: ${formatPaymentMoney(intlAmount, currency)}\\nError: ${safeText(err?.message || err)}`,\n      { adminButtons: "replyOnly" }\n    );\n  }\n}\n\nasync function handleInternationalPaymentProofText'
);

// 7) Add email handler
if (!code.includes("Invalid email address. Send a valid email.")) {
  replaceOnce(
    "add international email handler",
    '  if (sub && sub.stage === STAGE_WAIT_PAYMENT_METHOD) {\n    return ctx.reply("Choose payment method.", {\n      reply_markup: paymentMethodKeyboard().reply_markup\n    });\n  }',
    '  if (sub && sub.stage === STAGE_WAIT_INTERNATIONAL_EMAIL) {\n    const email = normalizeEmail(text);\n    if (!email) return ctx.reply("❌ Invalid email address. Send a valid email.");\n\n    sub.internationalEmail = email;\n    await startInternationalPayment(ctx, sub);\n    return;\n  }\n\n  if (sub && sub.stage === STAGE_WAIT_PAYMENT_METHOD) {\n    return ctx.reply("Choose payment method.", {\n      reply_markup: paymentMethodKeyboard().reply_markup\n    });\n  }'
  );
}

// 8) Block uploads while waiting for Paystack email
replaceOptional(
  "document stage block email",
  '    sub.stage === STAGE_WAIT_PAYMENT_METHOD ||\n    sub.stage === STAGE_WAIT_PHONE ||',
  '    sub.stage === STAGE_WAIT_PAYMENT_METHOD ||\n    sub.stage === STAGE_WAIT_INTERNATIONAL_EMAIL ||\n    sub.stage === STAGE_WAIT_PHONE ||'
);

replaceOptional(
  "active helper email stage",
  '    STAGE_WAIT_PAYMENT_METHOD,\n    STAGE_WAIT_PHONE,',
  '    STAGE_WAIT_PAYMENT_METHOD,\n    STAGE_WAIT_INTERNATIONAL_EMAIL,\n    STAGE_WAIT_PHONE,'
);

// 9) Add Paystack callback and webhook routes
const paystackRoutes =
'app.get("/paystack/callback", (req, res) => {\\n' +
'  res.status(200).send("Payment received. Return to Telegram.");\\n' +
'});\\n\\n' +
'app.post("/paystack/webhook", (req, res) => {\\n' +
'  if (!verifyPaystackWebhook(req)) {\\n' +
'    return res.status(401).send("Invalid signature");\\n' +
'  }\\n\\n' +
'  res.status(200).send("OK");\\n\\n' +
'  setImmediate(async () => {\\n' +
'    try {\\n' +
'      const payload = req.body || {};\\n' +
'      const event = String(payload.event || "");\\n' +
'      const data = payload.data || {};\\n' +
'      const reference = String(data.reference || "").trim();\\n\\n' +
'      if (!reference) return;\\n\\n' +
'      const ref = getPaymentRef(reference);\\n' +
'      if (!ref) {\\n' +
'        await sendAdminMessage(`⚠️ Paystack webhook unknown reference\\\\nRef: ${safeText(reference)}\\\\nEvent: ${safeText(event)}`);\\n' +
'        return;\\n' +
'      }\\n\\n' +
'      updatePaymentRef(reference, {\\n' +
'        lastWebhookAt: Date.now(),\\n' +
'        lastState: normalizePaystackState(data.status),\\n' +
'        invoiceId: data.id || ref.invoiceId || null\\n' +
'      });\\n\\n' +
'      if (event === "charge.success" || normalizePaystackState(data.status) === "COMPLETE") {\\n' +
'        const verified = await paystackVerifyTransaction(reference);\\n\\n' +
'        if (verified.state === "COMPLETE") {\\n' +
'          await markPaymentComplete({\\n' +
'            apiRef: reference,\\n' +
'            invoiceId: verified.invoiceId || data.id || null,\\n' +
'            state: "COMPLETE",\\n' +
'            source: "paystack-webhook"\\n' +
'          });\\n' +
'        }\\n' +
'      }\\n' +
'    } catch (err) {\\n' +
'      console.error("Paystack webhook processing error:", err?.message || err);\\n' +
'    }\\n' +
'  });\\n' +
'});\\n\\n';

if (!code.includes('app.get("/paystack/callback"')) {
  if (code.includes('app.get("/intasend/webhook"')) {
    code = code.replace('app.get("/intasend/webhook"', paystackRoutes + 'app.get("/intasend/webhook"');
    console.log("Updated: add Paystack routes before IntaSend GET webhook");
  } else if (code.includes('app.post("/intasend/webhook"')) {
    code = code.replace('app.post("/intasend/webhook"', paystackRoutes + 'app.post("/intasend/webhook"');
    console.log("Updated: add Paystack routes before IntaSend POST webhook");
  } else {
    throw new Error("Could not find IntaSend webhook anchor for Paystack routes.");
  }
}

// 10) Startup logs
replaceOptional(
  "startup paystack logs",
  '  console.log(`International payment enabled: ${INTERNATIONAL_PAYMENT_ENABLED ? "YES" : "NO"}`);\n  console.log(`International check price: ${INTERNATIONAL_CHECK_PRICE_USD} ${INTERNATIONAL_CURRENCY}`);',
  '  console.log(`International payment enabled: ${INTERNATIONAL_PAYMENT_ENABLED ? "YES" : "NO"}`);\n  console.log(`International gateway: ${INTERNATIONAL_GATEWAY}`);\n  console.log(`Paystack enabled: ${PAYSTACK_ENABLED ? "YES" : "NO"}`);\n  console.log(`Paystack channels: ${PAYSTACK_CHANNELS.join(",") || "default"}`);\n  console.log(`International check price: ${INTERNATIONAL_CHECK_PRICE_USD} ${INTERNATIONAL_CURRENCY}`);'
);

// 11) Fix any double escaped unicode from older patch attempts
code = code.replace(/\\\\u\{/g, "\\u{");

// 12) Update AI unavailable note
const newAiNote =
  "ℹ️ AI Writing Report Unavailable\\n\\n" +
  "Turnitin AI report may not show if the file:\\n" +
  "• Has fewer than 300 words of essay/prose content\\n" +
  "• Has over 30,000 words of essay/prose content\\n" +
  "• Is not in English, Spanish, or Japanese\\n" +
  "• Is not .docx, .pdf, .txt, or .rtf\\n\\n" +
  "If unavailable, only the similarity report may be provided.";

const aiPatterns = [
  /AI writing detection is unavailable for this submission\.[\s\S]*?more than 30,000 words/g,
  /ℹ️ AI Writing Report Unavailable[\s\S]*?only the similarity report may be provided\./g,
  /ℹ️ AI writing detection is unavailable for this submission\.[\s\S]*?more than 30,000 words/g
];

let aiChanged = false;
for (const pattern of aiPatterns) {
  if (pattern.test(code)) {
    code = code.replace(pattern, newAiNote);
    aiChanged = true;
    console.log("Updated: AI unavailable note");
    break;
  }
}

if (!aiChanged) {
  console.log("WARNING: AI unavailable note was not found. Paystack changes still applied.");
}

fs.writeFileSync(path, code, "utf8");
console.log("Combined Paystack + AI note patch applied successfully.");
