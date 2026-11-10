/*
 * Browser test of the GitHub Pages build (dist/): no game server at all — the TV page hosts the
 * room and phones connect to it (tab-to-tab transport, so no internet is needed here).
 * Serves dist/ under /homejack/ exactly like GitHub Pages does. Run inside the Playwright
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
const BASE = `http://localhost:${PORT}/homejack/`;
/** @type {Map<string, number>} path → requests (to check the cache only fetches changed files) */
const hits = new Map();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, BASE);
  if (!u.pathname.startsWith('/homejack/')) { res.writeHead(404); res.end(); return; }
  const rel = decodeURIComponent(u.pathname.slice('/homejack/'.length)) || 'index.html';
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
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
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
    await tv.waitForFunction(() => /^[A-Z]{4}$/.test((document.getElementById('start-code') || {}).textContent || ''), null, { timeout: 15000 });
    code = await tv.textContent('#start-code');
    const qr = await tv.getAttribute('#start-qr', 'src');
    assert.match(qr, /^data:image\/svg\+xml/, 'QR is generated in the page');
    assert.match(decodeURIComponent(qr), /<path/);
    await tv.click('#start-overlay');
    await tv.waitForFunction(() => /play/.test((document.querySelector('.join-addr') || {}).textContent || ''), null, { timeout: 8000 });
    const addr = await tv.evaluate(() => (document.querySelector('.join-addr') || {}).textContent || '');
    assert.match(addr, /localhost:\d+\/homejack\/play/, `join address points at the Pages URL (${addr})`);
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

  await check('the game is cached in the browser; a new deploy downloads only the files that changed', async () => {
    const reg = await tv.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
    assert.ok(reg, 'service worker active');
    const cached = await tv.evaluate(async () => (await (await caches.open('cabin-fever-files')).keys()).length);
    const listed = await tv.evaluate(async () => { const t = await (await fetch('sw.js')).text(); return Object.keys(JSON.parse(/const FILES = (\{.*?\});/.exec(t)[1])).length; });
    assert.ok(cached >= listed, `all ${listed} files cached (${cached})`);
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
  });

  await check('no page errors anywhere', async () => { assert.deepStrictEqual(errors, []); });

  await browser.close();
  server.close();
  console.log(`\nPages: ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
