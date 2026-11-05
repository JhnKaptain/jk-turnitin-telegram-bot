"use strict";
// IntaSend errors made readable. When the gateway answers with an HTML page
// (outage, Cloudflare block, maintenance) instead of JSON, the raw page used
// to become the error text; the admin alert then exceeded Telegram's 4096
// character limit and was never delivered, hiding the cause.
function stripHtml(text) {
  return String(text || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/giu, " ")
    .replace(/<title>([\s\S]*?)<\/title>/iu, " $1 ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

function summarizeGatewayError({ status, statusText, contentType, text, data }) {
  const head = "HTTP " + (status || "?") + (statusText ? " " + statusText : "");
  const looksHtml = /html/iu.test(String(contentType || "")) || /^\s*<(?:!doctype|html|head|body)/iu.test(String(text || ""));
  let detail;
  if (looksHtml) {
    const title = /<title>([\s\S]*?)<\/title>/iu.exec(String(text || ""))?.[1];
    const cloudflare = /cloudflare|cf-ray|attention required|just a moment/iu.test(String(text || ""));
    detail = (cloudflare ? "Cloudflare/HTML page" : "HTML page") + ": " + stripHtml(title || text).slice(0, 220);
  } else if (data && typeof data === "object" && !data.raw) {
    detail = String(data.detail || data.message || data.error || JSON.stringify(data.errors || data)).slice(0, 400);
  } else {
    detail = stripHtml(text).slice(0, 300) || "empty response";
  }
  return head + " - " + detail;
}

function clampTelegramText(text, max = 3900) {
  const value = String(text || "");
  return value.length <= max ? value : value.slice(0, max - 40) + "\n… (message shortened)";
}

module.exports = { summarizeGatewayError, clampTelegramText, stripHtml };
