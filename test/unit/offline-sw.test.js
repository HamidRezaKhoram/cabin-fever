// The website's service worker (web/sw-template.js) saving the game for offline play. Run in a fake
// browser: one download that never finishes must not hold the save (and the TV's progress bar) at 97%.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Load the worker with these files; `stall` names files whose download hangs until aborted. */
function worker({ files = {}, media = {}, stall = [] }) {
  const src = fs.readFileSync(path.join(__dirname, '../../web/sw-template.js'), 'utf8')
    .replace('__VERSION__', 'test').replace('__FILES__', JSON.stringify(files)).replace('__MEDIA__', JSON.stringify(media))
    .replace('__PHONE__', '[]')
    .replace(/phone: 20000, core: 20000, media: 90000/, 'phone: 80, core: 80, media: 80'); // short timeouts
  /** @type {Record<string, Function>} */ const on = {};
  /** @type {any[]} */ const posted = [];
  /** @type {Map<string, any>} */ const saved = new Map();
  const cache = { match: async (k) => saved.get(k), put: async (k, v) => { saved.set(k, v); }, keys: async () => [], delete: async () => true };
  const scope = 'https://example.test/cf/';
  const self = {
    location: { href: scope + 'sw.js' },
    addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => { on[ev] = fn; },
    clients: { matchAll: async () => [{ postMessage: (/** @type {any} */ m) => posted.push(m) }], claim: async () => {} },
    skipWaiting: async () => {},
  };
  const fetch = (/** @type {string} */ url, /** @type {any} */ opts) => {
    const rel = url.slice(scope.length);
    if (stall.includes(rel)) {
      // Hangs for good unless the worker cancels it.
      return new Promise((_, reject) => { if (opts && opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    }
    return Promise.resolve({ ok: true, body: rel });
  };
  vm.runInNewContext(src, { self, caches: { open: async () => cache }, fetch, AbortController, setTimeout, clearTimeout, URL, Headers, Response, console });
  /** Send the TV's "save everything" and wait for the worker to finish. */
  const cacheTv = async () => {
    /** @type {Promise<any>[]} */ const jobs = [];
    on.message({ data: 'cache-tv', source: null, waitUntil: (/** @type {Promise<any>} */ p) => jobs.push(p) });
    await Promise.all(jobs);
  };
  return { cacheTv, posted, saved, on };
}

test('a download that stalls is given up: saving still reaches 100% and the rest is saved', async () => {
  const w = worker({ files: { 'a.js': 'h1', 'b.js': 'h2' }, media: { 'music/x.ogg': 'h3', 'music/stuck.ogg': 'h4', 'music/y.ogg': 'h5' }, stall: ['music/stuck.ogg'] });
  const t0 = Date.now();
  await w.cacheTv();
  assert.ok(Date.now() - t0 < 2000, 'finished, not stuck');
  const last = (/** @type {string} */ stage) => w.posted.filter((m) => m.stage === stage).pop();
  assert.deepStrictEqual([last('core').done, last('core').total], [2, 2]);
  assert.deepStrictEqual([last('media').done, last('media').total], [3, 3], 'media reaches 100%');
  const keys = [...w.saved.keys()].map((k) => k.replace('https://example.test/cf/', ''));
  assert.deepStrictEqual(keys.sort(), ['a.js?v=h1', 'b.js?v=h2', 'music/x.ogg?v=h3', 'music/y.ogg?v=h5'], 'everything but the stuck file is saved');
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
