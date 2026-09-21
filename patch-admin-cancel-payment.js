const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-admin-cancel-payment", code, "utf8");

function replaceRegex(pattern, replacement, label) {
  if (!pattern.test(code)) throw new Error(label + " not found.");
  code = code.replace(pattern, replacement);
}

// 1. Add Cancel Payment button to admin document/payment cards.
const adminKeyboardReplacement = `function adminActionKeyboard(userId, variant) {
  const rows = [];

  if (variant === "paymentProof") {
    rows.push([
      Markup.button.callback("💬 Reply", \`ADMIN_REPLY_\${userId}\`),
      Markup.button.callback("✅ Confirm", \`ADMIN_PAID_\${userId}\`)
    ]);

    rows.push([Markup.button.callback("🛑 Cancel Pay", \`ADMIN_CANCEL_PAYMENT_\${userId}\`)]);

    rows.push([Markup.button.callback("📦 Filebatch", \`ADMIN_FILEBATCH_\${userId}\`)]);
  } else if (variant === "document") {
    rows.push([
      Markup.button.callback("📦 Filebatch", \`ADMIN_FILEBATCH_\${userId}\`),
      Markup.button.callback("💬 Reply", \`ADMIN_REPLY_\${userId}\`),
      Markup.button.callback("✅ Confirm", \`ADMIN_PAID_\${userId}\`)
    ]);

    rows.push([Markup.button.callback("🛑 Cancel Pay", \`ADMIN_CANCEL_PAYMENT_\${userId}\`)]);

    rows.push([
      Markup.button.callback("ℹ️ AI Unavail", \`ADMIN_AI_NOTE_\${userId}\`),
      Markup.button.callback("🧾 Till", \`ADMIN_TILL_NOTICE_\${userId}\`),
      Markup.button.callback("⭐ AI Star", \`ADMIN_AI_STAR_NOTE_\${userId}\`)
    ]);
  } else if (variant === "delivery") {
    rows.push([Markup.button.callback("📦 Filebatch", \`ADMIN_FILEBATCH_\${userId}\`)]);
    rows.push([Markup.button.callback("💬 Reply", \`ADMIN_REPLY_\${userId}\`)]);
    rows.push([Markup.button.callback("✅ Confirm", \`ADMIN_PAID_\${userId}\`)]);
  } else if (variant === "paid") {
    rows.push([Markup.button.callback("📦 Filebatch", \`ADMIN_FILEBATCH_\${userId}\`)]);
    rows.push([Markup.button.callback("💬 Reply", \`ADMIN_REPLY_\${userId}\`)]);
  } else if (variant === "replyOnly") {
    rows.push([Markup.button.callback("💬 Reply", \`ADMIN_REPLY_\${userId}\`)]);
  } else {
    rows.push([Markup.button.callback("📦 Filebatch", \`ADMIN_FILEBATCH_\${userId}\`)]);
    rows.push([Markup.button.callback("💬 Reply", \`ADMIN_REPLY_\${userId}\`)]);
    rows.push([Markup.button.callback("✅ Confirm", \`ADMIN_PAID_\${userId}\`)]);
  }

  return Markup.inlineKeyboard(rows);
}`;

replaceRegex(
  /function adminActionKeyboard\(userId, variant\) \{[\s\S]*?\n\}\n\nasync function sendAdminMessage/,
  adminKeyboardReplacement + "\n\nasync function sendAdminMessage",
  "adminActionKeyboard block"
);

