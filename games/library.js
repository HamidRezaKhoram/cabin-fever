/*
 * Content library: question/prompt pools with no-repeat history and an 18+
 * ("spicy") mix. AGPLv3 — see LICENSE.
 *
 * Pools live in games/data/pools/<name>.json (built by tools/build-content.py).
 * Every item has a stable `id` and an `a` (adult) flag. Used ids are written
 * to <data dir>/history.json so questions don't repeat across games — or
 * across container restarts — until the whole pool has been played through.
 *
 * Extra items can be dropped into content/<name>.json (see content/README.md).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const house = require('./house');

const POOL_DIR = path.join(__dirname, 'data', 'pools');
const CONTENT_DIR = process.env.RUMPUS_CONTENT_DIR || path.join(__dirname, '..', 'content');
const DATA_DIR = process.env.RUMPUS_DATA_DIR || path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
// Share of picks from the 18+ side of a pool when spicy mode is on: house rules (/admin).
house.onChange(() => pools.clear()); // edits (custom prompts, banned words) apply to the next draw
const HISTORY_CAP = 20000;

const STATS_FILE = path.join(DATA_DIR, 'item-stats.json');
/** Per-item play telemetry → item-response-theory-style quality signal.
 * @type {Record<string, Record<string, { skips?: number, answers?: number, correct?: number }>>} */
let itemStats = {};
try { itemStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch (e) { itemStats = {}; }
let statsTimer = null;
function saveStats() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => {
    statsTimer = null;
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STATS_FILE, JSON.stringify(itemStats)); } catch (e) { /* best effort */ }
  }, 1500);
  if (statsTimer.unref) statsTimer.unref();
}
/** @param {string} pool @param {string} id */
function statFor(pool, id) {
  const p = itemStats[pool] || (itemStats[pool] = {});
  return p[id] || (p[id] = {});
}
/** A majority voted to skip this item → it's retired. @param {string} pool @param {string} id */
function recordSkip(pool, id) { const s = statFor(pool, id); s.skips = (s.skips || 0) + 1; saveStats(); }
/** @param {string} pool @param {string} id @param {number} correct @param {number} answers */
function recordAnswers(pool, id, correct, answers) {
  if (!answers) return;
  const s = statFor(pool, id);
  s.answers = (s.answers || 0) + answers;
  s.correct = (s.correct || 0) + correct;
  saveStats();
}
/**
 * Retire items that tell players apart badly (IRT: low discrimination) — almost
 * everyone right or almost everyone wrong after enough answers — or that a
 * majority voted to skip. @param {string} pool @param {string} id
 */
function retired(pool, id) {
  const s = itemStats[pool] && itemStats[pool][id];
  if (!s) return false;
  if ((s.skips || 0) >= 1) return true;
  if ((s.answers || 0) >= 8) {
    const rate = (s.correct || 0) / s.answers;
    return rate > 0.95 || rate < 0.05;
  }
  return false;
}

const pools = new Map();
let history = {};
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) { history = {}; }
const seenSets = new Map(); // pool -> Set(ids), mirrors history[pool]

let saveTimer = null;
let warned = false;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(HISTORY_FILE + '.tmp', JSON.stringify(history));
      fs.renameSync(HISTORY_FILE + '.tmp', HISTORY_FILE);
    } catch (err) {
      const e = /** @type {Error} */ (err);
      if (!warned) console.warn(`[library] can't save question history (${e.message}) — repeats possible after restart`);
      warned = true;
    }
  }, 1500);
  if (saveTimer.unref) saveTimer.unref();
}

function hashId(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 10);
}

// Normalize custom content: strings become { text } items.
function normalizeCustom(name, raw) {
  return raw.map((x) => {
    const item = typeof x === 'string' ? { text: x } : { ...x };
    if (name === 'mostlikely' && item.text && !/\?$/.test(item.text)) item.text = item.text.trim();
    item.a = !!(item.a || item.adult);
    item.id = item.id || 'c' + hashId(item);
    return item;
  });
}

