// Loon Call (rhythm): judging windows, anti-mash, calibration, quantising, and a real game
// over sockets where phones send timestamped taps.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer } = require('../helpers');
const LoonCall = require('../../games/looncall');

test('judging: perfect ±70 ms, good ±140, misses, extra taps cost points, clean bar bonus', () => {
  const notes = [1000, 1500, 2000];
  const perfect = LoonCall.judge(notes, [1010, 1490, 2060]);
  assert.deepStrictEqual(perfect.hits.map((h) => h.kind), ['perfect', 'perfect', 'perfect']);
  assert.strictEqual(perfect.clean, true);
  assert.strictEqual(perfect.points, 3 * 30 + 20);
  const sloppy = LoonCall.judge(notes, [1100, 1700, 2000]); // 100 ms off, 200 ms off, spot on
  assert.deepStrictEqual(sloppy.hits.map((h) => h.kind), ['good', 'miss', 'perfect']);
  assert.deepStrictEqual(sloppy.hits.map((h) => h.d), [100, 200, 0], 'early/late is kept for feedback');
  assert.strictEqual(sloppy.extras, 0);
  assert.strictEqual(sloppy.clean, false);
  assert.strictEqual(sloppy.points, 15 + 30);
  const stray = LoonCall.judge(notes, [1000, 1250, 1500, 2000]); // 1250 is 250 ms from everything
  assert.strictEqual(stray.extras, 1);
  assert.strictEqual(stray.points, 90 - 5, 'an extra tap costs 5 and the clean bonus');
});

test('judging: mashing never wins and a bar never scores below zero', () => {
  const notes = [1000, 1500];
  const mash = Array.from({ length: 20 }, (_, i) => 900 + i * 50);
  const j = LoonCall.judge(notes, mash);
  assert.ok(j.extras >= 18);
  assert.strictEqual(j.clean, false);
  assert.strictEqual(j.points, 0);
  assert.ok(LoonCall.judge(notes, [1000, 1500]).points > j.points);
  assert.strictEqual(LoonCall.judge(notes, []).points, 0);
});

test('calibration: median offset of taps near the clicks, clamped, needs 3+ taps', () => {
  const clicks = [0, 600, 1200, 1800, 2400, 3000, 3600, 4200].map((x) => x + 10000);
  assert.strictEqual(LoonCall.calibrate(clicks, clicks.map((c, i) => c + 120 + (i % 2 ? 10 : -10))), 120);
  assert.strictEqual(LoonCall.calibrate(clicks, [clicks[0] + 80, clicks[1] + 90, clicks[2] + 100, clicks[3] + 110, clicks[4] - 250]), 90, 'a wild tap is outvoted');
  assert.strictEqual(LoonCall.calibrate(clicks, [clicks[0] + 50]), 0, 'too few taps → no correction');
  assert.strictEqual(LoonCall.calibrate(clicks, clicks.map((c) => c + 250)), 250, 'a slow Bluetooth speaker (250 ms) is still measured');
});

test("quantise: a caller's taps snap to the 8th-note grid of their bar", () => {
  assert.deepStrictEqual(LoonCall.quantise([1000, 1240, 1260, 1490, 1990, 3100], 1000, 2000), [0, 1, 2, 4]);
});

