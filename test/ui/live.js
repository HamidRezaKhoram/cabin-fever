/*
 * Smoke test of the LIVE GitHub Pages site over the real PeerJS broker (needs internet):
 * a TV browser and two phone browsers (separate contexts = separate devices) play one round.
 * Not part of test-all (it depends on the internet and a third-party broker):
 *   ./scripts/test-live.sh [url]           AGPLv3 — see LICENSE.
 */
'use strict';
const assert = require('assert');
const { chromium, devices } = require('playwright');

const URL_BASE = (process.env.LIVE_URL || 'https://hamidrezakhoram.github.io/homejack/').replace(/\/?$/, '/');

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await tvCtx.newPage();
  tv.on('pageerror', (e) => errors.push('tv: ' + e.message));
  await tv.goto(URL_BASE + 'host.html');
  await tv.waitForFunction(() => /^[A-Z]{4}$/.test((document.getElementById('start-code') || {}).textContent || ''), null, { timeout: 30000 });
  const code = await tv.textContent('#start-code');
  console.log('  room', code);
  await tv.click('#start-overlay');
  const phones = [];
  for (const name of ['Ann', 'Ben']) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await p.goto(`${URL_BASE}play.html?code=${code}`);
    await p.fill('#nick-input', name);
    await p.click('#join-form button[type="submit"]');
    await p.waitForSelector('#game-view:not([hidden])', { timeout: 30000 });
    console.log('  ✔', name, 'joined over WebRTC');
    phones.push(p);
  }
  await tv.click('[data-game-id="closest"]');
  for (const [i, p] of phones.entries()) {
    await p.waitForSelector('.number-form input', { timeout: 20000 });
    await p.fill('.number-form input', String(10 + i));
    await p.click('.number-form button[type="submit"]');
  }
  await tv.waitForSelector('.big-answer', { timeout: 20000 });
  console.log('  ✔ a round played through the live site');
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('\nLive: OK');
})().catch((e) => { console.error(e); process.exit(1); });
