// One side of scripts/net-matrix.sh (runs in a Playwright container):
//   node role.js tv            → hosts a room on the live TV page, prints ROOM <code>, keeps it up ~70 s
//   node role.js phone <code>  → joins <code> from the live phone page, prints whether it got in
//   node role.js relay         → can this network get a relay (TURN) address from the build's ICE servers?
'use strict';
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'https://hamidrezakhoram.github.io/cabin-fever/';

(async () => {
  const [role, code] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  try {
    if (role === 'tv') {
      await page.goto(BASE + 'host.html');
      await page.waitForFunction(() => /^[A-Z]{4}$/.test((document.getElementById('start-code') || {}).textContent || ''), null, { timeout: 60000 });
      await page.click('#start-overlay').catch(() => {});
      console.log('ROOM ' + await page.textContent('#start-code'));
      await page.waitForTimeout(70000);
    } else if (role === 'phone') {
      await page.goto(`${BASE}play.html?code=${code}`);
      await page.fill('#nick-input', 'Probe');
      await page.click('#join-form button[type="submit"]');
      const ok = await page.waitForSelector('#game-view:not([hidden])', { timeout: 45000 }).then(() => true, () => false);
      console.log(ok ? 'joined' : `NOT joined — "${await page.textContent('#join-error').catch(() => '')}"`);
    } else {
      await page.goto(BASE + 'play.html');
      const types = await page.evaluate(async () => {
        // The exact list the website build uses (web/net.js iceServers, plus CF_ICE_SERVERS if baked in).
        const servers = /** @type {any} */ (window).CABIN.iceServers();
        const pc = new RTCPeerConnection({ iceServers: servers });
        pc.createDataChannel('x');
        /** @type {Set<string>} */ const seen = new Set();
        pc.onicecandidate = (e) => { if (e.candidate) seen.add(e.candidate.type || '?'); };
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise((res) => { setTimeout(res, 8000); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') res(null); }; });
        pc.close();
        return [...seen];
      });
      console.log(types.includes('relay') ? 'available' : `NONE (candidates: ${types.join(', ')}) — phones on another network than the TV can't connect; set CF_ICE_SERVERS`);
    }
  } finally { await browser.close(); }
})();
