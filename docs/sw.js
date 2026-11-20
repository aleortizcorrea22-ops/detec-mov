// Service worker: permite instalar la app y la abre rápido aunque la red sea lenta.
// - Archivos de la app: red primero, caché si no hay conexión.
// - Librería y modelos de detección (pesados): caché primero.
// - /api/* (alertas y cámara): siempre por red, nunca en caché.
// Todo relativo a la propia carpeta del service worker, para que ande igual serví­do
// en la raíz de un dominio o en una subcarpeta (por ejemplo GitHub Pages).
const VERSION = 'detecmov-v13';
const BASE = new URL('.', self.location.href); // ej.: https://host/ o https://host/detec-mov/
const SHELL = [
  './', 'index.html', 'ver.html', 'manual.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/rules.js', 'js/people.js', 'js/install.js', 'js/telegram-direct.js', 'js/licencia.js', 'js/admin-panel.js', 'js/qrcode-lib.js',
  'icons/icon-192.png', 'icons/icon-512.png',
].map((p) => new URL(p, BASE).href);

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
  if (url.origin === self.location.origin && url.pathname.includes('/api/')) return;

  // Librería y modelos de detección: pesados, no cambian, y pueden venir de otro origen
  // (CDN) si no hay servidor propio. Se guardan y se reusan aunque no haya red.
  const heavy = url.pathname.includes('/vendor/') || url.pathname.includes('/models/') || url.hostname === 'storage.googleapis.com' || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdnjs.cloudflare.com';
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
      .catch(() => caches.match(req).then((r) => r || caches.match(new URL('index.html', BASE).href))),
  );
});
