const fs = require("fs");

const path = "bot.js";
let code = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

fs.writeFileSync("bot.js.before-send-admin-after-type", code, "utf8");

function replaceBetween(start, end, replacement) {
  const a = code.indexOf(start);
  if (a === -1) throw new Error("Start anchor not found: " + start);
  const b = code.indexOf(end, a);
  if (b === -1) throw new Error("End anchor not found: " + end);
  code = code.slice(0, a) + replacement + "\n\n" + code.slice(b);
}

replaceBetween(
  "async function forwardAcceptedDocumentByIds(userId, chatId, messageId, username, firstName, lastName) {",
  "async function beginSubmissionFlow(ctx) {",
`function adminReportTypeLabel(kind) {
  const t = String(kind || "").toUpperCase();

  if (t === "CHECK") return "CHECK - FULL REPORT";
  if (t === "RECHECK") return "RECHECK - FULL REPORT";
  if (t === "SIMILARITY") return "SIMILARITY ONLY";
  if (t === "RESALE") return RESALE_LABEL_TITLE.toUpperCase() + " - FULL REPORT";

  return "PENDING SERVICE CHOICE";
}

function adminReportInstruction(kind) {
  const t = String(kind || "").toUpperCase();

  if (t === "SIMILARITY") {
    return "Generate: Similarity report only. DO NOT generate AI report.";
  }

  if (t === "CHECK" || t === "RECHECK" || t === "RESALE") {
    return "Generate: Similarity + AI report where available.";
  }

  return "Generate: Wait until client chooses service.";
}

function buildAdminDocumentCaption({ userId, name, usernameText, file, fileNumber, expectedFiles }) {
  const fileNo = Number(fileNumber || 0) || "?";
  const total = Number(expectedFiles || 0) || "?";
  const fileName = safeText(file?.file_name || file?.fileName || "N/A");
  const service = adminReportTypeLabel(file?.type);
  const instruction = adminReportInstruction(file?.type);
  const price = file?.price ? String(file.price) + " KES" : "Not selected yet";

  const lines = [
    "📨 Document received",
    "",
    "File: " + fileNo + "/" + total,
    "Service: " + service,
    instruction,
    "Price: " + price,
    "Filename: " + fileName
  ];

  if (file?.recheckEligible) {
    lines.push("Recheck eligibility: YES (" + safeText(file.recheckHoursLeft || "?") + "h left)");
  }

  lines.push(
    "",
    "User ID: " + userId,
    "Name: " + safeText(name),
    "Username: @" + safeText(usernameText || "N/A")
  );

  return lines.join("\\n");
}

async function sendSelectedDocumentToAdmin(user, sub, file, fileNumber) {
  if (!file) return;
  if (file.adminSentAt) return;

  const userId = user.id;
  const name = getUserFullName(user);
  const usernameText = safeText(user.username || "N/A");

  const caption = buildAdminDocumentCaption({
    userId,
    name,
    usernameText,
    file,
    fileNumber,
    expectedFiles: sub?.expectedFiles
  });

  try {
    if (!file.sourceChatId || !file.sourceMessageId) {
      throw new Error("Missing original document message details.");
    }

    const copied = await bot.telegram.copyMessage(ADMIN_ID, file.sourceChatId, file.sourceMessageId, {
      caption,
      reply_markup: adminActionKeyboard(userId, "document").reply_markup
    });

    file.adminSentAt = Date.now();
    file.adminMessageId = copied?.message_id || null;
  } catch (err) {
    await sendAdminMessage(
      "⚠️ Document selected but copy failed. Details below.\\n\\n" + caption,
      { adminButtons: "document" }
    );

    try {
      if (file.sourceChatId && file.sourceMessageId) {
        await bot.telegram.forwardMessage(ADMIN_ID, file.sourceChatId, file.sourceMessageId);
      }
    } catch {}

    file.adminSentAt = Date.now();
  }
}`
);

const oldPendingStored = `    const storedFile = createStoredFileFromDocument(userId, {
      file_id: pending.fileId,
      file_unique_id: pending.fileUniqueId,
      file_name: pending.fileName
    });

    sub.files.push(storedFile);`;

