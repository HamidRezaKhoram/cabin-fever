/* Compiles every soundtrack cue headlessly and sanity-checks the output. AGPLv3. */
'use strict';
const assert = require('assert');
global.window = { Rumpus: {} };
global.localStorage = { getItem: () => null, setItem: () => {} };
require('../public/music.js');
const m = window.Rumpus.music;
const cat = m.catalog();
let total = 0;
for (const [cue, names] of Object.entries(cat)) {
  total += names.length;
  console.log(`  ${cue.padEnd(16)} ${names.length}  ${names.join(' · ')}`);
}
assert(total >= 50, 'expected 50+ tracks, got ' + total);
assert.strictEqual(m.trackCount, total);
for (const id of ['quiplash', 'fibbage', 'trivia', 'closest', 'majority', 'mostlikely', 'imposter', 'twotruths', 'telephone', 'cah']) {
  assert(cat['game:' + id] && cat['game:' + id].length >= 2, 'missing theme for ' + id);
}
const all = Object.values(m.details()).flat();
assert.strictEqual(new Set(all.map((t) => t.name)).size, all.length, 'duplicate track names');
for (const t of all) {
  assert(t.notes >= 6, `${t.name}: too few melody notes (${t.notes})`);
  assert(t.lo >= 55 && t.hi <= 96, `${t.name}: melody out of range ${t.lo}-${t.hi}`);
}
console.log('PASS: all track names unique; every melody has 6+ notes within a playable range');
console.log(`PASS: ${total} tracks across ${Object.keys(cat).length} cues; every game has its own themes`);
