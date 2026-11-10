// Campfire Wizards: spell resolution (shield, mirror, frost, meteor, mend), sparks and costs,
// no double shield, knockouts → ghosts who still act and score, bounty, events, the end.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer } = require('../helpers');
const Wizards = require('../../games/wizards');

/** A game on a fake room (no sockets): picks go in, resolve() runs the round. */
function duel(names) {
  const players = new Map(names.map((n) => [n, { id: n, nickname: n, score: 0 }]));
  const g = new Wizards(/** @type {any} */ ({ players, settings: { rounds: 10 } }), () => {});
  g.start();
  g.event = 'still';
  const cast = (who, spell, target) => g.handleSubmit(who, target === undefined ? { spell } : { spell, target });
  const w = (n) => g.wiz.get(n);
  const score = (n) => players.get(n).score;
  return { g, cast, w, score, players };
}

test('firebolt hits for 2 and pays 20 a heart; a shield blocks it; no shield twice in a row', () => {
  const { g, cast, w, score } = duel(['Ann', 'Ben', 'Cat']);
  cast('Ann', 'bolt', 'Ben'); cast('Ben', 'charge'); // Cat is slow → charges
  assert.strictEqual(g.phase, 'wz-pick');
  g.resolve();
  assert.strictEqual(w('Ben').hearts, 3);
  assert.strictEqual(score('Ann'), 40);
  assert.strictEqual(w('Ben').sparks, 4, 'charge +2');
  assert.strictEqual(w('Ann').sparks, 1, 'bolt cost 1');
  g.nextRound(); g.event = 'still';
  cast('Ann', 'bolt', 'Ben'); cast('Ben', 'shield'); cast('Cat', 'charge');
  assert.strictEqual(g.phase, 'wz-reveal', 'everyone picked → the spells go off at once');
  assert.strictEqual(w('Ben').hearts, 3, 'shield blocked');
  assert.ok(g.beats.some((b) => b.kind === 'blocked'));
  g.nextRound(); g.event = 'still';
  cast('Ben', 'shield');
  assert.ok(!g.picks.has('Ben'), 'two shields in a row are refused');
  g.destroy();
});

test('mirror bounces the named attacker back; frost makes the next spell cost more; meteor hits everyone else', () => {
  const { g, cast, w } = duel(['Ann', 'Ben', 'Cat']);
  cast('Ann', 'bolt', 'Ben'); cast('Ben', 'mirror', 'Ann'); cast('Cat', 'frost', 'Ann');
  // Cat has 2 sparks: frost costs 2.
  assert.strictEqual(w('Ben').hearts, 5, 'mirror: Ben untouched');
  assert.strictEqual(w('Ann').hearts, 5 - 2 - 1, 'Ann eats her own bolt and the frost');
  assert.strictEqual(w('Ann').frosted, true);
  g.nextRound(); g.event = 'still';
  // Ann: 2 sparks now (1 left + 1); frosted → bolt costs 2.
  const view = g.playerOnly('Ann').you;
  assert.strictEqual(view.spells.find((s) => s.id === 'bolt').cost, 2);
  g.destroy();
  const d = duel(['Ann', 'Ben', 'Cat', 'Dan']);
  d.w('Ann').sparks = 4;
  d.cast('Ann', 'meteor'); d.cast('Ben', 'shield'); d.cast('Cat', 'charge'); d.cast('Dan', 'charge');
  assert.deepStrictEqual(['Ann', 'Ben', 'Cat', 'Dan'].map((n) => d.w(n).hearts), [5, 5, 3, 3]);
  assert.strictEqual(d.w('Ann').sparks, 0);
  d.g.destroy();
});

