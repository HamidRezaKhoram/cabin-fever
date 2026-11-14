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

/** @type {Record<string, number>} every file's size in bytes (progress is counted in bytes, not files) */
const SIZES = __SIZES__;
/** A download is given up when no bytes have arrived for this long (slow cottage Wi-Fi is fine as long
 * as it moves); the file is then fetched the first time the game uses it. A stuck download used to
 * hold the bar at 97% for good, and a fixed total time cut off the 169 MB voice model on slow Wi-Fi. */
const STALL_MS = 20000;
/** How far each stage has got, re-sent to a page that asks again. @type {Record<string, { done: number, total: number, noRoom?: boolean }>} */
const at = {};
/** Files being downloaded right now, by path: the background save and a page's own request for the same
 * file wait for each other instead of downloading it twice. @type {Map<string, Promise<unknown>>} */
const inflight = new Map();
/** Tell every open page how far saving has got. @param {string} stage @param {number} done @param {number} total @param {boolean} [noRoom] */
async function progress(stage, done, total, noRoom) {
  at[stage] = { done, total, noRoom };
  const all = await /** @type {any} */ (self).clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of all) c.postMessage({ cf: 'progress', stage, done, total, noRoom: !!noRoom });
}
/** Files bigger than this (the narrator's 169 MB voice model) are downloaded in PIECE-sized byte ranges,
 * one file at a time. The browser stops a service worker that has worked on one job for ~5 minutes and
 * throws away a half-done download; on slow Wi-Fi the whole model then started from zero every time
 * offline.js asked again, for ever. Each piece is saved in the cache as soon as it arrives, so a stopped
 * worker carries on from the last saved piece. */
const BIG = 20 * 1024 * 1024;
const PIECE = 8 * 1024 * 1024;
/** Where piece i of a big file waits until the file is joined. @param {string} rel @param {string} h @param {number} i */
const partKey = (rel, h, i) => key(rel, h) + '&part=' + i;
/** A big file's byte ranges (inclusive). @param {string} rel @returns {[number, number][]} */
function pieces(rel) {
  /** @type {[number, number][]} */ const out = [];
  for (let a = 0; a < SIZES[rel]; a += PIECE) out.push([a, Math.min(SIZES[rel], a + PIECE) - 1]);
  return out;
}
/** Headers for a saved copy: its body is already decoded (no Content-Encoding) and may be a piece, so
 * the length and range of what came over the wire don't describe it. @param {Headers} h */
function kept(h) {
  const out = new Headers(h);
  for (const name of ['content-encoding', 'content-length', 'content-range', 'transfer-encoding']) out.delete(name);
  return out;
}
/** Let go of a response's body we won't read (frees the connection). @param {Response} res */
const drop = (res) => { if (res.body) void res.body.cancel().catch(() => {}); };
/**
 * Download one file — or piece `i` of a big one — straight into the cache. The body streams through
 * (a counter in between reports bytes and resets the stall timer), so even the voice model is never
 * held in memory. If no bytes arrive for STALL_MS the fetch is aborted, the stream errors and the put
 * rejects: nothing half-done is saved.
 * @param {Cache} cache @param {string} rel @param {string} h @param {(n: number) => void} onBytes
 * @param {number} [i] which piece (pieces(rel)[i]); none: the whole file
 * @returns {Promise<'whole' | 'piece'>} what was saved ('whole' when the server ignored the range on piece 0)
 */
async function download(cache, rel, h, onBytes, i) {
  const range = i === undefined ? null : pieces(rel)[i];
  const stop = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => stop.abort(), STALL_MS); };
  arm();
  try {
    /** @type {RequestInit} */ const init = { cache: 'no-cache', signal: stop.signal };
    if (range) init.headers = { Range: `bytes=${range[0]}-${range[1]}` };
    const res = await fetch(scope + rel, init);
    if (!res.ok || !res.body) { drop(res); throw new Error(`${rel}: HTTP ${res.status}`); }
    const piece = !!range && res.status === 206;
    if (range && !piece && range[0] > 0) { drop(res); throw new Error(`${rel}: no byte ranges`); }
    if (piece) {
      // The file on the server must be the one the build measured (pieces of two versions don't fit).
      const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
      if (!m || Number(m[1]) !== SIZES[rel]) { drop(res); throw new Error(`${rel}: changed on the server`); }
    }
    const want = piece && range ? range[1] - range[0] + 1 : 0;
    let got = 0;
    const count = new TransformStream({
      transform(chunk, c) { got += chunk.byteLength; onBytes(chunk.byteLength); arm(); c.enqueue(chunk); },
      flush() { if (want && got !== want) throw new Error(`${rel}: piece cut short`); },
    });
    await cache.put(piece ? partKey(rel, h, /** @type {number} */ (i)) : key(rel, h), new Response(res.body.pipeThrough(count), { headers: kept(res.headers) }));
    return piece ? 'piece' : 'whole';
  } finally { clearTimeout(timer); }
}
/** Bytes of a big file already saved as pieces (a worker that was stopped carries on from there). @param {Cache} cache @param {string} rel @param {string} h */
async function savedPieces(cache, rel, h) {
  let n = 0;
  for (const [i, [a, b]] of pieces(rel).entries()) if (await cache.match(partKey(rel, h, i))) n += b - a + 1;
  return n;
}
/** Download a big file piece by piece (skipping saved pieces), then join the pieces into the one cached
 * file the game asks for — streamed from the cache into the cache — and drop them.
 * @param {Cache} cache @param {string} rel @param {string} h @param {(n: number) => void} onBytes */
