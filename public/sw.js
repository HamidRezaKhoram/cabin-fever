/* Service worker: phones can install HomeJack and reopen it instantly.
 * Network-first for everything (the server is on the LAN, so fresh code always
 * wins), falling back to the cached copy if the Wi-Fi blips. Live data
 * (socket.io, /api) is never cached. AGPLv3 — see LICENSE. */
'use strict';
const CACHE = 'homejack-v1';
const SHELL = ['/play', '/style.css', '/common.js', '/clock.js', '/debug.js', '/sprites.js', '/avatar-maker.js',
  '/bg.js', '/draw.js', '/games.js', '/play.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (/** @type {any} */ e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  /** @type {any} */ (self).skipWaiting();
});
self.addEventListener('activate', (/** @type {any} */ e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});
self.addEventListener('fetch', (/** @type {any} */ e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || /^\/(socket\.io|api|music|qr\.svg)/.test(url.pathname)) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); void caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || Response.error())));
});
