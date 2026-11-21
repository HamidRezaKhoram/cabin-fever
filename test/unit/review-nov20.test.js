// Bugs from the Nov 20 code review, one check per fix, played in-process against the real
// game classes (a fake room, no sockets) like bug-reports.test.js. Each failed on the old code.
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
process.env.RUMPUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-review20-'));
const { test } = require('node:test');
const assert = require('node:assert');

/** A room with these players (ids p0, p1, …) and a game of `id` in it. Timers are real: destroy() after. */
function mk(/** @type {string} */ id, n = 4, settings = {}) {
  const Game = require(`../../games/${id}`);
  const room = /** @type {any} */ ({ code: 'TEST', settings: { rounds: 3, spicy: true, ...settings },
    players: new Map(Array.from({ length: n }, (_, i) => ['p' + i, { id: 'p' + i, nickname: 'N' + i, score: 0, connected: true }])) });
  /** @type {any} */ const game = new Game(room, () => {});
  room.game = game;
  const leave = (/** @type {string} */ pid) => { room.players.delete(pid); game.onPlayerLeft(pid); };
  const score = (/** @type {string} */ pid) => room.players.get(pid).score;
  return { game, room, leave, score };
}
/** Run `fn` with a game, always destroying it (its timers must not outlive the test). */
async function withGame(/** @type {string} */ id, /** @type {number} */ n, /** @type {any} */ settings, /** @type {(g: ReturnType<typeof mk>) => any} */ fn) {
  const g = mk(id, n, settings);
  try { await fn(g); } finally { g.game.destroy(); }
}

// ---------------------------------------------------------------- Fish Tales
test('Fish Tales: the real answer in disguise ("Mexico,", double spaces, zero-width, full-width) is not a lie', () => withGame('fibbage', 3, {}, ({ game }) => {
  game.start();
  game.answer = 'New York';
  for (const disguise of ['New  York', 'new york,', 'New​York', 'Ｎｅｗ Ｙｏｒｋ', ' NEW-YORK!! ']) {
    assert.strictEqual(game.handleSubmit('p0', { text: disguise }), false, `"${disguise}" must be refused as the truth`);
    assert.strictEqual(game.bluffs.has('p0'), false);
  }
  game.handleSubmit('p0', { text: 'Newark' });
  assert.strictEqual(game.bluffs.get('p0'), 'Newark', 'a real lie still counts');
}));

test('Fish Tales: hitting the truth twice is refused both times, so the phone gets its form back', () => withGame('fibbage', 3, {}, ({ game }) => {
  game.start();
  game.answer = 'Mexico';
  // A refused answer acks { ok: false } and the phone re-enables its form; an accepted-looking
  // `undefined` left it on "✓ Sent" for the rest of the bluff phase when nothing on screen changed.
  assert.strictEqual(game.handleSubmit('p1', { text: 'Mexico' }), false);
  assert.strictEqual(game.handleSubmit('p1', { text: 'MEXICO!' }), false);
  game.handleSubmit('p1', { text: 'Peru' });
  assert.strictEqual(game.bluffs.get('p1'), 'Peru');
}));

test('Fish Tales: two lies that only differ in punctuation or spacing are one lie with two authors', () => withGame('fibbage', 3, {}, ({ game }) => {
  game.start();
  game.answer = 'Truthy';
  game.handleSubmit('p0', { text: 'Big Fish' }); game.handleSubmit('p1', { text: 'big  fish!' }); game.handleSubmit('p2', { text: 'Other' });
  assert.strictEqual(game.phase, 'fib-choose');
  const lies = game.options.filter((/** @type {any} */ o) => !o.isTruth);
  assert.strictEqual(lies.length, 2, 'the two "big fish" merged');
  const merged = lies.find((/** @type {any} */ o) => o.authorIds.size === 2);
  assert.ok(merged, 'both liars own the merged lie');
}));

