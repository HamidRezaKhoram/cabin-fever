// The medium/low game bugs from docs/future-features/game-bug-reports.md, one check per fix, played
// in-process against the real game classes (a fake room, no sockets): fast and exact.
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
process.env.RUMPUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-bugs-'));
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

// ---------------------------------------------------------------- shared
test('ties share the better placing in the final standings (900, 900, 100 → 1st, 1st, 3rd)', () => withGame('mostlikely', 4, {}, ({ game, room }) => {
  const s = [900, 900, 100, 0];
  [...room.players.values()].forEach((p, i) => { p.score = s[i]; });
  assert.deepStrictEqual(game.standings().map((/** @type {any} */ r) => r.place), [1, 1, 3, 4]);
}));

test('Consensus: the short bet window isn\'t offered a "hurry" that would do nothing', () => withGame('majority', 3, {}, ({ game }) => {
  const flow = require('../../games/flow');
  game.start();
  assert.ok(flow.allowedVotes(game).includes('hurry'), 'answering: hurry is on offer');
  for (let i = 0; i < 3; i++) game.handleSubmit('p' + i, { text: 'thing ' + i });
  assert.strictEqual(game.phase, 'mr-answer', 'bets still open');
  assert.ok(!flow.allowedVotes(game).includes('hurry'), 'the 8 s bet window can\'t be hurried');
}));

// ---------------------------------------------------------------- Cabin Superlatives
test('Superlatives: an even split scores nobody; the phone shows the real (×2) gain; a vote for a leaver can be recast', () => withGame('mostlikely', 3, { rounds: 4 }, ({ game, leave }) => {
  game.start();
  game.handleSubmit('p0', { target: 'p0' }); game.handleSubmit('p1', { target: 'p1' }); game.handleSubmit('p2', { target: 'p2' });
  assert.strictEqual(game.phase, 'ml-reveal');
  assert.deepStrictEqual(game.result.gained, [], '1/1/1: nobody agreed with anybody');
  game.round = 3; game.nextRound(); // round 4 of 4: stakes ×3 (or ×2)
  game.handleSubmit('p0', { target: 'p1' }); game.handleSubmit('p1', { target: 'p2' }); game.handleSubmit('p2', { target: 'p1' });
  const you = game.playerView('p0').you;
  assert.ok(you.withCrowd && you.gained === 100 * game.mult() && game.mult() > 1, `phone shows +${you.gained}`);
  game.round = 2; game.nextRound();
  game.handleSubmit('p0', { target: 'p2' });
  leave('p2');
  assert.strictEqual(game.playerView('p0').you.voted, false, 'their pick left: p0 votes again');
}));

// ---------------------------------------------------------------- Closest Cast
test('Closest: a skipped question gives the Double Down back; it only pays in the top half; leavers take no place; float ties tie', () => withGame('closest', 2, {}, ({ game, room, leave }) => {
  game.start();
  game.handleSubmit('p0', { number: 5, double: true });
  game.skipQuestion();
  assert.strictEqual(game.playerView('p0').you.canDouble, true, 'skipped: the Double Down is back');
  game.q = { q: 'x', answer: 0.3 };
  room.players.get('p0').score = 500;
  game.handleSubmit('p0', { number: 10, double: true });
  game.handleSubmit('p1', { number: 1 });
  const p0 = game.result.list.find((/** @type {any} */ e) => e.nickname === 'N0');
  assert.strictEqual(p0.gained, -200, '2nd of 2 is not the top half: the Double Down is lost');
  // Ties: 0.1 + 0.2 vs 0.3 used to differ by float noise.
  game.nextRound(); game.q = { q: 'x', answer: 0.3 };
  game.handleSubmit('p0', { number: 0.1 + 0.2 }); game.handleSubmit('p1', { number: 0.3 });
  assert.deepStrictEqual(game.result.list.map((/** @type {any} */ e) => e.rank), [0, 0]);
  room.players.set('p2', { id: 'p2', nickname: 'N2', score: 0, connected: true });
  game.nextRound(); game.q = { q: 'x', answer: 10 };
  game.handleSubmit('p2', { number: 10 });
  leave('p2');
  game.handleSubmit('p0', { number: 9 }); game.handleSubmit('p1', { number: 1 });
  assert.deepStrictEqual(game.result.list.map((/** @type {any} */ e) => e.nickname), ['N0', 'N1'], 'the leaver\'s bullseye takes no place');
}));

