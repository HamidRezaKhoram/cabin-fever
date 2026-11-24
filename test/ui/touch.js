/*
 * Touch bots: real phone pages play every game from start to finish the way a person does — they
 * look at the screen, tap what's there (at its spot on the screen, with a finger: a covered button
 * gets the tap of whatever covers it), type lines, draw on the pads, mash the tap buttons, press
 * ▶ Next. The server bots (games/bot-brain.js) send answers straight to the server and never see the
 * phone page; these catch what they can't:
 *   - a tap that does nothing (a button without its listener, a control under another one),
 *   - an answer the TV turns down or that never reaches it,
 *   - a drawing that vanishes, doodles that never reach the TV, tap counts the TV doesn't credit,
 *   - a game that gets stuck before its game-over screen.
 * Two Android phones (Chromium, Pixel 7) and two iPhones (WebKit, iPhone 13) join, so both engines
 * play every screen. TOUCH_GAMES=trivia,crush picks games (default: every game).
 * Run inside the Playwright container against a running server (BASE_URL). AGPLv3 — see LICENSE.
 */
'use strict';
const { chromium, webkit, devices } = require('playwright');
const assert = require('assert');
const { suite } = require('../kit/browser');

const BASE = process.env.BASE_URL || 'http://localhost:18012';
const SHOTS = process.env.SHOTS || null;
const GAME_MS = Number(process.env.TOUCH_GAME_MS || 6 * 60 * 1000);
const LINES = ['a moose in a bathrobe', 'grandma\'s secret canoe', 'the loudest loon alive', 'wet socks forever', 'a raccoon with a plan',
  'too many marshmallows', 'the dock at 3 am', 'a haunted outhouse', 'my cousin\'s karaoke', 'a very confident goose'];

const t = suite({
  name: 'Touch bots', shots: SHOTS,
  async diagnose(pages) {
    for (const [i, pg] of pages.entries()) {
      const info = await pg.evaluate(() => ({
        url: location.pathname, errors: Rumpus.debug ? Rumpus.debug.errors() : [], log: Rumpus.debug ? Rumpus.debug.tail(20) : '',
        dom: (document.getElementById('phase-view') || document.getElementById('game-view') || document.body).innerHTML.replace(/\s+/g, ' ').slice(0, 900),
      })).catch((er) => ({ err: String(er) }));
      console.error(`\n  ---- page ${i} ${info.url || ''} errors=${JSON.stringify(info.errors || info.err)}\n  DOM: ${info.dom}\n${info.log || ''}`);
    }
  },
});
const { check, errors } = t;

/** In the phone page: watch what a tap does (DOM changes on the game screen, answers sent, the TV
 * turning one down). Installed once per page. */
function installProbe() {
  const w = /** @type {any} */ (window);
  if (w.__bot) return;
  const bot = w.__bot = { mut: 0, out: 0, refused: [], sent: [] };
  const gv = document.getElementById('game-view');
  new MutationObserver((list) => {
    for (const m of list) if (!(m.type === 'attributes' && m.attributeName === 'class')) bot.mut++;
  }).observe(gv, { subtree: true, childList: true, characterData: true, attributes: true });
  const sock = new Function('return socket')();
  bot.tapsSent = 0;
  sock.onAnyOutgoing((ev, msg) => {
    if (ev === 'player:submit' || ev === 'player:vote') { bot.out++; bot.sent.push(JSON.stringify(msg).slice(0, 120)); }
    if (ev === 'player:submit' && msg && msg.payload && Number.isInteger(msg.payload.tap)) bot.tapsSent += msg.payload.tap;
  });
  const banner = document.getElementById('banner') || document.querySelector('.banner');
  if (banner) new MutationObserver(() => { const s = banner.textContent || ''; if (/didn't take that|didn't reach the TV/.test(s) && !banner.hidden) bot.refused.push(s); }).observe(banner, { childList: true, characterData: true, subtree: true, attributes: true });
}

