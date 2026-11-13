/*
 * Test kit — waiting without sleeps. No project knowledge: copy into any project.
 * Wait for the state you need (`until`) instead of sleeping and hoping.
 */
'use strict';

/** Resolve with fn()'s value once it's truthy (polls every 20 ms); reject after `ms`.
 * @template T @param {() => T} fn @param {string} [label] @param {number} [ms] @returns {Promise<T>} */
function until(fn, label = 'condition', ms = 8000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      let v;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return resolve(/** @type {T} */ (v));
      if (Date.now() - t0 > ms) return reject(new Error('timed out waiting for ' + label));
      setTimeout(poll, 20);
    })();
  });
}

/** The next `event` from an emitter (socket.io, EventEmitter, …); reject after `ms`.
 * @param {{ once(ev: string, fn: (msg: any) => void): unknown }} emitter @param {string} event @param {number} [ms] */
function once(emitter, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for '${event}'`)), ms);
    emitter.once(event, (msg) => { clearTimeout(t); resolve(msg); });
  });
}

/** Only for pacing (bots, load); never to wait for a result — use `until`. @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { until, once, sleep };
