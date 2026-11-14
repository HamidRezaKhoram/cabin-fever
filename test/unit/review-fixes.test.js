// Fixes from the Nov 13 code review (one check per finding): game rules played in-process against
// the real game classes (fake room, no sockets), and the room-level ones over real sockets.
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
process.env.RUMPUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-review-'));
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { startServer, until, sleep, makeHost, makePlayer, tmpDir } = require('../helpers');

/** A room with these players (ids p0, p1, …) and a game of `id` in it. */
function mk(/** @type {string} */ id, n = 4, settings = {}) {
  const Game = require(`../../games/${id}`);
  const room = /** @type {any} */ ({ code: 'TEST', settings: { rounds: 3, spicy: true, ...settings },
    players: new Map(Array.from({ length: n }, (_, i) => ['p' + i, { id: 'p' + i, nickname: 'N' + i, score: 0, connected: true }])) });
  let pushes = 0;
  /** @type {any} */ const game = new Game(room, () => { pushes++; });
  room.game = game;
  const leave = (/** @type {string} */ pid) => { room.players.delete(pid); game.onPlayerLeft(pid); };
  return { game, room, leave, pushes: () => pushes };
}
async function withGame(/** @type {string} */ id, /** @type {number} */ n, /** @type {any} */ settings, /** @type {(g: ReturnType<typeof mk>) => any} */ fn) {
  const g = mk(id, n, settings);
  try { await fn(g); } finally { g.game.destroy(); }
}

// ---------------------------------------------------------------- Closest Cast (4)
test('Closest: with 8 players a 4th-place Double Down is top half: ×2 of 0, not −200; 5th still loses', () => withGame('closest', 8, {}, ({ game, room }) => {
  game.start();
  game.q = { q: 'x', answer: 100 };
  for (const p of room.players.values()) p.score = 500;
  for (let i = 0; i < 8; i++) game.handleSubmit('p' + i, { number: 100 + i * 10, double: i === 3 || i === 4 });
  const row = (/** @type {string} */ n) => game.result.list.find((/** @type {any} */ e) => e.nickname === n);
  assert.strictEqual(row('N3').rank, 3);
  assert.strictEqual(row('N3').gained, 0, '4th of 8 is top half: no penalty');
  assert.strictEqual(room.players.get('p3').score, 500);
  assert.strictEqual(row('N4').gained, -200, '5th of 8 is outside the top half');
}));

// ---------------------------------------------------------------- Campfire Consensus (3)
test('Consensus: emoji / Cyrillic / CJK answers count and group; an empty one is turned down', () => withGame('majority', 6, {}, ({ game }) => {
  const M = require('../../games/majority');
  assert.ok(M.normalize('Кот'), 'Cyrillic survives normalizing');
  assert.strictEqual(M.normalize('КОТЫ!'), M.normalize('коты'));
  assert.ok(M.normalize('猫'), 'CJK survives');
  assert.ok(M.normalize('گربه'), 'Persian survives');
  assert.strictEqual(M.groupKey('🍌'), M.groupKey(' 🍌 '));
  assert.notStrictEqual(M.groupKey('🍌'), M.groupKey('🍎'));
  game.start();
  assert.notStrictEqual(game.handleSubmit('p0', { text: '🍌' }), false);
  game.handleSubmit('p1', { text: '🍌' });
  game.handleSubmit('p2', { text: 'Кот' });
  game.handleSubmit('p3', { text: 'кот!' });
  game.handleSubmit('p4', { text: '猫' });
  assert.strictEqual(game.answers.size, 5, 'every non-Latin answer was taken');
  assert.strictEqual(game.handleSubmit('p5', { text: '   ' }), false, 'nothing in it: the phone is told');
  assert.strictEqual(game.handleSubmit('p5', {}), false);
  const groups = game.autoGroups().map((/** @type {any} */ g) => g.ids.length).sort();
  assert.deepStrictEqual(groups, [1, 2, 2], '🍌 = 🍌, Кот = кот!, 猫 alone');
}));

