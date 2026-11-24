'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, until, sleep, makeHost, makePlayer, makeRoom } = require('../helpers');

let srv;
before(async () => {
  srv = await startServer({
    RUMPUS_MG_ORDER: 'tug,quickdraw,fireflies,roast', RUMPUS_MG_INTRO_MS: '100', RUMPUS_MG_RESULT_MS: '200',
    RUMPUS_MG_TUG_MS: '3000', RUMPUS_MG_DRAW_MIN: '300', RUMPUS_MG_DRAW_MAX: '400', RUMPUS_MG_DRAW_WINDOW: '1500',
    RUMPUS_MG_FLY_SHOW_MS: '200', RUMPUS_MG_FLY_GUESS_MS: '1500', RUMPUS_MG_ROAST_MS: '9000',
  });
});
after(() => srv.stop());

const room = (n, settings = {}) => makeRoom(srv, n, { rounds: 4, ...settings });
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
  // The wait's clock runs to the random moment of GO: showing it would tell everyone when to tap.
  assert.strictEqual(h.state.gameState.endsAt, null, 'TV: no countdown to GO');
  await until(() => ps.every((p) => p.state.phase === 'mg-play' && p.state.gameState.sub === 'wait'), 'phones waiting');
  for (const p of ps) assert.strictEqual(p.state.gameState.endsAt, null, 'phone: no countdown to GO');
  ps[0].submit({ tap: 1 });
  await playing(h, 'quickdraw', 'go');
  assert.ok(h.state.gameState.endsAt > 0, 'after GO the draw window has its clock again');
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
  assert.ok(n >= 18 && n <= 64, `${n} fireflies`);
  assert.ok(show.gameState.flies.every((f) => [0, 1, 2].includes(f.s) && [0, 1, 2].includes(f.b) && f.x >= 2 && f.x <= 97 && f.y >= 3 && f.y <= 94), 'sizes, glows and spots in bounds');
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
  ps[2].submit({ hold: target }); // a "perfect" hold reported at once, before it could have happened → ignored
  await until(() => Date.now() - roast.gameState.playStart >= target * 1.3 + 50, 'long enough to have held', 9000);
  ps[0].submit({ hold: Math.round(target * 1.3) }); ps[1].submit({ hold: target - 500 }); ps[2].submit({ hold: target + 100 });
  const r4 = await until(() => h.state.phase === 'mg-result' && h.state.gameState.mini === 'roast' && h.state, 'roast result');
  const rows4 = Object.fromEntries(r4.gameState.result.rows.map((r) => [r.nickname, r]));
  assert.strictEqual(rows4.P0.burnt, true);
  assert.strictEqual(rows4.P0.gained, 0);
  assert.strictEqual(rows4.P2.gained, 900);
  assert.strictEqual(rows4.P2.value, target + 100, 'the instant perfect hold did not count');
  await h.phase('gameover');
  assert.ok(score('P2') > 0);
});

test('team tug of war: the team that pulls the flag over the line wins (+200 each)', async () => {
  const { h, ps } = await room(4, { teams: true });
  h.emit('host:startGame', { gameId: 'minigames' });
  const st = await playing(h, 'tug');
  const team = (p) => st.players.find((x) => x.id === p.id).team;
  const reds = ps.filter((p) => team(p) === 'red');
  // Pull until the flag crosses (and not a tap after: the next mini would read them as early taps).
  /** @type {any} */
  let r = null;
  const watch = until(() => (h.state.phase === 'mg-result' && h.state.gameState.mini === 'tug' ? (r = h.state) : null), 'result');
  for (let i = 0; i < 12 && !r; i++) { for (const p of reds) p.submit({ tap: 8 }); await sleep(110); }
  r = await watch;
  assert.strictEqual(r.gameState.result.winnerTeam, 'red');
  for (const p of ps) {
    const row = r.gameState.result.rows.find((x) => x.nickname === p.nickname);
    assert.strictEqual(row.gained, team(p) === 'red' ? 200 : 0);
  }
  assert.ok(r.teamScores.red === 400 && r.teamScores.blue === 0);
});

