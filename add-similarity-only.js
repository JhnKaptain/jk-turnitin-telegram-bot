const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-similarity-only", code, "utf8");

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

function insertAfter(label, anchor, addition) {
  if (code.includes(addition.trim())) {
    console.log("Skipped: " + label);
    return;
  }
  if (!code.includes(anchor)) {
    throw new Error("Could not find anchor: " + label);
  }
  code = code.replace(anchor, anchor + addition);
  console.log("Updated: " + label);
}

// 1) Add Similarity Only local price variables
insertAfter(
  "similarity only KES env",
  'const RECHECK_PRICE_KES = readIntEnv("RECHECK_PRICE_KES", 130);\n',
  'const SIMILARITY_ONLY_ENABLED = readBoolEnv("SIMILARITY_ONLY_ENABLED", true);\nconst SIMILARITY_ONLY_PRICE_KES = readIntEnv("SIMILARITY_ONLY_PRICE_KES", 100);\n'
);

// 2) Add Similarity Only international price variable
insertAfter(
  "similarity only international env",
  'const INTERNATIONAL_CHECK_PRICE_USD = readFloatEnv("INTERNATIONAL_CHECK_PRICE_USD", 2);\n',
  'const INTERNATIONAL_SIMILARITY_ONLY_PRICE = readFloatEnv(\n  "INTERNATIONAL_SIMILARITY_ONLY_PRICE",\n  INTERNATIONAL_CHECK_PRICE_USD\n);\n'
);

// 3) Add Similarity Only to welcome pricing
replaceOptional(
  "welcome similarity price",
  '• Recheck: ${recheck} KES${RESALE_ENABLED ? `\\n• ${RESALE_LABEL_TITLE}: ${resalePublicPriceText()}` : ""}',
  '• Recheck: ${recheck} KES${SIMILARITY_ONLY_ENABLED ? `\\n• Similarity Report Only: ${SIMILARITY_ONLY_PRICE_KES} KES` : ""}${RESALE_ENABLED ? `\\n• ${RESALE_LABEL_TITLE}: ${resalePublicPriceText()}` : ""}'
);

// 4) Type display name
replaceRegex(
  "typeDisplayName",
  /function typeDisplayName\(kind\) \{[\s\S]*?\n\}/,
  [
    'function typeDisplayName(kind) {',
    '  if (kind === "SIMILARITY") return "Similarity Report Only";',
    '  if (kind === "RESALE") return RESALE_LABEL_TITLE;',
    '  return kind;',
    '}'
  ].join("\n")
);

// 5) Counts now include SIMILARITY
replaceRegex(
  "getSubmissionCounts",
  /function getSubmissionCounts\(sub\) \{[\s\S]*?\n\}/,
  [
    'function getSubmissionCounts(sub) {',
    '  let checks = 0;',
    '  let rechecks = 0;',
    '  let similarities = 0;',
    '  let resales = 0;',
    '',
    '  for (const file of sub.files || []) {',
    '    if (file.type === "CHECK") checks += 1;',
    '    if (file.type === "RECHECK") rechecks += 1;',
    '    if (file.type === "SIMILARITY") similarities += 1;',
    '    if (file.type === "RESALE") resales += 1;',
    '  }',
    '',
    '  return { checks, rechecks, similarities, resales, total: checks + rechecks + similarities + resales };',
    '}'
  ].join("\n")
);

// 6) Local M-Pesa amount includes SIMILARITY
replaceRegex(
  "calculateSubmissionAmount",
  /function calculateSubmissionAmount\(sub\) \{[\s\S]*?\n\}/,
  [
    'function calculateSubmissionAmount(sub) {',
    '  const counts = getSubmissionCounts(sub);',
    '  return (',
    '    counts.checks * CHECK_PRICE_KES +',
    '    counts.rechecks * RECHECK_PRICE_KES +',
    '    counts.similarities * SIMILARITY_ONLY_PRICE_KES +',
    '    counts.resales * RESALE_PRICE_KES',
    '  );',
    '}'
  ].join("\n")
);

