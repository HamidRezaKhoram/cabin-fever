'use strict';
/* The Deep End: the answer matcher, the scoring (chart depth, shared spots, the room's vote, rising
 * stakes), private phone feedback, and the content pool. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, until, makeHost, makePlayer } = require('../helpers');
const DeepEnd = require('../../games/deepend');
const rarity = require('../../games/rarity');
const judgeCore = require('../../public/judge-core.js');

const POOL = JSON.parse(fs.readFileSync(path.join(__dirname, '../../games/data/pools/deepend.json'), 'utf8'));

test('matcher: case, accents, plurals, "the", a typo — but not a different answer', () => {
  const chart = DeepEnd.chartOf({ id: 't', q: 'Name a fruit', answers: [[0, 'apple'], [0, 'banana'], [1, 'pineapple'], [2, 'cherry'], [3, 'passion fruit'], [4, 'crème brûlée'], [2, 'tangerine', 'mandarin']] });
  const tier = (/** @type {string} */ t) => { const m = DeepEnd.lookup(chart, t); return m ? m.tier : null; };
  assert.strictEqual(tier('Apples'), 0);
  assert.strictEqual(tier('  the BANANAS!! '), 0);
  assert.strictEqual(tier('cherries'), 2);
  assert.strictEqual(tier('pinapple'), 1, 'one typo');
  assert.strictEqual(tier('Passion-fruit'), 3, 'punctuation and spaces');
  assert.strictEqual(tier('creme brulee'), 4, 'accents');
  assert.strictEqual(tier('mandarins'), 2, 'an alias');
  assert.strictEqual(tier('grape'), null, 'not on the chart');
  assert.strictEqual(tier('pear'), null, 'short words need an exact match (pear ≠ peach)');
  assert.strictEqual(DeepEnd.lookup(chart, 'mandarin').name, 'tangerine', 'shown by its first name');
});

test('the pool: enough categories, an 18+ share, obvious answers, no answer in two tiers', () => {
  assert.ok(POOL.length >= 60, `${POOL.length} categories`);
  const adult = POOL.filter((/** @type {any} */ x) => x.a).length;
  assert.ok(adult >= 10 && adult / POOL.length <= 0.35, `${adult} 18+ categories`);
  assert.strictEqual(new Set(POOL.map((/** @type {any} */ x) => x.id)).size, POOL.length, 'unique ids');
  for (const it of POOL) {
    assert.ok(it.answers.length >= 20, `${it.q}: ${it.answers.length} answers`);
    for (const t of [0, 1, 2]) assert.ok(it.answers.some((/** @type {any[]} */ r) => r[0] === t), `${it.q}: tier ${t} (the game test plays tiers 0–2 in every category)`);
    const seen = new Map();
    for (const r of it.answers) {
      assert.ok(Number.isInteger(r[0]) && r[0] >= 0 && r[0] <= 4 && r.length >= 2, `${it.q}: ${JSON.stringify(r)}`);
      for (const f of r.slice(1)) {
        const k = DeepEnd.keyOf(f);
        assert.ok(!seen.has(k) || seen.get(k) === r[0], `${it.q}: "${f}" is in tiers ${seen.get(k)} and ${r[0]}`);
        seen.set(k, r[0]);
      }
    }
  }
});

test('rarity: an accepted off-chart answer dives by how rare its words are', () => {
  assert.strictEqual(rarity.offChartTier('the house'), 2, 'an everyday word: Weed Bed');
  assert.strictEqual(rarity.offChartTier('Beagles'), 3, 'a known word (plural, capitals): Drop-off');
  assert.strictEqual(rarity.offChartTier('xoloitzcuintli'), 4, 'a rare word: Lake Bottom');
  assert.strictEqual(rarity.offChartTier('purple xoloitzcuintli'), 4, 'a phrase is as rare as its rarest word');
  assert.strictEqual(rarity.offChartTier('crème brûlée'), rarity.offChartTier('creme brulee'), 'accents');
  assert.strictEqual(rarity.offChartTier('42'), 3, 'no words: the old fixed depth');
  assert.ok(/** @type {number} */ (rarity.zipf('house')) > /** @type {number} */ (rarity.zipf('kayak')));
});

