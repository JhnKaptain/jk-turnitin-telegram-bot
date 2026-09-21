const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8");

// Fix literal \n inserted around Paystack routes
const start = code.indexOf('app.get("/paystack/callback"');
let end = -1;

if (start !== -1) {
  const intasendGet = code.indexOf('app.get("/intasend/webhook"', start);
  const intasendPost = code.indexOf('app.post("/intasend/webhook"', start);

  if (intasendGet !== -1 && intasendPost !== -1) {
    end = Math.min(intasendGet, intasendPost);
  } else {
    end = Math.max(intasendGet, intasendPost);
  }

  if (end !== -1) {
    const before = code.slice(0, start);
    const middle = code.slice(start, end).replace(/\\n/g, "\n");
    const after = code.slice(end);

    code = before + middle + after;
    fs.writeFileSync(path, code, "utf8");
    console.log("Fixed Paystack route newlines.");
  } else {
    console.log("Found Paystack route start, but could not find IntaSend webhook after it.");
  }
} else {
  console.log("Paystack callback route not found.");
}
