/*
 * Browser stand-in for Node's `fs` (GitHub Pages build only). Two layers:
 *  - read-only files preloaded from the build (content pools), and
 *  - everything the game writes (history, stats, house rules) in localStorage, so it lives in the
 *    host's browser and survives reloads.
 * Only the calls the game modules make are implemented. AGPLv3 — see LICENSE.
 */
'use strict';

const LS = 'cf.fs:';
/** @type {Map<string, string>} */
const files = new Map();

/** @param {string} p */
const norm = (p) => String(p).replace(/\/+/g, '/');
/** @param {string} p */
const enoent = (p) => Object.assign(new Error(`ENOENT: no such file '${p}'`), { code: 'ENOENT' });
/** @param {string} key @returns {string | null} */
const lsGet = (key) => { try { return localStorage.getItem(LS + key); } catch (e) { return null; } };

/** Load the build's bundled files (path → text) before the game modules read them. @param {Record<string, string>} map */
function preload(map) { for (const [p, v] of Object.entries(map)) files.set(norm(p), v); }

/** The game saves by writing `x.tmp` and renaming it to `x` (safe on a real disk). Here a `.tmp` write
 * stays in memory and the rename is one localStorage write — not two big writes, a read and a remove.
 * @type {Map<string, string>} */
const staged = new Map();
/** How many times each path has been saved (cheap "did it change?" for web/host-entry.js). @type {Map<string, number>} */
const saves = new Map();
/** @param {string} k @param {string} v */
function commit(k, v) {
  saves.set(k, (saves.get(k) || 0) + 1);
  try { localStorage.setItem(LS + k, v); } catch (e) { /* storage full or blocked: best effort */ }
}

/** @param {string} p @returns {string} */
function readFileSync(p) {
  const k = norm(p);
  const f = files.get(k);
  if (f !== undefined) return f;
  const s = staged.get(k);
  if (s !== undefined) return s;
  const v = lsGet(k);
  if (v === null) throw enoent(k);
  return v;
}
/** @param {string} p @param {unknown} data */
function writeFileSync(p, data) {
  const k = norm(p);
  if (k.endsWith('.tmp')) staged.set(k, String(data));
  else commit(k, String(data));
}
/** @param {string} a @param {string} b */
function renameSync(a, b) {
  const k = norm(a);
  const s = staged.get(k);
  if (s !== undefined) { staged.delete(k); commit(norm(b), s); return; }
  const v = lsGet(k); // (a file saved by an older build)
  if (v === null) return;
  commit(norm(b), v);
  try { localStorage.removeItem(LS + k); } catch (e) { /* ignore */ }
}
/** Times files whose path ends with `suffix` have been saved since the page loaded. @param {string} suffix */
function saveCount(suffix) {
  let n = 0;
  for (const [k, c] of saves) if (k.endsWith(suffix)) n += c;
  return n;
}
function mkdirSync() { /* folders are implicit */ }
/** @param {string} p */
function existsSync(p) { const k = norm(p); return files.has(k) || staged.has(k) || lsGet(k) !== null; }
/** Names directly inside a preloaded folder. @param {string} dir @returns {string[]} */
function readdirSync(dir) {
  const d = norm(dir).replace(/\/$/, '') + '/';
  const out = new Set();
  for (const k of files.keys()) if (k.startsWith(d)) out.add(k.slice(d.length).split('/')[0]);
  return [...out];
}

module.exports = { preload, readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, saveCount };