test('answer judge: the maths and a centre for every category', () => {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/judge-centroids.json'), 'utf8'));
  assert.strictEqual(file.dims, 384);
  assert.deepStrictEqual([file.accept, file.doubt], [judgeCore.ACCEPT, judgeCore.DOUBT], 'centres checked with the thresholds in use (rerun tools/judge-centroids.js)');
  for (const it of POOL) assert.ok(file.cats[it.q], `no centre for "${it.q}": rerun tools/judge-centroids.js`);
  const cats = Object.values(file.cats).map((b) => judgeCore.unpack(String(b)));
  for (const c of cats) assert.ok(Math.abs(judgeCore.dot(c, c) - 1) < 1e-9 && c.length === 384, 'length 1');
  // int8 keeps the direction.
  const v = judgeCore.norm(Array.from({ length: 384 }, (_, i) => Math.sin(i * 1.7) + 0.3 * Math.cos(i)));
  assert.ok(judgeCore.dot(v, judgeCore.unpack(judgeCore.pack(v))) > 0.999);
  // A point at a category's centre clearly fits it and not another (centres sit close together in
  // gte-small's space: scores are small differences of cosines).
  const [own, other, ...rest] = cats;
  assert.ok(judgeCore.score(own, own, [other, ...rest]) >= judgeCore.ACCEPT);
  assert.ok(judgeCore.score(own, other, [own, ...rest]) < judgeCore.ACCEPT, 'not a clear fit for another category');
  assert.strictEqual(judgeCore.centre([[1, 0], [0, 1]]).map((x) => x.toFixed(4)).join(), '0.7071,0.7071');
});

let srv;
before(async () => { srv = await startServer({ RUMPUS_DD_ANSWER_MS: '20000', RUMPUS_DD_JUDGE_MS: '20000', RUMPUS_DD_REVEAL_STEP_MS: '50', RUMPUS_DD_REVEAL_END_MS: '4000' }); });
after(() => srv.stop());

