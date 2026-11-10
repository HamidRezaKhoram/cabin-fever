'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer, joinError, contentDir } = require('../helpers');

let srv;
before(async () => { srv = await startServer({ RUMPUS_CONTENT_DIR: contentDir({ closest: [{ q: 'N?', answer: 10 }] }), RUMPUS_CONTENT_MODE: 'replace' }); });
after(() => srv.stop());

async function room(n) {
  const h = await makeHost(srv);
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(await makePlayer(srv, h.code, 'P' + i));
  await until(() => h.state.players.length === n, 'joined');
  return { h, ps };
}
const count = (h, t) => h.state.players.filter((p) => p.team === t).length;

test('teams off by default; turning on splits players evenly into red and blue', async () => {
  const { h } = await room(5);
  assert.strictEqual(h.state.teamScores, null);
  assert.ok(h.state.players.every((p) => p.team === null));
  h.emit('host:settings', { teams: true });
  await until(() => h.state.settings.teams && h.state.players.every((p) => p.team), 'teams on');
  assert.ok(Math.abs(count(h, 'red') - count(h, 'blue')) <= 1);
  assert.deepStrictEqual(h.state.teamScores, { red: 0, blue: 0 });
});

test('late joiners go to the smaller team; players can switch in the lobby only', async () => {
  const { h, ps } = await room(3);
  h.emit('host:settings', { teams: true });
  await until(() => h.state.players.every((p) => p.team), 'teams');
  const smaller = count(h, 'red') < count(h, 'blue') ? 'red' : 'blue';
  const late = await makePlayer(srv, h.code, 'Late');
  await until(() => h.state.players.length === 4, 'late joined');
  assert.strictEqual(h.state.players.find((p) => p.nickname === 'Late').team, smaller);
  const p0 = h.state.players.find((p) => p.nickname === 'P0');
  const other = p0.team === 'red' ? 'blue' : 'red';
  ps[0].sock.emit('player:team', { team: other });
  await until(() => h.state.players.find((p) => p.nickname === 'P0').team === other, 'switched');
  ps[0].sock.emit('player:team', { team: 'green' }); // invalid
  h.emit('host:startGame', { gameId: 'closest' });
  await h.phase('cg-guess');
  ps[0].sock.emit('player:team', { team: p0.team }); // not allowed mid-game
  for (const p of [...ps, late]) p.submit({ number: 10 });
  await h.phase('cg-reveal');
  assert.strictEqual(h.state.players.find((p) => p.nickname === 'P0').team, other);
});

test('team score is the sum of its players', async () => {
  const { h, ps } = await room(4);
  h.emit('host:settings', { teams: true });
  await until(() => h.state.players.every((p) => p.team), 'teams');
  h.emit('host:startGame', { gameId: 'closest' });
  await h.phase('cg-guess');
  ps.forEach((p, i) => p.submit({ number: 10 + i * 5 }));
  await h.phase('cg-reveal');
  const sum = (t) => h.state.players.filter((p) => p.team === t).reduce((n, p) => n + p.score, 0);
  assert.deepStrictEqual(h.state.teamScores, { red: sum('red'), blue: sum('blue') });
  assert.ok(sum('red') + sum('blue') > 0);
});

test('Punchline matchups are red vs blue in team mode', async () => {
  const { h, ps } = await room(4);
  h.emit('host:settings', { teams: true });
  await until(() => h.state.players.every((p) => p.team), 'teams');
  h.emit('host:startGame', { gameId: 'quiplash' });
  await h.phase('answering');
  for (let k = 0; k < 2; k++) for (const p of ps) {
    await until(() => p.state.you.submitted || p.state.gameState.promptNumber === k + 1 || p.state.phase !== 'answering', 'prompt');
    if (p.state.phase === 'answering' && !p.state.you.submitted) p.submit({ text: 'x' + k });
  }
  for (let m = 0; m < 4; m++) {
    await until(() => h.state.phase === 'voting' && h.state.gameState.matchIndex === m, 'matchup ' + m);
    await until(() => ps.every((p) => p.state.phase === 'voting' && p.state.gameState.prompt === h.state.gameState.prompt), 'phones');
    const authors = ps.filter((p) => p.state.you.isAuthor).map((p) => h.state.players.find((x) => x.id === p.id).team);
    assert.deepStrictEqual(authors.sort(), ['blue', 'red'], 'one red and one blue author');
    h.emit('host:skip');
    await until(() => h.state.phase === 'results', 'results');
    h.emit('host:skip');
  }
});
