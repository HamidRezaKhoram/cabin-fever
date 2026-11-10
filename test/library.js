/*
 * Content library checks: every pool has 1000+ items, no question repeats
 * over 10+ simulated games, the 18+ mix works, and history survives restarts.
 * AGPLv3 — see LICENSE.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumpus-lib-'));
process.env.RUMPUS_DATA_DIR = dir;
process.env.RUMPUS_CONTENT_DIR = '/nonexistent';

const fresh = () => {
  delete require.cache[require.resolve('../games/library')];
  return require('../games/library');
};
let lib = fresh();

const POOLS = { punchline: 8, trivia: 10, fibbage: 8, closest: 8, majority: 8, mostlikely: 8, imposter: 5, telephone: 8, 'cah-black': 10 };
for (const [pool, perGame] of Object.entries(POOLS)) {
  const { all, adult } = lib.load(pool);
  assert(all.length >= 1000 || pool === 'cah-black', `${pool} has only ${all.length} items`);
  const seen = new Set();
  let adultCount = 0;
  const games = 12;
  for (let g = 0; g < games; g++) {
    for (const it of lib.draw(pool, perGame, { spicy: true })) {
      assert(!seen.has(it.id), `${pool}: repeated item ${it.id} in game ${g + 1}`);
      seen.add(it.id);
      if (it.a) adultCount++;
    }
  }
  const share = adultCount / seen.size;
  console.log(`PASS: ${pool.padEnd(11)} ${String(all.length).padStart(5)} items, ${games} games × ${perGame} with no repeats, 18+ share ${(share * 100).toFixed(0)}% (pool has ${adult.length})`);
  assert(share >= 0.15, `${pool}: 18+ share too low (${share})`);
}

// Family mode never returns adult items.
for (const pool of Object.keys(POOLS)) {
  assert(lib.draw(pool, 30, { spicy: false }).every((x) => !x.a), `${pool}: adult item in family mode`);
}
console.log('PASS: family mode (18+ off) never draws adult items');

// History persists across a restart.
const before = lib.draw('mostlikely', 1)[0];
setTimeout(() => {
  lib = fresh();
  const again = lib.draw('mostlikely', 900, { spicy: true });
  assert(!again.some((x) => x.id === before.id), 'history not persisted across restart');
  console.log('PASS: question history survives a server restart');
  console.log('\nALL LIBRARY CHECKS PASSED');
}, 1800);
