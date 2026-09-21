const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-fix-till-notice-newlines", code, "utf8");

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

if (!tillFnRegex.test(code)) {
  throw new Error("mpesaTillNoticeMessage function not found.");
}

code = code.replace(tillFnRegex, tillNoticeFunction);

fs.writeFileSync(path, code, "utf8");
console.log("Fixed Till notice newlines.");
