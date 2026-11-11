'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, once, until, sleep, makeHost, makePlayer, joinError } = require('../helpers');

let srv;
before(async () => { srv = await startServer({ MAX_PLAYERS: '4', PLAYER_GRACE_MS: '400', HOST_GRACE_MS: '400' }); });
after(() => srv.stop());

test('host gets a 4-letter room code without I or O, plus a resume token', async () => {
  const h = await makeHost(srv);
  assert.match(h.code, /^[A-HJ-NP-Z]{4}$/);
  assert.match(h.hostToken, /^[0-9a-f]{32}$/);
  await until(() => h.state && h.state.phase === 'lobby', 'lobby state');
  assert.deepStrictEqual(h.state.settings, { rounds: null, timerScale: 1, spicy: true, teams: false, lang: 'en' });
  assert.strictEqual(h.state.availableGames.length, 15);
});

test('join errors: unknown room, blank name, duplicate name, full room', async () => {
  const h = await makeHost(srv);
  assert.strictEqual(await joinError(srv, 'ZZZZ', 'Ann'), 'No room with that code.');
  assert.strictEqual(await joinError(srv, h.code, '   '), 'Pick a nickname.');
  await makePlayer(srv, h.code, 'Ann');
  assert.strictEqual(await joinError(srv, h.code, 'ann'), 'That nickname is taken.');
  await makePlayer(srv, h.code, 'Ben');
  await makePlayer(srv, h.code, 'Cat');
  await makePlayer(srv, h.code, 'Dan');
  assert.match(await joinError(srv, h.code, 'Eve'), /Room is full \(4 players max\)/);
});

test('room codes are case-insensitive and nicknames are trimmed to 16 chars', async () => {
  const h = await makeHost(srv);
  const p = await makePlayer(srv, h.code.toLowerCase(), '  A very very long nickname  ');
  await until(() => p.state, 'state');
  assert.strictEqual(p.state.you.nickname, 'A very very long');
});

test('cannot join a role/writing game in progress (Fish Tales), but can rejoin with your token any time', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  await makePlayer(srv, h.code, 'Ben');
  h.emit('host:startGame', { gameId: 'fibbage' });
  await h.phase('fib-bluff');
  assert.match(await joinError(srv, h.code, 'Late'), /in progress/);
  a.sock.disconnect();
  await until(() => h.state.players.find((p) => p.nickname === 'Ann' && !p.connected), 'Ann offline');
  const s2 = srv.connect();
  await once(s2, 'connect');
  s2.emit('player:rejoin', { code: h.code, token: a.token });
  const j = await once(s2, 'player:joined');
  assert.strictEqual(j.playerId, a.id);
  await until(() => h.state.players.every((p) => p.connected), 'all connected');
});

test('rejoin with a bad token fails cleanly', async () => {
  const h = await makeHost(srv);
  const s = srv.connect();
  await once(s, 'connect');
  s.emit('player:rejoin', { code: h.code, token: 'nope' });
  await once(s, 'player:rejoinFailed');
});

test('an offline seat can be reclaimed by typing the same name', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  a.sock.disconnect();
  await until(() => h.state.players.find((p) => !p.connected), 'offline');
  const again = await makePlayer(srv, h.code, 'Ann');
  assert.strictEqual(again.id, a.id);
});

test('a disconnected player is removed after the grace period', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  await until(() => h.state.players.length === 1, 'joined');
  a.sock.disconnect();
  await until(() => h.state.players.length === 0, 'removed after grace', 3000);
});

test('kick removes the player and tells their phone', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  await until(() => h.state.players.length === 1, 'joined');
  const kicked = once(a.sock, 'player:kicked');
  h.emit('host:kickPlayer', { playerId: a.id });
  await kicked;
  await until(() => h.state.players.length === 0, 'kicked');
});

test('a player can leave on purpose', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  await until(() => h.state.players.length === 1, 'joined');
  a.sock.emit('player:leave');
  await until(() => h.state.players.length === 0, 'left');
});