/** In the phone page: what is on the screen, and what a person would do next. */
function plan() {
  const w = /** @type {any} */ (window);
  const st = w.Rumpus.getState ? w.Rumpus.getState() : null;
  const gv = /** @type {HTMLElement} */ (document.getElementById('game-view'));
  const seen = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || getComputedStyle(el).visibility === 'hidden') return false;
    for (let p = /** @type {Element | null} */ (el); p; p = p.parentElement) if (/** @type {HTMLElement} */ (p).hidden || (p.tagName === 'DETAILS' && !(/** @type {HTMLDetailsElement} */ (p)).open && p !== el && !el.closest('summary'))) return false;
    return true;
  };
  let n = 0;
  /** Mark an element so the test can find its spot. @param {Element} el */
  const mark = (el) => { const id = 'b' + (++n); el.setAttribute('data-bot', id); return id; };
  document.querySelectorAll('[data-bot]').forEach((e) => e.removeAttribute('data-bot'));
  const info = { phase: st && st.phase, game: st && st.gameState && st.gameState.gameId, key: '' };
  if (!st || gv.hidden) return { ...info, kind: 'wait' };
  info.key = [st.phase, st.gameState && st.gameState.round, st.gameState && st.gameState.step].join('|');
  const q = (/** @type {string} */ s) => [...gv.querySelectorAll(s)].filter(seen);
  const one = (/** @type {string} */ s) => q(s)[0];
  // Drawing: fill the pad, then pass it on.
  const pad = one('#pad canvas');
  if (pad && one('#draw-done')) return { ...info, kind: 'draw', canvas: mark(pad), done: mark(one('#draw-done')) };
  const mg = (st.gameState && st.gameState.mini) || '';
  const tapBtn = one('[data-mg="tap"]');
  if (tapBtn && !tapBtn.classList.contains('done')) return { ...info, kind: 'mash', el: mark(tapBtn), mini: mg };
  const sides = q('[data-mg-side]');
  if (sides.length === 2) return { ...info, kind: 'paddle', l: mark(sides[0]), r: mark(sides[1]) };
  // A secret card you press and hold to read (Storm Watch roles): hold it once per screen.
  const peek = one('[data-hold]');
  if (peek && w.__bot.peeked !== info.key) { w.__bot.peeked = info.key; return { ...info, kind: 'peek', el: mark(peek) }; }
  const roast = one('[data-mg="roast"]');
  if (roast) return { ...info, kind: 'hold', el: mark(roast), ms: (st.gameState.target || 3000) };
  // Aim pads (Track the Ball, Angle Match, Split the Rope): touch the pad, then press Lock it in.
  const aim = one('[data-mg-aim]'), lock = one('[data-mg-lock]');
  if (aim && lock) return { ...info, kind: 'aim', el: mark(aim), lock: mark(lock) };
  const field = one('[data-mg-swat], [data-mg-stack]');
  if (field) return { ...info, kind: 'pokes', el: mark(field) };
  const bal = one('[data-mg-balance]');
  if (bal) return { ...info, kind: 'trace', el: mark(bal) };
  const steer = one('.ll-pad');
  if (steer) return { ...info, kind: 'trace', el: mark(steer) };
  const lc = one('.lc-tap');
  if (lc) return { ...info, kind: 'mash', el: mark(lc), mini: 'loon' };
  // A form to fill (answers, guesses, notes, replies).
  const form = q('form').find((f) => f.querySelector('input:not([type=hidden]), textarea') && !f.querySelector('button.sent'));
  const buttons = q('button:not(:disabled), [data-send]:not(:disabled)').filter((b) =>
    !b.matches('[data-lobby-maker], [data-shy], [data-team], [data-rate], [data-dd], [data-cr-to=""], [data-takeback], .ghost-btn[data-fill], #scribble-send, #draw-done, [data-hold], summary *') && !b.closest('form, .draw-tools, #lobby-maker'));
  const scribble = one('#scribble-pad canvas');
  const r = Math.random();
  if (scribble && one('#scribble-send') && (w.__bot.scribbled || 0) < 1) return { ...info, kind: 'doodle', canvas: mark(scribble), done: mark(one('#scribble-send')) };
  if (form && (!buttons.length || r < 0.5)) {
    const input = /** @type {HTMLInputElement} */ (form.querySelector('input:not([type=hidden]), textarea'));
    const btn = form.querySelector('button[type=submit], button:not([type])');
    if (btn && seen(btn)) return { ...info, kind: 'type', input: mark(input), btn: mark(btn), numeric: input.inputMode === 'numeric' || input.type === 'number' || form.classList.contains('number-form') };
  }
  if (buttons.length) {
    const b = buttons[Math.floor(Math.random() * buttons.length)];
    return { ...info, kind: 'tap', el: mark(b), label: (b.textContent || '').trim().slice(0, 40) || b.className };
  }
  // Nothing to do on the phone: press ▶ Next / Hurry like an impatient person, now and then.
  const pace = [...document.querySelectorAll('#pace-bar [data-pace="ready"]:not(:disabled), #pace-bar [data-pace="hurry"]:not(:disabled)')].filter(seen);
  if (pace.length && r < 0.4) return { ...info, kind: 'tap', el: mark(pace[0]), label: 'pace ' + /** @type {HTMLElement} */ (pace[0]).dataset.pace, pace: true };
  return { ...info, kind: 'wait' };
}

