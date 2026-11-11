'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, until, sleep, makeHost, makePlayer } = require('../helpers');

let srv;
before(async () => {
  srv = await startServer({
    RUMPUS_MG_ORDER: 'tug,quickdraw,fireflies,roast', RUMPUS_MG_INTRO_MS: '100', RUMPUS_MG_RESULT_MS: '200',
    RUMPUS_MG_TUG_MS: '3000', RUMPUS_MG_DRAW_MIN: '300', RUMPUS_MG_DRAW_MAX: '400', RUMPUS_MG_DRAW_WINDOW: '1500',
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
  assert.deepStrictEqual((await h.phase('mg-intro')).pace.allowed, ['ready'], 'the room can vote past the intro');
  // 1. Tap race: P0 taps most; a cheating {tap: 1000} is capped.
  await playing(h, 'tug');
  assert.deepStrictEqual(h.state.pace.allowed, ['wrap'], 'real-time play: the room can vote to end the round');
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
  ps[1].submit({ number: n }); // locking in while the fireflies are still showing is allowed
  await until(() => h.state.gameState.doneCount === 1, 'early guess counted');
  await playing(h, 'fireflies', 'guess');
  ps[0].submit({ number: n + 10 }); ps[1].submit({ number: 1 }) /* second guess ignored */; ps[2].submit({ number: n - 3 });
  const r3 = await until(() => h.state.phase === 'mg-result' && h.state.gameState.mini === 'fireflies' && h.state, 'fly result');
  assert.strictEqual(r3.gameState.result.answer, n);
  assert.strictEqual(r3.gameState.result.rows.find((r) => r.nickname === 'P1').gained, 300 * 2, 'round 3 of 4 is ×2');
  // 4. Roast: closest to the (random, 2–6 s) target without burning (> target +20%) wins; no clock shown; final round ×3.
  const roast = await playing(h, 'roast');
  const target = roast.gameState.target;
  assert.ok(target >= 2000 && target <= 6000 && target % 100 === 0, `target ${target}`);
  assert.strictEqual(roast.gameState.endsAt, null, 'no countdown while roasting');
  ps[0].submit({ hold: Math.round(target * 1.3) }); ps[1].submit({ hold: target - 500 }); ps[2].submit({ hold: target + 100 });
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

test('the seven new minis: skip stones, loon spotting, swat, balance, canoe sprint, campfire sequence, woodpile', async () => {
  const srv2 = await startServer({ RUMPUS_MG_ORDER: 'skip,spot,swat,balance,paddle,simon,stack', RUMPUS_MG_INTRO_MS: '100', RUMPUS_MG_RESULT_MS: '200', RUMPUS_MG_PLAY_MS: '7000', RUMPUS_MG_SHOW_MS: '50' });
  try {
    const h = await makeHost(srv2);
    const ps = [];
    for (let i = 0; i < 3; i++) ps.push(await makePlayer(srv2, h.code, 'Q' + i));
    await until(() => h.state.players.length === 3, 'joined');
    h.emit('host:settings', { rounds: 7 });
    await until(() => h.state.settings.rounds === 7, 'rounds');
    h.emit('host:startGame', { gameId: 'minigames' });
    const row = (st, n) => st.gameState.result.rows.find((r) => r.nickname === n);
    const result = (mini) => until(() => h.state.phase === 'mg-result' && h.state.gameState.mini === mini && h.state, `${mini} result`);
    const play = (mini, sub) => until(() => h.state.phase === 'mg-play' && h.state.gameState.mini === mini && (!sub || h.state.gameState.sub === sub) && ps.every((p) => p.state.phase === 'mg-play') && h.state, mini);
    // Skip Stones: the server reads the arrow at the throw time; dead-centre throws score 8.
    const sk = await play('skip');
    const { period, sweet, playStart } = ps[0].state.gameState;
    const M = require('../../games/minigames');
    // A time when the arrow is exactly on the sweet spot (rising half of the swing).
    const perfect = playStart + Math.round(sweet * period / 2) + period * Math.ceil((Date.now() - playStart) / period);
    for (let k = 0; k < 3; k++) {
      await until(() => Date.now() >= perfect + k * period, 'arrow on the spot', 4000);
      ps[0].submit({ throw: perfect + k * period });
    }
    ps[1].submit({ throw: playStart + Math.round(((sweet + 0.5) % 1) * period / 2) }); // far from the green
    assert.ok(sk.gameState.board, 'TV shows the skips board');
    assert.strictEqual(M.skipsFor(M.swing(Math.round(sweet * period / 2), period), sweet), 8);
    const r1 = await result('skip');
    assert.strictEqual(row(r1, 'Q0').value, 24, 'three perfect throws');
    assert.strictEqual(row(r1, 'Q0').gained, 300);
    // Loon Spotting: the TV knows where the loon is, phones don't; a wrong bird is out.
    const sp = await play('spot');
    const loon = sp.gameState.loon;
    assert.strictEqual(ps[0].state.gameState.loon, undefined, 'phones must look at the TV');
    ps[2].submit({ cell: (loon + 1) % 12 });
    ps[1].submit({ cell: loon });
    const r2 = await result('spot');
    assert.strictEqual(row(r2, 'Q1').gained, 300);
    assert.strictEqual(row(r2, 'Q2').value, 'WRONG BIRD');
    // Mosquito Swat: only bugs that are there right now count.
    await play('swat');
    const bugs = ps[0].state.gameState.bugs;
    assert.ok(bugs.length >= 14 && bugs.length <= 20);
    ps[0].submit({ swat: bugs.length - 1 }); // not landed yet → ignored
    const first = bugs[0];
    await until(() => Date.now() - ps[0].state.gameState.playStart >= first.at + 50, 'first bug landed', 4000);
    ps[0].submit({ swat: 0 }); ps[0].submit({ swat: 0 }); // twice → counts once
    const r3 = await result('swat');
    assert.strictEqual(row(r3, 'Q0').value, 1);
    // Dock Balance / Woodpile: phones report; out-of-range values are ignored.
    await play('balance');
    ps[0].submit({ balance: 150 }); ps[0].submit({ balance: 80 }); ps[1].submit({ balance: 40 }); ps[2].submit({ balance: 0 });
    const r4 = await result('balance');
    assert.ok(row(r4, 'Q0').gained >= 300 && row(r4, 'Q0').gained > row(r4, 'Q1').gained, 'most time inside wins');
    assert.strictEqual(row(r4, 'Q0').value, 80, 'out-of-range report ignored');
    // Canoe Sprint: rate-capped strokes.
    await play('paddle');
    ps[1].submit({ strokes: 500 });
    for (let k = 0; k < 4; k++) { ps[2].submit({ strokes: 4 }); await sleep(200); }
    const r5 = await result('paddle');
    assert.ok(row(r5, 'Q1').value <= 25, 'stroke cap');
    // Campfire Sequence: the TV shows it, then the right order wins.
    const show = await until(() => h.state.phase === 'mg-play' && h.state.gameState.mini === 'simon' && h.state.gameState.seq && h.state, 'sequence shown');
    const seq = show.gameState.seq;
    assert.ok(seq.length >= 5 && seq.length <= 7);
    await play('simon', 'go');
    ps[0].submit({ seq: seq.map((c) => (c + 1) % 4) });
    ps[2].submit({ seq });
    const r6 = await result('simon');
    assert.strictEqual(row(r6, 'Q2').gained > 0, true);
    assert.strictEqual(row(r6, 'Q0').value, 'WRONG');
    await play('stack');
    ps[0].submit({ stack: 99 }); ps[0].submit({ stack: 12 }); ps[1].submit({ stack: 7 }); ps[2].submit({ stack: 3 });
    const r7 = await result('stack');
    assert.strictEqual(row(r7, 'Q0').value, 12);
    await h.phase('gameover');
  } finally { await srv2.stop(); }
});
