/*
 * House rules + content editor API (/admin), shared by server.js (Express routes) and the
 * GitHub Pages build (answered inside the browser). Plain functions: (query/body) → result.
 * AGPLv3 — see LICENSE.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const library = require('../games/library');
const house = require('../games/house');

/** Every content pool (games/data/pools/*.json), read once. */
const POOL_NAMES = fs.readdirSync(path.join(__dirname, '..', 'games', 'data', 'pools')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
/** One-line summary of a pool item for the editor. @param {Record<string, any>} x */
const summarize = (x) => x.text || x.q || (x.category ? `${x.category}: ${(x.words || []).join(', ')}` : JSON.stringify(x));
/** Build a valid pool item from editor fields (or explain what's wrong). @param {string} pool @param {Record<string, any>} b
 * @returns {{ item?: Record<string, any>, error?: string }} */
function itemFromForm(pool, b) {
  const t = (/** @type {unknown} */ v, n = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '');
  const a = !!b.a;
  if (['punchline', 'majority', 'mostlikely', 'telephone', 'cah-white'].includes(pool)) {
    const text = t(b.text);
    return text ? { item: { text, a } } : { error: 'Write the prompt text.' };
  }
  if (pool === 'cah-black') {
    const text = t(b.text);
    return text.includes('____') || text.endsWith('?') ? { item: { text, pick: 1, a } } : { error: 'Prompt cards need a blank (____) or a question mark.' };
  }
  if (pool === 'trivia') {
    const q = t(b.q), correct = t(b.answer, 60), wrong = (Array.isArray(b.wrong) ? b.wrong : []).map((/** @type {unknown} */ w) => t(w, 60)).filter(Boolean);
    if (!q || !correct || wrong.length !== 3) return { error: 'Trivia needs a question, the right answer and 3 wrong answers.' };
    const choices = [...wrong, correct].sort(() => crypto.randomInt(3) - 1);
    return { item: { q, choices, correct: choices.indexOf(correct), cat: t(b.cat, 30) || 'House questions', a } };
  }
  if (pool === 'fibbage') {
    const q = t(b.q), answer = t(b.answer, 60);
    return q.includes('____') && answer ? { item: { q, answer, a } } : { error: 'Fish Tales needs a fact with a blank (____) and its real answer.' };
  }
  if (pool === 'closest') {
    const q = t(b.q), answer = Number(String(b.answer).replace(/,/g, ''));
    return q && Number.isFinite(answer) ? { item: { q, answer, unit: t(b.unit, 20), a } } : { error: 'Closest Cast needs a question and a number.' };
  }
  if (pool === 'imposter') {
    const words = [...new Set(String(b.words || '').split(',').map((w) => t(w, 30)).filter(Boolean))];
    return t(b.category) && words.length >= 4 ? { item: { category: t(b.category, 40), word: words[0], words, a } } : { error: 'Odd Duck Out needs a category and at least 4 comma-separated words.' };
  }
  return { error: 'Unknown pool.' };
}

/** @typedef {{ status: number, body: Record<string, any> }} Reply */

/** @param {{ id: string, name: string }[]} games @returns {Reply} */
function getRules(games) { return { status: 200, body: { rules: house.get(), games: games.map((m) => ({ id: m.id, name: m.name })), pools: POOL_NAMES } }; }
/** @param {Record<string, any>} body @returns {Reply} */
function setRules(body) { return { status: 200, body: { rules: house.update(body || {}) } }; }
/** @param {string} pool @param {string} q @param {number} page @returns {Reply} */
function listContent(pool, q, page) {
  if (!POOL_NAMES.includes(pool)) return { status: 404, body: { error: 'Unknown pool' } };
  const needle = q.toLowerCase();
  const all = library.load(pool).all.filter((/** @type {Record<string, any>} */ x) => !needle || summarize(x).toLowerCase().includes(needle));
  const p = Math.max(0, page || 0);
  return { status: 200, body: {
    total: all.length,
    items: all.slice(p * 50, p * 50 + 50).map((/** @type {Record<string, any>} */ x) => ({ id: x.id, text: summarize(x), a: !!x.a, custom: !!x.custom, disabled: house.isDisabled(pool, x.id), src: x.src || '' })),
  } };
}
/** @param {string} pool @param {Record<string, any>} body @returns {Reply} */
function addContent(pool, body) {
  if (!POOL_NAMES.includes(pool)) return { status: 404, body: { error: 'Unknown pool' } };
  const r = itemFromForm(pool, body || {});
  if (!r.item) return { status: 400, body: { error: r.error } };
  return { status: 200, body: { item: house.addCustom(pool, r.item) } };
}
/** @param {string} pool @param {string} id @param {boolean} disabled @returns {Reply} */
function setDisabled(pool, id, disabled) { house.setDisabled(pool, id, disabled); return { status: 200, body: { ok: true } }; }
/** @param {string} pool @param {string} id @returns {Reply} */
function removeContent(pool, id) { return { status: 200, body: { ok: house.removeCustom(pool, id) } }; }

module.exports = { POOL_NAMES, getRules, setRules, listContent, addContent, setDisabled, removeContent };