// ---------------------------------------------------------------- Cottage Crush
test('Crush: your own mutual date wins over someone\'s one-sided pick; replies must be offered cards; the last writer leaving moves on', () => withGame('crush', 4, {}, ({ game, leave }) => {
  game.start();
  // Everyone writes their notes except p3, who then leaves: the room shouldn't wait out the clock.
  for (const id of ['p0', 'p1', 'p2']) while (game.sent(id) < game.budget(id)) game.handleSubmit(id, { to: id === 'p0' ? 'p1' : 'p0', text: 'hi' });
  assert.strictEqual(game.phase, 'cr-mingle');
  leave('p3');
  assert.strictEqual(game.phase, 'cr-reply', 'moved on when the last writer left');
  const note = game.notes.find((/** @type {any} */ n) => n.to === 'p1');
  game.handleSubmit('p1', { reply: note.id, text: 'free text the phone never offers' });
  assert.strictEqual(note.reply, null, 'a reply that isn\'t a card is refused');
  game.toPick();
  game.handleSubmit('p2', { pick: 'p0' }); // one-sided, comes first in the room
  game.handleSubmit('p0', { pick: 'p1' }); game.handleSubmit('p1', { pick: 'p0' }); // mutual
  const date = game.playerView('p0').you.date;
  assert.ok(date.mutual && date.with === 'N1', `p0 sees their mutual date (${JSON.stringify(date)})`);
}));

// ---------------------------------------------------------------- Lantern Lake
test('Lantern: a leaver\'s boat leaves the lake; a phone that stops sending stops steering', () => withGame('lantern', 3, {}, ({ game, leave }) => {
  game.start();
  game.play();
  game.handleSubmit('p0', { tilt: [1, 0], n: 1 });
  assert.deepStrictEqual(game.steer('p0'), [1, 0]);
  game.tiltAt.set('p0', Date.now() - 2000);
  assert.deepStrictEqual(game.steer('p0'), [0, 0], 'a tilt 2 s old steers nothing');
  leave('p1');
  assert.ok(!game.boats.has('p1'), 'their boat is gone (no eating fireflies, no bumping)');
}));

// ---------------------------------------------------------------- Lakeside Quiz
test('Trivia: a skipped question gives the Double Down back; an asleep player never picks the category', () => withGame('trivia', 3, {}, ({ game, room }) => {
  game.start();
  if (game.phase === 'trivia-category') game.pickCategory(0);
  game.handleSubmit('p0', { choice: 0, double: true });
  game.skipQuestion();
  assert.strictEqual(game.playerView('p0').you.canDouble, true);
  room.players.get('p0').connected = false; // last place, but asleep
  room.players.get('p1').score = 100; room.players.get('p2').score = 200;
  if (game.startCategoryPick()) assert.notStrictEqual(game.chooserId, 'p0');
}));

// ---------------------------------------------------------------- Fish Tales
test('Fish Tales: hitting the truth while lying means no truth points this round; a leaver\'s pick still pays the liar', () => withGame('fibbage', 3, {}, ({ game, room, leave }) => {
  game.start();
  game.answer = 'Truthy';
  game.handleSubmit('p0', { text: 'truthy' }); // the truth: rejected, and noted
  game.handleSubmit('p0', { text: 'Lie zero' }); game.handleSubmit('p1', { text: 'Lie one' }); game.handleSubmit('p2', { text: 'Lie two' });
  assert.strictEqual(game.phase, 'fib-choose');
  const truth = game.options.findIndex((/** @type {any} */ o) => o.isTruth);
  const lie1 = game.options.findIndex((/** @type {any} */ o) => o.text === 'Lie one');
  game.handleSubmit('p0', { choice: truth });
  game.handleSubmit('p2', { choice: lie1 }); // p2 is fooled by p1…
  leave('p2'); // …and leaves before the reveal
  game.handleSubmit('p1', { choice: truth });
  assert.strictEqual(game.phase, 'fib-reveal');
  assert.strictEqual(room.players.get('p0').score, 0, 'p0 probed the truth: finding it pays nothing');
  assert.ok(room.players.get('p1').score > 0, 'p1 keeps the points for fooling p2');
}));

