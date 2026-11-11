/*
 * Browser test of the GitHub Pages build (dist/): no game server at all — the TV page hosts the
 * room and phones connect to it (tab-to-tab transport, so no internet is needed here).
 * Serves dist/ under /cabin-fever/ exactly like GitHub Pages does. Run inside the Playwright
 * container: DIST=/dist node pages.js. Exits non-zero on the first failure. AGPLv3 — see LICENSE.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const DIST = process.env.DIST || '/dist';
const PORT = Number(process.env.PAGES_PORT || 18090);
const BASE = `http://localhost:${PORT}/cabin-fever/`;
/** @type {Map<string, number>} path → requests (to check the cache only fetches changed files) */
const hits = new Map();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, BASE);
  if (!u.pathname.startsWith('/cabin-fever/')) { res.writeHead(404); res.end(); return; }
  const rel = decodeURIComponent(u.pathname.slice('/cabin-fever/'.length)) || 'index.html';
  let file = path.join(DIST, rel);
  if (!path.extname(rel) && fs.existsSync(file + '.html')) file += '.html'; // like GitHub Pages
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  hits.set(rel, (hits.get(rel) || 0) + 1);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

let passed = 0;
/** @type {any[]} every tab, for the failure dump */
const pages = [];
/** @param {string} name @param {() => Promise<void>} fn */
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log(`  ✔ ${name} (${Date.now() - t0} ms)`); } catch (e) {
    console.error(`  ✖ ${name}\n`, e);
    for (const [i, pg] of pages.entries()) {
      const info = await pg.evaluate(() => ({ url: location.pathname + location.search, text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400), log: window.Rumpus && window.Rumpus.debug ? window.Rumpus.debug.tail(15) : '' })).catch((er) => ({ url: '?', text: String(er), log: '' }));
      console.error(`\n  ---- tab ${i} ${info.url}\n  ${info.text}\n${info.log}`);
    }
    process.exit(1);
  }
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  // WebRtcHideLocalIpsWithMdns off: tabs must reach each other by plain local addresses (the speed test's
  // real WebRTC links); in a container the .local names Chromium uses instead don't resolve.
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const ctx = await browser.newContext(); // one browser: the tabs reach each other (?net=local)
  const errors = [];
  const watch = (p, who) => {
    pages.push(p);
    p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { errors.push(`${who} console: ${m.text()}`); console.error(`    [${who} ${m.type()}] ${m.text().slice(0, 300)}`); } });
  };
  const tv = await ctx.newPage();
  watch(tv, 'tv');
  let code = '';

  await check('the landing page links to hosting and joining', async () => {
    await tv.goto(BASE);
    assert.ok(await tv.isVisible('a[href="host.html"]'));
    assert.ok(await tv.isVisible('a[href="play.html"]'));
  });

  await check('the TV page hosts a room in the browser (no server), with a QR code drawn in the page', async () => {
    await tv.goto(BASE + 'host.html?net=local&debug=1');
    // First visit: the page reloads itself once the service worker is in charge, so that it is
    // cross-origin isolated (the narrator's voice needs that for speed).
    await tv.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 30000 });
    await tv.waitForFunction(() => /^[A-Z]{4}$/.test((document.getElementById('start-code') || {}).textContent || ''), null, { timeout: 15000 });
    code = await tv.textContent('#start-code');
    const qr = await tv.getAttribute('#start-qr', 'src');
    assert.match(qr, /^data:image\/svg\+xml/, 'QR is generated in the page');
    assert.match(decodeURIComponent(qr), /<path/);
    await tv.click('#start-overlay');
    await tv.waitForFunction(() => /play/.test((document.querySelector('.join-addr') || {}).textContent || ''), null, { timeout: 8000 });
    const addr = await tv.evaluate(() => (document.querySelector('.join-addr') || {}).textContent || '');
    assert.match(addr, /localhost:\d+\/cabin-fever\/play/, `join address points at the Pages URL (${addr})`);
  });

  const phones = [];
  await check('two phones join the TV directly and appear on it', async () => {
    for (const name of ['Ann', 'Ben']) {
      const p = await ctx.newPage();
      watch(p, name);
      // Tabs of one browser share localStorage; real phones don't. Each tab starts without a saved seat
      // (once — a reload keeps it, so the reload check below still tests rejoining).
      await p.addInitScript(() => { if (!sessionStorage.getItem('cf.test')) { localStorage.removeItem('rumpus.seat'); sessionStorage.setItem('cf.test', '1'); } });
      await p.goto(`${BASE}play.html?code=${code}&net=local`);
      await p.fill('#nick-input', name);
      await p.click('#join-form button[type="submit"]');
      await p.waitForSelector('#game-view:not([hidden])', { timeout: 10000 });
      phones.push(p);
    }
    await tv.waitForFunction(() => document.querySelectorAll('#player-list li').length === 2 || /2\/\d+ joined/.test(document.body.textContent || ''), null, { timeout: 8000 });
  });

  await check('a joining phone with a wrong code is told there is no such room', async () => {
    const p = await ctx.newPage();
    const saved = await tv.evaluate(() => localStorage.getItem('rumpus.seat')); // Ben's seat (shared storage)
    await p.addInitScript(() => localStorage.removeItem('rumpus.seat'));
    await p.goto(`${BASE}play.html?net=local`);
    await p.fill('#code-input', 'ZZZZ');
    await p.fill('#nick-input', 'Cat');
    await p.click('#join-form button[type="submit"]');
    await p.waitForFunction(() => /No room/.test((document.getElementById('join-error') || {}).textContent || ''), null, { timeout: 6000 });
    await p.close();
    await tv.evaluate((v) => { if (v) localStorage.setItem('rumpus.seat', v); }, saved);
  });

  await check('a whole round plays out: the TV runs the game, phones answer, the reveal shows', async () => {
    await tv.click('[data-game-id="closest"]'); // Closest Cast: 2+ players
    for (const [i, p] of phones.entries()) {
      await p.waitForSelector('.number-form input', { timeout: 15000 });
      await p.fill('.number-form input', String(10 + i * 5));
      await p.click('.number-form button[type="submit"]');
    }
    await tv.waitForSelector('.big-answer', { timeout: 15000 });
    const rows = await tv.$$eval('.answers.results li', (els) => els.length);
    assert.strictEqual(rows, 2, 'both guesses are on the reveal');
  });

  await check('a phone that reloads gets its seat back', async () => {
    await phones[1].reload();
    await phones[1].waitForSelector('#game-view:not([hidden])', { timeout: 10000 });
    assert.ok(!(await phones[1].isVisible('#join-form')), 'no join form after reload');
  });

  await check('/admin works in the browser build: house rules save and stay saved', async () => {
    const a = await ctx.newPage();
    watch(a, 'admin');
    await a.goto(BASE + 'admin.html');
    await a.waitForSelector('#timers select[data-timer="trivia"]', { timeout: 10000 });
    await a.selectOption('select[data-timer="trivia"]', '1.5');
    await a.click('#save-rules');
    await a.waitForFunction(() => /Saved/.test(document.getElementById('rules-msg').textContent || ''));
    await a.reload();
    await a.waitForSelector('#timers select[data-timer="trivia"]');
    assert.strictEqual(await a.inputValue('select[data-timer="trivia"]'), '1.5');
    await a.close();
  });

  await check('first visit saves the whole game (progress bar), then TV + phone pages load with NO internet', async () => {
    // The TV showed its progress, and saved every game file, then the music + voice in the background.
    await tv.waitForFunction(() => window.cfSaved && window.cfSaved.core === 100, null, { timeout: 60000 });
    const want = await tv.evaluate(async () => {
      const t = await (await fetch('sw.js')).text();
      const n = (/** @type {string} */ name) => Object.keys(JSON.parse(new RegExp(`const ${name} = (\\{.*?\\});`).exec(t)[1])).length;
      return n('FILES') + n('MEDIA');
    });
    for (let i = 0; i < 240; i++) {
      const have = await tv.evaluate(async () => (await (await caches.open('cabin-fever-files')).keys()).length);
      if (have >= want) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.strictEqual(await tv.evaluate(() => window.cfSaved.media), 100, 'music + voice saved');
    // Pull the plug: both pages still load and the TV still makes a room (tab-to-tab here).
    await ctx.setOffline(true);
    try {
      const tv2 = await ctx.newPage();
      watch(tv2, 'tv-offline');
      await tv2.goto(BASE + 'host.html?net=local');
      // The first TV tab still owns the saved room: this one says it has its own, unsaved room.
      await tv2.waitForSelector('.second-tab-note', { timeout: 15000 });
      assert.match(await tv2.textContent('.second-tab-note') || '', /Another tab is hosting/);
      assert.ok(!(await tv.isVisible('.second-tab-note')), 'the first tab shows no such note');
      await tv2.click('#start-overlay');
      await tv2.waitForFunction(() => /^[A-Z]{4}$/.test((document.getElementById('room-code') || {}).textContent || ''), null, { timeout: 15000 });
      const ph2 = await ctx.newPage();
      watch(ph2, 'phone-offline');
      await ph2.goto(BASE + 'play.html?net=local');
      // The page itself loaded from the saved copy: its join screen (or "getting your seat back").
      await ph2.waitForFunction(() => !!document.querySelector('#join-view:not([hidden]), #game-view:not([hidden])') && !!window.Rumpus, null, { timeout: 15000 });
      await tv2.close(); await ph2.close();
    } finally { await ctx.setOffline(false); }
  });

  await check('the game is cached in the browser; a new deploy downloads only the files that changed', async () => {
    const reg = await tv.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
    assert.ok(reg, 'service worker active');
    const cached = await tv.evaluate(async () => (await (await caches.open('cabin-fever-files')).keys()).length);
    const listed = await tv.evaluate(async () => { const t = await (await fetch('sw.js')).text(); return Object.keys(JSON.parse(/const FILES = (\{.*?\});/.exec(t)[1])).length; });
    assert.ok(cached >= listed, `all ${listed} files cached (${cached})`);
    // An idle TV tab (nobody in its room): it must pick the update up by itself.
    const idle = await ctx.newPage();
    watch(idle, 'tv-idle');
    await idle.goto(BASE + 'host.html?net=local');
    await idle.waitForFunction(() => !!window.Rumpus && self.crossOriginIsolated === true, null, { timeout: 15000 });
    await idle.evaluate(() => { window.beforeUpdate = true; });
    // "Deploy" a change to one file.
    const sw = path.join(DIST, 'sw.js');
    const clock = path.join(DIST, 'clock.js');
    fs.appendFileSync(clock, '\n// new deploy\n');
    const src = fs.readFileSync(sw, 'utf8');
    fs.writeFileSync(sw, src.replace(/"clock\.js":"[0-9a-f]+"/, '"clock.js":"0123456789ab"').replace(/const VERSION = '[0-9a-f]+'/, "const VERSION = 'test-next'"));
    hits.clear();
    await tv.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      await new Promise((res) => { navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }); r.update(); });
    });
    const fetched = [...hits.keys()].filter((k) => k !== 'sw.js');
    assert.deepStrictEqual(fetched, ['clock.js'], `only the changed file was downloaded (got ${fetched.join(', ')})`);
    // The busy TV (players in its room) was left alone, with a note; the idle one reloaded into the new files.
    assert.strictEqual(await tv.evaluate(() => /^[A-Z]{4}$/.test((document.getElementById('room-code') || {}).textContent || '')), true, 'the room in use was not reloaded');
    await tv.waitForFunction(() => /Update ready/.test((document.querySelector('.cf-offline-corner') || {}).textContent || ''), null, { timeout: 5000 });
    await idle.waitForFunction(() => !window.beforeUpdate && !!window.Rumpus, null, { timeout: 15000 });
    const fresh = await idle.evaluate(async () => (await (await fetch('clock.js')).text()).includes('// new deploy'));
    assert.ok(fresh, 'the idle TV now runs the new files');
    await idle.close();
  });

  await check('the TV page reloads: same room code, everyone keeps their seat, phones find it again by themselves', async () => {
    // (The offline check above opened a third phone tab, which took one of these seats for a moment:
    // that phone says "playing in another tab" — take the seat back first.)
    for (const p of phones) if (await p.isVisible('[data-takeback]')) await p.click('[data-takeback]');
    await tv.waitForFunction(() => new Function('return state')().players.every((p) => p.connected), null, { timeout: 15000 });
    const before = await tv.evaluate(() => ({ code: (document.getElementById('room-code') || {}).textContent, n: new Function('return state')().players.length }));
    assert.match(before.code, /^[A-Z]{4}$/);
    assert.ok(before.n >= 2, `players in the room (${before.n})`);
    // A game is running (the round played above): the page asks "leave?" first; Closest Cast then picks up again after the reload.
    assert.ok(!['lobby', 'gameover'].includes(await tv.evaluate(() => new Function('return state')().phase)), 'mid-game');
    tv.once('dialog', (d) => d.accept());
    await tv.reload();
    await tv.waitForFunction(() => !!window.Rumpus && new Function('return state')() && new Function('return state')().code, null, { timeout: 20000 });
    await tv.click('#start-overlay').catch(() => {});
    const after = await tv.evaluate(() => { const st = new Function('return state')(); return { code: st.code, phase: st.phase, names: st.players.map((p) => p.nickname).sort() }; });
    assert.strictEqual(after.code, before.code, 'same room code');
    // Closest Cast can resume (todo 2.1): it picks up at a question (or, if that was the last one, the end).
    assert.ok(['cg-guess', 'gameover'].includes(after.phase), `the game picked up where it was (at ${after.phase})`);
    assert.strictEqual(after.names.length, before.n, 'every seat kept');
    // The phones reconnect on their own and are the same players.
    await tv.waitForFunction((n) => new Function('return state')().players.filter((p) => p.connected).length === n, before.n, { timeout: 30000 });
    // …and are back on their game screen (the resumed question, or the lobby if the game had ended).
    await phones[0].waitForFunction(() => { const gv = document.getElementById('game-view'); return !!gv && !gv.hidden && /You're in|Waiting|picking a game|guess|closest|lock|\d/i.test(gv.textContent || ''); }, null, { timeout: 15000 });
  });

  await check('the fast WebRTC channel: unordered, never retransmitted, and it carries messages between two browsers\' ends', async () => {
    // Two real RTCPeerConnections in the TV page, joined by hand (no broker), the way PeerJS joins a
    // phone and the TV: one normal channel first, then our negotiated fast channel on both ends.
    const r = await tv.evaluate(async () => {
      const a = new RTCPeerConnection(), b = new RTCPeerConnection();
      a.onicecandidate = (e) => { if (e.candidate) void b.addIceCandidate(e.candidate); };
      b.onicecandidate = (e) => { if (e.candidate) void a.addIceCandidate(e.candidate); };
      const main = a.createDataChannel('peerjs-main', { ordered: true });
      /** @type {string[]} */ const surprise = [];
      b.ondatachannel = (e) => { surprise.push(e.channel.label); }; // PeerJS listens here on the TV side
      const open = new Promise((res) => { main.onopen = res; });
      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(await b.createAnswer());
      await a.setRemoteDescription(b.localDescription);
      await Promise.race([open, new Promise((_, rej) => setTimeout(() => rej(new Error('WebRTC did not connect')), 15000))]);
      /** @type {any[]} */ const gotA = [];
      /** @type {any[]} */ const gotB = [];
      const fa = window.CABIN.fastChannel(a, (m) => gotA.push(m));
      const fb = window.CABIN.fastChannel(b, (m) => gotB.push(m));
      for (let i = 0; i < 100 && !(fa.ready() && fb.ready()); i++) await new Promise((res) => setTimeout(res, 50));
      for (let i = 0; i < 20; i++) { fa.send({ t: 'e', ev: 'tilt', args: [i] }); fb.send({ t: 'e', ev: 'back', args: [i] }); }
      await new Promise((res) => setTimeout(res, 500));
      const out = { ready: fa.ready() && fb.ready(), props: fa.props(), toB: gotB.length, toA: gotA.length, last: gotB.length ? gotB[gotB.length - 1].ev : null, surprise };
      a.close(); b.close();
      return out;
    });
    assert.strictEqual(r.ready, true, 'both ends opened it');
    assert.deepStrictEqual(r.props, { ordered: false, maxRetransmits: 0 });
    assert.ok(r.toB >= 15 && r.toA >= 15, `messages arrive both ways (${r.toB}, ${r.toA} of 20)`);
    assert.deepStrictEqual(r.surprise, ['peerjs-main'], 'the fast channel is not announced (PeerJS would mistake it for its own)');
  });

  await check('speed over real WebRTC links (todo 4.1): phones ↔ the TV-hosted server, round trips within budget', async () => {
    // ?net=rtc-local: real RTCPeerConnections and data channels between the tabs (the website's
    // path), introduced over a BroadcastChannel instead of the internet broker.
    const tvR = await ctx.newPage();
    watch(tvR, 'tv-rtc');
    await tvR.goto(BASE + 'host.html?net=rtc-local');
    await tvR.click('#start-overlay').catch(() => {});
    await tvR.waitForFunction(() => /^[A-Z]{4}$/.test((document.getElementById('room-code') || {}).textContent || ''), null, { timeout: 15000 });
    const rcode = await tvR.textContent('#room-code');
    const ps = [];
    for (const n of ['Ria', 'Sol', 'Teo']) {
      const p = await ctx.newPage();
      watch(p, 'phone-rtc-' + n);
      await p.addInitScript(() => { if (!sessionStorage.getItem('cf.test')) { localStorage.removeItem('rumpus.seat'); sessionStorage.setItem('cf.test', '1'); } });
      await p.goto(`${BASE}play.html?code=${rcode}&net=rtc-local&debug=1`);
      await p.fill('#nick-input', n);
      await p.click('#join-form button[type="submit"]');
      await p.waitForSelector('#game-view:not([hidden])', { timeout: 15000 }).catch(async (e) => {
        throw new Error(`${n} did not get in over WebRTC: "${await p.textContent('#join-error').catch(() => '?')}" (${e.message.split('\n')[0]})`);
      });
      ps.push(p);
    }
    await tvR.waitForFunction(() => new Function('return state')().players.filter((/** @type {any} */ x) => x.connected).length === 3, null, { timeout: 20000 });
    /** Round trips from each phone at once: the phone's socket → WebRTC → the TV's server → back. */
    const all = (await Promise.all(ps.map((p) => p.evaluate(async () => {
      const sock = /** @type {any} */ (window).Rumpus.debugSocket;
      /** @type {number[]} */ const out = [];
      for (let i = 0; i < 40; i++) {
        const t0 = performance.now();
        await new Promise((r) => sock.emit('debug:ping', r));
        out.push(performance.now() - t0);
      }
      return out;
    })))).flat().sort((a, b) => a - b);
    const pct = (/** @type {number} */ q) => Math.round(all[Math.min(all.length - 1, Math.floor(all.length * q))]);
    const report = { p50: pct(0.5), p95: pct(0.95), max: Math.round(all[all.length - 1]), n: all.length };
    console.log('  webrtc round trips (ms):', JSON.stringify(report));
    // One machine, no network: anything slower points at the transport (JSON, heartbeat, channel setup).
    assert.ok(report.p50 < 25 && report.p95 < 80, `round trips within budget: ${JSON.stringify(report)}`);
    for (const p of ps) await p.close();
    await tvR.close();
  });

  await check('no page errors anywhere', async () => { assert.deepStrictEqual(errors, []); });

  await browser.close();
  server.close();
  console.log(`\nPages: ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
