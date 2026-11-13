// Cottage Crush: privacy of notes, budgets, scoring under each secret agenda, leader exposure.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, sleep, makeRoom } = require('../helpers');

let srv;
test.before(async () => { srv = await startServer({ RUMPUS_CR_REVEAL_STEP_MS: '50' }); });
test.after(() => srv.stop());

const room = (names, rounds) => makeRoom(srv, names, rounds ? { rounds } : undefined);

test('notes are private, budgets hold (Player gets 5), wallflowers are anonymous; scoring follows the agendas', async () => {
  const { h, ps, by } = await room(['Ann', 'Ben', 'Cat', 'Dan'], 1);
  h.emit('host:startGame', { gameId: 'crush' });
  await until(() => ps.every((p) => p.state && p.state.phase === 'cr-mingle' && p.state.you.agenda), 'mingle');
  const ag = Object.fromEntries(ps.map((p) => [p.nickname, p.state.you.agenda.id]));
  assert.strictEqual(new Set(Object.values(ag)).size, 4, 'four different agendas with 4 players');
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
  await until(() => ps.every((p) => p.state.phase === 'cr-reply' && p.state.you.notesLeft === 0), 'every budget spent');
  h.emit('host:skip');
  await h.phase('cr-pick');
  // Ann ↔ Ben mutual, Cat → Dan one-sided, Dan stays in.
  by.Ann.submit({ pick: by.Ben.id }); by.Ben.submit({ pick: by.Ann.id }); by.Cat.submit({ pick: by.Dan.id }); by.Dan.submit({ pick: null });
  const rev = await h.phase('cr-reveal');
  const score = (n) => rev.players.find((p) => p.nickname === n).score;
  const mutualPts = (n) => ({ heartbreaker: -100, romantic: 400, wallflower: 200 + 300 /* last evening */, player: 200, matchmaker: 200, gossip: 200 }[ag[n]]);
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

test('Matchmaker sets up two others once (+300 when they date); Gossip hears who writes to whom and bets on a couple (+200)', async () => {
  const names = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay'];
  const { h, ps } = await room(names, 1);
  h.emit('host:startGame', { gameId: 'crush' });
  await until(() => ps.every((p) => p.state && p.state.phase === 'cr-mingle' && p.state.you.agenda), 'mingle');
  assert.strictEqual(new Set(ps.map((p) => p.state.you.agenda.id)).size, 6, 'six players → every agenda once');
  const mm = ps.find((p) => p.state.you.agenda.id === 'matchmaker');
  const gs = ps.find((p) => p.state.you.agenda.id === 'gossip');
  const [x, y, z, w] = ps.filter((p) => p !== mm && p !== gs);
  assert.ok(mm.state.you.canSetup && gs.state.you.canPredict);
  assert.strictEqual(x.state.you.canSetup, false, 'only the Matchmaker can set people up');
  mm.submit({ setup: [mm.id, x.id] }); // can't set yourself up
  x.submit({ setup: [z.id, w.id] }); // not a matchmaker
  await sleep(80);
  assert.strictEqual(mm.state.you.setup, null);
  mm.submit({ setup: [x.id, y.id] });
  await until(() => mm.state.you.setup, 'setup saved');
  mm.submit({ setup: [z.id, w.id] }); // once per game
  await sleep(80);
  assert.deepStrictEqual(mm.state.you.setup.pair, [x.nickname, y.nickname]);
  assert.strictEqual(mm.state.you.canSetup, false);
  for (const p of ps.filter((q) => q !== mm)) assert.ok(!JSON.stringify(p.state).includes('"setup":{'), 'nobody else sees the setup');
  // Gossip hears the routing of notes — never the words.
  x.submit({ to: y.id, text: 'Whisper words' });
  await until(() => gs.state.you.heard.length === 1, 'gossip heard');
  assert.deepStrictEqual(gs.state.you.heard[0], { from: x.state.you.agenda.id === 'wallflower' ? 'Secret admirer' : x.nickname, to: y.nickname });
  assert.ok(!JSON.stringify(gs.state).includes('Whisper words'));
  assert.strictEqual(x.state.you.heard, undefined, 'only the Gossip hears');
  gs.submit({ predict: [x.id, y.id] });
  await until(() => gs.state.you.prediction, 'bet saved');
  gs.submit({ predict: [z.id, w.id] }); // one bet a night
  await sleep(80);
  assert.deepStrictEqual(gs.state.you.prediction, [x.nickname, y.nickname]);
  h.emit('host:skip'); h.emit('host:skip');
  await h.phase('cr-pick');
  const pairs = [[x, y], [z, w], [mm, gs]];
  for (const [a, b] of pairs) { a.submit({ pick: b.id }); b.submit({ pick: a.id }); }
  const rev = await h.phase('cr-reveal');
  const score = (p) => rev.players.find((q) => q.nickname === p.nickname).score;
  assert.strictEqual(score(mm), 200 + 300);
  assert.strictEqual(score(gs), 200 + 200);
  assert.deepStrictEqual(rev.gameState.bonuses.map((b) => [b.kind, b.by, b.a, b.b, b.gained]).sort(),
    [['gossip', gs.nickname, x.nickname, y.nickname, 200], ['matchmaker', mm.nickname, x.nickname, y.nickname, 300]]);
});

test('winks: one free anonymous wink a night, the target sees it, +50 when it turns into a date', async () => {
  const { h, ps, by } = await room(['Ann', 'Ben', 'Cat', 'Dan'], 1);
  h.emit('host:startGame', { gameId: 'crush' });
  await until(() => ps.every((p) => p.state && p.state.phase === 'cr-mingle' && p.state.you.agenda), 'mingle');
  const ag = Object.fromEntries(ps.map((p) => [p.nickname, p.state.you.agenda.id]));
  by.Ann.submit({ wink: by.Ann.id }); // not yourself
  await sleep(60);
  assert.strictEqual(by.Ann.state.you.winked, false);
  by.Ann.submit({ wink: by.Ben.id });
  await until(() => by.Ben.state.you.winksIn === 1, 'Ben sees the wink');
  by.Ann.submit({ wink: by.Cat.id }); // one a night
  await sleep(60);
  assert.strictEqual(by.Cat.state.you.winksIn, 0);
  assert.strictEqual(h.state.gameState.winks, 1);
  assert.ok(!JSON.stringify(by.Ben.state).includes('"from":"Ann"'), 'winks are anonymous');
  h.emit('host:skip');
  await h.phase('cr-pick');
  by.Ann.submit({ pick: by.Ben.id }); by.Ben.submit({ pick: by.Ann.id }); by.Cat.submit({ pick: by.Dan.id }); by.Dan.submit({ pick: by.Cat.id });
  const rev = await h.phase('cr-reveal');
  const score = (n) => rev.players.find((p) => p.nickname === n).score;
  const mutualPts = (n) => ({ heartbreaker: -100, romantic: 400, wallflower: 500, player: 200, matchmaker: 200, gossip: 200 }[ag[n]]);
  assert.strictEqual(score('Ann'), Math.max(0, mutualPts('Ann') + 50));
  assert.strictEqual(score('Ben'), Math.max(0, mutualPts('Ben')), 'only the winker earns the bonus');
});