// 7) Batch summary includes SIMILARITY
replaceRegex(
  "formatBatchSummary",
  /function formatBatchSummary\(sub\) \{[\s\S]*?\n\}/,
  [
    'function formatBatchSummary(sub) {',
    '  const counts = getSubmissionCounts(sub);',
    '  const lines = [`• Check: ${counts.checks}`, `• Recheck: ${counts.rechecks}`];',
    '',
    '  if (SIMILARITY_ONLY_ENABLED || counts.similarities > 0) {',
    '    lines.push(`• Similarity Only: ${counts.similarities}`);',
    '  }',
    '',
    '  if (RESALE_ENABLED || counts.resales > 0) lines.push(`• ${RESALE_LABEL_TITLE}: ${counts.resales}`);',
    '  lines.push(`• Files: ${counts.total}`);',
    '',
    '  return lines.join("\\n");',
    '}'
  ].join("\n")
);

// 8) Payment kind includes SIMILARITY
replaceRegex(
  "getBatchKindLabel",
  /function getBatchKindLabel\(sub\) \{[\s\S]*?\n\}/,
  [
    'function getBatchKindLabel(sub) {',
    '  const counts = getSubmissionCounts(sub);',
    '  return `${counts.checks} CHECK, ${counts.rechecks} RECHECK, ${counts.similarities} SIMILARITY, ${counts.resales} ${RESALE_LABEL}`;',
    '}'
  ].join("\n")
);

// 9) Always show Similarity Report Only button
replaceRegex(
  "typeInlineKeyboard",
  /function typeInlineKeyboard\(allowRecheck, allowResale, resaleVerified\) \{[\s\S]*?\n\}/,
  [
    'function typeInlineKeyboard(allowRecheck, allowResale, resaleVerified) {',
    '  const rows = [];',
    '',
    '  if (allowRecheck) {',
    '    rows.push([Markup.button.callback(`\\u{1F501} CLICK TO RECHECK (${RECHECK_PRICE_KES} KES)`, "TYPE_RECHECK")]);',
    '  } else {',
    '    rows.push([Markup.button.callback(`\\u2705 CLICK TO CHECK (${CHECK_PRICE_KES} KES)`, "TYPE_CHECK")]);',
    '  }',
    '',
    '  if (SIMILARITY_ONLY_ENABLED) {',
    '    rows.push([Markup.button.callback(`\\u{1F4CA} SIMILARITY REPORT ONLY (${SIMILARITY_ONLY_PRICE_KES} KES)`, "TYPE_SIMILARITY")]);',
    '  }',
    '',
    '  if (allowResale) rows.push([Markup.button.callback(resaleButtonLabel(resaleVerified), "TYPE_RESALE")]);',
    '',
    '  rows.push([Markup.button.callback("\\u274C Cancel document", "TYPE_CANCEL")]);',
    '  return Markup.inlineKeyboard(rows);',
    '}'
  ].join("\n")
);

// 10) File type note mentions Similarity Only
replaceOptional(
  "file type similarity hint",
  '  const recheckNote = file.recheckEligible\n    ? `✅ This file qualifies for *RECHECK*.\\n\\nTap *CLICK TO RECHECK* to continue.`\n    : `ℹ️ Recheck not available for this file.\\n\\nTap *CLICK TO CHECK* to continue.`;',
  [
    '  const similarityHint = SIMILARITY_ONLY_ENABLED',
    '    ? `\\n\\n\\u{1F4CA} You can also choose *SIMILARITY REPORT ONLY* if you do not need AI report.`',
    '    : "";',
    '',
    '  const recheckNote = file.recheckEligible',
    '    ? `✅ This file qualifies for *RECHECK*.\\n\\nTap *CLICK TO RECHECK* to continue.${similarityHint}`',
    '    : `ℹ️ Recheck not available for this file.\\n\\nTap *CLICK TO CHECK* to continue.${similarityHint}`;'
  ].join("\n")
);

// 11) Set Similarity Only price on selected file
insertAfter(
  "similarity file price",
  '  if (kind === "RECHECK") file.price = RECHECK_PRICE_KES;\n',
  '  if (kind === "SIMILARITY") file.price = SIMILARITY_ONLY_PRICE_KES;\n'
);

// 12) Add callback action for Similarity Only
if (!code.includes('bot.action("TYPE_SIMILARITY"')) {
  insertAfter(
    "similarity action",
    'bot.action("TYPE_RECHECK", async (ctx) => {\n  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);\n  await handleFileTypeSelected(ctx, "RECHECK");\n});\n',
    '\nbot.action("TYPE_SIMILARITY", async (ctx) => {\n  if (isBotInactivePeriod()) return notifyInactivePeriod(ctx);\n  if (!SIMILARITY_ONLY_ENABLED) return ctx.answerCbQuery("Similarity Only is not enabled.");\n  await handleFileTypeSelected(ctx, "SIMILARITY");\n});\n'
  );
}

