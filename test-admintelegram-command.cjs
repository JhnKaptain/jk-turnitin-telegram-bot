"use strict";
// /admintelegram on|off: the same switch as the panel's "📱 Admin messages on
// Telegram", runnable from Telegram or Bot chat. Runs the real handler from bot.js.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

(async () => {
  const src = fs.readFileSync(path.join(__dirname, "bot.js"), "utf8");
  const start = src.indexOf('bot.command("admintelegram"');
  const end = src.indexOf('bot.command("deletefiles"');
  assert(start > 0 && end > start, "handler present");
  let handler = null;
  let on = true, forced = false;
  const log = [];
  const context = {
    ADMIN_ID: 42, Number, String,
    bot: { command: (name, fn) => { if (name === "admintelegram") handler = fn; } },
    adminTelegramOn: () => forced || on,
    adminTelegramForced: () => forced,
    setAdminTelegram: v => { on = v; log.push(["set", v]); }
  };
  vm.createContext(context);
  vm.runInContext(src.slice(start, end), context);
  const run = async (text, from = 42) => {
    await handler({ from: { id: from }, message: { text }, reply: async t => log.push(["reply", t, on]) });
  };

  // Status.
  await run("/admintelegram");
  assert.match(log.at(-1)[1], /ON \(Telegram and the panel\)/);
  // Off: confirmation sent while still on (reaches Telegram), then switched off.
  await run("/admintelegram off");
  assert.deepEqual(log.slice(-2).map(x => x[0]), ["reply", "set"]);
  assert.equal(log.at(-2)[2], true, "confirmation went out while Telegram was on");
  assert.equal(on, false);
  await run("/admintelegram off");
  assert.match(log.at(-1)[1], /already OFF/);
  // On: switched first, then the confirmation (reaches Telegram).
  await run("/admintelegram on");
  assert.deepEqual(log.slice(-2).map(x => x[0]), ["set", "reply"]);
  assert.equal(log.at(-1)[2], true);
  // Forced on by Render: off refused.
  forced = true;
  await run("/admintelegram off");
  assert.match(log.at(-1)[1], /forced on by the ADMIN_TELEGRAM setting/);
  forced = false;
  // Customers can't use it.
  const before = log.length;
  await run("/admintelegram off", 999);
  assert.equal(log.length, before, "ignored for non-admins");

  // Listed in the admin menu, /adminhelp and the panel's quick buttons.
  assert(src.includes('{ command: "admintelegram", description: "Admin messages on Telegram: on / off" },'));
  assert(src.includes('"/admintelegram on|off - Admin messages on Telegram (off: panel only)"'));
  assert(fs.readFileSync(path.join(__dirname, "jk-admin-panel.html"), "utf8").includes('data-cmd="/admintelegram"'));
  console.log("PASS: /admintelegram status/on/off (confirmations reach Telegram), Render override respected, admin only, listed everywhere.");
})().catch(e => { console.error(e); process.exit(1); });
