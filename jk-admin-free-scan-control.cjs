"use strict";
const isFreeAction = value => value === "ADMIN_DASH_FREE_SCAN" || /^ADMIN_FREE_SCAN_/u.test(String(value || ""));
function enabled(env = process.env) {
  const raw = env.ADMIN_FREE_SCAN_ENABLED;
  return raw === undefined ? true : String(raw).trim() === "1";
}
function stripButtons(markup) {
  return { inline_keyboard: (markup?.inline_keyboard || []).map(row => row.filter(button => !isFreeAction(button.callback_data))).filter(row => row.length) };
}
function registerGuard(bot, { adminId, onDisable }) {
  bot.use(async (ctx, next) => {
    if (!isFreeAction(ctx.callbackQuery?.data) || enabled()) return next();
    if (Number(ctx.from?.id) !== Number(adminId)) return ctx.answerCbQuery("Admin only.");
    onDisable();
    await ctx.answerCbQuery("Admin Free Scan is disabled.");
    const markup = ctx.callbackQuery?.message?.reply_markup;
    if (markup && ctx.editMessageReplyMarkup) {
      try { await ctx.editMessageReplyMarkup(stripButtons(markup)); }
      catch { /* Old/expired messages may be uneditable; the action remains blocked. */ }
    }
  });
}
module.exports = { enabled, isFreeAction, stripButtons, registerGuard };
