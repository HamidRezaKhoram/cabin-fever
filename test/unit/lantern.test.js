// Lantern Lake (tilt): input cleaning, glide physics, bumps, scoring per scene, the raft follows
// the room's average tilt, and frames stream to the TV only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer } = require('../helpers');
const Lantern = require('../../games/lantern');

test('tilt input: unit disc, dead-zone, junk rejected', () => {
  assert.deepStrictEqual(Lantern.cleanTilt([3, 4]), [0.6, 0.8]);
  assert.deepStrictEqual(Lantern.cleanTilt([0.02, -0.03]), [0, 0]);
  for (const junk of [null, 'x', [1], [NaN, 0], [1, 2, 3]]) assert.strictEqual(Lantern.cleanTilt(junk), null);
});

test('physics: boats glide with inertia, slow down when flat, bounce off the shore', () => {
  const b = { x: 100, y: 90, vx: 0, vy: 0 };
  for (let i = 0; i < 10; i++) Lantern.stepBody(b, [1, 0], 0.42, 7);
  assert.ok(b.vx > 2 && b.x > 110, 'speeds up');
  const v = b.vx;
  Lantern.stepBody(b, [0, 0], 0.42, 7);
  assert.ok(b.vx < v && b.vx > 0, 'glides on when you stop tilting');
  const w = { x: 315, y: 90, vx: 4, vy: 0 };
  assert.ok(Lantern.stepBody(w, [1, 0], 0.42, 7), 'hit the shore');
  assert.ok(w.vx < 0 && w.x <= 313);
  const a = { x: 100, y: 100, vx: 3, vy: 0 }, c = { x: 112, y: 100, vx: 0, vy: 0 };
  assert.ok(Lantern.collide(a, c, 7), 'bump');
  assert.ok(c.vx > 2 && a.vx < 1, 'the hit boat flies off');
});

test('a full game over sockets: catch fireflies, the moonbeam pays, the raft follows the average tilt; the TV gets frames', { timeout: 60000 }, async () => {
  const srv = await startServer({ RUMPUS_LL_INTRO_MS: '200', RUMPUS_LL_PLAY_MS: '3000', RUMPUS_LL_RESULT_MS: '200', RUMPUS_LL_ORDER: 'fireflies,moonbeam,raft' });
  try {
    const h = await makeHost(srv);
    let frames = 0, last = null;
    h.sock.on('room:frame', (f) => { frames++; last = f; });
    const ann = await makePlayer(srv, h.code, 'Ann');
    const ben = await makePlayer(srv, h.code, 'Ben');
    let phoneFrames = 0;
    ann.sock.on('room:frame', () => { phoneFrames++; });
    await until(() => h.state.players.length === 2, 'joined');
    h.emit('host:startGame', { gameId: 'lantern' });
    await h.phase('ll-play', 5000);
    // Steer Ann toward her nearest firefly until she catches some.
    const steer = (p) => { const y = p.state.you; if (y.pos && y.target) { const dx = y.target[0] - y.pos[0], dy = y.target[1] - y.pos[1], m = Math.hypot(dx, dy) || 1; p.submit({ tilt: [dx / m, dy / m] }); } };
    const t1 = setInterval(() => steer(ann), 60); t1.unref();
    ann.submit({ tilt: 'junk' });
    await until(() => ann.state.you.gained >= 20, 'Ann catches a firefly', 6000);
    clearInterval(t1);
    await until(() => frames > 20, `TV streams real-time frames (${frames} so far)`, 3000);
    assert.strictEqual(phoneFrames, 0, 'phones never get the frame stream');
    assert.strictEqual(last.boats.length, 2);
    assert.strictEqual(last.scene, 'fireflies');
    // Moonbeam (×2): Ben chases the moon and scores while inside it.
    await until(() => h.state.phase === 'll-play' && h.state.gameState.scene === 'moonbeam', 'moonbeam', 8000);
    const t2 = setInterval(() => steer(ben), 60); t2.unref();
    await until(() => ben.state.you.gained > 0, 'Ben scores in the moonbeam', 6000);
    clearInterval(t2);
    assert.strictEqual(ben.state.you.gained % 2, 0, 'scene 2 points are doubled');
    // Raft (×3): both tilt the same way → the raft moves that way.
    await until(() => h.state.phase === 'll-play' && h.state.gameState.scene === 'raft' && last && last.raft, 'raft', 8000);
    const x0 = last.raft[0];
    ann.submit({ tilt: [1, 0] }); ben.submit({ tilt: [1, 0] });
    await until(() => last.raft[0] > x0 + 20, 'raft moves right with the room', 3000);
    ann.submit({ tilt: [-1, 0] }); // pulling against each other cancels out
    const x1 = last.raft[0];
    await until(() => Math.abs(last.raft[2]) < 0.3, 'tug of war stops the raft', 3000);
    assert.ok(last.raft[0] - x1 < 40);
    await h.phase('gameover', 10000);
  } finally {
    await srv.stop();
  }
});

