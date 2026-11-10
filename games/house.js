/*
 * House rules + content edits, saved in data/house-rules.json and edited at /admin:
 *   timers:  per-game timer speed (multiplies the room's timer setting)
 *   spicyShare: share of 18+ draws when 18+ is on (0–0.6)
 *   banned:  words masked in player answers and never drawn in prompts
 *   disabled: { pool: [itemId] } prompts switched off
 *   custom:  { pool: [item] } prompts added from the editor
 * AGPLv3 — see LICENSE.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.RUMPUS_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'house-rules.json');
const DEFAULT_SPICY = parseFloat(process.env.RUMPUS_SPICY_SHARE || '0.3');

/**
 * @typedef {{ timers: Record<string, number>, spicyShare: number, banned: string[],
 *   disabled: Record<string, string[]>, custom: Record<string, Record<string, any>[]> }} HouseRules
 */

/** @returns {HouseRules} */
function defaults() { return { timers: {}, spicyShare: DEFAULT_SPICY, banned: [], disabled: {}, custom: {} }; }

/** @type {HouseRules} */
let rules = defaults();
try { rules = { ...defaults(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) { /* first run */ }
/** @type {(() => void)[]} */
const listeners = [];

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(rules, null, 1));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { /* read-only data dir: keep in memory */ }
  listeners.forEach((fn) => fn());
}

/** @param {() => void} fn called after every change (the library reloads its pools) */
function onChange(fn) { listeners.push(fn); }

function get() { return rules; }

/** Validate + apply a partial update from /admin. @param {Record<string, any>} patch */
function update(patch) {
  if (patch.timers && typeof patch.timers === 'object') {
    /** @type {Record<string, number>} */
    const t = {};
    for (const [k, v] of Object.entries(patch.timers)) {
      const n = Number(v);
      if (/^[a-z]+$/.test(k) && n >= 0.5 && n <= 3 && n !== 1) t[k] = Math.round(n * 100) / 100;
    }
    rules.timers = t;
  }
  if (patch.spicyShare !== undefined) {
    const n = Number(patch.spicyShare);
    if (Number.isFinite(n)) rules.spicyShare = Math.max(0, Math.min(0.6, n));
  }
  if (Array.isArray(patch.banned)) {
    rules.banned = [...new Set(patch.banned.map((w) => String(w).trim().toLowerCase()).filter((w) => w && w.length <= 40))].slice(0, 200);
  }
  save();
  return rules;
}

/** Timer multiplier for a game. @param {string} gameId */
function timerFor(gameId) { return rules.timers[gameId] || 1; }

/** @returns {RegExp | null} */
function bannedRe() {
  if (!rules.banned.length) return null;
  const esc = rules.banned.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${esc.join('|')})\\b`, 'gi');
}

/** Mask banned words in player text ("duck" → "d★★k"). @param {string} text */
function mask(text) {
  const re = bannedRe();
  return re ? text.replace(re, (w) => w[0] + '★'.repeat(Math.max(1, w.length - 2)) + (w.length > 1 ? w[w.length - 1] : '')) : text;
}

/** Does a pool item mention a banned word? @param {Record<string, any>} item */
function isBanned(item) {
  const re = bannedRe();
  if (!re) return false;
  return re.test(JSON.stringify(item));
}

/** @param {string} pool @param {string} id @param {boolean} off */
function setDisabled(pool, id, off) {
  const list = new Set(rules.disabled[pool] || []);
  if (off) list.add(id); else list.delete(id);
  rules.disabled[pool] = [...list];
  save();
}

/** @param {string} pool @param {string} id */
function isDisabled(pool, id) { return (rules.disabled[pool] || []).includes(id); }

/** @param {string} pool @param {Record<string, any>} item @returns {Record<string, any>} */
function addCustom(pool, item) {
  const it = { ...item, id: 'h' + crypto.randomBytes(5).toString('hex'), custom: true };
  (rules.custom[pool] = rules.custom[pool] || []).push(it);
  save();
  return it;
}

/** @param {string} pool @param {string} id */
function removeCustom(pool, id) {
  const before = (rules.custom[pool] || []).length;
  rules.custom[pool] = (rules.custom[pool] || []).filter((x) => x.id !== id);
  if (rules.custom[pool].length !== before) save();
  return rules.custom[pool].length !== before;
}

/** For tests. */
function _reset() { rules = defaults(); }

module.exports = { get, update, timerFor, mask, isBanned, setDisabled, isDisabled, addCustom, removeCustom, onChange, _reset };