// ---------------------------------------------------------------- Campfire Quips (2)
test('Quips: a double tap on prompt 1 never fills prompt 2; a wrong prompt is turned down', () => withGame('quiplash', 3, { rounds: 1 }, ({ game }) => {
  game.start();
  const first = game.playerView('p0').gameState.slot;
  assert.ok(Number.isInteger(first), 'the phone is told which prompt it is answering');
  game.handleSubmit('p0', { text: 'one', slot: first });
  assert.notStrictEqual(game.handleSubmit('p0', { text: 'one', slot: first }), false, 'a resend is fine (already in)…');
  const left = game.remaining('p0');
  assert.strictEqual(left.length, 1, '…but it did not fill the second prompt');
  assert.strictEqual(game.playerView('p0').gameState.promptNumber, 2);
  const notMine = game.matchups.findIndex((/** @type {any} */ m) => !m.authors.includes('p0'));
  if (notMine >= 0) assert.strictEqual(game.handleSubmit('p0', { text: 'x', slot: notMine }), false, 'not my prompt');
  assert.strictEqual(game.handleSubmit('p0', { text: '', slot: left[0].mi }), false, 'empty is turned down');
  game.handleSubmit('p0', { text: 'two', slot: left[0].mi });
  assert.deepStrictEqual(game.todo.get('p0').map((/** @type {any} */ t) => game.matchups[t.mi].answers[t.side]).sort(), ['one', 'two']);
}));

test('phone: a sent form ignores another submit, and sends which prompt it answers', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/play.js'), 'utf8');
  /** @type {any} */ let onSubmit = null;
  /** @type {any[]} */ const sent = [];
  const btn = { classList: { add() { btn.sent = true; } }, dataset: {}, textContent: 'Send it', sent: false };
  const form = {
    matches: (/** @type {string} */ sel) => sel === 'form.text-form',
    querySelector: (/** @type {string} */ sel) => (sel === 'input' ? { value: 'funny' } : sel === 'button.sent' ? (btn.sent ? btn : null) : btn),
  };
  const ctx = vm.createContext({
    gameView: { addEventListener: (/** @type {string} */ ev, /** @type {any} */ fn) => { if (ev === 'submit') onSubmit = fn; } },
    window: { Rumpus: { haptic() {} } }, document: { querySelector: () => null },
    send: (/** @type {any} */ p) => sent.push(p), nope() {}, state: { gameState: { slot: 4 } },
  });
  vm.runInContext(source.slice(source.indexOf('const formSent = '), source.indexOf("gameView.addEventListener('click'")), ctx);
  const ev = { target: form, preventDefault() {} };
  onSubmit(ev);
  onSubmit(ev);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sent)), [{ text: 'funny', slot: 4 }], 'one send, with its prompt');
});

// ---------------------------------------------------------------- BaseGame skip (9)
test('Skip on a phase that throws leaves it pending (like the timer), so Skip can retry', () => {
  const { BaseGame } = require('../../games/base');
  class G extends BaseGame {}
  /** @type {any} */ (G).meta = { id: 'g' };
  const g = new G(/** @type {any} */ ({ settings: {}, players: new Map() }), () => {});
  let tries = 0;
  /** @type {unknown[]} */ const glitches = [];
  g.onGlitch = (what, e) => glitches.push(e);
  g.setTimer(60000, () => { tries++; if (tries === 1) throw new Error('boom'); g.phase = 'next'; });
  assert.doesNotThrow(() => g.skip());
  assert.strictEqual(glitches.length, 1, 'the TV hears about it');
  assert.ok(g.timerFn, 'still pending: Skip is still offered');
  g.skip();
  assert.strictEqual(g.phase, 'next', 'the retry went through');
  g.destroy();
});

