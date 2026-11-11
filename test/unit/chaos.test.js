// Chaos bots (todo 4.5): ordinary bots always answer sensibly and never vote. Real phones don't:
// they answer late, twice, with nothing, with garbage, on the wrong screen, and mash the pace
// votes. Three chaos phones join two ordinary bots (so their pace votes can win) in every game; each game must still reach the
// end, and no game code may throw (a throw is logged as "… failed:" and sent to the TV as a glitch).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer, QUICK } = require('../helpers');
const { decide } = require('../../games/bot-brain');
const { makeRng } = require('../../games/rng');

// skipq is rationed (once a game per phone): a room that votes to replace every question never finishes.
const VOTES = ['hurry', 'wrap', 'ready', 'nonsense', '', '__proto__'];
/** Values that break careless code: wrong types, out of range, prototype names, huge text. */
const JUNK = [null, undefined, -1, 1e9, NaN, 0.5, '', ' ', 'x'.repeat(5000), '__proto__', 'constructor', [], [1, 2, 3], {}, { a: { b: 1 } }, true, false];

/** One chaos phone: answers each new screen with a random mix of the sensible move, repeats,
 * empty or junk payloads, payloads meant for other screens, and pace votes — often late.
 * @param {any} p a test player @param {number} seed */
function chaos(p, seed) {
  const rng = makeRng(seed);
  /** @type {Record<string, any>[]} payloads seen on other screens, replayed in the wrong place */
  const stale = [];
  /** @type {NodeJS.Timeout[]} */
  const timers = [];
  const later = (/** @type {() => void} */ fn) => { timers.push(setTimeout(fn, rng.int(0, 1500))); };
  const junkPayload = () => {
    /** @type {Record<string, any>} */
    const o = {};
    for (const k of ['choice', 'text', 'vote', 'target', 'bet', 'pick', 'value', 'double', 'image', 'taps', 'x', 'y', 'id', 'answer']) if (rng.next() < 0.3) o[k] = rng.pick(JUNK);
    return o;
  };
  let skipqLeft = 1;
  p.sock.on('room:stateUpdate', (/** @type {any} */ s) => {
    if (s && (s.phase === 'lobby' || s.phase === 'gameover')) skipqLeft = 1;
    if (!s || s.phase === 'lobby' || s.phase === 'gameover') return;
    const good = decide({ phase: s.phase, gameState: s.gameState, you: s.you });
    const moves = rng.int(1, 3);
    for (let i = 0; i < moves; i++) {
      const r = rng.next();
      if (r < 0.3 && good) { later(() => p.submit(good.payload)); later(() => p.submit(good.payload)); } // twice
      else if (r < 0.45) later(() => p.submit({}));
      else if (r < 0.65) later(() => p.submit(junkPayload()));
      else if (r < 0.75 && stale.length) later(() => p.submit(rng.pick(stale)));
      else if (r < 0.85) {
        const kind = skipqLeft && rng.next() < 0.2 ? (skipqLeft--, 'skipq') : rng.pick(VOTES);
        later(() => p.sock.emit('player:vote', { kind }));
      }
      else if (r < 0.9) later(() => p.sock.emit('player:submit', rng.pick(JUNK))); // not even an object
      else if (good) later(() => p.submit(good.payload));
    }
    if (good) { stale.push(good.payload); if (stale.length > 30) stale.shift(); }
  });
  return () => timers.forEach(clearTimeout);
}

test('chaos phones (late, repeated, empty, junk, wrong-screen input, random votes) never break a game', { timeout: 3600000 }, async () => {
  // Chaos phones often never send a valid move, so games run on their timers: keep them short, and
  // play 2 rounds, so every game fits in the suite's 10-minute file limit.
  const SHORT = Object.fromEntries(['RUMPUS_CAH_CZAR_MS', 'RUMPUS_CAH_SUBMIT_MS', 'RUMPUS_CG_GUESS_MS', 'RUMPUS_FIB_BLUFF_MS', 'RUMPUS_FIB_CHOOSE_MS',
    'RUMPUS_IMP_CLUE_MS', 'RUMPUS_IMP_GUESS_MS', 'RUMPUS_IMP_VOTE_MS', 'RUMPUS_MR_ANSWER_MS', 'RUMPUS_ML_VOTE_MS', 'RUMPUS_ANSWER_MS', 'RUMPUS_VOTE_MS',
    'RUMPUS_ST_TALK_MS', 'RUMPUS_ST_VOTE_MS', 'RUMPUS_ST_CREW_MS', 'RUMPUS_ST_ACCUSE_MS', 'RUMPUS_TEL_DESCRIBE_MS', 'RUMPUS_TEL_DRAW_MS', 'RUMPUS_TEL_VOTE_MS',
    'RUMPUS_TEL_WRITE_MS', 'RUMPUS_TT_WRITE_MS', 'RUMPUS_TRIVIA_QUESTION_MS'].map((k) => [k, '2500']));
  const srv = await startServer({ ...QUICK, ...SHORT });
  /** @type {(() => void)[]} */
  const stops = [];
  try {
    const h = await makeHost(srv);
    /** @type {any[]} */ const glitches = [];
    h.sock.on('room:event', (/** @type {any} */ e) => { if (e.type === 'glitch') glitches.push(e); });
    for (const [i, n] of ['Chaos', 'Mayhem', 'Havoc'].entries()) stops.push(chaos(await makePlayer(srv, h.code, n), 1000 + i));
    h.emit('host:settings', { rounds: 2 });
    h.emit('host:addBots', { count: 2, speed: 20 });
    await until(() => h.state && h.state.players.length === 5, '3 chaos phones + 2 bots');
    // Same choice of games as the bots test: BOT_GAMES=all in CI, the changed games locally.
    const offered = h.state.availableGames.map((/** @type {{ id: string }} */ g) => g.id);
    const want = (process.env.BOT_GAMES || 'all').split(',').map((x) => x.trim()).filter(Boolean);
    const GAMES = want.includes('all') ? offered : offered.filter((/** @type {string} */ id) => want.includes(id));
    if (!GAMES.length) console.log('# chaos: no game modules changed since HEAD — skipping (BOT_GAMES=all to play every game)');
    for (const gameId of GAMES) {
      const t0 = Date.now();
      h.emit('host:startGame', { gameId });
      await until(() => h.state.gameState && h.state.gameState.gameId === gameId && h.state.phase !== 'lobby', `${gameId} started`);
      // Chaos phones that never answer properly make a game run on its timers (slow, not stuck):
      // what counts is that no screen lasts longer than the longest timer (75 s: Rainy Day Cards,
      // Campfire Quips) plus grace.
      let key = '', since = Date.now(), stuck = '';
      await until(() => {
        const g = h.state.gameState || {};
        const k = [h.state.phase, g.round, g.endsAt, g.matchIndex, g.revealIndex, g.chainIndex, g.sub, g.mini].join(':');
        if (k !== key) { key = k; since = Date.now(); }
        if (Date.now() - since > 90000) stuck = `${gameId}: stuck on ${h.state.phase} for 90 s`;
        return stuck || h.state.phase === 'gameover';
      }, `${gameId} reached gameover with chaos phones (at ${h.state.phase})`, 600000);
      assert.strictEqual(stuck, '', stuck);
      console.log(`# chaos: ${gameId} done in ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    const errors = srv.log().split('\n').filter((l) => / failed:|bot error|game error|TypeError|RangeError/.test(l));
    assert.deepStrictEqual(errors, [], 'no game code threw');
    assert.deepStrictEqual(glitches, [], 'the TV was never told something went wrong');
  } finally { stops.forEach((s) => s()); await srv.stop(); }
});
