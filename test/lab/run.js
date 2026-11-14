/*
 * Cottage Lab (docs/future-features/feel-plan.md): plays every game on a simulated mid-range
 * Samsung TV and three mid-range Samsung phones, measures how each screen feels, and writes a
 * scorecard (out/report.md + out/report.json). Run: ./scripts/lab.sh [game,game…]
 * The device numbers are ESTIMATES until calibrated on the real TV and phone (see PROFILES).
 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const { flashMeter, sampleFlashes } = require('../kit/flash');
const { device, probe, take, tapLatency, cpuProfile, heapMb, audioProbe, takeAudio, stats } = require('../kit/perf');

const BASE = process.env.BASE_URL || 'http://localhost:18012';
const OUT = process.env.LAB_OUT || '/out';
// LAB_FLASH=1: a separate pass that screenshots the TV ~10×/s to count flashes (WCAG 2.3.1). It costs
// the TV time, so that pass's speed numbers don't count.
const FLASH = process.env.LAB_FLASH === '1';
const NO_NET = process.env.LAB_NO_NET === '1'; // experiment: no network emulation (it records every frame)
const ONLY = (process.env.LAB_GAMES || '').split(',').filter(Boolean);
const GAME_MS = Number(process.env.LAB_GAME_MS || 360000);

// Assumed devices (feel-plan.md §1). cpu = how many times slower than this machine: a guess until
// /bench is run on the real devices. Phones render at DPR 1 here: headless Chrome rasterises in
// software, so a 2.8× screen would measure this machine's CPU, not the phone's GPU.
const PROFILES = {
  tv: { name: '2022 Samsung Crystal UHD (Tizen 6.5, Chromium 85)', viewport: { width: 1920, height: 1080 }, cpu: 6, latencyMs: 15 },
  phone: { name: 'Galaxy A15 (Dimensity 6100+)', viewport: { width: 384, height: 832 }, cpu: 4, latencyMs: 30, isMobile: true, hasTouch: true },
};
// Budgets (feel-plan.md §2), checked per screen.
const BUDGET = { tapToTv: 150, peakDb: -1, phoneMaxFrame: 100, tapTarget: 44, tapP95: 80, inpMax: 200, longPerScreen: 2, longMax: 200, tvMaxFrame: 100, deadAir: 8000, minFontPx: 28, tvLoadMs: 5000, phoneJoinMs: 4000, menuPressesComputed: 8, heapGrowth: 0.2 };

/** @param {number[]} xs */
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : '–'; };
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
async function views(/** @type {string} */ code) { try { return await (await fetch(`${BASE}/api/debug/views?room=${code}`)).json(); } catch (e) { return null; } }

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
  /** @type {Record<string, any>} */ const report = { profiles: PROFILES, budget: BUDGET, startup: {}, screens: {}, games: {} };

  // --- Calibration (/bench): this machine as it is, then as the simulated TV and phone -------
  /** @param {any} prof */
  const bench = async (prof) => {
    const ctx = await browser.newContext({ viewport: prof ? prof.viewport : { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    if (prof) await device(p, { cpu: prof.cpu });
    await p.goto(BASE + '/bench');
    const r = await p.waitForFunction(() => /** @type {any} */ (window).cfBench, null, { timeout: 120000 }).then((h) => h.jsonValue());
    await ctx.close();
    return r.total;
  };
  report.calibration = { labMs: await bench(null), tvMs: await bench(PROFILES.tv), phoneMs: await bench(PROFILES.phone) };

  // --- TV: cold start to PRESS START (M6) --------------------------------------------------
  const tvCtx = await browser.newContext({ viewport: PROFILES.tv.viewport });
  const tv = await tvCtx.newPage();
  tv.on('dialog', (/** @type {any} */ d) => d.accept());
  await device(tv, PROFILES.tv);
  await probe(tv, '#phase-view');
  await audioProbe(tv);
  // Tap → TV (M2): the server-clock moment the TV's counter ("1 / 6 answers in") first moves on a screen.
  await tv.addInitScript(() => {
    /** @type {any} */ const C = { at: null };
    /** @type {any} */ (window).__count = C;
    document.addEventListener('DOMContentLoaded', () => {
      const pv = document.getElementById('phase-view');
      if (!pv) return;
      new MutationObserver(() => {
        if (C.at) return;
        const c = pv.querySelector('.count');
        const m = c && /^(\d+)\s*\//.exec((c.textContent || '').trim());
        if (m && Number(m[1]) > 0) C.at = window.Rumpus.time.now();
      }).observe(pv, { subtree: true, childList: true, characterData: true });
    });
  });
  let t0 = Date.now();
  await tv.goto(BASE + '/host?bots=1'); // not ?debug=1: the debug panel costs the TV seconds of CPU (it was half the profile)
  await tv.waitForFunction(() => /^[A-Z]{4}$/.test((document.getElementById('start-code') || {}).textContent || ''), null, { timeout: 60000 });
  report.startup.tvLoadMs = Date.now() - t0;
  const code = String(await tv.textContent('#start-code'));
  await tv.keyboard.press('Enter'); // the remote's OK button
  await tv.waitForSelector('#start-overlay', { state: 'hidden' });

  // --- 3 phones join (M6) ------------------------------------------------------------------
  const phones = [];
  for (const [i, nick] of ['Lab A', 'Lab B', 'Lab C'].entries()) {
    const ctx = await browser.newContext({ viewport: PROFILES.phone.viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await device(p, NO_NET ? { cpu: PROFILES.phone.cpu } : PROFILES.phone);
    await probe(p, '#game-view');
    t0 = Date.now();
    await p.goto(`${BASE}/play?code=${code}`);
    await p.fill('#nick-input', nick);
    await p.click('#join-form button[type=submit]');
    await p.waitForSelector('#game-view:not([hidden])', { timeout: 30000 });
    (report.startup.phoneJoinMs = report.startup.phoneJoinMs || []).push(Date.now() - t0);
    phones.push({ p, i, taps: /** @type {number[]} */ ([]) });
  }
  await tv.click('[data-act="bots"][data-n="3"]').catch(() => {}); // 6 players: every game can start
  await sleep(1500);
  // Short games: Rounds lives in ⚙ Settings. Pick the fewest rounds the select offers, then close the box.
  await tv.click('[data-act="more"]');
  await tv.waitForSelector('.settings-more:not([hidden]) #set-rounds');
  const fewest = await tv.$$eval('#set-rounds option', (os) => os.map((o) => /** @type {HTMLOptionElement} */ (o).value).filter((v) => v !== '').sort((a, b) => +a - +b)[0]);
  if (!fewest) throw new Error('lab: ⚙ Settings has no Rounds options');
  await tv.selectOption('#set-rounds', fewest);
  await tv.click('.settings-more .more-close');
  await tv.waitForSelector('.settings-more', { state: 'hidden' });
  report.startup.rounds = Number(fewest);

  // --- Menu by remote (M7): presses from the first card to every other card ------------------
  // COMPUTED from the shelf, not measured by pressing keys: the games are one shelf of cartridges and
  // ◀ ▶ wrap round (host.js), so from the first one the furthest is half the shelf away.
  report.startup.menuPressesComputed = await tv.evaluate(() => {
    const n = document.querySelectorAll('.shelf .game-pick').length;
    return Math.max(0, ...Array.from({ length: n }, (_, i) => Math.min(i, n - i)));
  });
  // CPU profiles (LAB_PROFILE=1): the TV, and one phone (they all run the same page).
  const stopTv = process.env.LAB_PROFILE ? await cpuProfile(tv, 25) : null;
  const stopPhone = process.env.LAB_PROFILE ? await cpuProfile(phones[0].p, 20) : null;
  await take(tv);
  /** Memory after the first game (once its assets are in), compared with the end of the run. */
  let heap0 = 0;

  /** Smallest text on the TV right now (null while a wipe or the fit is still settling). */
  const scanFont = (/** @type {string} */ phase) => tv.evaluate((phase) => {
        if (window.Rumpus.fx && window.Rumpus.fx.isWiping()) return null;
        // The server has moved on but the TV still shows the last screen (host.js sets data-phase).
        const pv = document.getElementById('phase-view');
        if (pv && pv.dataset.phase && pv.dataset.phase !== phase) return null;
        if (/** @type {any} */ (window).cfLayoutIdle && !/** @type {any} */ (window).cfLayoutIdle()) return null;
        let min = Infinity, who = '';
        // Mid-animation sizes (a podium rising, a card flipping) aren't what people read: skip them.
        const moving = document.getAnimations().filter((a) => a.playState === 'running').map((a) => /** @type {any} */ (a.effect).target).filter(Boolean);
        for (const el of document.querySelectorAll('#phase-view *')) {
          const h = /** @type {HTMLElement} */ (el);
          if (!h.childNodes.length || ![...h.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim())) continue;
          if (moving.some((m) => m.contains(h))) continue;
          const r = h.getBoundingClientRect();
          // What it really is on screen: font size × the stage zoom (host.js shrinkToStage).
          const px = parseFloat(getComputedStyle(h).fontSize) * (r.height / (h.offsetHeight || r.height));
          if (r.width && r.height && px < min) { min = px; who = `${h.tagName.toLowerCase()}.${[...h.classList].join('.')} "${(h.textContent || '').trim().slice(0, 30)}"`; }
        }
        return { px: min === Infinity ? 0 : Math.round(min), who };
      }, phase);

  const newScreen = () => ({ visits: 0, tvLong: [], tvEvents: [], phoneEvents: [], phoneLong: [], taps: [], deadAir: 0, maxFrame: 0, phoneMaxFrame: 0, minFont: Infinity, minTarget: Infinity, smallest: '', smallTarget: '', tapToTv: [], peakDb: -120, rmsDb: [], clipped: 0 });
  const games = /** @type {string[]} */ (await tv.$$eval('.game-pick', (els) => els.map((e) => /** @type {HTMLElement} */ (e).dataset.gameId || '')));
  const meter = flashMeter();
  // LAB_GAMES picks the games in its order, repeats allowed: `trivia,trivia,trivia` shows whether the TV's
  // memory levels off (caches) or keeps climbing (a leak) when the same game is played again.
  for (const gameId of ONLY.length ? ONLY.filter((g) => games.includes(g)) : games) {
    const g0 = Date.now();
    meter.reset();
    /** @type {[number, string][]} when each screen started (to name the screen of the worst flash) */
    const timeline = [];
    const stopFlash = FLASH ? await sampleFlashes(tv, meter, 100) : null;
    await tv.click(`.game-pick[data-game-id="${gameId}"]`).catch(() => {});
    let key = '', since = Date.now(), done = false, lastFont = 0;
    /** server-clock time of the first phone tap on this screen */ let firstTap = 0;
    /** @param {string} k */
    const close = async (k) => {
      if (!k) return;
      const m = await take(tv);
      const au = await takeAudio(tv);
      const tvAt = await tv.evaluate(() => /** @type {any} */ (window).__count.at);
      const clock = await tv.evaluate(() => window.Rumpus.clock.stats());
      const ph = await Promise.all(phones.map((x) => take(x.p)));
      const pc = await Promise.all(phones.map((x) => x.p.evaluate(() => {
        const c = window.Rumpus.clock.stats(); window.Rumpus.clock.resetStats();
        // Smallest thing you can tap: guidelines say ≥ 44–48 px (Apple 44 pt, Material 48 dp).
        let target = Infinity, what = '';
        for (const el of document.querySelectorAll('#game-view button:not([disabled]), #game-view [data-send], #game-view input, #game-view select')) {
          // A checkbox is tapped through its label: the label is the target.
          // Its layout size, not getBoundingClientRect(): a screen measured as it closes is often the next
          // one popping in (screen-in scales from 0.85), which made 48 px buttons read 41 px.
          const box = /** @type {HTMLElement} */ (el.closest('label') || el);
          if (!box.offsetWidth || !box.offsetHeight || /** @type {HTMLElement} */ (el).offsetParent === null) continue;
          const side = Math.min(box.offsetWidth, box.offsetHeight);
          if (side < target) { target = side; what = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent || '').trim().slice(0, 24)}"`; }
        }
        return { maxFrame: c.maxMs, target: target === Infinity ? 0 : Math.round(target), what };
      })));
      const s = report.screens[k] = report.screens[k] || newScreen();
      s.visits++; s.tvLong.push(...m.longTasks); s.tvEvents.push(...m.events);
      ph.forEach((x) => { s.phoneEvents.push(...x.events); s.phoneLong.push(...x.longTasks); });
      for (const c of pc) {
        s.phoneMaxFrame = Math.max(s.phoneMaxFrame, Math.round(c.maxFrame));
        if (c.target && c.target < s.minTarget) { s.minTarget = c.target; s.smallTarget = c.what; }
      }
      phones.forEach((x) => s.taps.push(...x.taps.splice(0)));
      s.deadAir = Math.max(s.deadAir, Math.round(m.quietMaxMs));
      if (firstTap && tvAt && tvAt >= firstTap) s.tapToTv.push(tvAt - firstTap);
      if (au.peakDb !== null) { s.peakDb = Math.max(s.peakDb, au.peakDb); s.rmsDb.push(au.rmsDb); s.clipped += au.clipped; }
      s.maxFrame = Math.max(s.maxFrame, Math.round(clock.maxMs));
      await tv.evaluate(() => window.Rumpus.clock.resetStats());
    };
    while (!done && Date.now() - g0 < GAME_MS) {
      const v = await views(code);
      const phase = v && v.host ? v.host.phase : '?';
      const k = `${gameId}:${phase}`;
      if (k !== key) { timeline.push([Date.now(), k]); await close(key); key = k; since = Date.now(); firstTap = 0; await tv.evaluate(() => { /** @type {any} */ (window).__count.at = null; }); }
      if (phase === 'gameover' || (phase === 'lobby' && Date.now() - g0 > 5000)) done = true;
      // The TV's text, sampled while the screen is settled (not mid-wipe), for the screen on show now.
      if (Date.now() - lastFont > 2000 && phase !== '?') {
        lastFont = Date.now();
        const f = await scanFont(phase);
        const s = report.screens[k] = report.screens[k] || newScreen();
        if (f && f.px && f.px < s.minFont) { s.minFont = f.px; s.smallest = f.who; }
      }
      // Each phone does what a person would: answer a form, or tap a choice.
      for (const x of phones) {
        const what = await x.p.evaluate((n) => {
          const gv = document.getElementById('game-view');
          if (!gv) return '';
          for (const el of gv.querySelectorAll('[data-lab-pick]')) el.removeAttribute('data-lab-pick');
          const inp = /** @type {HTMLInputElement | null} */ (gv.querySelector('form input:not([type=hidden]):not([disabled]), form textarea:not([disabled])'));
          if (inp && !inp.value && inp.offsetParent) {
            inp.value = inp.type === 'number' || /^(decimal|numeric)$/.test(inp.inputMode) || inp.pattern ? String(10 + n) : `lab answer ${n}`;
            const b = /** @type {HTMLElement | null} */ (inp.form && inp.form.querySelector('button[type=submit], button:not([type])'));
            if (b) { b.setAttribute('data-lab-pick', ''); return 'form'; }
          }
          const btns = /** @type {HTMLElement[]} */ ([...gv.querySelectorAll('[data-send]:not([disabled]):not(.sent)')]).filter((b) => b.offsetParent);
          if (!btns.length) return '';
          btns[Math.floor(Math.random() * btns.length)].setAttribute('data-lab-pick', '');
          return 'tap';
        }, x.i);
        if (what) {
          if (!firstTap) firstTap = await x.p.evaluate(() => window.Rumpus.time.now());
          const ms = await tapLatency(x.p, '[data-lab-pick]');
          if (ms >= 0) x.taps.push(ms); else x.missed = (x.missed || 0) + 1;
        }
      }
      await sleep(400);
    }
    await close(key);
    const heapNow = await heapMb(tv);
    (report.heapTrend = report.heapTrend || []).push([gameId, heapNow]);
    if (!heap0) heap0 = heapNow;
    if (stopFlash) {
      await stopFlash();
      const w = meter.worst();
      const at = [...timeline].reverse().find(([t]) => t <= w.at);
      (report.flash = report.flash || {})[gameId] = { perSecond: w.perSecond, screen: w.perSecond && at ? at[1] : null };
    }
    report.games[gameId] = { seconds: Math.round((Date.now() - g0) / 1000), finished: done };
    if (!done) await tv.click('[data-act="end"]').catch(() => {});
    await tv.click('[data-act="picknext"]').catch(() => {});
    await sleep(2500);
    void since;
  }
  if (stopTv) report.profile = await stopTv();
  if (stopPhone) report.phoneProfile = await stopPhone();
  report.startup.heapGrowth = heap0 ? ((await heapMb(tv)) - heap0) / heap0 : 0;

  // --- Scorecard ----------------------------------------------------------------------------
  const ok = (/** @type {boolean} */ b) => (b ? '✔' : '✖');
  const rows = [];
  let fails = 0;
  for (const [k, s] of Object.entries(report.screens)) {
    const tap = stats(s.taps), lt = stats(s.tvLong), inp = stats([...s.tvEvents, ...s.phoneEvents]);
    const long = s.tvLong.filter((/** @type {number} */ d) => d > 50).length / Math.max(1, s.visits);
    const checks = [tap.n === 0 || tap.p95 <= BUDGET.tapP95, inp.max <= BUDGET.inpMax, long <= BUDGET.longPerScreen && lt.max <= BUDGET.longMax, s.maxFrame <= BUDGET.tvMaxFrame, s.deadAir <= BUDGET.deadAir, !s.minFont || s.minFont === Infinity || s.minFont >= BUDGET.minFontPx, s.phoneMaxFrame <= BUDGET.phoneMaxFrame, s.minTarget === Infinity || s.minTarget >= BUDGET.tapTarget, stats(s.tapToTv).n === 0 || stats(s.tapToTv).p95 <= BUDGET.tapToTv, s.peakDb <= BUDGET.peakDb && s.clipped === 0];
    fails += checks.filter((c) => !c).length;
    rows.push(`| ${k} | ${tap.n ? `${tap.median}/${tap.p95}` : '–'} ${ok(checks[0])} | ${inp.max} ${ok(checks[1])} | ${long.toFixed(1)} · ${lt.max} ${ok(checks[2])} | ${s.maxFrame} ${ok(checks[3])} | ${(s.deadAir / 1000).toFixed(1)} ${ok(checks[4])} | ${s.minFont === Infinity ? '–' : s.minFont} ${ok(checks[5])} | ${s.phoneMaxFrame} ${ok(checks[6])} | ${s.minTarget === Infinity ? '–' : s.minTarget} ${ok(checks[7])} | ${stats(s.tapToTv).n ? `${stats(s.tapToTv).median}/${stats(s.tapToTv).p95}` : '–'} ${ok(checks[8])} | ${s.peakDb > -120 ? `${s.peakDb} · ${median(s.rmsDb)}${s.clipped ? ` · ${s.clipped} clipped` : ''}` : '–'} ${ok(checks[9])} |`);
    s.summary = { tap, inp, longPerVisit: long, longMax: lt.max };
  }
  const st = report.startup;
  const md = [
    '# Cottage Lab scorecard', '',
    `TV: ${PROFILES.tv.name}, CPU ÷${PROFILES.tv.cpu}. Phones: ${PROFILES.phone.name}, CPU ÷${PROFILES.phone.cpu}. **Estimates until calibrated on real devices.**`, '',
    `**Calibrate:** \`/bench\` takes ${report.calibration.labMs} ms on this machine (simulated TV ${report.calibration.tvMs} ms, phone ${report.calibration.phoneMs} ms). Open \`http://<server>:8012/bench?base=${report.calibration.labMs}\` on the real TV and phone: the "× the lab machine" it shows is the right \`cpu\` for PROFILES in test/lab/run.js.`, '',
    `- TV cold start → PRESS START: **${st.tvLoadMs} ms** ${ok(st.tvLoadMs <= BUDGET.tvLoadMs)} (budget ${BUDGET.tvLoadMs})`,
    `- Phone open → in the lobby: **${stats(st.phoneJoinMs).max} ms** worst ${ok(stats(st.phoneJoinMs).max <= BUDGET.phoneJoinMs)} (budget ${BUDGET.phoneJoinMs})`,
    `- Remote presses from the first game card to the furthest (computed from the shelf size, not measured): **${st.menuPressesComputed}** ${ok(st.menuPressesComputed <= BUDGET.menuPressesComputed)} (budget ${BUDGET.menuPressesComputed})`,
    `- Rounds per game: **${st.rounds}** (the fewest ⚙ Settings offers)`,
    `- TV memory (live heap after GC) from the first game to the end: **${Math.round(st.heapGrowth * 100)}%** ${ok(st.heapGrowth <= BUDGET.heapGrowth)} (budget ${BUDGET.heapGrowth * 100}%). After each game: ${(report.heapTrend || []).map(([g, mb]) => `${g} ${mb} MB`).join(' → ')}`,
    `- Games: ${Object.entries(report.games).map(([g, x]) => `${g} ${x.seconds}s${x.finished ? '' : ' (did not finish)'}`).join(', ')}`, '',
    `| screen | tap→paint median/p95 ms (≤${BUDGET.tapP95}) | worst input delay ms (≤${BUDGET.inpMax}) | TV long tasks per visit · max ms (≤${BUDGET.longPerScreen} · ≤${BUDGET.longMax}) | TV worst frame ms (≤${BUDGET.tvMaxFrame}) | dead air s (≤${BUDGET.deadAir / 1000}) | smallest TV text px (≥${BUDGET.minFontPx}) | phone worst frame ms (≤${BUDGET.phoneMaxFrame}) | smallest phone tap target px (≥${BUDGET.tapTarget}) | tap→TV median/p95 ms (≤${BUDGET.tapToTv}) | sound peak · loudness dBFS (peak ≤${BUDGET.peakDb}, no clipping) |`,
    '|---|---|---|---|---|---|---|---|---|---|---|', ...rows, '', `${fails} screen check(s) over budget.`, '',
    '**Smallest TV text per screen:**', ...Object.entries(report.screens).map(([k, s]) => `- ${k}: ${s.smallest || '–'}`),
    ...(report.flash ? ['', `**Flashes (WCAG 2.3.1: ≤ 3 in any second), worst per game:** ${Object.entries(report.flash).map(([g, f]) => `${g} ${f.perSecond}/s${f.perSecond > 3 ? ' ✖' : ' ✔'}${f.screen ? ` (${f.screen})` : ''}`).join(', ')}`, '_(flash pass: screenshots slow the TV, so this run\'s speed numbers don\'t count)_'] : []),
    '', '**Smallest phone tap target per screen:**', ...Object.entries(report.screens).map(([k, s]) => `- ${k}: ${s.smallTarget || '–'}`),
    ...(report.profile ? ['', '**TV CPU, top self time:**', '```', ...report.profile, '```'] : []),
    ...(report.phoneProfile ? ['', '**Phone CPU (one phone), top self time:**', '```', ...report.phoneProfile, '```'] : []),
  ].join('\n');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, (k, v) => (v === Infinity ? null : v), 1));
  fs.writeFileSync(`${OUT}/report.md`, md + '\n');
  console.log(md);
  // LAB_STRICT=1 (nightly): fail on what doesn't depend on how fast the machine is — text too small to
  // read, buttons too small to hit, clipping, flashing, a game that never ends. Timing stays report-only
  // until the device factors are calibrated with /bench (see the report's Calibrate line).
  const hard = [];
  for (const [k, sc] of Object.entries(report.screens)) {
    if (sc.minFont !== Infinity && sc.minFont < BUDGET.minFontPx) hard.push(`${k}: TV text ${sc.minFont}px (${sc.smallest})`);
    if (sc.minTarget !== Infinity && sc.minTarget < BUDGET.tapTarget) hard.push(`${k}: phone tap target ${sc.minTarget}px (${sc.smallTarget})`);
    if (sc.clipped) hard.push(`${k}: sound clipped ${sc.clipped}×`);
  }
  for (const [g, f] of Object.entries(report.flash || {})) if (f.perSecond > 3) hard.push(`${g}: ${f.perSecond} flashes in a second (${f.screen})`);
  for (const [g, x] of Object.entries(report.games)) if (!x.finished) hard.push(`${g}: did not reach the end`);
  if (hard.length) console.log(`\nHard checks over budget (fail with LAB_STRICT=1):\n- ${hard.join('\n- ')}`);
  await browser.close();
  if (hard.length && process.env.LAB_STRICT === '1') process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