// ---------------------------------------------------------------- Message in a Bottle (11, 12)
test('Bottle: the last voter / favourite-picker leaving moves the game on', () => withGame('telephone', 4, {}, ({ game, leave }) => {
  game.start();
  // Straight to the doodle vote with three drawings, everyone but p3 has voted.
  game.chains.forEach((/** @type {any} */ c, /** @type {number} */ i) => { c.entries = [{ type: 'text', by: 'p' + i, content: 't' }, { type: 'drawing', by: 'p' + ((i + 1) % 4), content: 'data:image/png;base64,AA' + i }]; });
  game.beginVote();
  assert.strictEqual(game.phase, 'tel-vote');
  for (const id of ['p0', 'p1', 'p2']) game.handleSubmit(id, { key: game.drawingList.find((/** @type {any} */ d) => d.by !== id).key });
  assert.strictEqual(game.phase, 'tel-vote');
  leave('p3');
  assert.strictEqual(game.phase, 'gameover', 'everyone left to vote has voted');
}));

test('Bottle: favourites — the last picker leaving opens the next chain', () => withGame('telephone', 4, {}, ({ game, leave }) => {
  game.start();
  game.chains.forEach((/** @type {any} */ c, /** @type {number} */ i) => { c.entries = [{ type: 'text', by: 'p' + i, content: 'a' }, { type: 'text', by: 'p' + ((i + 1) % 4), content: 'b' }]; });
  game.beginReveal();
  game.openFavs();
  const voters = game.favVoters();
  assert.ok(voters.length >= 2);
  const last = voters[voters.length - 1];
  for (const v of voters.slice(0, -1)) {
    const i = game.chains[0].entries.findIndex((/** @type {any} */ _e, /** @type {number} */ k) => game.favable(v, k));
    game.handleSubmit(v, { fav: i });
  }
  assert.strictEqual(game.revealIndex, 0);
  leave(last);
  assert.strictEqual(game.revealIndex, 1, 'on to the next chain');
}));

test('Bottle: views name drawings by key; the data travels once in `images`', () => withGame('telephone', 3, {}, ({ game }) => {
  game.start();
  const img = 'data:image/png;base64,QUJD';
  game.chains.forEach((/** @type {any} */ c, /** @type {number} */ i) => { c.entries = [{ type: 'text', by: 'p' + i, content: 't' }, { type: 'drawing', by: 'p' + ((i + 1) % 3), content: img + i }]; });
  game.beginReveal();
  const h = game.hostGameState();
  const ref = h.chain.entries[1].content;
  assert.match(ref, /^cfimg:/);
  assert.strictEqual(h.images[ref.slice(6)], img + '0');
  game.revealIndex = 2; game.advanceReveal(); // → the vote
  const v = game.playerView('p0').gameState;
  assert.strictEqual(v.drawings.length, 2);
  assert.ok(v.drawings.every((/** @type {any} */ d) => /^cfimg:/.test(d.image) && v.images[d.image.slice(6)]));
  assert.ok(!JSON.stringify({ ...v, images: null }).includes('data:image'), 'no picture data outside `images`');
  // The same drawing keeps the same key from the reveal to the vote (screens don't fetch it twice).
  assert.ok(Object.keys(game.hostGameState().images).includes(ref.slice(6)));
}));

// ---------------------------------------------------------------- Lantern Lake (13)
test('Lantern: catches every tick give at most ~4 updates a second; the round end still goes out', () => withGame('lantern', 4, {}, ({ game, pushes }) => {
  game.start();
  game.scene = 'fireflies';
  game.play();
  game.stopLoop();
  const before = pushes();
  for (let t = 0; t < 60; t++) {
    // A firefly under every boat: a catch on every tick.
    for (const b of game.boats.values()) game.flies.push({ x: b.x, y: b.y, gold: false, ph: 0 });
    game.tick();
  }
  const during = pushes() - before;
  assert.ok(during <= 8 && during >= 6, `2 s of play → ${during} updates (was one per catch)`);
  game.finish();
  assert.strictEqual(pushes() - before, during + 1, 'the result is pushed at once');
  assert.strictEqual(game.phase, 'll-result');
}));

