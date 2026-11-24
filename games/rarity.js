/*
 * How rare an answer's words are (The Deep End's off-chart answers). games/data/wordfreq.json lists
 * English words as "common" (Zipf ≥ 4: used at least 10 times per million words) or "known" (Zipf 3–4);
 * any other word is rare. A phrase is as rare as its rarest words: its Zipf value combines the words'
 * frequencies the way wordfreq does (1 / Σ 1/f), so "golden retriever" is about as rare as "retriever".
 * Built by tools/build-wordfreq.py. AGPLv3 — see LICENSE.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Zipf value used for each kind of word (the middle of its range; a rare word sits below 3). */
const ZIPF = { common: 4.5, known: 3.4, rare: 2.2 };
/** @type {Map<string, number> | null} */
let words = null;

function load() {
  if (words) return words;
  words = new Map();
  try {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'wordfreq.json'), 'utf8'));
    for (const w of String(d.known || '').split(' ')) if (w) words.set(w, ZIPF.known);
    for (const w of String(d.common || '').split(' ')) if (w) words.set(w, ZIPF.common);
  } catch (e) { /* missing list: every word counts as known (no extra depth either way) */ }
  return words;
}

/** The words of an answer, looked up as the list stores them (lower case, no accents, letters only).
 * @param {string} text */
function wordsOf(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1);
}

/** Zipf value of an answer (higher = more common), or null when it has no words. @param {string} text */
function zipf(text) {
  const list = load();
  const ws = wordsOf(text);
  if (!ws.length) return null;
  if (!list.size) return ZIPF.known;
  // A plural the list doesn't have counts as its singular ("beagles" → "beagle").
  const z = (/** @type {string} */ w) => list.get(w) ?? (w.length > 3 && w.endsWith('s') ? list.get(w.slice(0, -1)) : undefined) ?? ZIPF.rare;
  const inv = ws.reduce((sum, w) => sum + 10 ** -z(w), 0);
  return -Math.log10(inv);
}

/** How deep an accepted off-chart answer dives: 2 (Weed Bed) for everyday words, 3 (Drop-off) for
 * known ones, 4 (Lake Bottom) for rare ones. (On the charts, tier medians run Zipf 3.8 → 1.8.)
 * @param {string} text */
function offChartTier(text) {
  const z = zipf(text);
  if (z === null) return 3;
  return z >= 4 ? 2 : z >= 3 ? 3 : 4;
}

module.exports = { zipf, offChartTier, wordsOf };
