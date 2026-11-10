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
  fs.mkdirSync(path.join(musicDir, 'final'));
  fs.writeFileSync(path.join(musicDir, 'final', 'boss.mp3'), 'ID3');
  fs.mkdirSync(path.join(musicDir, 'game', 'quiplash'), { recursive: true });
  fs.writeFileSync(path.join(musicDir, 'game', 'quiplash', 'laugh.mp3'), 'ID3');
  fs.writeFileSync(path.join(musicDir, 'manifest.json'), JSON.stringify({ 'b song.mp3': { gain: 0.5, kbps: 192 } }));
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

// Regression: the TV linked to /admin and /highlights but only /admin.html existed, and the
// tests fetched the .html files — so test the exact URLs the client code uses.
test('every same-site URL written in the client code (links, fetches, redirects, worker cache) is served', async () => {
  const dir = path.join(__dirname, '..', '..', 'public');
  const urls = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => /\.(js|html|webmanifest)$/.test(x))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /(?:href|src|action)=["'](\/[^"'$?#{}\s]*)|fetch\(\s*['`](\/[^'`$?#{}\s]*)|location\.(?:href|assign)\s*=?\(?\s*['`](\/[^'`$?#{}\s]*)|"start_url":\s*"(\/[^"?#]*)"/g;
    for (const m of src.matchAll(re)) urls.add(m[1] || m[2] || m[3] || m[4]);
    const shell = /SHELL\s*=\s*\[([^\]]*)\]/.exec(src);
    if (shell) for (const m of shell[1].matchAll(/'(\/[^']*)'/g)) urls.add(m[1]);
  }
  for (const must of ['/admin', '/highlights', '/play', '/host']) assert.ok(urls.has(must) || must === '/host', `scanner should find ${must}`);
  assert.ok(urls.size >= 25, `found only ${urls.size} URLs — is the scanner broken?`);
  for (const u of urls) {
    const r = await get(srv.url, u === '/qr.svg' ? '/qr.svg?data=http%3A%2F%2Fx' : u);
    assert.ok(r.status === 200 || r.status === 302, `${u} returned ${r.status}`);
  }
});

test('every TV button action and setting control has a handler', () => {
  const dir = path.join(__dirname, '..', '..', 'public');
  for (const f of ['host.js', 'play.js', 'games.js', 'admin.js', 'highlights.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const all = ['host.js', 'play.js', 'games.js', 'admin.js', 'highlights.js'].map((x) => fs.readFileSync(path.join(dir, x), 'utf8')).join('\n');
    for (const [, act] of src.matchAll(/data-act="([\w-]+)"/g)) {
      assert.ok(all.includes(`act === '${act}'`), `${f}: button data-act="${act}" has no click handler`);
    }
    for (const [, id] of src.matchAll(/id="(set-[\w-]+)"/g)) {
      assert.ok(all.includes(`'${id}'`), `${f}: control #${id} has no change handler`);
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

test('/api/music groups audio files by scenario folder (root = any) and serves them', async () => {
  const cats = JSON.parse((await get(srv.url, '/api/music')).body);
  assert.deepStrictEqual(cats.any, ['/music/a.ogg', '/music/b%20song.mp3']);
  assert.deepStrictEqual(cats.final, ['/music/final/boss.mp3']);
  assert.deepStrictEqual(cats['game/quiplash'], ['/music/game/quiplash/laugh.mp3']);
  assert.ok(!JSON.stringify(cats).includes('notes.txt'));
  assert.strictEqual((await get(srv.url, '/music/final/boss.mp3')).status, 200);
  const f = await get(srv.url, '/music/a.ogg');
  assert.strictEqual(f.status, 200);
  assert.strictEqual(f.body, 'OggS');
});

test('/api/music-info maps track URLs to their measured gain/bitrate; music files support range requests', async () => {
  assert.deepStrictEqual(JSON.parse((await get(srv.url, '/api/music-info')).body), { '/music/b%20song.mp3': { gain: 0.5, kbps: 192 } });
  const r = await fetch(srv.url + '/music/b%20song.mp3', { headers: { Range: 'bytes=0-2' } });
  assert.strictEqual(r.status, 206);
  assert.strictEqual(await r.text(), 'ID3');
  assert.ok(!JSON.stringify(JSON.parse((await get(srv.url, '/api/music')).body)).includes('manifest'));
});

test('/api/music is an empty list when there is no music folder', async () => {
  const s2 = await startServer();
  try {
    assert.deepStrictEqual(JSON.parse((await get(s2.url, '/api/music')).body), {});
  } finally { await s2.stop(); }
});

test('/api/content-stats covers every pool', async () => {
  const stats = JSON.parse((await get(srv.url, '/api/content-stats')).body);
  for (const pool of ['punchline', 'trivia', 'fibbage', 'closest', 'majority', 'mostlikely', 'imposter', 'telephone', 'cah-black', 'cah-white']) {
    assert.ok(stats[pool], `missing pool ${pool}`);
    assert.ok(stats[pool].total >= 300, `${pool} has ${stats[pool].total}`);
    assert.ok(stats[pool].adult > 0, `${pool} has no 18+ items`);
  }
});

test('server shuts down promptly on SIGTERM (docker stop)', async () => {
  const s2 = await startServer();
  const t0 = Date.now();
  await s2.stop();
  assert.ok(Date.now() - t0 < 3000);
});

test('/api/tts: WAV from the offline voice, or a clean 501 when espeak-ng is not installed', async () => {
  const r = await fetch(srv.url + '/api/tts?text=' + encodeURIComponent('Hello cottage'));
  assert.ok([200, 501].includes(r.status), `status ${r.status}`);
  if (r.status === 200) {
    assert.strictEqual(r.headers.get('content-type'), 'audio/wav');
    assert.strictEqual(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
  } else assert.match((await r.json()).error, /narrator/);
  assert.strictEqual((await fetch(srv.url + '/api/tts?text=')).status, 400);
});
