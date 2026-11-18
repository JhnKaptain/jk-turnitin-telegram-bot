"use strict";
// JK_ADMIN_WEB_PANEL_V1: browser side of /admin. Every request carries the
// X-Admin-Panel header; the session lives in an HttpOnly cookie.
(function () {
  const $ = id => document.getElementById(id);
  const H = { "X-Admin-Panel": "1" };
  let data = null;
  let timer = null;

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

  function showLogin() {
    clearInterval(timer);
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
  }
  function showApp() {
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    refresh(); clearInterval(timer); timer = setInterval(refresh, 20000);
  }

  // --- rendering ----------------------------------------------------------
  function fileStatus(f, now) {
    if (f.status === "FAILED") {
      if (f.retryStopped) return '<span class="chip bad">Failed · retries stopped</span>';
      if (f.retryAt) return '<span class="chip warn">Failed · retry ' + f.retryCount + '/3 in ~' + mins(f.retryAt, now) + ' min</span>';
      if (f.retryExhausted) return '<span class="chip bad">Failed · retries used up</span>';
      return '<span class="chip bad">Failed</span>';
    }
    if (f.status === "COMPLETE") return '<span class="chip ok">Complete</span>';
    if (f.status === "MANUAL_REQUIRED") return '<span class="chip warn">Manual review</span>';
    return '<span class="chip">' + esc(f.status || "Waiting") + '</span>';
  }
  function renderOrders() {
    const box = $("tab-orders");
    if (!data.jobs.length) { box.innerHTML = '<div class="card muted">No orders yet.</div>'; return; }
    box.innerHTML = data.jobs.map(j => (
      '<div class="card"><div class="row"><strong>' + (j.adminFreeScan ? "Free scan" : "Order") + '</strong>' +
      '<span class="chip">' + esc(j.status || "") + '</span>' +
      '<span class="muted">User ' + esc(j.userId) + ' · ' + esc(when(j.createdAt)) + '</span></div>' +
      j.files.map(f => (
        '<div class="file"><div class="row"><strong>' + esc(f.name) + '</strong>' + fileStatus(f, data.now) +
        (f.similarity != null ? '<span class="muted">Similarity ' + Math.round(f.similarity) + '%</span>' : '') +
        (f.ai != null ? '<span class="muted">AI ' + Math.round(f.ai) + '%</span>' : '') + '</div>' +
        (f.error ? '<div class="err bad">' + esc(f.error) + '</div>' : '') +
        '<div class="row" style="margin-top:6px">' +
        f.reports.map(r => '<a class="dl" href="/admin/api/files/' + esc(f.id) + '/reports/' + encodeURIComponent(r) + '" data-dl="1">⬇ ' + esc(r) + '</a>').join(" ") +
        (f.status === "FAILED" && f.id ? (
          (f.retryAt && !f.retryStopped ? '<button class="btn danger" data-stop="' + esc(f.id) + '">Stop retries</button>' : '') +
          '<button class="btn" data-retry="' + esc(f.id) + '">Retry now</button>') : '') +
        '</div></div>'
      )).join("") + '</div>'
    )).join("");
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
        '<button class="btn danger" data-cancel="' + esc(p.userId) + '">Cancel pay</button></div></div>';
    }).join("");
  }
  async function refresh() {
    try {
      data = await api("/admin/api/overview");
      renderOrders(); renderPayments();
      $("scanState").textContent = data.freeScanEnabled ? "" : "Admin Free Scan is currently disabled in the bot settings.";
      $("updated").textContent = "Updated " + new Date(data.now).toLocaleTimeString([], { timeStyle: "short" });
    } catch (e) { if (e.message !== "Please log in.") toast(e.message); }
  }

  // --- actions --------------------------------------------------------------
  document.addEventListener("click", async ev => {
    const t = ev.target.closest("button,a");
    if (!t) return;
    if (t.dataset.tab) {
      document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b === t));
      ["orders", "payments", "scan", "send"].forEach(n => $("tab-" + n).classList.toggle("hidden", n !== t.dataset.tab));
      return;
    }
    if (t.dataset.dl) {
      ev.preventDefault();
      try {
        const res = await fetch(t.getAttribute("href"), { headers: H, credentials: "same-origin" });
        if (!res.ok) throw new Error("Download failed (" + res.status + ")");
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a"); a.href = url; a.download = decodeURIComponent(t.getAttribute("href").split("/").pop());
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (e) { toast(e.message); }
      return;
    }
    const act = async (fn, ok) => { t.disabled = true; try { await fn(); toast(ok); await refresh(); } catch (e) { toast(e.message); } finally { t.disabled = false; } };
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
      out.textContent = "Started: " + r.files + " file(s). Follow it under Orders.";
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

  $("logout").addEventListener("click", async () => { try { await api("/admin/api/logout", { method: "POST" }); } catch {} showLogin(); });

  if (document.body.dataset.totp === "1") $("codeWrap").classList.remove("hidden");
  $("loginForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    $("loginErr").textContent = "";
    try {
      await api("/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: $("pw").value, code: $("code").value }) });
      $("pw").value = ""; $("code").value = "";
      showApp();
    } catch (e) { $("loginErr").textContent = e.message; }
  });

  // Already logged in (cookie still valid)?
  fetch("/admin/api/overview", { headers: H, credentials: "same-origin" })
    .then(r => { if (r.ok) showApp(); }).catch(() => {});
})();
