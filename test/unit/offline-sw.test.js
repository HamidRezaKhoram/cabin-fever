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
 * @param {{ files?: Record<string, string>, media?: Record<string, string>, sizes?: Record<string, number>, stall?: string[], slow?: string[], free?: number }} o
 */
function worker({ files = {}, media = {}, sizes = {}, stall = [], slow = [], free = Infinity }) {
  const src = fs.readFileSync(path.join(__dirname, '../../web/sw-template.js'), 'utf8')
    .replace('__VERSION__', 'test').replace('__FILES__', JSON.stringify(files)).replace('__MEDIA__', JSON.stringify(media))
    .replace('__PHONE__', '[]').replace('__SIZES__', JSON.stringify(sizes))
    .replace('const STALL_MS = 20000;', 'const STALL_MS = 80;'); // a short stall limit for the test
  assert.ok(src.includes('const STALL_MS = 80;'), 'the stall limit is where the test expects it');
  /** @type {Record<string, Function>} */ const on = {};
  /** @type {any[]} */ const posted = [];
  /** @type {Map<string, any>} */ const saved = new Map();
  /** @type {string[]} */ const fetched = [];
  const cache = { match: async (/** @type {string} */ k) => saved.get(k), put: async (/** @type {string} */ k, /** @type {any} */ v) => { saved.set(k, v); }, keys: async () => [], delete: async () => true };
  const scope = 'https://example.test/cf/';
  const self = {
    location: { href: scope + 'sw.js' },
    navigator: { storage: { estimate: async () => ({ quota: free === Infinity ? 0 : free, usage: 0 }) } },
    addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => { on[ev] = fn; },
    clients: { matchAll: async () => [{ postMessage: (/** @type {any} */ m) => posted.push(m) }], claim: async () => {} },
    skipWaiting: async () => {},
  };
  const fetch = (/** @type {string} */ url, /** @type {any} */ opts = {}) => {
    const rel = url.slice(scope.length);
    fetched.push(rel);
    if (stall.includes(rel)) {
      // Hangs for good unless the worker cancels it.
      return new Promise((_, reject) => { if (opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    }
    if (slow.includes(rel)) {
      let n = 0;
      const body = new ReadableStream({
        async pull(c) { await new Promise((r) => setTimeout(r, 30)); if (n++ < 20) c.enqueue(new Uint8Array(10)); else c.close(); },
      });
      return Promise.resolve(new Response(body));
    }
    return Promise.resolve(new Response(rel));
  };
  vm.runInNewContext(src, { self, caches: { open: async () => cache }, fetch, AbortController, setTimeout, clearTimeout, URL, Headers, Response, Blob, console });
  /** Send the TV's "save everything" and wait for the worker to finish. */
  const cacheTv = async () => {
    /** @type {Promise<any>[]} */ const jobs = [];
    on.message({ data: 'cache-tv', source: null, waitUntil: (/** @type {Promise<any>} */ p) => jobs.push(p) });
    await Promise.all(jobs);
  };
  const keys = () => [...saved.keys()].map((k) => k.replace(scope, '')).sort();
  const last = (/** @type {string} */ stage) => posted.filter((m) => m.stage === stage).pop();
  return { cacheTv, posted, saved, on, fetched, keys, last, scope };
}

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
