const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-international-recheck", code, "utf8");

function replaceRegex(label, regex, replacement) {
  if (!regex.test(code)) {
    throw new Error("Could not find: " + label);
  }
  code = code.replace(regex, replacement);
  console.log("Updated: " + label);
}

// 1) International amount now counts CHECK + RECHECK files.
// RESALE/DISCOUNT is still not allowed for international.
replaceRegex(
  "international amount and eligibility",
  /function calculateInternationalAmount\(sub\) \{[\s\S]*?\n\}\n\nfunction isInternationalCheckOnly\(sub\) \{[\s\S]*?\n\}\n\nfunction extractCheckoutUrl\(payload\) \{/,
  `function calculateInternationalAmount(sub) {
  const counts = getSubmissionCounts(sub);
  const billableFiles = counts.checks + counts.rechecks;
  const amount = billableFiles * INTERNATIONAL_CHECK_PRICE_USD;
  return Number(amount.toFixed(2));
}

function isInternationalCheckOnly(sub) {
  const counts = getSubmissionCounts(sub);
  const billableFiles = counts.checks + counts.rechecks;
  return counts.total > 0 && billableFiles === counts.total && counts.resales === 0;
}

function extractCheckoutUrl(payload) {`
);

// 2) Change international blocked message from CHECK-only to CHECK/RECHECK-only.
code = code.replace(
  /International payment is currently available for CHECK only\\n\\nPlease choose [^"]*Kenya M-Pesa or contact support\./g,
  "International payment is available for CHECK/RECHECK only.\\n\\nDiscount/resale files should use Kenya M-Pesa or contact support."
);

// 3) Change batch summary label.
code = code.replace(/International CHECK:\s*\*/g, "International CHECK/RECHECK: *");

// 4) Store correct international payment kind for admin/history.
code = code.replace(
  /kind: `\$\{getSubmissionCounts\(sub\)\.checks\} INTERNATIONAL CHECK`,/g,
  "kind: `${getSubmissionCounts(sub).checks + getSubmissionCounts(sub).rechecks} INTERNATIONAL CHECK/RECHECK`,"
);

// 5) Safety checks.
if (/counts\.checks\s*\*\s*INTERNATIONAL_CHECK_PRICE_USD/.test(code)) {
  throw new Error("Old international amount logic still found.");
}

if (/counts\.checks\s*===\s*counts\.total/.test(code)) {
  throw new Error("Old international CHECK-only eligibility still found.");
}

fs.writeFileSync(path, code, "utf8");
console.log("International CHECK/RECHECK fixed-rate payment updated successfully.");
