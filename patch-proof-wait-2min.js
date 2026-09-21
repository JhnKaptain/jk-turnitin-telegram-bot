const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-proof-wait-2min", code, "utf8");

code = code.replace(
  'readIntEnv("TZ_OTHER_PROOF_WAIT_MINUTES", 3)',
  'readIntEnv("TZ_OTHER_PROOF_WAIT_MINUTES", 2)'
);

code = code.replaceAll(
  "within 3 minutes",
  "within 2 minutes"
);

code = code.replaceAll(
  "up to *3 minutes*",
  "up to *2 minutes*"
);

fs.writeFileSync(path, code, "utf8");
console.log("Proof wait changed to 2 minutes.");