// ---------------------------------------------------------------- Campfire Quips
test('Quips: a forfeit takes the votes but isn\'t a SHUTOUT', () => withGame('quiplash', 4, {}, ({ game }) => {
  game.start();
  game.matchups = [{ prompt: 'p', authors: ['p0', 'p1'], answers: ['funny', null] }];
  game.matchIndex = 0; game.votes = new Map(); game.bets = new Map();
  game.finishMatchup();
  const [a, b] = game.result.sides;
  assert.ok(a.votes === 2 && b.votes === 0);
  assert.strictEqual(a.shutout, false);
}));

// ---------------------------------------------------------------- Porch Confessions
test('Porch Confessions: a quiet round is said and replayed once; "lie instead" can\'t make everyone a liar; a leaver\'s confession leaves', () => withGame('twotruths', 3, { rounds: 2 }, ({ game, leave }) => {
  game.start();
  const truthers = () => [...game.liars].filter(([, v]) => !v).map(([id]) => id);
  for (let k = 0; k < 5 && truthers().length > 1; k++) game.handleSubmit(truthers()[0], { switchToLie: true });
  assert.strictEqual(truthers().length, 1, 'the last truth-teller can\'t switch');
  game.handleSubmit(truthers()[0], { switchToLie: true });
  assert.strictEqual(truthers().length, 1);
  game.handleSubmit('p0', { text: 'only one' });
  game.judge();
  assert.ok(game.phase === 'tt-reveal' && game.empty, 'the TV says so');
  assert.strictEqual(game.round, 0, 'and the round will be played again');
  game.nextRound();
  game.handleSubmit('p1', { text: 'mine' });
  leave('p1');
  assert.strictEqual(game.hostView().submittedCount, 0, 'no "1 / 2 in" for someone who left');
}));

// ---------------------------------------------------------------- Rainy Day Cards
test('Rainy Day Cards: the Czar goes round the table past a leaver; a leaver\'s card can\'t win; Skip clears "chosen by"', () => withGame('cah', 4, { rounds: 6 }, ({ game, leave }) => {
  game.start();
  const czars = [game.czarId];
  game.round = 0; game.nextRound(); czars.push(game.czarId);
  assert.deepStrictEqual(czars, ['p0', 'p1']);
  leave('p3'); // not the Czar
  game.nextRound(); czars.push(game.czarId);
  game.nextRound(); czars.push(game.czarId);
  assert.deepStrictEqual(czars.slice(2), ['p2', 'p0'], 'nobody is skipped after someone leaves');
  // A card whose player left can't win.
  for (const id of game.playerIds()) if (id !== game.czarId) game.handleSubmit(id, { cardIndex: 0 });
  assert.strictEqual(game.phase, 'cah-czar');
  const leaver = game.revealList[0].playerId;
  leave(leaver);
  if (game.phase === 'cah-czar') {
    game.handleSubmit(game.czarId, { choice: 0 });
    assert.strictEqual(game.phase, 'cah-czar', 'the gone card isn\'t a valid pick');
  }
  game.pickedBy = 'Someone';
  game.phase = 'cah-submit';
  game.skipQuestion();
  assert.strictEqual(game.pickedBy, null);
}));

// ---------------------------------------------------------------- Odd Duck Out
test('Odd Duck Out: the imposter\'s gain follows the stakes; a leaver\'s clue doesn\'t count', () => withGame('imposter', 4, { rounds: 4 }, ({ game, leave }) => {
  game.start();
  const crew = game.playerIds().filter((/** @type {string} */ id) => id !== game.imposter);
  game.handleSubmit(crew[0], { text: 'clue' });
  leave(crew[0]);
  assert.strictEqual(game.hostView().submittedCount, 0);
  game.round = 4; game.phase = 'imp-vote'; game.votes = new Map();
  game.tally(); // nobody voted: the imposter escapes
  assert.strictEqual(game.result.outcome, 'escaped');
  assert.strictEqual(game.result.impGained, 300 * game.mult());
}));

