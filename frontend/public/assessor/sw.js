/* Restricted shell cache. Credentials and API responses live only in IndexedDB. */
const CACHE = 'sensibilia-assessor-shell-1';
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data?.kind !== 'cache-shell') return;
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        for (const raw of event.data.urls) {
          const url = new URL(raw, self.location.origin);
          if (
            url.origin !== self.location.origin ||
            [
              '/sessions',
              '/studies',
              '/test-types',
              '/terminals',
              '/terminal-pairings',
              '/rooms',
              '/booth-assignments',
              '/booth-board',
              '/operator',
              '/operations',
            ].some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'))
          )
            continue;
          const response = await fetch(url.href, { cache: 'reload' });
          if (!response.ok) throw new Error('Shell resource unavailable: ' + url.pathname);
          await cache.put(url.href, response);
        }
        event.ports[0].postMessage({ ok: true });
      } catch (e) {
        event.ports[0].postMessage({ ok: false, error: e.message });
      }
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    [
      '/sessions',
      '/studies',
      '/test-types',
      '/terminals',
      '/rooms',
      '/booth-assignments',
      '/booth-board',
      '/operator',
      '/operations',
    ].some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'))
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (event.request.mode === 'navigate') {
        try {
          return await fetch(event.request);
        } catch {
          return (
            (await cache.match(event.request, { ignoreSearch: true, ignoreVary: true })) ||
            Response.error()
          );
        }
      }
      return (await cache.match(event.request, { ignoreVary: true })) || fetch(event.request);
    })(),
  );
});
