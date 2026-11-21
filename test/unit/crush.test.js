// Cottage Crush: privacy of notes, the 3-note budget, replies (emoji, lines or your own words), scoring.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, sleep, makeRoom } = require('../helpers');

let srv;
test.before(async () => { srv = await startServer({ RUMPUS_CR_REVEAL_STEP_MS: '50' }); });
test.after(() => srv.stop());

const room = (names, rounds) => makeRoom(srv, names, rounds ? { rounds } : undefined);

test('notes are private and signed, everyone gets 3, the phone says how many are left; no secret roles', async () => {
  const { h, ps, by } = await room(['Ann', 'Ben', 'Cat', 'Dan'], 1);
  h.emit('host:startGame', { gameId: 'crush' });
  await until(() => ps.every((p) => p.state && p.state.phase === 'cr-mingle' && p.state.you.notesLeft === 3), 'mingle');
  for (const p of ps) {
    assert.strictEqual(p.state.you.notesMax, 3);
    for (const k of ['agenda', 'winked', 'canSetup', 'canPredict', 'heard']) assert.strictEqual(p.state.you[k], undefined, `no ${k} any more`);
  }
  assert.strictEqual(h.state.gameState.exposed, undefined, 'nothing exposed on the TV');
  // Ben → Cat secret note; nobody else may see it.
  by.Ben.submit({ to: by.Cat.id, text: 'Secret for Cat only' });
  by.Ann.submit({ to: by.Ann.id, text: 'self note' }); // ignored
  await until(() => by.Cat.state.you.inbox.length === 1 && by.Ben.state.you.notesLeft === 2, 'Cat got the note, Ben has 2 left');
  for (const p of [by.Ann, by.Dan]) assert.ok(!JSON.stringify(p.state).includes('Secret for Cat only'), `${p.nickname} cannot see it`);
  assert.ok(!JSON.stringify(h.state).includes('Secret for Cat only'), 'the TV only shows counts');
  assert.deepStrictEqual(h.state.gameState.admirers, [{ nickname: 'Cat', count: 1 }]);
  assert.strictEqual(by.Cat.state.you.inbox[0].from, 'Ben');
  assert.deepStrictEqual(by.Ben.state.you.outbox.map((n) => n.to), ['Cat']);
  assert.ok(h.state.gameState.waitingOn.includes('Ann') && h.state.gameState.notesMax === 12, 'the TV names who is still writing');
  // Budgets: send until empty; the extra one is refused.
  for (const p of ps) {
    const left = p.state.you.notesLeft;
    const to = ps.find((q) => q !== p);
    for (let i = 0; i <= left; i++) p.submit({ to: to.id, text: `note ${i}` });
  }
  await h.phase('cr-reply');
  await until(() => ps.every((p) => p.state.phase === 'cr-reply' && p.state.you.notesLeft === 0), 'every budget spent');
  assert.strictEqual(h.state.gameState.notesSent, 12, '3 each, the extra ones refused');
});

test('replies: an emoji, an offered line or your own words; the writer sees it; everyone answered → dates', async () => {
  const { h, by } = await room(['Ann', 'Ben', 'Cat', 'Dan'], 1);
  h.emit('host:startGame', { gameId: 'crush' });
  await until(() => by.Ann.state && by.Ann.state.phase === 'cr-mingle', 'mingle');
  by.Ann.submit({ to: by.Ben.id, text: 'Canoe later?' });
  by.Cat.submit({ to: by.Ben.id, text: 'Nice hat' });
  await until(() => by.Ben.state.you.inbox.length === 2, 'Ben has two notes');
  h.emit('host:skip');
  await h.phase('cr-reply');
  await until(() => by.Ben.state.phase === 'cr-reply' && by.Ben.state.you.repliesLeft === 2, 'Ben has 2 to answer');
  const [n1, n2] = by.Ben.state.you.inbox;
  assert.ok(by.Ben.state.you.replyEmoji.includes('😍') && by.Ben.state.you.replyCards.length > 0, 'emoji and lines offered');
  by.Ben.submit({ reply: n1.id, text: '😍' });
  await until(() => by.Ben.state.you.repliesLeft === 1, 'one left');
  by.Ann.submit({ reply: n1.id, text: 'not my note' }); // ignored
  by.Ben.submit({ reply: n2.id, text: '  Thanks, it was my grandpa\'s  ' });
  await h.phase('cr-pick'); // every note answered: straight to the dates
  await until(() => by.Cat.state.phase === 'cr-pick', 'Cat picking');
  assert.strictEqual(by.Ann.state.you.outbox[0].reply, '😍');
  assert.strictEqual(by.Cat.state.you.outbox[0].reply, 'Thanks, it was my grandpa\'s');
});

test('dates: mutual +200 each, the one asked +100, staying in 0; stakes rise', async () => {
  const { h, ps, by } = await room(['Ann', 'Ben', 'Cat', 'Dan'], 1);
  h.emit('host:startGame', { gameId: 'crush' });
  await until(() => ps.every((p) => p.state && p.state.phase === 'cr-mingle'), 'mingle');
  h.emit('host:skip'); // no notes → straight to the dates
  await h.phase('cr-pick');
  await until(() => ps.every((p) => p.state.phase === 'cr-pick'), 'phones picking');
  // Ann ↔ Ben mutual, Cat → Dan one-sided, Dan stays in.
  by.Ann.submit({ pick: by.Ben.id }); by.Ben.submit({ pick: by.Ann.id }); by.Cat.submit({ pick: by.Dan.id }); by.Dan.submit({ pick: null });
  const rev = await h.phase('cr-reveal');
  const score = (n) => rev.players.find((p) => p.nickname === n).score;
  assert.strictEqual(score('Ann'), 200);
  assert.strictEqual(score('Ben'), 200);
  assert.strictEqual(score('Cat'), 0, 'one-sided pick: the asker gets nothing');
  assert.strictEqual(score('Dan'), 100, '+100 for being asked; staying in costs nothing');
  assert.strictEqual(rev.gameState.pairs.length, 3);
  await until(() => by.Dan.state.you.date && by.Dan.state.you.date.with === null, 'Dan sees his quiet night');
  await until(() => by.Ann.state.you.date && by.Ann.state.you.date.mutual, 'Ann sees her date');
  assert.strictEqual(by.Ann.state.you.date.with, 'Ben');
  await sleep(10);
});