test('a game: depth scores, a shared spot costs a tier, the room judges off-chart answers, stakes rise', { timeout: 60000 }, async () => {
  const h = await makeHost(srv);
  const ps = [];
  for (const n of ['Ann', 'Ben', 'Cat']) ps.push(await makePlayer(srv, h.code, n));
  await until(() => h.state.players.length === 3, 'joined');
  h.emit('host:settings', { rounds: 3 });
  await until(() => h.state.settings.rounds === 3, 'rounds');
  h.emit('host:startGame', { gameId: 'deepend' });
  const [ann, ben, cat] = ps;
  const chartFor = async () => {
    await until(() => h.state.phase === 'dd-answer' && ps.every((p) => p.state.phase === 'dd-answer'), 'answering');
    const item = POOL.find((/** @type {any} */ x) => x.q === h.state.gameState.prompt);
    assert.ok(item, `"${h.state.gameState.prompt}" is from the pool`);
    const at = (/** @type {number} */ t) => item.answers.filter((/** @type {any[]} */ r) => r[0] === t).map((/** @type {any[]} */ r) => r[1]);
    return { at, round: h.state.gameState.round };
  };
  const reveal = () => until(() => h.state.phase === 'dd-reveal' && h.state, 'reveal');
  const row = (/** @type {any} */ st, /** @type {string} */ n) => st.gameState.result.rows.find((/** @type {any} */ r) => r.nickname === n);

  // Round 1 (×1): Ann dives to the bottom; Ben and Cat give the same tier-2 answer: both drop to tier 1.
  let { at } = await chartFor();
  const deep = at(4)[0] || at(3)[0], mid = at(2)[0];
  ann.submit({ text: 'zzz placeholder' });
  await until(() => ann.state.you.answer === 'zzz placeholder' && ann.state.you.onChart === false, 'private feedback: not on the chart');
  ann.submit({ text: deep.toUpperCase() }); // changed it before time ran out
  await until(() => ann.state.you.onChart === true, 'private feedback: on the chart');
  assert.strictEqual(JSON.stringify(ann.state).includes('"tier"'), false, 'the phone is not told how deep (that is the reveal)');
  ben.submit({ text: mid }); cat.submit({ text: ' ' + mid.toUpperCase() });
  let r = await reveal();
  const annRound1 = at(4)[0] ? 600 : 450; // (kept: `at` is the next round's chart by the end)
  assert.strictEqual(row(r, 'Ann').gained, annRound1);
  assert.strictEqual(row(r, 'Ben').tier, 1, 'two in the same spot: one tier shallower');
  assert.strictEqual(row(r, 'Ben').gained, 150);
  assert.strictEqual(row(r, 'Cat').gained, 150);
  assert.ok(row(r, 'Ben').shared && /same spot/.test(row(r, 'Ben').note));
  const order = r.gameState.result.rows.map((/** @type {any} */ x) => x.tier);
  assert.deepStrictEqual(order, [...order].sort((a, b) => a - b), 'shallowest first, the deepest last');
  assert.ok(r.gameState.result.obvious.length > 0, 'the TV shows what most people say');
  // 🤯 "Never heard of it!" while the dives play: +25 to the diver, once per person, never your own.
  const annBefore = h.state.players.find((/** @type {any} */ p) => p.nickname === 'Ann').score;
  await until(() => ben.state.phase === 'dd-reveal' && ann.state.phase === 'dd-reveal', 'phones on the reveal');
  const annId = ben.state.gameState.result.rows.find((/** @type {any} */ x) => x.nickname === 'Ann').id;
  ben.submit({ wow: annId }); ben.submit({ wow: annId }); cat.submit({ wow: annId }); ann.submit({ wow: annId });
  await until(() => row(h.state, 'Ann').wows === 2, 'two 🤯 for Ann');
  assert.strictEqual(h.state.players.find((/** @type {any} */ p) => p.nickname === 'Ann').score - annBefore, 50);
  assert.deepStrictEqual(ben.state.you.wowed, [annId]);

  // Round 2 (×1): off the chart. Ann's goes to the room; Ben says yes, Cat no: a tie counts.
  ({ at } = await chartFor());
  ann.submit({ text: 'a purple moose' }); ben.submit({ text: 'florp' }); cat.submit({ text: at(0)[0] });
  await until(() => h.state.phase === 'dd-judge' && ps.every((p) => p.state.phase === 'dd-judge'), 'judging');
  const keyA = ben.state.you.judge.find((/** @type {any} */ j) => j.text === 'a purple moose').key;
  assert.ok(!ann.state.you.judge.some((/** @type {any} */ j) => j.text === 'a purple moose'), 'nobody judges their own answer');
  ann.submit({ judge: keyA, ok: true }); // own answer: refused
  const keyB = ann.state.you.judge.find((/** @type {any} */ j) => j.text === 'florp').key;
  ben.submit({ judge: keyA, ok: true }); cat.submit({ judge: keyA, ok: false });
  ann.submit({ judge: keyB, ok: false }); cat.submit({ judge: keyB, ok: false });
  r = await reveal();
  assert.strictEqual(row(r, 'Ann').tier, 3, 'accepted off the chart, known words (purple, moose): a Drop-off');
  assert.strictEqual(row(r, 'Ann').gained, 450);
  assert.strictEqual(row(r, 'Ben').tier, null, 'voted down: a belly flop');
  assert.strictEqual(row(r, 'Ben').gained, 0);
  assert.strictEqual(row(r, 'Cat').gained, 50, 'the obvious answer barely counts');

  // Round 3: the final ×3; someone who says nothing stays on the dock.
  ({ at } = await chartFor());
  ann.submit({ text: at(1)[0] }); ben.submit({ text: at(2)[0] });
  await until(() => h.state.gameState.answeredCount === 2, 'two in');
  h.emit('host:skip'); // time's up for Cat
  r = await reveal();
  assert.strictEqual(row(r, 'Ann').gained, 150 * 3);
  assert.strictEqual(row(r, 'Ben').gained, 300 * 3);
  assert.strictEqual(row(r, 'Cat').tierName, 'Stayed on the dock');
  await h.phase('gameover');
  const score = (/** @type {string} */ n) => h.state.players.find((/** @type {any} */ p) => p.nickname === n).score;
  assert.strictEqual(score('Ann'), annRound1 + 50 + 450 + 450, 'round 1 + two 🤯 + rounds 2 and 3');
});

