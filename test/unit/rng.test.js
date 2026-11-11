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

test('every game rolls its dice from its seed: the same seed deals the same game', () => {
  const was = process.env.RUMPUS_SEED;
  process.env.RUMPUS_SEED = '4242';
  try {
    const mkRoom = () => ({ players: new Map(['a', 'b', 'c', 'd', 'e'].map((id) => [id, { id, nickname: id.toUpperCase(), score: 0 }])), settings: {} });
    // The game's own dice (who is the imposter, who meets whom, which categories are offered).
    // Which prompts and cards come up is NOT part of the seed: that depends on what this house has
    // already played (games/library.js), on purpose.
    for (const [file, read] of /** @type {[string, (g: any) => unknown][]} */ ([
      ['trivia', (g) => [g.chooserId, g.categoryOptions]],
      ['quiplash', (g) => g.matchups.map((/** @type {any} */ m) => m.authors)],
      ['imposter', (g) => [g.imposter, g.order]],
      ['crush', (g) => [...g.agendas]],
    ])) {
      const Game = require(`../../games/${file}`);
      const deal = () => { const g = new Game(mkRoom(), () => {}); try { g.start(); return JSON.stringify(read(g)); } finally { g.destroy(); } };
      assert.strictEqual(deal(), deal(), `${file}: same seed, same deal`);
      assert.strictEqual(new Game(mkRoom(), () => {}).seed, 4242);
    }
  } finally { if (was === undefined) delete process.env.RUMPUS_SEED; else process.env.RUMPUS_SEED = was; }
});
