const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-payment-description-wording", code, "utf8");

const oldMainBlock = String.raw`    "If asked, choose *Send to Another Bank* > *Co-operative Bank*.",
    "",
    "\u26A0\uFE0F Enter BOTH the account number and the *Reference Number* shown on the checkout page.",
    "The *Reference Number* is important for automatic confirmation.",`;

const newMainBlock = String.raw`    "If asked, choose *Send to Another Bank* > *Co-operative Bank*.",
    "",
    "\u26A0\uFE0F Enter BOTH the *Account Number* and the *Reference Number* shown on the checkout page.",
    "Put the *Reference Number* in *Payment Description*.",`;

if (!code.includes(oldMainBlock)) {
  throw new Error("Main PesaLink wording block not found.");
}

code = code.replace(oldMainBlock, newMainBlock);

code = code.replace(
  '"Account: *" + safeText(INTERNATIONAL_BANK_ACCOUNT_NUMBER) + "*",',
  '"*Account Number:* *" + safeText(INTERNATIONAL_BANK_ACCOUNT_NUMBER) + "*",'
);

code = code.replace(
  '"Reference: *" + safeText(apiRef) + "*",',
  '"*Payment Description:* *" + safeText(apiRef) + "*",'
);

fs.writeFileSync(path, code, "utf8");
console.log("Payment Description wording updated successfully.");