// ---------------------------------------------------------------- Closest Cast / Most Likely
test('Closest Cast: a decimal comma is a decimal point in a French room; thousands still read right', () => {
  const { parseGuess } = require('../../games/closest');
  assert.strictEqual(parseGuess('42,195', 'fr'), 42.195, 'a marathon in km on a French phone');
  assert.strictEqual(parseGuess('3,5', 'en'), 3.5, 'one comma, not 3 digits after: decimal anywhere');
  assert.strictEqual(parseGuess('3,785', 'en'), 3785, 'English thousands');
  assert.strictEqual(parseGuess('1,234,567', 'fr'), 1234567, 'several commas: thousands');
  assert.strictEqual(parseGuess('1.234,5', 'fr'), 1234.5);
  assert.strictEqual(parseGuess('1,234.5', 'en'), 1234.5);
  assert.strictEqual(parseGuess('3 785', 'fr'), 3785);
  assert.strictEqual(parseGuess(-12.5, 'en'), -12.5);
  for (const junk of ['abc', '1e9', '', '--1', { toString: 1 }, null, ['1']]) assert.ok(Number.isNaN(parseGuess(junk, 'en')), `${JSON.stringify(junk)} is not a number`);
});

test('Closest Cast: a guess typed on a French phone counts as typed, and a refused guess gives the form back', () => withGame('closest', 3, { lang: 'fr' }, ({ game }) => {
  game.start();
  assert.strictEqual(game.phase, 'cg-guess');
  game.handleSubmit('p0', { number: '42,195' });
  assert.strictEqual(game.guesses.get('p0'), 42.195);
  assert.strictEqual(game.handleSubmit('p1', { number: '9999999999999' }), false, 'too big: refused, not "sent"');
  assert.strictEqual(game.handleSubmit('p1', { number: { toString: 1 } }), false, 'a crafted object is refused without throwing');
  assert.strictEqual(game.guesses.has('p1'), false);
}));

test('Most Likely: a crafted vote target is refused without throwing (no "Something went wrong" banner)', () => withGame('mostlikely', 3, {}, ({ game }) => {
  game.start();
  for (let k = 0; k < 5 && game.phase !== 'ml-vote'; k++) game.timerFn && game.timerFn();
  assert.strictEqual(game.phase, 'ml-vote');
  assert.doesNotThrow(() => game.handleSubmit('p0', { target: { toString: 1 } }));
  assert.strictEqual(game.handleSubmit('p0', { target: { toString: 1 } }), false);
  assert.strictEqual(game.votes.has('p0'), false);
}));

// ---------------------------------------------------------------- Storm Watch
test('Storm Watch: a raccoon who names the Lookout and then leaves does not help steal the win', () => withGame('storm', 7, {}, ({ game, leave }) => {
  game.start();
  const ids = game.playerIds();
  const raccoons = ids.filter((/** @type {string} */ id) => game.side(id) === 'raccoon');
  assert.strictEqual(raccoons.length, 2, '7 players: 2 raccoons');
  const lookout = game.lookoutId;
  const wrong = ids.find((/** @type {string} */ id) => game.side(id) === 'cottage' && id !== lookout);
  // The cottage won; the raccoons get their last chance.
  game.winner = 'cottage';
  game.toAccuse();
  game.handleSubmit(raccoons[0], { accuse: lookout }); // right…
  leave(raccoons[0]);                                    // …and gone
  game.handleSubmit(raccoons[1], { accuse: wrong });     // the one still here guesses wrong
  for (const id of game.playerIds()) if (game.side(id) === 'cottage') game.handleSubmit(id, { accuse: raccoons[1] });
  assert.strictEqual(game.phase, 'st-final');
  assert.strictEqual(game.winner, 'cottage', '1 right of the 2 raccoons, and that one left: no steal');
  assert.strictEqual(game.stolen, false);
}));