test('host can resume the room after a refresh; bad tokens get a new room', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  h.sock.disconnect();
  await until(() => a.state && a.state.hostConnected === false, 'players told host is gone');
  const h2 = srv.connect();
  await once(h2, 'connect');
  h2.emit('host:resume', { code: h.code, hostToken: 'wrong' });
  await once(h2, 'host:resumeFailed');
  h2.emit('host:resume', { code: h.code, hostToken: h.hostToken });
  const m = await once(h2, 'host:roomCreated');
  assert.strictEqual(m.code, h.code);
  await until(() => a.state.hostConnected === true, 'host back');
});

test('opening the room on a second screen hands control over', async () => {
  const h = await makeHost(srv);
  const h2 = srv.connect();
  await once(h2, 'connect');
  const replaced = once(h.sock, 'host:replaced');
  h2.emit('host:resume', { code: h.code, hostToken: h.hostToken });
  await replaced;
});

test('room closes when the host is gone past the grace period', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  h.sock.disconnect();
  await until(() => a.state && a.state.phase === 'closed', 'closed', 3000);
});

test('settings are validated', async () => {
  const h = await makeHost(srv);
  h.emit('host:settings', { rounds: 5, timerScale: 1.5, spicy: false, teams: false });
  await until(() => h.state.settings.rounds === 5, 'rounds 5');
  assert.deepStrictEqual(h.state.settings, { rounds: 5, timerScale: 1.5, spicy: false, teams: false, lang: 'en' });
  h.emit('host:settings', { rounds: 0, timerScale: 3, spicy: 'yes' });
  h.emit('host:settings', { rounds: 21 });
  h.emit('host:settings', { timerScale: 2 }); // valid marker, processed after the invalid ones
  await until(() => h.state.settings.timerScale === 2, 'marker applied');
  assert.deepStrictEqual(h.state.settings, { rounds: 5, timerScale: 2, spicy: false, teams: false, lang: 'en' });
  h.emit('host:settings', { rounds: null, timerScale: 0.6, spicy: true });
  await until(() => h.state.settings.rounds === null && h.state.settings.timerScale === 0.6 && h.state.settings.spicy, 'reset');
});

test('players cannot use host commands', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  await makePlayer(srv, h.code, 'Ben');
  a.sock.emit('host:startGame', { gameId: 'quiplash' });
  a.sock.emit('host:settings', { rounds: 3 });
  a.sock.emit('host:kickPlayer', { playerId: a.id });
  await sleep(200);
  assert.strictEqual(h.state.phase, 'lobby');
  assert.strictEqual(h.state.settings.rounds, null);
  assert.strictEqual(h.state.players.length, 2);
});

test('games need their minimum players; unknown games are ignored', async () => {
  const h = await makeHost(srv);
  await makePlayer(srv, h.code, 'Ann');
  await makePlayer(srv, h.code, 'Ben');
  h.emit('host:startGame', { gameId: 'imposter' }); // needs 3
  h.emit('host:startGame', { gameId: 'not-a-game' });
  await sleep(200);
  assert.strictEqual(h.state.phase, 'lobby');
  h.emit('host:startGame', { gameId: 'closest' }); // needs 2
  await h.phase('cg-guess');
});

test('skip ends the current phase; end game returns to the lobby; scores reset next game', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  await makePlayer(srv, h.code, 'Ben');
  h.emit('host:startGame', { gameId: 'closest' });
  await h.phase('cg-guess');
  assert.strictEqual(h.state.canSkip, true);
  a.submit({ number: 5 });
  h.emit('host:skip');
  await h.phase('cg-reveal');
  await until(() => h.state.players.some((p) => p.score > 0), 'scored');
  h.emit('host:endGame');
  await h.phase('lobby');
  h.emit('host:startGame', { gameId: 'closest' });
  await h.phase('cg-guess');
  assert.ok(h.state.players.every((p) => p.score === 0));
});