async function downloadBig(cache, rel, h, onBytes) {
  const ranges = pieces(rel);
  for (const [i, [a, b]] of ranges.entries()) {
    if (await cache.match(partKey(rel, h, i))) { onBytes(b - a + 1); continue; }
    if ((await download(cache, rel, h, onBytes, i)) === 'whole') return; // the server sent the whole file at once
  }
  const parts = await Promise.all(ranges.map((_, i) => cache.match(partKey(rel, h, i))));
  if (parts.some((r) => !r || !r.body)) throw new Error(`${rel}: a piece went missing`);
  let next = 0;
  /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */ let reader = null;
  const joined = new ReadableStream({
    async pull(c) {
      for (;;) {
        if (!reader) {
          if (next >= parts.length) { c.close(); return; }
          reader = /** @type {ReadableStream<Uint8Array>} */ (/** @type {Response} */ (parts[next++]).body).getReader();
        }
        const { done, value } = await reader.read();
        if (!done) { c.enqueue(value); return; }
        reader = null;
      }
    },
  });
  await cache.put(key(rel, h), new Response(joined, { headers: kept(/** @type {Response} */ (parts[0]).headers) }));
  for (const [i] of ranges.entries()) await cache.delete(partKey(rel, h, i));
}
/** Room left in this browser's storage, in bytes (Infinity if it won't say). */
async function room() {
  try {
    const nav = /** @type {any} */ (self).navigator;
    const e = nav && nav.storage && nav.storage.estimate ? await nav.storage.estimate() : null;
    return e && e.quota ? e.quota - (e.usage || 0) : Infinity;
  } catch (e) { return Infinity; }
}
/** Save files into the cache, skipping ones already saved: big files one at a time with the whole
 * connection to themselves, then the rest 6 at a time. Files that don't fit in this browser's storage
 * (a private window has little) are left to stream from the internet instead.
 * @param {[string, string][]} list @param {string} stage */
async function save(list, stage) {
  const cache = await caches.open(CACHE);
  const size = (/** @type {string} */ rel) => SIZES[rel] || 1;
  const big = (/** @type {string} */ rel) => size(rel) > BIG;
  const total = list.reduce((n, [rel]) => n + size(rel), 0);
  let done = 0;
  let noRoom = false;
  let free = await room();
  let lastSent = 0;
  const tell = (/** @type {boolean} */ force) => { if (force || Date.now() - lastSent > 400) { lastSent = Date.now(); void progress(stage, Math.min(done, total), total); } };
  tell(true);
  /** @param {[string, string]} item */
  const one = async ([rel, h]) => {
    let got = 0;
    try {
      if (inflight.has(rel)) await inflight.get(rel); // the page is already downloading it
      if (!(await cache.match(key(rel, h)))) { // unchanged since the last visit: nothing to fetch
        // A big file is saved twice for a moment (its pieces, then the joined file).
        const need = big(rel) ? 2 * size(rel) - (await savedPieces(cache, rel, h)) : size(rel);
        if (need > free) { noRoom = true; return; }
        free -= need;
        const onBytes = (/** @type {number} */ n) => { got += n; done += n; tell(false); };
        const p = big(rel) ? downloadBig(cache, rel, h, onBytes) : download(cache, rel, h, onBytes);
        inflight.set(rel, p);
        try { await p; } finally { inflight.delete(rel); }
      }
    } catch (e) { /* offline, a hiccup, stalled or out of room: fetched on first use instead */ }
    finally { done += Math.max(0, size(rel) - got); tell(false); }
  };
  for (const item of list) if (big(item[0])) await one(item);
  const queue = list.filter(([rel]) => !big(rel));
  const worker = async () => { for (let next = queue.shift(); next; next = queue.shift()) await one(next); };
  await Promise.all([0, 1, 2, 3, 4, 5].map(worker));
  await progress(stage, total, total, noRoom);
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
      const buf = await hit.blob(); // (a Blob slice, not the whole file in memory)
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), buf.size - 1) : buf.size - 1;
      return new Response(buf.slice(start, end + 1), { status: 206, headers: {
        'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${buf.size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let hit = await cache.match(key(rel, h));
    if (hit) return isolate(rel, hit);
    // The background save is downloading this very file: wait for it rather than download it twice.
    const pending = inflight.get(rel);
    if (pending) { await pending.catch(() => {}); hit = await cache.match(key(rel, h)); if (hit) return isolate(rel, hit); }
    const res = await fetch(scope + rel);
    if (res.ok) {
      const p = cache.put(key(rel, h), res.clone()).catch(() => {}); // (no room: it just isn't kept)
      inflight.set(rel, p);
      try { await p; } finally { inflight.delete(rel); }
    }
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
    // The narrator's voice first (it's needed as soon as a game starts), then the music.
    const media = Object.entries(MEDIA).sort(([a], [b]) => Number(b.startsWith('tts/')) - Number(a.startsWith('tts/')));
    if (!tvSaving) tvSaving = save(Object.entries(FILES), 'core').then(() => save(media, 'media')).finally(() => { tvSaving = null; });
    else for (const [stage, x] of Object.entries(at)) void progress(stage, x.done, x.total, x.noRoom); // already saving: say how far
    e.waitUntil(tvSaving);
  }
});