test('tap race: a fast tapper (20/s) keeps every tap, and a batch landing just after the clock still counts', async () => {
  const { h, ps } = await room(3);
  h.emit('host:startGame', { gameId: 'minigames' });
  const st = await playing(h, 'tug');
  const endsAt = st.gameState.endsAt;
  let sent = 0;
  // 2 taps every 100 ms ≈ 20/s (fast, but human): the old 15/s cap shaved this player's score.
  while (Date.now() < endsAt - 300) { ps[0].submit({ tap: 2 }); sent += 2; await sleep(100); }
  ps[1].submit({ tap: 3 });
  // A batch that was on its way when the clock ran out.
  while (Date.now() < endsAt + 60) await sleep(10);
  ps[0].submit({ tap: 2 }); sent += 2;
  const r = await until(() => (h.state.phase === 'mg-result' && h.state.gameState.mini === 'tug' ? h.state : null), 'tug result');
  const row = (n) => r.gameState.result.rows.find((x) => x.nickname === n);
  assert.strictEqual(row('P0').value, sent, `every tap counted (${row('P0').value} of ${sent})`);
  assert.strictEqual(row('P0').gained, 300, 'the top tapper wins the round');
  assert.strictEqual(row('P1').gained, 200);
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
    ps[1].submit({ sides: 'LR'.repeat(250) });
    for (let k = 0; k < 4; k++) { ps[2].submit({ sides: 'LRLR' }); await sleep(200); }
    ps[0].submit({ sides: 'LLLLLLLL' }); // one side only: one stroke, not eight
    const r5 = await result('paddle');
    assert.ok(row(r5, 'Q1').value <= 25, 'stroke cap');
    assert.strictEqual(row(r5, 'Q0').value, 1, 'the same side over and over is one stroke');
    // Campfire Sequence: the TV shows it, then the right order wins.
    const show = await until(() => h.state.phase === 'mg-play' && h.state.gameState.mini === 'simon' && h.state.gameState.seq && h.state, 'sequence shown');
    const seq = show.gameState.seq;
    assert.strictEqual(seq.length, 4);
    await play('simon', 'go');
    ps[0].submit({ seq: seq.map((c) => (c + 1) % 4) });
    ps[2].submit({ seq });
    const r6 = await result('simon');
    assert.strictEqual(row(r6, 'Q2').gained > 0, true);
    assert.strictEqual(row(r6, 'Q0').value, 'WRONG');
    const stk = await play('stack');
    ps[1].submit({ stack: 30 }); // at once: more logs than could have slid over → ignored
    await until(() => Date.now() - stk.gameState.playStart >= 3200, 'time for 12 logs', 5000);
    ps[0].submit({ stack: 99 }); ps[0].submit({ stack: 12 }); ps[1].submit({ stack: 7 }); ps[2].submit({ stack: 3 });
    const r7 = await result('stack');
    assert.strictEqual(row(r7, 'Q0').value, 12);
    await h.phase('gameover');
  } finally { await srv2.stop(); }
});

