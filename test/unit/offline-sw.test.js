// The website's service worker (web/sw-template.js) saving the game for offline play, run in a fake
// browser. A download that never moves must not hold the save at 97%; a slow one that keeps moving must
// finish (the 169 MB voice model on cottage Wi-Fi); files that don't fit (a private window) stream instead;
// and the voice and the background save never download the same file twice.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Load the worker with these files. `stall`: downloads that never send a byte; `slow`: ones that send a
 * chunk every 30 ms for a while (20 × 30 ms: longer than the stall limit in total); `free`: storage room in bytes.
 * `body`: a file's exact bytes (the fake server answers Range requests for these with 206); `big`/`piece`:
 * the worker's big-file limit and piece size (bytes); `saved`: the cache, shared to play a worker restart;
 * `respond`: a custom answer for a file. The fake cache reads a body to the end when it is put, like a
 * real one (a stream that errors makes the put reject).
 * @param {{ files?: Record<string, string>, media?: Record<string, string>, sizes?: Record<string, number>, stall?: string[], slow?: string[], free?: number,
 *   body?: Record<string, Uint8Array>, big?: number, piece?: number, saved?: Map<string, any>, respond?: Record<string, (opts: any) => Response | Promise<Response> | null> }} o
 */
function worker({ files = {}, media = {}, sizes = {}, stall = [], slow = [], free = Infinity, body = {}, big, piece, saved = new Map(), respond = {} }) {
  let src = fs.readFileSync(path.join(__dirname, '../../web/sw-template.js'), 'utf8')
    .replace('__VERSION__', 'test').replace('__FILES__', JSON.stringify(files)).replace('__MEDIA__', JSON.stringify(media))
    .replace('__PHONE__', '[]').replace('__SIZES__', JSON.stringify({ ...Object.fromEntries(Object.entries(body).map(([k, b]) => [k, b.length])), ...sizes }))
    .replace('const STALL_MS = 20000;', 'const STALL_MS = 80;'); // a short stall limit for the test
  assert.ok(src.includes('const STALL_MS = 80;'), 'the stall limit is where the test expects it');
  if (big !== undefined) { assert.ok(src.includes('const BIG = 20 * 1024 * 1024;')); src = src.replace('const BIG = 20 * 1024 * 1024;', `const BIG = ${big};`); }
  if (piece !== undefined) { assert.ok(src.includes('const PIECE = 8 * 1024 * 1024;')); src = src.replace('const PIECE = 8 * 1024 * 1024;', `const PIECE = ${piece};`); }
  /** @type {Record<string, Function>} */ const on = {};
  /** @type {any[]} */ const posted = [];
  /** @type {string[]} */ const fetched = [];
  /** @type {(string | null)[]} the Range header of each fetch */ const ranges = [];
  /** @type {{ key: string, at: number }[]} when each put started, in bytes received so far */ const puts = [];
  let received = 0;
  /** @type {Set<string>} files whose body is being read */ const open = new Set();
  /** @type {[string, string[]][]} each fetch, with the files still downloading at that moment */ const overlap = [];
  const cache = {
    match: async (/** @type {string} */ k) => { const v = saved.get(k); return v && new Response(v.buf, { headers: v.headers }); },
    put: async (/** @type {string} */ k, /** @type {Response} */ v) => {
      puts.push({ key: k, at: received });
      const buf = new Uint8Array(await v.arrayBuffer());
      saved.set(k, { buf, headers: new Headers(v.headers) });
    },
    keys: async () => [], delete: async (/** @type {string} */ k) => saved.delete(k),
  };
  const scope = 'https://example.test/cf/';
  const self = {
    location: { href: scope + 'sw.js' },
    navigator: { storage: { estimate: async () => ({ quota: free === Infinity ? 0 : free, usage: 0 }) } },
    addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => { on[ev] = fn; },
    clients: { matchAll: async () => [{ postMessage: (/** @type {any} */ m) => posted.push(m) }], claim: async () => {} },
    skipWaiting: async () => {},
  };
  /** A body that counts what was read; its file counts as downloading until it ends. @param {string} rel @param {ReadableStream<Uint8Array>} s */
  const tracked = (rel, s) => {
    open.add(rel);
    return s.pipeThrough(new TransformStream({ transform(c, ctl) { received += c.byteLength; ctl.enqueue(c); }, flush() { open.delete(rel); } }));
  };
  const fetch = async (/** @type {string} */ url, /** @type {any} */ opts = {}) => {
    const rel = url.slice(scope.length);
    fetched.push(rel);
    overlap.push([rel, [...open]]);
    const range = opts.headers && opts.headers.Range ? String(opts.headers.Range) : null;
    ranges.push(range);
    if (respond[rel]) { const r = await respond[rel](opts); if (r) return r; } // (null: the normal answer)
    if (stall.includes(rel)) {
      // Hangs for good unless the worker cancels it.
      return new Promise((_, reject) => { if (opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    }
    if (slow.includes(rel)) {
      let n = 0;
      const b = new ReadableStream({
        async pull(c) { await new Promise((r) => setTimeout(r, 30)); if (n++ < 20) c.enqueue(new Uint8Array(10)); else c.close(); },
      });
      return new Response(tracked(rel, b));
    }
    if (body[rel]) {
      const all = body[rel];
      const m = range && /bytes=(\d+)-(\d+)/.exec(range);
      const part = m ? all.slice(Number(m[1]), Number(m[2]) + 1) : all;
      // Sent in small chunks over time, and given up (errored) if the worker aborts.
      let at = 0;
      const b = new ReadableStream({
        start(c) { if (opts.signal) opts.signal.addEventListener('abort', () => c.error(new Error('aborted'))); },
        async pull(c) { await new Promise((r) => setTimeout(r, 2)); if (at >= part.length) c.close(); else { c.enqueue(part.slice(at, at + 16)); at += 16; } },
      });
      const headers = { 'Content-Type': 'application/octet-stream', ...(m ? { 'Content-Range': `bytes ${m[1]}-${Number(m[1]) + part.length - 1}/${all.length}` } : {}) };
      return new Response(tracked(rel, b), { status: m ? 206 : 200, headers });
    }
    return new Response(rel);
  };
  vm.runInNewContext(src, { self, caches: { open: async () => cache }, fetch, AbortController, setTimeout, clearTimeout, URL, Headers, Response, Blob, ReadableStream, TransformStream, console });
  /** Send the TV's "save everything" and wait for the worker to finish. */
  const cacheTv = async () => {
    /** @type {Promise<any>[]} */ const jobs = [];
    on.message({ data: 'cache-tv', source: null, waitUntil: (/** @type {Promise<any>} */ p) => jobs.push(p) });
    await Promise.all(jobs);
  };
  const keys = () => [...saved.keys()].map((k) => k.replace(scope, '')).sort();
  const last = (/** @type {string} */ stage) => posted.filter((m) => m.stage === stage).pop();
  return { cacheTv, posted, saved, on, fetched, ranges, puts, keys, last, scope, overlap };
}
/** n bytes that differ from place to place (a piece out of order would show). @param {number} n */
const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + (i >> 8)) & 255);

test('a download that never moves is given up: saving still reaches 100% and the rest is saved', async () => {
  const w = worker({ files: { 'a.js': 'h1', 'b.js': 'h2' }, media: { 'music/x.ogg': 'h3', 'music/stuck.ogg': 'h4', 'music/y.ogg': 'h5' }, stall: ['music/stuck.ogg'] });
  const t0 = Date.now();
  await w.cacheTv();
  assert.ok(Date.now() - t0 < 2000, 'finished, not stuck');
  assert.strictEqual(w.last('core').done, w.last('core').total);
  assert.strictEqual(w.last('media').done, w.last('media').total, 'media reaches 100%');
  assert.deepStrictEqual(w.keys(), ['a.js?v=h1', 'b.js?v=h2', 'music/x.ogg?v=h3', 'music/y.ogg?v=h5'], 'everything but the stuck file is saved');
});

test('a slow download that keeps moving is saved, even when it takes longer than the stall limit', async () => {
  const w = worker({ media: { 'tts/model.onnx': 'm1' }, slow: ['tts/model.onnx'], sizes: { 'tts/model.onnx': 200 } });
  await w.cacheTv();
  assert.deepStrictEqual(w.keys(), ['tts/model.onnx?v=m1'], '~600 ms of trickle, 80 ms stall limit: still saved');
  const media = w.posted.filter((m) => m.stage === 'media');
  assert.ok(media.some((m) => m.done > 0 && m.done < m.total), 'progress counts bytes as they arrive');
});

test('the voice is saved before the music, and files that don\'t fit are left to stream (and the page is told)', async () => {
  const w = worker({ media: { 'music/a.ogg': 'a', 'tts/model.onnx': 'm', 'music/b.ogg': 'b' }, sizes: { 'music/a.ogg': 10, 'music/b.ogg': 10, 'tts/model.onnx': 1000 }, free: 50 });
  await w.cacheTv();
  assert.strictEqual(w.fetched[0], 'music/a.ogg', 'the model doesn\'t fit in 50 bytes: not even fetched');
  assert.deepStrictEqual(w.keys(), ['music/a.ogg?v=a', 'music/b.ogg?v=b']);
  assert.strictEqual(w.last('media').noRoom, true, 'the page can say "no room — they\'ll stream"');
  const roomy = worker({ media: { 'music/a.ogg': 'a', 'tts/model.onnx': 'm' } });
  await roomy.cacheTv();
  assert.strictEqual(roomy.fetched[0], 'tts/model.onnx', 'with room: the voice comes first');
  assert.strictEqual(roomy.last('media').noRoom, false);
});

test('asking again while saving says how far it is (it doesn\'t claim the game is saved)', async () => {
  const w = worker({ files: { 'a.js': 'h1' }, media: { 'music/stuck.ogg': 'h2' }, stall: ['music/stuck.ogg'] });
  /** @type {Promise<any>[]} */ const jobs = [];
  w.on.message({ data: 'cache-tv', source: null, waitUntil: (/** @type {Promise<any>} */ p) => jobs.push(p) });
  await new Promise((r) => setTimeout(r, 30)); // core done, media stuck on its one file
  const before = w.posted.length;
  w.on.message({ data: 'cache-tv', source: null, waitUntil: (/** @type {Promise<any>} */ p) => jobs.push(p) });
  await new Promise((r) => setTimeout(r, 5));
  const again = w.posted.slice(before);
  assert.ok(again.some((m) => m.stage === 'media' && m.done === 0 && m.total === 1), 'repeats where media is');
  assert.ok(!again.some((m) => m.stage === 'media' && m.done === 1), 'no false 100%');
  await Promise.all(jobs);
});

test('the voice asking for a file the background save is downloading waits for it: one download, not two', async () => {
  const w = worker({ media: { 'tts/model.onnx': 'm1' }, slow: ['tts/model.onnx'], sizes: { 'tts/model.onnx': 200 } });
  /** @type {Promise<any>[]} */ const jobs = [];
  w.on.message({ data: 'cache-tv', source: null, waitUntil: (/** @type {Promise<any>} */ p) => jobs.push(p) });
  await new Promise((r) => setTimeout(r, 40)); // the save is mid-download
  /** @type {Promise<Response> | null} */ let answer = null;
  w.on.fetch({ request: { method: 'GET', url: w.scope + 'tts/model.onnx', headers: new Headers() }, respondWith: (/** @type {Promise<Response>} */ p) => { answer = p; } });
  assert.ok(answer, 'the worker answers the request');
  const res = await /** @type {any} */ (answer);
  await Promise.all(jobs);
  assert.strictEqual(w.fetched.filter((f) => f === 'tts/model.onnx').length, 1, 'downloaded once');
  assert.strictEqual((await res.arrayBuffer()).byteLength, 200, 'and the voice got the whole file');
});

test('a download streams into the cache (it is not collected in memory first) and keeps no wire headers', async () => {
  const w = worker({ media: { 'tts/model.onnx': 'm1' }, body: { 'tts/model.onnx': bytes(4000) },
});
  await w.cacheTv();
  assert.deepStrictEqual(w.keys(), ['tts/model.onnx?v=m1']);
  assert.deepStrictEqual(w.saved.get(w.scope + 'tts/model.onnx?v=m1').buf, bytes(4000), 'every byte, in order');
  const put = w.puts.find((p) => p.key.endsWith('tts/model.onnx?v=m1'));
  assert.ok(put && put.at < 4000, `the cache was handed the stream before the file had arrived (${put && put.at} of 4000 bytes in)`);
  // A server that compressed the file: the saved copy is already decoded, so its encoding and length go.
  const g = worker({ media: { 'music/a.ogg': 'a' }, respond: { 'music/a.ogg': () => new Response('decoded', { headers: { 'Content-Encoding': 'gzip', 'Content-Length': '3', 'Content-Type': 'audio/ogg' } }) } });
  await g.cacheTv();
  const h = g.saved.get(g.scope + 'music/a.ogg?v=a').headers;
  assert.strictEqual(h.get('content-encoding'), null);
  assert.strictEqual(h.get('content-length'), null);
  assert.strictEqual(h.get('content-type'), 'audio/ogg', 'the type is kept');
});

test('a download that stops halfway saves nothing (the put fails) and the save still finishes', async () => {
  let sent = 0;
  const w = worker({ media: { 'music/half.ogg': 'h' }, respond: { 'music/half.ogg': (opts) => new Response(new ReadableStream({
    start(c) { opts.signal.addEventListener('abort', () => c.error(new Error('aborted'))); },
    pull(c) { if (sent++ < 3) c.enqueue(new Uint8Array(10)); else return new Promise(() => {}); }, // then silence
  })) } });
  await w.cacheTv();
  assert.deepStrictEqual(w.keys(), [], 'no half file saved');
  assert.strictEqual(w.last('media').done, w.last('media').total);
});

test('a missing file: its body is cancelled, not left hanging', async () => {
  let cancelled = false;
  const w = worker({ media: { 'music/gone.ogg': 'g' }, respond: { 'music/gone.ogg': () => new Response(new ReadableStream({ pull() {}, cancel() { cancelled = true; } }), { status: 404 }) } });
  await w.cacheTv();
  assert.ok(cancelled, 'body cancelled');
  assert.deepStrictEqual(w.keys(), []);
});

test('a big file comes in byte-range pieces, alone, and a stopped worker carries on from the last saved piece', async () => {
  const model = bytes(1000);
  const opts = { media: { 'tts/model.onnx': 'm1', 'music/a.ogg': 'a', 'music/b.ogg': 'b' }, body: { 'tts/model.onnx': model, 'music/a.ogg': bytes(50), 'music/b.ogg': bytes(50) }, big: 300, piece: 256 };
  // First visit: pieces 0 and 1 arrive, then piece 2 never moves (the worker was stopped, the Wi-Fi went).
  const saved = new Map();
  let calls = 0;
  const first = worker({ ...opts, saved, respond: { 'tts/model.onnx': (o) => (++calls <= 2 ? null
    : new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new Error('aborted'))))) } });
  await first.cacheTv();
  assert.deepStrictEqual(first.ranges.filter((r, i) => first.fetched[i] === 'tts/model.onnx'), ['bytes=0-255', 'bytes=256-511', 'bytes=512-767']);
  const mixed = (/** @type {[string, string[]][]} */ o) => o.some(([rel, busy]) => busy.some((b) => (b === 'tts/model.onnx') !== (rel === 'tts/model.onnx')));
  assert.ok(!mixed(first.overlap), 'the big file downloads alone, not alongside the music');
  assert.ok(first.keys().includes('tts/model.onnx?v=m1&part=0') && first.keys().includes('tts/model.onnx?v=m1&part=1'), 'pieces kept');
  assert.ok(!first.keys().includes('tts/model.onnx?v=m1'), 'not joined yet');
  // The TV asks again (a new worker, the same cache): only the missing pieces are fetched.
  const again = worker({ ...opts, saved });
  await again.cacheTv();
  assert.deepStrictEqual(again.ranges.filter((r, i) => again.fetched[i] === 'tts/model.onnx'), ['bytes=512-767', 'bytes=768-999'], 'carries on, not from zero');
  assert.deepStrictEqual(again.saved.get(again.scope + 'tts/model.onnx?v=m1').buf, model, 'joined: every byte, in order');
  assert.deepStrictEqual(again.keys(), ['music/a.ogg?v=a', 'music/b.ogg?v=b', 'tts/model.onnx?v=m1'], 'pieces dropped once joined');
  assert.ok(!mixed(again.overlap), 'alone again');
  assert.strictEqual(again.last('media').done, again.last('media').total);
});

