// /admin: house rules (timers, 18+ share, banned words) and the content editor.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer, contentDir, get, tmpDir } = require('../helpers');

/** @param {string} url @param {string} p @param {any} body @param {string} [method] */
async function send(url, p, body, method = 'POST') {
  const r = await fetch(url + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

let srv;
test.before(async () => {
  srv = await startServer({
    RUMPUS_DATA_DIR: tmpDir(), RUMPUS_CONTENT_MODE: 'replace', RUMPUS_MR_ANSWER_MS: '20000',
    RUMPUS_CONTENT_DIR: contentDir({ mostlikely: [{ text: 'Who is most likely to built-in?' }], majority: [{ text: 'Name a thing' }] }),
  });
});
test.after(() => srv.stop());

test('house rules validate and persist: timers clamp, 18+ share clamps to 60%, banned words dedupe', async () => {
  const r = await send(srv.url, '/api/admin/rules', { timers: { majority: 2, trivia: 9, Bad: 2 }, spicyShare: 5, banned: ['Moose', 'moose', ' '] });
  assert.deepStrictEqual(r.body.rules.timers, { majority: 2 });
  assert.strictEqual(r.body.rules.spicyShare, 0.6);
  assert.deepStrictEqual(r.body.rules.banned, ['moose']);
  const back = JSON.parse((await get(srv.url, '/api/admin/rules')).body);
  assert.ok(back.games.length >= 10 && back.pools.includes('trivia'));
  await send(srv.url, '/api/admin/rules', { spicyShare: 0.3 });
});

test('banned words are masked in answers; per-game timer speed applies', async () => {
  const h = await makeHost(srv);
  const ps = [];
  for (const n of ['Ann', 'Ben', 'Cat']) ps.push(await makePlayer(srv, h.code, n));
  await until(() => h.state.players.length === 3, 'joined');
  h.emit('host:startGame', { gameId: 'majority' });
  await until(() => h.state.phase === 'mr-answer', 'answering');
  const left = h.state.gameState.endsAt - Date.now();
  assert.ok(left > 30000, `majority timer doubled by house rules (${left} ms left)`);
  for (const p of ps) p.submit({ text: 'a big moose' });
  for (const p of ps) p.submit({ bet: 2 });
  const rev = await h.phase('mr-reveal');
  assert.strictEqual(rev.gameState.result.groups[0].label, 'a big m★★★e');
  await send(srv.url, '/api/admin/rules', { timers: {}, banned: [] });
});

test('content editor: add your own prompt, disable built-ins, delete yours; bad input explains itself', async () => {
  const bad = await send(srv.url, '/api/admin/content/fibbage', { q: 'no blank here', answer: 'x' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.body.error, /blank/);
  const added = await send(srv.url, '/api/admin/content/mostlikely', { text: 'Who is most likely to yours?' });
  assert.ok(added.body.item.id);
  const list = JSON.parse((await get(srv.url, '/api/admin/content/mostlikely')).body);
  assert.strictEqual(list.total, 2);
  const builtIn = list.items.find((x) => !x.custom);
  await send(srv.url, `/api/admin/content/mostlikely/${builtIn.id}/disabled`, { disabled: true });
  // The next game can only draw the custom prompt now.
  const h = await makeHost(srv);
  for (const n of ['Dee', 'Eve', 'Fay']) await makePlayer(srv, h.code, n);
  await until(() => h.state.players.length === 3, 'joined');
  h.emit('host:startGame', { gameId: 'mostlikely' });
  const v = await h.phase('ml-vote');
  assert.strictEqual(v.gameState.prompt, 'Who is most likely to yours?');
  const del = await send(srv.url, `/api/admin/content/mostlikely/${added.body.item.id}`, {}, 'DELETE');
  assert.strictEqual(del.body.ok, true);
  const trivia = await send(srv.url, '/api/admin/content/trivia', { q: 'Best lake?', answer: 'Ours', wrong: ['A', 'B', 'C'] });
  assert.strictEqual(trivia.body.item.choices[trivia.body.item.correct], 'Ours');
  assert.strictEqual((await get(srv.url, '/admin.html')).status, 200);
});
