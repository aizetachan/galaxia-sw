const CACHE_NAME = 'galaxia-sw-cache-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // No cachees nada que no sea GET
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    const url = new URL(req.url);
    const isApi = url.pathname.startsWith('/api/');
    const hasRange = req.headers.has('range');

    // Pasa de API, streams y peticiones con Range (SSE/streaming/206)
    if (isApi || hasRange) {
      try {
        return await fetch(req);
      } catch (e) {
        return new Response('Offline', { status: 503 });
      }
    }

    // Cache-first con fallback a red
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const net = await fetch(req);

      // No intentes cachear parciales/opaque/redirect ni status != 200
      const ct = net.headers.get('content-type') || '';
      const isStream = ct.includes('text/event-stream');

      if (net.status === 200 && net.type === 'basic' && !isStream) {
        try { await cache.put(req, net.clone()); } catch (_) {}
      }

      return net;
    } catch (_) {
      return new Response('Offline', { status: 503 });
    }
  })());
});