// ---------------------------------------------------------------- Cottage Olympics
test('Olympics: ending Dock Balance early keeps what phones had so far; a team round nobody finished scores nobody; Skip ends the minigame', () => withGame('minigames', 4, { teams: true }, ({ game, room }) => {
  game.start();
  for (const [i, p] of [...room.players.values()].entries()) p.team = i % 2 ? 'blue' : 'red';
  game.mini = 'balance'; game.params = game.makeParams('balance'); game.play();
  game.handleSubmit('p0', { balance: 80, partial: true });
  game.skip(); // "End this round"
  assert.strictEqual(game.phase, 'mg-result', 'Skip ends the minigame, not just a step');
  const row = game.result.rows.find((/** @type {any} */ r) => r.nickname === 'N0');
  assert.strictEqual(row.value, 80, 'the partial result counted');
  game.nextRound();
  game.mini = 'balance'; game.params = game.makeParams('balance'); game.play();
  game.skip();
  assert.ok(game.result.rows.every((/** @type {any} */ r) => r.gained === 0), 'no valid results: no 100-each "tie"');
}));

// ---------------------------------------------------------------- Loon Call
test('Loon Call: a song ended early leaves its unplayed bars unscored (not "Off the beat")', () => withGame('looncall', 3, {}, ({ game }) => {
  game.round = 1;
  game.song();
  game.results(); // skipped right away: nothing was played
  assert.ok(game.result.rows.every((/** @type {any} */ r) => r.pct === null && r.grade === null), JSON.stringify(game.result.rows));
  const LoonCall = require('../../games/looncall');
  assert.deepStrictEqual(LoonCall.quantise([1000, 1500], 1000, 1500, 6), [0, 2], 'a 3/4 bar has 6 eighths');
}));

// ---------------------------------------------------------------- Campfire Consensus
test('Consensus: a herd-vote tie merges nothing; shoes = shoe; no "(left)" score rows', () => withGame('majority', 4, {}, ({ game, leave }) => {
  const { normalize } = require('../../games/majority');
  assert.strictEqual(normalize('Shoes'), normalize('shoe'));
  assert.strictEqual(normalize('potatoes'), normalize('potato'));
  assert.strictEqual(normalize('boxes'), normalize('box'));
  game.start();
  ['apple', 'banana', 'cherry', 'date'].forEach((t, i) => game.handleSubmit('p' + i, { text: t }));
  game.reveal();
  assert.strictEqual(game.phase, 'mr-herd');
  // Everyone calls only their own answer the herd: a 1/1/1/1 tie.
  for (let i = 0; i < 4; i++) game.handleSubmit('p' + i, { herd: [game.groups.findIndex((/** @type {any} */ g) => g.ids.includes('p' + i))] });
  assert.strictEqual(game.phase, 'mr-reveal');
  assert.deepStrictEqual(game.result.gained, [], 'nobody matched anybody');
  game.nextRound();
  ['same', 'same', 'other', 'other'].forEach((t, i) => game.handleSubmit('p' + i, { text: t }));
  leave('p1');
  game.reveal(); if (game.phase === 'mr-herd') game.score();
  assert.ok(!game.result.gained.some((/** @type {any} */ r) => r.nickname === '(left)'));
}));

// ---------------------------------------------------------------- Storm Watch
test('Storm Watch: phones learn a chore\'s fate only after the cards flip; odd payloads are ignored, not a glitch', () => withGame('storm', 5, {}, ({ game }) => {
  game.start();
  game.nextChore();
  const leader = game.leader();
  game.pickCrew(leader, game.allowed().slice(0, game.crewSize()));
  game.countVotes();
  game.toCrew();
  for (const id of game.crew) game.handleSubmit(id, { card: 'help' });
  assert.strictEqual(game.phase, 'st-reveal');
  const view = game.playerView('p0').gameState;
  assert.strictEqual(view.reveal, null, 'no result on the phone while the cards flip');
  assert.strictEqual(view.chores[game.reveal.index], null, 'nor on the board');
  game.flipAt = Date.now() - 1;
  assert.strictEqual(game.playerView('p0').gameState.reveal.ok, true, 'after the flip: told');
  assert.doesNotThrow(() => game.handleSubmit('p0', { accuse: { toString: 1 }, snoop: { toString: 1 } }));
}));
