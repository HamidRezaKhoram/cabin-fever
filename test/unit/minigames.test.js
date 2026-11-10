'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, until, sleep, makeHost, makePlayer } = require('../helpers');

let srv;
before(async () => {
  srv = await startServer({
    RUMPUS_MG_ORDER: 'tug,quickdraw,fireflies,roast', RUMPUS_MG_INTRO_MS: '100', RUMPUS_MG_RESULT_MS: '200',
    RUMPUS_MG_TUG_MS: '1500', RUMPUS_MG_DRAW_MIN: '300', RUMPUS_MG_DRAW_MAX: '400', RUMPUS_MG_DRAW_WINDOW: '1500',
    RUMPUS_MG_FLY_SHOW_MS: '200', RUMPUS_MG_FLY_GUESS_MS: '1500', RUMPUS_MG_ROAST_MS: '1500',
  });
});
after(() => srv.stop());

async function room(n, settings = {}) {
  const h = await makeHost(srv);
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(await makePlayer(srv, h.code, 'P' + i));
  await until(() => h.state.players.length === n, 'joined');
  h.emit('host:settings', { rounds: 4, ...settings });
  await until(() => h.state.settings.rounds === 4 && (settings.teams === undefined || h.state.settings.teams === settings.teams), 'settings');
  return { h, ps, score: (/** @type {string} */ n) => h.state.players.find((p) => p.nickname === n).score };
}
const playing = (h, mini, sub) => until(() => h.state.phase === 'mg-play' && h.state.gameState.mini === mini && (!sub || h.state.gameState.sub === sub) && h.state, `${mini} ${sub || ''}`);

test('free-for-all series: tap race, quick draw, fireflies, roast — scoring and rules', async () => {
  const { h, ps, score } = await room(3);
  h.emit('host:startGame', { gameId: 'minigames' });
  assert.deepStrictEqual((await h.phase('mg-intro')).pace.allowed, [], 'no skip/hurry in minigames');
  // 1. Tap race: P0 taps most; a cheating {tap: 1000} is capped.
  await playing(h, 'tug');
  ps[1].submit({ tap: 1000 });
  for (let i = 0; i < 6; i++) { ps[0].submit({ tap: 5 }); await sleep(150); }
  ps[2].submit({ tap: 3 });
  const r1 = await until(() => h.state.phase === 'mg-result' && h.state, 'tug result');
  const rows1 = Object.fromEntries(r1.gameState.result.rows.map((r) => [r.nickname, r]));
  assert.ok(rows1.P1.value <= 25, `tap cap: P1 had ${rows1.P1.value}`);
  assert.strictEqual(rows1.P0.gained, 300);
  // 2. Quick draw: P0 jumps the gun (splash), P2 is fastest.
  await playing(h, 'quickdraw', 'wait');
  ps[0].submit({ tap: 1 });
  await playing(h, 'quickdraw', 'go');
  ps[2].submit({ tap: 1 });
  await sleep(60);
  ps[1].submit({ tap: 1 });
  const r2 = await until(() => h.state.phase === 'mg-result' && h.state.gameState.mini === 'quickdraw' && h.state, 'qd result');
  const rows2 = Object.fromEntries(r2.gameState.result.rows.map((r) => [r.nickname, r]));
  assert.strictEqual(rows2.P0.value, 'SPLASH');
  assert.strictEqual(rows2.P0.gained, 0);
  assert.strictEqual(rows2.P2.gained, 300);
  assert.strictEqual(rows2.P1.gained, 200);
  // 3. Fireflies: the exact count wins.
  const show = await playing(h, 'fireflies', 'show');
  const n = show.gameState.flies.length;
  assert.ok(n >= 12 && n <= 40);
  await playing(h, 'fireflies', 'guess');
  ps[0].submit({ number: n + 10 }); ps[1].submit({ number: n }); ps[2].submit({ number: n - 3 });
  const r3 = await until(() => h.state.phase === 'mg-result' && h.state.gameState.mini === 'fireflies' && h.state, 'fly result');
  assert.strictEqual(r3.gameState.result.answer, n);
  assert.strictEqual(r3.gameState.result.rows.find((r) => r.nickname === 'P1').gained, 300 * 2, 'round 3 of 4 is ×2');
  // 4. Roast: closest to 3.0 s without burning (>3.6 s) wins; final round ×3.
  await playing(h, 'roast');
  ps[0].submit({ hold: 3900 }); ps[1].submit({ hold: 2500 }); ps[2].submit({ hold: 3100 });
  const r4 = await until(() => h.state.phase === 'mg-result' && h.state.gameState.mini === 'roast' && h.state, 'roast result');
  const rows4 = Object.fromEntries(r4.gameState.result.rows.map((r) => [r.nickname, r]));
  assert.strictEqual(rows4.P0.burnt, true);
  assert.strictEqual(rows4.P0.gained, 0);
  assert.strictEqual(rows4.P2.gained, 900);
  await h.phase('gameover');
  assert.ok(score('P2') > 0);
});

test('team tug of war: the team that pulls the flag over the line wins (+200 each)', async () => {
  const { h, ps } = await room(4, { teams: true });
  h.emit('host:startGame', { gameId: 'minigames' });
  const st = await playing(h, 'tug');
  const team = (p) => st.players.find((x) => x.id === p.id).team;
  const reds = ps.filter((p) => team(p) === 'red');
  for (let i = 0; i < 12; i++) { for (const p of reds) p.submit({ tap: 8 }); await sleep(110); }
  const r = await until(() => h.state.phase === 'mg-result' && h.state, 'result');
  assert.strictEqual(r.gameState.result.winnerTeam, 'red');
  for (const p of ps) {
    const row = r.gameState.result.rows.find((x) => x.nickname === p.nickname);
    assert.strictEqual(row.gained, team(p) === 'red' ? 200 : 0);
  }
  assert.ok(r.teamScores.red === 400 && r.teamScores.blue === 0);
});