// ---------------------------------------------------------------- seats ("That's me")
test('"That\'s me" can\'t take a seat that is open on another phone mid-game; in the lobby it moves with a new token', { timeout: 30000 }, async () => {
  const { startServer, makeHost, makePlayer, until } = require('../helpers');
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    const ann = await makePlayer(srv, h.code, 'Ann');
    await makePlayer(srv, h.code, 'Bob'); await makePlayer(srv, h.code, 'Cy');
    const ask = async () => {
      const s = srv.connect();
      await new Promise((r) => s.once('connect', r));
      s.emit('player:joinRoom', { code: h.code, nickname: 'ann', takeover: true });
      return new Promise((r) => { s.once('player:joined', (m) => r({ joined: m, s })); s.once('player:joinError', (m) => r({ error: m, s })); });
    };
    // In the lobby: allowed, and the seat's token changes (the asker doesn't get Ann's old credential).
    const oldToken = ann.token;
    const lobby = /** @type {any} */ (await ask());
    assert.ok(lobby.joined, 'lobby takeover allowed');
    assert.strictEqual(lobby.joined.playerId, ann.id);
    assert.ok(oldToken && lobby.joined.token !== oldToken, 'a new token for the moved seat');
    // Mid-game (Odd Duck Out: the seat's screen holds a secret word): refused while that phone is open.
    h.emit('host:startGame', { gameId: 'imposter' });
    await until(() => h.state.phase !== 'lobby', 'game started');
    const mid = /** @type {any} */ (await ask());
    assert.ok(mid.error && !mid.joined, 'mid-game takeover of an open seat is refused');
    lobby.s.close(); mid.s.close();
  } finally { await srv.stop(); }
});

// ---------------------------------------------------------------- pace votes
test('pace votes: votes from phones that went to sleep stop counting, so a minority can\'t hurry/skip', { timeout: 30000 }, async () => {
  const { startServer, makeHost, makePlayer, until, sleep } = require('../helpers');
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (const n of ['Ann', 'Bob', 'Cy', 'Di']) ps.push(await makePlayer(srv, h.code, n));
    h.emit('host:startGame', { gameId: 'quiplash' });
    await h.phase('answering', 5000);
    assert.ok(h.state.pace.allowed.includes('hurry'));
    ps[0].sock.emit('player:vote', { kind: 'hurry' }); ps[1].sock.emit('player:vote', { kind: 'hurry' });
    await until(() => h.state.pace.counts.hurry === 2, 'two votes in');
    ps[0].sock.close(); ps[1].sock.close(); // their phones sleep
    await until(() => h.state.players.filter((/** @type {any} */ p) => p.connected).length === 2, 'two phones left');
    assert.strictEqual(h.state.pace.counts.hurry, 0, 'the sleeping phones\' votes no longer show');
    // (A vote that passes is acted on and its tally starts over at 0.)
    ps[2].sock.emit('player:vote', { kind: 'hurry' }); // 1 of the 2 still here: not a majority
    await until(() => h.state.pace.counts.hurry === 1, 'one live vote');
    await sleep(200);
    assert.strictEqual(h.state.pace.counts.hurry, 1, 'one vote of two present must not pass');
    ps[3].sock.emit('player:vote', { kind: 'hurry' }); // now 2 of 2
    await until(() => h.state.pace.counts.hurry === 0, 'a real majority passes the vote');
  } finally { await srv.stop(); }
});

// ---------------------------------------------------------------- Cottage Olympics
/** Start one mini right away (in-process). @param {any} game @param {string} mini */
function playMini(game, mini) {
  game.mini = mini;
  game.params = game.makeParams(mini);
  game.play();
}

test('Tug of Lake: 2 v 1 at the same tapping speed is an even pull, not a win for the bigger team', () => withGame('minigames', 3, { teams: true }, ({ game, room, score }) => {
  const team = { p0: 'red', p1: 'blue', p2: 'blue' };
  for (const [id, t] of Object.entries(team)) room.players.get(id).team = t;
  playMini(game, 'tug');
  game.playStart = Date.now() - 10000; // 10 s in: the tap cap allows these
  for (let k = 0; k < 5; k++) for (const id of ['p0', 'p1', 'p2']) game.handleSubmit(id, { tap: 20 });
  assert.strictEqual(game.phase, 'mg-play', 'nobody pulled ahead by the goal');
  const { red, blue } = game.tugTotals();
  assert.strictEqual(red, blue, `same speed, same pull (red ${red}, blue ${blue})`);
  game.finish();
  // A tie: each team gets the same pot (100 a head on equal teams), split among its members.
  assert.deepStrictEqual(['p0', 'p1', 'p2'].map(score), [150, 75, 75], 'a tie');
}));

