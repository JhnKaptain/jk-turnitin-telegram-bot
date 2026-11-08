"use strict";
/*
  Admin-only Telegram control for the plagiarism provider.

  /plagiarism shows which provider is in use and offers buttons to switch.
  The choice is saved (DATA_DIR) and survives restarts; "Use Render setting"
  clears it so PLAGIARISM_PROVIDER from Render applies again.
*/
const plagiarism = require("./providers/plagiarism.js");

const ACTION = /^JK_PLAG_PROVIDER_(QUETEXT|JKSIMILARITY|RENDER|TEST)$/u;

function describe(current = plagiarism.currentProvider()) {
  const why = {
    admin: "chosen here in Telegram",
    render: "from the Render setting PLAGIARISM_PROVIDER",
    default: "default (no setting)"
  }[current.source];
  const fallback = plagiarism.normalizeName(process.env.PLAGIARISM_FALLBACK) === "quetext"
    ? "On: a failed JK SimilarityCheck scan retries on Quetext."
    : "Off.";
  return [
    "Plagiarism provider",
    "",
    "In use: " + current.label + " (" + why + ")",
    "Render setting: " + (plagiarism.PROVIDERS[plagiarism.normalizeName(process.env.PLAGIARISM_PROVIDER)]?.label || "not set"),
    "Fallback to Quetext: " + fallback,
    "",
    "Applies to new scans from now on."
  ].join("\n");
}

function keyboard(current = plagiarism.currentProvider()) {
  const mark = name => (current.name === name ? "✅ " : "");
  return {
    inline_keyboard: [
      [
        { text: mark("quetext") + "Quetext", callback_data: "JK_PLAG_PROVIDER_QUETEXT" },
        { text: mark("jksimilarity") + "JK SimilarityCheck", callback_data: "JK_PLAG_PROVIDER_JKSIMILARITY" }
      ],
      [
        { text: "Use Render setting", callback_data: "JK_PLAG_PROVIDER_RENDER" },
        { text: "Test JK SimilarityCheck", callback_data: "JK_PLAG_PROVIDER_TEST" }
      ]
    ]
  };
}

function register(bot, { adminId }) {
  const isAdmin = ctx => Number(ctx.from?.id) === Number(adminId);

  bot.command("plagiarism", async ctx => {
    if (!isAdmin(ctx)) return;
    await ctx.reply(describe(), { reply_markup: keyboard() });
  });

  bot.action(ACTION, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery("Admin only.");
    const choice = ctx.match[1];
    if (choice === "TEST") {
      try {
        const health = await require("./providers/jksimilarity.js").getServiceStatus();
        await ctx.answerCbQuery("JK SimilarityCheck is reachable.");
        await ctx.reply("✅ JK SimilarityCheck reachable. Sources: " + (health?.sources || []).join(", "));
      } catch (error) {
        await ctx.answerCbQuery("Not reachable.");
        await ctx.reply("❌ JK SimilarityCheck test failed: " + (error?.message || error));
      }
      return;
    }
    const current = choice === "RENDER"
      ? plagiarism.setProvider(null)
      : plagiarism.setProvider(choice.toLowerCase(), { by: ctx.from.id });
    await ctx.answerCbQuery("Now using " + current.label + ".");
    try {
      await ctx.editMessageText(describe(current), { reply_markup: keyboard(current) });
    } catch {
      await ctx.reply(describe(current), { reply_markup: keyboard(current) });
    }
  });
}

module.exports = { register, describe, keyboard };
