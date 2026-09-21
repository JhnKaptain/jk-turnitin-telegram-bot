const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-remove-generate-line", code, "utf8");

code = code.replace(
  '  const instruction = adminReportInstruction(file?.type);\n',
  ''
);

code = code.replace(
  '    "Service: " + service,\n    instruction,\n    "Price: " + price,',
  '    "Service: " + service,\n    "Price: " + price,'
);

fs.writeFileSync(path, code, "utf8");
console.log("Removed Generate line from admin document card.");