test('Tug of Lake: nobody pulling scores nobody (not a 100-each tie)', () => withGame('minigames', 4, { teams: true }, ({ game, room, score }) => {
  ['red', 'red', 'blue', 'blue'].forEach((t, i) => { room.players.get('p' + i).team = t; });
  playMini(game, 'tug');
  game.finish();
  assert.deepStrictEqual(['p0', 'p1', 'p2', 'p3'].map(score), [0, 0, 0, 0]);
}));

test('Skip Stones: a throw time worked out ahead (or after) and a burst of throws don\'t count', () => withGame('minigames', 2, {}, ({ game }) => {
  playMini(game, 'skip');
  const { period, sweet } = game.params;
  const perfectAt = (/** @type {number} */ from) => game.playStart + Math.round(sweet * period / 2) + period * Math.ceil((from - game.playStart) / period);
  game.handleSubmit('p0', { throw: perfectAt(Date.now() + 2000) }); // the future
  game.handleSubmit('p0', { throw: perfectAt(Date.now()) - period * 3 }); // well in the past
  assert.strictEqual(game.throws.get('p0') || 0, 0, 'neither throw was taken');
  const now = Date.now();
  game.handleSubmit('p1', { throw: now }); game.handleSubmit('p1', { throw: now + 1 }); game.handleSubmit('p1', { throw: now + 2 });
  assert.strictEqual(game.throws.get('p1'), 1, 'three throws at once: one counts');
}));

test('Dock Balance: a 100% reported at the start is only progress, not a finished round', () => withGame('minigames', 2, {}, ({ game }) => {
  playMini(game, 'balance');
  game.handleSubmit('p0', { balance: 100 });
  assert.strictEqual(game.entries.has('p0'), false, 'not a final result');
  assert.strictEqual(game.phase, 'mg-play', 'the round goes on');
  game.endsAt = Date.now() + 300; // the real end of the clock: the final report counts
  game.handleSubmit('p0', { balance: 64 });
  assert.strictEqual(game.entries.get('p0'), 64);
}));

test('Marshmallow Roast: letting go at once wins nothing; a hold longer than the round has run is ignored', () => withGame('minigames', 3, {}, ({ game, score }) => {
  playMini(game, 'roast');
  const { target } = game.params;
  game.handleSubmit('p0', { hold: target }); // "perfect", 0 s in
  assert.strictEqual(game.entries.has('p0'), false);
  game.playStart = Date.now() - target - 1000;
  game.handleSubmit('p0', { hold: target }); game.handleSubmit('p1', { hold: 0 }); game.handleSubmit('p2', { hold: 30 });
  assert.strictEqual(game.phase, 'mg-result');
  assert.ok(score('p0') > 0);
  assert.deepStrictEqual([score('p1'), score('p2')], [0, 0], 'no medals for not roasting');
}));

// ---------------------------------------------------------------- server core
test('a phone queued for a role game that asks again is still queued, not "Room is full"; closing the room tells it', { timeout: 30000 }, async () => {
  const { startServer, makeHost, makePlayer, until } = require('../helpers');
  const srv = await startServer({ MAX_PLAYERS: '4', HOST_GRACE_MS: '300' });
  try {
    const h = await makeHost(srv);
    for (const n of ['Ann', 'Bob', 'Cy']) await makePlayer(srv, h.code, n);
    h.emit('host:startGame', { gameId: 'imposter' });
    await until(() => h.state.phase !== 'lobby', 'game on');
    const q = srv.connect();
    await new Promise((r) => q.once('connect', r));
    const answer = () => new Promise((r) => { q.once('player:queued', () => r('queued')); q.once('player:joinError', (m) => r('error: ' + m.reason)); });
    let a = answer(); q.emit('player:joinRoom', { code: h.code, nickname: 'Di' });
    assert.strictEqual(await a, 'queued');
    a = answer(); q.emit('player:joinRoom', { code: h.code, nickname: 'Di' }); // the phone re-sends (a resync)
    assert.strictEqual(await a, 'queued', 'its own place in the queue is not "full"');
    // The TV goes away for good: the room closes, and the queued phone hears it (it waited forever).
    const closed = new Promise((r) => q.on('room:stateUpdate', (m) => { if (m.phase === 'closed') r(true); }));
    h.sock.close();
    assert.strictEqual(await closed, true);
  } finally { await srv.stop(); }
});

test('a phone can\'t re-take a second seat with someone else\'s token (it kept its first seat "connected" forever)', { timeout: 30000 }, async () => {
  const { startServer, makeHost, makePlayer, until, sleep } = require('../helpers');
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    const ann = await makePlayer(srv, h.code, 'Ann');
    const bob = await makePlayer(srv, h.code, 'Bob');
    const failed = new Promise((r) => ann.sock.once('player:rejoinFailed', () => r(true)));
    ann.sock.emit('player:rejoin', { code: h.code, token: bob.token });
    assert.strictEqual(await failed, true);
    await sleep(100);
    const seats = h.state.players.map((/** @type {any} */ p) => `${p.nickname}:${p.connected}`).sort();
    assert.deepStrictEqual(seats, ['Ann:true', 'Bob:true'], 'each seat stays with its own phone');
    ann.sock.close();
    await until(() => h.state.players.find((/** @type {any} */ p) => p.nickname === 'Ann').connected === false, 'Ann\'s seat goes offline with her phone');
  } finally { await srv.stop(); }
});

test('lineup standings: tied players share the placing (two champions, not one)', () => {
  const { nightSummary } = require('../../core/rooms');
  const players = new Map([['a', { id: 'a', nickname: 'Ann' }], ['b', { id: 'b', nickname: 'Bob' }], ['c', { id: 'c', nickname: 'Cy' }]]);
  const room = /** @type {any} */ ({ players, night: { total: 2, played: ['trivia', 'closest'], list: ['trivia', 'closest'], points: new Map([['ann', 900], ['bob', 900], ['cy', 100]]) } });
  const s = /** @type {any} */ (nightSummary(room)).standings;
  assert.deepStrictEqual(s.map((/** @type {any} */ x) => x.place), [1, 1, 3]);
});

test('banned words are masked in any script (an accented first or last letter used to slip through)', () => {
  const house = require('../../games/house');
  try {
    house.update({ banned: ['écureuil', 'pédé', 'duck'] });
    for (const t of ['un écureuil roux', 'Écureuil!', 'quel pédé', 'a duck']) assert.notStrictEqual(house.mask(t), t, `"${t}" masked`);
    assert.strictEqual(house.mask('ducks and écureuils'), 'ducks and écureuils', 'a longer word is a different word');
  } finally { house._reset(); }
});

test('a small pool falling back past retired items still leaves out what the host switched off', () => {
  const house = require('../../games/house');
  const library = require('../../games/library');
  try {
    const fam = library.load('imposter').family.filter((/** @type {any} */ x) => (x.lang || 'en') === 'en');
    const [a, b] = fam;
    for (const x of fam.slice(2)) house.setDisabled('imposter', x.id, true); // all but two switched off…
    library.recordSkip('imposter', a.id); library.recordSkip('imposter', b.id); // …and those two retired
    for (let k = 0; k < 5; k++) {
      const got = library.draw('imposter', 2, {}).map((/** @type {any} */ x) => x.id);
      for (const id of got) assert.ok(id === a.id || id === b.id, 'a switched-off item came back');
    }
  } finally { house._reset(); }
});

// ---------------------------------------------------------------- leavers and early reveals
test('Odd Duck Out: the caught Odd Duck leaving while guessing ends the round — the catchers keep their points', () => withGame('imposter', 4, {}, ({ game, leave, score }) => {
  game.start();
  const duck = game.imposter;
  const others = game.playerIds().filter((/** @type {string} */ x) => x !== duck);
  for (const id of game.playerIds()) game.handleSubmit(id, { text: 'clue ' + id });
  assert.strictEqual(game.phase, 'imp-vote');
  for (const id of others) game.handleSubmit(id, { target: duck });
  game.handleSubmit(duck, { target: others[0] });
  assert.strictEqual(game.phase, 'imp-guess', 'caught: the Odd Duck guesses the word');
  leave(duck);
  for (const id of others) assert.strictEqual(score(id), 100, 'each catcher keeps +100');
  assert.strictEqual(game.phase, 'imp-reveal', 'the round ends (not a reshuffle)');
}));

test('Odd Duck Out: an empty clue or a vote for someone who left is refused (the phone gets its form back)', () => withGame('imposter', 4, {}, ({ game }) => {
  game.start();
  assert.strictEqual(game.handleSubmit('p0', { text: '   ' }), false);
  for (const id of game.playerIds()) game.handleSubmit(id, { text: 'clue ' + id });
  assert.strictEqual(game.handleSubmit('p0', { target: 'gone' }), false);
}));

test('Campfire Consensus: matching an answer from someone who has left pays nothing', () => withGame('majority', 3, {}, ({ game, leave, score }) => {
  game.start();
  game.handleSubmit('p0', { text: 'banana' }); game.handleSubmit('p1', { text: 'banana' });
  leave('p1');
  game.handleSubmit('p2', { text: 'apple' });
  if (game.phase === 'mr-answer') game.score();
  if (game.phase === 'mr-herd') game.score();
  assert.strictEqual(score('p0'), 0, 'p0\'s only match left the game');
}));

test('Storm Watch: Lucky Loon points wait until the last card has flipped (they gave the chore away)', () => withGame('storm', 5, {}, ({ game, score }) => {
  game.start();
  const crew = game.playerIds().slice(0, 2);
  game.event = 'lucky';
  game.crew = crew;
  game.cards = new Map(crew.map((/** @type {string} */ id) => [id, 'help']));
  game.phase = 'st-crew';
  game.playChore();
  assert.strictEqual(game.phase, 'st-reveal');
  assert.strictEqual(game.flipped(), false, 'the cards are still flipping');
  assert.deepStrictEqual(crew.map(score), [0, 0], 'no Lucky points on the scoreboard yet');
  game.passLeader(); // the reveal ends (or is skipped)
  assert.deepStrictEqual(crew.map(score), [100, 100], 'then the crew gets them');
}));

test('Storm Watch: a Leaky Canoe\'s storm doesn\'t show on the board before the cards flip', () => withGame('storm', 5, {}, ({ game }) => {
  game.start();
  const crew = game.playerIds().slice(0, 2);
  const before = game.storm;
  game.event = 'leaky';
  game.crew = crew;
  game.cards = new Map([[crew[0], 'sabotage'], [crew[1], 'help']]);
  game.phase = 'st-crew';
  game.playChore();
  assert.strictEqual(game.storm, before, 'the storm meter waits');
  game.applyFate();
  assert.strictEqual(game.storm, before + 1);
}));

test('a game ends when too few are left to play it (one player alone in Quips or Crush used to play on for minutes)', { timeout: 30000 }, async () => {
  const { startServer, makeHost, makePlayer, until } = require('../helpers');
  const srv = await startServer({ PLAYER_GRACE_MS: '200' });
  try {
    for (const [gameId, n, keep] of [['quiplash', 3, 2], ['crush', 4, 1]]) {
      const h = await makeHost(srv);
      const ps = [];
      for (let i = 0; i < /** @type {number} */ (n); i++) ps.push(await makePlayer(srv, h.code, 'P' + i));
      h.emit('host:startGame', { gameId });
      await until(() => h.state.phase !== 'lobby', `${gameId} on`);
      for (const p of ps.slice(/** @type {number} */ (keep))) p.sock.close(); // the others go home
      await until(() => h.state.phase === 'gameover', `${gameId} ends with ${keep} left`, 10000);
    }
  } finally { await srv.stop(); }
});

