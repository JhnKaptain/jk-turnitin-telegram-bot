require("dotenv").config();

const express = require("express");
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = String(process.env.BOT_TOKEN || "").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const PORT = Number(process.env.PORT || 3000);

const REDIRECT_TO_USERNAME = String(process.env.REDIRECT_TO_USERNAME || "JKTurnitinBot").replace(/^@/, "").trim();
const REDIRECT_TO_DISPLAY_NAME = String(process.env.REDIRECT_TO_DISPLAY_NAME || "JK Turnitin Bot").trim();

const APP_LINK = `https://t.me/${REDIRECT_TO_USERNAME}`;
const WEB_LINK = `https://web.telegram.org/k/#@${REDIRECT_TO_USERNAME}`;

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable.");
  process.exit(1);
}

if (!PUBLIC_BASE_URL) {
  console.error("Missing PUBLIC_BASE_URL environment variable.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const redirectMessage = [
  "📢 *This bot has moved.*",
  "",
  `Please use our new official bot: *${REDIRECT_TO_DISPLAY_NAME}*`,
  "",
  "Open with Telegram App:",
  APP_LINK,
  "",
  "Open with Telegram Web:",
  WEB_LINK,
  "",
  `You can also search *${REDIRECT_TO_DISPLAY_NAME}* on Telegram and tap *Start*.`,
  "",
  "All CHECK, RECHECK, Similarity Report Only, Discount, and payment services are now handled there."
].join("\n");

const redirectKeyboard = Markup.inlineKeyboard([
  [Markup.button.url("🚀 Open New Bot", APP_LINK)],
  [Markup.button.url("🌐 Open in Telegram Web", WEB_LINK)]
]);

async function sendRedirect(ctx) {
  try {
    await ctx.reply(redirectMessage, {
      parse_mode: "Markdown",
      ...redirectKeyboard
    });
  } catch (err) {
    console.error("Failed to send redirect:", err?.message || err);
  }
}

bot.start(sendRedirect);
bot.help(sendRedirect);
bot.on("message", sendRedirect);

bot.on("callback_query", async (ctx) => {
  try {
    await ctx.answerCbQuery("Please open the new bot.");
  } catch (err) {
    console.error("Failed to answer callback:", err?.message || err);
  }

  await sendRedirect(ctx);
});

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("Old bot redirect service is running.");
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.use(bot.webhookCallback("/webhook"));

app.listen(PORT, async () => {
  const webhookUrl = `${PUBLIC_BASE_URL}/webhook`;

  console.log(`Old bot redirect service listening on port ${PORT}`);

  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Telegram webhook set to: ${webhookUrl}`);
  } catch (err) {
    console.error("Failed to set Telegram webhook:", err?.message || err);
    process.exit(1);
  }
});
