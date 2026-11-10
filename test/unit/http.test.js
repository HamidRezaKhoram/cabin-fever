'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, get, tmpDir } = require('../helpers');

let srv;
let musicDir;
before(async () => {
  musicDir = tmpDir('rumpus-music-');
  fs.writeFileSync(path.join(musicDir, 'b song.mp3'), 'ID3fake');
  fs.writeFileSync(path.join(musicDir, 'a.ogg'), 'OggS');
  fs.writeFileSync(path.join(musicDir, 'notes.txt'), 'not music');
  srv = await startServer({ RUMPUS_MUSIC_DIR: musicDir });
});
after(() => srv.stop());

test('/ redirects to /play', async () => {
  const r = await get(srv.url, '/');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.location, '/play');
});

test('/host and /play serve the TV and phone pages', async () => {
  for (const [p, marker] of [['/host', 'start-overlay'], ['/play', 'join-form']]) {
    const r = await get(srv.url, p);
    assert.strictEqual(r.status, 200);
    assert.match(r.headers['content-type'], /html/);
    assert.ok(r.body.includes(marker), `${p} missing ${marker}`);
  }
});

test('every script and stylesheet referenced by the pages is served', async () => {
  for (const page of ['/host', '/play']) {
    const html = (await get(srv.url, page)).body;
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 5);
    for (const ref of refs) {
      const r = await get(srv.url, ref);
      assert.strictEqual(r.status, 200, `${page} → ${ref} returned ${r.status}`);
    }
  }
});

test('pages load nothing from the internet (offline-safe)', async () => {
  for (const page of ['/host', '/play', '/style.css', '/host.js', '/play.js', '/common.js', '/music.js']) {
    const body = (await get(srv.url, page)).body;
    assert.ok(!/(src|href)=["']https?:\/\//.test(body), `${page} references an external URL`);
    assert.ok(!/url\(["']?https?:/.test(body), `${page} has an external CSS url()`);
  }
});

test('pixel fonts are bundled and served', async () => {
  for (const f of ['/fonts/PressStart2P-Regular.ttf', '/fonts/VT323-Regular.ttf']) {
    const r = await get(srv.url, f);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.length > 10000);
  }
});

test('/api/info reports LAN addresses', async () => {
  const info = JSON.parse((await get(srv.url, '/api/info')).body);
  assert.ok(Array.isArray(info.lan));
  assert.ok(info.lan.every((u) => /^http:\/\/[\d.]+:\d+$/.test(u)));
});

test('/qr.svg makes a QR code for http URLs and rejects anything else', async () => {
  const ok = await get(srv.url, '/qr.svg?data=' + encodeURIComponent('http://10.0.0.5:8012/play?code=ABCD'));
  assert.strictEqual(ok.status, 200);
  assert.match(ok.headers['content-type'], /svg/);
  assert.ok(ok.body.includes('<svg'));
  assert.strictEqual((await get(srv.url, '/qr.svg?data=javascript:alert(1)')).status, 400);
  assert.strictEqual((await get(srv.url, '/qr.svg')).status, 400);
});

test('/api/music lists only audio files from the music folder, sorted, and serves them', async () => {
  const list = JSON.parse((await get(srv.url, '/api/music')).body);
  assert.deepStrictEqual(list, ['/music/a.ogg', '/music/b%20song.mp3']);
  const f = await get(srv.url, '/music/a.ogg');
  assert.strictEqual(f.status, 200);
  assert.strictEqual(f.body, 'OggS');
});

test('/api/music is an empty list when there is no music folder', async () => {
  const s2 = await startServer();
  try {
    assert.deepStrictEqual(JSON.parse((await get(s2.url, '/api/music')).body), []);
  } finally { await s2.stop(); }
});

test('/api/content-stats covers every pool with 1000+ items', async () => {
  const stats = JSON.parse((await get(srv.url, '/api/content-stats')).body);
  for (const pool of ['punchline', 'trivia', 'fibbage', 'closest', 'majority', 'mostlikely', 'imposter', 'telephone', 'cah-black', 'cah-white']) {
    assert.ok(stats[pool], `missing pool ${pool}`);
    assert.ok(stats[pool].total >= 1000, `${pool} has ${stats[pool].total}`);
    assert.ok(stats[pool].adult > 0, `${pool} has no 18+ items`);
  }
});

test('server shuts down promptly on SIGTERM (docker stop)', async () => {
  const s2 = await startServer();
  const t0 = Date.now();
  await s2.stop();
  assert.ok(Date.now() - t0 < 3000);
});
