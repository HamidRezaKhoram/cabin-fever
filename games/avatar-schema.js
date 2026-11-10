/*
 * Character-maker option counts, shared by the server (validation) and the
 * client (public/avatar-maker.js must have exactly these many choices per part;
 * a static test checks they match). AGPLv3 — see LICENSE.
 */
'use strict';

/** @type {Record<string, number>} part → number of choices */
const LOOK_PARTS = {
  faceShape: 5, skin: 10, eyes: 6, mouth: 4, makeup: 4,
  hair: 28, hairColor: 13, facial: 7,
  glasses: 4, hat: 18, earrings: 3,
  top: 9, bg: 8,
};

/**
 * @param {unknown} look
 * @returns {Record<string, number> | null} a clean copy, or null if invalid
 */
function cleanLook(look) {
  if (!look || typeof look !== 'object') return null;
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, n] of Object.entries(LOOK_PARTS)) {
    let v = /** @type {Record<string, unknown>} */ (look)[k];
    if (v === undefined) v = 0; // parts added later default to their first option
    if (!Number.isInteger(v) || /** @type {number} */ (v) < 0 || /** @type {number} */ (v) >= n) return null;
    out[k] = /** @type {number} */ (v);
  }
  return out;
}

module.exports = { LOOK_PARTS, cleanLook };
