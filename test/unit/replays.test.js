// Golden replays (docs/future-features/testing-plan.md, phase 4): a whole game played in-process with a
// fixed seed — same prompts (library replay mode), same dice (games/rng.js), same bot choices
// (games/bot-brain.js), a fake clock — must go through the same phases and end with the same scores as
// the copy in test/replays/golden.json. Catches rule and scoring changes nobody meant to make.
// Meant to change them? RECORD=1 node --test test/unit/replays.test.js, and say why in the commit.
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
// Before the game modules load: replay mode reads these once.
process.env.RUMPUS_REPLAY = '1';
process.env.RUMPUS_SEED = '4242';
process.env.RUMPUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-replay-'));
process.env.RUMPUS_CONTENT_DIR = '/nonexistent';
const test = require('node:test');
const assert = require('node:assert');
const library = require('../../games/library');
const { decide } = require('../../games/bot-brain');
const { makeRng } = require('../../games/rng');
const { golden } = require('../kit/golden');

const GOLDEN = path.join(__dirname, '..', 'replays', 'golden.json');
const NAMES = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve'];

/** Play one game to the end. Bots act on every screen; when nobody has anything to do, the pending
 * timer fires (as if it ran out). @param {string} id @param {number} seed */
function play(id, seed) {
  const Game = require(`../../games/${id}`);
  const realNow = Date.now;
  let now = 1_700_000_000_000;
  Date.now = () => now; // speed bonuses, timers: all from this clock
  try {
    library.replayReset();
    const room = /** @type {any} */ ({ code: 'TEST', settings: { rounds: 3, spicy: true }, players: new Map(NAMES.map((n, i) => ['p' + i, { id: 'p' + i, nickname: n, score: 0, connected: true }])) });
    const game = new Game(room, () => {});
    game.seed = seed; game.rng = makeRng(seed);
    const bots = makeRng(seed ^ 0x9e3779b9);
    /** @type {string[]} */ const phases = [];
    game.start();
    for (let step = 0; step < 3000 && game.phase !== 'gameover'; step++) {
      const at = `${game.phase}#${game.round}`;
      if (phases[phases.length - 1] !== at) phases.push(at);
      const before = JSON.stringify(game.hostGameState());
      for (const pid of room.players.keys()) {
        const view = { phase: game.phase, ...game.playerView(pid) };
        const d = decide(view, bots.next);
        if (d) game.handleSubmit(pid, d.payload);
        now += 700;
      }
      if (JSON.stringify(game.hostGameState()) === before) {
        assert.ok(game.timerFn, `${id}: stuck on ${game.phase} — no player can act and no timer is pending`);
        now = Math.max(now, game.endsAt || now) + 100;
        game.skip();
      }
    }
    assert.strictEqual(game.phase, 'gameover', `${id} reached the end`);
    game.destroy();
    return { phases, scores: Object.fromEntries([...room.players.values()].map((p) => [p.nickname, p.score])) };
  } finally { Date.now = realNow; }
}

for (const id of ['trivia', 'quiplash', 'storm']) {
  test(`golden replay: ${id} (seed 4242, 5 bots) plays the same as recorded`, () => {
    const a = play(id, 4242);
    assert.deepStrictEqual(play(id, 4242), a, 'the same seed plays the same game twice in a row');
    golden(GOLDEN, id, a);
  });
}
