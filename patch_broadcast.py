from pathlib import Path
import os
import sys

if len(sys.argv) != 2:
    raise SystemExit('Usage: python patch_broadcast.py <bot-source.js>')

path = Path(sys.argv[1])
raw_original = path.read_bytes()
newline = '\r\n' if b'\r\n' in raw_original else '\n'
text = raw_original.decode('utf-8').replace('\r\n', '\n')
original = text


def replace_once(old: str, new: str, label: str):
    global text
    old = old.replace('\r\n', '\n')
    new = new.replace('\r\n', '\n')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'PATCH FAILED [{label}]: expected 1 anchor, found {count}')
    text = text.replace(old, new, 1)

# 1) Bot state additions.
replace_once(
'''const supportRequests = {};
const pendingAdminReplies = {};

const processedUpdateCache = new Map();''',
'''const supportRequests = {};
const pendingAdminReplies = {};
const pendingBroadcasts = {};
let broadcastInProgress = false;

const processedUpdateCache = new Map();''',
'bot-state-pending-broadcasts'
)

replace_once(
'''let dailySalesSummary = {};
let dailySalesLedger = {};
let lastAppliedBotNameMode = null;''',
'''let dailySalesSummary = {};
let dailySalesLedger = {};
let botUsers = {};
let broadcastMeta = {};
let lastAppliedBotNameMode = null;''',
'bot-state-user-registry'
)

# 2) Store path + broadcast helpers.
anchor = '''const DAILY_SALES_SUMMARY_FILE = path.join(DATA_DIR, "dailySalesSummary.store.json");
const DAILY_SALES_LEDGER_FILE = path.join(DATA_DIR, "dailySalesLedger.store.json");

// =====================
// DUPLICATE UPDATE GUARD
// ====================='''