test('https twin: a self-signed certificate is made once and the same app answers on https', async () => {
  const srv = await startServer({ RUMPUS_HTTPS_PORT: '0' });
  try {
    let info = null;
    for (let i = 0; i < 80 && !(info && info.httpsPort); i++) {
      info = await fetch(srv.url + '/api/info').then((x) => x.json());
      if (!info.httpsPort) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(info && info.httpsPort, 'https twin is listening (needs openssl)');
    const https = require('https');
    const port = info.httpsPort;
    const body = await new Promise((resolve, reject) => {
      https.get({ host: '127.0.0.1', port, path: '/play', rejectUnauthorized: false }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve(d)); }).on('error', reject);
    });
    assert.match(String(body), /join-form/);
  } finally {
    await srv.stop();
  }
});

/** A game on a fake room, driven tick by tick (no sockets, no timers running). @param {string} scene */
function sceneGame(scene) {
  const room = { players: new Map([['a', { id: 'a', nickname: 'Ann', score: 0 }], ['b', { id: 'b', nickname: 'Ben', score: 0 }]]), settings: {} };
  const g = new Lantern(/** @type {any} */ (room), () => {});
  g.scenes = [scene];
  g.nextRound();
  g.clearTimer();
  g.phase = 'll-play';
  return { g, room };
}

test('Lily Pad Tag: bumping "it" passes it on (no instant tag-backs); points while you are not it', () => {
  const { g, room } = sceneGame('tag');
  try {
    g.it = 'a';
    g.tagCooldown = 0;
    Object.assign(g.boats.get('a'), { x: 100, y: 90, vx: 1, vy: 0 });
    Object.assign(g.boats.get('b'), { x: 108, y: 90, vx: 0, vy: 0 });
    g.tick();
    assert.strictEqual(g.it, 'b', 'tagged');
    g.tick(); // still touching: the cooldown stops a tag-back
    assert.strictEqual(g.it, 'b');
    for (let i = 0; i < 60; i++) g.tick();
    assert.ok(room.players.get('a').score > 0 && room.players.get('b').score < room.players.get('a').score, 'not-it earns');
  } finally { g.destroy(); }
});

test('Shrinking Pad: off the pad = splash; the last boat floating wins the survivor bonus', () => {
  const { g, room } = sceneGame('sumo');
  try {
    Object.assign(g.boats.get('a'), { x: 160, y: 90 });
    Object.assign(g.boats.get('b'), { x: 300, y: 20 }); // way off the pad
    g.tick();
    assert.ok(g.out.has('b'));
    assert.strictEqual(g.phase, 'll-result', 'one left → the scene ends');
    assert.ok(room.players.get('a').score >= 60);
    assert.strictEqual(room.players.get('b').score, 0);
  } finally { g.destroy(); }
});

test('Duckling Herding: a duckling in the nest scores for the last boat that touched it, and a new one paddles in', () => {
  const { g, room } = sceneGame('herd');
  try {
    assert.strictEqual(g.ducks.length, 5);
    g.ducks[0] = { x: 160, y: 90, vx: 0, vy: 0, last: 'b' };
    g.tick();
    assert.strictEqual(room.players.get('b').score, 40);
    assert.strictEqual(g.ducks.length, 5, 'replaced');
    assert.ok(Math.hypot(g.ducks[0].x - 160, g.ducks[0].y - 90) > 20, 'the new one starts at the shore');
  } finally { g.destroy(); }
});

test('a game plays four of the six scenes by default, always including one raft run', () => {
  const room = { players: new Map([['a', { id: 'a', nickname: 'Ann', score: 0 }]]), settings: {} };
  const g = new Lantern(/** @type {any} */ (room), () => {});
  assert.strictEqual(g.scenes.length, 4);
  assert.ok(g.scenes.includes('raft'));
  assert.strictEqual(new Set(g.scenes).size, 4);
});