// ---------------------------------------------------------------- phone: queued join (1)
test('phone: a queued join is sent again after the link drops, and the button comes back meanwhile', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/play.js'), 'utf8');
  /** @type {Record<string, (...a: any[]) => void>} */ const handlers = {};
  /** @type {any[]} */ const emitted = [];
  const button = { disabled: false, textContent: 'Join' };
  /** @type {any} */ let submit = null;
  const noop = () => {};
  const el = () => ({ addEventListener: noop, setAttribute: noop, hidden: false, dataset: {}, textContent: '', innerHTML: '' });
  const ctx = vm.createContext({
    joinForm: { addEventListener: (/** @type {string} */ _e, /** @type {any} */ fn) => { submit = fn; }, querySelector: () => button, setAttribute: noop },
    joinError: { textContent: '', addEventListener: noop, insertAdjacentHTML: noop },
    codeInput: { value: 'ABCD' }, nickInput: { value: 'Sam' }, leaveBtn: el(), banner: el(),
    socket: { connected: true, emit: (/** @type {string} */ ev, /** @type {any} */ m) => emitted.push([ev, m]), on: (/** @type {string} */ ev, /** @type {any} */ fn) => { handlers[ev] = fn; } },
    store: () => null, DEVICE: 'device-1', myAvatar: 0, avatarMode: 'pick', myLook: null, me: null, mySeat: null, ended: false,
    window: { setTimeout: () => 1 }, setTimeout: () => 1, clearTimeout: noop, keepAwake: noop, confirm: () => false,
    document: { getElementById: () => ({ dataset: {}, title: '' }), addEventListener: noop, visibilityState: 'visible' },
    showMessage: noop, showJoin: noop, resetJoinBtnStub: noop, location: {},
  });
  vm.runInContext(source.slice(source.indexOf('function askToJoin('), source.indexOf('// Waking up (screen on, back to the tab)')), ctx);
  submit({ preventDefault() {} });
  assert.strictEqual(emitted.filter(([ev]) => ev === 'player:joinRoom').length, 1);
  handlers['player:queued']({ nickname: 'Sam', game: 'Fish Tales' });
  assert.match(ctx.joinError.textContent, /next/);
  vm.runInContext('socket.connected = false', ctx);
  // The disconnect handler lives further down the file: run it from its own slice.
  vm.runInContext(source.slice(source.indexOf("socket.on('disconnect', () => {\n  if (ended) return;"), source.indexOf('function showJoin()')), Object.assign(ctx, { setConn: noop, lostTimer: null }));
  handlers.disconnect();
  assert.strictEqual(button.disabled, false, 'the Join button works again');
  assert.match(ctx.joinError.textContent, /back in line/);
  handlers.connect();
  const joins = emitted.filter(([ev]) => ev === 'player:joinRoom');
  assert.strictEqual(joins.length, 2, 'back in line by itself on reconnect');
  assert.strictEqual(joins[1][1].nickname, 'Sam');
  handlers['net:resync']();
  assert.strictEqual(emitted.filter(([ev]) => ev === 'player:joinRoom').length, 3, '…and after a revived link (browser build)');
  handlers['player:joinError']({ reason: 'Room is full' });
  handlers.connect();
  assert.strictEqual(emitted.filter(([ev]) => ev === 'player:joinRoom').length, 3, 'not after an error');
});

// ---------------------------------------------------------------- the room over sockets
const ack = (/** @type {any} */ sock, /** @type {any} */ payload) => new Promise((r) => sock.emit('player:submit', { payload }, r));

test('rooms: a turned-down answer is acked ok:false; an emoji answer is taken', { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (const n of ['Ann', 'Ben', 'Cat']) ps.push(await makePlayer(srv, h.code, n));
    await until(() => h.state.players.length === 3, 'joined');
    h.emit('host:startGame', { gameId: 'majority' });
    await h.phase('mr-answer');
    assert.deepStrictEqual(await ack(ps[0].sock, { text: '   ' }), { ok: false, rejected: true });
    assert.deepStrictEqual(await ack(ps[0].sock, { text: '🍌' }), { ok: true });
    await until(() => h.state.gameState.submittedCount === 1, 'the emoji answer counts');
  } finally { await srv.stop(); }
});