test('avatars: requested one is honoured, duplicates get a free one, changing works', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann', { avatar: 3 });
  const b = await makePlayer(srv, h.code, 'Ben', { avatar: 3 });
  await until(() => h.state.players.length === 2, 'joined');
  const av = (n) => h.state.players.find((p) => p.nickname === n).avatar;
  assert.strictEqual(av('Ann'), 3);
  assert.notStrictEqual(av('Ben'), 3);
  // Pick targets that are actually free (Ben's fallback animal is random).
  const free = () => [...Array(17).keys()].filter((i) => !h.state.players.some((p) => p.avatar === i));
  const target = free()[0];
  a.sock.emit('player:avatar', { avatar: target });
  await until(() => av('Ann') === target, 'changed');
  b.sock.emit('player:avatar', { avatar: target }); // taken by Ann
  b.sock.emit('player:avatar', { avatar: 999 }); // invalid
  const benNext = free()[0];
  b.sock.emit('player:avatar', { avatar: benNext }); // valid — arrives after the bad ones (ordered socket)
  await until(() => av('Ben') === benNext, 'Ben switched', 8000);
  assert.strictEqual(av('Ann'), target);
});

test('reactions reach the TV with the sender avatar; junk and spam are dropped', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann', { avatar: 5 });
  a.sock.emit('player:react', { emoji: '🔥' });
  a.sock.emit('player:react', { emoji: '😂' }); // too soon (throttled)
  await until(() => h.reactions.length >= 1, 'reaction');
  await sleep(200);
  assert.strictEqual(h.reactions.length, 1);
  assert.deepStrictEqual({ ...h.reactions[0], playerId: undefined }, { playerId: undefined, nickname: 'Ann', avatar: 5, look: null, emoji: '🔥' });
  await sleep(650);
  a.sock.emit('player:react', { emoji: '<script>' });
  await sleep(150);
  assert.strictEqual(h.reactions.length, 1);
  a.sock.emit('player:react', { emoji: '🍻' });
  await until(() => h.reactions.length === 2, 'second reaction');
});

test('players never see other players\' private data', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  await makePlayer(srv, h.code, 'Ben');
  await until(() => a.state && a.state.players.length === 2, 'state');
  const raw = JSON.stringify(a.state);
  assert.ok(!raw.includes('token'));
  assert.ok(!raw.includes(h.hostToken));
});

test('character maker: a look is validated, shared with everyone, editable, and clearable', async () => {
  const h = await makeHost(srv);
  const look = { faceShape: 3, skin: 2, hair: 4, hairColor: 5, eyes: 1, mouth: 3, makeup: 2, facial: 0, glasses: 3, hat: 6, earrings: 2, top: 7, bg: 4 };
  const a = await makePlayer(srv, h.code, 'Maker', { look });
  const b = await makePlayer(srv, h.code, 'Cheater', { look: { ...look, hat: 99 } });
  await until(() => h.state.players.length === 2, 'joined');
  const { LOOK_PARTS } = require('../../games/avatar-schema');
  const full = { ...Object.fromEntries(Object.keys(LOOK_PARTS).map((k) => [k, 0])), ...look }; // new parts default to 0
  assert.deepStrictEqual(h.state.players.find((p) => p.nickname === 'Maker').look, full);
  assert.strictEqual(h.state.players.find((p) => p.nickname === 'Cheater').look, null, 'invalid look rejected');
  a.sock.emit('player:look', { look: { ...look, hat: 4 } });
  await until(() => h.state.players.find((p) => p.nickname === 'Maker').look.hat === 4, 'edited');
  b.sock.emit('player:look', { look: { skin: 1, hat: -1 } }); // out of range → ignored (missing parts default to 0)
  a.sock.emit('player:look', { look: null });
  await until(() => h.state.players.find((p) => p.nickname === 'Maker').look === null, 'cleared');
  assert.strictEqual(h.state.players.find((p) => p.nickname === 'Cheater').look, null);
});

test('the same phone always gets its seat back: new tab (no token) or a lost token, by device id', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann', { device: 'phone-ann-123' });
  // A second tab on the same phone, without the saved seat: same player, the old tab is told.
  const s2 = srv.connect();
  await once(s2, 'connect');
  const replaced = once(a.sock, 'player:replaced');
  s2.emit('player:joinRoom', { code: h.code, nickname: '', device: 'phone-ann-123' });
  const j = await once(s2, 'player:joined');
  assert.strictEqual(j.playerId, a.id);
  await replaced;
  await until(() => h.state && h.state.players.length === 1 && h.state.players[0].connected, 'Ann seated once');
  await sleep(100);
  assert.strictEqual(h.state.players.length, 1, 'no duplicate player');
  // The replaced tab can't act for the seat any more.
  a.sock.emit('player:react', { emoji: '🔥' });
  // Rejoin with a wrong token but the right device: still the same seat.
  const s3 = srv.connect();
  await once(s3, 'connect');
  s3.emit('player:rejoin', { code: h.code, token: 'stale', device: 'phone-ann-123' });
  assert.strictEqual((await once(s3, 'player:joined')).playerId, a.id);
  // A different phone with the same name while Ann is online is still refused.
  assert.strictEqual(await joinError(srv, h.code, 'Ann', { device: 'phone-other-999' }), 'That nickname is taken.');
});