helper_block = r'''const DAILY_SALES_SUMMARY_FILE = path.join(DATA_DIR, "dailySalesSummary.store.json");
const DAILY_SALES_LEDGER_FILE = path.join(DATA_DIR, "dailySalesLedger.store.json");
const BOT_USERS_FILE = path.join(DATA_DIR, "botUsers.store.json");

const BROADCAST_INTERVAL_MS = Math.max(50, readIntEnv("BROADCAST_INTERVAL_MS", 60));
const BROADCAST_PREVIEW_TTL_MS = 15 * 60 * 1000;

// =====================
// BOT USER REGISTRY + BROADCAST HELPERS
// =====================
function loadBotUsers() {
  try {
    if (!fs.existsSync(BOT_USERS_FILE)) return;

    const raw = fs.readFileSync(BOT_USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

    if (parsed.users && typeof parsed.users === "object" && !Array.isArray(parsed.users)) {
      botUsers = parsed.users;
      broadcastMeta = parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {};
      return;
    }

    // Backward-compatible with a plain { userId: record } registry.
    botUsers = parsed;
  } catch (e) {
    console.error("Failed to load bot users:", e?.message || e);
  }
}

function saveBotUsers() {
  try {
    fs.writeFileSync(
      BOT_USERS_FILE,
      JSON.stringify({ version: 1, users: botUsers, meta: broadcastMeta }, null, 2),
      "utf8"
    );
  } catch (e) {
    console.error("Failed to save bot users:", e?.message || e);
  }
}

function cleanBroadcastUsername(value) {
  return String(value || "").trim().replace(/^@+/, "").slice(0, 64);
}

function rememberBotUser(user, source = "interaction") {
  const userId = Number(user?.id || 0);
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId === ADMIN_ID) return false;

  const key = String(userId);
  const existing = botUsers[key] || null;
  const now = Date.now();

  const firstName = String(user?.first_name || "").trim().slice(0, 128);
  const lastName = String(user?.last_name || "").trim().slice(0, 128);
  const username = cleanBroadcastUsername(user?.username);
  const displayName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();

  const changedIdentity =
    !existing ||
    existing.firstName !== firstName ||
    existing.lastName !== lastName ||
    existing.username !== username ||
    existing.displayName !== displayName;

  const reactivated = Boolean(existing && existing.active === false);
  const shouldPersistLastSeen = !existing || now - Number(existing.lastPersistedAt || 0) >= 5 * 60 * 1000;

  botUsers[key] = {
    ...(existing || {}),
    userId,
    firstName,
    lastName,
    displayName,
    username,
    firstSeenAt: Number(existing?.firstSeenAt || now),
    lastSeenAt: now,
    active: true,
    inactiveAt: null,
    inactiveReason: null,
    source: source || existing?.source || "interaction",
    lastInteractionSource: source || "interaction",
    lastPersistedAt: existing?.lastPersistedAt || 0
  };

  if (changedIdentity || reactivated || shouldPersistLastSeen) {
    botUsers[key].lastPersistedAt = now;
    saveBotUsers();
  }

  return !existing;
}

function rememberHistoricalBotUser(userIdRaw, details = {}) {
  const userId = Number(userIdRaw || 0);
  if (!Number.isSafeInteger(userId) || userId <= 0 || userId === ADMIN_ID) return false;

  const key = String(userId);
  if (botUsers[key]) return false;

  const now = Date.now();
  const seenAt = Number(
    details.lastSeenAt || details.lastPaidCheckAt || details.completedAt || details.paidAt || details.updatedAt || details.createdAt || now
  );

  botUsers[key] = {
    userId,
    firstName: "",
    lastName: "",
    displayName: String(details.name || details.displayName || "").trim().slice(0, 256),
    username: cleanBroadcastUsername(details.username),
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
    active: true,
    inactiveAt: null,
    inactiveReason: null,
    source: "historical-backfill",
    lastInteractionSource: "historical-backfill",
    lastPersistedAt: now
  };

  return true;
}

function backfillBotUsersFromExistingData() {
  let added = 0;

  for (const ref of Object.values(paymentRefs || {})) {
    if (rememberHistoricalBotUser(ref?.userId, ref || {})) added += 1;
  }

  for (const record of checkHistory || []) {
    if (rememberHistoricalBotUser(record?.userId, record || {})) added += 1;
  }

  for (const job of Object.values(paidJobs || {})) {
    if (rememberHistoricalBotUser(job?.userId, job || {})) added += 1;
  }

  for (const record of Object.values(dailySalesLedger?.payments || {})) {
    if (rememberHistoricalBotUser(record?.userId, record || {})) added += 1;
  }

  if (added > 0) saveBotUsers();
  return added;
}

function getBotUserStats() {
  const records = Object.values(botUsers || {}).filter((record) => {
    const userId = Number(record?.userId || 0);
    return Number.isSafeInteger(userId) && userId > 0 && userId !== ADMIN_ID;
  });

  const active = records.filter((record) => record.active !== false).length;

  return {
    registered: records.length,
    active,
    inactive: records.length - active
  };
}

function getActiveBotUserIds() {
  return Object.values(botUsers || {})
    .filter((record) => record?.active !== false)
    .map((record) => Number(record?.userId || 0))
    .filter((userId) => Number.isSafeInteger(userId) && userId > 0 && userId !== ADMIN_ID);
}

function cleanupPendingBroadcasts() {
  const now = Date.now();

  for (const [token, pending] of Object.entries(pendingBroadcasts)) {
    if (!pending?.createdAt || now - Number(pending.createdAt) > BROADCAST_PREVIEW_TTL_MS) {
      delete pendingBroadcasts[token];
    }
  }
}

function makeBroadcastToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function broadcastPreviewKeyboard(token) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ SEND TO ALL", `BROADCAST_SEND_${token}`)],
    [Markup.button.callback("❌ CANCEL", `BROADCAST_CANCEL_${token}`)]
  ]);
}

function broadcastSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBroadcastTelegramError(err) {
  const errorCode = Number(err?.response?.error_code || err?.code || 0) || 0;
  const description = String(
    err?.response?.description || err?.description || err?.message || err || "Unknown Telegram error"
  );
  const retryAfter = Number(
    err?.response?.parameters?.retry_after || err?.parameters?.retry_after || 0
  ) || 0;

  const permanent =
    errorCode === 403 ||
    /blocked by (the )?user|bot was blocked|chat not found|user is deactivated|can't initiate conversation|peer_id_invalid/i.test(description);

  return { errorCode, description, retryAfter, permanent };
}

async function sendBroadcastMessageToUser(userId, message) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await bot.telegram.sendMessage(userId, message);
      return { ok: true };
    } catch (err) {
      const info = getBroadcastTelegramError(err);

      if (info.retryAfter > 0 && attempt === 1) {
        await broadcastSleep((info.retryAfter + 1) * 1000);
        continue;
      }

      return { ok: false, ...info };
    }
  }

  return { ok: false, description: "Broadcast retry exhausted", permanent: false };
}

async function runBroadcast(message, recipientIds) {
  const uniqueIds = [...new Set((recipientIds || []).map(Number))]
    .filter((userId) => Number.isSafeInteger(userId) && userId > 0 && userId !== ADMIN_ID);

  const startedAt = Date.now();
  let attempted = 0;
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  let newlyInactive = 0;

  for (let index = 0; index < uniqueIds.length; index += 1) {
    const userId = uniqueIds[index];
    const key = String(userId);
    const record = botUsers[key];

    if (!record || record.active === false) {
      skipped += 1;
      continue;
    }

    attempted += 1;
    const result = await sendBroadcastMessageToUser(userId, message);
    const now = Date.now();

    record.lastBroadcastAt = now;

    if (result.ok) {
      delivered += 1;
      record.lastBroadcastStatus = "DELIVERED";
      record.lastBroadcastError = null;
    } else {
      failed += 1;
      record.lastBroadcastStatus = "FAILED";
      record.lastBroadcastError = String(result.description || "Unknown failure").slice(0, 500);

      if (result.permanent) {
        if (record.active !== false) newlyInactive += 1;
        record.active = false;
        record.inactiveAt = now;
        record.inactiveReason = record.lastBroadcastError;
      }
    }

    if (attempted % 20 === 0) saveBotUsers();

    if (index < uniqueIds.length - 1) {
      await broadcastSleep(BROADCAST_INTERVAL_MS);
    }
  }

  broadcastMeta = {
    ...(broadcastMeta || {}),
    lastBroadcastStartedAt: startedAt,
    lastBroadcastAt: Date.now(),
    lastBroadcastRecipients: uniqueIds.length,
    lastBroadcastAttempted: attempted,
    lastBroadcastDelivered: delivered,
    lastBroadcastFailed: failed,
    lastBroadcastSkipped: skipped,
    lastBroadcastNewlyInactive: newlyInactive
  };

  saveBotUsers();

  return {
    recipients: uniqueIds.length,
    attempted,
    delivered,
    failed,
    skipped,
    newlyInactive
  };
}

loadBotUsers();

// =====================
// DUPLICATE UPDATE GUARD
// ====================='''

