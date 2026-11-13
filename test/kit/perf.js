/*
 * Test kit — make a browser page behave like a cheaper device and measure how it feels.
 * No project knowledge: copy into any project (Playwright + Chromium).
 *   await device(page, { cpu: 4, latencyMs: 30 });   // CPU N× slower, slower network (CDP)
 *   await probe(page);                               // before goto: long tasks, input delay, DOM quiet
 *   const m = await take(page);                      // { longTasks, events, quietMaxMs, heapMb } and reset
 *   const ms = await tapLatency(page, '#btn');       // click → visible change → painted (ms)
 *   const stop = await cpuProfile(page); …; const top = await stop();  // top self-time functions
 *   stats([..]) → { n, median, p95, max }
 * Numbers from a throttled desktop are an estimate of the real device: calibrate the CPU factor
 * with a benchmark run on the real device (lab score ÷ device score) and record it with the results.
 */
'use strict';

/** @param {any} page @param {{ cpu?: number, latencyMs?: number, downKbps?: number, upKbps?: number }} p */
async function device(page, { cpu = 1, latencyMs = 0, downKbps = 0, upKbps = 0 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (latencyMs || downKbps || upKbps) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: latencyMs,
      downloadThroughput: downKbps ? (downKbps * 1024) / 8 : -1, uploadThroughput: upKbps ? (upKbps * 1024) / 8 : -1,
    });
  }
  return cdp;
}

/** Install the probes; call before page.goto. @param {any} page @param {string} [quietSel] what counts as "the screen changed" */
async function probe(page, quietSel = 'body') {
  await page.addInitScript((sel) => {
    /** @type {any} */ const P = { long: [], ev: [], last: 0, quietMax: 0 };
    /** @type {any} */ (window).__perf = P;
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => P.long.push(e.duration))).observe({ type: 'longtask', buffered: true }); } catch (e) { /* not supported */ }
    // Event Timing: input → next paint, per interaction (what INP is built from).
    try { new PerformanceObserver((l) => l.getEntries().forEach((/** @type {any} */ e) => { if (e.interactionId) P.ev.push(e.duration); })).observe(/** @type {any} */ ({ type: 'event', durationThreshold: 16, buffered: true })); } catch (e) { /* not supported */ }
    // Longest stretch with no content change (child/text mutations; style ticks don't count).
    const start = () => {
      const root = document.querySelector(sel) || document.body;
      P.last = performance.now();
      new MutationObserver(() => { const t = performance.now(); P.quietMax = Math.max(P.quietMax, t - P.last); P.last = t; })
        .observe(root, { subtree: true, childList: true, characterData: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }, quietSel);
}

/** Read and reset the probes. Heap only with `{ heap: true }` (reading it precisely is slow itself).
 * @param {any} page @param {{ heap?: boolean }} [opts] */
async function take(page, { heap = false } = {}) {
  return page.evaluate((withHeap) => {
    /** @type {any} */ const P = /** @type {any} */ (window).__perf;
    const m = withHeap ? /** @type {any} */ (performance).memory : null;
    if (!P) return { longTasks: [], events: [], quietMaxMs: 0, heapMb: 0 };
    const out = { longTasks: P.long.splice(0), events: P.ev.splice(0), quietMaxMs: Math.max(P.quietMax, performance.now() - P.last), heapMb: m ? m.usedJSHeapSize / 1048576 : 0 };
    P.quietMax = 0; P.last = performance.now();
    return out;
  }, heap);
}

/** Click `sel` and time it until the page visibly changed and painted (two frames later), or -1.
 * @param {any} page @param {string} sel @param {number} [timeoutMs] */
function tapLatency(page, sel, timeoutMs = 2000) {
  return page.evaluate(([s, ms]) => new Promise((resolve) => {
    const el = /** @type {HTMLElement | null} */ (document.querySelector(s));
    if (!el) return resolve(-1);
    const t0 = performance.now();
    const done = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
    const mo = new MutationObserver(() => { mo.disconnect(); clearTimeout(t); done(); });
    const t = setTimeout(() => { mo.disconnect(); resolve(-1); }, ms);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    el.click();
  }), [sel, timeoutMs]);
}

/** Start a CPU profile; the returned function stops it and gives the top self-time functions.
 * @param {any} page @param {number} [top] */
async function cpuProfile(page, top = 20) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  return async () => {
    const { profile } = await cdp.send('Profiler.stop');
    /** @type {Map<string, number>} */ const self = new Map();
    const dt = profile.timeDeltas || [];
    const byId = new Map(profile.nodes.map((/** @type {any} */ n) => [n.id, n]));
    (profile.samples || []).forEach((/** @type {number} */ id, /** @type {number} */ i) => {
      const f = byId.get(id).callFrame;
      const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
    });
    const gc = self.get('(garbage collector) :0') || 0;
    return [`(gc ${Math.round(gc)} ms)`, ...[...self.entries()].filter(([key]) => !/^\((idle|program|garbage collector|root)\)/.test(key))
      .sort((a, b) => b[1] - a[1]).slice(0, top).map(([key, ms]) => `${Math.round(ms)} ms  ${key}`)];
  };
}

/** @param {number[]} xs */
function stats(xs) {
  const s = xs.filter((x) => x >= 0).sort((a, b) => a - b);
  const q = (/** @type {number} */ f) => (s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : 0);
  return { n: s.length, median: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(s.length ? s[s.length - 1] : 0) };
}

module.exports = { device, probe, take, tapLatency, cpuProfile, stats };
