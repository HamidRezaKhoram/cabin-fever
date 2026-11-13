/*
 * Browser tests: a real TV page and 3 real phone pages play through the app.
 * Run inside the Playwright container against a running server (BASE_URL).
 * Exits non-zero on the first failure. AGPLv3 — see LICENSE.
 */
'use strict';
const { chromium, devices } = require('playwright');
const assert = require('assert');
const { suite } = require('../kit/browser');

const BASE = process.env.BASE_URL || 'http://localhost:18012';
const SHOTS = process.env.SHOTS || null;
const t = suite({
  name: 'UI', shots: SHOTS,
  async diagnose(pages) {
    for (const [i, pg] of pages.entries()) {
      const info = await pg.evaluate(() => ({
        url: location.pathname, errors: Rumpus.debug.errors(), log: Rumpus.debug.tail(25),
        wiping: Rumpus.fx ? Rumpus.fx.isWiping() : null,
        dom: (document.getElementById('phase-view') || document.getElementById('game-view')).innerHTML.replace(/\s+/g, ' ').slice(0, 700),
      })).catch((er) => ({ err: String(er) }));
      console.error(`\n  ---- page ${i} ${info.url || ''} errors=${JSON.stringify(info.errors || info.err)} wiping=${info.wiping}\n  DOM: ${info.dom}\n${info.log || ''}`);
    }
    try { const d = await (await fetch(BASE + '/api/debug')).json(); console.error('\n  ---- server /api/debug\n' + JSON.stringify(d.rooms, null, 1).slice(0, 3000)); } catch (er) { /* debug off */ }
  },
});
const { check, errors } = t;
const allPages = t.pages;

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const watch = (page, who) => {
    t.watch(page, who);
    // Client code coverage (Chrome's V8 block coverage), merged across every page at the end.
    return page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => {});
  };
  const tv = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  await watch(tv, 'tv');
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
  let code;
  const phones = [];

  await check('TV shows PRESS START, then a room code; music engine starts on click', async () => {
    await tv.goto(BASE + '/host?debug=1');
    await tv.waitForSelector('#start-overlay:not([hidden])');
    // The title screen already shows a big QR + room code so people can join right away.
    await tv.waitForSelector('#start-join:not([hidden]) .start-qr[src*="qr.svg"]');
    const big = await tv.evaluate(() => ({ qr: document.querySelector('.start-qr').getBoundingClientRect().height, code: parseFloat(getComputedStyle(document.getElementById('start-code')).fontSize), vh: innerHeight, text: document.getElementById('start-code').textContent }));
    assert.match(big.text, /^[A-Z]{4}$/);
    assert.ok(big.qr >= big.vh * 0.4, `QR is big on the title screen (${big.qr}px of ${big.vh}px)`);
    assert.ok(big.code >= big.vh * 0.09, `room code is huge (${big.code}px)`);
    // The logo fits on screen (regression: the longer name overflowed and was cut off at the left).
    const logo = await tv.evaluate(() => { const r = document.querySelector('#start-overlay .logo').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
    assert.ok(logo.l >= 0 && logo.r <= logo.w, `logo inside the screen (${Math.round(logo.l)}..${Math.round(logo.r)} of ${logo.w})`);
    await shot(tv, '01-press-start');
    await tv.click('#start-overlay');
    await tv.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent));
    code = await tv.textContent('#room-code');
    assert.strictEqual(await tv.evaluate(() => Rumpus.music.isEnabled()), true);
    assert.ok(await tv.evaluate(() => Rumpus.music.trackCount) >= 50);
  });

  await check('main menu shows ONE join card: one QR code, the room code once, no duplicate player list', async () => {
    await tv.waitForSelector('.join-card .qr-big');
    const seen = await tv.evaluate((c) => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
      const qrs = [...document.querySelectorAll('img')].filter((i) => /qr\.svg/.test(i.src) && vis(i)).length;
      const codes = [...document.querySelectorAll('body *')].filter((el) => vis(el) && !el.closest('#debug-panel') && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(c))).length;
      return { qrs, codes, sidebar: vis(document.getElementById('sidebar')) };
    }, code);
    assert.deepStrictEqual(seen, { qrs: 1, codes: 1, sidebar: false });
    await shot(tv, '02a-lobby-empty');
  });

  await check('TV remote: OK starts, arrows move a big focus ring between controls by direction, OK presses', async () => {
    // A TV browser has a remote, not a mouse (docs/future-features/feel-plan.md, M7). Own browser
    // context: its own room, so the main TV above is untouched.
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const r = await ctx.newPage();
    t.watch(r, 'remote-tv');
    try {
      await r.goto(BASE + '/api/info'); // a page to go back to
      await r.goto(BASE + '/host?debug=1');
      await r.waitForSelector('#start-overlay:not([hidden])');
      await r.keyboard.press('Enter');
      await r.waitForSelector('#start-overlay', { state: 'hidden' });
      await r.keyboard.press('ArrowDown');
      // (pressed before the menu is drawn, the focus lands as soon as it is)
      await r.waitForFunction(() => document.activeElement && document.activeElement !== document.body, null, { timeout: 3000 }).catch(() => {});
      const at = () => r.evaluate(() => { const el = /** @type {HTMLElement} */ (document.activeElement); const b = el.getBoundingClientRect(); return { tag: el.tagName, cls: el.className, x: b.left + b.width / 2, y: b.top + b.height / 2, ring: parseFloat(getComputedStyle(el).outlineWidth) }; });
      const a = await at();
      assert.notStrictEqual(a.tag, 'BODY', 'the first arrow press focuses a control');
      assert.ok(a.ring >= 6, `focus ring is visible from the couch (${a.ring}px)`);
      for (const [key, test] of /** @type {[string, (p: any, q: any) => boolean][]} */ ([['ArrowRight', (p, q) => q.x > p.x], ['ArrowDown', (p, q) => q.y > p.y], ['ArrowLeft', (p, q) => q.x < p.x], ['ArrowUp', (p, q) => q.y < p.y]])) {
        const before = await at();
        await r.keyboard.press(key);
        const after = await at();
        if (after.x !== before.x || after.y !== before.y) assert.ok(test(before, after), `${key} moved the focus that way (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
      }
      // Back once: stays (a stray press mid-round must not end the night) and says how to leave.
      await r.keyboard.press('Backspace');
      await r.waitForSelector('#remote-toast:not([hidden])');
      assert.match(r.url(), /\/host/, 'still on the TV page');
      // OK on ⚙ Settings opens it; OK on a switch toggles it (browsers only do that for Space).
      await r.focus('.more-btn');
      await r.keyboard.press('Enter');
      await r.waitForSelector('.settings-more:not([hidden])');
      await r.focus('#set-spicy');
      const was = await r.isChecked('#set-spicy');
      await r.keyboard.press('Enter');
      await r.waitForFunction((w) => /** @type {HTMLInputElement} */ (document.getElementById('set-spicy')).checked !== w, was);
      await r.keyboard.press('Enter');
      // Back with Settings open closes Settings — not the page.
      await r.keyboard.press('Backspace');
      await r.waitForSelector('.settings-more', { state: 'hidden' });
      assert.match(r.url(), /\/host/, 'Back closed the panel, the TV page stays');
      // Back twice within 3 s: leaves (back to the page before).
      await r.keyboard.press('Backspace');
      await r.keyboard.press('Backspace');
      await r.waitForURL((u) => !/\/host/.test(String(u)), { timeout: 5000 });
    } finally { await ctx.close(); }
  });

  await check('Français: the TV language setting (in ⚙ More) translates the TV (and back)', async () => {
    await tv.click('[data-act="more"]');
    await tv.waitForSelector('.settings-more:not([hidden])');
    await tv.selectOption('#set-lang', 'fr');
    await tv.waitForFunction(() => document.documentElement.lang === 'fr' && /Choisis un jeu/.test(document.getElementById('phase-view').textContent));
    await tv.selectOption('#set-lang', 'en');
    await tv.waitForFunction(() => document.documentElement.lang === 'en' && /Choose a game/.test(document.getElementById('phase-view').textContent));
    await tv.keyboard.press('Escape'); // Escape / Back closes the panel
    await tv.waitForSelector('.settings-more', { state: 'hidden' });
  });

  await check('the menu cards say what a game is when picked: the description line follows the focus', async () => {
    await tv.focus('.game-pick[data-game-id="trivia"]');
    await tv.waitForFunction(() => /Lakeside Quiz/.test((document.getElementById('game-detail') || { textContent: '' }).textContent || ''));
    const blurb = await tv.getAttribute('.game-pick[data-game-id="trivia"]', 'data-blurb');
    assert.ok(blurb && (await tv.textContent('#game-detail') || '').includes(blurb.slice(0, 20)), 'the full description, not a cut-off one');
  });

  await check('menu links: House rules (save, reload, add + delete a prompt) and Hall of fame (every tab) work; the Rounds setting sticks', async () => {
    // Click the real links (regression: they pointed at URLs the server didn't serve).
    const open = async (href) => {
      if (await tv.isHidden('.settings-more')) await tv.click('[data-act="more"]'); // the links live in ⚙ Settings
      const [page] = await Promise.all([tv.context().waitForEvent('page'), tv.click(`.settings-more a[href="${href}"]`)]);
      page.on('pageerror', (e) => errors.push(`${href}: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${href} console: ${m.text()}`); });
      await page.waitForLoadState('domcontentloaded');
      return page;
    };
    const admin = await open('/admin');
    await admin.waitForSelector('#timers select[data-timer="trivia"]');
    // House rules: change, save, reload → the change stuck; then put it back.
    await admin.selectOption('select[data-timer="trivia"]', '1.5');
    await admin.fill('#banned', 'zzbadword');
    await admin.click('#save-rules');
    await admin.waitForFunction(() => /Saved/.test(document.getElementById('rules-msg').textContent));
    await admin.reload();
    await admin.waitForSelector('#timers select[data-timer="trivia"]');
    assert.strictEqual(await admin.inputValue('select[data-timer="trivia"]'), '1.5');
    assert.strictEqual(await admin.inputValue('#banned'), 'zzbadword');
    // Content editor: add a prompt, find it, delete it.
    await admin.selectOption('#pool', 'mostlikely');
    await admin.fill('#add-form input[name="text"]', 'Who is most likely to test the admin page?');
    await admin.click('#add-form button[type="submit"]');
    await admin.waitForFunction(() => /Added/.test(document.getElementById('add-msg').textContent));
    await admin.fill('#search', 'test the admin page');
    await admin.waitForSelector('#items [data-del]');
    await admin.click('#items [data-del]');
    await admin.waitForFunction(() => !document.querySelector('#items [data-del]'));
    await admin.selectOption('select[data-timer="trivia"]', '1');
    await admin.fill('#banned', '');
    await admin.click('#save-rules');
    await admin.waitForFunction(() => /Saved/.test(document.getElementById('rules-msg').textContent));
    await admin.close();
    const hl = await open('/highlights');
    for (const tab of ['alltime', 'fame', 'tonight']) {
      await hl.click(`.hl-tabs [data-tab="${tab}"]`);
      await hl.waitForFunction((t) => document.querySelector(`.hl-tabs [data-tab="${t}"]`).classList.contains('on') && document.getElementById('hl-body').textContent.trim().length > 0, tab);
    }
    await hl.close();
    if (await tv.isHidden('.settings-more')) await tv.click('[data-act="more"]'); // every setting is in ⚙ Settings
    await tv.selectOption('#set-rounds', '3');
    await tv.selectOption('#set-timer', '1.5'); // forces another server push + re-render
    await tv.waitForFunction(() => /** @type {HTMLSelectElement} */ (document.getElementById('set-timer')).value === '1.5' && /** @type {HTMLSelectElement} */ (document.getElementById('set-rounds')).value === '3'
      && !!document.querySelector('#set-rounds option[value="3"][selected]'));
    await tv.selectOption('#set-timer', '1');
    await tv.selectOption('#set-rounds', '');
    await tv.click('.settings-more .more-close');
    await tv.waitForSelector('.settings-more', { state: 'hidden' });
  });

  await check('menu music never stops: loops, moves on, and the watchdog revives it', async () => {
    // test-all mounts a 1-second track in music/title + music/menu, so loops and track changes happen fast.
    await tv.waitForFunction(() => Rumpus.music.status().plays >= 5, null, { timeout: 15000 }).catch(async () => {
      const info = await tv.evaluate(async () => ({ st: Rumpus.music.status(), cats: Rumpus.music.customCategories(), enabled: Rumpus.music.isEnabled(), api: await (await fetch('/api/music')).text(), href: location.href }));
      throw new Error('menu music status: ' + JSON.stringify(info));
    });
    assert.strictEqual((await tv.evaluate(() => Rumpus.music.status())).playing, true);
    await tv.evaluate(() => Rumpus.music.debugStop && Rumpus.music.debugStop());
    await tv.waitForFunction(() => Rumpus.music.status().playing, null, { timeout: 8000 });
  });

  await check('game music streams at full quality and changes tracks without a volume jump', async () => {
    // Sample the track level every frame while switching from the menu beep to a real song.
    const levels = await tv.evaluate(async () => {
      const out = [];
      const before = Rumpus.music.status().level;
      Rumpus.music.play('game:trivia');
      for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 33)); out.push(Rumpus.music.status().level); }
      return { before, out };
    });
    const st = await tv.evaluate(() => Rumpus.music.status());
    assert.ok(st.src.endsWith('/music/game/heckin-crows.ogg'), 'playing ' + st.src);
    assert.ok(st.expectedLevel > 0, 'manifest gain known before playback');
    const peak = Math.max(...levels.out);
    assert.ok(peak <= Math.max(levels.before, st.expectedLevel) + 0.01, `level overshot: ${peak} (before ${levels.before}, target ${st.expectedLevel})`);
    assert.ok(Math.abs(levels.out[levels.out.length - 1] - st.expectedLevel) < 0.02, `settles at the measured level: ${levels.out.slice(-1)} vs ${st.expectedLevel}`);
    const t0 = st.time;
    await tv.waitForFunction((t) => Rumpus.music.status().time > t + 0.5, t0, { timeout: 5000 });
    const net = await tv.evaluate(async (src) => {
      const info = (await (await fetch('/api/music-info')).json())[src];
      const head = await fetch(src, { method: 'HEAD' });
      const range = await fetch(src, { headers: { Range: 'bytes=0-1023' } });
      return { info, bytes: Number(head.headers.get('content-length')), type: head.headers.get('content-type'), status: range.status, ranges: head.headers.get('accept-ranges') };
    }, st.src);
    assert.ok(net.info.kbps >= 128, `nominal bitrate ${net.info.kbps} kbps`);
    assert.ok(net.bytes * 8 / net.info.duration / 1000 >= 96, `served file averages ${(net.bytes * 8 / net.info.duration / 1000).toFixed(0)} kbps (not a degraded copy)`);
    assert.strictEqual(net.bytes, net.info.bytes, 'served file is the measured file, byte for byte');
    assert.strictEqual(net.status, 206, 'range requests work (audio streams + seeks instead of downloading whole)');
    assert.strictEqual(net.ranges, 'bytes');
    assert.match(net.type, /audio\/ogg/);
    await tv.evaluate(() => Rumpus.music.play('menu'));
  });

  await check('TV animates at a steady 30 fps (shared clock)', async () => {
    await tv.waitForTimeout(3000);
    const st = await tv.evaluate(() => Rumpus.clock.stats());
    assert.ok(st.medianFps > 27 && st.medianFps < 33 && st.fps < 33, `fps median ${st.medianFps.toFixed(1)} / avg ${st.fps.toFixed(1)}`);
    assert.ok(st.samples > 60);
  });

  await check('game picker shows unique art for every game', async () => {
    const games = await (await fetch(BASE + '/api/admin/rules')).json();
    const arts = await tv.$$eval('.game-pick .game-art img', (els) => els.map((e) => [e.src, e.width, e.height]));
    assert.strictEqual(arts.length, games.games.length, 'one picture per game on the server');
    assert.strictEqual(new Set(arts.map((a) => a[0])).size, arts.length);
    assert.ok(new Set(arts.map((a) => `${a[1]}x${a[2]}`)).size >= 4, 'art comes in different sizes');
    await shot(tv, '02-lobby');
  });

  await check('3 phones join via the QR link with chosen avatars; no horizontal scroll', async () => {
    for (const [i, n] of ['Ann', 'Ben', 'Cat'].entries()) {
      // Phone 1 measures frame pacing: use 1× pixel density there — headless Chrome rasterises
      // in software, so a 2.6× full-screen canvas measures the test machine, not our 30 fps clock.
      const ctx = await browser.newContext({ ...devices['Pixel 7'], ...(i === 0 ? { deviceScaleFactor: 1 } : {}) });
      const p = await ctx.newPage();
      await watch(p, n);
      await p.goto(`${BASE}/play?code=${code}&debug=1`);
      assert.strictEqual(await p.inputValue('#code-input'), code);
      if (i === 0) {
        // Default: the character maker. Change a few parts.
        assert.strictEqual(await p.isVisible('#avatar-make .maker-preview'), true, 'character maker is the default');
        // The join page is short: picture, Random, Undo — the full maker opens with "Customise".
        assert.strictEqual(await p.isVisible('#avatar-make [data-preset="0"]'), false, 'presets wait behind Customise');
        assert.ok(await p.evaluate(() => { const r = document.querySelector('#join-form .join-go').getBoundingClientRect(); return r.bottom <= innerHeight + 1; }), 'Join is on screen without scrolling');
        await p.click('#avatar-make [data-more]');
        await p.click('#avatar-make [data-preset="0"]');
        await p.click('#avatar-make [data-part="faceShape"][data-val="3"]');
        await p.click('#avatar-make [data-tab="style"]');
        await p.click('#avatar-make [data-part="hat"][data-val="1"]');
        await p.click('#avatar-make [data-part="glasses"][data-val="2"]');
        await p.click('#avatar-make [data-tab="outfit"]');
        const bgBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('rumpus.look')).bg);
        await p.click('#avatar-make [data-part="bg"][data-val="3"]');
        await p.click('#avatar-make [data-undo]');
        await p.click('#avatar-make [data-tab="hair"]');
        await p.click('#avatar-make [data-part="hairColor"][data-val="7"]');
        const look = await p.evaluate(() => JSON.parse(localStorage.getItem('rumpus.look')));
        assert.deepStrictEqual([look.faceShape, look.hat, look.glasses, look.bg, look.hairColor], [3, 1, 2, bgBefore, 7], 'presets, tiles, undo and swatches work');
        await shot(p, '00-character-maker');
      } else {
        await p.click('.avatar-mode [data-mode="pick"]');
        await p.click(`#avatar-pick [data-avatar="${i + 2}"]`);
      }
      await p.fill('#nick-input', n);
      await p.click('#join-form button[type=submit]');
      await p.waitForSelector('#game-view:not([hidden])');
      if (i === 0) {
        // Frame pacing on a phone, measured while only the TV + this phone are open
        // (headless Chrome rasterises in software; more open pages starve the CPU).
        await p.evaluate(() => Rumpus.clock.resetStats()); // measure idle pacing, not the editor clicks above
        await p.waitForTimeout(3000);
        const st = await p.evaluate(() => Rumpus.clock.stats());
        // Median frame interval = steady pacing (robust to a stray GC pause on the CPU-only test box).
        assert.ok(st.medianFps > 27 && st.medianFps < 33 && st.fps < 33, `phone fps median ${st.medianFps.toFixed(1)} / avg ${st.fps.toFixed(1)}`);
      }
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.strictEqual(overflow, false, `${n} has horizontal scroll`);
      phones.push(p);
    }
    await tv.waitForFunction(() => document.querySelectorAll('#player-list li').length === 3);
    const avatars = await tv.$$eval('.lobby-crew img', (els) => els.map((e) => e.src));
    assert.strictEqual(avatars.length, 3);
    const looks = await tv.evaluate(() => (window.__lastPlayers = null, [...document.querySelectorAll('.lobby-crew img')].length));
    assert.strictEqual(looks, 3);
    const hasLook = await phones[0].evaluate(() => !!JSON.parse(localStorage.getItem('rumpus.look') || 'null'));
    assert.ok(hasLook, 'the made character is saved on the phone');
    await shot(phones[0], '03-phone-lobby');
  });

  await check('reactions float up on the TV', async () => {
    await phones[1].click('[data-react="🔥"]');
    await tv.waitForSelector('.reaction');
  });

  await check('changing avatar in the lobby updates the TV', async () => {
    await phones[1].click('[data-lobby-maker]'); // ✏️ Change my look → 🐾 Animal
    await phones[1].click('[data-lobby-mode="pick"]');
    await phones[1].click('.lobby-pick [data-avatar]:not([disabled]):not(.on)'); // any free animal
    await tv.waitForFunction(() => [...document.querySelectorAll('#player-list li img')].some((i) => i.src.startsWith('data:')));
  });

  await check('🙈 a phone can leave itself out of votes and notes about people (and back); the TV shows it', async () => {
    await phones[2].click('[data-shy]');
    await phones[2].waitForSelector('[data-shy][aria-pressed="true"]');
    await tv.waitForSelector('.lobby-crew .shy'); // on the menu's crew strip (the sidebar list is hidden there)
    await phones[2].click('[data-shy]');
    await phones[2].waitForSelector('[data-shy][aria-pressed="false"]');
    await tv.waitForSelector('.lobby-crew .shy', { state: 'detached' });
  });

  await check('🕊 Calm (TV setting) stops shakes, wipes and flashes, and is remembered on this TV', async () => {
    await tv.click('[data-act="more"]');
    await tv.check('#set-calm');
    await tv.waitForFunction(() => document.body.classList.contains('calm') && localStorage.getItem('rumpus.calm') === 'true');
    await tv.uncheck('#set-calm');
    await tv.waitForFunction(() => !document.body.classList.contains('calm'));
    await tv.click('.settings-more .more-close');
    await tv.waitForSelector('.settings-more', { state: 'hidden' });
  });

  await check('/bench (device speed check) measures and shows the factor against the lab machine', async () => {
    const b = await browser.newPage();
    t.watch(b, 'bench');
    try {
      await b.goto(BASE + '/bench?base=100');
      await b.waitForFunction(() => /** @type {any} */ (window).cfBench, null, { timeout: 60000 });
      assert.match(await b.textContent('#bench-result') || '', /\d+ ms — [\d.]+× the lab machine/);
    } finally { await b.close(); }
  });

  await check('pace buttons: majority "skip question" swaps the prompt', async () => {
    await tv.click('[data-game-id="closest"]');
    await phones[0].waitForSelector('.number-form');
    await tv.waitForTimeout(4500); // let the title card finish
    const q1 = await tv.textContent('h1.prompt');
    for (const p of phones.slice(0, 2)) await p.click('[data-pace="skipq"]');
    await tv.waitForFunction((q) => document.querySelector('h1.prompt') && document.querySelector('h1.prompt').textContent !== q, q1, { timeout: 8000 });
    await phones[0].fill('.number-form input', '12');
    await phones[0].click('.number-form button');
    await phones[0].waitForSelector('[data-pace="hurry"]');
    tv.once('dialog', (d) => d.accept());
    await tv.click('[data-act="end"]');
    await tv.waitForSelector('.game-pick');
  });

  await check('Campfire Quips: title card, 2 prompts each, head-to-head vote, results', async () => {
    await tv.click('[data-game-id="quiplash"]');
    await tv.waitForSelector('.intro-card');
    await shot(tv, '04-intro-card');
    for (const p of phones) {
      for (let k = 0; k < 2; k++) {
        await p.waitForSelector('.text-form input');
        await p.fill('.text-form input', `answer ${k}`);
        await p.click('.text-form button');
        await p.waitForTimeout(150);
      }
    }
    await tv.waitForSelector('.versus .vs-card');
    await shot(tv, '05-versus');
    // Wait until the voter's phone actually shows the vote buttons, then vote.
    const voter = await Promise.any(phones.map((p) => p.waitForSelector('[data-send]', { timeout: 15000 }).then(() => p)));
    await voter.click('[data-send]');
    await tv.waitForSelector('.vs-bar', { timeout: 15000 });
    await shot(tv, '06-results');
  });

  await check('typing is kept when another player submits (no re-render)', async () => {
    await tv.click('[data-act="end"]').catch(() => {});
    tv.once('dialog', (d) => d.accept());
    await tv.click('[data-act="end"]');
    await tv.waitForSelector('.game-pick');
    await tv.click('[data-game-id="majority"]');
    await phones[0].waitForSelector('.text-form input');
    await phones[1].waitForSelector('.text-form input');
    await phones[1].fill('.text-form input', 'half-typed');
    await phones[0].fill('.text-form input', 'banana');
    await phones[0].click('.text-form button');
    await phones[1].waitForTimeout(400);
    assert.strictEqual(await phones[1].inputValue('.text-form input'), 'half-typed');
  });

  await check('TV fills the screen: the prompt is big (10-foot rule) and content is vertically centred', async () => {
    await tv.waitForTimeout(1500); // let the screen wipe + layout settle
    const m = await tv.evaluate(() => {
      const h = document.querySelector('#phase-view h1.prompt');
      const pv = document.getElementById('phase-view');
      return { font: parseFloat(getComputedStyle(h).fontSize), vh: innerHeight, inGame: pv.classList.contains('in-game'),
        diag: { fit: h.dataset.fit, style: h.getAttribute('style'), cw: h.clientWidth, sw: h.scrollWidth, sh: h.scrollHeight, text: h.textContent.slice(0, 60) } };
    });
    console.log('    fill diag:', JSON.stringify(m.diag));
    assert.ok(m.inGame, 'stage layout active');
    assert.ok(m.font >= m.vh * 0.05, `prompt font ${m.font}px is under 5% of screen height (${m.vh}px)`);
  });

  await check('Majority reveal shows grouped answers with avatars', async () => {
    await phones[1].click('.text-form button');
    await phones[2].fill('.text-form input', 'Bananas');
    await phones[2].click('.text-form button');
    // Second tap: bet how many others will match you.
    for (const p of phones) { await p.waitForSelector('.bet-btn'); await p.click('.bet-btn >> nth=1'); }
    await tv.waitForSelector('ol.suspense li');
    await shot(tv, '07-majority');
  });

  await check('phone reload keeps the seat (token rejoin)', async () => {
    await phones[2].reload();
    await phones[2].waitForSelector('#game-view:not([hidden])');
    await tv.waitForFunction(() => [...document.querySelectorAll('#player-list li')].every((li) => !li.classList.contains('offline')));
    assert.strictEqual(await tv.$$eval('#player-list li', (l) => l.length), 3);
  });

  await check('a phone whose screen can\'t be kept awake says so (once)', async () => {
    const p = phones[2];
    await p.evaluate(() => {
      Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
      const v = /** @type {HTMLVideoElement | null} */ (document.querySelector('video.keep-awake'));
      if (v) v.pause();
      window.__realPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('low-power mode', 'NotAllowedError'));
    });
    await p.mouse.click(5, 5);
    await p.waitForSelector('.wake-hint', { timeout: 5000 });
    assert.match(await p.textContent('.wake-hint') || '', /low-power mode/);
    await p.mouse.click(5, 5);
    await p.waitForTimeout(150);
    assert.strictEqual(await p.$$eval('.wake-hint', (l) => l.length), 1, 'shown once, not on every tap');
    await p.evaluate(() => { HTMLMediaElement.prototype.play = window.__realPlay; document.querySelectorAll('.wake-hint').forEach((e) => e.remove()); });
  });

  await check('Message in a Bottle: drawing on a phone canvas reaches the TV', async () => {
    tv.once('dialog', (d) => d.accept());
    await tv.click('[data-act="end"]');
    await tv.waitForSelector('.game-pick');
    await tv.click('[data-game-id="telephone"]');
    for (const p of phones) { await p.waitForSelector('.text-form input'); await p.fill('.text-form input', 'a moose'); await p.click('.text-form button'); }
    for (const p of phones) {
      await p.waitForSelector('#pad canvas');
      const box = await (await p.$('#pad canvas')).boundingBox();
      await p.mouse.move(box.x + 30, box.y + 30); await p.mouse.down();
      for (let k = 0; k < 10; k++) await p.mouse.move(box.x + 30 + k * 15, box.y + 30 + k * 10);
      await p.mouse.up();
      await p.click('#draw-done');
      if (p === phones[0]) {
        // The first one done gets the scribble pad: a doodle floats across the TV while the rest draw.
        await p.waitForSelector('#scribble-pad canvas');
        const sb = await (await p.$('#scribble-pad canvas')).boundingBox();
        await p.mouse.move(sb.x + 20, sb.y + 20); await p.mouse.down();
        for (let k = 0; k < 8; k++) await p.mouse.move(sb.x + 20 + k * 12, sb.y + 20 + k * 6);
        await p.mouse.up();
        await p.click('#scribble-send');
        await tv.waitForSelector('.scribble-sea .scribble img');
        // Keyed morph: the floating doodle is the same element on the next update (its drift keeps going).
        const same = await tv.evaluate(() => {
          const el = document.querySelector('.scribble');
          const root = document.createElement('div');
          root.innerHTML = '<i data-key="1">a</i><i data-key="2">b</i>';
          const first = root.children[1];
          window.Rumpus.morph(root, '<i data-key="2">b</i><i data-key="3">c</i>');
          return { kept: root.children[0] === first, keys: [...root.children].map((c) => c.getAttribute('data-key')).join(','), live: !!el && el.isConnected };
        });
        assert.deepStrictEqual(same, { kept: true, keys: '2,3', live: true });
      }
    }
    await phones[0].waitForSelector('.describe-img');
    const src = await phones[0].getAttribute('.describe-img', 'src');
    assert.match(src, /^data:image\/jpeg;base64,/);
    // The reveal shows each chain's evolution: phrase → drawing → guess, every step visible.
    for (const p of phones) { await p.waitForSelector('.text-form input'); await p.fill('.text-form input', 'a deer'); await p.click('.text-form button'); }
    await tv.waitForSelector('.chain .chain-entry img[alt="drawing"]');
    await tv.waitForFunction(() => {
      const es = [...document.querySelectorAll('.chain .chain-entry')];
      return es.length === 3 && es.every((e) => getComputedStyle(e).opacity === '1');
    }, null, { timeout: 15000 }).catch(async () => {
      throw new Error('chain entries not visible: ' + JSON.stringify(await tv.$$eval('.chain-entry', (es) => es.map((e) => getComputedStyle(e).opacity))));
    });
    const drawn = await tv.$eval('.chain-entry img[alt="drawing"]', (i) => ({ w: i.naturalWidth, h: i.getBoundingClientRect().height }));
    assert.ok(drawn.w === 480 && drawn.h > 100, `the drawing is shown on the TV: ${JSON.stringify(drawn)}`);
    await shot(tv, '06-telephone-reveal');
    // Then every phone picks a favourite step; the TV shows the hearts.
    for (const p of phones.slice(0, 2)) { await p.waitForSelector('.fav-btn', { timeout: 15000 }); await p.click('.fav-btn'); }
    await tv.waitForSelector('.chain-entry .favs'); // checked before the last vote moves the reveal on
    await phones[2].waitForSelector('.fav-btn'); await phones[2].click('.fav-btn');
  });

  await check('Rocco the host animates on the 30 fps clock, reads prompts aloud, and the offline voice works', async () => {
    assert.ok(await tv.evaluate(() => /^data:image\/png/.test(document.querySelector('#rocco .rocco-img').getAttribute('src') || '')));
    const wav = await tv.evaluate(async () => { const r = await fetch('/api/tts?text=Ready'); return { status: r.status, type: r.headers.get('content-type'), head: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 4)) }; });
    assert.deepStrictEqual(wav, { status: 200, type: 'audio/wav', head: 'RIFF' }, 'espeak-ng voice in the container');
    await tv.evaluate(() => Rumpus.host.say('Testing ____ one two'));
    await tv.waitForFunction(() => { const b = document.querySelector('.rocco-bubble'); return b && !b.hidden && /Testing blank one two/.test(b.textContent); });
  });

  await check('the narrator\'s natural voice (Kokoro, in a worker) loads on the TV and speaks a line', async () => {
    await tv.waitForFunction(() => Rumpus.host.natural(), null, { timeout: 120000 });
    // CI runners are slow 2-CPU machines; a real TV falls back to the classic voice after 6 s anyway.
    const ok = await tv.evaluate(() => Rumpus.host.testNatural('Hello!', 150000));
    assert.strictEqual(ok, true, 'Kokoro generated and played the line');
    const voices = await tv.evaluate(() => Rumpus.host.voices().map((v) => v[0])); // the lobby's 🎙 picker lists these
    assert.ok(voices.includes('am_michael') && voices.includes('af_heart') && voices.includes('classic'), 'male, female and classic voices on offer');
    // No clipping on a real TV: the voice and the music are two streams the TV adds up. A full-scale
    // voice part is brought down to half scale, and music ducks to 45% under it, so the sum stays < 1.
    const mix = await tv.evaluate(() => {
      const ctx = new OfflineAudioContext(1, 4800, 48000);
      const loud = ctx.createBuffer(1, 4800, 48000);
      loud.getChannelData(0).fill(0.99);
      const quiet = ctx.createBuffer(1, 4800, 48000);
      quiet.getChannelData(0).fill(0.1);
      return { loud: 0.99 * Rumpus.host.voicePeakGain(loud), quiet: 0.1 * Rumpus.host.voicePeakGain(quiet) };
    });
    assert.ok(Math.abs(mix.loud - 0.5) < 0.01, `a full-scale voice part peaks at half scale (${mix.loud})`);
    assert.ok(mix.quiet <= 0.2 + 1e-9, 'a quiet part is lifted at most ×2');
    assert.ok(mix.loud + 0.708 * 0.45 < 1, 'voice + ducked music (limiter at −3 dB) stay under full scale');
  });

  await check('in a game the TV switches to that game\'s look and hides the join clutter and the player strip', async () => {
    assert.strictEqual(await tv.evaluate(() => document.body.dataset.theme), 'telephone');
    assert.strictEqual(await tv.isVisible('.join-card'), false);
    assert.strictEqual(await tv.isVisible('#topbar .room-code'), true, 'compact code stays for rejoining');
    assert.strictEqual(await tv.isVisible('#sidebar'), false);
  });

  await check('Cottage Olympics on real phones: tapping registers on the TV', async () => {
    tv.once('dialog', (d) => d.accept());
    await tv.click('[data-act="end"]');
    await tv.waitForSelector('.game-pick');
    assert.strictEqual(await tv.evaluate(() => document.body.dataset.theme), 'lobby');
    await tv.click('[data-game-id="minigames"]');
    // Play whatever minigame comes first (they're picked at random) by reacting to each phone's screen.
    const ANY = '[data-mg], .number-form, [data-mg-side], [data-mg-swat], [data-mg-balance], [data-mg-stack], .spot-btn, [data-mg-colour]';
    await phones[0].waitForSelector(ANY + ', .mg-count', { timeout: 20000 });
    await phones[0].waitForSelector(ANY, { timeout: 20000 }); // (Campfire Sequence shows the sparks on the TV first)
    const kind = await phones[0].evaluate(() => {
      const b = /** @type {HTMLElement | null} */ (document.querySelector('[data-mg]'));
      if (b) return b.dataset.mg;
      return document.querySelector('.number-form') ? 'number' : document.querySelector('[data-mg-side]') ? 'paddle' : document.querySelector('.spot-btn') ? 'spot'
        : document.querySelector('[data-mg-colour]') ? 'simon' : 'canvas';
    });
    const hold = async (p, sel, ms) => { const b = await p.$(sel); const box = await b.boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up(); };
    for (const p of phones) {
      if (kind === 'tap') { for (let i = 0; i < 10; i++) await p.click('[data-mg="tap"]'); }
      else if (kind === 'roast') await hold(p, '[data-mg="roast"]', 400);
      else if (kind === 'number') { await p.fill('.number-form input', '20'); await p.click('.number-form button'); }
      else if (kind === 'skip') { for (let i = 0; i < 3; i++) { await p.click('[data-mg="skip"]'); await p.waitForTimeout(150); } }
      else if (kind === 'paddle') { for (let i = 0; i < 6; i++) await p.click(`[data-mg-side="${i % 2 ? 'R' : 'L'}"]`); }
      else if (kind === 'spot') await p.click('.spot-btn');
      else if (kind === 'simon') { const n = await p.evaluate(() => (document.querySelector('[data-mg-seq]') || { textContent: '' }).textContent.split('○').length - 1); for (let i = 0; i < n; i++) await p.click('[data-mg-colour="0"]'); }
      else if (kind === 'canvas') { const c = await p.$('[data-mg-swat], [data-mg-balance], [data-mg-stack]'); if (c) await c.click(); }
      else { await p.waitForSelector('[data-mg="draw"].go', { timeout: 10000 }); await p.click('[data-mg="draw"]'); }
    }
    await tv.waitForFunction(() => /WINS|TIE|NOBODY/.test(document.getElementById('phase-view').textContent), null, { timeout: 30000 });
    assert.strictEqual(await tv.evaluate(() => document.body.dataset.theme), 'minigames');
    // "NOBODY" can be a fair result (a wrong Campfire Sequence), but every phone's input must have
    // registered: a result row of "— —" means the phone's taps never reached the game (how the
    // Campfire Sequence bug slipped through, game-bug-reports.md).
    const rows = await tv.evaluate(() => [...document.querySelectorAll('#phase-view ol li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
    assert.ok(rows.length >= phones.length, `a result row per phone (${kind}): ${JSON.stringify(rows)}`);
    assert.deepStrictEqual(rows.filter((r) => /— —/.test(r)), [], `every phone's ${kind} registered`);
    await shot(tv, '08-minigame-result');
  });

  await check('the player strip flashes for 5 s when someone leaves or reconnects mid-game', async () => {
    tv.once('dialog', (d) => d.accept());
    await tv.click('[data-act="end"]');
    await tv.waitForSelector('.game-pick');
    await tv.click('[data-game-id="closest"]');
    await tv.waitForFunction(() => document.body.classList.contains('in-game'));
    assert.strictEqual(await tv.isVisible('#sidebar'), false);
    await phones[2].evaluate(() => Rumpus.debugSocket.disconnect()); // someone drops → strip flashes
    await tv.waitForSelector('#sidebar', { state: 'visible', timeout: 5000 });
    await tv.waitForSelector('#sidebar', { state: 'hidden', timeout: 8000 }); // gone again after ~5 s
    await phones[2].reload(); // reconnects with the saved seat token → flashes again
    await tv.waitForSelector('#sidebar', { state: 'visible', timeout: 8000 });
  });

  await check('TV reload resumes the same room', async () => {
    await tv.reload();
    await tv.click('#start-overlay');
    await tv.waitForFunction((c) => document.getElementById('room-code').textContent === c, code);
  });

  await check('Cottage Crush on real phones: a note sent from one phone lands only on the chosen phone', async () => {
    tv.once('dialog', (d) => d.accept());
    await tv.click('[data-act="end"]');
    await tv.waitForSelector('.game-pick');
    await tv.click('[data-act="bots"][data-n="1"]'); // 3 phones + 1 bot = 4 players
    await tv.waitForFunction(() => !document.querySelector('[data-game-id="crush"]').disabled);
    await tv.click('[data-game-id="crush"]');
    for (const p of phones) await p.waitForSelector('.crush-person');
    // Pick who it's for on a big tile, then the line (phones are Ann, Ben, Cat).
    await phones[0].click('.crush-person:has-text("Ben")');
    await phones[0].waitForSelector('.crush-to-line');
    assert.ok((await phones[0].textContent('.crush-to-line')).includes('Ben'));
    const text = await phones[0].textContent('.crush-card');
    await phones[0].click('.crush-card');
    await phones[1].waitForFunction((t) => [...document.querySelectorAll('.crush-note')].some((n) => n.textContent.includes(t.trim())), text);
    assert.ok(!(await phones[2].evaluate((t) => document.body.textContent.includes(t.trim()), text)), 'not visible to a third phone');
    tv.once('dialog', (d) => d.accept());
    await tv.click('[data-act="end"]');
    await tv.waitForSelector('.game-pick');
    await tv.click('[data-act="nobots"]');
  });

  await check('Loon Call on real phones: clocks sync, a tap during the tune-up lights up that loon on the TV, the beat meter runs', async () => {
    const off = await phones[0].evaluate(() => ({ rtt: Rumpus.time.rtt(), off: Rumpus.time.offset() }));
    assert.ok(off.rtt !== null && off.rtt < 200, `phone clock synced (rtt ${off.rtt})`);
    await tv.click('[data-game-id="looncall"]');
    await phones[0].waitForSelector('.lc-tap');
    await tv.waitForSelector('[data-lc-meter] .lc-mode');
    await tv.waitForFunction(() => Rumpus.music.status().cue === 'silence', null, { timeout: 8000 }); // the game owns the beat
    // Wait for the clicks, then tap.
    await phones[0].waitForFunction(() => document.querySelector('.lc-tap') && document.querySelector('.lc-tap').classList.contains('go'), null, { timeout: 8000 });
    await phones[0].tap('.lc-tap').catch(() => phones[0].click('.lc-tap'));
    await tv.waitForFunction(() => document.querySelector('.lc-loon.hit-good, .lc-loon.hit-perfect'), null, { timeout: 4000 });
    await shot(tv, '30-looncall');
    // Skip mid-song: the rest of the booked song must not keep playing on the next screen.
    await tv.waitForFunction(() => Rumpus.music.rhythm.busy(), null, { timeout: 4000 });
    const phaseNow = () => tv.evaluate(() => new Function('return state')().phase);
    for (let k = 0; k < 8 && (await phaseNow()) !== 'lc-result'; k++) {
      const before = await phaseNow();
      await tv.click('[data-act="skip"]');
      await tv.waitForFunction((b) => new Function('return state')().phase !== b, before, { timeout: 4000 }).catch(() => {});
    }
    assert.strictEqual(await phaseNow(), 'lc-result', 'Skip got us to the result screen');
    assert.strictEqual(await tv.evaluate(() => Rumpus.music.rhythm.busy()), false, 'the song stopped when it was skipped');
    tv.once('dialog', (d) => d.accept());
    await tv.click('[data-act="end"]');
    await tv.waitForSelector('.game-pick');
  });

  await check('Lantern Lake on real phones: dragging on the circle steers that phone\'s boat on the TV canvas', async () => {
    await tv.click('[data-game-id="lantern"]');
    await tv.waitForSelector('canvas.ll-lake');
    await phones[0].waitForSelector('.ll-pad');
    await tv.waitForFunction(() => Rumpus.frame && Rumpus.frame.boats && Rumpus.frame.boats[0], null, { timeout: 10000 });
    const x0 = await tv.evaluate(() => Rumpus.frame.boats[0][0]);
    const box = await phones[0].locator('.ll-pad').boundingBox();
    // Hold a finger to one edge of the circle: towards the middle of the lake (a boat that starts by
    // the right shore has no room to go further right; the lake is 320 wide).
    const dir = x0 > 160 ? -1 : 1;
    await phones[0].mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phones[0].mouse.down();
    await phones[0].mouse.move(box.x + box.width * (0.5 + 0.45 * dir), box.y + box.height / 2, { steps: 4 });
    await tv.waitForFunction(([x, d]) => (Rumpus.frame.boats[0][0] - x) * d > 15, [x0, dir], { timeout: 6000 });
    await phones[0].mouse.up();
    const lit = await tv.evaluate(() => { const c = document.querySelector('canvas.ll-lake'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n; });
    assert.ok(lit > 50, 'the lake is drawn');
    await shot(tv, '31-lantern');
    tv.once('dialog', (d) => d.accept());
    await tv.click('[data-act="end"]');
    await tv.waitForSelector('.game-pick');
  });

  await check('the game menu fits on one screen — no scrolling — on a 720p TV and a 1080p one, with a full room', async () => {
    const size = tv.viewportSize();
    await tv.evaluate(() => new Function('return socket')().emit('host:addBots', { count: 12 }));
    await tv.waitForFunction(() => document.querySelectorAll('.lobby-crew figure').length === 12, null, { timeout: 8000 });
    try {
      for (const [w, h] of [[1280, 720], [1920, 1080], [1366, 768]]) {
        await tv.setViewportSize({ width: w, height: h });
        await tv.waitForTimeout(250);
        const m = await tv.evaluate(() => {
          const stage = /** @type {HTMLElement} */ (document.getElementById('stage')).getBoundingClientRect();
          const inside = (/** @type {Element} */ e) => { const r = e.getBoundingClientRect(); return r.height > 20 && r.top >= stage.top - 1 && r.bottom <= stage.bottom + 1; };
          const st = /** @type {HTMLElement} */ (document.getElementById('stage'));
          return {
            scroll: st.scrollHeight - st.clientHeight, page: document.documentElement.scrollHeight - innerHeight,
            games: [...document.querySelectorAll('.game-pick')].filter(inside).length, of: document.querySelectorAll('.game-pick').length,
            players: [...document.querySelectorAll('.lobby-crew figure')].filter(inside).length,
            settings: inside(/** @type {Element} */ (document.querySelector('.game-menu .settings'))), join: inside(/** @type {Element} */ (document.querySelector('.join-card'))),
          };
        });
        assert.deepStrictEqual(m, { scroll: 0, page: 0, games: m.of, of: m.of, players: 12, settings: true, join: true }, `${w}×${h}`);
        assert.ok(m.of >= 15);
      }
    } finally {
      await tv.setViewportSize(size);
      await tv.evaluate(() => new Function('return socket')().emit('host:removeBots'));
    }
  });

  // Every screen the bots ever reached (test/ui/snapshots, refreshed when a game changes), pushed
  // through the real TV and phone page code exactly like a server update.
  await check('every recorded screen of every game renders on the TV and on a phone', async () => {
    const fs = require('fs');
    const dir = process.env.SNAP_DIR || require('path').join(__dirname, 'snapshots');
    const games = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    const offered = (await (await fetch(BASE + '/api/admin/rules')).json()).games.map((g) => g.id);
    const missing = offered.filter((id) => !games.includes(`${id}.json`));
    assert.deepStrictEqual(missing, [], 'every game has recorded screens (run BOT_GAMES=<id> ./scripts/test-all.sh)');
    const snapTv = await browser.newPage({ viewport: { width: 1400, height: 850 } });
    await watch(snapTv, 'snapshot-tv');
    await snapTv.goto(`${BASE}/host`);
    const pctx = await browser.newContext({ ...devices['Pixel 7'] });
    const snapPhone = await pctx.newPage();
    await watch(snapPhone, 'snapshot-phone');
    await snapPhone.goto(`${BASE}/play`);
    let n = 0;
    const failures = [];
    /** @type {string[]} */
    const shrunk = [];
    for (const f of games) {
      const snaps = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
      for (const sn of snaps) {
        const page = sn.kind === 'host' ? snapTv : snapPhone;
        const err = await page.evaluate(([kind, st]) => {
          try {
            // The pages' top-level `socket` / `me` live in the global lexical scope of classic scripts.
            const pageSocket = new Function('return socket')();
            if (kind === 'player') new Function('v', 'me = v')({ playerId: st.you.playerId });
            pageSocket.listeners('room:stateUpdate').forEach((fn) => fn(st));
            const impl = Rumpus.games[st.gameState && st.gameState.gameId];
            if (impl && st.phase !== 'gameover') {
              Rumpus.setState(st);
              const html = kind === 'host' ? impl.host(st) : impl.player(st);
              if (typeof html !== 'string' || !html.trim()) return 'rendered nothing';
              if (kind === 'host' && impl.moment) { const m = impl.moment(st); if (m !== null && typeof m !== 'object') return 'moment returned junk'; }
              if (kind === 'host' && impl.narrate) { const line = impl.narrate(st); if (line !== null && (typeof line !== 'string' || !line.trim())) return 'narrator returned junk'; }
            }
            return null;
          } catch (e) { return String(e && e.stack || e).slice(0, 300); }
        }, [sn.kind, sn.state]);
        n++;
        if (err) failures.push(`${f} ${sn.kind} ${sn.state.phase}: ${err}`);
        // The TV never scrolls during a game: every screen fits the stage (8 players' worth).
        if (!err && sn.kind === 'host' && !['lobby', 'gameover'].includes(sn.state.phase)) {
          // Measure once the TV says nothing can still change the layout (no pending re-fit, fonts and
          // images in, no wipe) plus two frames for the last re-fit to apply. No "wait until it fits"
          // grace: a screen that overflows here overflows on the real TV.
          const idle = await snapTv.waitForFunction(() => /** @type {any} */ (window).cfLayoutIdle(), null, { timeout: 10000, polling: 20 }).then(() => '', async () => snapTv.evaluate(() => /** @type {any} */ (window).cfLayoutBusy()));
          if (idle) failures.push(`${f} host ${sn.state.phase}: layout never settled (${idle})`);
          await snapTv.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
          const over = await snapTv.evaluate(() => {
            const st = /** @type {HTMLElement} */ (document.getElementById('stage'));
            const pv = /** @type {HTMLElement} */ (document.getElementById('phase-view'));
            return { over: st.scrollHeight - st.clientHeight, page: document.documentElement.scrollHeight - innerHeight, zoom: Number(pv.style.getPropertyValue('--shrink') || 1) };
          });
          if (over.over > 2 || over.page > 2) failures.push(`${f} host ${sn.state.phase}: TV screen overflows (${over.over}px stage, ${over.page}px page)`);
          // Shrinking to fit is a safety net, not a layout: below 60% it's too small to read from the couch.
          if (over.zoom < 0.6) failures.push(`${f} host ${sn.state.phase}: had to shrink to ${Math.round(over.zoom * 100)}% to fit — too much on one screen`);
          if (over.zoom < 1) shrunk.push(`${f.replace('.json', '')}/${sn.state.phase} ${Math.round(over.zoom * 100)}%`);
        }
      }
    }
    assert.deepStrictEqual(failures, []);
    assert.ok(n >= offered.length * 4, `rendered ${n} screens`);
    console.log(`    (${n} recorded screens from ${games.length} games${shrunk.length ? `; shrunk to fit: ${[...new Set(shrunk)].join(', ')}` : ''})`);
  });

  await check('no page errors anywhere', async () => {
    assert.deepStrictEqual(errors, []);
  });

  // ---- client coverage: which bytes of public/*.js ran on any TV or phone page
  /** @type {Map<string, { src: string, hit: Uint8Array }>} */
  const files = new Map();
  for (const pg of allPages) {
    const entries = await pg.coverage.stopJSCoverage().catch(() => []);
    for (const e of entries) {
      const m = /^https?:\/\/[^/]+\/([\w-]+\.js)(\?|$)/.exec(e.url);
      if (!m || m[1] === 'socket.io.js') continue;
      const f = files.get(m[1]) || { src: e.source || '', hit: new Uint8Array((e.source || '').length) };
      const mark = new Uint8Array(f.src.length);
      const ranges = e.functions.flatMap((fn) => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
      for (const r of ranges) mark.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(r.endOffset, mark.length));
      for (let i = 0; i < mark.length; i++) if (mark[i]) f.hit[i] = 1;
      files.set(m[1], f);
    }
  }
  let tot = 0, cov = 0;
  const rows = [];
  for (const [name, f] of [...files].sort()) {
    let t = 0, c = 0;
    for (let i = 0; i < f.src.length; i++) if (!/\s/.test(f.src[i])) { t++; if (f.hit[i]) c++; }
    tot += t; cov += c;
    rows.push(`  ${name.padEnd(22)} ${((100 * c) / Math.max(1, t)).toFixed(1).padStart(5)}%`);
  }
  const pct = (100 * cov) / Math.max(1, tot);
  console.log(`\nClient code coverage (browser tests):\n${rows.join('\n')}\n  ${'all'.padEnd(22)} ${pct.toFixed(1).padStart(5)}%`);
  const CLIENT_MIN = Number(process.env.CLIENT_COVERAGE_MIN || 80);
  await browser.close();
  if (pct < CLIENT_MIN) { console.error(`✖ client coverage ${pct.toFixed(1)}% is below ${CLIENT_MIN}%`); process.exit(1); }
  t.done();
})().catch((e) => { console.error(e); process.exit(1); });
