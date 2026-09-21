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

if (!code.includes('require("intasend-node")')) {
  replaceOnce(
    "add intasend-node require",
    'const qs = require("querystring");',
    'const qs = require("querystring");\n\nlet IntaSend = null;\ntry {\n  IntaSend = require("intasend-node");\n} catch {\n  IntaSend = null;\n}'
  );
} else {
  console.log("Skipped: intasend-node require already exists");
}

replaceOnce(
  "replace intasendCreateCheckout",
  `async function intasendCreateCheckout({ amount, currency, api_ref, user }) {
  return intasendCheckoutRequest("/checkout/", {
    amount: String(amount),
    currency,
    api_ref,
    first_name: safeText(user?.first_name || ""),
    last_name: safeText(user?.last_name || ""),
    comment: "JK Turnitin International Payment",
    host: PUBLIC_BASE_URL,
    redirect_url: PUBLIC_BASE_URL,
    channel: "WEBSITE"
  });
}`,
  `async function intasendCreateCheckout({ amount, currency, api_ref, user }) {
  if (!IntaSend) {
    throw new Error("intasend-node package missing. Run npm install intasend-node");
  }

  if (!INTASEND_PUBLISHABLE_KEY) {
    throw new Error("Missing IntaSend publishable key for checkout.");
  }

  const intasend = new IntaSend(
    INTASEND_PUBLISHABLE_KEY,
    INTASEND_SECRET_KEY,
    INTASEND_TEST
  );

  const collection = intasend.collection();

  return collection.charge({
    first_name: safeText(user?.first_name || ""),
    last_name: safeText(user?.last_name || ""),
    amount: Number(amount),
    currency,
    api_ref,
    comment: "JK Turnitin International Payment",
    host: PUBLIC_BASE_URL,
    redirect_url: PUBLIC_BASE_URL
  });
}`
);

fs.writeFileSync(path, code, "utf8");
console.log("bot.js patched successfully.");