test('knocked out → a ghost who still acts and scores; mend heals a friend; the bounty pays extra', () => {
  const { g, cast, w, score, players } = duel(['Ann', 'Ben', 'Cat']);
  w('Cat').hearts = 2;
  players.get('Ben').score = 500; // Ben leads → the bounty is on Ben next round
  cast('Ann', 'bolt', 'Cat'); cast('Ben', 'charge'); cast('Cat', 'charge');
  assert.strictEqual(w('Cat').ghost, true);
  assert.strictEqual(score('Ann'), 40 + 150, 'damage + knockout');
  g.nextRound(); g.event = 'still';
  assert.strictEqual(g.bounty, 'Ben');
  assert.deepStrictEqual(g.playerOnly('Cat').you.spells.map((s) => s.id), ['haunt', 'bless'], 'ghosts haunt or bless');
  cast('Cat', 'bolt', 'Ann'); // a ghost can't cast
  assert.ok(!g.picks.has('Cat'));
  w('Ann').sparks = 3;
  cast('Ann', 'bolt', 'Ben'); cast('Ben', 'mend', 'Ann'); cast('Cat', 'haunt', 'Ann');
  assert.strictEqual(score('Ann'), 190 + 40 + 50, 'hitting the bounty pays +50');
  assert.strictEqual(w('Ann').hearts, 5, 'Ben mended Ann (capped at 5)');
  assert.strictEqual(score('Ben'), 500 + 40, 'mending a friend: 20 a heart');
  assert.strictEqual(score('Cat'), 15, 'the ghost scores for a landed haunt');
  assert.strictEqual(w('Ann').sparks, 3 - 1 - 1, 'bolt cost + haunt');
  g.destroy();
});

test('the duel ends when one wizard is left: places pay 400 / 200 / 100', () => {
  const { g, cast, w, score } = duel(['Ann', 'Ben', 'Cat']);
  w('Ben').hearts = 1; w('Cat').hearts = 1; w('Ann').sparks = 4;
  cast('Ann', 'meteor'); cast('Ben', 'charge'); cast('Cat', 'charge');
  g.nextRound();
  assert.strictEqual(g.phase, 'wz-final');
  assert.deepStrictEqual([g.finalRows[0].nickname, g.finalRows.map((r) => r.place)], ['Ann', [1, 2, 3]]);
  assert.ok(g.finalRows.slice(1).every((r) => r.ghost));
  assert.strictEqual(score('Ann'), 2 * 40 + 2 * 150 + 400);
  g.destroy();
});

test('over sockets: picks stay secret until the reveal, the TV gets the beats in order', { timeout: 30000 }, async () => {
  const srv = await startServer({ RUMPUS_WZ_PICK_MS: '4000', RUMPUS_WZ_STEP_MS: '50', RUMPUS_WZ_FINAL_MS: '200', RUMPUS_WZ_ROUNDS: '1' });
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (const n of ['Ann', 'Ben', 'Cat']) ps.push(await makePlayer(srv, h.code, n));
    await until(() => h.state.players.length === 3, 'joined');
    h.emit('host:startGame', { gameId: 'wizards' });
    await until(() => ps.every((p) => p.state && p.state.phase === 'wz-pick'), 'pick');
    ps[0].submit({ spell: 'bolt', target: ps[1].id });
    await until(() => h.state.gameState.pickedCount === 1, 'one pick');
    assert.ok(!JSON.stringify(h.state).includes('"bolt"'), 'the TV does not see picks before the reveal');
    assert.ok(!JSON.stringify(ps[1].state).includes('"spell":"bolt"'), 'nor do other phones');
    ps[1].submit({ spell: 'shield' }); ps[2].submit({ spell: 'charge' });
    const rev = await until(() => h.state.phase === 'wz-reveal' && h.state, 'reveal');
    const kinds = rev.gameState.beats.map((b) => b.kind);
    assert.deepStrictEqual([kinds.slice(0, 2).sort(), kinds[2]], [['charge', 'shield'], 'blocked'], 'shields/charges first, then the blocked bolt');
    await h.phase('gameover', 8000);
  } finally { await srv.stop(); }
});
