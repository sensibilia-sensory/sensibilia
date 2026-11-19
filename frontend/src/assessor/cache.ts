import { withTimeout } from '../shared/timeout';

export async function cacheShell(sessionId?: string) {
  if (!('serviceWorker' in navigator))
    throw new Error('Offline execution requires a secure origin with service-worker support.');
  const registration = await withTimeout(
    navigator.serviceWorker.register('/assessor/sw.js', { scope: '/assessor/' }),
    30000,
    'Offline shell registration timed out. Retry preparation.',
  );
  let worker = registration.active;
  if (!worker) {
    const installing = registration.installing ?? registration.waiting;
    if (!installing) throw new Error('Offline shell is not active. Retry preparation.');
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Offline shell activation timed out.')),
        30000,
      );
      const changed = () => {
        if (installing.state === 'activated' || installing.state === 'redundant') {
          clearTimeout(timeout);
          installing.removeEventListener('statechange', changed);
          installing.state === 'activated'
            ? resolve()
            : reject(new Error('Offline shell activation failed.'));
        }
      };
      installing.addEventListener('statechange', changed);
      changed();
    });
    worker = registration.active;
  }
  if (!worker) throw new Error('Offline shell is not active. Retry preparation.');
  const urls = [
    location.href,
    location.origin + '/assessor/',
    ...(sessionId ? [location.origin + '/assessor/sessions/' + sessionId] : []),
    location.origin + '/assessor/manifest.webmanifest',
    location.origin + '/assessor/icon.svg',
    location.origin + '/assessor/icon-192.png',
    ...performance.getEntriesByType('resource').map((e) => e.name),
  ].filter((url) => {
    const parsed = new URL(url);
    return parsed.origin === location.origin && ['http:', 'https:'].includes(parsed.protocol);
  });
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(
      () => reject(new Error('Offline shell preparation timed out.')),
      30000,
    );
    channel.port1.onmessage = (e) => {
      clearTimeout(timeout);
      e.data.ok ? resolve() : reject(new Error(e.data.error));
    };
    worker.postMessage({ kind: 'cache-shell', urls }, [channel.port2]);
  });
  const durable = await navigator.storage.persist();
  return durable;
}
