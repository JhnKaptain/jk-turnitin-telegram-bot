"use strict";
/*
  JK_ADMIN_PUSH_V1: phone/laptop notifications for the admin web panel
  (standard Web Push, delivered free by the browser's own push service).

  - The signing keys are generated on first use and kept on the persistent disk
    (DATA_DIR/admin-push.json): no setting needed.
  - Each device the admin turns notifications on for is saved with the chosen
    categories. Devices the push service reports as gone are removed.
  - Notifications carry short text only (first lines of the bot's message).
*/
const fs = require("fs");

const MAX_DEVICES = 10;

function createAdminPush({ file, webpush = require("web-push"), subject = "https://jkacademictoolshub.com", log = console }) {
  let state = null;
  function load() {
    if (state) return state;
    try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch { state = null; }
    if (!state?.publicKey || !state?.privateKey) {
      const keys = webpush.generateVAPIDKeys();
      state = { publicKey: keys.publicKey, privateKey: keys.privateKey, devices: [] };
      persist();
    }
    if (!Array.isArray(state.devices)) state.devices = [];
    return state;
  }
  function persist() {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  const publicKey = () => load().publicKey;

  function validSubscription(sub) {
    return sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000 &&
      typeof sub.keys?.p256dh === "string" && typeof sub.keys?.auth === "string";
  }

  function subscribe(subscription, categories, label) {
    if (!validSubscription(subscription)) { const e = new Error("Invalid notification subscription."); e.status = 400; throw e; }
    const s = load();
    const cats = [...new Set((categories || []).map(String))].slice(0, 20);
    s.devices = s.devices.filter(d => d.subscription.endpoint !== subscription.endpoint);
    s.devices.push({ subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
      categories: cats, label: String(label || "Device").slice(0, 80), at: Date.now() });
    s.devices = s.devices.slice(-MAX_DEVICES);
    persist();
    return { devices: s.devices.length };
  }

  function unsubscribe(endpoint) {
    const s = load();
    const before = s.devices.length;
    s.devices = s.devices.filter(d => d.subscription.endpoint !== String(endpoint || ""));
    if (s.devices.length !== before) persist();
    return { removed: before - s.devices.length };
  }

  function device(endpoint) {
    const d = load().devices.find(x => x.subscription.endpoint === String(endpoint || ""));
    return d ? { categories: d.categories, label: d.label } : null;
  }

  async function send(payload, { category = null, endpoint = null } = {}) {
    const s = load();
    const targets = s.devices.filter(d => endpoint ? d.subscription.endpoint === endpoint : d.categories.includes(category));
    let sent = 0;
    const gone = [];
    await Promise.all(targets.map(async d => {
      try {
        await webpush.sendNotification(d.subscription, JSON.stringify(payload), {
          TTL: 6 * 3600, urgency: "high",
          vapidDetails: { subject, publicKey: s.publicKey, privateKey: s.privateKey }
        });
        sent++;
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) gone.push(d.subscription.endpoint);
        else log.error?.("Admin push failed:", error?.statusCode || "", error?.message || error);
      }
    }));
    if (gone.length) { s.devices = s.devices.filter(d => !gone.includes(d.subscription.endpoint)); persist(); }
    return { sent, removed: gone.length };
  }

  return { publicKey, subscribe, unsubscribe, device, send, devices: () => load().devices.length };
}

// Short, lock-screen-safe text from a bot message: title = first line, body =
// the next two meaningful lines, both trimmed.
function summarize(text) {
  const lines = String(text || "").split("\n").map(l => l.trim()).filter(l => l && !/^[━─=_-]{3,}$/.test(l));
  const title = (lines[0] || "JK Admin").slice(0, 70);
  const body = lines.slice(1, 3).join(" · ").slice(0, 120);
  return { title, body };
}

module.exports = { createAdminPush, summarize };
