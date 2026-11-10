// Storm Watch: roles per player count, who knows what, crews/votes/cards, events, one-off powers,
// win conditions, accusations, and that no screen ever leaks a role or a card.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer, sleep } = require('../helpers');
const Storm = require('../../games/storm');

test('role decks: raccoon count by player count, special roles unlock with more players', () => {
  const count = (n, side) => Storm.roleDeck(n).filter((r) => Storm.ROLES[r].side === side).length;
  assert.deepStrictEqual([4, 5, 6, 8, 9, 12].map((n) => count(n, 'raccoon')), [1, 1, 2, 2, 3, 3]);
  for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 12]) assert.strictEqual(Storm.roleDeck(n).length, n);
  assert.ok(Storm.roleDeck(4).includes('lookout') && !Storm.roleDeck(4).includes('handyman'));
  assert.ok(Storm.roleDeck(5).includes('handyman') && !Storm.roleDeck(5).includes('snoop'));
  assert.ok(Storm.roleDeck(6).includes('snoop') && Storm.roleDeck(6).includes('sly'));
  assert.ok(Storm.crewSizes(4).every((s) => s >= 2 && s <= 3));
  assert.ok(Storm.crewSizes(12).every((s) => s <= 5));
});

const ENV = { RUMPUS_ST_ROLES_MS: '3000', RUMPUS_ST_TALK_MS: '4000', RUMPUS_ST_VOTE_MS: '4000', RUMPUS_ST_VOTE_SHOW_MS: '100', RUMPUS_ST_CREW_MS: '4000', RUMPUS_ST_CARD_MS: '30', RUMPUS_ST_ACCUSE_MS: '4000', RUMPUS_ST_FINAL_MS: '200' };

async function game(names) {
  const srv = await startServer(ENV);
  const h = await makeHost(srv);
  const ps = [];
  for (const n of names) ps.push(await makePlayer(srv, h.code, n));
  await until(() => h.state.players.length === names.length, 'joined');
  h.emit('host:startGame', { gameId: 'storm' });
  await until(() => ps.every((p) => p.state && p.state.phase === 'st-roles' && p.state.you.role), 'roles dealt');
  return { srv, h, ps };
}
const sideOf = (p) => p.state.you.role.side;

test('who knows what: raccoons see each other, the Lookout sees one non-Sly raccoon, nobody else learns roles; nothing leaks to the TV', async () => {
  const { srv, h, ps } = await game(['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus']);
  try {
    const rac = ps.filter((p) => sideOf(p) === 'raccoon');
    assert.strictEqual(rac.length, 2);
    for (const r of rac) assert.deepStrictEqual(r.state.you.allies, rac.filter((x) => x !== r).map((x) => x.nickname));
    const look = ps.find((p) => p.state.you.role.id === 'lookout');
    const sly = ps.find((p) => p.state.you.role.id === 'sly');
    assert.ok(look && sly);
    assert.ok(rac.map((r) => r.nickname).includes(look.state.you.spotted), 'the Lookout saw a raccoon');
    assert.notStrictEqual(look.state.you.spotted, sly.nickname, '…never the Sly one');
    for (const p of ps.filter((x) => sideOf(x) === 'cottage' && x !== look)) assert.deepStrictEqual([p.state.you.allies, p.state.you.spotted], [[], null]);
    const tv = JSON.stringify(h.state);
    for (const word of ['"Raccoon"', 'Lookout', 'Sly Raccoon', 'Handyman', 'Snoop', '"cards"', '"roles":[']) assert.ok(!tv.includes(word), `TV must not show ${word}`);
  } finally { await srv.stop(); }
});

