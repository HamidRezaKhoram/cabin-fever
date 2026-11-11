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
    for (const gameId of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) h.emit('host:startGame', { gameId }); // not games
    h.emit('host:kickPlayer', 'nobody');
    h.emit('host:startNight', 'x');
    await sleep(200);
    assert.strictEqual((await get(srv.url, '/api/info')).status, 200, 'server still up');
    assert.strictEqual(h.state.players.length, 3);
    assert.doesNotMatch(srv.log(), /socket\] host:startGame failed/, 'and nothing threw');
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

test('a server restart keeps the room: same code, same seats and scores; the game in progress is reported as cut short', { timeout: 60000 }, async () => {
  const dir = require('../helpers').tmpDir();
  let srv = await startServer({ RUMPUS_DATA_DIR: dir });
  /** @type {any} */ let h; /** @type {any[]} */ const ps = [];
  try {
    h = await makeHost(srv);
    for (const n of ['Ann', 'Bob', 'Cy']) ps.push(await makePlayer(srv, h.code, n, { device: `device-of-${n}` }));
    h.emit('host:settings', { timerScale: 2 });
    h.emit('host:startGame', { gameId: 'quiplash' });
    await h.phase('answering');
    await sleep(700); // the room is saved a moment after it changes
  } finally { srv.proc.kill('SIGKILL'); await sleep(200); } // a crash: no goodbye, no final save
  srv = await startServer({ RUMPUS_DATA_DIR: dir });
  try {
    // The TV comes back with its saved code + key and gets the same room.
    const tv = srv.connect();
    /** @type {any[]} */ const events = [];
    /** @type {any} */ let state = null;
    tv.on('room:event', (e) => events.push(e));
    tv.on('room:stateUpdate', (s) => { state = s; });
    await new Promise((r) => tv.once('connect', r));
    tv.emit('host:resume', { code: h.code, hostToken: h.hostToken });
    await until(() => state && state.code === h.code, 'the TV has its room back');
    assert.strictEqual(state.phase, 'lobby', 'the game itself is gone');
    assert.deepStrictEqual(state.players.map((/** @type {any} */ p) => p.nickname).sort(), ['Ann', 'Bob', 'Cy']);
    assert.ok(state.players.every((/** @type {any} */ p) => !p.connected), 'everyone shows as away until their phone is back');
    assert.strictEqual(state.settings.timerScale, 2, 'settings kept');
    await until(() => events.some((e) => e.type === 'interrupted'), 'the TV is told what was cut short');
    assert.match(events.find((e) => e.type === 'interrupted').game, /Quips/);
    // A phone reconnects with its old token and is the same player; another only has its device id.
    const a = srv.connect();
    await new Promise((r) => a.once('connect', r));
    a.emit('player:rejoin', { code: h.code, token: ps[0].token });
    const back = await new Promise((r) => a.once('player:joined', r));
    assert.strictEqual(back.playerId, ps[0].id);
    const b = srv.connect();
    await new Promise((r) => b.once('connect', r));
    b.emit('player:joinRoom', { code: h.code, nickname: 'whatever', device: 'device-of-Bob' });
    assert.strictEqual((await new Promise((r) => b.once('player:joined', r))).playerId, ps[1].id);
    await until(() => state.players.filter((/** @type {any} */ p) => p.connected).length === 2, 'two phones back');
  } finally { await srv.stop(); }
});

test('"That\'s me": a name that is in use and online can be taken over on request (the other screen is told)', { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    const ann = await makePlayer(srv, h.code, 'Ann');
    assert.strictEqual(await require('../helpers').joinError(srv, h.code, 'ann'), 'That nickname is taken.');
    const s = srv.connect();
    await new Promise((r) => s.once('connect', r));
    const replaced = new Promise((r) => ann.sock.once('player:replaced', r));
    s.emit('player:joinRoom', { code: h.code, nickname: 'ANN', takeover: true });
    const joined = await new Promise((r) => s.once('player:joined', r));
    assert.strictEqual(joined.playerId, ann.id, 'same seat');
    await replaced;
    await until(() => h.state.players.length === 1 && h.state.players[0].connected, 'still one Ann, connected');
  } finally { await srv.stop(); }
});

test('a game error reaches the TV as a glitch banner (once, not a flood) and Skip still works', { timeout: 30000 }, async () => {
  const srv = await startServer({ RUMPUS_DEBUG: '1' });
  try {
    const h = await makeHost(srv);
    for (const n of ['Ann', 'Bob', 'Cy']) await makePlayer(srv, h.code, n);
    /** @type {any[]} */ const events = [];
    h.sock.on('room:event', (/** @type {any} */ e) => events.push(e));
    h.emit('host:startGame', { gameId: 'quiplash' });
    await h.phase('answering', 5000);
    assert.strictEqual((await get(srv.url, `/api/debug/glitch?room=${h.code}`)).status, 200);
    await until(() => events.some((e) => e.type === 'glitch'), 'the TV is told something went wrong');
    // A second error right after (a real-time tick can throw 30 times a second) is not repeated.
    await get(srv.url, `/api/debug/glitch?room=${h.code}`);
    await sleep(200);
    assert.strictEqual(events.filter((e) => e.type === 'glitch').length, 1, 'one banner, not a flood');
    assert.strictEqual((await get(srv.url, '/api/info')).status, 200, 'server still up');
    // The broken timer stays pending, so the banner's advice works: Skip is there and tries again.
    await until(() => h.state.canSkip === true, 'Skip is still offered after the error');
    assert.ok(h.state.pace.allowed.length > 0, 'the phones still have a vote');
    h.emit('host:skip'); // throws again (same broken timer) — caught, never fatal
    await sleep(100);
    assert.strictEqual((await get(srv.url, '/api/info')).status, 200, 'server still up after Skip');
    // And End takes the room back to the menu.
    h.emit('host:endGame');
    await h.phase('lobby', 5000);
  } finally { await srv.stop(); }
});