(async () => {
  const chrome = await chromium.launch();
  const safari = await webkit.launch();
  const tv = await chrome.newPage({ viewport: { width: 1400, height: 850 } });
  t.watch(tv, 'tv');
  let code = '';
  /** People think at different speeds: a new screen waits this long before they act (so the fast
   * ones wait on the slow ones — and doodle, wink and like while they do).
   * @type {{ page: any, name: string, kind: string, taps: number, think: number, key: string, since: number, slip: string }[]} */
  const phones = [];
  const THINK = [200, 2500, 900, 4000];
  const tvState = () => tv.evaluate(() => new Function('return state')());
  const host = (/** @type {string} */ ev, /** @type {any} */ msg) => tv.evaluate(([e, m]) => new Function('return socket')().emit(e, m), [ev, msg]);

  await check('TV opens a room', async () => {
    await tv.goto(BASE + '/host?debug=1');
    await tv.click('#start-overlay');
    await tv.waitForFunction(() => /^[A-Z]{4}$/.test(document.getElementById('room-code').textContent));
    code = await tv.textContent('#room-code');
  });

  await check('Android (Chrome engine) and iPhone (Safari engine) phones join with their finger', async () => {
    const who = [['Ana', chrome, 'Pixel 7', 'android'], ['Ivy', safari, 'iPhone 13', 'iphone'], ['Ari', chrome, 'Pixel 7', 'android'], ['Ike', safari, 'iPhone 13', 'iphone']];
    for (const [name, browser, device, kind] of /** @type {any[]} */ (who)) {
      // iPhone: WebKit with the iPhone's screen, user agent and touch. (Playwright's mobile-viewport mode
      // for WebKit can't scroll to a control below the screen — "element is outside of the viewport" —
      // which a real iPhone does without trouble, so that one switch stays off.)
      const ctx = await browser.newContext({ ...devices[device], ...(browser === safari ? { isMobile: false } : {}) });
      const page = await ctx.newPage();
      t.watch(page, name);
      page.on('dialog', (/** @type {any} */ d) => d.accept()); // "Submit a blank drawing?" etc.
      await page.goto(`${BASE}/play?code=${code}`);
      assert.strictEqual(await page.inputValue('#code-input'), code, `${kind}: the QR link fills the room code`);
      await page.fill('#nick-input', name);
      const go = await page.locator('#join-form button[type=submit]').boundingBox();
      await page.touchscreen.tap(go.x + go.width / 2, go.y + go.height / 2);
      await page.waitForSelector('#game-view:not([hidden]) .lobby-card', { timeout: 10000 });
      // An on-screen keyboard: typing in a field takes the bottom ~40% of the screen (Android resizes
      // the page; the fixed bars ride up on it), and it closes when the field loses focus — the
      // layout jump that ate the first tap on "Send".
      const full = page.viewportSize();
      await page.exposeFunction('__keyboard', async (/** @type {boolean} */ open) => {
        await page.setViewportSize(open ? { width: full.width, height: Math.round(full.height * 0.6) } : full).catch(() => {});
      });
      await page.evaluate(() => {
        const kb = /** @type {any} */ (window).__keyboard;
        let open = false;
        document.addEventListener('focusin', (e) => { if (!open && e.target instanceof Element && e.target.matches('input, textarea')) { open = true; void kb(true); } });
        document.addEventListener('focusout', () => setTimeout(() => {
          const a = document.activeElement;
          if (open && !(a && a.matches('input, textarea'))) { open = false; void kb(false); }
        }, 0));
      });
      await page.evaluate(installProbe);
      phones.push({ page, name, kind, taps: 0, think: THINK[phones.length], key: '', since: 0, slip: '' });
    }
    await tv.waitForFunction(() => document.querySelectorAll('#player-list li').length === 4);
    const ua = await Promise.all(phones.map((p) => p.page.evaluate(() => navigator.userAgent)));
    assert.ok(ua.some((u) => /Android/.test(u)) && ua.some((u) => /iPhone/.test(u)), 'both kinds of phone are in the room');
    await host('host:settings', { rounds: 1 });
    await host('host:settings', { timerScale: 0.6 });
  });

  /** Tap the centre of a marked element with a finger, checking nothing covers it. @param {any} page @param {string} id */
  const fingerAt = async (page, id) => {
    const loc = page.locator(`[data-bot="${id}"]`);
    if (!(await loc.count())) return null; // the screen changed under the finger: look again
    const screenKey = () => page.evaluate(() => { const st = /** @type {any} */ (window).Rumpus.getState(); return st ? JSON.stringify([st.phase, st.gameState && st.gameState.round, st.gameState && st.gameState.step, st.pace && st.pace.allowed]) : ''; });
    const key0 = await screenKey();
    // Under a fixed bar (on screen, so the browser won't scroll for it): a thumb swipes it up.
    await loc.evaluate((/** @type {Element} */ el) => {
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(b.height / 2, 30));
      if (top && (top === el || el.contains(top))) return;
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollBy(0, b.top + b.height / 2 - innerHeight * 0.4);
    }).catch(() => {});
    try {
      // Playwright's tap scrolls the control into view like the browser would, and refuses to tap if
      // another element would get the touch instead ("… intercepts pointer events").
      await loc.tap({ timeout: 4000 });
    } catch (e) {
      const msg = String(e && /** @type {any} */ (e).message || e);
      if (!(await loc.count()) || /detached|not attached/.test(msg)) return null;
      // The game moved on while the finger was on its way (a new screen, the button went away).
      if ((await screenKey()) !== key0 || !(await loc.isVisible().catch(() => false))) return null;
      // A control that keeps moving (text above it updating): a person taps where it is right now —
      // as long as nothing else is on that spot.
      if (/not stable/.test(msg) && !/intercepts/.test(msg)) {
        const spot = await loc.evaluate((/** @type {Element} */ el) => {
          const b = el.getBoundingClientRect();
          const x = b.left + b.width / 2, y = b.top + b.height / 2;
          const top = document.elementFromPoint(x, y);
          return top && (top === el || el.contains(top)) && y > 0 && y < innerHeight ? { x, y } : null;
        }).catch(() => null);
        if (spot) { await page.touchscreen.tap(spot.x, spot.y); return true; }
      }
      const phone = await page.evaluate(() => (navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Android'));
      const lines = msg.split('\n').map((l) => l.trim()).filter(Boolean);
      const cover = [...new Set(lines.filter((l) => /intercepts|not stable|outside|not visible|not enabled|hidden/.test(l)))].slice(0, 3).join(' | ') || lines.slice(0, 6).join(' | ');
      throw new Error(`${phone}: a finger can't reach [data-bot=${id}] ${await loc.evaluate((el) => el.outerHTML.slice(0, 120)).catch(() => '')}: ${cover}`);
    }
    return true;
  };
  /** @param {any} page */
  const probe = (page) => page.evaluate(() => { const b = /** @type {any} */ (window).__bot; return { mut: b.mut, out: b.out, refused: b.refused.length }; });
  /** A tap must do something: change the screen or send something to the TV. @param {any} page @param {{ mut: number, out: number }} before @param {string} what */
  const mustReact = async (page, before, what) => {
    const t0 = Date.now();
    for (;;) {
      const now = await probe(page);
      if (now.out > before.out || now.mut > before.mut) return now;
      if (Date.now() - t0 > 1500) throw new Error(`a tap did nothing: ${what} (no screen change, nothing sent)`);
      await page.waitForTimeout(100);
    }
  };
  /** Draw a few strokes on a canvas with a finger-like pointer. @param {any} page @param {string} id */
  const scrawl = async (page, id) => {
    const box = await page.locator(`[data-bot="${id}"]`).boundingBox({ timeout: 1000 }).catch(() => null);
    if (!box) return; // gone from the screen
    for (let s = 0; s < 3; s++) {
      const y = box.y + box.height * (0.25 + s * 0.25);
      await page.mouse.move(box.x + box.width * 0.15, y);
      await page.mouse.down();
      for (let k = 1; k <= 6; k++) await page.mouse.move(box.x + box.width * (0.15 + k * 0.12), y + Math.sin(k) * 20);
      await page.mouse.up();
    }
  };

  /** One person's next move. @param {typeof phones[number]} ph @param {any} notes */
  const turn = async (ph, notes) => {
    const p = ph.page;
    const a = await p.evaluate(plan);
    if (a.key !== ph.key) { ph.key = a.key; ph.since = Date.now(); }
    // Real-time screens (tap races, steering, rhythm) don't wait: everyone plays at once.
    const live = ['mash', 'paddle', 'pokes', 'trace', 'hold'].includes(a.kind);
    if (a.kind === 'wait' || (!live && !a.pace && Date.now() - ph.since < ph.think)) return;
    const before = await probe(p);
    const what = `${ph.name} (${ph.kind}) in ${a.game} ${a.phase}: ${a.kind}${a.label ? ` "${a.label}"` : ''}`;
    if (a.kind === 'tap') {
      if (!(await fingerAt(p, a.el))) return; // the screen changed under the finger: look again
      if (!a.pace) await mustReact(p, before, what);
    } else if (a.kind === 'type') {
      const box = await p.locator(`[data-bot="${a.input}"]`).boundingBox({ timeout: 1000 }).catch(() => null);
      if (!box) return; // gone from the screen: look again next turn
      await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await p.locator(`[data-bot="${a.input}"]`).fill(a.numeric ? String(1 + Math.floor(Math.random() * 60)) : `${LINES[Math.floor(Math.random() * LINES.length)]} ${ph.name.toLowerCase()}${Math.floor(Math.random() * 99)}`);
      await p.waitForTimeout(150); // the keyboard is up
      if (ph.kind === 'iphone') {
        // The finger lands on Send, the keyboard starts to close, the page jumps, and the finger lifts
        // somewhere else: the browser makes no click. (A test tap can't move the page mid-tap, so this
        // is played out directly.) The answer must still go.
        const ok = await p.locator(`[data-bot="${a.btn}"]`).evaluate((/** @type {Element} */ b) => {
          const r = b.getBoundingClientRect();
          const act = document.activeElement;
          b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
          return `typing in ${act ? act.tagName.toLowerCase() : 'nothing'}, now focused: ${document.activeElement ? document.activeElement.tagName.toLowerCase() + '.' + document.activeElement.className : 'nothing'}`;
        }).catch(() => null);
        if (!ok) return;
        ph.slip = ok;
      } else if (!(await fingerAt(p, a.btn))) return;
      // With the keyboard open, the FIRST tap on Send must send (it used to only close the keyboard).
      const t0 = Date.now();
      while ((await probe(p)).out === before.out) {
        if (Date.now() - t0 > 1500) {
          const gone = !(await p.locator(`[data-bot="${a.btn}"]`).count());
          if (gone) break; // the screen moved on (time's up) — nothing to judge
          throw new Error(`${what}: the first tap on Send didn't send (keyboard open)${ph.kind === 'iphone' ? ` — finger slipped; ${ph.slip}` : ''}`);
        }
        await p.waitForTimeout(100);
      }
    } else if (a.kind === 'draw' || a.kind === 'doodle') {
      await scrawl(p, a.canvas);
      if (!(await fingerAt(p, a.done))) return;
      const after = await mustReact(p, before, what);
      assert.ok(after.out > before.out, `${what}: the drawing was sent to the TV`);
      if (a.kind === 'doodle') { await p.evaluate(() => { /** @type {any} */ (window).__bot.scribbled = 1; }); notes.doodles++; }
      else {
        // The waiting screen shows what was passed on (it used to look like a wiped board).
        // (…unless that was the last drawing in: then the next step is already on screen.)
        await p.waitForFunction((/** @type {string} */ key) => {
          const st = /** @type {any} */ (window).Rumpus.getState();
          const now = [st.phase, st.gameState && st.gameState.round, st.gameState && st.gameState.step].join('|');
          return !!document.querySelector('.tel-sent img') || now !== key;
        }, a.key, { timeout: 5000 });
        notes.drawings++;
      }
    } else if (a.kind === 'mash') {
      const box = await p.locator(`[data-bot="${a.el}"]`).boundingBox({ timeout: 1000 }).catch(() => null);
      if (!box) return; // gone from the screen: look again next turn
      const n = a.mini === 'loon' ? 4 : 30;
      // What the phone shows the player they tapped (read while the race is on screen): the TV must
      // credit exactly that — a counter that drops back is a bug.
      const shown = () => p.evaluate(() => { const el = document.querySelector('[data-mg="tap"] ~ .mg-count'); return el ? Number(el.textContent) : null; });
      for (let i = 0; i < n; i++) {
        await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        if (a.mini === 'tug') { const v = await shown(); if (v === null) break; ph.taps = v; } else await p.waitForTimeout(350);
      }
      if (a.mini === 'tug') { await p.waitForTimeout(150); const v = await shown(); if (v !== null) ph.taps = v; }
    } else if (a.kind === 'paddle') {
      for (let i = 0; i < 20; i++) await fingerAt(p, i % 2 ? a.r : a.l);
    } else if (a.kind === 'hold') {
      const box = await p.locator(`[data-bot="${a.el}"]`).boundingBox({ timeout: 1000 }).catch(() => null);
      if (!box) return; // gone from the screen: look again next turn
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.down(); await p.waitForTimeout(Math.min(4000, a.ms)); await p.mouse.up();
      await mustReact(p, before, what);
    } else if (a.kind === 'peek') {
      const box = await p.locator(`[data-bot="${a.el}"]`).boundingBox({ timeout: 1000 }).catch(() => null);
      if (!box) return; // gone from the screen: look again next turn
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.down(); await p.waitForTimeout(900); await p.mouse.up();
    } else if (a.kind === 'pokes') {
      const box = await p.locator(`[data-bot="${a.el}"]`).boundingBox({ timeout: 1000 }).catch(() => null);
      if (!box) return; // gone from the screen: look again next turn
      for (let i = 0; i < 6; i++) { await p.touchscreen.tap(box.x + box.width * Math.random(), box.y + box.height * Math.random()); await p.waitForTimeout(120); }
    } else if (a.kind === 'aim') {
      const box = await p.locator(`[data-bot="${a.el}"]`).boundingBox({ timeout: 1000 }).catch(() => null);
      if (!box) return; // gone from the screen: look again next turn
      await p.touchscreen.tap(box.x + box.width * (0.1 + 0.8 * Math.random()), box.y + box.height * (0.1 + 0.8 * Math.random()));
      await p.waitForTimeout(200);
      if (!(await fingerAt(p, a.lock))) return;
      const after = await mustReact(p, before, what);
      assert.ok(after.out > before.out, `${what}: Lock it in sent the guess to the TV`);
    } else if (a.kind === 'trace') {
      const box = await p.locator(`[data-bot="${a.el}"]`).boundingBox({ timeout: 1000 }).catch(() => null);
      if (!box) return; // gone from the screen: look again next turn
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.down();
      for (let k = 0; k < 12; k++) { await p.mouse.move(box.x + box.width * (0.3 + 0.4 * Math.random()), box.y + box.height * (0.3 + 0.4 * Math.random())); await p.waitForTimeout(80); }
      await p.mouse.up();
    }
    const after = await probe(p);
    assert.strictEqual(after.refused, before.refused, `${what}: ${await p.evaluate(() => /** @type {any} */ (window).__bot.refused.slice(-1)[0])}`);
  };

  const state0 = await tvState();
  const all = state0.availableGames.map((/** @type {any} */ g) => g.id).filter((/** @type {string} */ id) => id !== 'night');
  const pick = (process.env.TOUCH_GAMES || '').split(',').filter(Boolean);
  const games = pick.length ? pick.filter((id) => all.includes(id)) : all; // repeats allowed (quiplash,quiplash)

  for (const id of games) {
    await check(`${id}: 2 Android + 2 iPhone phones play it start to finish by touch`, async () => {
      for (const ph of phones) { ph.taps = 0; await ph.page.evaluate(() => { const b = /** @type {any} */ (window).__bot; b.scribbled = 0; b.tapsSent = 0; }); }
      await host('host:startGame', { gameId: id });
      await tv.waitForFunction(() => { const s = new Function('return state')(); return s.phase !== 'lobby' && s.phase !== 'gameover'; }, null, { timeout: 10000 });
      const notes = { drawings: 0, doodles: 0, tvDoodles: 0, tug: /** @type {any} */ (null) };
      const t0 = Date.now();
      for (;;) {
        const s = await tvState();
        if (s.phase === 'gameover') break;
        assert.ok(Date.now() - t0 < GAME_MS, `${id} finished within ${GAME_MS / 60000} min (stuck on ${s.phase})`);
        if (id === 'telephone' && await tv.$('.scribble img[src^="data:"]')) notes.tvDoodles++;
        // Tug: what each phone tapped must be what the TV credits.
        if (s.phase === 'mg-result' && s.gameState.mini === 'tug' && !notes.tug) {
          notes.tug = s.gameState.result.rows.map((/** @type {any} */ r) => ({ name: r.nickname, value: r.value }));
          for (const ph of phones) {
            const row = notes.tug.find((/** @type {any} */ r) => r.name === ph.name);
            const sent = await ph.page.evaluate(() => /** @type {any} */ (window).__bot.tapsSent);
            assert.ok(row && row.value === ph.taps, `tug: ${ph.name}'s phone showed ${ph.taps} taps and sent ${sent}; the TV counted ${row && row.value}`);
          }
        }
        await Promise.all(phones.map((ph) => turn(ph, notes)));
        await tv.waitForTimeout(150);
      }
      if (id === 'telephone') {
        assert.ok(notes.drawings >= 1, 'drawings were passed on');
        assert.ok(notes.doodles >= 1 && notes.tvDoodles >= 1, `doodles floated on the TV (${notes.doodles} sent, seen ${notes.tvDoodles}×)`);
      }
      await tv.waitForSelector('#phase-view', { timeout: 5000 });
      for (const ph of phones) await ph.page.waitForSelector('#game-view h1:has-text("Game over")', { timeout: 8000 });
      assert.deepStrictEqual(errors, [], 'no page errors');
    });
  }

  await check('no page errors on the TV or any phone', async () => { assert.deepStrictEqual(errors, []); });
  t.done();
  await chrome.close();
  await safari.close();
})().catch((e) => { console.error(e); process.exit(1); });
