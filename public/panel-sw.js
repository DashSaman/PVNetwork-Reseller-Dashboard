/* Private/authenticated responses are NEVER cached. Only this fixed static list. */
const CACHE = 'pvnet-panel-static-v1';
const STATIC = ['/offline.html', '/icons/panel-192.png', '/icons/panel-512.png', '/fonts/Vazirmatn-var.woff2'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC))); self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('pvnet-panel-static-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  if (STATIC.includes(url.pathname)) event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
  // Root document is network-only; offline page contains no account information.
  else if (event.request.mode === 'navigate' && url.pathname === '/') event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match('/offline.html'))));
});
