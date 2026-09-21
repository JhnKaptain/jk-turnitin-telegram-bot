const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-auto-discount-window", code, "utf8");

const inactiveBlock = `function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm");
  return isTimeInWindowUTC(currentTime, INACTIVE_START_UTC, INACTIVE_END_UTC);
}`;

const discountHelper = `function isBotInactivePeriod() {
  const currentTime = moment.utc().format("HH:mm");
  return isTimeInWindowUTC(currentTime, INACTIVE_START_UTC, INACTIVE_END_UTC);
}

function isDiscountPublicActive() {
  const hasWindow = Boolean(DISCOUNT_START_EAT && DISCOUNT_END_EAT);

  if (!hasWindow) {
    return DISCOUNT_PUBLIC_ENABLED;
  }

  const currentEat = moment().utcOffset(180).format("HH:mm");
  return isTimeInWindowUTC(currentEat, DISCOUNT_START_EAT, DISCOUNT_END_EAT);
}

function discountPublicModeText() {
  const currentEat = moment().utcOffset(180).format("HH:mm");
  const hasWindow = Boolean(DISCOUNT_START_EAT && DISCOUNT_END_EAT);

  if (!hasWindow) {
    return "Manual env mode. DISCOUNT_PUBLIC_ENABLED=" + (DISCOUNT_PUBLIC_ENABLED ? "1" : "0");
  }

  return (
    "Auto time mode\\n" +
    "Now EAT: " + currentEat + "\\n" +
    "Window: " + DISCOUNT_START_EAT + " to " + DISCOUNT_END_EAT + " EAT\\n" +
    "Public discount active: " + (isDiscountPublicActive() ? "YES" : "NO")
  );
}`;

if (!code.includes("function isDiscountPublicActive()")) {
  if (!code.includes(inactiveBlock)) throw new Error("Could not find inactive period block.");
  code = code.replace(inactiveBlock, discountHelper);
}

code = code.replaceAll(
  "DISCOUNT_PUBLIC_ENABLED || resaleVerified",
  "isDiscountPublicActive() || resaleVerified"
);

code = code.replaceAll(
  "RESALE_ENABLED && !DISCOUNT_PUBLIC_ENABLED",
  "RESALE_ENABLED && !isDiscountPublicActive()"
);

code = code.replaceAll(
  "RESALE_ENABLED && DISCOUNT_PUBLIC_ENABLED",
  "RESALE_ENABLED && isDiscountPublicActive()"
);

code = code.replaceAll(
  "if (DISCOUNT_PUBLIC_ENABLED) {",
  "if (isDiscountPublicActive()) {"
);

code = code.replace(
  "    discountPublicEnabled: DISCOUNT_PUBLIC_ENABLED,",
  `    discountPublicEnabled: isDiscountPublicActive(),
    discountPublicConfigured: DISCOUNT_PUBLIC_ENABLED,
    discountPublicAutoWindowSet: Boolean(DISCOUNT_START_EAT && DISCOUNT_END_EAT),
    discountStartEat: DISCOUNT_START_EAT,
    discountEndEat: DISCOUNT_END_EAT,`
);

code = code.replace(
  '  console.log(`Discount public enabled: ${DISCOUNT_PUBLIC_ENABLED ? "YES" : "NO"}`);',
  '  console.log(`Discount public active now: ${isDiscountPublicActive() ? "YES" : "NO"}`);\\n  console.log(`Discount public mode: ${DISCOUNT_START_EAT && DISCOUNT_END_EAT ? "AUTO TIME WINDOW" : "MANUAL ENV"}`);'
);

const adminAnchor = "// =====================\n// ADMIN COMMANDS\n// =====================";

const discountCommand = `// =====================
// ADMIN COMMANDS
// =====================
bot.command("discountmode", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  await ctx.reply(
    "Discount mode check\\n\\n" +
    discountPublicModeText() + "\\n\\n" +
    "Button: " + (isDiscountPublicActive() ? "PUBLIC DISCOUNT" : "CODE REQUIRED")
  );
});
`;

if (!code.includes('bot.command("discountmode"')) {
  if (!code.includes(adminAnchor)) throw new Error("Could not find admin command anchor.");
  code = code.replace(adminAnchor, discountCommand);
}

fs.writeFileSync(path, code, "utf8");
console.log("Auto discount time window applied.");
