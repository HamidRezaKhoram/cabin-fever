/*
 * Seeded randomness for games: every random choice in a game (which minigames, how long to hold,
 * where targets appear, which rhythms) comes from one seed, always inside set bounds. The same
 * seed replays the same game (RUMPUS_SEED=1234 forces one; the seed is in the debug dump).
 * mulberry32: tiny, fast, good enough for party games. AGPLv3 — see LICENSE.
 */
'use strict';

const crypto = require('crypto');

/** A fresh random seed (32-bit), or the forced one from RUMPUS_SEED. */
function newSeed() {
  const forced = Number(process.env.RUMPUS_SEED);
  return Number.isInteger(forced) && forced > 0 ? forced >>> 0 : crypto.randomInt(1, 2 ** 31);
}

/** @param {number} seed */
function makeRng(seed) {
  let a = seed >>> 0;
  /** A float in [0, 1). */
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    seed: seed >>> 0,
    next,
    /** Whole number in [lo, hi] (both inclusive). @param {number} lo @param {number} hi */
    int: (lo, hi) => (hi < lo ? Math.ceil(lo) : Math.ceil(lo) + Math.floor(next() * (Math.floor(hi) - Math.ceil(lo) + 1))),
    /** Number in [lo, hi). @param {number} lo @param {number} hi */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** @template T @param {T[]} arr @returns {T} */
    pick: (arr) => arr[Math.floor(next() * arr.length)], // undefined for an empty list
    /** Shuffled copy. @template T @param {T[]} arr @returns {T[]} */
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
      return out;
    },
    /** True with probability p. @param {number} p */
    chance: (p) => next() < p,
    /** A child generator (its own stream, still fixed by this seed). */
    fork: () => makeRng(Math.floor(next() * 2 ** 32) || 1),
  };
  return rng;
}

module.exports = { makeRng, newSeed };