test('guarded timer work tells its game, and a broken hook never throws', () => {
  const { guarded } = require('../../games/base');
  /** @type {string[]} */ const seen = [];
  const err = console.error; console.error = () => {};
  try {
    guarded(() => { throw new Error('x'); }, 'tick', { onGlitch: (w) => seen.push(w) });
    guarded(() => { throw new Error('x'); }, 'tick', { onGlitch: () => { throw new Error('hook'); } });
    guarded(() => { throw new Error('x'); }, 'tick');
    guarded(() => seen.push('ran'), 'ok', { onGlitch: () => seen.push('wrong') });
  } finally { console.error = err; }
  assert.deepStrictEqual(seen, ['tick', 'ran']);
});

test('a room in use but unchanged for longer than the keep window still survives a restart (its save is re-stamped)', { timeout: 30000 }, async () => {
  const dir = require('../helpers').tmpDir();
  const env = { RUMPUS_DATA_DIR: dir, RUMPUS_ROOM_KEEP_MS: '1500', RUMPUS_ROOM_KEEPALIVE_MS: '300' };
  let srv = await startServer(env);
  /** @type {any} */ let h;
  try {
    h = await makeHost(srv);
    await makePlayer(srv, h.code, 'Ann');
    await sleep(2500); // nothing changes for longer than the keep window, but the TV is connected
  } finally { srv.proc.kill('SIGKILL'); await sleep(200); } // a crash: no final save
  srv = await startServer(env);
  try {
    const tv = srv.connect();
    /** @type {any} */ let state = null;
    tv.on('room:stateUpdate', (s) => { state = s; });
    await new Promise((r) => tv.once('connect', r));
    tv.emit('host:resume', { code: h.code, hostToken: h.hostToken });
    await until(() => state && state.code === h.code, 'the same room came back');
    assert.deepStrictEqual(state.players.map((/** @type {any} */ p) => p.nickname), ['Ann']);
  } finally { await srv.stop(); }
});

test('a server restart mid-game picks a resumable game (Closest Cast) up at the same question, scores kept', { timeout: 60000 }, async () => {
  const dir = require('../helpers').tmpDir();
  let srv = await startServer({ RUMPUS_DATA_DIR: dir, RUMPUS_CG_GUESS_MS: '30000' });
  /** @type {any} */ let h; /** @type {any[]} */ const ps = [];
  let question = '';
  try {
    h = await makeHost(srv);
    for (const n of ['Ann', 'Bob']) ps.push(await makePlayer(srv, h.code, n, { device: `device-of-${n}` }));
    h.emit('host:startGame', { gameId: 'closest' });
    const st = await h.phase('cg-guess');
    question = st.gameState.question;
    await sleep(700); // saved a moment after it changes
  } finally { srv.proc.kill('SIGKILL'); await sleep(200); }
  srv = await startServer({ RUMPUS_DATA_DIR: dir, RUMPUS_CG_GUESS_MS: '30000' });
  try {
    const tv = srv.connect();
    /** @type {any[]} */ const events = [];
    /** @type {any} */ let state = null;
    tv.on('room:event', (e) => events.push(e));
    tv.on('room:stateUpdate', (s) => { state = s; });
    await new Promise((r) => tv.once('connect', r));
    tv.emit('host:resume', { code: h.code, hostToken: h.hostToken });
    await until(() => state && state.phase === 'cg-guess', 'the game is back on');
    assert.strictEqual(state.gameState.question, question, 'the same question');
    assert.ok(events.some((e) => e.type === 'resumed' && /Closest/.test(e.game)), 'the TV is told it picked up');
    assert.ok(!events.some((e) => e.type === 'interrupted'), 'not reported as cut short');
    // A phone comes back with its token and can answer.
    const a = srv.connect();
    /** @type {any} */ let ast = null;
    a.on('room:stateUpdate', (s) => { ast = s; });
    await new Promise((r) => a.once('connect', r));
    a.emit('player:rejoin', { code: h.code, token: ps[0].token });
    await until(() => ast && ast.phase === 'cg-guess', 'the phone sees the question');
    a.emit('player:submit', { payload: { number: 42 } });
    await until(() => state.gameState.submittedCount === 1, 'the answer counts');
  } finally { await srv.stop(); }
});
