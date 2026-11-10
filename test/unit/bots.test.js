// Test bots: in-room bots (host:addBots) play every game to the end through the shared
// bot brain — so the "Add bots" test tool keeps working as games gain new mechanics.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost } = require('../helpers');
const { decide } = require('../../games/bot-brain');

let srv;
test.before(async () => {
  srv = await startServer({
    RUMPUS_MG_INTRO_MS: '200', RUMPUS_MG_RESULT_MS: '200', RUMPUS_MG_TUG_MS: '1500', RUMPUS_MG_ROAST_MS: '3000',
    RUMPUS_MG_FLY_SHOW_MS: '300', RUMPUS_MG_FLY_GUESS_MS: '3000', RUMPUS_MG_DRAW_WINDOW: '1500',
    RUMPUS_TEL_FAV_MS: '3000', RUMPUS_TRIVIA_CATEGORY_MS: '2000',
  });
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

const GAMES = ['quiplash', 'fibbage', 'trivia', 'closest', 'majority', 'mostlikely', 'imposter', 'twotruths', 'telephone', 'cah', 'minigames'];
test('bots play every game to the end (fast bots, 4 players)', { timeout: 240000 }, async () => {
  const h = await makeHost(srv);
  h.emit('host:addBots', { count: 4, speed: 20 });
  await until(() => h.state && h.state.players.length === 4, '4 bots');
  for (const gameId of GAMES) {
    h.emit('host:startGame', { gameId });
    await until(() => h.state.gameState && h.state.gameState.gameId === gameId && h.state.phase !== 'lobby', `${gameId} started`);
    await until(() => h.state.phase === 'gameover', `${gameId} reached gameover with bots (stuck at ${h.state.phase})`, 60000);
    assert.ok(h.state.players.some((p) => p.score > 0), `${gameId}: bots scored`);
  }
});

test('bot brain answers every input screen a phone can show', () => {
  const screens = [
    { phase: 'answering', gameState: { prompt: 'x' }, you: { submitted: false } },
    { phase: 'mr-answer', gameState: { maxBet: 3 }, you: { submitted: true, bet: null } },
    { phase: 'fib-choose', gameState: { options: [{ index: 2 }] }, you: { picked: false } },
    { phase: 'trivia-question', gameState: { choices: ['a', 'b'] }, you: { answered: false, canDouble: true } },
    { phase: 'cah-submit', gameState: {}, you: { isCzar: true, nextOptions: ['a', 'b', 'c'], nextPick: null } },
    { phase: 'tel-reveal', gameState: { favOpen: true, entries: [{ ok: false }, { ok: true }] }, you: { fav: null, canFav: true } },
    { phase: 'mg-play', gameState: { mini: 'quickdraw', sub: 'go' }, you: { done: false, early: false } },
  ];
  for (const s of screens) assert.ok(decide(s), `no decision for ${s.phase}`);
  assert.deepStrictEqual(decide(screens[5]).payload, { fav: 1 }, 'never favourites a step it may not pick');
  assert.strictEqual(decide({ phase: 'mr-answer', gameState: {}, you: { submitted: true, bet: 1 } }), null, 'done → nothing');
});
