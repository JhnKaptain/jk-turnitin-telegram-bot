const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-online-offline-debug", code, "utf8");

// 1) Reduce bot name refresh from 5 minutes to 1 minute.
code = code.replace(
  "  }, 5 * 60 * 1000);",
  "  }, 60 * 1000);"
);

// 2) Add admin commands to check and force sync.
const anchor = `bot.command("reply", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;`;

const addition = `bot.command("mode", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const nowUtc = moment.utc().format("YYYY-MM-DD HH:mm");
  const nowEat = moment().utcOffset(180).format("YYYY-MM-DD HH:mm");
  const inactive = isBotInactivePeriod();
  const desiredName = inactive ? BOT_OFFLINE_NAME : BOT_ONLINE_NAME;

  await ctx.reply(
    "Bot mode check\\n\\n" +
    "Now UTC: " + nowUtc + "\\n" +
    "Now EAT: " + nowEat + "\\n" +
    "Inactive UTC: " + INACTIVE_START_UTC + " to " + INACTIVE_END_UTC + "\\n" +
    "Inactive ends EAT: " + INACTIVE_END_EAT_DISPLAY + "\\n" +
    "Current mode: " + (inactive ? "OFFLINE" : "ONLINE") + "\\n" +
    "Target name: " + desiredName + "\\n" +
    "Last applied: " + (lastAppliedBotNameMode || "N/A")
  );
});

bot.command("syncname", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  await syncBotDisplayName(true);

  const inactive = isBotInactivePeriod();
  await ctx.reply(
    "Bot name sync forced.\\n\\nCurrent mode: " + (inactive ? "OFFLINE" : "ONLINE")
  );
});

`;

if (!code.includes('bot.command("mode"')) {
  if (!code.includes(anchor)) {
    throw new Error("Could not find admin command anchor.");
  }

  code = code.replace(anchor, addition + anchor);
}

fs.writeFileSync(path, code, "utf8");
console.log("Online/offline debug commands added.");