test('player:submit is acknowledged, so phones know their tap reached the TV', async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Ann');
  await makePlayer(srv, h.code, 'Ben');
  h.emit('host:startGame', { gameId: 'closest' });
  await a.phase('cg-guess');
  const res = await new Promise((resolve) => a.sock.timeout(2000).emit('player:submit', { payload: { number: 5 } }, (/** @type {any} */ err, /** @type {any} */ r) => resolve(err ? 'timeout' : r)));
  assert.deepStrictEqual(res, { ok: true });
  // Not in a room: answered with ok:false (the phone shows "tap again").
  const s = srv.connect();
  await once(s, 'connect');
  const bad = await new Promise((resolve) => s.timeout(2000).emit('player:submit', { payload: {} }, (/** @type {any} */ err, /** @type {any} */ r) => resolve(err ? 'timeout' : r)));
  assert.deepStrictEqual(bad, { ok: false });
});

test('a burst of taps is coalesced into a few state updates, and unchanged views are not resent', async () => {
  const h = await makeHost(srv);
  const ps = [await makePlayer(srv, h.code, 'Ann'), await makePlayer(srv, h.code, 'Ben'), await makePlayer(srv, h.code, 'Cat')];
  h.emit('host:startGame', { gameId: 'closest' });
  await h.phase('cg-guess');
  await sleep(150);
  let n = 0;
  h.sock.on('room:stateUpdate', () => { n++; });
  for (const p of ps) p.submit({ number: 1 });
  await until(() => h.state.phase !== 'cg-guess' || (h.state.gameState.answeredCount || 0) >= 3 || n >= 1, 'answers counted');
  await sleep(200);
  assert.ok(n >= 1 && n <= 3, `3 taps in one go → ${n} TV updates`);
  // Re-sending the same answer changes nothing → nobody gets a duplicate update.
  const before = n;
  ps[0].submit({ number: 1 });
  await sleep(150);
  assert.ok(n - before <= 1, 'no flood of identical updates');
});

test('join mid-game: trivia-style games take a new phone (it can answer at once); role games say "join when this one ends"', { timeout: 30000 }, async () => {
  const { startServer, makeHost, makePlayer, joinError, until } = require('../helpers');
  const srv = await startServer({ RUMPUS_TRIVIA_QUESTION_MS: '20000', RUMPUS_TRIVIA_ROUNDS: '2' });
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (const n of ['Ann', 'Ben', 'Cat']) ps.push(await makePlayer(srv, h.code, n));
    for (const p of ps) p.sock.on('room:stateUpdate', (/** @type {any} */ s) => { if (s.phase === 'trivia-category' && s.you.isChooser) p.submit({ choice: 0 }); });
    h.emit('host:startGame', { gameId: 'trivia' });
    await h.phase('trivia-question', 10000);
    const late = await makePlayer(srv, h.code, 'Dee');
    await until(() => late.state && late.state.phase === 'trivia-question', 'the newcomer sees the question');
    late.submit({ choice: 0 });
    for (const p of ps) p.submit({ choice: 1 });
    await h.phase('trivia-reveal', 5000); // everyone, newcomer included, answered → reveal right away
    assert.ok(h.state.gameState.scored.some((/** @type {any} */ s) => s.nickname === 'Dee'), 'the newcomer is scored');
    h.emit('host:endGame');
    await h.phase('lobby', 5000);
    h.emit('host:startGame', { gameId: 'quiplash' });
    await h.phase('answering', 5000);
    assert.match(String(await joinError(srv, h.code, 'Eve')), /join when this one ends/);
  } finally { await srv.stop(); }
});