replace_once(anchor, helper_block, 'broadcast-helpers')

# 3) Register every private non-admin user after duplicate protection.
replace_once(
'''  }
});

// =====================
// PAYMENT REF PERSISTENCE
// =====================''',
'''  }
});

// Persist every private non-admin user interaction for future broadcasts.
bot.use(async (ctx, next) => {
  const user = ctx.from;
  const chatType = ctx.chat?.type;

  if (user && user.id !== ADMIN_ID && (!chatType || chatType === "private")) {
    rememberBotUser(user, "private-interaction");
  }

  return next();
});

// =====================
// PAYMENT REF PERSISTENCE
// =====================''',
'user-registry-middleware'
)

# 4) Admin broadcast commands before the quick-action section.
admin_commands_anchor = r'''bot.command("paiduser", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  const userId = parts[1];

  if (!userId) return ctx.reply("Usage: /paiduser <userId>");

  const result = await manuallyConfirmLatestPaymentForUser(userId, "admin-manual-command");
  await ctx.reply(result.message);
});

// =====================
// ADMIN QUICK ACTION BUTTONS
// ====================='''

admin_commands_new = r'''bot.command("paiduser", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  const userId = parts[1];

  if (!userId) return ctx.reply("Usage: /paiduser <userId>");

  const result = await manuallyConfirmLatestPaymentForUser(userId, "admin-manual-command");
  await ctx.reply(result.message);
});

bot.command("broadcaststats", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const stats = getBotUserStats();
  const lastAt = Number(broadcastMeta?.lastBroadcastAt || 0);
  const lastText = lastAt
    ? moment(lastAt).utcOffset(180).format("YYYY-MM-DD HH:mm:ss [EAT]")
    : "Never";

  await ctx.reply(
    "📊 Broadcast users\n\n" +
      `Registered: ${stats.registered}\n` +
      `Active: ${stats.active}\n` +
      `Inactive/blocked: ${stats.inactive}\n` +
      `Broadcast running: ${broadcastInProgress ? "YES" : "NO"}\n` +
      `Last broadcast: ${lastText}\n` +
      `Last delivered: ${Number(broadcastMeta?.lastBroadcastDelivered || 0)}\n` +
      `Last failed: ${Number(broadcastMeta?.lastBroadcastFailed || 0)}`
  );
});

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  if (broadcastInProgress) {
    return ctx.reply("⚠️ A broadcast is already running. Use /broadcaststats to check it.");
  }

  cleanupPendingBroadcasts();

  const raw = String(ctx.message?.text || "");
  const message = raw
    .replace(/^\/broadcast(?:@[A-Za-z0-9_]+)?(?:\s+|$)/i, "")
    .trim();

  if (!message) {
    return ctx.reply("Usage: /broadcast <message>");
  }

  if (message.length > 3200) {
    return ctx.reply("❌ Broadcast message is too long. Keep it at 3,200 characters or fewer.");
  }

  const recipientIds = getActiveBotUserIds();
  if (recipientIds.length === 0) {
    return ctx.reply("❌ No active registered bot users are available for broadcast yet.");
  }

  const token = makeBroadcastToken();
  pendingBroadcasts[token] = {
    message,
    recipientIds,
    createdAt: Date.now()
  };

  await ctx.reply(
    "📢 BROADCAST PREVIEW\n\n" +
      message +
      "\n\n" +
      `Recipients: ${recipientIds.length} active user(s)\n` +
      "This preview expires in 15 minutes.",
    { reply_markup: broadcastPreviewKeyboard(token).reply_markup }
  );
});

// =====================
// ADMIN QUICK ACTION BUTTONS
// ====================='''

