// Robustness: bad input and odd situations must never crash the server, leak, or index out of
// bounds. Each test here reproduces a bug found in the Nov 2026 audit.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer, get, sleep } = require('../helpers');
const { makeRng } = require('../../games/rng');
const { Sock, heartbeat } = require('../../web/net');

test('nicknames like "constructor" and "__proto__" play a full game; the stats stay sane', { timeout: 60000 }, async () => {
  const srv = await startServer({ RUMPUS_TRIVIA_ROUNDS: '2', RUMPUS_TRIVIA_QUESTION_MS: '800', RUMPUS_TRIVIA_REVEAL_MS: '100' });
  try {
    const h = await makeHost(srv);
    const names = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];
    const ps = [];
    for (const n of names) ps.push(await makePlayer(srv, h.code, n));
    for (const p of ps) p.sock.on('room:stateUpdate', (s) => { if (s.phase === 'trivia-question' && !s.you.answered) p.submit({ choice: 0 }); if (s.phase === 'trivia-category' && s.you.isChooser) p.submit({ choice: 0 }); });
    h.emit('host:startGame', { gameId: 'trivia' });
    await h.phase('gameover', 30000);
    await sleep(100);
    const r = await get(srv.url, '/api/highlights');
    assert.strictEqual(r.status, 200, 'server still answers');
    const players = JSON.parse(r.body).players.map((/** @type {{ name: string }} */ x) => x.name).sort();
    assert.deepStrictEqual(players, [...names].sort(), 'each odd name is just a player');
  } finally { await srv.stop(); }
});

test('malformed host and player messages are ignored, not fatal', { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    const a = await makePlayer(srv, h.code, 'Ann');
    await makePlayer(srv, h.code, 'Bob');
    await makePlayer(srv, h.code, 'Cy');
    // Strings and numbers where objects belong (`'rounds' in "x"` used to throw).
    for (const bad of ['x', 5, true, null, [], { rounds: 'lots' }]) h.emit('host:settings', bad);
    for (const ev of ['player:submit', 'player:vote', 'player:look', 'player:avatar', 'player:react', 'player:team']) for (const bad of ['x', 5, null, [], { payload: 'x' }]) a.sock.emit(ev, bad);
    h.emit('host:startGame', 'quiplash');
    h.emit('host:kickPlayer', 'nobody');
    h.emit('host:startNight', 'x');
    await sleep(200);
    assert.strictEqual((await get(srv.url, '/api/info')).status, 200, 'server still up');
    assert.strictEqual(h.state.players.length, 3);
  } finally { await srv.stop(); }
});

test('Campfire Quips: a side bet must be a real one ("toString" is not a bet)', { timeout: 30000 }, async () => {
  const srv = await startServer({ RUMPUS_DEBUG: '1' });
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (const n of ['Ann', 'Bob', 'Cy']) ps.push(await makePlayer(srv, h.code, n));
    h.emit('host:startGame', { gameId: 'quiplash' });
    await h.phase('answering', 5000);
    for (let k = 0; k < 2; k++) for (const p of ps) { p.submit({ text: `answer ${k}` }); await sleep(40); }
    await h.phase('voting', 5000);
    for (const p of ps) for (const bet of ['toString', 'constructor', '__proto__', 'valueOf']) p.submit({ bet });
    await sleep(150);
    const views = JSON.parse((await get(srv.url, `/api/debug/views?room=${h.code}`)).body);
    for (const v of views.players) assert.ok(!v.you.bet || ['win', 'landslide'].includes(v.you.bet), `bet ${v.you.bet}`);
  } finally { await srv.stop(); }
});

test('kicking everyone mid-game ends the game (no game runs on an empty room)', { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (const n of ['Ann', 'Bob', 'Cy']) ps.push(await makePlayer(srv, h.code, n));
    h.emit('host:startGame', { gameId: 'quiplash' });
    await until(() => h.state.phase !== 'lobby', 'game started');
    for (const p of ps) h.emit('host:kickPlayer', { playerId: p.id });
    await until(() => h.state.players.length === 0 && h.state.phase === 'lobby', 'back to the lobby', 5000);
  } finally { await srv.stop(); }
});

test('rng.int never leaves its bounds, even when they cross', () => {
  const rng = makeRng(42);
  for (let i = 0; i < 2000; i++) {
    const v = rng.int(3, 9);
    assert.ok(v >= 3 && v <= 9 && Number.isInteger(v));
  }
  assert.strictEqual(rng.int(5, 3), 5);
  assert.strictEqual(rng.int(4, 4), 4);
  assert.strictEqual(rng.pick([]), undefined);
});

test('browser-build socket: offline messages are capped, volatile ones dropped, timed-out acks forgotten', async () => {
  const s = new Sock('t');
  for (let i = 0; i < 500; i++) s.emit('player:submit', { i }, () => {});
  assert.ok(s.queue.length <= 64, `queue ${s.queue.length}`);
  assert.ok(s.acks.size <= 64, `acks ${s.acks.size} (dropped messages take their acks along)`);
  s.volatile.emit('k');
  assert.ok(!s.queue.some((m) => m.t === 'e' && m.ev === 'k'), 'volatile message not queued while offline');
  const t = new Sock('t2');
  let err = null;
  t.timeout(20).emit('debug:ping', (/** @type {any} */ e) => { err = e; });
  await sleep(60);
  assert.ok(err, 'timed out');
  assert.strictEqual(t.acks.size, 0, 'the lost reply is forgotten');
});

test('browser-build socket: volatile messages take the fast channel when the link has one', () => {
  /** @type {any[]} */ const slow = [];
  /** @type {any[]} */ const fast = [];
  const raw = { send: (/** @type {any} */ m) => slow.push(m), sendFast: (/** @type {any} */ m) => fast.push(m), onMessage() {}, onClose() {}, close() {} };
  const wire = heartbeat(raw);
  const s = new Sock('t');
  s.attach(wire);
  s.volatile.emit('player:submit', { payload: { tilt: [1, 0], n: 1 } }, () => {});
  s.emit('player:submit', { payload: { choice: 0 } }, () => {});
  wire.close();
  assert.deepStrictEqual(fast.map((m) => m.args[0].payload), [{ tilt: [1, 0], n: 1 }], 'tilt went on the fast channel');
  assert.strictEqual(fast[0].ack, undefined, 'no ack is waited for');
  assert.deepStrictEqual(slow.filter((m) => m.t === 'e').map((m) => m.args[0].payload), [{ choice: 0 }], 'the answer stayed on the reliable channel');
  // A link without a fast channel (local tabs, an old browser): volatile uses the normal one.
  /** @type {any[]} */ const only = [];
  const plain = heartbeat({ send: (/** @type {any} */ m) => only.push(m), onMessage() {}, onClose() {}, close() {} });
  const p = new Sock('p');
  p.attach(plain);
  p.volatile.emit('k');
  plain.close();
  assert.ok(only.some((m) => m.t === 'e' && m.ev === 'k'));
});
