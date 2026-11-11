// Storm Watch: roles per player count, who knows what, crews/votes/cards, events, one-off powers,
// win conditions, accusations, and that no screen ever leaks a role or a card.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer, sleep } = require('../helpers');
const Storm = require('../../games/storm');

test('role decks: raccoon count by player count, special roles unlock with more players', () => {
  const count = (n, side) => Storm.roleDeck(n).filter((r) => Storm.ROLES[r].side === side).length;
  assert.deepStrictEqual([4, 5, 6, 7, 8, 9, 12].map((n) => count(n, 'raccoon')), [1, 2, 2, 2, 3, 3, 3]);
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

test('who knows what: raccoons see each other, the Lookout sees two names (one a non-Sly raccoon), nobody else learns roles; nothing leaks to the TV', async () => {
  const { srv, h, ps } = await game(['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus']);
  try {
    const rac = ps.filter((p) => sideOf(p) === 'raccoon');
    assert.strictEqual(rac.length, 2);
    for (const r of rac) assert.deepStrictEqual(r.state.you.allies, rac.filter((x) => x !== r).map((x) => x.nickname));
    const look = ps.find((p) => p.state.you.role.id === 'lookout');
    const sly = ps.find((p) => p.state.you.role.id === 'sly');
    assert.ok(look && sly);
    const seen = look.state.you.sighting;
    assert.strictEqual(seen.length, 2, 'two suspects');
    assert.strictEqual(seen.filter((n) => rac.map((r) => r.nickname).includes(n)).length, 1, 'exactly one of them is a raccoon');
    assert.ok(!seen.includes(sly.nickname), '…never the Sly one');
    assert.ok(!seen.includes(look.nickname), '…and never themselves');
    for (const p of ps.filter((x) => sideOf(x) === 'cottage' && x !== look)) assert.deepStrictEqual([p.state.you.allies, p.state.you.sighting], [[], []]);
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
      // Put the raccoon on the crew when allowed (Bear Sighting can bar last chore's crew), fill with others.
      const allowed = leader.state.you.candidates.map((c) => c.id);
      const crew = [...(allowed.includes(rac.id) ? [rac.id] : []), ...allowed.filter((id) => id !== rac.id)].slice(0, g.crewSize);
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
      assert.strictEqual(r.cards.filter((c) => c === 'sabotage').length, crew.includes(rac.id) ? 1 : 0, 'only the raccoon could sabotage');
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

test('raccoon powers: Double Trouble beats a Big Chore and Fix It; if the cottage wins, unmasking the Lookout steals it', { timeout: 60000 }, async () => {
  const { srv, h, ps } = await game(['Ann', 'Ben', 'Cat', 'Dan']);
  try {
    for (const p of ps) p.submit({ ready: true });
    const rac = ps.find((p) => sideOf(p) === 'raccoon');
    const look = ps.find((p) => p.state.you.role.id === 'lookout');
    let doubled = false, done = 0;
    // Play chores: the raccoon stays off the crew (so the cottage wins) except once, to use Double Trouble.
    while (!h.state.gameState.winner && h.state.phase !== 'st-accuse') {
      const st = await until(() => (h.state.phase === 'st-talk' || h.state.phase === 'st-accuse') && h.state, 'talk', 8000);
      if (st.phase === 'st-accuse') break;
      const leader = ps.find((p) => p.nickname === st.gameState.leader);
      await until(() => leader.state.phase === 'st-talk' && leader.state.you.candidates.length, 'leader screen');
      const allowed = leader.state.you.candidates.map((c) => c.id);
      const withRac = !doubled && allowed.includes(rac.id);
      const crew = (withRac ? [rac.id, ...allowed.filter((id) => id !== rac.id)] : allowed.filter((id) => id !== rac.id)).slice(0, st.gameState.crewSize);
      if (crew.length < st.gameState.crewSize) crew.push(...allowed.filter((id) => !crew.includes(id)).slice(0, st.gameState.crewSize - crew.length));
      leader.submit({ crew });
      await until(() => h.state.phase === 'st-vote', 'vote');
      for (const p of ps) p.submit({ vote: true });
      await until(() => h.state.phase === 'st-crew', 'crew');
      const onCrew = ps.filter((p) => crew.includes(p.id));
      await until(() => onCrew.every((p) => p.state.phase === 'st-crew'), 'crew phones');
      for (const p of onCrew) {
        if (p === rac && !doubled) { assert.ok(p.state.you.canDouble); p.submit({ card: 'sabotage', double: true }); doubled = true; }
        else p.submit({ card: 'help', fix: true });
      }
      const rev = await until(() => h.state.phase === 'st-reveal' && h.state, 'reveal');
      const r = rev.gameState.reveal;
      if (r.cards.includes('double')) {
        assert.strictEqual(r.ok, false, 'Double Trouble ruins even a Big Chore, whatever the Handyman does');
        assert.strictEqual(r.fixed, false, "Fix It can't touch it");
      } else if (r.ok) done++;
    }
    await until(() => h.state.phase === 'st-accuse', 'accuse', 8000);
    if (h.state.gameState.winner === 'cottage') {
      assert.ok(h.state.gameState.hunt, 'the raccoons get their last chance');
      await until(() => rac.state.you.hunting, 'raccoon hunts the Lookout');
      for (const p of ps) p.submit({ accuse: p === rac ? look.id : rac.id });
      const fin = await until(() => h.state.phase === 'st-final' && h.state, 'final', 8000);
      assert.strictEqual(fin.gameState.winner, 'raccoon', 'unmasked the Lookout → stolen');
      assert.ok(fin.gameState.stolen);
      const gain = (n) => fin.gameState.roles.find((x) => x.nickname === n).gained;
      assert.strictEqual(gain(rac.nickname), 500 + 150, 'win + unmask bonus (accused → no unseen bonus)');
    }
    assert.ok(done <= 3);
  } finally { await srv.stop(); }
});

test('a private hunch during the talk: anyone but the leader, changeable, never shown to others, revealed (right or wrong) at the end', { timeout: 60000 }, async () => {
  const { srv, h, ps } = await game(['Ann', 'Ben', 'Cat', 'Dan', 'Eve']);
  try {
    for (const p of ps) p.submit({ ready: true });
    await until(() => ps.every((p) => p.state.phase === 'st-talk'), 'talk');
    const leader = ps.find((p) => p.state.you.isLeader);
    const others = ps.filter((p) => p !== leader);
    assert.deepStrictEqual(leader.state.you.hunchTargets, [], 'the leader is busy picking');
    const [a, b] = others;
    assert.strictEqual(a.state.you.hunchTargets.length, 4, 'everyone but yourself');
    const idOf = (/** @type {any} */ p) => a.state.you.hunchTargets.find((/** @type {any} */ t) => t.nickname === p.nickname).id;
    a.submit({ hunch: a.state.you.hunchTargets.find((/** @type {any} */ t) => t.nickname === b.nickname).id });
    a.submit({ hunch: 'nobody' }); // not a player: ignored
    leader.submit({ hunch: idOf(b) }); // the leader can't
    await until(() => a.state.you.hunch !== null, 'hunch stored');
    const rac = ps.find((p) => sideOf(p) === 'raccoon');
    const target = rac === a ? b : rac;
    a.submit({ hunch: a.state.you.hunchTargets.find((/** @type {any} */ t) => t.nickname === target.nickname).id }); // changed mind
    await until(() => a.state.you.hunch === a.state.you.hunchTargets.find((/** @type {any} */ t) => t.nickname === target.nickname).id, 'hunch changed');
    assert.strictEqual(leader.state.you.hunch, null);
    // Nobody else (TV included) sees it during the game.
    assert.ok(!JSON.stringify(h.state.gameState).includes('hunch'), 'not on the TV');
    for (const p of ps.filter((x) => x !== a)) assert.strictEqual(p.state.you.hunch, null);
    // Play it out on timers (no crew picked → random crew; votes/cards time out) until the end.
    h.emit('host:endGame');
    await h.phase('lobby', 5000);
  } finally { await srv.stop(); }
});

test('hunches are revealed on the final screen with whether they were right', () => {
  const room = { players: new Map(), settings: {} };
  for (const [i, n] of ['Ann', 'Ben', 'Cat', 'Dan'].entries()) room.players.set(`p${i}`, { id: `p${i}`, nickname: n, score: 0, connected: true });
  const g = new Storm(/** @type {any} */ (room), () => {});
  g.start();
  const ids = [...room.players.keys()];
  const rac = ids.find((id) => g.side(id) === 'raccoon');
  const cot = ids.filter((id) => g.side(id) === 'cottage');
  g.nextChore();
  const voters = ids.filter((id) => id !== g.leader());
  const right = voters.find((id) => id !== rac);
  const wrong = voters.find((id) => id !== rac && id !== right);
  g.handleSubmit(right, { hunch: rac });
  g.handleSubmit(wrong, { hunch: cot.find((id) => id !== wrong) });
  g.winner = 'cottage'; g.lookoutId = null;
  g.toAccuse(); g.final();
  const roles = g.hostView().roles;
  const by = (/** @type {string} */ id) => roles.find((/** @type {any} */ r) => r.nickname === room.players.get(id).nickname);
  assert.strictEqual(by(right).hunch, room.players.get(rac).nickname);
  assert.strictEqual(by(right).hunchRight, true);
  assert.strictEqual(by(wrong).hunchRight, false);
  assert.strictEqual(by(g.leader()).hunch, null, 'no hunch, nothing shown');
  g.destroy();
});