test('aim minis: Track the Ball, Angle Match, Split the Rope — closest wins, answers stay hidden, bounds', async () => {
  const srv3 = await startServer({ RUMPUS_MG_ORDER: 'track,angle,split', RUMPUS_MG_INTRO_MS: '100', RUMPUS_MG_RESULT_MS: '200', RUMPUS_MG_PLAY_MS: '6000', RUMPUS_MG_TRACK_GUESS_MS: '4000' });
  try {
    const h = await makeHost(srv3);
    const ps = [];
    for (let i = 0; i < 3; i++) ps.push(await makePlayer(srv3, h.code, 'A' + i));
    await until(() => h.state.players.length === 3, 'joined');
    h.emit('host:settings', { rounds: 3 });
    await until(() => h.state.settings.rounds === 3, 'rounds');
    h.emit('host:startGame', { gameId: 'minigames' });
    const row = (st, n) => st.gameState.result.rows.find((r) => r.nickname === n);
    const result = (mini) => until(() => h.state.phase === 'mg-result' && h.state.gameState.mini === mini && h.state, `${mini} result`);
    const play = (mini, sub) => until(() => h.state.phase === 'mg-play' && h.state.gameState.mini === mini && (!sub || h.state.gameState.sub === sub) && ps.every((p) => p.state.phase === 'mg-play') && h.state, mini);
    // Track the Ball: the TV shows only part of the climb (before the top of the arc) and the fog;
    // nobody is told where it lands until the result.
    const tr = await play('track', 'show');
    const { pts, fog } = tr.gameState.track;
    assert.ok(pts.length > 2 && fog === pts[pts.length - 1][0], 'the fog starts where the ball vanishes');
    assert.ok(pts.every((p, i) => i === 0 || p[1] >= pts[i - 1][1]), 'it vanishes while still climbing');
    assert.strictEqual(tr.gameState.track.land, undefined, 'the TV is not sent the landing spot');
    assert.strictEqual(tr.gameState.land, undefined);
    assert.strictEqual(JSON.stringify(ps[0].state.gameState).includes('pts'), false, 'phones watch the TV');
    ps[0].submit({ track: 140 }); // off the field: refused
    await play('track', 'guess');
    ps[0].submit({ track: 50 }); ps[0].submit({ track: 10 }); // the second one is ignored (locked in)
    ps[1].submit({ track: 99.9 });
    ps[2].submit({ track: 0 });
    const r1 = await result('track');
    const land = r1.gameState.result.answer;
    assert.ok(land >= 38 && land <= 96, `landed at ${land}`);
    assert.strictEqual(row(r1, 'A0').value, 50);
    const best = ['A0', 'A1', 'A2'].map((n) => [n, Math.abs(row(r1, n).value - land)]).sort((a, b) => a[1] - b[1])[0][0];
    assert.strictEqual(row(r1, best).gained, 300, 'the closest guess wins');
    assert.ok(r1.gameState.result.track.pts.length > pts.length - 1 && r1.gameState.result.guesses.length === 3, 'the result shows the whole flight and every flag');
    // Angle Match: the angle between the arms; anything outside 0–180° is refused.
    const an = await play('angle');
    const target = ps[0].state.gameState.target;
    assert.ok(target >= 10 && target <= 170 && Number.isInteger(ps[0].state.gameState.base));
    ps[0].submit({ angle: 200 });
    // (A1 is 20° off on the side that stays inside 0–180°: "target - 20" was refused for a target under 20.)
    ps[0].submit({ angle: target + 3 }); ps[1].submit({ angle: target > 90 ? target - 20 : target + 20 }); ps[2].submit({ angle: 'x' });
    await until(() => h.state.gameState.doneCount === 2, 'two locked in');
    ps[2].submit({ angle: target + 3 });
    const r2 = await result('angle');
    assert.strictEqual(row(r2, 'A0').gained, 300, 'ties share the better placing');
    assert.strictEqual(row(r2, 'A2').gained, 300);
    assert.strictEqual(row(r2, 'A1').gained, 100);
    assert.strictEqual(an.gameState.target, target, 'the TV shows the angle to make');
    // Split the Rope: 1–1000; the final round is ×3.
    await play('split');
    const cut = ps[0].state.gameState.target;
    assert.ok(cut >= 1 && cut <= 1000 && typeof ps[0].state.gameState.flip === 'boolean');
    ps[0].submit({ split: 0 }); ps[0].submit({ split: 1001 });
    ps[0].submit({ split: cut }); ps[1].submit({ split: cut > 500 ? 1 : 1000 });
    const r3 = await result('split');
    assert.strictEqual(row(r3, 'A0').value, cut);
    assert.strictEqual(row(r3, 'A0').gained, 900);
    assert.strictEqual(row(r3, 'A2').value, '—', 'no cut: no score');
    await h.phase('gameover');
  } finally { await srv3.stop(); }
});

test('Angle Match maths: the angle between two arms is 0–180° whichever way round', () => {
  const M = require('../../games/minigames');
  assert.strictEqual(M.between(10, 50), 40);
  assert.strictEqual(M.between(350, 20), 30);
  assert.strictEqual(M.between(0, 270), 90);
  assert.strictEqual(M.between(90, -90), 180);
});
