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
