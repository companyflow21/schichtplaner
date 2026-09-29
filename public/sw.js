/* Service Worker fuer Browser-Push. Der Hinweis ist inhaltsleer; ein Klick
   oeffnet das Postfach der App. Kein Caching, keine Ortung. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || "AKRO Dienstplan", {
    body: data.body || "Es gibt eine neue Mitteilung zu deinem Dienstplan.",
    icon: "/akro/img/app-icon-192.png",
    badge: "/akro/img/app-icon-192.png",
    tag: "akro-dienstplan",
    renotify: true,
    data: { url: data.url || "/portal/inbox" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/portal/inbox", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin)) { await client.focus(); return client.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
