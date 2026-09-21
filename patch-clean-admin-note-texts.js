const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-clean-admin-note-texts", code, "utf8");

const aiStarNote = `const AI_STAR_NOTE =
  \`⭐ *AI Report Asterisk*

An asterisk (\\\\*%) appears when AI detection is below *20%*.

At *1–19%*, Turnitin may not show the exact percentage or AI highlights because results are less reliable.

To get highlights for revision, add AI content at the end of the file to boost detection to at least *20%*, then request a *paid recheck*.

The revised file must be submitted again. *All submissions are paid for.*\`;`;

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
  ].join("\\\\n");
}`;

const aiStarRegex = /const AI_STAR_NOTE =\s*`[\s\S]*?`;/;

if (!aiStarRegex.test(code)) {
  throw new Error("AI_STAR_NOTE block not found.");
}
code = code.replace(aiStarRegex, aiStarNote);

const tillFnRegex = /function mpesaTillNoticeMessage\(\) \{[\s\S]*?\n\}/;

if (!tillFnRegex.test(code)) {
  throw new Error("mpesaTillNoticeMessage function not found.");
}
code = code.replace(tillFnRegex, tillNoticeFunction);

code = code.replace(
  /await bot\.telegram\.sendMessage\(userId,\s*AI_STAR_NOTE\s*\);/g,
  'await bot.telegram.sendMessage(userId, AI_STAR_NOTE, { parse_mode: "Markdown" });'
);

code = code.replace(
  /await bot\.telegram\.sendMessage\(userId,\s*mpesaTillNoticeMessage\(\)\s*\);/g,
  'await bot.telegram.sendMessage(userId, mpesaTillNoticeMessage(), { parse_mode: "Markdown" });'
);

fs.writeFileSync(path, code, "utf8");
console.log("Cleaned AI star and Till payment notice texts.");