replace_once(admin_commands_anchor, admin_commands_new, 'admin-broadcast-commands')

# 5) Broadcast confirm/cancel callbacks before existing admin callbacks.
actions_anchor = '''// =====================
// ADMIN QUICK ACTION BUTTONS
// =====================
bot.action(/^ADMIN_FILEBATCH_(\\d+)$/, async (ctx) => {'''

actions_new = r'''// =====================
// ADMIN QUICK ACTION BUTTONS
// =====================
bot.action(/^BROADCAST_CANCEL_([A-Za-z0-9]+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  cleanupPendingBroadcasts();
  const token = ctx.match[1];

  if (!pendingBroadcasts[token]) {
    await ctx.answerCbQuery("Broadcast preview expired");
    return ctx.reply("⚠️ Broadcast preview is no longer available.");
  }

  delete pendingBroadcasts[token];
  await ctx.answerCbQuery("Broadcast cancelled");

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {}

  await ctx.reply("✅ Broadcast cancelled. No messages were sent.");
});

bot.action(/^BROADCAST_SEND_([A-Za-z0-9]+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  cleanupPendingBroadcasts();
  const token = ctx.match[1];
  const pending = pendingBroadcasts[token];

  if (!pending) {
    await ctx.answerCbQuery("Broadcast preview expired");
    return ctx.reply("⚠️ Broadcast preview is no longer available.");
  }

  if (broadcastInProgress) {
    return ctx.answerCbQuery("A broadcast is already running.", { show_alert: true });
  }

  delete pendingBroadcasts[token];
  broadcastInProgress = true;

  await ctx.answerCbQuery("Broadcast started");

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {}

  await ctx.reply(`📢 Broadcast started for ${pending.recipientIds.length} active user(s).`);

  try {
    const result = await runBroadcast(pending.message, pending.recipientIds);
    const stats = getBotUserStats();

    await ctx.reply(
      "✅ BROADCAST COMPLETE\n\n" +
        `Recipients selected: ${result.recipients}\n` +
        `Attempted: ${result.attempted}\n` +
        `Delivered: ${result.delivered}\n` +
        `Failed: ${result.failed}\n` +
        `Skipped: ${result.skipped}\n` +
        `Newly inactive: ${result.newlyInactive}\n\n` +
        `Active users now: ${stats.active}\n` +
        `Inactive/blocked now: ${stats.inactive}`
    );
  } catch (err) {
    console.error("Broadcast failed:", err?.message || err);
    await ctx.reply("❌ Broadcast stopped unexpectedly: " + String(err?.message || err));
  } finally {
    broadcastInProgress = false;
  }
});

bot.action(/^ADMIN_FILEBATCH_(\d+)$/, async (ctx) => {'''