// 13) International amount supports CHECK, RECHECK, and SIMILARITY
replaceRegex(
  "international amount and eligibility",
  /function calculateInternationalAmount\(sub\) \{[\s\S]*?\n\}\n\nfunction isInternationalCheckOnly\(sub\) \{[\s\S]*?\n\}\n\nfunction extractCheckoutUrl\(payload\) \{/,
  [
    'function calculateInternationalAmount(sub) {',
    '  const counts = getSubmissionCounts(sub);',
    '  const amount =',
    '    (counts.checks + counts.rechecks) * INTERNATIONAL_CHECK_PRICE_USD +',
    '    counts.similarities * INTERNATIONAL_SIMILARITY_ONLY_PRICE;',
    '',
    '  return Number(amount.toFixed(2));',
    '}',
    '',
    'function isInternationalCheckOnly(sub) {',
    '  const counts = getSubmissionCounts(sub);',
    '  const billableFiles = counts.checks + counts.rechecks + counts.similarities;',
    '  return counts.total > 0 && billableFiles === counts.total && counts.resales === 0;',
    '}',
    '',
    'function extractCheckoutUrl(payload) {'
  ].join("\n")
);

// 14) Better international blocked message
replaceOptional(
  "international blocked message",
  '"\\u{1F30D} International payment is currently available for CHECK only.\\n\\nPlease choose \\u{1F1F0}\\u{1F1EA} Kenya M-Pesa or contact support.",',
  '"\\u{1F30D} International payment is available for CHECK, RECHECK, or Similarity Report Only.\\n\\nDiscount/resale files should use Kenya M-Pesa or contact support.",'
);

// 15) International summary label
replaceOptional(
  "international summary label",
  "International CHECK/RECHECK: *",
  "International: *"
);

// 16) International payment kind includes SIMILARITY
replaceOptional(
  "international payment kind",
  'kind: `${getSubmissionCounts(sub).checks + getSubmissionCounts(sub).rechecks} INTERNATIONAL CHECK/RECHECK`,',
  'kind: `${getSubmissionCounts(sub).checks + getSubmissionCounts(sub).rechecks + getSubmissionCounts(sub).similarities} INTERNATIONAL REPORT`,'
);

// 17) International stored file price separates Similarity Only
replaceOptional(
  "international file price",
  '      price: INTERNATIONAL_CHECK_PRICE_USD,\n      recheckEligible: Boolean(file.recheckEligible)',
  '      price: file.type === "SIMILARITY" ? INTERNATIONAL_SIMILARITY_ONLY_PRICE : INTERNATIONAL_CHECK_PRICE_USD,\n      recheckEligible: Boolean(file.recheckEligible)'
);

// 18) Daily sales counts include SIMILARITY
replaceOptional(
  "countTypes file similarity",
  '      else if (t === "RECHECK") counts.rechecks += 1;\n      else if (t === "RESALE") counts.resales += 1;',
  '      else if (t === "RECHECK") counts.rechecks += 1;\n      else if (t === "SIMILARITY") counts.similarities += 1;\n      else if (t === "RESALE") counts.resales += 1;'
);

replaceOptional(
  "countTypes fallback similarity match",
  '  const recheckMatch = kind.match(/(\\d+)\\s*RECHECK\\b/);\n\n  let resaleMatch = null;',
  '  const recheckMatch = kind.match(/(\\d+)\\s*RECHECK\\b/);\n  const similarityMatch = kind.match(/(\\d+)\\s*SIMILARITY\\b/i);\n\n  let resaleMatch = null;'
);

replaceOptional(
  "countTypes fallback similarity add",
  '  if (recheckMatch) counts.rechecks += Number(recheckMatch[1] || 0);\n  if (resaleMatch) counts.resales += Number(resaleMatch[1] || 0);',
  '  if (recheckMatch) counts.rechecks += Number(recheckMatch[1] || 0);\n  if (similarityMatch) counts.similarities += Number(similarityMatch[1] || 0);\n  if (resaleMatch) counts.resales += Number(resaleMatch[1] || 0);'
);

code = code.replace(
  /const counts = \{ checks: 0, rechecks: 0, resales: 0 \};/g,
  'const counts = { checks: 0, rechecks: 0, similarities: 0, resales: 0 };'
);

replaceOptional(
  "daily summary counts object",
  '    checks: 0,\n    rechecks: 0,\n    resales: 0',
  '    checks: 0,\n    rechecks: 0,\n    similarities: 0,\n    resales: 0'
);

replaceOptional(
  "ledger record similarities",
  '    rechecks: typeCounts.rechecks,\n    resales: typeCounts.resales,',
  '    rechecks: typeCounts.rechecks,\n    similarities: typeCounts.similarities,\n    resales: typeCounts.resales,'
);

replaceOptional(
  "daily summary record similarities",
  '    counts.rechecks += Number(record?.rechecks || 0) || 0;\n    counts.resales += Number(record?.resales || 0) || 0;',
  '    counts.rechecks += Number(record?.rechecks || 0) || 0;\n    counts.similarities += Number(record?.similarities || 0) || 0;\n    counts.resales += Number(record?.resales || 0) || 0;'
);

replaceOptional(
  "daily summary ref similarities",
  '    counts.rechecks += typeCounts.rechecks;\n    counts.resales += typeCounts.resales;',
  '    counts.rechecks += typeCounts.rechecks;\n    counts.similarities += typeCounts.similarities;\n    counts.resales += typeCounts.resales;'
);

replaceOptional(
  "daily summary text similarities",
  '    `RECHECK: ${summary.rechecks}\\n` +\n    `${RESALE_LABEL}: ${summary.resales}`;',
  '    `RECHECK: ${summary.rechecks}\\n` +\n    `SIMILARITY ONLY: ${summary.similarities}\\n` +\n    `${RESALE_LABEL}: ${summary.resales}`;'
);

// 19) Health endpoint
replaceOptional(
  "health similarity local vars",
  '    recheckPriceKes: RECHECK_PRICE_KES,\n    resaleEnabled: RESALE_ENABLED,',
  '    recheckPriceKes: RECHECK_PRICE_KES,\n    similarityOnlyEnabled: SIMILARITY_ONLY_ENABLED,\n    similarityOnlyPriceKes: SIMILARITY_ONLY_PRICE_KES,\n    resaleEnabled: RESALE_ENABLED,'
);

replaceOptional(
  "health similarity international var",
  '    internationalCheckPriceUsd: INTERNATIONAL_CHECK_PRICE_USD,\n    internationalCurrency: INTERNATIONAL_CURRENCY,',
  '    internationalCheckPriceUsd: INTERNATIONAL_CHECK_PRICE_USD,\n    internationalSimilarityOnlyPrice: INTERNATIONAL_SIMILARITY_ONLY_PRICE,\n    internationalCurrency: INTERNATIONAL_CURRENCY,'
);

// 20) Startup logs
replaceOptional(
  "startup price log",
  '  console.log(`Prices: CHECK=${CHECK_PRICE_KES}, RECHECK=${RECHECK_PRICE_KES}, ${RESALE_LABEL}=${RESALE_PRICE_KES}`);',
  '  console.log(`Prices: CHECK=${CHECK_PRICE_KES}, RECHECK=${RECHECK_PRICE_KES}, SIMILARITY=${SIMILARITY_ONLY_PRICE_KES}, ${RESALE_LABEL}=${RESALE_PRICE_KES}`);'
);

replaceOptional(
  "startup international similarity log",
  '  console.log(`International check price: ${INTERNATIONAL_CHECK_PRICE_USD} ${INTERNATIONAL_CURRENCY}`);',
  '  console.log(`International check/recheck price: ${INTERNATIONAL_CHECK_PRICE_USD} ${INTERNATIONAL_CURRENCY}`);\n  console.log(`International similarity only price: ${INTERNATIONAL_SIMILARITY_ONLY_PRICE} ${INTERNATIONAL_CURRENCY}`);'
);

// 21) Safety checks
if (!code.includes('TYPE_SIMILARITY')) throw new Error("TYPE_SIMILARITY was not added.");
if (!code.includes('SIMILARITY_ONLY_PRICE_KES')) throw new Error("SIMILARITY_ONLY_PRICE_KES was not added.");
if (!code.includes('INTERNATIONAL_SIMILARITY_ONLY_PRICE')) throw new Error("INTERNATIONAL_SIMILARITY_ONLY_PRICE was not added.");

fs.writeFileSync(path, code, "utf8");
console.log("Similarity Report Only feature added successfully.");
