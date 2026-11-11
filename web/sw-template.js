/*
 * Cabin Fever service worker (GitHub Pages build; tools/build-pages.js fills in the lists).
 * Every file of the game is cached in the browser under its content hash. A new deploy lists new
 * hashes: on install only files whose hash changed are downloaded; the rest come from the cache.
 * Music and the narrator voice are saved in the background once the TV asks (also by hash). Live connections (PeerJS) are
 * never touched. Once loaded, the game files work offline. AGPLv3 — see LICENSE.
 */
'use strict';

const VERSION = '__VERSION__';
/** @type {Record<string, string>} path (relative to this worker) → content hash */
const FILES = __FILES__;
/** @type {Record<string, string>} music tracks + the narrator voice → content hash (saved in the background) */
const MEDIA = __MEDIA__;
/** @type {string[]} the files a phone needs: saved on install everywhere (the TV asks for the rest) */
const PHONE = __PHONE__;
const CACHE = 'cabin-fever-files';
const scope = new URL('./', self.location.href).href;
/** @param {string} rel @param {string} h */
const key = (rel, h) => scope + rel + '?v=' + h;

/** Tell every open page how far saving has got. @param {string} stage @param {number} done @param {number} total */
async function progress(stage, done, total) {
  const all = await /** @type {any} */ (self).clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of all) c.postMessage({ cf: 'progress', stage, done, total });
}
/** Save files into the cache (6 at a time), skipping ones already saved. @param {[string, string][]} list @param {string} stage */
async function save(list, stage) {
  const cache = await caches.open(CACHE);
  let done = 0;
  const total = list.length;
  void progress(stage, 0, total);
  const queue = list.slice();
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [rel, h] = next;
      try {
        if (!(await cache.match(key(rel, h)))) { // unchanged since the last visit: nothing to fetch
          const res = await fetch(scope + rel, { cache: 'no-cache' });
          if (res.ok) await cache.put(key(rel, h), res);
        }
      } catch (e) { /* offline or a hiccup: fetched on first use instead */ }
      done++;
      if (done % 3 === 0 || done === total) void progress(stage, done, total);
    }
  };
  await Promise.all([0, 1, 2, 3, 4, 5].map(worker));
  await progress(stage, total, total);
}

self.addEventListener('install', (/** @type {any} */ e) => {
  const list = PHONE.filter((r) => FILES[r]).map((r) => /** @type {[string, string]} */ ([r, FILES[r]]));
  e.waitUntil(save(list, 'phone').then(() => /** @type {any} */ (self).skipWaiting()));
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

// GitHub Pages can't send headers, so the worker adds them: the TV page (and the narrator's voice
// worker) become cross-origin isolated, which lets the natural voice use several CPU cores.
// Everything they load is from this site. (See server.js for the Docker side.)
const ISOLATE = /^(host|admin|highlights)\.html$|^tts-worker\.js$|^tts\//;
/** @param {string} rel @param {Response} res */
function isolate(rel, res) {
  if (!ISOLATE.test(rel) || res.type === 'opaque') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', (/** @type {any} */ e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(scope)) return;
  let rel = req.url.slice(scope.length).split(/[?#]/)[0];
  if (rel === '' ) rel = 'index.html';
  if (!rel.includes('.') && FILES[rel + '.html']) rel += '.html'; // /play → play.html
  const h = FILES[rel] || MEDIA[rel];
  if (!h) return; // not ours: normal network
  if (req.headers.has('range')) {
    // <audio> asks for byte ranges: answer from the saved copy if there is one (works offline).
    e.respondWith((async () => {
      const hit = await (await caches.open(CACHE)).match(key(rel, h));
      if (!hit) return fetch(req);
      const buf = await hit.arrayBuffer();
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1;
      return new Response(buf.slice(start, end + 1), { status: 206, headers: {
        'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key(rel, h));
    if (hit) return isolate(rel, hit);
    const res = await fetch(scope + rel);
    if (res.ok) await cache.put(key(rel, h), res.clone());
    return isolate(rel, res);
  })());
});

// Tells the page which build it runs (shown in the debug panel); the TV asks for the music and
// voice to be saved too once the game itself is.
/** @type {Promise<void> | null} */
let tvSaving = null;
self.addEventListener('message', (/** @type {any} */ e) => {
  if (e.data === 'version' && e.source) e.source.postMessage({ version: VERSION });
  // The TV: every game file (progress bar), then music + the voice in the background.
  if (e.data === 'cache-tv') {
    if (!tvSaving) tvSaving = save(Object.entries(FILES), 'core').then(() => save(Object.entries(MEDIA), 'media')).finally(() => { tvSaving = null; });
    else void progress('core', 1, 1); // already saving: a second TV tab just needs to know the game is there
    e.waitUntil(tvSaving);
  }
});
