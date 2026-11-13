'use strict';
/* Escalating rounds, majority pace votes (skip question / hurry / next) and
 * hand-drawn profile pictures. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const flow = require('../../games/flow');
const { startServer, until, contentDir, makeRoom } = require('../helpers');

test('stage multipliers: first half ×1, second half ×2, final question ×3', () => {
  const sched = (n) => Array.from({ length: n }, (_, i) => flow.stage(i + 1, n));
  assert.deepStrictEqual(sched(1), [1]);
  assert.deepStrictEqual(sched(2), [1, 2]);
  assert.deepStrictEqual(sched(3), [1, 1, 3]);
  assert.deepStrictEqual(sched(4), [1, 1, 2, 3]);
  assert.deepStrictEqual(sched(6), [1, 1, 1, 2, 2, 3]);
  assert.deepStrictEqual(sched(10), [1, 1, 1, 1, 1, 2, 2, 2, 2, 3]);
});

const POOLS = {
  closest: [{ q: 'Q-one?', answer: 1 }, { q: 'Q-two?', answer: 2 }, { q: 'Q-three?', answer: 3 }],
  majority: [{ text: 'M1' }, { text: 'M2' }, { text: 'M3' }, { text: 'M4' }],
};
let srv;
before(async () => {
  srv = await startServer({
    RUMPUS_CONTENT_DIR: contentDir(POOLS), RUMPUS_CONTENT_MODE: 'replace',
    RUMPUS_CG_GUESS_MS: '60000', RUMPUS_MR_ANSWER_MS: '60000', RUMPUS_REVEAL_MS: '60000',
  });
});
after(() => srv.stop());

const room = (n, settings) => makeRoom(srv, n, settings);
const vote = (p, kind) => p.sock.emit('player:vote', { kind });

test('skip question: needs a majority, then swaps in a fresh question (same round)', async () => {
  const { h, ps } = await room(3);
  h.emit('host:startGame', { gameId: 'closest' });
  const first = await h.phase('cg-guess');
  assert.ok(first.pace.allowed.includes('skipq'));
  assert.strictEqual(first.pace.need, 2);
  const q1 = first.gameState.question;
  ps[2].submit({ number: 5 });
  vote(ps[0], 'skipq');
  vote(ps[0], 'skipq'); // double votes don't count twice
  await until(() => h.state.pace.counts.skipq === 1, 'one vote');
  assert.strictEqual(h.state.gameState.question, q1);
  await until(() => ps[0].state.you.paceVotes.length === 1, 'the voter sees their vote');
  assert.deepStrictEqual(ps[0].state.you.paceVotes, ['skipq']);
  vote(ps[1], 'skipq');
  await until(() => h.state.gameState.question !== q1, 'question replaced');
  assert.strictEqual(h.state.gameState.round, 1);
  assert.strictEqual(h.state.gameState.submittedCount, 0, 'old answers cleared');
  assert.strictEqual(h.state.pace.counts.skipq, 0, 'votes reset');
});

test('hurry: majority cuts the remaining time to 10 s', async () => {
  const { h, ps } = await room(3);
  h.emit('host:startGame', { gameId: 'majority' });
  await h.phase('mr-answer');
  assert.ok(h.state.gameState.endsAt - Date.now() > 50000);
  ps[0].submit({ text: 'x' });
  vote(ps[0], 'hurry');
  vote(ps[1], 'hurry');
  await until(() => h.state.gameState.endsAt - Date.now() <= 10500, 'timer cut');
  assert.ok(h.state.gameState.endsAt - Date.now() > 8000);
});

test('ready: majority skips the rest of a reveal; not available while answering', async () => {
  const { h, ps } = await room(3, { rounds: 2 });
  h.emit('host:startGame', { gameId: 'closest' });
  await h.phase('cg-guess');
  assert.ok(!h.state.pace.allowed.includes('ready'));
  vote(ps[0], 'ready'); // ignored outside reveals
  for (const p of ps) p.submit({ number: 1 });
  const rev = await h.phase('cg-reveal');
  assert.deepStrictEqual(rev.pace.allowed, ['ready']);
  assert.strictEqual(rev.pace.counts.ready, 0);
  vote(ps[0], 'ready'); vote(ps[1], 'ready');
  await until(() => h.state.phase === 'cg-guess' && h.state.gameState.round === 2, 'moved on');
});

test('junk vote kinds are ignored; offline players do not count toward the majority', async () => {
  const { h, ps } = await room(4);
  h.emit('host:startGame', { gameId: 'closest' });
  await h.phase('cg-guess');
  assert.strictEqual(h.state.pace.need, 3);
  vote(ps[0], 'explode');
  ps[3].sock.disconnect();
  await until(() => h.state.pace.need === 2, 'need recalculated');
  const q = h.state.gameState.question;
  vote(ps[0], 'skipq'); vote(ps[1], 'skipq');
  await until(() => h.state.gameState.question !== q, 'skipped with 2 of 3 online');
});

test('skip question is not offered for player-written games', async () => {
  const { h } = await room(3);
  h.emit('host:startGame', { gameId: 'twotruths' });
  await h.phase('tt-write');
  assert.ok(!h.state.pace.allowed.includes('skipq'));
});

test('escalating points across a 4-question game: ×1, ×1, ×2, ×3', async () => {
  const { h, ps } = await room(3, { rounds: 4 });
  h.emit('host:startGame', { gameId: 'majority' });
  let total = 0;
  for (const [r, mult] of [[1, 1], [2, 1], [3, 2], [4, 3]]) {
    await until(() => h.state.phase === 'mr-answer' && h.state.gameState.round === r, 'round ' + r);
    assert.strictEqual(h.state.gameState.multiplier, mult);
    for (const p of ps) { p.submit({ text: 'same' }); p.submit({ bet: 0 }); } // bets miss (2 matched): score is matching only
    await h.phase('mr-reveal');
    total += 300 * mult; // 3 matching answers = 300 each, × stage
    assert.strictEqual(h.state.players[0].score, total, `after round ${r}`);
    h.emit('host:skip');
  }
  await h.phase('gameover');
});

test('wrap: in a real-time game a majority ends the round now (and tells the TV)', async () => {
  const { h, ps } = await room(3);
  /** @type {string[]} */
  const events = [];
  h.sock.on('room:event', (e) => events.push(e.type));
  h.emit('host:startGame', { gameId: 'lantern' });
  await h.phase('ll-play', 10000);
  assert.deepStrictEqual(h.state.pace.allowed, ['wrap']);
  const left = h.state.gameState.endsAt - Date.now();
  assert.ok(left > 5000, `plenty of the scene left (${left} ms)`);
  vote(ps[0], 'wrap');
  await until(() => h.state.pace.counts.wrap === 1, 'one vote counted');
  assert.strictEqual(h.state.phase, 'll-play', 'one vote is not a majority');
  vote(ps[1], 'wrap');
  await h.phase('ll-result', 3000);
  assert.ok(events.includes('wrap'));
  assert.deepStrictEqual(h.state.pace.allowed, ['ready'], 'results: the room can vote "next"');
});

test('Rainy Day Cards: the TV can always Skip — cards in go to the Czar, a slow Czar gets a random winner', async () => {
  const { h, ps } = await room(3);
  h.emit('host:startGame', { gameId: 'cah' });
  await h.phase('cah-submit');
  assert.strictEqual(h.state.canSkip, true, 'Skip is live while cards come in');
  assert.ok(h.state.pace.allowed.includes('hurry'), 'phones can hurry the stragglers');
  const czar = h.state.gameState.czarNickname;
  const player = ps.find((p) => p.nickname !== czar);
  player.submit({ cardIndex: 0 });
  await until(() => h.state.gameState.submittedCount === 1, 'one card in');
  h.emit('host:skip'); // the other player is asleep
  await h.phase('cah-czar');
  assert.strictEqual(h.state.canSkip, true, 'Skip is live while the Czar thinks');
  h.emit('host:skip'); // …and so is the Czar
  await h.phase('cah-reveal');
  assert.strictEqual(h.state.gameState.winner.nickname, player.nickname);
});
