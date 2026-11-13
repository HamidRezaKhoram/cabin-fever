// Responsible play (docs/future-features/feel-plan.md §4): 🙈 "leave me out" of votes and notes about
// people, the 1-tap game rating, and /bench.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeRoom, contentDir, get } = require('../helpers');

const POOLS = { mostlikely: [{ text: 'Who is most likely to win?' }], majority: [{ text: 'Name a thing' }] };
/** @type {any} */ let srv;
before(async () => { srv = await startServer({ RUMPUS_CONTENT_DIR: contentDir(POOLS) }); });
after(() => srv.stop());

test('🙈 leave me out: the phone switch sticks, the TV sees it, and Most Likely can\'t pick you', async () => {
  const { h, by } = await makeRoom(srv, ['Ann', 'Ben', 'Cat', 'Dan'], { rounds: 1 });
  by.Cat.sock.emit('player:prefs', { shy: true });
  await until(() => by.Cat.state.you.shy === true && h.state.players.find((/** @type {any} */ p) => p.nickname === 'Cat').shy, 'Cat is left out');
  h.emit('host:startGame', { gameId: 'mostlikely' });
  await h.phase('ml-vote');
  await until(() => by.Ann.state.phase === 'ml-vote', 'phones voting');
  const names = by.Ann.state.gameState.targets.map((/** @type {any} */ t) => t.nickname);
  assert.deepStrictEqual(names.sort(), ['Ann', 'Ben', 'Dan'], 'Cat is not on anyone\'s ballot');
  by.Ann.submit({ target: by.Cat.id }); // a hand-made vote for Cat is refused
  await until(() => by.Ben.state.you && by.Ann.state.you, 'states');
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(by.Ann.state.you.voted, false, 'the vote for a left-out player did not count');
  // Switching back puts Cat on the ballot next time; the switch is the player's own.
  by.Cat.sock.emit('player:prefs', { shy: false });
  await until(() => by.Cat.state.you.shy === false, 'Cat is back in');
});

test('🙈 leave me out never makes a game unplayable: with fewer than two left, everyone is votable', async () => {
  const { h, by } = await makeRoom(srv, ['Ann', 'Ben', 'Cat'], { rounds: 1 });
  for (const n of ['Ben', 'Cat']) by[n].sock.emit('player:prefs', { shy: true });
  await until(() => h.state.players.filter((/** @type {any} */ p) => p.shy).length === 2, 'two left out');
  h.emit('host:startGame', { gameId: 'mostlikely' });
  await until(() => by.Ann.state.phase === 'ml-vote', 'voting');
  assert.strictEqual(by.Ann.state.gameState.targets.length, 3);
});

test('🙈 leave me out in Cottage Crush: nobody can send you a note, a wink or pick you as a date', async () => {
  const { h, by, ps } = await makeRoom(srv, ['Ann', 'Ben', 'Cat', 'Dan']);
  by.Cat.sock.emit('player:prefs', { shy: true });
  await until(() => by.Cat.state.you.shy, 'Cat is left out');
  h.emit('host:startGame', { gameId: 'crush' });
  await until(() => ps.every((p) => p.state && p.state.phase === 'cr-mingle' && p.state.you.agenda), 'mingle');
  const targets = by.Ann.state.gameState.targets || by.Ann.state.you.targets;
  assert.ok(targets && !targets.some((/** @type {any} */ t) => t.nickname === 'Cat'), 'Cat is not on Ann\'s list');
  by.Ann.submit({ to: by.Cat.id, text: 'hello Cat' });
  by.Ann.submit({ wink: by.Cat.id });
  by.Ben.submit({ to: by.Dan.id, text: 'hello Dan' });
  await until(() => by.Dan.state.you.inbox.length === 1, 'Dan got Ben\'s note');
  assert.strictEqual(by.Cat.state.you.inbox.length, 0, 'Cat got nothing');
});

test('😴 🙂 🤩: one rating per phone per game, only at game over, kept for /highlights', async () => {
  const { h, by, ps } = await makeRoom(srv, ['Ann', 'Ben', 'Cat'], { rounds: 1 });
  by.Ann.sock.emit('player:rate', { score: 3 }); // in the lobby: ignored
  h.emit('host:startGame', { gameId: 'mostlikely' });
  await until(() => ps.every((p) => p.state.phase === 'ml-vote'), 'voting');
  for (const p of ps) p.submit({ target: by.Ann.id });
  await until(() => ps.every((p) => p.state.phase === 'gameover'), 'game over', 15000);
  assert.strictEqual(by.Ann.state.you.rated, false);
  by.Ann.sock.emit('player:rate', { score: 3 });
  by.Ann.sock.emit('player:rate', { score: 1 }); // a second tap: ignored
  by.Ben.sock.emit('player:rate', { score: 2 });
  by.Cat.sock.emit('player:rate', { score: 7 }); // not a rating
  await until(() => by.Ann.state.you.rated && by.Ben.state.you.rated, 'rated');
  assert.strictEqual(by.Cat.state.you.rated, false);
  const hl = JSON.parse((await get(srv.url, '/api/highlights')).body);
  assert.deepStrictEqual(hl.ratings.mostlikely, [0, 1, 1]);
  // The next game starts with nobody rated.
  h.emit('host:startGame', { gameId: 'mostlikely' });
  await until(() => by.Ann.state.phase === 'ml-vote' && by.Ann.state.you.rated === false, 'fresh game');
});

test('/bench (device speed check) is served', async () => {
  const r = await get(srv.url, '/bench');
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /Device speed check/);
});
