'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

global.window = { Rumpus: {} };
global.localStorage = { getItem: () => null, setItem: () => {} };
require('../../public/music.js');
const m = window.Rumpus.music;
const cat = m.catalog();

const GAME_IDS = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8')
  .match(/for \(const mod of \[([^\]]+)\]/)[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1));

test('there are 50+ original tracks', () => {
  assert.ok(m.trackCount >= 50);
  assert.strictEqual(Object.values(cat).flat().length, m.trackCount);
});

test('every cue the TV uses has tracks, and every game has 2+ themes', () => {
  for (const cue of ['title', 'menu', 'vote', 'reveal', 'final', 'scoreboard', 'victory', 'intro', 'category']) {
    assert.ok(cat[cue] && cat[cue].length, `missing cue ${cue}`);
  }
  for (const id of GAME_IDS) assert.ok(cat['game:' + id] && cat['game:' + id].length >= 2, `game ${id} has no theme`);
});

test('track names are unique and melodies are playable', () => {
  const all = Object.values(m.details()).flat();
  assert.strictEqual(new Set(all.map((t) => t.name)).size, all.length);
  for (const t of all) {
    assert.ok(t.notes >= 6, `${t.name}: only ${t.notes} notes`);
    assert.ok(t.lo >= 55 && t.hi <= 96, `${t.name}: range ${t.lo}-${t.hi}`);
    assert.ok(t.bpm >= 80 && t.bpm <= 180, `${t.name}: bpm ${t.bpm}`);
  }
});

test('composition is deterministic (same tracks every load)', () => {
  const again = JSON.stringify(m.details());
  delete require.cache[require.resolve('../../public/music.js')];
  require('../../public/music.js');
  assert.strictEqual(JSON.stringify(window.Rumpus.music.details()), again);
});
