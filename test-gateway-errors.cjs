"use strict";
// STK push failures must reach the admin with a short, readable reason.
// An HTML error page from the gateway used to make the alert longer than
// Telegram's 4096-character limit ("message is too long"), so it was lost.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { summarizeGatewayError, clampTelegramText } = require("./jk-gateway-errors.cjs");

const cloudflare = "<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title><style>" + "x{}".repeat(3000) +
  "</style></head><body><h1>Sorry, you have been blocked</h1><p>cf-ray 8f1</p>" + "<div>pad</div>".repeat(2000) + "</body></html>";
const a = summarizeGatewayError({ status: 403, statusText: "Forbidden", contentType: "text/html", text: cloudflare, data: { raw: cloudflare } });
assert(a.length < 300, "short: " + a.length);
assert.match(a, /^HTTP 403 Forbidden - Cloudflare\/HTML page: Attention Required! \| Cloudflare/);

const outage = "<html><head><title>502 Bad Gateway</title></head><body>" + "x".repeat(9000) + "</body></html>";
assert.match(summarizeGatewayError({ status: 502, statusText: "Bad Gateway", contentType: "text/html", text: outage, data: { raw: outage } }), /^HTTP 502 Bad Gateway - HTML page: 502 Bad Gateway$/);

const json = { detail: "Invalid token." };
assert.equal(summarizeGatewayError({ status: 401, statusText: "Unauthorized", contentType: "application/json", text: JSON.stringify(json), data: json }), "HTTP 401 Unauthorized - Invalid token.");
const fields = { errors: [{ code: "invalid", detail: "phone_number: Enter a valid phone number" }] };
assert.match(summarizeGatewayError({ status: 400, contentType: "application/json", text: JSON.stringify(fields), data: fields }), /^HTTP 400 - .*valid phone number/);

const long = "❌ STK Push error\nError: " + "y".repeat(10000);
const clamped = clampTelegramText(long);
assert(clamped.length <= 3900 && clamped.endsWith("(message shortened)"));
assert.equal(clampTelegramText("short"), "short");

const bot = fs.readFileSync(__dirname + "/bot.js", "utf8");
assert.equal((bot.match(/JK_GATEWAY_ERRORS_V1/g) || []).length, 3, "all three IntaSend request helpers summarise errors");
assert(bot.includes('text = require("./jk-gateway-errors.cjs").clampTelegramText(text);'), "admin alerts are clamped");
assert(bot.includes('bot.command("intasendcheck"'), "admin /intasendcheck command");
assert(bot.includes('console.error("STK push failed for user "'), "STK failures are logged on Render");

console.log("PASS: gateway HTML/JSON errors summarised; admin alerts clamped under Telegram's limit; /intasendcheck available");