function load(name) {
  if (pools.has(name)) return pools.get(name);
  let items = [];
  try { items = JSON.parse(fs.readFileSync(path.join(POOL_DIR, `${name}.json`), 'utf8')); } catch (err) {
    const e = /** @type {Error} */ (err);
    console.warn(`[library] pool ${name} missing: ${e.message}`);
  }
  try {
    const extra = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, `${name}.json`), 'utf8'));
    if (Array.isArray(extra) && extra.length) {
      const custom = normalizeCustom(name, extra);
      items = process.env.RUMPUS_CONTENT_MODE === 'replace' ? custom : items.concat(custom);
      console.log(`[library] ${name}: +${custom.length} custom items`);
    }
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code !== 'ENOENT') console.warn(`[library] content/${name}.json: ${e.message}`);
  }
  const added = (house.get().custom[name] || []).map((x) => ({ ...x, a: !!x.a }));
  if (added.length) items = items.concat(added);
  const pool = { all: items, family: items.filter((i) => !i.a), adult: items.filter((i) => i.a) };
  pools.set(name, pool);
  return pool;
}

function seen(name) {
  if (!seenSets.has(name)) seenSets.set(name, new Set(history[name] || []));
  return seenSets.get(name);
}

function markUsed(name, items) {
  const s = seen(name);
  const list = history[name] || (history[name] = []);
  for (const it of items) {
    if (s.has(it.id)) {
      // Re-used after exhaustion: move to the end (most recent).
      const i = list.indexOf(it.id);
      if (i >= 0) list.splice(i, 1);
    }
    s.add(it.id);
    list.push(it.id);
  }
  while (list.length > HISTORY_CAP) s.delete(list.shift());
  saveSoon();
}

function pickFrom(name, candidates, exclude) {
  const s = seen(name);
  const fresh = candidates.filter((i) => !s.has(i.id) && !exclude.has(i.id));
  if (fresh.length) return fresh[crypto.randomInt(fresh.length)];
  // Everything has been seen: take the least-recently used.
  const list = history[name] || [];
  const order = new Map(list.map((id, i) => [id, i]));
  let best = null;
  for (const c of candidates) {
    if (exclude.has(c.id)) continue;
    const o = order.has(c.id) ? order.get(c.id) : -1;
    if (!best || o < best.o) best = { c, o };
  }
  return best ? best.c : null;
}

/**
 * Draw `n` distinct, not-recently-used items from pool `name`.
 * opts.spicy: include 18+ items (~30% of picks). opts.filter: extra predicate.
 * opts.lang: 'fr' draws the French pack when the pool has enough French items.
 * @param {string} name @param {number} [n]
 * @param {{ spicy?: boolean, filter?: (x: PoolItem) => boolean, lang?: string }} [opts]
 */
function draw(name, n = 1, opts = {}) {
  const pool = load(name);
  // Language: French rooms draw the French pack where a pool has one (≥ n items), else English.
  const lang = opts.lang || 'en';
  const userFilt = opts.filter || (() => true);
  const hasLang = lang !== 'en' && pool.all.filter((/** @type {PoolItem} */ x) => x.lang === lang && userFilt(x)).length >= n;
  const filt = (/** @type {PoolItem} */ x) => userFilt(x) && ((x.lang || 'en') === (hasLang ? lang : 'en'));
  const ok = (/** @type {PoolItem} */ x) => filt(x) && !retired(name, x.id) && !house.isDisabled(name, x.id) && !house.isBanned(x);
  let fam = pool.family.filter(ok);
  let adult = opts.spicy ? pool.adult.filter(ok) : [];
  // Never let retirement empty a pool: fall back to everything if too few remain.
  if (fam.length + adult.length < n) { fam = pool.family.filter(filt); adult = opts.spicy ? pool.adult.filter(filt) : []; }
  const out = [];
  const taken = new Set();
  const s = seen(name);
  const hasFresh = (list) => list.some((x) => !s.has(x.id) && !taken.has(x.id));
  for (let i = 0; i < n; i++) {
    const wantAdult = adult.length && (Math.random() < house.get().spicyShare || !fam.length);
    const [first, second] = wantAdult ? [adult, fam] : [fam, adult];
    // Unseen items from the preferred side, then unseen from the other side,
    // and only when everything has been played: the least-recently used.
    let item = null;
    if (hasFresh(first)) item = pickFrom(name, first, taken);
    else if (hasFresh(second)) item = pickFrom(name, second, taken);
    else item = pickFrom(name, fam.concat(adult), taken);
    if (!item) break;
    taken.add(item.id);
    out.push(item);
  }
  markUsed(name, out);
  return out;
}

function drawOne(name, opts) {
  return draw(name, 1, opts)[0] || null;
}

function stats() {
  const out = {};
  for (const name of fs.readdirSync(POOL_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))) {
    const p = load(name);
    out[name] = { total: p.all.length, adult: p.adult.length, seen: seen(name).size };
  }
  return out;
}

module.exports = { draw, drawOne, load, stats, recordSkip, recordAnswers, retired };
