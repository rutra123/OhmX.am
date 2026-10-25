const CACHE = 'ohmx-shell-v2';
const ASSETS = ['/', '/manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => null));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/@vite/') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/')) {
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      const cache = await caches.open(CACHE);
      cache.put(event.request, response.clone()).catch(() => null);
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw new Error('Network error');
    }
  })());
});