test('lineup: needs 2+ players; a game short of players at NEXT GAME is skipped (and shown skipped), not started', { timeout: 30000 }, async () => {
  const srv = await startServer({ RUMPUS_NIGHT_NEXT_MS: '1500' });
  try {
    const h = await makeHost(srv);
    h.emit('host:startNight', { games: ['closest', 'trivia'] });
    await sleep(300);
    assert.strictEqual(h.state.phase, 'lobby', 'nobody here: no lineup (it went straight to an empty final table)');
    assert.strictEqual(h.state.night, null);
    const ps = [];
    for (const n of ['Ann', 'Ben', 'Cat']) ps.push(await makePlayer(srv, h.code, n));
    await until(() => h.state.players.length === 3, 'joined');
    h.emit('host:startNight', { games: ['quiplash', 'closest'] });
    await h.phase('night-next');
    assert.strictEqual(h.state.gameState.next.id, 'quiplash');
    ps[2].sock.emit('player:leave');
    await until(() => h.state.players.length === 2, 'Cat left');
    await until(() => h.state.phase !== 'night-next' || h.state.gameState.next.id !== 'quiplash', 'NEXT GAME moves on', 5000);
    assert.notStrictEqual(h.state.phase, 'answering', 'Campfire Quips (3+) did not start with 2');
    await until(() => h.state.phase === 'night-next' && h.state.gameState.next.id === 'closest', 'on to the next game', 5000);
    assert.deepStrictEqual(h.state.night.list.map((/** @type {any} */ x) => x.skipped), [true, false], 'the skipped game is marked skipped');
  } finally { await srv.stop(); }
});

/** A saved room file with a lineup in it (what core/rooms.js writes). @param {string} dir @param {any} night */
function savedRoom(dir, night) {
  const players = ['Ann', 'Ben', 'Cat'].map((n, i) => ({ id: 'id' + i, token: 'tok' + i, nickname: n, score: 0, avatar: i, look: null, team: null, device: null, shy: false }));
  fs.writeFileSync(path.join(dir, 'rooms.json'), JSON.stringify({ savedAt: Date.now(), rooms: [{
    code: 'WXYZ', hostToken: 'hosttoken', settings: {}, highlights: [], players, night, game: null, interrupted: null }] }));
}
/** The TV comes back to the saved room: its states. @param {any} srv */
async function resumeTv(srv) {
  const tv = srv.connect();
  const t = { state: /** @type {any} */ (null) };
  tv.on('room:stateUpdate', (s) => { t.state = s; });
  await new Promise((r) => tv.once('connect', r));
  tv.emit('host:resume', { code: 'WXYZ', hostToken: 'hosttoken' });
  await until(() => t.state && t.state.code === 'WXYZ', 'the TV has its room back');
  return t;
}

test('restart between lineup games: the lineup carries on (unknown games drop out without shifting it)', { timeout: 30000 }, async () => {
  const dir = tmpDir();
  // Scores were up after game 1 (closest); game 2 is a game this version doesn't know.
  savedRoom(dir, { total: 4, list: ['closest', 'no-such-game', 'trivia', 'closest'], played: ['closest', 'no-such-game'], points: [['id0', 10]], skipped: [1], won: false });
  const srv = await startServer({ RUMPUS_DATA_DIR: dir, RUMPUS_NIGHT_NEXT_MS: '60000' });
  try {
    const t = await resumeTv(srv);
    await until(() => t.state.phase === 'night-next', `NEXT GAME is back (at ${t.state.phase})`);
    assert.strictEqual(t.state.gameState.next.id, 'trivia', 'the next game is the one after the scores, not shifted');
    assert.deepStrictEqual(t.state.night.list.map((/** @type {any} */ x) => x.id), ['closest', 'trivia', 'closest']);
    assert.strictEqual(t.state.night.played, 1);
    assert.strictEqual(t.state.night.standings.find((/** @type {any} */ s) => s.nickname === 'Ann').points, 10, 'standings kept');
  } finally { await srv.stop(); }
});

