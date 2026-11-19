// Service worker: permite instalar la app y la abre rápido aunque la red sea lenta.
// - Archivos de la app: red primero, caché si no hay conexión.
// - Librería y modelos de detección (pesados): caché primero.
// - /api/* (alertas y cámara): siempre por red, nunca en caché.
const VERSION = 'detecmov-v1';
const SHELL = [
  '/', '/index.html', '/styles.css', '/manifest.webmanifest',
  '/js/app.js', '/js/rules.js', '/js/install.js',
  '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== `${VERSION}-models`).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  const heavy = url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/models/') || url.hostname === 'storage.googleapis.com';
  if (heavy) {
    e.respondWith(
      caches.open(`${VERSION}-models`).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/index.html'))),
  );
});
