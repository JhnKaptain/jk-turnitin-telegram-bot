"use strict";

function summary({ job, file, stage, rendered, runAi, remainingMs, error }) {
  const name = String(file.file_name || file.fileName || "Document");
  const lines = ["File: " + name, "User: " + String(job.userId)];

  if (stage === "submitted") {
    return [
      "SUBMITTED - similarity API accepted",
      ...lines,
      "AI: " + (runAi ? "requested" : "not requested")
    ].join("\n");
  }

  if (stage === "review") {
    const checkpoint = String(file.providerResultsFile || "");
    const valid = checkpoint.startsWith("/") &&
      checkpoint.endsWith(".provider-results.json") &&
      !checkpoint.includes(String.fromCharCode(10)) &&
      !checkpoint.includes(String.fromCharCode(13));

    const escaped = Array.from(checkpoint, character =>
      [34, 36, 92, 96].includes(character.charCodeAt(0))
        ? String.fromCharCode(92) + character : character
    ).join("");

    const command = valid
      ? 'node jk-recover-reviewed-results.cjs --checkpoint "' + escaped + '"'
      : null;

    return [
      "MANUAL REVIEW - do not resubmit",
      ...lines,
      "Reason: " + String(file.manualReviewReason || error || "Alignment needs review"),
      "Saved results: " + (checkpoint || "Unavailable"),
      "",
      ...(command
        ? ["Recover to admin only - paste into Render Shell:", command]
        : ["Recovery command unavailable: saved-results path missing or invalid."])
    ].join("\n");
  }

  if (stage === "failed") {
    return [
      "REPORT PROCESSING FAILED",
      ...lines,
      "Reason: " + String(error || "See service logs")
    ].join("\n");
  }

  const percent = value =>
    value !== null && value !== undefined && Number.isFinite(Number(value))
      ? Math.round(Number(value)) + "%"
      : "unavailable";

  lines.push("Similarity: " + percent(file.providerSimilarityPercent));
  lines.push(
    "AI: " + (
      !runAi ? "not requested" :
      rendered?.aiAvailable ? percent(rendered.aiPercent) :
      "unavailable"
    )
  );

  if (stage === "ready") {
    return [
      "REPORTS READY",
      ...lines,
      remainingMs > 0
        ? "Delivery in approximately " + Math.ceil(remainingMs / 60000) + " minute(s)."
        : "Delivery starting now."
    ].join("\n");
  }

  return [
    "DELIVERED",
    ...lines,
    "Similarity PDF: " + (file.apiSimilarityDeliveredAt ? "sent" : "unavailable"),
    "AI PDF: " + (file.apiAiDeliveredAt ? "sent" : "not sent")
  ].join("\n");
}

async function updateAdminStatus(options) {
  const { telegram, adminId, file, save } = options;
  const text = summary(options);

  if (file.providerAdminStatusText === text) return true;

  try {
    if (file.providerAdminStatusMessageId) {
      try {
        await telegram.editMessageText(
          adminId,
          file.providerAdminStatusMessageId,
          undefined,
          text
        );
      } catch (error) {
        const reason = String(error?.description || error?.message || error);

        if (/message is not modified/i.test(reason)) {
          file.providerAdminStatusText = text;
          save();
          return true;
        }

        if (
          !/message to edit not found|message can't be edited|message cannot be edited/i
            .test(reason)
        ) {
          throw error;
        }

        const sent = await telegram.sendMessage(adminId, text);
        file.providerAdminStatusMessageId = sent.message_id;
      }
    } else {
      const sent = await telegram.sendMessage(adminId, text);
      file.providerAdminStatusMessageId = sent.message_id;
    }

    file.providerAdminStatusText = text;
    save();
    return true;
  } catch (error) {
    console.error(
      "Admin status update failed:",
      error?.description || error?.message || error
    );
    return false;
  }
}

module.exports = { summary, updateAdminStatus };