test('a chore: leader picks a valid crew, the vote is secret then shown, cottagers can only help, raccoons can sabotage; three ruined → raccoons win; accusations pay', { timeout: 60000 }, async () => {
  const { srv, h, ps } = await game(['Ann', 'Ben', 'Cat', 'Dan']);
  try {
    for (const p of ps) p.submit({ ready: true });
    let ruined = 0;
    while (ruined < 3) {
      const st = await until(() => h.state.phase === 'st-talk' && h.state, 'talk', 8000);
      const g = st.gameState;
      const leader = ps.find((p) => p.nickname === g.leader);
      await until(() => leader.state.phase === 'st-talk' && leader.state.you.candidates.length, 'leader screen');
      const rac = ps.find((p) => sideOf(p) === 'raccoon');
      // Always put the raccoon on the crew, plus fill with others.
      const crew = [rac.id, ...leader.state.you.candidates.map((c) => c.id).filter((id) => id !== rac.id)].slice(0, g.crewSize);
      const other = ps.find((p) => p !== leader);
      other.submit({ crew }); // not the leader → ignored
      leader.submit({ crew: crew.slice(0, g.crewSize - 1) }); // wrong size → ignored
      await sleep(60);
      assert.strictEqual(h.state.phase, 'st-talk');
      leader.submit({ crew });
      await until(() => h.state.phase === 'st-vote', 'vote');
      ps[0].submit({ vote: true });
      await until(() => h.state.gameState.votedCount === 1, 'one vote');
      assert.strictEqual(h.state.gameState.votes, null, 'votes stay hidden until everyone voted');
      for (const p of ps.slice(1)) p.submit({ vote: true });
      const shown = await until(() => h.state.phase === 'st-votes' && h.state, 'votes shown');
      assert.strictEqual(shown.gameState.votes.approved, true);
      if (shown.gameState.event.id !== 'outage') assert.strictEqual(shown.gameState.votes.list.length, 4);
      else assert.strictEqual(shown.gameState.votes.list, null, 'Power Outage: totals only');
      await until(() => h.state.phase === 'st-crew', 'crew');
      for (const p of ps) if (crew.includes(p.id)) p.submit({ card: 'sabotage' }); // cottagers' sabotage becomes help
      const rev = await until(() => h.state.phase === 'st-reveal' && h.state, 'reveal');
      const r = rev.gameState.reveal;
      assert.strictEqual(r.cards.filter((c) => c === 'sabotage').length, 1, 'only the raccoon could sabotage');
      if (!r.ok) ruined++;
    }
    await until(() => h.state.phase === 'st-accuse', 'accuse', 8000);
    assert.strictEqual(h.state.gameState.winner, 'raccoon');
    const rac = ps.find((p) => sideOf(p) === 'raccoon');
    for (const p of ps) p.submit({ accuse: p === rac ? ps.find((x) => x !== rac).id : rac.id });
    const fin = await until(() => h.state.phase === 'st-final' && h.state, 'final', 8000);
    const roles = fin.gameState.roles;
    assert.strictEqual(roles.length, 4, 'roles flip on the TV at the end');
    const gain = (n) => roles.find((x) => x.nickname === n).gained;
    assert.strictEqual(gain(rac.nickname), 500, 'winning side +500 (accused → no unseen bonus)');
    for (const p of ps.filter((x) => x !== rac)) assert.strictEqual(gain(p.nickname), 100, 'right accusation +100');
  } finally { await srv.stop(); }
});

test('three crews voted down in a row: the storm wins it for the raccoons', { timeout: 60000 }, async () => {
  const { srv, h, ps } = await game(['Ann', 'Ben', 'Cat', 'Dan']);
  try {
    for (const p of ps) p.submit({ ready: true });
    for (let k = 0; k < 3; k++) {
      const st = await until(() => h.state.phase === 'st-talk' && h.state, 'talk', 8000);
      const leader = ps.find((p) => p.nickname === st.gameState.leader);
      await until(() => leader.state.phase === 'st-talk' && leader.state.you.candidates.length, 'leader screen');
      leader.submit({ crew: leader.state.you.candidates.slice(0, st.gameState.crewSize).map((c) => c.id) });
      await until(() => h.state.phase === 'st-vote', 'vote');
      for (const p of ps) p.submit({ vote: false });
      await until(() => h.state.phase === 'st-votes', 'shown');
      if (h.state.gameState.event.id === 'wind') k--; // Second Wind: no storm this time
    }
    await until(() => h.state.phase === 'st-accuse', 'accuse', 8000);
    assert.strictEqual(h.state.gameState.winner, 'raccoon');
    assert.match(h.state.gameState.winReason, /storm/);
  } finally { await srv.stop(); }
});
