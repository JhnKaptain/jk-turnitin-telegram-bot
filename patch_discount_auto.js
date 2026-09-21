const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

if (process.argv.length !== 3) {
  console.error("Usage: node patch_discount_auto.js <bot-source.js>");
  process.exit(1);
}

const target = path.resolve(process.argv[2]);
if (!fs.existsSync(target)) {
  console.error("PATCH FAILED: bot source not found: " + target);
  process.exit(1);
}

const raw = fs.readFileSync(target);
const original = Buffer.from(raw);
const newline = raw.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
let text = raw.toString("utf8").replace(/\r\n/g, "\n");

const operations = [
  {
    "old": "const BROADCAST_INTERVAL_MS = Math.max(50, readIntEnv(\"BROADCAST_INTERVAL_MS\", 60));\nconst BROADCAST_PREVIEW_TTL_MS = 15 * 60 * 1000;",
    "new": "const BROADCAST_INTERVAL_MS = Math.max(50, readIntEnv(\"BROADCAST_INTERVAL_MS\", 60));\nconst BROADCAST_PREVIEW_TTL_MS = 15 * 60 * 1000;\nconst DISCOUNT_BROADCAST_CHECK_MS = Math.max(\n  15000,\n  readIntEnv(\"DISCOUNT_BROADCAST_CHECK_SECONDS\", 30) * 1000\n);",
    "label": "discount-auto-constant"
  },
  {
    "old": "  return {\n    recipients: uniqueIds.length,\n    attempted,\n    delivered,\n    failed,\n    skipped,\n    newlyInactive\n  };\n}\n\nloadBotUsers();",
    "new": "  return {\n    recipients: uniqueIds.length,\n    attempted,\n    delivered,\n    failed,\n    skipped,\n    newlyInactive\n  };\n}\n\nfunction getActiveDiscountBroadcastWindow() {\n  if (!RESALE_ENABLED || !DISCOUNT_START_EAT || !DISCOUNT_END_EAT) return null;\n  if (DISCOUNT_START_EAT === DISCOUNT_END_EAT || !isDiscountPublicActive()) return null;\n\n  const nowEat = moment().utcOffset(180);\n  const [sh, sm] = DISCOUNT_START_EAT.split(\":\").map(Number);\n  const [eh, em] = DISCOUNT_END_EAT.split(\":\").map(Number);\n\n  let start = nowEat.clone().startOf(\"day\").hour(sh).minute(sm).second(0).millisecond(0);\n  let end = nowEat.clone().startOf(\"day\").hour(eh).minute(em).second(0).millisecond(0);\n\n  if (DISCOUNT_START_EAT > DISCOUNT_END_EAT) {\n    if (nowEat.format(\"HH:mm\") < DISCOUNT_END_EAT) start.subtract(1, \"day\");\n    else end.add(1, \"day\");\n  }\n\n  return {\n    key: `${start.format(\"YYYY-MM-DDTHH:mm\")}|${end.format(\"YYYY-MM-DDTHH:mm\")}`,\n    fromText: formatHHMMTo12HourStrict(DISCOUNT_START_EAT) || DISCOUNT_START_EAT,\n    toText: formatHHMMTo12HourStrict(DISCOUNT_END_EAT) || DISCOUNT_END_EAT,\n    price: RESALE_PRICE_KES\n  };\n}\n\nfunction discountBroadcastMessage(windowInfo) {\n  return [\n    \"\ud83c\udff7\ufe0f DISCOUNT IS NOW OPEN!\",\n    \"\",\n    `Get your full Turnitin report for only ${windowInfo.price} KES during the current discount period.`,\n    \"\",\n    \"\u23f0 Discount Period\",\n    `From: ${windowInfo.fromText} EAT`,\n    `To: ${windowInfo.toText} EAT`,\n    \"\",\n    \"\ud83d\udcce Upload your document now to take advantage of the discounted rate before the offer closes.\"\n  ].join(\"\\n\");\n}\n\nasync function createDiscountBroadcastPreview(force = false) {\n  cleanupPendingBroadcasts();\n\n  const windowInfo = getActiveDiscountBroadcastWindow();\n  if (!windowInfo) return { ok: false, reason: \"inactive\" };\n\n  if (!force && broadcastMeta.lastDiscountPreviewWindowKey === windowInfo.key) {\n    return { ok: false, reason: \"already-previewed\" };\n  }\n\n  const recipientIds = getActiveBotUserIds();\n  if (!recipientIds.length) return { ok: false, reason: \"no-recipients\" };\n\n  const message = discountBroadcastMessage(windowInfo);\n  const token = makeBroadcastToken();\n\n  pendingBroadcasts[token] = {\n    message,\n    recipientIds,\n    createdAt: Date.now(),\n    kind: \"discount\",\n    discountWindow: windowInfo\n  };\n\n  try {\n    await bot.telegram.sendMessage(\n      ADMIN_ID,\n      \"\ud83d\udce2 DISCOUNT BROADCAST PREVIEW\\n\\n\" +\n        message +\n        \"\\n\\n\" +\n        `Recipients: ${recipientIds.length} active user(s)\\n` +\n        \"This preview expires in 15 minutes.\\n\\n\" +\n        \"Nothing will be sent unless you choose SEND TO ALL.\",\n      { reply_markup: broadcastPreviewKeyboard(token).reply_markup }\n    );\n  } catch (err) {\n    delete pendingBroadcasts[token];\n    throw err;\n  }\n\n  broadcastMeta.lastDiscountPreviewWindowKey = windowInfo.key;\n  broadcastMeta.lastDiscountPreviewAt = Date.now();\n  saveBotUsers();\n\n  return { ok: true, windowInfo, recipients: recipientIds.length };\n}\n\nasync function checkAutomaticDiscountBroadcastPreview() {\n  try {\n    await createDiscountBroadcastPreview(false);\n  } catch (err) {\n    console.error(\"Automatic discount broadcast preview failed:\", err?.message || err);\n  }\n}\n\nfunction startDiscountBroadcastPreviewScheduler() {\n  setTimeout(checkAutomaticDiscountBroadcastPreview, 3000);\n  setInterval(checkAutomaticDiscountBroadcastPreview, DISCOUNT_BROADCAST_CHECK_MS);\n}\n\nloadBotUsers();",
    "label": "discount-auto-helpers"
  },
  {
    "old": "    { reply_markup: broadcastPreviewKeyboard(token).reply_markup }\n  );\n});\n\n// =====================\n// ADMIN QUICK ACTION BUTTONS\n// =====================",
    "new": "    { reply_markup: broadcastPreviewKeyboard(token).reply_markup }\n  );\n});\n\nbot.command(\"discountbroadcast\", async (ctx) => {\n  if (ctx.from.id !== ADMIN_ID) return;\n\n  if (!DISCOUNT_START_EAT || !DISCOUNT_END_EAT) {\n    return ctx.reply(\"\u274c No timed public discount window is configured.\");\n  }\n\n  if (!isDiscountPublicActive()) {\n    return ctx.reply(\n      \"\u2139\ufe0f Public discount is currently closed.\\n\\n\" +\n        `Period: ${formatHHMMTo12HourStrict(DISCOUNT_START_EAT)} - ${formatHHMMTo12HourStrict(DISCOUNT_END_EAT)} EAT\\n` +\n        `Price: ${RESALE_PRICE_KES} KES`\n    );\n  }\n\n  try {\n    const result = await createDiscountBroadcastPreview(true);\n    if (result.ok) {\n      return ctx.reply(\"\u2705 Fresh discount broadcast preview created.\");\n    }\n    if (result.reason === \"no-recipients\") {\n      return ctx.reply(\"\u274c No active registered users are available for broadcast.\");\n    }\n    return ctx.reply(\"\u274c Discount broadcast preview could not be created.\");\n  } catch (err) {\n    return ctx.reply(\"\u274c Failed to create preview: \" + String(err?.message || err));\n  }\n});\n\n// =====================\n// ADMIN QUICK ACTION BUTTONS\n// =====================",
    "label": "discount-auto-command"
  },
  {
    "old": "  if (!pending) {\n    await ctx.answerCbQuery(\"Broadcast preview expired\");\n    return ctx.reply(\"\u26a0\ufe0f Broadcast preview is no longer available.\");\n  }\n\n  if (broadcastInProgress) {",
    "new": "  if (!pending) {\n    await ctx.answerCbQuery(\"Broadcast preview expired\");\n    return ctx.reply(\"\u26a0\ufe0f Broadcast preview is no longer available.\");\n  }\n\n  if (pending.kind === \"discount\") {\n    const currentWindow = getActiveDiscountBroadcastWindow();\n\n    if (!currentWindow || currentWindow.key !== pending.discountWindow?.key) {\n      delete pendingBroadcasts[token];\n      await ctx.answerCbQuery(\"Discount period closed\", { show_alert: true });\n\n      try {\n        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });\n      } catch {}\n\n      return ctx.reply(\"\u274c Discount broadcast not sent because that discount period is no longer active.\");\n    }\n\n    if (Number(currentWindow.price) !== Number(pending.discountWindow?.price)) {\n      delete pendingBroadcasts[token];\n      await ctx.answerCbQuery(\"Discount price changed\", { show_alert: true });\n\n      try {\n        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });\n      } catch {}\n\n      return ctx.reply(\"\u26a0\ufe0f Discount price changed. Use /discountbroadcast to create a fresh preview.\");\n    }\n  }\n\n  if (broadcastInProgress) {",
    "label": "discount-auto-send-guard"
  },
  {
    "old": "  startBotDisplayNameScheduler();\n  startDailySalesSummaryScheduler();\n});",
    "new": "  startBotDisplayNameScheduler();\n  startDailySalesSummaryScheduler();\n  startDiscountBroadcastPreviewScheduler();\n});",
    "label": "discount-auto-startup"
  },
  {
    "old": "  console.log(`Discount public mode: ${DISCOUNT_START_EAT && DISCOUNT_END_EAT ? \"AUTO TIME WINDOW\" : \"MANUAL ENV\"}`);\n  console.log(`Kenyan bank payment enabled: ${INTERNATIONAL_PAYMENT_ENABLED ? \"YES\" : \"NO\"}`);",
    "new": "  console.log(`Discount public mode: ${DISCOUNT_START_EAT && DISCOUNT_END_EAT ? \"AUTO TIME WINDOW\" : \"MANUAL ENV\"}`);\n  console.log(`Discount broadcast preview check: every ${DISCOUNT_BROADCAST_CHECK_MS / 1000}s`);\n  console.log(`Kenyan bank payment enabled: ${INTERNATIONAL_PAYMENT_ENABLED ? \"YES\" : \"NO\"}`);",
    "label": "discount-auto-startup-log"
  }
];

for (const op of operations) {
  const count = text.split(op.old).length - 1;
  if (count !== 1) {
    console.error(`PATCH FAILED [${op.label}]: expected 1 anchor, found ${count}`);
    process.exit(1);
  }
  text = text.replace(op.old, op.new);
}

const backup = target + ".pre-discount-auto.bak";
if (fs.existsSync(backup)) {
  console.error("PATCH FAILED: backup already exists: " + backup);
  process.exit(1);
}

fs.writeFileSync(backup, original);

try {
  const output = newline === "\n" ? text : text.replace(/\n/g, "\r\n");
  fs.writeFileSync(target, output, "utf8");

  const check = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
  if (check.status !== 0) {
    fs.writeFileSync(target, original);
    console.error("PATCH FAILED: node --check failed. Original restored.");
    if (check.stderr) process.stderr.write(check.stderr);
    process.exit(1);
  }
} catch (err) {
  fs.writeFileSync(target, original);
  console.error("PATCH FAILED: " + (err?.message || err));
  console.error("Original restored.");
  process.exit(1);
}

console.log("PATCHED: " + target);
console.log("BACKUP:  " + backup);
console.log("NODE CHECK: PASS");
