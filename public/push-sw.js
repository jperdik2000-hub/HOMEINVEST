// Push-only service worker. NOT for app-shell caching.
// Handles incoming web-push messages and click-through deep links.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    data = { title: 'Poker Club', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Poker Club';
  const options = {
    body: data.body || '',
    icon: '/poker-icon-512.png',
    badge: '/poker-icon-512.png',
    tag: data.tag || undefined,
    renotify: data.tag ? true : false,
    data: { url: data.url || '/dashboard' },
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Update home-screen app icon badge count.
    try {
      if (self.navigator && 'setAppBadge' in self.navigator) {
        const notes = await self.registration.getNotifications();
        await self.navigator.setAppBadge(notes.length || 1);
      }
    } catch (_) {}
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      client.postMessage({ type: 'poker-club-notification', payload: data });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/dashboard';
  event.waitUntil((async () => {
    try {
      if (self.navigator && 'setAppBadge' in self.navigator) {
        const remaining = await self.registration.getNotifications();
        if (remaining.length > 0) await self.navigator.setAppBadge(remaining.length);
        else await self.navigator.clearAppBadge();
      }
    } catch (_) {}
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      try {
        const u = new URL(client.url);
        if (u.pathname === url || client.url.endsWith(url)) {
          await client.focus();
          return;
        }
      } catch (_) {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});