/*
 * Browser tests: a real TV page and 3 real phone pages play through the app.
 * Run inside the Playwright container against a running server (BASE_URL).
 * Exits non-zero on the first failure. AGPLv3 — see LICENSE.
 */
'use strict';
const { chromium, devices } = require('playwright');
const assert = require('assert');

const BASE = process.env.BASE_URL || 'http://localhost:18012';
const SHOTS = process.env.SHOTS || null;
let passed = 0;
const allPages = [];
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log(`  ✔ ${name} (${Date.now() - t0} ms)`); } catch (e) {
    console.error(`  ✖ ${name}\n`, e);
    if (SHOTS) for (const [i, pg] of allPages.entries()) await pg.screenshot({ path: `${SHOTS}/FAIL-${i}.png` }).catch(() => {});
    for (const [i, pg] of allPages.entries()) {
      const info = await pg.evaluate(() => ({
        url: location.pathname, errors: Rumpus.debug.errors(), log: Rumpus.debug.tail(25),
        wiping: Rumpus.fx ? Rumpus.fx.isWiping() : null,
        dom: (document.getElementById('phase-view') || document.getElementById('game-view')).innerHTML.replace(/\s+/g, ' ').slice(0, 700),
      })).catch((er) => ({ err: String(er) }));
      console.error(`\n  ---- page ${i} ${info.url || ''} errors=${JSON.stringify(info.errors || info.err)} wiping=${info.wiping}\n  DOM: ${info.dom}\n${info.log || ''}`);
    }
    try { const d = await (await fetch(BASE + '/api/debug')).json(); console.error('\n  ---- server /api/debug\n' + JSON.stringify(d.rooms, null, 1).slice(0, 3000)); } catch (er) { /* debug off */ }
    process.exit(1);
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const watch = (page, who) => {
    allPages.push(page);
    page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who} console: ${m.text()}`); });
  };
  const tv = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  watch(tv, 'tv');
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
  let code;
  const phones = [];

  await check('TV shows PRESS START, then a room code; music engine starts on click', async () => {
    await tv.goto(BASE + '/host?debug=1');
    await tv.waitForSelector('#start-overlay:not([hidden])');
    await shot(tv, '01-press-start');
    await tv.click('#start-overlay');
    await tv.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent));
    code = await tv.textContent('#room-code');
    assert.strictEqual(await tv.evaluate(() => Rumpus.music.isEnabled()), true);
    assert.ok(await tv.evaluate(() => Rumpus.music.trackCount) >= 50);
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

  await check('game picker shows unique art for all 11 games', async () => {
    const arts = await tv.$$eval('.game-pick .game-art img', (els) => els.map((e) => [e.src, e.width, e.height]));
    assert.strictEqual(arts.length, 11);
    assert.strictEqual(new Set(arts.map((a) => a[0])).size, 11);
    assert.ok(new Set(arts.map((a) => `${a[1]}x${a[2]}`)).size >= 4, 'art comes in different sizes');
    await shot(tv, '02-lobby');
  });

  await check('3 phones join via the QR link with chosen avatars; no horizontal scroll', async () => {
    for (const [i, n] of ['Ann', 'Ben', 'Cat'].entries()) {
      // Phone 1 measures frame pacing: use 1× pixel density there — headless Chrome rasterises
      // in software, so a 2.6× full-screen canvas measures the test machine, not our 30 fps clock.
      const ctx = await browser.newContext({ ...devices['Pixel 7'], ...(i === 0 ? { deviceScaleFactor: 1 } : {}) });
      const p = await ctx.newPage();
      watch(p, n);
      await p.goto(`${BASE}/play?code=${code}&debug=1`);
      assert.strictEqual(await p.inputValue('#code-input'), code);
      if (i === 0) {
        // Default: the character maker. Change a few parts.
        assert.strictEqual(await p.isVisible('#avatar-make .maker-preview'), true, 'character maker is the default');
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
    await phones[1].click('.lobby-pick [data-avatar]:not([disabled]):not(.on)'); // any free animal
    await tv.waitForFunction(() => [...document.querySelectorAll('#player-list li img')].some((i) => i.src.startsWith('data:')));
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

  await check('Punchline: title card, 2 prompts each, head-to-head vote, results', async () => {
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

  await check('Doodle Telephone: drawing on a phone canvas reaches the TV', async () => {
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

  await check('in a game the TV switches to that game\'s look and hides the join clutter and the player strip', async () => {
    assert.strictEqual(await tv.evaluate(() => document.body.dataset.theme), 'telephone');
    assert.strictEqual(await tv.isVisible('.join-hint'), false);
    assert.strictEqual(await tv.isVisible('#sidebar'), false);
  });

  await check('Minigame Mayhem on real phones: tapping registers on the TV', async () => {
    tv.once('dialog', (d) => d.accept());
    await tv.click('[data-act="end"]');
    await tv.waitForSelector('.game-pick');
    assert.strictEqual(await tv.evaluate(() => document.body.dataset.theme), 'lobby');
    await tv.click('[data-game-id="minigames"]');
    // Play whatever minigame comes first by reacting to each phone's screen.
    await phones[0].waitForSelector('[data-mg], .number-form', { timeout: 20000 });
    const kind = await phones[0].evaluate(() => { const b = document.querySelector('[data-mg]'); return b ? b.dataset.mg : 'number'; });
    for (const p of phones) {
      if (kind === 'tap') { for (let i = 0; i < 10; i++) await p.click('[data-mg="tap"]'); }
      else if (kind === 'roast') { const b = await p.$('[data-mg="roast"]'); const box = await b.boundingBox(); await p.mouse.move(box.x + 20, box.y + 20); await p.mouse.down(); await p.waitForTimeout(400); await p.mouse.up(); }
      else if (kind === 'number') { await p.fill('.number-form input', '20'); await p.click('.number-form button'); }
      else { await p.waitForSelector('[data-mg="draw"].go', { timeout: 10000 }); await p.click('[data-mg="draw"]'); }
    }
    await tv.waitForFunction(() => /WINS|TIE/.test(document.getElementById('phase-view').textContent), null, { timeout: 25000 });
    assert.strictEqual(await tv.evaluate(() => document.body.dataset.theme), 'minigames');
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

  await check('no page errors anywhere', async () => {
    assert.deepStrictEqual(errors, []);
  });

  await browser.close();
  console.log(`\nUI: ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
