// Service Worker: نمایش اعلان‌ها و باز کردن برنامه با کلیک روی اعلان؛ نصب برنامه روی صفحه‌ی اصلی گوشی.
// عمداً چیزی را کش نمی‌کند تا همیشه آخرین نسخه‌ی برنامه نمایش داده شود.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // لازم برای قابلیت نصب در بعضی مرورگرها

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "#home";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        c.postMessage({ link });
        return;
      }
    }
    await self.clients.openWindow("/" + link);
  })());
});

// اعلان از سرور (حتی وقتی برنامه بسته است)
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "زوزو", {
    body: d.body || "", tag: `zozo-${d.id || Date.now()}`, data: { link: d.link || "#home" },
    icon: "/static/icon-192.png", badge: "/static/badge-96.png", lang: "fa", dir: "rtl",
  }));
});

// اگر مرورگر اشتراک را عوض کرد، اشتراک تازه دوباره ثبت شود
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const r = await fetch("/api/push/key", { credentials: "same-origin" });
    if (!r.ok) return;
    const { key } = await r.json();
    const pad = "=".repeat((4 - (key.length % 4)) % 4);
    const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    await fetch("/api/push/subscribe", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), device: "auto" }) });
  })());
});
