/*
 * Cabin Fever service worker (GitHub Pages build; tools/build-pages.js fills in the lists).
 * Every file of the game is cached in the browser under its content hash. A new deploy lists new
 * hashes: on install only files whose hash changed are downloaded; the rest come from the cache.
 * Music is cached the first time a track plays (also by hash). Live connections (PeerJS) are
 * never touched. Once loaded, the game files work offline. AGPLv3 — see LICENSE.
 */
'use strict';

const VERSION = '__VERSION__';
/** @type {Record<string, string>} path (relative to this worker) → content hash */
const FILES = __FILES__;
/** @type {Record<string, string>} music track → content hash */
const MEDIA = __MEDIA__;
const CACHE = 'cabin-fever-files';
const scope = new URL('./', self.location.href).href;
/** @param {string} rel @param {string} h */
const key = (rel, h) => scope + rel + '?v=' + h;

self.addEventListener('install', (/** @type {any} */ e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(Object.entries(FILES).map(async ([rel, h]) => {
      if (await cache.match(key(rel, h))) return; // unchanged since the last visit
      const res = await fetch(scope + rel, { cache: 'no-cache' });
      if (res.ok) await cache.put(key(rel, h), res);
    }));
    /** @type {any} */ (self).skipWaiting();
  })());
});

self.addEventListener('activate', (/** @type {any} */ e) => {
  e.waitUntil((async () => {
    // Drop copies whose hash is no longer current (old versions of changed files).
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
      const u = new URL(req.url);
      const rel = u.href.slice(scope.length).split('?')[0];
      const want = FILES[rel] || MEDIA[rel];
      if (!want || u.searchParams.get('v') !== want) await cache.delete(req);
    }
    await /** @type {any} */ (self).clients.claim();
  })());
});

self.addEventListener('fetch', (/** @type {any} */ e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(scope)) return;
  let rel = req.url.slice(scope.length).split(/[?#]/)[0];
  if (rel === '' ) rel = 'index.html';
  if (!rel.includes('.') && FILES[rel + '.html']) rel += '.html'; // /play → play.html
  const h = FILES[rel] || MEDIA[rel];
  if (!h || req.headers.has('range')) return; // not ours (or a partial music request): normal network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key(rel, h));
    if (hit) return hit;
    const res = await fetch(scope + rel);
    if (res.ok) await cache.put(key(rel, h), res.clone());
    return res;
  })());
});

// Tells the page which build it runs (shown in the debug panel).
self.addEventListener('message', (/** @type {any} */ e) => { if (e.data === 'version' && e.source) e.source.postMessage({ version: VERSION }); });
