const SW_VERSION = 'v2';
const CACHE_NAME = `vhg-${SW_VERSION}`;
const SHELL_ASSETS = [
  `/manifest.json?v=${SW_VERSION}`,
  `/icon-192.png?v=${SW_VERSION}`,
  `/icon-512.png?v=${SW_VERSION}`,
];

self.addEventListener('install', (event) => {
  console.log('[VHG SW] registrado v2');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    // Network-first: always try live data, fall back to cache only if offline
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-first for the HTML shell itself so new deploys/copy changes show
  // up immediately instead of being pinned by a stale cache-first response.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for the remaining static assets (icons, manifest, etc.)
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// Handles taps on notification action buttons (see index.html for how
// notifications are actually shown — the SW only reacts to clicks here,
// it does not schedule or poll for anything in the background).
self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  event.notification.close();
  if (action === 'dismiss') return;

  const targetUrl = action === 'scan' ? '/?action=scan' : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification-action', action: action || 'open' });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
