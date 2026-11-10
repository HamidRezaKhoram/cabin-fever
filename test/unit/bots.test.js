// Test bots: in-room bots (host:addBots) play every game to the end through the shared
// bot brain — so the "Add bots" test tool keeps working as games gain new mechanics.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost } = require('../helpers');
const { decide } = require('../../games/bot-brain');

// Short real-time timers so bots can finish every game quickly.
const QUICK = {
  RUMPUS_MG_INTRO_MS: '200', RUMPUS_MG_RESULT_MS: '200', RUMPUS_MG_TUG_MS: '1500', RUMPUS_MG_ROAST_MS: '3000',
  RUMPUS_MG_FLY_SHOW_MS: '300', RUMPUS_MG_FLY_GUESS_MS: '3000', RUMPUS_MG_DRAW_WINDOW: '1500',
  RUMPUS_TEL_FAV_MS: '3000', RUMPUS_TRIVIA_CATEGORY_MS: '2000', RUMPUS_CR_REVEAL_STEP_MS: '150',
  RUMPUS_LC_TEMPO: '4', RUMPUS_LC_PHRASES: '2', RUMPUS_LC_LEAD_MS: '300', RUMPUS_LC_RESULT_MS: '200',
  RUMPUS_LL_INTRO_MS: '300', RUMPUS_LL_PLAY_MS: '2500', RUMPUS_LL_RESULT_MS: '200',
};
let srv;
test.before(async () => {
  srv = await startServer({ ...QUICK, ...(process.env.SNAP_DIR ? { RUMPUS_DEBUG: '1' } : {}) });
});
test.after(() => srv.stop());

test('host can add and remove bots; bots are flagged and get looks', async () => {
  const h = await makeHost(srv);
  h.emit('host:addBots', { count: 3, speed: 20 });
  await until(() => h.state && h.state.players.length === 3, '3 bots');
  assert.ok(h.state.players.every((p) => p.bot && p.look && p.connected));
  assert.strictEqual(new Set(h.state.players.map((p) => p.nickname)).size, 3, 'unique names');
  h.emit('host:removeBots');
  await until(() => h.state.players.length === 0, 'bots removed');
});

test('bots play every game to the end (fast bots, 4 players)', { timeout: 240000 }, async () => {
  const h = await makeHost(srv);
  h.emit('host:addBots', { count: 4, speed: 20 });
  await until(() => h.state && h.state.players.length === 4, '4 bots');
  // Which games: BOT_GAMES=all (CI) plays every game the server offers; otherwise test-all passes
  // the games changed or added since the last commit (BOT_GAMES=a,b), so local runs stay quick.
  const offered = h.state.availableGames.map((/** @type {{ id: string }} */ g) => g.id);
  const want = (process.env.BOT_GAMES || 'all').split(',').map((x) => x.trim()).filter(Boolean);
  const GAMES = want.includes('all') ? offered : offered.filter((/** @type {string} */ id) => want.includes(id));
  if (!GAMES.length) console.log('# bots: no game modules changed since HEAD — skipping (BOT_GAMES=all to play every game)');
  for (const gameId of GAMES) {
    h.emit('host:startGame', { gameId });
    await until(() => h.state.gameState && h.state.gameState.gameId === gameId && h.state.phase !== 'lobby', `${gameId} started`);
    const rec = process.env.SNAP_DIR ? recordScreens(h.code, gameId) : null;
    await until(() => h.state.phase === 'gameover', `${gameId} reached gameover with bots (stuck at ${h.state.phase})`, 60000);
    if (rec) await rec.stop();
  }
});

/**
 * Screen snapshots: while bots play, keep every distinct TV and phone screen (the exact payloads
 * from /api/debug/views). The browser test renders all of them, so every screen of every game is
 * tested on each run even though bots only replay the games that changed.
 * @param {string} code @param {string} gameId
 */