const newPendingStored = `    const storedFile = createStoredFileFromDocument(userId, {
      file_id: pending.fileId,
      file_unique_id: pending.fileUniqueId,
      file_name: pending.fileName
    });

    storedFile.sourceChatId = pending.chatId;
    storedFile.sourceMessageId = pending.messageId;
    storedFile.sourceUsername = pending.username || "N/A";
    storedFile.sourceFirstName = pending.firstName || "";
    storedFile.sourceLastName = pending.lastName || "";

    sub.files.push(storedFile);`;

if (!code.includes("storedFile.sourceChatId = pending.chatId;")) {
  if (!code.includes(oldPendingStored)) throw new Error("Pending stored file block not found.");
  code = code.replace(oldPendingStored, newPendingStored);
}

const oldPendingForward = `    await forwardAcceptedDocumentByIds(
      pending.userId,
      pending.chatId,
      pending.messageId,
      pending.username,
      pending.firstName,
      pending.lastName
    );

    await askForFileType(ctx, sub);`;

const newPendingForward = `    await askForFileType(ctx, sub);`;

if (code.includes(oldPendingForward)) {
  code = code.replace(oldPendingForward, newPendingForward);
}

const oldRegularStored = `  const doc = ctx.message.document;
  const storedFile = createStoredFileFromDocument(user.id, doc);

  sub.files.push(storedFile);`;

const newRegularStored = `  const doc = ctx.message.document;
  const storedFile = createStoredFileFromDocument(user.id, doc);

  storedFile.sourceChatId = ctx.chat.id;
  storedFile.sourceMessageId = ctx.message.message_id;
  storedFile.sourceUsername = user.username || "N/A";
  storedFile.sourceFirstName = user.first_name || "";
  storedFile.sourceLastName = user.last_name || "";

  sub.files.push(storedFile);`;

if (!code.includes("storedFile.sourceChatId = ctx.chat.id;")) {
  if (!code.includes(oldRegularStored)) throw new Error("Regular stored file block not found.");
  code = code.replace(oldRegularStored, newRegularStored);
}

const oldRegularForward = `  await forwardAcceptedDocumentByIds(
    user.id,
    ctx.chat.id,
    ctx.message.message_id,
    user.username || "N/A",
    user.first_name || "",
    user.last_name || ""
  );

  await askForFileType(ctx, sub);`;

const newRegularForward = `  await askForFileType(ctx, sub);`;

if (code.includes(oldRegularForward)) {
  code = code.replace(oldRegularForward, newRegularForward);
}

const oldFinalize = `  if (kind === "CHECK") file.price = CHECK_PRICE_KES;
  if (kind === "RECHECK") file.price = RECHECK_PRICE_KES;
  if (kind === "SIMILARITY") file.price = SIMILARITY_ONLY_PRICE_KES;
  if (kind === "RESALE") file.price = RESALE_PRICE_KES;

  const justCompletedNumber = sub.currentFileIndex + 1;
  sub.currentFileIndex = null;`;

const newFinalize = `  if (kind === "CHECK") file.price = CHECK_PRICE_KES;
  if (kind === "RECHECK") file.price = RECHECK_PRICE_KES;
  if (kind === "SIMILARITY") file.price = SIMILARITY_ONLY_PRICE_KES;
  if (kind === "RESALE") file.price = RESALE_PRICE_KES;

  const justCompletedNumber = sub.currentFileIndex + 1;

  await sendSelectedDocumentToAdmin(ctx.from, sub, file, justCompletedNumber);

  sub.currentFileIndex = null;`;

if (!code.includes("await sendSelectedDocumentToAdmin(ctx.from, sub, file, justCompletedNumber);")) {
  if (!code.includes(oldFinalize)) throw new Error("Finalize file type block not found.");
  code = code.replace(oldFinalize, newFinalize);
}

fs.writeFileSync(path, code, "utf8");
console.log("Admin will now receive documents after service selection.");