test('restart on the final table: it comes back, and the champion is counted once', { timeout: 40000 }, async () => {
  const dir = tmpDir();
  savedRoom(dir, { total: 1, list: ['closest'], played: ['closest'], points: [['id0', 10], ['id1', 6]], skipped: [], won: false });
  const wins = () => { const s = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8')); return Object.values(s.players).filter((/** @type {any} */ p) => p.nightWins > 0).map((/** @type {any} */ p) => [p.name, p.nightWins]); };
  for (let run = 0; run < 2; run++) {
    const srv = await startServer({ RUMPUS_DATA_DIR: dir });
    try {
      const t = await resumeTv(srv);
      await until(() => t.state.phase === 'night-final', `the final table is back (at ${t.state.phase})`);
      assert.strictEqual(t.state.night.standings[0].nickname, 'Ann');
      await sleep(600); // saved a moment after it changes
    } finally { await srv.stop(); }
    assert.deepStrictEqual(wins(), [['Ann', 1]], `one night win after restart ${run + 1}`);
  }
});

test('Bottle over sockets: each drawing reaches each screen once, in pieces small enough for WebRTC; a reconnect gets them again', { timeout: 60000 }, async () => {
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    /** @type {any[]} */ const hostStates = [];
    h.sock.on('room:stateUpdate', (/** @type {any} */ s) => hostStates.push(s));
    const ps = [];
    for (const n of ['Ann', 'Ben', 'Cat']) ps.push(await makePlayer(srv, h.code, n));
    await until(() => h.state.players.length === 3, 'joined');
    h.emit('host:startGame', { gameId: 'telephone' });
    await until(() => ps.every((p) => p.state && p.state.phase === 'tel-write'), 'writing');
    for (const p of ps) p.submit({ text: `${p.nickname} phrase` });
    await until(() => ps.every((p) => p.state.phase === 'tel-draw'), 'drawing');
    // Big drawings (100 KB each): all three at once would be one 300 KB message.
    ps.forEach((p, i) => p.submit({ image: 'data:image/png;base64,' + 'ABC'[i].repeat(100 * 1024) }));
    await until(() => ps.every((p) => p.state.phase === 'tel-describe'), 'describing');
    assert.match(ps[0].state.gameState.prev.content, /^cfimg:/);
    for (const p of ps) p.submit({ text: 'a guess' });
    await h.phase('tel-reveal', 10000);
    while (h.state.phase === 'tel-reveal') { h.emit('host:skip'); await sleep(150); }
    await h.phase('tel-vote', 15000);
    await until(() => {
      const have = new Set(hostStates.flatMap((s) => Object.keys((s.gameState && s.gameState.images) || {})));
      return h.state.gameState.drawings.every((/** @type {any} */ d) => have.has(d.image.slice(6)));
    }, 'the TV has every drawing');
    /** @type {Map<string, number>} */ const times = new Map();
    for (const s of hostStates) {
      const imgs = (s.gameState && s.gameState.images) || {};
      const size = Object.values(imgs).reduce((n, v) => n + String(v).length, 0);
      assert.ok(Object.keys(imgs).length <= 1 || size <= 160 * 1024, `one update carried ${Math.round(size / 1024)} KB of drawings`);
      for (const k of Object.keys(imgs)) times.set(k, (times.get(k) || 0) + 1);
      assert.ok(!JSON.stringify({ ...s, gameState: { ...s.gameState, images: null } }).includes('data:image'), 'no picture data outside `images`');
    }
    assert.ok(times.size >= 3 && [...times.values()].every((n) => n === 1), `each drawing went to the TV once (${[...times.values()]})`);
    // A phone whose link drops and comes back (new socket) gets the drawings it needs again.
    const ann = ps[0];
    const again = srv.connect();
    /** @type {any} */ let st = null;
    /** @type {Set<string>} */ const got = new Set();
    again.on('room:stateUpdate', (/** @type {any} */ s) => { st = s; for (const k of Object.keys((s.gameState && s.gameState.images) || {})) got.add(k); });
    await new Promise((r) => again.once('connect', r));
    again.emit('player:rejoin', { code: h.code, token: ann.token });
    await until(() => st && st.phase === 'tel-vote' && st.gameState.drawings.every((/** @type {any} */ d) => got.has(d.image.slice(6))), 'the rejoined phone has its drawings again');
  } finally { await srv.stop(); }
});
