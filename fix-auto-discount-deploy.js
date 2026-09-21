const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-fix-auto-discount-deploy", code, "utf8");

const before = code;

// Fix accidental literal \n inserted before console.log during patching
code = code.replace(/;\\n\s*(console\.log\()/g, ";\n  $1");

// Extra safety: fix any exact discount startup log issue
code = code.replace(
  'console.log(`Discount public active now: ${isDiscountPublicActive() ? "YES" : "NO"}`);\\n  console.log(`Discount public mode:',
  'console.log(`Discount public active now: ${isDiscountPublicActive() ? "YES" : "NO"}`);\n  console.log(`Discount public mode:'
);

fs.writeFileSync(path, code, "utf8");

console.log("Changed:", before === code ? "NO - no literal newline issue found" : "YES - fixed literal newline issue");