test('the TV judge: a clear fit counts without a vote, a doubtful one gets a hint, an old question is ignored', { timeout: 60000 }, async () => {
  const h = await makeHost(srv);
  const ps = [];
  for (const n of ['Dot', 'Eli', 'Fay']) ps.push(await makePlayer(srv, h.code, n));
  await until(() => h.state.players.length === 3, 'joined');
  h.emit('host:startGame', { gameId: 'deepend' });
  const [dot, eli, fay] = ps;
  await until(() => h.state.phase === 'dd-answer' && ps.every((p) => p.state.phase === 'dd-answer'), 'answering');
  assert.strictEqual(h.state.gameState.judgeWarm, true, 'the TV loads the judge while people type');
  const item = POOL.find((/** @type {any} */ x) => x.q === h.state.gameState.prompt);
  dot.submit({ text: 'xoloitzcuintli wobble' }); eli.submit({ text: 'purple phone' }); fay.submit({ text: item.answers[0][1] });
  await until(() => h.state.phase === 'dd-judge' && h.state.gameState.askJudge, 'asking the judge');
  const ask = h.state.gameState.askJudge;
  assert.strictEqual(ask.q, item.q);
  const keyOf = (/** @type {string} */ t) => ask.items.find((/** @type {any} */ x) => x.text === t).key;
  const kd = keyOf('xoloitzcuintli wobble'), ke = keyOf('purple phone');
  h.emit('host:judge', { id: ask.id + 1000, scores: { [kd]: 0.5 } }); // not this question: ignored
  h.emit('host:judge', { id: ask.id, scores: { [kd]: judgeCore.ACCEPT + 0.02, [ke]: judgeCore.DOUBT - 0.02, nope: 1 } });
  await until(() => (h.state.gameState.judging || []).every((/** @type {any} */ j) => j.robot), 'verdicts on the TV');
  assert.deepStrictEqual(h.state.gameState.judging.map((/** @type {any} */ j) => j.robot).sort(), ['doubt', 'fits']);
  await until(() => fay.state.you.judge && fay.state.you.judge.length === 1, 'the clear fit left the vote');
  assert.strictEqual(fay.state.you.judge[0].text, 'purple phone');
  assert.strictEqual(fay.state.you.judge[0].robot, 'doubt', 'the hint next to the vote');
  assert.strictEqual(eli.state.you.judge.length, 0, "Eli's only vote was the clear fit");
  h.emit('host:judge', { id: ask.id, scores: { [ke]: 1 } }); // a verdict is final
  dot.submit({ judge: ke, ok: false }); fay.submit({ judge: ke, ok: true });
  await until(() => h.state.phase === 'dd-reveal', 'reveal');
  const row = (/** @type {string} */ n) => h.state.gameState.result.rows.find((/** @type {any} */ r) => r.nickname === n);
  assert.strictEqual(row('Dot').tier, 4, 'the judge let it count; a rare word: Lake Bottom');
  assert.match(row('Dot').note, /judge/);
  assert.strictEqual(row('Eli').tier, 2, 'the room let it count (a tie); everyday words: Weed Bed');
  h.emit('host:endGame');
  await h.phase('lobby');
});

test('the TV judge: when every off-chart answer clearly fits, the vote is skipped', { timeout: 60000 }, async () => {
  const h = await makeHost(srv);
  const ps = [];
  for (const n of ['Gus', 'Hal']) ps.push(await makePlayer(srv, h.code, n));
  await until(() => h.state.players.length === 2, 'joined');
  h.emit('host:startGame', { gameId: 'deepend' });
  await until(() => h.state.phase === 'dd-answer' && ps.every((p) => p.state.phase === 'dd-answer'), 'answering');
  ps[0].submit({ text: 'zibble the kayak' }); ps[1].submit({ text: 'wombat parade' });
  await until(() => h.state.phase === 'dd-judge' && h.state.gameState.askJudge, 'asking the judge');
  const ask = h.state.gameState.askJudge;
  h.emit('host:judge', { id: ask.id, scores: Object.fromEntries(ask.items.map((/** @type {any} */ x) => [x.key, 0.2])) });
  await until(() => h.state.phase === 'dd-reveal', 'straight to the reveal');
  assert.ok(h.state.gameState.result.rows.every((/** @type {any} */ r) => r.tier !== null), 'both count');
  h.emit('host:endGame');
  await h.phase('lobby');
});
