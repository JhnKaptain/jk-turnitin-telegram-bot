const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-auto-confirm-wording", code, "utf8");

const oldText = "After paying, send payment proof here.";
const newText =
  "After paying, return to Telegram.\\n" +
  "The bot will confirm automatically.\\n\\n" +
  "If it does not confirm within 2 minutes, send payment proof here.";

if (!code.includes(oldText)) {
  throw new Error("Old international proof wording not found.");
}

code = code.replaceAll(oldText, newText);

fs.writeFileSync(path, code, "utf8");
console.log("International payment wording updated.");
