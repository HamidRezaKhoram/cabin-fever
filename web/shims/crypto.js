/* Browser stand-in for the bits of Node's `crypto` the game uses (Web Crypto underneath).
 * AGPLv3 — see LICENSE. */
'use strict';

/** Uniform random integer in [0, max) or [min, max). @param {number} a @param {number} [b] */
function randomInt(a, b) {
  const [min, max] = b === undefined ? [0, a] : [a, b];
  const range = max - min;
  if (range <= 0) return min;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / range) * range; // reject the biased tail
  do globalThis.crypto.getRandomValues(buf); while (buf[0] >= limit);
  return min + (buf[0] % range);
}

/** @param {number} n */
function randomBytes(n) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(n));
  return { toString: (/** @type {string} */ _enc) => [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('') };
}

/** A stable, non-cryptographic hash (only used to make short ids for custom prompts). */
function createHash() {
  let text = '';
  const h = {
    update(/** @type {unknown} */ s) { text += String(s); return h; },
    digest() {
      let out = '';
      for (let seed = 0; seed < 5; seed++) { // 5 × 8 hex chars = a SHA-1-length string
        let x = 0x811c9dc5 ^ seed;
        for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 0x01000193); }
        out += (x >>> 0).toString(16).padStart(8, '0');
      }
      return out;
    },
  };
  return h;
}

module.exports = { randomInt, randomBytes, createHash };
