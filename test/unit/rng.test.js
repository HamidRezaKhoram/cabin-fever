// Seeded randomness (games/rng.js): replayable, bounded, evenly spread.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeRng } = require('../../games/rng');

test('same seed → same sequence; different seeds differ', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const seq = (r) => Array.from({ length: 20 }, () => r.next());
  const sa = seq(a);
  assert.deepStrictEqual(sa, seq(b));
  assert.notDeepStrictEqual(sa, seq(c));
});

test('int/range stay inside their bounds and cover them', () => {
  const r = makeRng(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const n = r.int(3, 9);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 9);
    seen.add(n);
    const x = r.range(1.5, 2.5);
    assert.ok(x >= 1.5 && x < 2.5);
  }
  assert.strictEqual(seen.size, 7, 'every value turns up');
  const sh = r.shuffle([1, 2, 3, 4, 5]);
  assert.deepStrictEqual([...sh].sort(), [1, 2, 3, 4, 5]);
});