test('a big file from a server that ignores ranges is saved whole', async () => {
  const model = bytes(700);
  const w = worker({ media: { 'tts/model.onnx': 'm1' }, body: { 'tts/model.onnx': model }, big: 300, piece: 256,
    respond: { 'tts/model.onnx': () => new Response(model, { headers: { 'Content-Type': 'application/octet-stream' } }) } });
  await w.cacheTv();
  assert.deepStrictEqual(w.keys(), ['tts/model.onnx?v=m1']);
  assert.deepStrictEqual(w.saved.get(w.scope + 'tts/model.onnx?v=m1').buf, model);
});

/**
 * Open the TV page's offline helper (web/offline.js) in a fake page and let the worker say there is no
 * room for music & voice. `store` is this device's localStorage (shared between reloads).
 * @param {Map<string, string>} store @returns {Promise<{ hidden: boolean, text: string }>} the corner notice
 */
async function tvPageSaysNoRoom(store) {
  const el = () => ({ hidden: false, className: '', innerHTML: '', textContent: '', style: {}, querySelector: () => el() });
  /** @type {any[]} */ const made = [];
  /** @type {Record<string, Function>} */ const sw = {};
  const timers = { set: () => 0 };
  const window = { isSecureContext: true, crossOriginIsolated: true, setTimeout: timers.set, setInterval: timers.set, clearInterval: () => {}, cfBusy: () => true };
  const ctx = {
    module: { exports: {} }, window, location: { pathname: '/host', reload: () => {} },
    navigator: { serviceWorker: { controller: {}, addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => { sw[ev] = fn; },
      register: () => new Promise(() => {}), ready: new Promise(() => {}) } },
    document: { body: { appendChild: () => {} }, createElement: () => { const e = el(); made.push(e); return e; } },
    localStorage: { getItem: (/** @type {string} */ k) => (store.has(k) ? store.get(k) : null), setItem: (/** @type {string} */ k, /** @type {string} */ v) => { store.set(k, String(v)); } },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    addEventListener: () => {}, setTimeout: timers.set, clearTimeout: () => {}, Date,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../web/offline.js'), 'utf8'), ctx);
  /** @type {any} */ (ctx.module.exports).offline('tv');
  sw.message({ data: { cf: 'progress', stage: 'media', done: 10, total: 10, noRoom: true } });
  const corner = made.find((e) => e.className === 'cf-offline-corner');
  return { hidden: corner.hidden, text: corner.textContent };
}

test('"no room to save music & voice" is said once on a device, not on every reload of the TV', async () => {
  const store = new Map();
  const first = await tvPageSaysNoRoom(store);
  assert.strictEqual(first.hidden, false);
  assert.match(first.text, /No room/);
  const reload = await tvPageSaysNoRoom(store);
  assert.strictEqual(reload.hidden, true, 'the reloaded TV stays quiet');
});

test('website fs: a save (write .tmp, rename) is one localStorage write, and saves are counted', () => {
  /** @type {Map<string, string>} */ const ls = new Map();
  /** @type {string[]} */ const calls = [];
  const localStorage = {
    getItem: (/** @type {string} */ k) => { calls.push('get ' + k); return ls.has(k) ? ls.get(k) : null; },
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { calls.push('set ' + k); ls.set(k, v); },
    removeItem: (/** @type {string} */ k) => { calls.push('remove ' + k); ls.delete(k); },
  };
  const ctx = { module: { exports: {} }, localStorage };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../web/shims/fs.js'), 'utf8'), ctx);
  const sh = /** @type {any} */ (ctx.module.exports);
  sh.writeFileSync('/data/stats.json.tmp', '{"a":1}');
  assert.strictEqual(sh.readFileSync('/data/stats.json.tmp'), '{"a":1}', 'a staged file can be read');
  sh.renameSync('/data/stats.json.tmp', '/data/stats.json');
  assert.deepStrictEqual(calls, ['set cf.fs:/data/stats.json'], 'one write, no read, no remove');
  assert.strictEqual(sh.readFileSync('/data/stats.json'), '{"a":1}');
  assert.strictEqual(sh.existsSync('/data/stats.json.tmp'), false, 'the .tmp is gone');
  assert.strictEqual(sh.saveCount('/stats.json'), 1);
  sh.writeFileSync('/data/rooms.json.tmp', 'r'); sh.renameSync('/data/rooms.json.tmp', '/data/rooms.json');
  assert.strictEqual(sh.saveCount('/stats.json'), 1, 'other files don\'t count');
  // A .tmp left in localStorage by an older build still moves into place.
  ls.set('cf.fs:/data/history.json.tmp', 'old');
  sh.renameSync('/data/history.json.tmp', '/data/history.json');
  assert.strictEqual(sh.readFileSync('/data/history.json'), 'old');
  assert.strictEqual(ls.has('cf.fs:/data/history.json.tmp'), false);
});
