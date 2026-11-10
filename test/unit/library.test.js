'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpDir, contentDir, sleep } = require('../helpers');

function freshLib(env = {}) {
  Object.assign(process.env, { RUMPUS_DATA_DIR: tmpDir(), RUMPUS_CONTENT_DIR: '/nonexistent', RUMPUS_CONTENT_MODE: '' }, env);
  delete require.cache[require.resolve('../../games/library')];
  return require('../../games/library');
}

const PER_GAME = { punchline: 8, trivia: 10, fibbage: 8, closest: 8, majority: 8, mostlikely: 8, imposter: 5, telephone: 8, 'cah-black': 10 };

test('no item repeats across 12 games', () => {
  const lib = freshLib();
  for (const [pool, per] of Object.entries(PER_GAME)) {
    const seen = new Set();
    for (let g = 0; g < 12; g++) for (const it of lib.draw(pool, per, { spicy: true })) {
      assert.ok(!seen.has(it.id), `${pool}: repeat in game ${g + 1}`);
      seen.add(it.id);
    }
  }
});

test('18+ mode mixes in roughly 15–50% adult items; family mode never does', () => {
  const lib = freshLib();
  for (const pool of Object.keys(PER_GAME)) {
    const items = lib.draw(pool, 200, { spicy: true });
    const share = items.filter((x) => x.a).length / items.length;
    assert.ok(share >= 0.15 && share <= 0.95, `${pool} adult share ${share}`);
    assert.ok(lib.draw(pool, 60, { spicy: false }).every((x) => !x.a), `${pool}: adult item in family mode`);
  }
});

test('history survives a restart and a corrupt history file is tolerated', async () => {
  const dir = tmpDir();
  let lib = freshLib({ RUMPUS_DATA_DIR: dir });
  const first = lib.draw('mostlikely', 5);
  await sleep(1800);
  assert.ok(fs.existsSync(path.join(dir, 'history.json')));
  lib = freshLib({ RUMPUS_DATA_DIR: dir });
  const next = lib.draw('mostlikely', 600); // fewer than the family pool, so no reuse is needed
  assert.ok(!next.some((x) => first.some((f) => f.id === x.id)), 'repeated after restart');
  fs.writeFileSync(path.join(dir, 'history.json'), '{not json');
  lib = freshLib({ RUMPUS_DATA_DIR: dir });
  assert.strictEqual(lib.draw('mostlikely', 3).length, 3);
});

test('once a pool is exhausted it reuses the least-recently-played items first', () => {
  const lib = freshLib({ RUMPUS_CONTENT_DIR: contentDir({ majority: ['a', 'b', 'c'] }), RUMPUS_CONTENT_MODE: 'replace' });
  const order = [];
  for (let i = 0; i < 6; i++) order.push(lib.draw('majority', 1)[0].text);
  assert.deepStrictEqual([...new Set(order.slice(0, 3))].sort(), ['a', 'b', 'c']);
  assert.deepStrictEqual(order.slice(3), order.slice(0, 3));
});

test('custom content is appended (default) or replaces the pool', () => {
  const dir = contentDir({ majority: ['Custom one', { text: 'Custom adult', adult: true }] });
  let lib = freshLib({ RUMPUS_CONTENT_DIR: dir });
  const all = lib.load('majority').all;
  assert.ok(all.length > 1000 && all.some((x) => x.text === 'Custom one'));
  assert.ok(all.find((x) => x.text === 'Custom adult').a);
  lib = freshLib({ RUMPUS_CONTENT_DIR: dir, RUMPUS_CONTENT_MODE: 'replace' });
  assert.strictEqual(lib.load('majority').all.length, 2);
});

test('draw honours a filter', () => {
  const lib = freshLib();
  const items = lib.draw('trivia', 20, { filter: (q) => q.cat === 'History' });
  assert.ok(items.length === 20 && items.every((q) => q.cat === 'History'));
});

test('telemetry retires items a majority skipped and items that do not separate players (IRT)', () => {
  const lib = freshLib({ RUMPUS_CONTENT_DIR: contentDir({ majority: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }), RUMPUS_CONTENT_MODE: 'replace' });
  const items = lib.load('majority').all;
  lib.recordSkip('majority', items[0].id);
  lib.recordAnswers('majority', items[1].id, 10, 10); // everyone right: no discrimination
  lib.recordAnswers('majority', items[2].id, 0, 9);   // everyone wrong
  lib.recordAnswers('majority', items[3].id, 5, 10);  // splits the room: keep
  assert.ok(lib.retired('majority', items[0].id) && lib.retired('majority', items[1].id) && lib.retired('majority', items[2].id));
  assert.ok(!lib.retired('majority', items[3].id));
  const drawn = lib.draw('majority', 2).map((x) => x.text);
  assert.ok(!drawn.some((t) => ['a', 'b', 'c'].includes(t)), 'retired items are not drawn');
});