replace_once(actions_anchor, actions_new, 'broadcast-actions')

# 6) Health counters.
replace_once(
'''    dailySalesLedgerPayments: Object.keys(dailySalesLedger.payments || {}).length,
    botDisplayNameMode: lastAppliedBotNameMode,''',
'''    dailySalesLedgerPayments: Object.keys(dailySalesLedger.payments || {}).length,
    botUsersRegistered: getBotUserStats().registered,
    botUsersActive: getBotUserStats().active,
    botUsersInactive: getBotUserStats().inactive,
    broadcastInProgress,
    lastBroadcastAt: broadcastMeta.lastBroadcastAt || null,
    botDisplayNameMode: lastAppliedBotNameMode,''',
'health-broadcast-counters'
)

# 7) Startup backfill/log before webhook registration.
replace_once(
'''app.listen(port, async () => {
  console.log(`Webhook server listening on port ${port}`);''',
'''app.listen(port, async () => {
  const backfilledBotUsers = backfillBotUsersFromExistingData();
  const botUserStats = getBotUserStats();

  console.log(`Webhook server listening on port ${port}`);
  console.log(`Bot users: ${botUserStats.registered} registered, ${botUserStats.active} active, ${botUserStats.inactive} inactive, ${backfilledBotUsers} newly backfilled`);''',
'startup-backfill'
)

if text == original:
    raise SystemExit('PATCH FAILED: no changes made')

backup = path.with_suffix(path.suffix + '.pre-broadcast.bak')
if backup.exists():
    raise SystemExit(f'PATCH FAILED: backup already exists: {backup}')

backup.write_bytes(raw_original)
output_text = text if newline == '\n' else text.replace('\n', '\r\n')
tmp = path.with_suffix(path.suffix + '.broadcast.tmp')
tmp.write_bytes(output_text.encode('utf-8'))
os.chmod(tmp, path.stat().st_mode)
os.replace(tmp, path)
print(f'PATCHED: {path}')
print(f'BACKUP:  {backup}')
