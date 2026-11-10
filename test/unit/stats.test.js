// Persistent stats, achievements and highlights (games/stats.js, /api/highlights).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, until, makeHost, makePlayer, contentDir, get, tmpDir } = require('../helpers');

test('a finished Fish Tales round records the best lie, people fooled and the game for each player', async () => {
  const dataDir = tmpDir();
  const srv = await startServer({
    RUMPUS_DATA_DIR: dataDir, RUMPUS_CONTENT_MODE: 'replace',
    RUMPUS_CONTENT_DIR: contentDir({ fibbage: [{ q: 'The capital of Fooland is ____.', answer: 'Truthy' }] }),
  });
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (const n of ['Ann', 'Ben', 'Cat']) ps.push(await makePlayer(srv, h.code, n));
    await until(() => h.state && h.state.players.length === 3, 'joined');
    h.emit('host:startGame', { gameId: 'fibbage' });
    await until(() => ps.every((p) => p.state && p.state.phase === 'fib-bluff'), 'bluff');
    ps[0].submit({ text: 'Moose Town' }); ps[1].submit({ text: 'Lie B' }); ps[2].submit({ text: 'Lie C' });
    await until(() => ps.every((p) => p.state.phase === 'fib-choose'), 'choose');
    const opt = (p, t) => p.state.gameState.options.find((o) => o.text === t).index;
    ps[1].submit({ choice: opt(ps[1], 'Moose Town') }); ps[2].submit({ choice: opt(ps[2], 'Moose Town') });
    ps[0].submit({ choice: opt(ps[0], 'Truthy') });
    await until(() => h.state.phase === 'gameover', 'game over', 15000);
    const d = JSON.parse((await get(srv.url, '/api/highlights?room=' + h.code)).body);
    const hl = d.tonight.find((x) => x.game === 'Fish Tales');
    assert.ok(hl && hl.text === 'Moose Town' && hl.by === 'Ann' && /fooled 2/.test(hl.note), JSON.stringify(d.tonight));
    const ann = d.players.find((p) => p.name === 'Ann');
    assert.strictEqual(ann.games, 1);
    assert.strictEqual(ann.fooled, 2);
    assert.strictEqual(ann.wins, 1, 'Ann won (1000 truth + 1000 fooled)');
    assert.ok(ann.achievements.some((a) => a.title === 'First blood'));
    assert.strictEqual(d.players.length, 3);
    // It's persisted for next time.
    await until(() => fs.existsSync(path.join(dataDir, 'stats.json')), 'stats saved', 5000);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, 'stats.json'), 'utf8')).players.ann);
  } finally { await srv.stop(); }
});

test('bots never collect stats; the highlights page is served', async () => {
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    h.emit('host:addBots', { count: 3, speed: 20 });
    await until(() => h.state && h.state.players.length === 3, 'bots');
    h.emit('host:startGame', { gameId: 'closest' });
    await until(() => h.state.phase === 'gameover', 'game over', 30000);
    const d = JSON.parse((await get(srv.url, '/api/highlights?room=' + h.code)).body);
    assert.deepStrictEqual(d.players, []);
    const page = await get(srv.url, '/highlights.html');
    assert.strictEqual(page.status, 200);
    assert.match(page.body, /Hall of fame/);
  } finally { await srv.stop(); }
});