test('a full game: tune-up calibrates each phone, echoes score, the trailing player writes a call', { timeout: 60000 }, async () => {
  const srv = await startServer({ RUMPUS_LC_TEMPO: '4', RUMPUS_LC_PHRASES: '2', RUMPUS_LC_CALL_REPEATS: '1', RUMPUS_LC_LEAD_MS: '300', RUMPUS_LC_RESULT_MS: '300', RUMPUS_LC_GRACE_MS: '400' });
  try {
    const h = await makeHost(srv);
    const ann = await makePlayer(srv, h.code, 'Ann');
    const ben = await makePlayer(srv, h.code, 'Ben');
    const cat = await makePlayer(srv, h.code, 'Cat');
    await until(() => h.state.players.length === 3, 'joined');
    h.emit('host:startGame', { gameId: 'looncall' });
    // Tune-up (4× tempo: beats are 150 ms, so keep offsets under half a beat): Ann's phone is 40 ms slow, Ben's is spot on, Cat doesn't tap.
    const tune = (await h.phase('lc-tune')).gameState.sched;
    assert.strictEqual(tune.clicks.length, 8);
    await until(() => Date.now() > tune.endAt, 'tune-up over', 10000);
    ann.submit({ taps: tune.clicks.map((c) => c + 40) });
    ben.submit({ taps: tune.clicks });
    const song = (await h.phase('lc-song', 5000)).gameState.sched;
    assert.strictEqual(ann.state.you.calib, 40);
    assert.strictEqual(ben.state.you.calib, 0);
    assert.strictEqual(cat.state.you.calib, 0);
    assert.strictEqual(song.phrases.length, 2);
    const notes = (p) => p.steps.map((st) => p.echoAt + (st * song.barMs) / song.steps);
    // Phrase 1: Ann echoes 40 ms "late" (her calibration makes it perfect), Ben exact, Cat mashes.
    const p0 = song.phrases[0];
    await until(() => Date.now() > p0.echoAt + song.barMs, 'echo bar 1 over', 10000);
    ann.submit({ taps: notes(p0).map((t) => t + 40) });
    ben.submit({ taps: notes(p0) });
    cat.submit({ taps: Array.from({ length: 16 }, (_, i) => p0.echoAt + i * (song.barMs / 16)) });
    await until(() => h.state.gameState.scoredPhrases === 1, 'bar 1 scored', 5000);
    const sc = (n) => h.state.players.find((p) => p.nickname === n).score;
    const full = p0.steps.length * 30 + 20;
    assert.strictEqual(sc('Ann'), full, 'calibrated → perfect');
    assert.strictEqual(sc('Ben'), full);
    assert.ok(sc('Cat') < full / 2, 'mashing scores little');
    assert.deepStrictEqual(h.state.gameState.syncs, [], 'not everyone was clean → no IN SYNC');
    // Phrase 2: everyone clean → IN SYNC +10 each.
    const p1 = song.phrases[1];
    await until(() => Date.now() > p1.echoAt + song.barMs, 'echo bar 2 over', 10000);
    const catBefore = sc('Cat');
    for (const [p, off] of [[ann, 40], [ben, 0], [cat, 0]]) p.submit({ taps: notes(p1).map((t) => t + off) });
    await until(() => h.state.gameState.scoredPhrases === 2, 'bar 2 scored', 5000);
    assert.deepStrictEqual(h.state.gameState.syncs, [1]);
    assert.strictEqual(sc('Cat') - catBefore, p1.steps.length * 30 + 20 + 10);
    const res = (await h.phase('lc-result', 5000)).gameState.result;
    assert.strictEqual(res.rows.find((r) => r.nickname === 'Ann').grade, 'Nailed it!');
    // Your Call: the trailing player (Cat) writes the call for song 2.
    const comp = await h.phase('lc-compose', 5000);
    assert.strictEqual(comp.gameState.composer, 'Cat');
    await until(() => cat.state.phase === 'lc-compose' && ann.state.phase === 'lc-compose', 'phones on the call screen');
    assert.ok(cat.state.you.isCaller && !ann.state.you.isCaller);
    const cs = comp.gameState.sched;
    await until(() => Date.now() > cs.endAt, 'call written', 10000);
    const bar = cs.startAt + cs.barMs;
    cat.submit({ taps: [0, 2, 3, 6].map((st) => bar + (st * cs.barMs) / 8 + 15) });
    const callSong = (await until(() => h.state.phase === 'lc-song' && h.state.gameState.sched.kind === 'call' && h.state, 'call song', 5000)).gameState.sched;
    assert.deepStrictEqual(callSong.phrases[0].steps, [0, 2, 3, 6], "the room echoes Cat's own rhythm");
    assert.strictEqual(callSong.caller, 'Cat');
    const cp = callSong.phrases[0];
    await until(() => Date.now() > cp.echoAt + callSong.barMs, 'call echoed', 10000);
    const catBeforeCall = sc('Cat');
    ann.submit({ taps: cp.steps.map((st) => cp.echoAt + (st * callSong.barMs) / 8 + 40) });
    ben.submit({ taps: cp.steps.map((st) => cp.echoAt + (st * callSong.barMs) / 8) });
    await until(() => h.state.gameState.scoredPhrases === 1, 'call scored', 5000);
    // Caller: 10 per echoed note, averaged over the others (both got all 4) → 40, ×2 for song 2.
    // Cat didn't echo her own call this time (she could have, for normal echo points).
    assert.strictEqual(sc('Cat') - catBeforeCall, 40 * 2);
    h.emit('host:endGame');
  } finally {
    await srv.stop();
  }
});