// 2. Prevent cancelled payment refs from being completed later by webhook/polling.
replaceRegex(
  /async function markPaymentComplete\(\{ apiRef, invoiceId, state, source \}\) \{\n  const ref = getPaymentRef\(apiRef\);\n  if \(!ref\) return false;\n  if \(ref\.status === "COMPLETE"\) return false;/,
  `async function markPaymentComplete({ apiRef, invoiceId, state, source }) {
  const ref = getPaymentRef(apiRef);
  if (!ref) return false;
  if (ref.status === "COMPLETE") return false;

  const currentStatus = String(ref.status || "").toUpperCase();
  if (["ADMIN_CANCELLED", "CANCELLED", "FAILED", "EXPIRED"].includes(currentStatus)) {
    stopStatusPolling(apiRef);
    return false;
  }`,
  "markPaymentComplete guard"
);

// 3. Add cancel helper functions before paidref command.
if (!code.includes("function isPaymentRefClosedForAdmin")) {
  replaceRegex(
    /bot\.command\("paidref", async \(ctx\) => \{/,
    `function isPaymentRefClosedForAdmin(ref) {
  const status = String(ref?.status || "").toUpperCase();
  return ["COMPLETE", "ADMIN_CANCELLED", "CANCELLED", "FAILED", "EXPIRED"].includes(status);
}

function findOpenPaymentRefsByUser(userId) {
  return Object.entries(paymentRefs)
    .filter(([apiRef, value]) => String(value?.userId) === String(userId) && !isPaymentRefClosedForAdmin(value))
    .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0));
}

async function cancelPaymentProcessForUser(userId, source) {
  const sub = submissions[userId];

  if (sub?.paid || sub?.stage === STAGE_PAID) {
    return {
      ok: false,
      message: \`⚠️ User \${userId} is already marked paid. Do not cancel payment from here.\`
    };
  }

  const refsByApi = new Map(findOpenPaymentRefsByUser(userId));

  if (Array.isArray(sub?.paymentAttempts)) {
    for (const apiRef of sub.paymentAttempts) {
      const ref = getPaymentRef(apiRef);
      if (ref && String(ref.userId) === String(userId) && !isPaymentRefClosedForAdmin(ref)) {
        refsByApi.set(apiRef, ref);
      }
      stopStatusPolling(apiRef);
    }
  }

  if (sub?.api_ref) stopStatusPolling(sub.api_ref);

  let cancelledRefs = 0;

  for (const [apiRef] of refsByApi.entries()) {
    stopStatusPolling(apiRef);
    updatePaymentRef(apiRef, {
      status: "ADMIN_CANCELLED",
      cancelledAt: Date.now(),
      lastState: "ADMIN_CANCELLED",
      cancelSource: source || "admin-button"
    });
    cancelledRefs += 1;
  }

  if (!sub && cancelledRefs === 0) {
    return {
      ok: false,
      message: \`❌ No active unpaid payment process found for user \${userId}.\`
    };
  }

  resetSubmission(userId);

  try {
    await bot.telegram.sendMessage(
      userId,
      "❌ Your payment attempt for the uploaded document has been cancelled by admin.\\n\\nYou can start again by tapping *Send Document*.",
      { parse_mode: "Markdown", reply_markup: mainKeyboard() }
    );
  } catch (err) {
    await sendAdminMessage(
      \`⚠️ Payment process cancelled for user \${userId}, but user message failed: \${safeText(err?.message || err)}\`
    );
  }

  return {
    ok: true,
    message: \`✅ Payment process cancelled for user \${userId}.\\nStopped \${cancelledRefs} pending payment reference(s).\`
  };
}

bot.command("paidref", async (ctx) => {`,
    "paidref insertion point"
  );
}

// 4. Make manual confirm ignore admin-cancelled/failed/expired refs.
code = code.replace(
  '.filter(([apiRef, value]) => String(value?.userId) === String(userId) && value?.status !== "COMPLETE")',
  '.filter(([apiRef, value]) => String(value?.userId) === String(userId) && !isPaymentRefClosedForAdmin(value))'
);

// 5. Add admin cancel button action after ADMIN_PAID action.
if (!code.includes("bot.action(/^ADMIN_CANCEL_PAYMENT_")) {
  replaceRegex(
    /bot\.action\(\^?\/\^ADMIN_PAID_\(\\d\+\)\$\/, async \(ctx\) => \{[\s\S]*?\n\}\);/,
    (match) => `${match}

bot.action(/^ADMIN_CANCEL_PAYMENT_(\\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Admin only.");

  const userId = ctx.match[1];

  await ctx.answerCbQuery("Cancelling payment...");
  const result = await cancelPaymentProcessForUser(userId, "admin-cancel-button");
  await ctx.reply(result.message);
});`,
    "ADMIN_PAID action block"
  );
}

fs.writeFileSync(path, code, "utf8");
console.log("Admin cancel payment button added.");
