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

/** @param {string} p @returns {string} */
function readFileSync(p) {
  const k = norm(p);
  const f = files.get(k);
  if (f !== undefined) return f;
  const v = lsGet(k);
  if (v === null) throw enoent(k);
  return v;
}
/** @param {string} p @param {unknown} data */
function writeFileSync(p, data) {
  try { localStorage.setItem(LS + norm(p), String(data)); } catch (e) { /* storage full or blocked: best effort */ }
}
/** @param {string} a @param {string} b */
function renameSync(a, b) {
  const v = lsGet(norm(a));
  if (v === null) return;
  writeFileSync(b, v);
  try { localStorage.removeItem(LS + norm(a)); } catch (e) { /* ignore */ }
}
function mkdirSync() { /* folders are implicit */ }
/** @param {string} p */
function existsSync(p) { const k = norm(p); return files.has(k) || lsGet(k) !== null; }
/** Names directly inside a preloaded folder. @param {string} dir @returns {string[]} */
function readdirSync(dir) {
  const d = norm(dir).replace(/\/$/, '') + '/';
  const out = new Set();
  for (const k of files.keys()) if (k.startsWith(d)) out.add(k.slice(d.length).split('/')[0]);
  return [...out];
}

module.exports = { preload, readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync };
