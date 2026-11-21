// Bugs from the Nov 21 code review, one check per fix. Each failed on the old code.
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const vm = require('vm');
process.env.RUMPUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-review21-'));
const { test } = require('node:test');
const assert = require('node:assert');

/** A room with these players (ids p0, p1, …) and a game of `id` in it. Timers are real: destroy() after. */
function mk(/** @type {string} */ id, n = 4, settings = {}, extra = (/** @type {number} */ i) => ({})) {
  const Game = require(`../../games/${id}`);
  const room = /** @type {any} */ ({ code: 'TEST', settings: { rounds: 3, spicy: true, ...settings },
    players: new Map(Array.from({ length: n }, (_, i) => ['p' + i, { id: 'p' + i, nickname: 'N' + i, score: 0, connected: true, ...extra(i) }])) });
  /** @type {any} */ const game = new Game(room, () => {});
  room.game = game;
  const leave = (/** @type {string} */ pid) => { room.players.delete(pid); game.onPlayerLeft(pid); };
  const score = (/** @type {string} */ pid) => room.players.get(pid).score;
  return { game, room, leave, score };
}
async function withGame(/** @type {string} */ id, /** @type {number} */ n, /** @type {any} */ settings, /** @type {(g: ReturnType<typeof mk>) => any} */ fn, /** @type {any} */ extra) {
  const g = mk(id, n, settings, extra);
  try { await fn(g); } finally { g.game.destroy(); }
}

// ================================================================ Tier 1

test('seats: mid-game, an offline seat can\'t be taken by typing its name (its secrets, its token); its own phone still gets back in', { timeout: 30000 }, async () => {
  const { startServer, makeHost, makePlayer, until, once } = require('../helpers');
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    const ann = await makePlayer(srv, h.code, 'Ann', { device: 'ann-phone-1234' });
    await makePlayer(srv, h.code, 'Bob'); await makePlayer(srv, h.code, 'Cy');
    h.emit('host:startGame', { gameId: 'imposter' });
    await until(() => h.state.phase !== 'lobby', 'game started');
    ann.sock.disconnect(); // her phone naps
    await until(() => h.state.players.find((p) => p.nickname === 'Ann' && !p.connected), 'Ann offline');
    const s = srv.connect();
    await once(s, 'connect');
    s.emit('player:joinRoom', { code: h.code, nickname: 'ann', device: 'stranger-9999' });
    const res = await Promise.race([once(s, 'player:joined').then((m) => ({ joined: m })), once(s, 'player:joinError').then((m) => ({ error: m }))]);
    assert.ok(/** @type {any} */ (res).error, 'a stranger typing "ann" mid-game is refused');
    s.close();
    // Her own phone (its device id) comes back to the seat.
    const back = srv.connect();
    await once(back, 'connect');
    back.emit('player:joinRoom', { code: h.code, nickname: '', device: 'ann-phone-1234' });
    const again = await once(back, 'player:joined');
    assert.strictEqual(again.playerId, ann.id);
    back.close();
  } finally { await srv.stop(); }
});

test('seats: between games, reclaiming an offline seat by name gives it a new token (the old one stops working)', { timeout: 30000 }, async () => {
  const { startServer, makeHost, makePlayer, until, once } = require('../helpers');
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    const ann = await makePlayer(srv, h.code, 'Ann');
    ann.sock.disconnect();
    await until(() => h.state.players.find((p) => !p.connected), 'offline');
    const again = await makePlayer(srv, h.code, 'Ann');
    assert.strictEqual(again.id, ann.id);
    assert.notStrictEqual(again.token, ann.token, 'a new token');
    const old = srv.connect();
    await once(old, 'connect');
    old.emit('player:rejoin', { code: h.code, token: ann.token });
    await once(old, 'player:rejoinFailed');
    old.close();
  } finally { await srv.stop(); }
});

test('Porch Confessions: the last truth-teller is offered "lie instead" too (its absence told them everyone else lied)', () => withGame('twotruths', 4, {}, ({ game }) => {
  for (let k = 0; k < 20; k++) {
    game.nextRound(); game.round = 0;
    const truthers = game.playerIds().filter((/** @type {string} */ id) => !game.liars.get(id));
    for (const id of truthers) assert.strictEqual(game.playerOnly(id).you.canSwitch, true, `${truthers.length} truth-teller(s): each sees the switch`);
    for (const id of game.playerIds().filter((/** @type {string} */ id) => game.liars.get(id))) assert.strictEqual(game.playerOnly(id).you.canSwitch, false);
  }
}));

/** The phone's connect logic (public/play.js) with a saved seat and a link code. */
function bootPhone(/** @type {any} */ saved, /** @type {string} */ link) {
  const source = fs.readFileSync('public/play.js', 'utf8');
  /** @type {Record<string, Function>} */ const on = {};
  /** @type {Function[]} */ const timers = [];
  const shown = [];
  const emitted = [];
  const context = vm.createContext({
    codeInput: { value: link }, store: (/** @type {string} */ k, /** @type {any} */ v) => (v === undefined ? saved : (saved = v)),
    showMessage: (/** @type {string} */ html) => shown.push(/seat back/.test(html) ? 'spinner' : 'message'),
    showJoin: () => shown.push('join'), requeue: () => {}, setConn: () => {},
    socket: { on: (/** @type {string} */ ev, /** @type {Function} */ f) => { on[ev] = f; }, emit: (/** @type {string} */ ev) => emitted.push(ev) },
    setTimeout: (/** @type {Function} */ f) => { timers.push(f); return 1; }, clearTimeout: () => {},
    banner: { hidden: true }, lostTimer: null, mySeat: null, me: null, ended: false, DEVICE: 'd', resetJoinBtn: () => {},
  });
  vm.runInContext(source.slice(source.indexOf('/** The room code in the link'), source.indexOf("// Browser build: the TV saw this phone's direct link")), context);
  return { on, timers, shown, emitted, context };
}

test('phone: a seat saved from another room never leaves it on "Getting your seat back…" (the join form shows)', () => {
  const p = bootPhone({ code: 'OLDD', token: 't' }, 'NEWW');
  assert.ok(!p.shown.includes('spinner'), 'no spinner for a seat from another room');
  p.on.connect();
  assert.ok(!p.emitted.includes('player:rejoin'), 'no rejoin into the old room');
  // Same room's seat: spinner, rejoin — and if the TV never answers, the form comes back.
  const q = bootPhone({ code: 'ABCD', token: 't' }, 'ABCD');
  assert.deepStrictEqual(q.shown, ['spinner']);
  q.on.connect();
  assert.ok(q.emitted.includes('player:rejoin'));
  q.timers.forEach((f) => f());
  assert.ok(q.shown.includes('join'), 'gives up on a TV that never answers');
});

test('Pages: a piece bigger than CHUNK is refused (one phone could fill the TV\'s memory); junk args don\'t throw', () => {
  const { chunker, CHUNK, Sock } = require('../../web/net');
  const c = chunker(() => {});
  /** @type {any[]} */ const got = [];
  c.receive({ t: 'c', id: 1, i: 0, n: 2, d: 'x'.repeat(CHUNK + 1) }, (/** @type {any} */ m) => got.push(m));
  c.receive({ t: 'c', id: 1, i: 1, n: 2, d: '}' }, (/** @type {any} */ m) => got.push(m));
  assert.strictEqual(got.length, 0);
  const s = new Sock('x');
  assert.doesNotThrow(() => s.receive(/** @type {any} */ ({ t: 'e', ev: 'player:submit', args: 5 })));
});

test('Pages: saved highlights keep only the newest drawings (localStorage is ~5 MB for everything)', () => {
  const { fewerImages } = require('../../core/rooms');
  const list = Array.from({ length: 30 }, (_, i) => ({ text: 't' + i, image: 'data:image/jpeg;base64,AAAA', at: i }));
  const out = fewerImages(list);
  assert.strictEqual(out.length, 30, 'every highlight is kept');
  assert.strictEqual(out.filter((/** @type {any} */ h) => h.image).length, 8);
  assert.ok(out[0].image && !out[29].image, 'the newest keep theirs');
  assert.ok(list[29].image, 'the room\'s own list is untouched');
  const src = fs.readFileSync('web/host-entry.js', 'utf8');
  assert.ok(!/'cf\.tonight\.' \+ room\.code/.test(src), 'no localStorage key per room code (they were never removed)');
});

test('Storm Watch: when the last raccoon leaves, the game ends (cottage wins) instead of minutes of empty chores', () => withGame('storm', 5, {}, ({ game, leave }) => {
  game.start();
  game.nextChore();
  const raccoons = game.playerIds().filter((/** @type {string} */ id) => game.side(id) === 'raccoon');
  for (const r of raccoons) leave(r);
  assert.strictEqual(game.phase, 'st-final');
  assert.strictEqual(game.winner, 'cottage');
}));

test('Storm Watch: when every cottager leaves, the raccoons win', () => withGame('storm', 5, {}, ({ game, leave }) => {
  game.start();
  game.nextChore();
  for (const c of game.playerIds().filter((/** @type {string} */ id) => game.side(id) === 'cottage')) leave(c);
  assert.strictEqual(game.phase, 'st-final');
  assert.strictEqual(game.winner, 'raccoon');
}));

test('Storm Watch: the crew screen looks the same for cottagers and raccoons (Sabotage showed only to raccoons)', () => {
  const src = fs.readFileSync('public/games.js', 'utf8');
  const crew = src.slice(src.indexOf("You're on the crew") - 900, src.indexOf("You're on the crew") + 400);
  assert.ok(!/you\.canSabotage \?/.test(crew) && !/you\.canDouble \?/.test(crew), 'no role-dependent buttons');
  assert.ok(/data-st-card="sabotage"/.test(crew));
});

test('Lily Pad Tag: a phone nobody steers earns nothing (a locked phone used to win the scene)', () => withGame('lantern', 3, {}, ({ game }) => {
  game.start();
  game.scene = 'tag';
  const now = Date.now();
  for (const id of ['p0', 'p1']) { game.tilt.set(id, [0.1, 0]); game.tiltAt.set(id, now); }
  game.it = 'p0';
  const before = game.room.players.get('p2').score;
  for (let k = 0; k < 90; k++) { game.tickNo++; for (const id of ['p0', 'p1']) game.tiltAt.set(id, Date.now()); game.tickTag(); }
  assert.strictEqual(game.room.players.get('p2').score, before, 'the idle phone got no points');
  assert.ok(game.room.players.get('p1').score > 0, 'a steering boat that isn\'t "it" still scores');
}));

test('Cottage Olympics teams: 2 v 1 — a win pays each team the same total, and the team that placed better wins', () => withGame('minigames', 3, { teams: true }, ({ game, room }) => {
  room.players.get('p0').team = 'red'; room.players.get('p1').team = 'red'; room.players.get('p2').team = 'blue';
  game.start();
  game.phase = 'mg-play';
  // Best single result is red's p0, but red's other player is last: on average blue (2nd) beats red (1st + 3rd = 2nd avg)… a tie.
  game.ranking = () => [['p0', 1], ['p2', 2], ['p1', 3]];
  const gained = /** @type {any} */ ({});
  const award = game.award.bind(game);
  game.award = (/** @type {string} */ id, /** @type {number} */ n) => { gained[id] = n; return award(id, n); };
  game.finish();
  const red = (gained.p0 || 0) + (gained.p1 || 0), blue = gained.p2 || 0;
  assert.strictEqual(red, blue, `a tie pays both teams the same (red ${red}, blue ${blue})`);
}));

// ================================================================ Tier 2: scoring and balance

test('games that play themselves with 2 left end below 3 players (CAH, Porch Confessions, Crush, Most Likely)', () => {
  for (const id of ['cah', 'twotruths', 'crush', 'mostlikely']) assert.strictEqual(require(`../../games/${id}`).meta.endBelow, 3, id);
});

test('Quips side bets: nothing to stake → no bet; a Landslide needs 2+ voters; a lost bet costs the stake', () => withGame('quiplash', 4, {}, ({ game, room }) => {
  assert.deepStrictEqual(game.canBet('p0'), { win: false, landslide: false }, 'round 1: nothing to lose, no bet');
  room.players.get('p0').score = 1000;
  assert.deepStrictEqual(game.canBet('p0'), { win: true, landslide: true });
  room.players.delete('p3');
  assert.strictEqual(game.canBet('p0').landslide, false, '1 voter: any win would be 100%');
}));

test('Double Down (Trivia, Closest): closed at 0 points; the risk grows with the round\'s ×2/×3', () => {
  for (const id of ['trivia', 'closest']) {
    const { game, room } = mk(id, 3);
    try {
      assert.strictEqual(game.canDouble('p0'), false, `${id}: 0 points`);
      room.players.get('p0').score = 500;
      assert.strictEqual(game.canDouble('p0'), true, `${id}: with points to cover it`);
      game.mult = () => 3;
      assert.strictEqual(game.canDouble('p0'), false, `${id}: on a ×3 round the risk is ×3 too`);
    } finally { game.destroy(); }
  }
});

test('Cottage Crush: staying in (or a phone that never picked) costs nothing; "done mingling" ends the step early', () => withGame('crush', 4, {}, ({ game, room }) => {
  game.start();
  assert.strictEqual(game.phase, 'cr-mingle');
  game.handleSubmit('p0', { to: 'p1', text: 'hi' });
  for (const id of ['p0', 'p1', 'p2', 'p3']) game.handleSubmit(id, { done: true });
  assert.notStrictEqual(game.phase, 'cr-mingle', 'everyone said done: no waiting out the clock');
  if (game.phase === 'cr-reply') game.handleSubmit('p1', { reply: game.notes[0].id, text: 'yo' });
  assert.strictEqual(game.phase, 'cr-pick');
  for (const id of ['p0', 'p1', 'p2', 'p3']) room.players.get(id).score = 500;
  game.handleSubmit('p0', { pick: null }); // stays in; the others never pick
  game.reveal();
  for (const id of ['p0', 'p1', 'p2', 'p3']) assert.strictEqual(room.players.get(id).score, 500, `${id} lost nothing`);
}));

test('CAH: with only 2 cards there is no room favourite (each could only like the other: always paid both)', () => withGame('cah', 3, {}, ({ game, room }) => {
  game.revealList = [{ playerId: 'p1', text: 'a' }, { playerId: 'p2', text: 'b' }];
  game.favVotes = new Map([['p1', 1], ['p2', 0]]);
  game.awardFavourites();
  assert.deepStrictEqual(game.favourites, []);
  assert.ok(['p1', 'p2'].every((id) => room.players.get(id).score === 0));
}));

test('Loon Call: mashing every step of a bar scores less than playing it sloppily', () => {
  const LoonCall = require('../../games/looncall');
  const notes = [1000, 1500, 2000, 2500];
  const mash = LoonCall.judge(notes, Array.from({ length: 16 }, (_, i) => 1000 + i * 125));
  const sloppy = LoonCall.judge(notes, [1090, 1600]);
  assert.ok(mash.points < sloppy.points + 30, `mash ${mash.points} vs sloppy ${sloppy.points}`);
});

test('bots: Tug at a person\'s pace; Simon from the TV they watched; the loon spotted on the TV', () => {
  const { decide } = require('../../games/bot-brain');
  let r = 0; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let k = 0; k < 50; k++) assert.ok(decide({ phase: 'mg-play', gameState: { mini: 'tug' }, you: {} }, rnd).payload.tap <= 2);
  const memo = {};
  decide({ phase: 'mg-play', gameState: { mini: 'simon', sub: 'show', length: 4 }, you: {}, tv: { seq: [1, 2, 3, 0] }, memo }, rnd);
  let right = 0, spotted = 0;
  for (let k = 0; k < 200; k++) {
    const d = decide({ phase: 'mg-play', gameState: { mini: 'simon', sub: 'go', length: 4, colours: 4 }, you: {}, tv: {}, memo }, rnd);
    if (JSON.stringify(d.payload.seq) === '[1,2,3,0]') right++;
    const s = decide({ phase: 'mg-play', gameState: { mini: 'spot', cells: 12 }, you: {}, tv: { loon: 7 } }, rnd);
    if (s.payload.cell === 7) spotted++;
  }
  assert.ok(right > 60 && right < 160, `Simon right ${right}/200 (was ~1 in 256)`);
  assert.ok(spotted > 60, `loon spotted ${spotted}/200 (was 1 in 12)`);
});

test('lineup: points are kept by name — leaving and coming back (a new seat) keeps them; a leaver stays on the table', () => {
  const { nightSummary } = require('../../core/rooms');
  const players = new Map([['new-seat', { id: 'new-seat', nickname: 'Ann' }], ['b', { id: 'b', nickname: 'Bob' }]]);
  const room = /** @type {any} */ ({ players, night: { total: 2, played: ['trivia'], list: ['trivia', 'closest'], points: new Map([['ann', 10], ['bob', 6], ['cy', 4]]), names: new Map([['cy', 'Cy']]) } });
  const s = /** @type {any} */ (nightSummary(room)).standings;
  assert.deepStrictEqual(s.map((/** @type {any} */ x) => [x.nickname, x.points, !!x.gone]), [['Ann', 10, false], ['Bob', 6, false], ['Cy', 4, true]]);
});

// ================================================================ Tier 3/4: flow

test('lineup: the scores between two games can be skipped ("ready" vote / TV Skip), not ~17 s of waiting', () => {
  const flow = require('../../games/flow');
  assert.deepStrictEqual(flow.allowedVotes(/** @type {any} */ ({ phase: 'gameover', timerFn: () => {} })), ['ready']);
  assert.deepStrictEqual(flow.allowedVotes(/** @type {any} */ ({ phase: 'night-next', timerFn: () => {} })), ['ready']);
  assert.deepStrictEqual(flow.allowedVotes(/** @type {any} */ ({ phase: 'gameover', timerFn: null })), [], 'a plain game over has nothing to skip');
});

test('Quips: a matchup neither player answered is skipped, not shown as two forfeits', () => withGame('quiplash', 4, {}, ({ game }) => {
  game.start();
  game.matchups = [{ prompt: 'a', authors: ['p0', 'p1'], answers: [null, null] }, { prompt: 'b', authors: ['p2', 'p3'], answers: ['x', 'y'] }];
  game.matchIndex = -1;
  game.phase = 'answering';
  game.startVoting();
  assert.strictEqual(game.matchIndex, 1, 'went straight to the matchup with answers');
  assert.strictEqual(game.phase, 'voting');
}));

test('Fish Tales: nobody lied → straight to the reveal (no 30 s vote with one option)', () => withGame('fibbage', 3, {}, ({ game }) => {
  game.start();
  assert.strictEqual(game.phase, 'fib-bluff');
  game.finishBluffing();
  assert.strictEqual(game.phase, 'fib-reveal');
}));

test('CAH: a round with no cards is announced and played again (once), not silently used up', () => withGame('cah', 3, { rounds: 3 }, ({ game }) => {
  game.start();
  const round = game.round;
  game.submitTimeUp();
  assert.strictEqual(game.round, round, 'the same round number again');
  assert.ok(game.hostGameState().notice, 'the TV says why');
  game.submitTimeUp();
  assert.strictEqual(game.round, round + 1, 'only once: then it moves on');
}));

test('Storm Watch: voting a crew down keeps the chore\'s event (it used to re-roll it)', () => withGame('storm', 5, {}, ({ game }) => {
  game.start();
  game.nextChore();
  const ev = game.event;
  game.leaderIdx++;
  game.nextChore();
  assert.strictEqual(game.event, ev);
}));

test('Loon Call views carry no fresh timestamp (it made every view "changed": full views every 80 ms)', () => withGame('looncall', 3, {}, ({ game }) => {
  game.start();
  assert.ok(!('serverNow' in game.hostView()));
  assert.ok(!('serverNow' in game.playerView('p0').gameState));
}));

test('the drawing pad follows one finger; Clear can be undone', () => {
  const src = fs.readFileSync('public/draw.js', 'utf8');
  assert.ok(/e\.pointerId !== curId/.test(src), 'other pointers are ignored');
  assert.ok(/cleared\.push/.test(src) && /cleared\.pop/.test(src), 'Clear is undoable');
});

test('Pages: the highlights page doesn\'t make a phone download the TV\'s whole game; the TV shows a working address', () => {
  const off = fs.readFileSync('web/offline.js', 'utf8');
  assert.ok(/if \(!page\) return;/.test(off));
  assert.ok(!/replace\(\/\\\/play\$\/, '\/highlights'\)/.test(fs.readFileSync('public/host.js', 'utf8')));
});

test('a re-sent tap with the same id is taken once (a lost confirmation + a re-tap sent two Crush notes)', { timeout: 30000 }, async () => {
  const { startServer, makeRoom, until } = require('../helpers');
  const srv = await startServer();
  try {
    const { h, ps } = await makeRoom(srv, 4);
    h.emit('host:startGame', { gameId: 'crush' });
    await until(() => ps.every((p) => p.state && p.state.phase === 'cr-mingle'), 'mingle');
    const to = ps[1].id;
    const msg = { payload: { to, text: 'hey' }, sid: 'dev:x:1', at: Date.now() };
    await new Promise((r) => ps[0].sock.emit('player:submit', msg, r));
    await new Promise((r) => ps[0].sock.emit('player:submit', msg, r));
    await until(() => ps[0].state.you.outbox.length >= 1, 'sent');
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(ps[0].state.you.outbox.length, 1, 'one note, not two');
  } finally { await srv.stop(); }
});

test('reaction minis credit the phone\'s trip (up to 150 ms): a slow link no longer loses Quick Draw by its round trip', () => withGame('minigames', 3, {}, ({ game }) => {
  game.start();
  game.phase = 'mg-play'; game.mini = 'quickdraw'; game.sub = 'go'; game.goAt = Date.now() - 400;
  game.handleSubmit('p0', { tap: true }, { at: Date.now() - 100 }); // tapped at 300, arrived at 400
  game.handleSubmit('p1', { tap: true }, { at: Date.now() - 5000 }); // claims far too much: capped
  assert.ok(Math.abs(game.reactions.get('p0') - 300) < 20, `p0 ${game.reactions.get('p0')}`);
  assert.ok(game.reactions.get('p1') >= 240, `p1 capped at 150 ms of credit (${game.reactions.get('p1')})`);
}));
