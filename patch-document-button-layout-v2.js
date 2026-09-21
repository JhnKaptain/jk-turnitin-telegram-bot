const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-document-button-layout-v2", code, "utf8");

const pattern = /  \} else if \(variant === "document"\) \{\n[\s\S]*?\n  \} else if \(variant === "delivery"\) \{/;

const replacement = `  } else if (variant === "document") {
    rows.push([
      Markup.button.callback("📦 Filebatch", \`ADMIN_FILEBATCH_\${userId}\`),
      Markup.button.callback("💬 Reply", \`ADMIN_REPLY_\${userId}\`),
      Markup.button.callback("✅ Confirm", \`ADMIN_PAID_\${userId}\`)
    ]);

    rows.push([
      Markup.button.callback("ℹ️ AI Unavail", \`ADMIN_AI_NOTE_\${userId}\`),
      Markup.button.callback("🧾 Till", \`ADMIN_TILL_NOTICE_\${userId}\`),
      Markup.button.callback("⭐ AI Star", \`ADMIN_AI_STAR_NOTE_\${userId}\`)
    ]);
  } else if (variant === "delivery") {`;

if (!pattern.test(code)) {
  throw new Error("Document button block not found.");
}

code = code.replace(pattern, replacement);

fs.writeFileSync(path, code, "utf8");
console.log("Document card buttons rearranged into two rows of three.");
