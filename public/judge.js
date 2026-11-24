/*
 * The Deep End's answer judge, TV side: starts public/judge-worker.js when the game starts (so the
 * model is loaded while people type) and asks it about off-chart answers. Optional: without the model
 * files (tts/judge/) the room just votes on every answer, as before.
 *   Rumpus.judge.warm()               load the model now (once)
 *   Rumpus.judge.ask(q, texts)        → Promise<(number | null)[] | null>: a score per answer, null = no judge
 *   Rumpus.judge.info                 {state: 'off' | 'loading' | 'ready' | 'none', ms}
 * AGPLv3 — see LICENSE.
 */
(function () {
  'use strict';
  const base = /** @type {any} */ (window).CABIN ? '' : '/';
  /** @type {Worker | null} */
  let worker = null;
  let seq = 0;
  /** @type {Map<number, (scores: (number | null)[] | null) => void>} */
  const waiting = new Map();
  const info = { state: /** @type {'off' | 'loading' | 'ready' | 'none'} */ ('off'), ms: 0, error: '' };
  let t0 = 0;

  function start() {
    if (worker || info.state === 'none') return worker;
    try { worker = new Worker(base + 'judge-worker.js'); } catch (e) { info.state = 'none'; return null; }
    info.state = 'loading';
    t0 = performance.now();
    worker.onmessage = (e) => {
      const d = e.data || {};
      if (d.ready) { info.state = 'ready'; info.ms = Math.round(performance.now() - t0); return; }
      if (d.error) { info.error = d.error; console.info('[judge] no answer judge:', d.error); }
      else if (info.state !== 'ready') { info.state = 'ready'; info.ms = Math.round(performance.now() - t0); }
      const done = waiting.get(d.id);
      waiting.delete(d.id);
      if (done) done(d.error ? null : d.scores);
    };
    worker.onerror = () => { info.state = 'none'; for (const done of waiting.values()) done(null); waiting.clear(); };
    worker.postMessage({ id: 0 });
    return worker;
  }

  /** @param {string} q @param {string[]} texts @returns {Promise<(number | null)[] | null>} */
  function ask(q, texts) {
    const w = start();
    if (!w) return Promise.resolve(null);
    const id = ++seq;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      w.postMessage({ id, q, texts });
      // Never hold the vote up: no answer within 20 s (a slow first download) = no judge this time.
      setTimeout(() => { if (waiting.delete(id)) resolve(null); }, 20000);
    });
  }

  window.Rumpus = window.Rumpus || /** @type {any} */ ({});
  window.Rumpus.judge = { warm: () => { start(); }, ask, info };
})();