function recordScreens(code, gameId) {
  const fs = require('fs'), path = require('path');
  /** @type {Map<string, any>} */
  const seen = new Map();
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const shrink = (/** @type {any} */ v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'string' && x.startsWith('data:image/') ? tiny : x)));
  // A screen's "shape": phase, sub-step, and which fields are set — not the exact words.
  const shape = (/** @type {any} */ st, /** @type {string} */ who) => [who, st.phase, st.gameState && (st.gameState.sub || st.gameState.scene || st.gameState.mini || ''),
    Object.entries(st.you || {}).filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && !v.length)).map(([k]) => k).sort().join(',')].join('|');
  let stopped = false;
  const poll = (async () => {
    while (!stopped) {
      try {
        const v = await fetch(`${srv.url}/api/debug/views?room=${code}`).then((r) => r.json());
        if (v.host && v.host.phase !== 'lobby') {
          const hk = shape(v.host, 'host'); if (!seen.has(hk)) seen.set(hk, { kind: 'host', state: shrink(v.host) });
          for (const p of v.players || []) { const pk = shape(p, 'player'); if (!seen.has(pk)) seen.set(pk, { kind: 'player', state: shrink(p) }); }
        }
      } catch (e) { /* server busy: next time */ }
      await new Promise((r) => setTimeout(r, 60));
    }
  })();
  return {
    async stop() {
      stopped = true;
      await poll;
      fs.mkdirSync(process.env.SNAP_DIR || '.', { recursive: true });
      fs.writeFileSync(path.join(process.env.SNAP_DIR || '.', `${gameId}.json`), JSON.stringify([...seen.values()]));
    },
  };
}

test('bot brain answers every input screen a phone can show', () => {
  const screens = [
    { phase: 'answering', gameState: { prompt: 'x' }, you: { submitted: false } },
    { phase: 'mr-answer', gameState: { maxBet: 3 }, you: { submitted: true, bet: null } },
    { phase: 'fib-choose', gameState: { options: [{ index: 2 }] }, you: { picked: false } },
    { phase: 'trivia-question', gameState: { choices: ['a', 'b'] }, you: { answered: false, canDouble: true } },
    { phase: 'cah-submit', gameState: {}, you: { isCzar: true, nextOptions: ['a', 'b', 'c'], nextPick: null } },
    { phase: 'tel-reveal', gameState: { favOpen: true, entries: [{ ok: false }, { ok: true }] }, you: { fav: null, canFav: true } },
    { phase: 'mg-play', gameState: { mini: 'quickdraw', sub: 'go' }, you: { done: false, early: false } },
    { phase: 'night-vote', gameState: { options: [{}, {}, {}] }, you: { voted: false } },
    { phase: 'll-play', gameState: { scene: 'fireflies' }, you: { pos: [10, 10], target: [100, 50] } },
    { phase: 'lc-song', gameState: { serverNow: 5000, sched: { barMs: 1000, steps: 8, phrases: [{ steps: [0, 4], echoAt: 3000 }] } }, you: { tapped: [], judged: [] } },
  ];
  for (const s of screens) assert.ok(decide(s), `no decision for ${s.phase}`);
  assert.deepStrictEqual(decide(screens[5]).payload, { fav: 1 }, 'never favourites a step it may not pick');
  assert.strictEqual(decide({ phase: 'mr-answer', gameState: {}, you: { submitted: true, bet: 1 } }), null, 'done → nothing');
});

test('game night: phones vote the next game, placings earn night points, a champion at the end', { timeout: 120000 }, async () => {
  const { placePoints } = require('../../games/night');
  const pts = placePoints([{ id: 'a', score: 900 }, { id: 'b', score: 900 }, { id: 'c', score: 100 }, { id: 'd', score: 0 }]);
  assert.deepStrictEqual([pts.get('a'), pts.get('b'), pts.get('c'), pts.get('d')], [10, 10, 4, 0], 'ties share the better placing; 0 points = no night points');
  const s2 = await startServer({ ...QUICK, RUMPUS_NIGHT_VOTE_MS: '3000', RUMPUS_NIGHT_PICK_MS: '200', RUMPUS_NIGHT_GAP_MS: '300' });
  try {
    const h = await makeHost(s2);
    h.emit('host:addBots', { count: 4, speed: 20 });
    await until(() => h.state && h.state.players.length === 4, 'bots');
    h.emit('host:startNight', { count: 2 });
    const v = await h.phase('night-vote');
    assert.strictEqual(v.gameState.options.length, 3);
    assert.strictEqual(new Set(v.gameState.options.map((o) => o.id)).size, 3, 'three different games');
    const played = [];
    for (let i = 0; i < 2; i++) {
      if (i > 0) await h.phase('night-vote', 20000);
      await until(() => h.state.gameState.gameId && h.state.gameState.gameId !== 'night', `game ${i + 1} starts`, 20000);
      played.push(h.state.gameState.gameId);
      await until(() => h.state.phase === 'gameover' && h.state.night && h.state.night.played === i + 1, `game ${i + 1} counted`, 90000);
      assert.ok(h.state.night.standings.some((x) => x.points > 0), 'night points awarded');
    }
    await h.phase('night-final', 20000);
    assert.notStrictEqual(played[0], played[1], 'no repeats within a night');
    h.emit('host:endGame');
    await until(() => h.state.phase === 'lobby' && h.state.night === null, 'back to the menu');
  } finally { await s2.stop(); }
});
