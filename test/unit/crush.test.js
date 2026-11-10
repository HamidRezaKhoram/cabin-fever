// Cottage Crush: privacy of notes, budgets, scoring under each secret agenda, leader exposure.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer, sleep } = require('../helpers');

let srv;
test.before(async () => { srv = await startServer({ RUMPUS_CR_REVEAL_STEP_MS: '50' }); });
test.after(() => srv.stop());

async function room(names, rounds) {
  const h = await makeHost(srv);
  const ps = [];
  for (const n of names) ps.push(await makePlayer(srv, h.code, n));
  await until(() => h.state.players.length === names.length, 'joined');
  if (rounds) { h.emit('host:settings', { rounds }); await until(() => h.state.settings.rounds === rounds, 'rounds'); }
  const by = Object.fromEntries(ps.map((p) => [p.nickname, p]));
  return { h, ps, by };
}

test('notes are private, budgets hold (Player gets 5), wallflowers are anonymous; scoring follows the agendas', async () => {
  const { h, ps, by } = await room(['Ann', 'Ben', 'Cat', 'Dan'], 1);
  h.emit('host:startGame', { gameId: 'crush' });
  await until(() => ps.every((p) => p.state && p.state.phase === 'cr-mingle' && p.state.you.agenda), 'mingle');
  const ag = Object.fromEntries(ps.map((p) => [p.nickname, p.state.you.agenda.id]));
  assert.deepStrictEqual(Object.values(ag).sort(), ['heartbreaker', 'player', 'romantic', 'wallflower'], 'one of each with 4 players');
  // Ben → Cat secret note; nobody else may see it.
  by.Ben.submit({ to: by.Cat.id, text: 'Secret for Cat only' });
  by.Ann.submit({ to: by.Ann.id, text: 'self note' }); // ignored
  await until(() => by.Cat.state.you.inbox.length === 1, 'Cat got the note');
  for (const p of [by.Ann, by.Dan]) assert.ok(!JSON.stringify(p.state).includes('Secret for Cat only'), `${p.nickname} cannot see it`);
  assert.ok(!JSON.stringify(h.state).includes('Secret for Cat only'), 'the TV only shows counts');
  assert.deepStrictEqual(h.state.gameState.admirers, [{ nickname: 'Cat', count: 1 }]);
  assert.strictEqual(by.Cat.state.you.inbox[0].from, ag.Ben === 'wallflower' ? 'Secret admirer' : 'Ben');
  // Budgets: send until empty; the extra one is refused.
  for (const p of ps) {
    const left = p.state.you.notesLeft;
    assert.strictEqual(left + (p.nickname === 'Ben' ? 1 : 0), ag[p.nickname] === 'player' ? 5 : 3);
    const to = ps.find((q) => q !== p);
    for (let i = 0; i <= left; i++) p.submit({ to: to.id, text: `note ${i}` });
  }
  await h.phase('cr-reply');
  assert.ok(ps.every((p) => p.state.you.notesLeft === 0));
  h.emit('host:skip');
  await h.phase('cr-pick');
  // Ann ↔ Ben mutual, Cat → Dan one-sided, Dan stays in.
  by.Ann.submit({ pick: by.Ben.id }); by.Ben.submit({ pick: by.Ann.id }); by.Cat.submit({ pick: by.Dan.id }); by.Dan.submit({ pick: null });
  const rev = await h.phase('cr-reveal');
  const score = (n) => rev.players.find((p) => p.nickname === n).score;
  const mutualPts = (n) => ({ heartbreaker: -100, romantic: 400, wallflower: 200 + 300 /* last evening */, player: 200 }[ag[n]]);
  const clamp = (x) => Math.max(0, x);
  const mult = 1; // a 1-evening game: single stage
  assert.strictEqual(score('Ann'), clamp(mutualPts('Ann') * mult));
  assert.strictEqual(score('Ben'), clamp(mutualPts('Ben') * mult));
  assert.strictEqual(score('Cat'), 0, 'one-sided pick: the asker gets nothing');
  const danEgo = ag.Dan === 'heartbreaker' ? 200 : 100, danStay = ag.Dan === 'romantic' ? -300 : -100;
  assert.strictEqual(score('Dan'), clamp(danEgo + danStay));
  assert.strictEqual(rev.gameState.pairs.length, 3);
});

test("from evening 3 the leader's secret agenda goes up on the TV", async () => {
  const { h, ps } = await room(['Ann', 'Ben', 'Cat', 'Dan'], 3);
  h.emit('host:startGame', { gameId: 'crush' });
  for (let ev = 1; ev <= 3; ev++) {
    await until(() => h.state.phase === 'cr-mingle' && h.state.gameState.evening === ev, `evening ${ev}`);
    if (ev === 3) break;
    h.emit('host:skip'); // mingle → pick (no notes)
    await h.phase('cr-pick');
    await until(() => ps.every((p) => p.state.phase === 'cr-pick'), 'phones picking');
    // Ann and Ben date every night → someone leads.
    ps[0].submit({ pick: ps[1].id }); ps[1].submit({ pick: ps[0].id }); ps[2].submit({ pick: ps[3].id }); ps[3].submit({ pick: ps[2].id });
    await h.phase('cr-reveal');
  }
  const leaderScore = Math.max(...h.state.players.map((p) => p.score));
  if (leaderScore > 0) assert.strictEqual(h.state.gameState.exposed.length, 1, 'leader exposed');
  await sleep(10);
});
