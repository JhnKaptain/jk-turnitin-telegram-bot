const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-max-batch-10", code, "utf8");

function replaceBetween(start, end, replacement) {
  const a = code.indexOf(start);
  if (a === -1) throw new Error("Start anchor not found: " + start);
  const b = code.indexOf(end, a);
  if (b === -1) throw new Error("End anchor not found: " + end);
  code = code.slice(0, a) + replacement + "\n\n" + code.slice(b);
}

code = code.replace(
  "const MAX_BATCH_FILES = 5;",
  "const MAX_BATCH_FILES = 10;"
);

replaceBetween(
  "function batchSizeKeyboard() {",
  "function typeInlineKeyboard(allowRecheck, allowResale, resaleVerified) {",
`function batchSizeKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("1", "BATCH_COUNT_1"),
      Markup.button.callback("2", "BATCH_COUNT_2"),
      Markup.button.callback("3", "BATCH_COUNT_3"),
      Markup.button.callback("4", "BATCH_COUNT_4"),
      Markup.button.callback("5", "BATCH_COUNT_5")
    ],
    [
      Markup.button.callback("6", "BATCH_COUNT_6"),
      Markup.button.callback("7", "BATCH_COUNT_7"),
      Markup.button.callback("8", "BATCH_COUNT_8"),
      Markup.button.callback("9", "BATCH_COUNT_9"),
      Markup.button.callback("10", "BATCH_COUNT_10")
    ],
    [Markup.button.callback("\\u274C Cancel document", "TYPE_CANCEL")]
  ]);
}`
);

code = code.replace(
  'bot.action(/^BATCH_COUNT_(\\d)$/, async (ctx) => {',
  'bot.action(/^BATCH_COUNT_(\\d{1,2})$/, async (ctx) => {'
);

fs.writeFileSync(path, code, "utf8");
console.log("Max batch files increased to 10 with two-line number buttons.");
