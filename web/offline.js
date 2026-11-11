/*
 * GitHub Pages build: make the game local after the first visit. Registers the service worker
 * (sw.js caches every file by content hash) and shows a progress bar while the files are saved.
 *  - TV: all game files first (blocking bar), then music + the narrator's voice in the background
 *    (a small corner meter) — after that the TV page needs no internet to load or play.
 *  - Phone: just the phone's own files (a few hundred KB).
 * Joining still needs the PeerJS broker for the introduction (see web/net.js). AGPLv3 — see LICENSE.
 */
'use strict';

/** @param {'tv' | 'phone'} role */
function offline(role) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  // Nothing saved on this device yet. (Only the TV and phone pages show the bar; /admin and
  // /highlights save quietly.)
  const first = !navigator.serviceWorker.controller && /\/(host|play)(\.html)?$/.test(location.pathname);
  const bar = document.createElement('div');
  bar.className = 'cf-offline';
  bar.hidden = true;
  bar.innerHTML = '<div class="cf-offline-box"><p class="cf-offline-title"></p><div class="cf-offline-track"><i></i></div><p class="cf-offline-sub"></p></div>';
  const corner = document.createElement('div');
  corner.className = 'cf-offline-corner';
  corner.hidden = true;
  const add = () => { document.body.appendChild(bar); document.body.appendChild(corner); };
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
  const fill = /** @type {(el: Element) => HTMLElement} */ (el) => /** @type {HTMLElement} */ (el.querySelector('i'));
  /** @type {number | null} */
  let failSafe = null;
  if (first) {
    bar.hidden = false;
    /** @type {HTMLElement} */ (bar.querySelector('.cf-offline-title')).textContent = 'Loading Cabin Fever…';
    /** @type {HTMLElement} */ (bar.querySelector('.cf-offline-sub')).textContent = 'Saving the games on this device so they work without internet';
    failSafe = window.setTimeout(() => { bar.hidden = true; }, 60000); // never block the game on a slow network
  }
  // The TV asks the worker to save everything (it re-checks by hash, so this is cheap when saved).
  const askTv = () => {
    if (role !== 'tv') return;
    void navigator.serviceWorker.ready.then((reg) => { if (reg.active) reg.active.postMessage('cache-tv'); });
  };
  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.cf !== 'progress') return;
    const pct = m.total ? Math.round((m.done / m.total) * 100) : 100;
    /** @type {any} */ (window).cfSaved = { .../** @type {any} */ (window).cfSaved, [m.stage]: pct };
    if (m.stage === 'core' || (m.stage === 'phone' && role === 'phone')) {
      if (m.done < m.total && first) bar.hidden = false; // (a saved game re-checks quietly)
      fill(bar).style.width = pct + '%';
      /** @type {HTMLElement} */ (bar.querySelector('.cf-offline-title')).textContent = `Loading Cabin Fever… ${pct}%`;
      if (m.done >= m.total) {
        if (failSafe) clearTimeout(failSafe);
        setTimeout(() => { bar.hidden = true; }, 400);
      }
    } else if (m.stage === 'media') {
      corner.hidden = m.done >= m.total;
      corner.textContent = `💾 Saving music & voice for offline · ${pct}%`;
    }
  });
  navigator.serviceWorker.register('sw.js').catch(() => { bar.hidden = true; });
  void navigator.serviceWorker.ready.then(() => {
    // Phone: an active worker means its files are saved. TV: now save the whole game.
    if (role === 'tv') { askTv(); return; }
    if (failSafe) clearTimeout(failSafe);
    setTimeout(() => { bar.hidden = true; }, 300);
    /** @type {any} */ (window).cfSaved = { core: 100, .../** @type {any} */ (window).cfSaved };
  });
}

module.exports = { offline };
