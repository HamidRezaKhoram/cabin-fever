/*
 * Test kit — randomised tests you can replay. No project knowledge: copy into any project.
 *   const { seed, rng } = seeded('chaos');        // SEED=123 replays a run; otherwise a fresh seed
 *   const { seed } = seeded('chaos', 1000);       // fixed 1000 unless SEED is set (nightly sets a fresh one)
 * The seed is printed if the process fails, so a red run says exactly how to reproduce it.
 */
'use strict';

/** mulberry32: small, fast, good enough for tests. @param {number} a */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {string} what a name for the log line @param {number} [fallback] the seed when SEED isn't set (else random) */
function seeded(what, fallback) {
  const seed = process.env.SEED ? Number(process.env.SEED) : fallback !== undefined ? fallback : Math.floor(Math.random() * 2 ** 31);
  console.log(`# ${what}: SEED=${seed}`);
  process.on('exit', (code) => { if (code !== 0) console.error(`\n[${what}] failed with SEED=${seed} — rerun with SEED=${seed} to replay`); });
  const next = mulberry32(seed);
  return {
    seed,
    rng: {
      next,
      /** @param {number} lo @param {number} hi inclusive */ int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      /** @template T @param {T[]} a @returns {T} */ pick: (a) => a[Math.floor(next() * a.length)],
    },
  };
}

module.exports = { seeded, mulberry32 };
