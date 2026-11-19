"use strict";
// JK_ADMIN_PUSH_V1: shows the admin's notifications; tapping one opens the panel.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "JK Admin", body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || "JK Admin", {
    body: d.body || "", tag: d.tag || undefined, renotify: Boolean(d.tag),
    icon: "/admin/icon-192.png", badge: "/admin/icon-192.png",
    data: { url: d.url || "/admin#bot" }
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/admin#bot", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (new URL(c.url).pathname.startsWith("/admin")) { c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
