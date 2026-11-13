/*
 * GitHub Pages build: make the game local after the first visit. Registers the service worker
 * (sw.js caches every file by content hash) and shows a progress bar while the files are saved.
 *  - TV: all game files first (blocking bar), then music + the narrator's voice in the background
 *    (a small corner meter) — after that the TV page needs no internet to load or play.
 *  - Phone: just the phone's own files (a few hundred KB).
 * Joining still needs the PeerJS broker for the introduction (see web/net.js). AGPLv3 — see LICENSE.
 */
'use strict';

/** Reloads are spaced out (a browser that can't take the new version must not loop). */
function mayReload() {
  try {
    const last = Number(sessionStorage.getItem('cf.reloadAt') || 0);
    if (Date.now() - last < 15000) return false;
    sessionStorage.setItem('cf.reloadAt', String(Date.now()));
  } catch (e) { return false; }
  return true;
}
/** People are playing on this page right now (set by host.js / play.js): don't reload under them. */
const busy = () => { try { return !!(/** @type {any} */ (window).cfBusy && /** @type {any} */ (window).cfBusy()); } catch (e) { return false; } };

/** @param {'tv' | 'phone'} role */
function offline(role) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  // Nothing saved on this device yet. (Only the TV and phone pages show the bar; /admin and
  // /highlights save quietly.)
  const page = /\/(host|play)(\.html)?$/.test(location.pathname);
  const hadController = !!navigator.serviceWorker.controller;
  let saved = false;
  try { saved = localStorage.getItem('cf.saved') === role; } catch (e) { saved = hadController; }
  const first = !saved && page;
  const markSaved = () => { try { localStorage.setItem('cf.saved', role); } catch (e) { /* private mode */ } };
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
  let updateNote = false;
  /** The fail-safe hid the bar: it stays hidden (later progress messages mustn't bring it back). */
  let gaveUp = false;
  if (first) {
    bar.hidden = false;
    /** @type {HTMLElement} */ (bar.querySelector('.cf-offline-title')).textContent = 'Loading Cabin Fever…';
    /** @type {HTMLElement} */ (bar.querySelector('.cf-offline-sub')).textContent = 'Saving the games on this device so they work without internet';
    failSafe = window.setTimeout(() => { gaveUp = true; bar.hidden = true; }, 60000); // never block the game on a slow network
  }
  // The TV asks the worker to save everything (it re-checks by hash, so this is cheap when saved).
  const askTv = () => {
    if (role !== 'tv') return;
    void navigator.serviceWorker.ready.then((reg) => { if (reg.active) reg.active.postMessage('cache-tv'); });
  };
  // Watchdog (TV): the browser stops a service worker that works on one job for ~5 minutes, and then
  // the saving just stops, short of 100%. If nothing has moved for 20 s, ask again: a live worker
  // only says how far it is, a stopped one starts again (skipping what's saved). After 5 asks with
  // no progress, give up quietly — anything missing is fetched the first time it's used.
  let lastMove = Date.now(), lastDone = -1, asks = 0;
  const unfinished = () => { const c = /** @type {any} */ (window).cfSaved || {}; return !(c.core === 100 && c.media === 100); };
  const watchdog = role === 'tv' ? window.setInterval(() => {
    if (!unfinished() || Date.now() - lastMove < 20000) return;
    if (asks >= 5) { window.clearInterval(watchdog); gaveUp = true; bar.hidden = true; if (!updateNote) corner.hidden = true; return; }
    asks++; lastMove = Date.now(); askTv();
  }, 5000) : 0;
  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.cf !== 'progress') return;
    const pct = m.total ? Math.round((m.done / m.total) * 100) : 100;
    const doneNow = (m.stage === 'media' ? 1e6 : 0) + m.done; // core counts before media
    if (doneNow !== lastDone) { lastDone = doneNow; lastMove = Date.now(); asks = 0; }
    /** @type {any} */ (window).cfSaved = { .../** @type {any} */ (window).cfSaved, [m.stage]: pct };
    if (m.stage === 'core' || (m.stage === 'phone' && role === 'phone')) {
      if (m.done < m.total && first && !gaveUp) bar.hidden = false; // (a saved game re-checks quietly)
      fill(bar).style.width = pct + '%';
      /** @type {HTMLElement} */ (bar.querySelector('.cf-offline-title')).textContent = `Loading Cabin Fever… ${pct}%`;
      if (m.done >= m.total) {
        if (failSafe) clearTimeout(failSafe);
        markSaved();
        setTimeout(() => { bar.hidden = true; }, 400);
      }
    } else if (m.stage === 'media') {
      if (updateNote) return;
      if (m.done >= m.total && m.noRoom) {
        // A private window (or a full disk) has no room for ~300 MB: say so once, then get out of the way.
        corner.hidden = false;
        corner.textContent = '💾 No room to save music & voice on this device — they\'ll play from the internet';
        setTimeout(() => { if (!updateNote) corner.hidden = true; }, 8000);
        return;
      }
      corner.hidden = m.done >= m.total;
      corner.textContent = `💾 Saving music & voice for offline · ${pct}%`;
    }
  });
  // A new worker took over this page. Two cases need the page loaded again:
  //  - an update: this page is still running the OLD saved files (the new ones load next time);
  //  - the TV's first visit: it wasn't served by the worker, so it isn't cross-origin isolated
  //    (the narrator's voice needs that to be fast).
  // Reload right away — unless people are already playing here; then say so and leave it to them.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!page) return;
    const need = hadController || (role === 'tv' && !window.crossOriginIsolated);
    if (!need) return;
    if (busy()) {
      if (role === 'tv') { updateNote = true; corner.hidden = false; corner.textContent = '🔄 Update ready — reload this page between games'; }
      return;
    }
    if (mayReload()) location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => { void reg.update().catch(() => {}); }).catch(() => { bar.hidden = true; });
  void navigator.serviceWorker.ready.then(() => {
    // Phone: an active worker means its files are saved. TV: now save the whole game.
    if (role === 'tv') {
      // The worker is in charge but this page wasn't served by it (it took over before we could
      // hear about it, or this was a hard reload): load again, once per tab, to be isolated.
      let tried = true;
      try { tried = !!sessionStorage.getItem('cf.isoTried'); sessionStorage.setItem('cf.isoTried', '1'); } catch (e) { /* no storage: don't loop */ }
      if (page && !window.crossOriginIsolated && !tried && !busy() && mayReload()) { location.reload(); return; }
      askTv();
      return;
    }
    if (failSafe) clearTimeout(failSafe);
    markSaved();
    setTimeout(() => { bar.hidden = true; }, 300);
    /** @type {any} */ (window).cfSaved = { core: 100, .../** @type {any} */ (window).cfSaved };
  });
}

module.exports = { offline };
