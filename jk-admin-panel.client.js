"use strict";
// JK_ADMIN_WEB_PANEL_V1: browser side of /admin. Every request carries the
// X-Admin-Panel header; the session lives in an HttpOnly cookie.
// JK_ADMIN_ORDER_DESK_V1: orders work like the Telegram admin message —
// customer file, reports, reply, notes, send files — plus a "Needs action" inbox.
(function () {
  const $ = id => document.getElementById(id);
  const H = { "X-Admin-Panel": "1" };
  let data = null;
  let timer = null;
  let view = "action";
  let search = "";
  let drawerUser = null;
  // JK_ADMIN_OTHER_SERVICES_V1: Reports <-> Other services (website shop).
  let section = "reports";
  try { const saved = localStorage.getItem("jkSection"); if (saved === "shop" || saved === "bot") section = saved; } catch {}
  if (location.hash === "#bot") section = "bot"; // opened from a notification
  // JK_ADMIN_BOT_CHAT_V1
  let botData = null;
  let botFilter = "all";
  let botTimer = null;
  let shopView = "action";
  let shopSearch = "";
  let shopData = null;
  const selected = new Set(); // JK_DELETE_FILES_NOW_V1: chosen report IDs

  function toast(text, ms = 3500) {
    const m = $("msg"); m.textContent = text; m.style.display = "block";
    clearTimeout(toast.t); toast.t = setTimeout(() => { m.style.display = "none"; }, ms);
  }
  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "same-origin", ...opts, headers: { ...H, ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/admin/api/login") { showLogin(); throw new Error("Please log in."); }
    if (!res.ok) throw new Error(body.error || ("Request failed (" + res.status + ")"));
    return body;
  }
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = ms => ms ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  const mins = (at, now) => Math.max(1, Math.ceil((at - now) / 60000));
  const ago = (ms, now) => {
    const m = Math.max(0, Math.round((now - ms) / 60000));
    return m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
  };

  function showLogin() {
    clearInterval(timer); clearInterval(botTimer);
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
  }
  function showApp() {
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    refresh(); clearInterval(timer); timer = setInterval(refresh, 20000);
    applySection();
  }

  // --- rendering ----------------------------------------------------------
  function fileStatus(f, now) {
    if (f.status === "FAILED") {
      if (f.retryStopped) return '<span class="chip bad">Failed · retries stopped</span>';
      if (f.retryAt) return '<span class="chip warn">Failed · retry ' + f.retryCount + '/3 in ~' + mins(f.retryAt, now) + ' min</span>';
      if (f.retryExhausted) return '<span class="chip bad">Failed · retries used up</span>';
      return '<span class="chip bad">Failed</span>';
    }
    if (f.status === "COMPLETE" || f.status === "COMPLETED") return '<span class="chip ok">Complete</span>';
    if (f.status === "MANUAL_REQUIRED") return '<span class="chip warn">Manual review</span>';
    return '<span class="chip">' + esc(f.status || "Waiting") + '</span>';
  }
  function who(j) {
    return (j.name ? esc(j.name) : "Customer") + (j.username ? ' <span class="muted">@' + esc(j.username) + '</span>' : '');
  }
  function jobStatus(j) {
    if (j.deliveredAt || j.status === "DELIVERED") return '<span class="chip ok">Delivered</span>';
    return '<span class="chip">' + esc((j.status || "").replace(/_/g, " ").toLowerCase()) + '</span>';
  }
  function renderOrders() {
    const box = $("ordersList");
    $("cntAction").textContent = data.counts?.action ? " (" + data.counts.action + ")" : "";
    document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === view));
    const can = f => f.id && !f.deleted;
    const live = new Set(data.jobs.flatMap(j => j.files.filter(can).map(f => f.id)));
    for (const id of [...selected]) if (!live.has(id)) selected.delete(id);

    const waiting = (data.waiting || []).map(w => (
      '<div class="card need"><div class="row"><strong>💬 Customer ' + esc(w.userId) + '</strong>' +
      '<span class="chip warn">Waiting for a reply · ' + esc(ago(w.since, data.now)) + '</span></div>' +
      '<p class="quote">' + esc(w.last) + '</p>' +
      '<div class="row"><button class="btn primary" data-open="' + esc(w.userId) + '">💬 Open conversation</button></div></div>'
    )).join("");

    const empty = view === "action" ? "Nothing needs you right now. 🎉" : view === "free" ? "No free scans yet." : "No orders found.";
    const jobs = data.jobs.map(j => {
      const ids = j.files.filter(can).map(f => f.id);
      const all = ids.length && ids.every(id => selected.has(id));
      return '<div class="card' + (j.needs.length ? ' need' : '') + '">' +
        '<div class="row">' +
        (ids.length ? '<input type="checkbox" class="pick" title="Select all files in this order" data-all="' + esc(ids.join(",")) + '"' + (all ? ' checked' : '') + '>' : '') +
        '<strong>' + (j.adminFreeScan ? "🧪 Free scan" : who(j)) + '</strong>' + jobStatus(j) +
        (j.web ? '<span class="chip">Website</span>' : '') +
        (j.amount != null && !j.adminFreeScan ? '<span class="muted">KES ' + esc(j.amount) + '</span>' : '') +
        '<span class="muted">ID ' + esc(j.userId) + ' · ' + esc(when(j.paidAt || j.createdAt)) + '</span></div>' +
        (j.needs.length ? '<div class="row" style="margin-top:6px">' + j.needs.map(n => '<span class="chip bad">⚠ ' + esc(n) + '</span>').join("") + '</div>' : '') +
        j.files.map(f => (
          '<div class="file"><div class="row">' +
          (can(f) ? '<input type="checkbox" class="pick" data-pick="' + esc(f.id) + '"' + (selected.has(f.id) ? ' checked' : '') + '>' : '') +
          '<strong>' + esc(f.name) + '</strong>' + fileStatus(f, data.now) +
          (f.deleted ? '<span class="chip">Files deleted</span>' : '') +
          (f.type ? '<span class="muted">' + esc(f.type) + '</span>' : '') +
          (f.similarity != null ? '<span class="muted">Similarity ' + Math.round(f.similarity) + '%</span>' : '') +
          (f.ai != null ? '<span class="muted">AI ' + Math.round(f.ai) + '%</span>' : '') +
          (f.id ? '<span class="muted">Report ID ' + esc(f.id) + '</span>' : '') + '</div>' +
          (f.error ? '<div class="err bad">' + esc(f.error) + '</div>' : '') +
          '<div class="row" style="margin-top:6px">' +
          (f.id && !f.deleted ? '<a class="dl" href="/admin/api/files/' + esc(f.id) + '/original" data-dl="1">⬇ Customer file</a>' : '') +
          f.reports.map(r => '<a class="dl" href="/admin/api/files/' + esc(f.id) + '/reports/' + encodeURIComponent(r) + '" data-dl="1">⬇ ' + esc(r) + '</a>').join(" ") +
          (f.status === "FAILED" && f.id && !f.deleted ? (
            (f.retryAt && !f.retryStopped ? '<button class="btn danger" data-stop="' + esc(f.id) + '">Stop retries</button>' : '') +
            '<button class="btn" data-retry="' + esc(f.id) + '">Retry now</button>') : '') +
          '</div></div>'
        )).join("") +
        (j.adminFreeScan ? '' : '<div class="row actions">' +
          '<button class="btn primary" data-send="' + esc(j.userId) + '">📤 Send files</button>' +
          '<button class="btn" data-open="' + esc(j.userId) + '">💬 Reply / notes</button>' +
          (j.done ? '<button class="btn" data-jobundo="' + esc(j.jobId) + '">↩ Undo done</button>'
            : '<button class="btn" data-jobdone="' + esc(j.jobId) + '">✔ Mark done</button>') +
          '</div>') +
        '</div>';
    }).join("");

    box.innerHTML = '<div id="delBar" class="card row hidden"><strong id="delCount"></strong>' +
      '<button class="btn danger" id="delBtn">🗑 Delete selected</button><button class="btn" id="delClear">Clear</button></div>' +
      waiting + (jobs || (waiting ? '' : '<div class="card muted">' + empty + '</div>'));
    updateDeleteBar();
  }
  function updateDeleteBar() {
    const bar = $("delBar"); if (!bar) return;
    bar.classList.toggle("hidden", !selected.size);
    $("delCount").textContent = selected.size + " selected";
  }
  function renderPayments() {
    const box = $("tab-payments");
    if (!data.payments.length) { box.innerHTML = '<div class="card muted">No pending payments.</div>'; return; }
    box.innerHTML = data.payments.map(p => {
      const pr = p.proof;
      return '<div class="card"><div class="row"><strong>' + esc(p.currency) + ' ' + esc(p.amount) + '</strong>' +
        '<span class="chip">' + esc(p.method || "") + '</span><span class="chip">' + esc(p.status || "") + '</span>' +
        '<span class="muted">User ' + esc(p.userId) + (p.name ? ' · ' + esc(p.name) : '') + ' · ' + esc(when(p.createdAt)) + ' · ' + p.files + ' file(s)</span></div>' +
        (pr ? '<p class="muted">Proof: ' + esc(pr.type) + ' · amount ' + esc(pr.amount) + ' · code ' + esc(pr.code || "–") +
          ' · ' + esc(pr.time || "no time") + ' · ' + esc(pr.confidence || "") +
          (pr.duplicateCode ? ' · <span class="bad">code already used</span>' : '') +
          (pr.autoConfirmAt && pr.autoConfirmAt > data.now ? ' · <span class="warn">auto-confirm in ~' + mins(pr.autoConfirmAt, data.now) + ' min</span>' : '') +
          '</p>' : '<p class="muted">No proof received yet.</p>') +
        '<div class="row"><button class="btn primary" data-confirm="' + esc(p.userId) + '">Confirm</button>' +
        '<button class="btn danger" data-cancel="' + esc(p.userId) + '">Cancel pay</button>' +
        '<button class="btn" data-open="' + esc(p.userId) + '">💬 Reply / notes</button></div></div>';
    }).join("");
  }
  // --- Other services: website shop orders --------------------------------
  const kes = v => v == null ? "" : "KES " + esc(v);
  function shopBusy() {
    const box = $("shopList"); if (!box) return false;
    const a = document.activeElement;
    if (a && box.contains(a) && /^(TEXTAREA|INPUT)$/.test(a.tagName) && a.type !== "checkbox") return true;
    return [...box.querySelectorAll("input[type=file]")].some(i => i.files && i.files.length);
  }
  function renderShop() {
    const box = $("shopList");
    document.querySelectorAll("[data-sview]").forEach(b => b.classList.toggle("on", b.dataset.sview === shopView));
    if (!shopData.enabled) {
      box.innerHTML = '<div class="card muted">The shop is not connected: SHOP_STORE_KEY is not set on this service.</div>';
      return;
    }
    const warn = shopData.serviceKnown ? "" : '<div class="card warn">Replies and files need the shop update deployed. Until then you can read orders here and reply on Telegram.</div>';
    const empty = shopView === "action" ? "Nothing needs you right now. 🎉" : "No shop orders found.";
    box.innerHTML = warn + (shopData.orders.map(o => (
      '<div class="card' + (o.needs.length ? ' need' : '') + '" data-shop="' + esc(o.id) + '">' +
      '<div class="row"><strong>🛍 ' + esc(o.product) + '</strong>' +
      (o.amount != null ? '<span class="muted">' + kes(o.amount) + '</span>' : '') +
      (o.paid ? '<span class="chip ok">Paid</span>' : '<span class="chip">' + esc((o.paymentState || "Unpaid").toLowerCase()) + '</span>') +
      (o.done ? '<span class="chip">Done</span>' : '') +
      '<span class="muted">' + esc(o.id) + ' · ' + esc(when(o.paidAt || o.createdAt)) + '</span></div>' +
      (o.needs.length ? '<div class="row" style="margin-top:6px">' + o.needs.map(n => '<span class="chip bad">⚠ ' + esc(n) + '</span>').join("") + '</div>' : '') +
      '<p class="muted" style="margin:8px 0 0">' +
      (o.phone ? 'Paid from ' + esc(o.phone) : '') + (o.mpesaName ? ' · M-Pesa name: ' + esc(o.mpesaName) : '') +
      (o.whatsapp ? ' · <a class="dl" target="_blank" rel="noopener noreferrer" href="https://wa.me/' + esc(o.whatsapp) + '">WhatsApp ' + esc(o.whatsapp) + '</a>' : '') + '</p>' +
      (o.paid ? (
        '<div class="thread">' + (o.messages.length ? o.messages.map(m => (
          '<div class="msg ' + (m.from === "customer" ? "in" : "out") + (m.file ? " file" : "") + '">' +
          (m.file ? "📎 " + esc(m.file.name) + (m.text ? " — " : "") : "") + esc(m.text) +
          '<div class="meta">' + (m.from === "customer" ? "Customer" : "You") + ' · ' + esc(when(m.at)) + '</div></div>'
        )).join("") : '<p class="muted">No messages yet.</p>') + '</div>' +
        '<label>Reply (logins, instructions…)</label><textarea rows="2" data-sreplytext="' + esc(o.id) + '"></textarea>' +
        '<div class="row" style="margin-top:8px"><button class="btn primary" data-sreply="' + esc(o.id) + '">💬 Send reply</button></div>' +
        '<label>Send a file</label><input type="file" data-sfile="' + esc(o.id) + '">' +
        '<div class="row" style="margin-top:8px"><button class="btn" data-sfilebtn="' + esc(o.id) + '">📎 Send file</button>' +
        (o.done ? '<button class="btn" data-sundo="' + esc(o.id) + '">↩ Undo done</button>'
          : '<button class="btn" data-sdone="' + esc(o.id) + '">✔ Mark done</button>') + '</div>'
      ) : '<p class="muted">Not paid — nothing to deliver.</p>') +
      '</div>'
    )).join("") || '<div class="card muted">' + empty + '</div>');
    box.querySelectorAll(".thread").forEach(t => { t.scrollTop = t.scrollHeight; });
  }
  function applySection() {
    document.querySelectorAll("[data-section]").forEach(b => b.classList.toggle("on", b.dataset.section === section));
    $("reportsSection").classList.toggle("hidden", section !== "reports");
    $("reportsNav").classList.toggle("hidden", section !== "reports");
    $("shopSection").classList.toggle("hidden", section !== "shop");
    $("botSection").classList.toggle("hidden", section !== "bot");
    document.body.classList.toggle("botmode", section === "bot");
    if (section === "bot") { unseen = 0; setBadge(); }
    clearInterval(botTimer);
    if (section === "bot" && !$("app").classList.contains("hidden")) { refreshBot(); botTimer = setInterval(refreshBot, 6000); checkNotif(); loadTg(); }
  }

  // --- Bot chat: everything the bot sends you, commands, buttons ------------
  const CAT_SHORT = { payment: "💳 Payments", failed: "❌ Failed", message: "💬 Messages", shop: "🛍 Shop", attention: "⚠️ Attention",
    provider: "🔌 Providers", broadcast: "📢 Broadcast", orders: "✅ Orders", retrying: "🔁 Retrying", other: "Other" };
  function renderBotFilters() {
    const cats = ["all", ...Object.keys(CAT_SHORT)];
    $("botFilters").innerHTML = cats.map(c => '<button class="btn small' + (c === botFilter ? ' on' : '') + '" data-bfilter="' + c + '">' +
      (c === "all" ? "All" : CAT_SHORT[c]) + '</button>').join("");
  }
  function renderBot() {
    const box = $("botFeed");
    const nearEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 200;
    const list = botData.entries.filter(e => botFilter === "all" || e.category === botFilter || (e.from === "you" && botFilter === "all"));
    box.innerHTML = list.length ? list.map(e => (
      '<div class="bmsg' + (e.from === "you" ? " you" : "") + (e.deleted ? " deleted" : "") + '">' +
      (e.attachments && e.attachments.length ? '<div class="att">' + e.attachments.map((a, n) => {
        const href = "/admin/api/bot/files/" + esc(e.id) + "/" + n;
        return (a.kind === "photo" || /^image\//.test(a.mime || "")
          ? '<img class="thumb" alt="' + esc(a.name) + '" data-img="' + href + '">' : '') +
          '<a class="dl" href="' + href + '" data-dl="1">⬇ ' + esc(a.name) + '</a>';
      }).join("") + '</div>'
        : (e.file ? '<div class="muted">📎 ' + esc(e.file) + '</div>' : '')) +
      '<div class="txt">' + esc(e.text || "") + '</div>' +
      (e.buttons && e.buttons.length && !e.deleted ? '<div class="kb">' + e.buttons.map(row => '<div class="row">' + row.map(b => b.url
        ? '<a class="btn" target="_blank" rel="noopener noreferrer" href="' + esc(b.url) + '">' + esc(b.text) + ' ↗</a>'
        : '<button class="btn" data-bpress="' + esc(e.id) + '" data-bdata="' + esc(b.data) + '">' + esc(b.text) + '</button>').join("") + '</div>').join("") + '</div>' : '') +
      '<div class="meta">' + (e.from === "you" ? "You (web)" : (CAT_SHORT[e.category] || "Bot")) + ' · ' + esc(when(e.at)) + (e.editedAt ? ' · edited' : '') + (e.telegramError ? ' · <span class="warn">⚠ not delivered to Telegram</span>' : '') + '</div></div>'
    )).join("") : '<div class="card muted">No messages yet. Everything the bot sends you on Telegram appears here from now on.</div>';
    if (nearEnd || !box.dataset.loaded) window.scrollTo(0, document.body.scrollHeight);
    box.dataset.loaded = "1";
    loadThumbs();
  }
  // Images need the panel header, so they are fetched and shown from memory.
  const thumbs = new Map();
  function loadThumbs() {
    document.querySelectorAll("img[data-img]").forEach(img => {
      const key = img.dataset.img;
      if (thumbs.has(key)) { if (thumbs.get(key)) img.src = thumbs.get(key); return; }
      thumbs.set(key, null);
      fetch(key, { headers: H, credentials: "same-origin" })
        .then(r => (r.ok ? r.blob() : Promise.reject(new Error("unavailable"))))
        .then(b => { const u = URL.createObjectURL(b); thumbs.set(key, u); document.querySelectorAll('img[data-img="' + key + '"]').forEach(i => { i.src = u; }); })
        .catch(() => { img.replaceWith(Object.assign(document.createElement("span"), { className: "muted", textContent: "Image not available" })); });
    });
  }
  document.addEventListener("click", ev => {
    const img = ev.target.closest && ev.target.closest("img.thumb");
    if (img && img.src) window.open(img.src, "_blank", "noopener");
  });

  // Admin messages on Telegram: On / Off.
  async function loadTg() {
    try {
      const r = await api("/admin/api/bot/settings");
      $("tgState").textContent = r.telegram ? "On" : "Off (panel only)";
      $("tgToggle").textContent = r.telegram ? "Turn off" : "Turn on";
      $("tgToggle").dataset.on = r.telegram ? "1" : "";
      $("tgHelp").textContent = r.forced
        ? "Forced on by the ADMIN_TELEGRAM setting on Render."
        : r.telegram
          ? "The bot also messages you on Telegram. Turn off to run the admin side from this panel only (customers are not affected)."
          : "The bot no longer messages you on Telegram: alerts, buttons, files and command replies are here, with phone notifications. Customers still use Telegram as before.";
    } catch {}
  }
  $("tgToggle").addEventListener("click", async () => {
    const turningOff = $("tgToggle").dataset.on === "1";
    if (turningOff && !confirm("Stop the bot messaging you on Telegram?\n\nEverything will arrive here in the panel only. Make sure notifications are on for your phone first.")) return;
    try {
      await api("/admin/api/bot/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telegram: !turningOff }) });
      toast(turningOff ? "Telegram is off for admin messages. The panel is now your admin chat." : "Telegram is on again.");
    } catch (e) { toast(e.message, 7000); }
    loadTg();
  });
  async function refreshBot() {
    try {
      const r = await api("/admin/api/bot/feed");
      popupsFromFeed(r);
      const changed = !botData || r.seq !== botData.seq || JSON.stringify(r.entries.slice(-30)) !== JSON.stringify(botData.entries.slice(-30));
      botData = r;
      if (!$("botFilters").innerHTML) renderBotFilters();
      if (changed) renderBot();
    } catch (e) { if (e.message !== "Please log in.") toast(e.message); }
  }
  async function botSend(text) {
    text = String(text || "").trim();
    if (!text) return;
    $("botSend").disabled = true;
    try {
      const r = await api("/admin/api/bot/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      $("botInput").value = "";
      if (!r.finished) toast("Still working… the answer will appear here.");
      await refreshBot();
      window.scrollTo(0, document.body.scrollHeight);
    } catch (e) { toast(e.message); }
    finally { $("botSend").disabled = false; }
  }
  $("botSend").addEventListener("click", () => botSend($("botInput").value));
  $("botInput").addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); botSend($("botInput").value); } });

  // --- In-app pop-ups (JK_ADMIN_POPUPS_V1) ---------------------------------
  // While the panel is open, new alerts in the chosen categories pop up as a
  // banner with a sound and vibration, in any section. The app icon shows a
  // count until Bot chat is opened.
  let lastSeenId = null;
  let myCats = null;          // this device's choices (or the defaults)
  let unseen = 0;
  const bannered = new Set();
  let audio = null;
  const unlockAudio = () => {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch {}
  };
  document.addEventListener("click", unlockAudio, { capture: true });
  document.addEventListener("keydown", unlockAudio, { capture: true });
  function chime() {
    try {
      if (!audio) return;
      const t = audio.currentTime;
      [880, 1175].forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f; o.type = "sine";
        g.gain.setValueAtTime(0.0001, t + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
        o.connect(g); g.connect(audio.destination); o.start(t + i * 0.18); o.stop(t + i * 0.18 + 0.17);
      });
    } catch {}
    try { navigator.vibrate && navigator.vibrate([150, 80, 150]); } catch {}
  }
  function setBadge() {
    document.title = (unseen ? "(" + unseen + ") " : "") + "Admin Panel";
    try { if (navigator.setAppBadge) unseen ? navigator.setAppBadge(unseen) : navigator.clearAppBadge(); } catch {}
  }
  function popup(key, title, body) {
    if (bannered.has(key)) return;
    bannered.add(key);
    const box = $("popups");
    const el = document.createElement("div");
    el.className = "popup";
    el.innerHTML = '<div style="flex:1"><strong>' + esc(title) + '</strong>' + (body ? '<div class="muted">' + esc(body) + '</div>' : '') +
      '</div><button class="btn" aria-label="Close">✕</button>';
    el.addEventListener("click", ev => {
      el.remove();
      if (ev.target.closest("button")) return;
      section = "bot"; try { localStorage.setItem("jkSection", section); } catch {}
      applySection();
    });
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => el.remove(), 15000);
    if (section !== "bot" || document.hidden) { unseen++; setBadge(); }
    chime();
  }
  const summary = text => {
    const lines = String(text || "").split("\n").map(l => l.trim()).filter(Boolean);
    return { title: (lines[0] || "JK Admin").slice(0, 70), body: lines.slice(1, 3).join(" · ").slice(0, 120) };
  };
  function popupsFromFeed(feed) {
    if (!myCats && feed.categories) myCats = Object.keys(feed.categories).filter(k => feed.categories[k].on);
    const maxId = feed.entries.reduce((m, e) => Math.max(m, e.id), 0);
    if (lastSeenId === null) { lastSeenId = maxId; return; } // nothing old pops up
    for (const e of feed.entries) {
      if (e.id <= lastSeenId || e.from !== "bot") continue;
      if (myCats && !myCats.includes(e.category)) continue;
      const s = summary(e.text || e.file);
      popup("jk-" + e.id, s.title, s.body);
    }
    lastSeenId = Math.max(lastSeenId, maxId);
  }
  async function pollAlerts() {
    if ($("app").classList.contains("hidden")) return;
    try {
      const r = await api("/admin/api/bot/feed");
      popupsFromFeed(r);
      if (section === "bot") {
        const changed = !botData || r.seq !== botData.seq || JSON.stringify(r.entries.slice(-30)) !== JSON.stringify(botData.entries.slice(-30));
        botData = r;
        if (!$("botFilters").innerHTML) renderBotFilters();
        if (changed) renderBot();
      }
    } catch {}
  }
  setInterval(pollAlerts, 10000);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", ev => {
      const d = ev.data || {};
      if (d.type === "jk-push") popup(d.tag || ("p" + Date.now()), d.title || "JK Admin", d.body || "");
    });
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && section === "bot") { unseen = 0; setBadge(); } });

  // --- Notifications on this device --------------------------------------
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let notifCats = null;
  function b64ToBytes(b64) {
    const pad = "=".repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  async function swReg() { return navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin" }); }
  async function currentSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration("/admin");
    return reg ? reg.pushManager.getSubscription() : null;
  }
  function chosenCats() { return [...document.querySelectorAll("#notifCats input:checked")].map(i => i.value); }
  async function checkNotif() {
    try {
      if (!notifCats) {
        const k = await api("/admin/api/push/key");
        notifCats = k.categories;
        $("notifCats").innerHTML = Object.entries(notifCats).map(([key, c]) =>
          '<div class="check"><input type="checkbox" id="nc-' + key + '" value="' + key + '"' + (c.on ? " checked" : "") + '>' +
          '<label for="nc-' + key + '" style="margin:0">' + esc(c.label) + '</label></div>').join("");
      }
      if (!pushSupported()) {
        $("notifState").textContent = "not supported here";
        $("notifHelp").textContent = isIos() && !standalone()
          ? "On iPhone: tap Share → Add to Home Screen, then open JK Admin from the home screen and turn notifications on there (iOS 16.4 or newer)."
          : "This browser can't show notifications. On Android use Chrome.";
        return;
      }
      const sub = await currentSub();
      const on = sub && Notification.permission === "granted";
      $("notifState").textContent = on ? "On" : Notification.permission === "denied" ? "Blocked in browser settings" : "Off";
      ["notifSave", "notifTest", "notifOff"].forEach(id => $(id).classList.toggle("hidden", !on));
      $("notifOn").classList.toggle("hidden", !!on);
      if (on) {
        const r = await api("/admin/api/push/device", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        if (r.device) { document.querySelectorAll("#notifCats input").forEach(i => { i.checked = r.device.categories.includes(i.value); }); myCats = r.device.categories.slice(); }
        else $("notifState").textContent = "Off (turn on again)";
      }
    } catch (e) { $("notifState").textContent = "unavailable"; }
  }
  function deviceLabel() {
    const ua = navigator.userAgent;
    return (/Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Device") +
      (/Mobile/.test(ua) ? " phone" : "");
  }
  async function saveSub(sub) {
    myCats = chosenCats();
    await api("/admin/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), categories: chosenCats(), label: deviceLabel() }) });
  }
  $("notifOn").addEventListener("click", async () => {
    const btn = $("notifOn"); btn.disabled = true;
    try {
      if (!pushSupported()) throw new Error($("notifHelp").textContent);
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications were not allowed. Allow them for this site in the browser settings.");
      const reg = await swReg();
      await navigator.serviceWorker.ready;
      const { publicKey } = await api("/admin/api/push/key");
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await saveSub(sub);
      await api("/admin/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      toast("Notifications are on for this device. A test alert is on its way.");
    } catch (e) { toast(e.message, 8000); }
    finally { btn.disabled = false; checkNotif(); }
  });
  $("notifSave").addEventListener("click", async () => {
    try { const sub = await currentSub(); if (!sub) throw new Error("Turn notifications on first."); await saveSub(sub); toast("Saved."); }
    catch (e) { toast(e.message); }
  });
  $("notifTest").addEventListener("click", async () => {
    try {
      const sub = await currentSub(); if (!sub) throw new Error("Turn notifications on first.");
      await api("/admin/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      toast("Test sent.");
    } catch (e) { toast(e.message); }
  });
  $("notifOff").addEventListener("click", async () => {
    try {
      const sub = await currentSub();
      if (sub) {
        await api("/admin/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      toast("Notifications are off for this device.");
    } catch (e) { toast(e.message); }
    finally { checkNotif(); }
  });
  async function refreshShop() {
    const r = await api("/admin/api/shop?view=" + shopView + "&q=" + encodeURIComponent(shopSearch));
    shopData = r;
    $("cntShop").textContent = r.counts.action ? " (" + r.counts.action + ")" : "";
    $("cntShopTab").textContent = r.counts.action ? " (" + r.counts.action + ")" : "";
    if (section === "shop" && !shopBusy()) renderShop();
  }

  async function refresh() {
    try {
      await refreshShop().catch(e => { if (e.message === "Please log in.") throw e; });
      data = await api("/admin/api/overview?view=" + view + "&q=" + encodeURIComponent(search));
      $("cntReports").textContent = data.counts?.action ? " (" + data.counts.action + ")" : "";
      renderOrders(); renderPayments();
      $("scanState").textContent = data.freeScanEnabled ? "" : "Admin Free Scan is currently disabled in the bot settings.";
      $("updated").textContent = "Updated " + new Date(data.now).toLocaleTimeString([], { timeStyle: "short" });
      if (drawerUser) loadThread();
    } catch (e) { if (e.message !== "Please log in.") toast(e.message); }
  }

  // --- customer drawer: conversation, reply, notes, send files ---------------
  function customerLabel(uid) {
    const j = data && data.jobs.find(x => String(x.userId) === String(uid) && !x.adminFreeScan);
    return (j && j.name ? j.name + (j.username ? " (@" + j.username + ")" : "") + " · " : "") + "ID " + uid +
      (j && j.web ? " · Website" : "");
  }
  function openDrawer(uid, focusSend) {
    drawerUser = String(uid);
    $("dwTitle").textContent = customerLabel(uid);
    $("dwNotes").innerHTML = Object.entries((data && data.notes) || {}).map(([k, label]) =>
      '<button class="btn" data-note="' + esc(k) + '">' + esc(label) + '</button>').join("");
    $("dwThread").innerHTML = '<p class="muted">Loading…</p>';
    $("dwReply").value = ""; $("dwFiles").value = ""; $("dwCaption").value = ""; $("dwSendMsg").textContent = "";
    $("drawer").classList.remove("hidden");
    document.body.classList.add("noscroll");
    loadThread();
    (focusSend ? $("dwSendBox") : $("dwReply")).scrollIntoView({ block: "nearest" });
    if (focusSend) $("dwFiles").focus();
  }
  function closeDrawer() {
    drawerUser = null;
    $("drawer").classList.add("hidden");
    document.body.classList.remove("noscroll");
  }
  async function loadThread() {
    const uid = drawerUser; if (!uid) return;
    try {
      const t = await api("/admin/api/users/" + uid + "/thread");
      if (uid !== drawerUser) return;
      const box = $("dwThread");
      const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      box.innerHTML = t.messages.length ? t.messages.map(m => (
        '<div class="msg ' + (m.from === "customer" ? "in" : "out") + (m.kind !== "text" ? " " + esc(m.kind) : "") + '">' +
        (m.kind === "file" ? "📎 " : "") + esc(m.text) +
        '<div class="meta">' + (m.from === "customer" ? "Customer" : "You") + ' · ' + esc(when(m.at)) + '</div></div>'
      )).join("") : '<p class="muted">No messages yet. Replies, notes and files you send from here or from Telegram appear here.</p>';
      if (atEnd || !box.dataset.loaded) box.scrollTop = box.scrollHeight;
      box.dataset.loaded = "1";
    } catch (e) { toast(e.message); }
  }

  $("dwClose").addEventListener("click", closeDrawer);
  $("drawer").addEventListener("click", ev => { if (ev.target === $("drawer")) closeDrawer(); });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && drawerUser) closeDrawer(); });

  $("dwReplyBtn").addEventListener("click", async () => {
    const text = $("dwReply").value.trim();
    if (!text) return toast("Write a message first.");
    const btn = $("dwReplyBtn"); btn.disabled = true;
    try {
      await api("/admin/api/users/" + drawerUser + "/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      $("dwReply").value = ""; toast("Reply sent."); await loadThread(); refresh();
    } catch (e) { toast(e.message); }
    finally { btn.disabled = false; }
  });

  $("dwSendBtn").addEventListener("click", async () => {
    const files = [...$("dwFiles").files];
    const out = $("dwSendMsg");
    if (!files.length) return toast("Choose at least one file.");
    if (files.length > 20) return toast("At most 20 files at a time.");
    const big = files.find(f => f.size > 20 * 1024 * 1024);
    if (big) return toast(big.name + " is larger than 20 MB.");
    const uid = drawerUser;
    const btn = $("dwSendBtn"); btn.disabled = true;
    let sent = 0;
    try {
      for (const [i, f] of files.entries()) {
        out.textContent = "Sending " + (i + 1) + " of " + files.length + ": " + f.name;
        await api("/admin/api/users/" + uid + "/deliver", { method: "PUT", body: f, headers: {
          "X-File-Name": encodeURIComponent(f.name), "Content-Type": "application/octet-stream",
          "X-Caption": i === 0 ? encodeURIComponent($("dwCaption").value) : "" } });
        sent++;
      }
      let done = "";
      if ($("dwMarkDone").checked) {
        const r = await api("/admin/api/users/" + uid + "/deliver/done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: sent }) });
        done = r.delivered ? " Order marked delivered and the customer was told." : " Customer told; no open order to mark.";
      }
      out.textContent = "✅ Sent " + sent + " file(s)." + done;
      $("dwFiles").value = ""; $("dwCaption").value = "";
      await loadThread(); refresh();
    } catch (e) {
      out.textContent = "❌ " + e.message + (sent ? " (" + sent + " file(s) were sent before this.)" : "");
    } finally { btn.disabled = false; }
  });

  // --- actions --------------------------------------------------------------
  document.addEventListener("change", ev => {
    const t = ev.target;
    if (!t.classList || !t.classList.contains("pick")) return;
    const ids = t.dataset.all ? t.dataset.all.split(",") : [t.dataset.pick];
    ids.forEach(id => t.checked ? selected.add(id) : selected.delete(id));
    renderOrders();
  });

  let shopSearchTimer = null;
  $("shopSearch").addEventListener("input", () => {
    clearTimeout(shopSearchTimer);
    shopSearchTimer = setTimeout(() => { shopSearch = $("shopSearch").value.trim(); refreshShop().catch(e => toast(e.message)); }, 300);
  });
  applySection();

  let searchTimer = null;
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { search = $("search").value.trim(); refresh(); }, 300);
  });

  document.addEventListener("click", async ev => {
    const t = ev.target.closest("button,a");
    if (!t) return;
    if (t.dataset.view) { view = t.dataset.view; selected.clear(); refresh(); return; }
    if (t.dataset.bfilter) { botFilter = t.dataset.bfilter; renderBotFilters(); if (botData) renderBot(); return; }
    if (t.dataset.cmd) { botSend(t.dataset.cmd); return; }
    if (t.dataset.bpress) {
      if (/send to all|delete|cancel|reject|disable|turn off/i.test(t.textContent) && !confirm("Tap “" + t.textContent + "”?")) return;
      t.disabled = true;
      try {
        const r = await api("/admin/api/bot/press", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: Number(t.dataset.bpress), data: t.dataset.bdata }) });
        if (r.toast) toast(r.toast);
        await refreshBot();
      } catch (e) { toast(e.message); } finally { t.disabled = false; }
      return;
    }
    if (t.dataset.section) {
      section = t.dataset.section;
      try { localStorage.setItem("jkSection", section); } catch {}
      applySection(); if (section === "shop" && shopData) renderShop(); refresh(); return;
    }
    if (t.dataset.sview) { shopView = t.dataset.sview; refreshShop().catch(e => toast(e.message)); return; }
    if (t.dataset.jobdone || t.dataset.jobundo) {
      const id = t.dataset.jobdone || t.dataset.jobundo;
      t.disabled = true;
      try {
        await api("/admin/api/jobs/" + encodeURIComponent(id) + "/done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: !!t.dataset.jobdone }) });
        toast(t.dataset.jobdone ? "Marked done." : "Back in Needs action."); await refresh();
      } catch (e) { toast(e.message); } finally { t.disabled = false; }
      return;
    }
    if (t.dataset.sdone || t.dataset.sundo) {
      const id = t.dataset.sdone || t.dataset.sundo;
      t.disabled = true;
      try {
        await api("/admin/api/shop/" + id + "/done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: !!t.dataset.sdone }) });
        toast(t.dataset.sdone ? "Marked done." : "Back in Needs action."); await refreshShop();
      } catch (e) { toast(e.message); } finally { t.disabled = false; }
      return;
    }
    if (t.dataset.sreply) {
      const id = t.dataset.sreply;
      const box = document.querySelector('[data-sreplytext="' + id + '"]');
      const text = (box.value || "").trim();
      if (!text) return toast("Write a message first.");
      t.disabled = true;
      try {
        await api("/admin/api/shop/" + id + "/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        box.value = ""; box.blur(); toast("Reply sent — it shows on the customer's order page.");
        setTimeout(() => refreshShop().catch(() => {}), 2500);
      } catch (e) { toast(e.message, 7000); } finally { t.disabled = false; }
      return;
    }
    if (t.dataset.sfilebtn) {
      const id = t.dataset.sfilebtn;
      const input = document.querySelector('[data-sfile="' + id + '"]');
      const f = input.files && input.files[0];
      if (!f) return toast("Choose a file first.");
      if (f.size > 20 * 1024 * 1024) return toast("Files must be 20 MB or smaller.");
      const caption = (document.querySelector('[data-sreplytext="' + id + '"]').value || "").trim();
      t.disabled = true; toast("Sending " + f.name + "…", 20000);
      try {
        await api("/admin/api/shop/" + id + "/file", { method: "PUT", body: f, headers: {
          "X-File-Name": encodeURIComponent(f.name), "X-Caption": encodeURIComponent(caption), "Content-Type": "application/octet-stream" } });
        input.value = ""; document.querySelector('[data-sreplytext="' + id + '"]').value = "";
        toast("File sent — the customer can download it on their order page.");
        setTimeout(() => refreshShop().catch(() => {}), 2500);
      } catch (e) { toast(e.message, 7000); } finally { t.disabled = false; }
      return;
    }
    if (t.id === "delClear") { selected.clear(); renderOrders(); return; }
    if (t.id === "delBtn") {
      const ids = [...selected];
      if (!ids.length) return;
      if (!confirm("Delete the stored files and reports for " + ids.length + " file(s)?\n\nThis cannot be undone. Files sent in Telegram also stay on Telegram's own servers.")) return;
      t.disabled = true;
      try {
        const r = await api("/admin/api/files/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
        r.deleted.forEach(id => selected.delete(id));
        toast("Deleted " + r.deleted.length + " file(s)." + (r.skipped.length ? " Skipped: " + r.skipped.map(s => s.id + " (" + s.reason + ")").join("; ") : ""), 8000);
        await refresh();
      } catch (e) { toast(e.message); }
      finally { t.disabled = false; }
      return;
    }
    if (t.dataset.tab) {
      document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b === t));
      ["orders", "payments", "scan", "send"].forEach(n => $("tab-" + n).classList.toggle("hidden", n !== t.dataset.tab));
      return;
    }
    if (t.dataset.open) return openDrawer(t.dataset.open, false);
    if (t.dataset.send) return openDrawer(t.dataset.send, true);
    if (t.dataset.dl) {
      ev.preventDefault();
      try {
        const res = await fetch(t.getAttribute("href"), { headers: H, credentials: "same-origin" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || ("Download failed (" + res.status + ")"));
        }
        const cd = res.headers.get("content-disposition") || "";
        const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a"); a.href = url;
        a.download = m ? decodeURIComponent(m[1]) : decodeURIComponent(t.getAttribute("href").split("/").pop());
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (e) { toast(e.message); }
      return;
    }
    const act = async (fn, ok) => { t.disabled = true; try { await fn(); toast(ok); await refresh(); } catch (e) { toast(e.message); } finally { t.disabled = false; } };
    if (t.dataset.note) {
      const label = t.textContent;
      if (!confirm("Send \"" + label + "\" to " + customerLabel(drawerUser) + "?")) return;
      return act(async () => { await api("/admin/api/users/" + drawerUser + "/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: t.dataset.note }) }); await loadThread(); }, "Note sent.");
    }
    if (t.dataset.retry) return act(() => api("/admin/api/files/" + t.dataset.retry + "/retry", { method: "POST" }), "Retry started.");
    if (t.dataset.stop) return act(() => api("/admin/api/files/" + t.dataset.stop + "/stop", { method: "POST" }), "Automatic retries stopped.");
    if (t.dataset.confirm) {
      if (!confirm("Confirm the latest payment for user " + t.dataset.confirm + "?")) return;
      return act(async () => { const r = await api("/admin/api/payments/" + t.dataset.confirm + "/confirm", { method: "POST" }); if (!r.ok) throw new Error(r.message); }, "Payment confirmed.");
    }
    if (t.dataset.cancel) {
      if (!confirm("Cancel the pending payment for user " + t.dataset.cancel + "?")) return;
      return act(async () => { const r = await api("/admin/api/payments/" + t.dataset.cancel + "/cancel", { method: "POST" }); if (r.ok === false) throw new Error(r.message); }, "Payment cancelled.");
    }
  });

  $("startScan").addEventListener("click", async () => {
    const files = [...$("scanFiles").files];
    const out = $("scanMsg");
    if (!files.length) return toast("Choose at least one document.");
    if (files.length > 10) return toast("At most 10 documents per batch.");
    const btn = $("startScan"); btn.disabled = true;
    try {
      const uploads = [];
      for (const [i, f] of files.entries()) {
        out.textContent = "Uploading " + (i + 1) + " of " + files.length + ": " + f.name;
        const r = await api("/admin/api/uploads", { method: "PUT", headers: { "X-File-Name": encodeURIComponent(f.name), "Content-Type": "application/octet-stream" }, body: f });
        uploads.push(r.uploadId);
      }
      out.textContent = "Starting scan…";
      const r = await api("/admin/api/free-scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploads, service: $("service").value, excludeBibliography: $("exBib").checked, excludeQuotes: $("exQuotes").checked })
      });
      out.textContent = "Started: " + r.files + " file(s). Follow it under Orders → Free scans.";
      $("scanFiles").value = "";
      await refresh();
    } catch (e) { out.textContent = e.message; }
    finally { btn.disabled = false; }
  });

  $("sendBtn").addEventListener("click", async () => {
    const f = $("sendFile").files[0];
    const to = $("toUser").value.trim();
    const out = $("sendMsg");
    if (!to || !f) return toast("Enter the user ID and choose a file.");
    const btn = $("sendBtn"); btn.disabled = true; out.textContent = "Sending…";
    try {
      await api("/admin/api/send", { method: "PUT", body: f, headers: {
        "X-To-User": to, "X-File-Name": encodeURIComponent(f.name),
        "X-Caption": encodeURIComponent($("caption").value), "Content-Type": "application/octet-stream" } });
      out.textContent = "Sent to " + to + ".";
      $("sendFile").value = ""; $("caption").value = "";
    } catch (e) { out.textContent = e.message; }
    finally { btn.disabled = false; }
  });

  $("logout").addEventListener("click", async () => { try { await api("/admin/api/logout", { method: "POST" }); } catch {} closeDrawer(); showLogin(); });

  if (document.body.dataset.totp === "1") { $("codeWrap").classList.remove("hidden"); $("rTotpWrap").classList.remove("hidden"); $("cTotpWrap").classList.remove("hidden"); }
  // JK_ADMIN_EMAIL_LOGIN_V1
  if (document.body.dataset.email === "1") { $("emailWrap").classList.remove("hidden"); $("em").required = true; }
  if (document.body.dataset.reset === "1") $("forgotWrap").classList.remove("hidden");
  const showReset = on => {
    $("loginForm").classList.toggle("hidden", on); $("resetForm").classList.toggle("hidden", !on);
    if (on) { $("rEmail").value = $("em").value; $("resetMsg").textContent = ""; $("resetMsg").className = ""; $("resetStep2").classList.add("hidden"); }
  };
  $("forgotLink").addEventListener("click", ev => { ev.preventDefault(); showReset(true); });
  $("backToLogin").addEventListener("click", ev => { ev.preventDefault(); showReset(false); });
  const resetSay = (text, bad) => { $("resetMsg").textContent = text; $("resetMsg").className = bad ? "bad" : "ok"; };
  $("sendCode").addEventListener("click", async () => {
    const email = $("rEmail").value.trim();
    if (!email) return resetSay("Enter the admin email.", true);
    $("sendCode").disabled = true;
    try {
      const r = await api("/admin/api/password/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      resetSay(r.message || "Check your email for the code.");
      $("resetStep2").classList.remove("hidden"); $("sendCode").textContent = "Send a new code"; $("rCode").focus();
    } catch (e) { resetSay(e.message, true); }
    finally { setTimeout(() => { $("sendCode").disabled = false; }, 30000); }
  });
  $("resetForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    if ($("rPw").value !== $("rPw2").value) return resetSay("The two new passwords don't match.", true);
    try {
      await api("/admin/api/password/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        email: $("rEmail").value.trim(), code: $("rCode").value.trim(), totp: $("rTotp").value.trim(), password: $("rPw").value }) });
      $("rPw").value = $("rPw2").value = $("rCode").value = "";
      showReset(false);
      $("em").value = $("rEmail").value;
      $("loginErr").className = "ok"; $("loginErr").textContent = "Password changed. Log in with the new password.";
    } catch (e) { resetSay(e.message, true); }
  });
  // Change password (signed in).
  const pwModal = on => { $("pwModal").classList.toggle("hidden", !on); $("pwMsg").textContent = ""; if (on) $("cCur").focus(); else $("pwForm").reset(); };
  $("pwBtn").addEventListener("click", () => pwModal(true));
  $("pwCancel").addEventListener("click", () => pwModal(false));
  $("pwModal").addEventListener("click", ev => { if (ev.target === $("pwModal")) pwModal(false); });
  $("pwForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    if ($("cNew").value !== $("cNew2").value) { $("pwMsg").textContent = "The two new passwords don't match."; return; }
    try {
      await api("/admin/api/password/change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        current: $("cCur").value, password: $("cNew").value, code: $("cTotp").value.trim() }) });
      pwModal(false);
      toast("Password changed. Other devices were signed out.", 6000);
    } catch (e) { $("pwMsg").textContent = e.message; }
  });
  $("loginForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    $("loginErr").textContent = "";
    try {
      await api("/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: $("em").value.trim(), password: $("pw").value, code: $("code").value }) });
      $("pw").value = ""; $("code").value = "";
      showApp();
    } catch (e) { $("loginErr").textContent = e.message; }
  });

  // Already logged in (cookie still valid)?
  fetch("/admin/api/overview?view=action", { headers: H, credentials: "same-origin" })
    .then(r => { if (r.ok) showApp(); }).catch(() => {});
})();