// ---------------------------------------------------------------- Lantern Lake
/** Lantern Lake on scene `scene`, playing (no loop: ticks are called by hand). @param {any} game @param {string} scene */
function lanternScene(game, scene) {
  game.scenes = [scene];
  game.totalRounds = 1;
  game.nextRound();
  game.phase = 'll-play';
  game.tickNo = 0;
}

test('Raft Run: a phone that locked or dropped no longer drags the raft or earns its lanterns', () => withGame('lantern', 3, {}, ({ game, room, score }) => {
  lanternScene(game, 'raft');
  for (const id of ['p0', 'p1']) game.handleSubmit(id, { tilt: [1, 0] });
  room.players.get('p2').connected = false; // asleep
  game.lanterns = [{ x: game.raft.x, y: game.raft.y }]; // right under the raft
  game.tickRaft();
  assert.ok(score('p0') >= 30 && score('p1') >= 30, 'the two steering earn the lantern');
  assert.strictEqual(score('p2'), 0, 'the sleeping phone does not');
  assert.ok(game.raft.vx > 0, 'and the raft moves with the full pull of the two');
}));

test('Lily Pad Tag: when "it" stops steering (phone locked), someone still playing becomes it', () => withGame('lantern', 3, {}, ({ game }) => {
  lanternScene(game, 'tag');
  const it = game.it;
  const others = game.playerIds().filter((/** @type {string} */ x) => x !== it);
  for (const id of others) game.handleSubmit(id, { tilt: [0.5, 0] });
  game.tickNo = 60; // two seconds in; "it" never steered
  game.tickTag();
  assert.ok(others.includes(game.it), 'a steering player is it now');
}));

// ---------------------------------------------------------------- Loon Call
test('Loon Call: perfect taps for a bar long over are turned down; a bar sent right after it ends still counts', () => withGame('looncall', 3, {}, ({ game }) => {
  game.start();
  for (let k = 0; k < 10 && game.phase !== 'lc-song'; k++) game.timerFn && game.timerFn();
  assert.strictEqual(game.phase, 'lc-song');
  const s = game.sched, now = Date.now();
  // Lay the song out around now: phrase 0's echo bar ended long ago, phrase 1's just ended.
  s.startAt = now - 30000; s.endAt = now + 10000;
  s.phrases[0].echoAt = now - 10000;
  s.phrases[1].echoAt = now - s.barMs - 50;
  const notes = (/** @type {any} */ p) => p.steps.map((/** @type {number} */ st) => p.echoAt + (st * s.barMs) / s.steps);
  game.handleSubmit('p0', { taps: notes(s.phrases[0]) });
  assert.strictEqual((game.taps.get('p0') || []).length, 0, 'a long-gone bar\'s perfect taps');
  game.handleSubmit('p1', { taps: notes(s.phrases[1]) });
  assert.strictEqual((game.taps.get('p1') || []).length, notes(s.phrases[1]).length, 'a bar sent as it ends');
}));

test('Tug of Lake: a phone that sat idle can\'t send a burst to catch up (at most a second of tapping is saved up)', () => withGame('minigames', 2, {}, ({ game }) => {
  playMini(game, 'tug');
  game.playStart = Date.now() - 10000; // 10 s in, p0 hasn't tapped yet
  for (let k = 0; k < 10; k++) game.handleSubmit('p0', { tap: 20 });
  assert.ok(game.taps.get('p0') <= 25, `a burst is capped at about a second's worth (got ${game.taps.get('p0')})`);
}));
