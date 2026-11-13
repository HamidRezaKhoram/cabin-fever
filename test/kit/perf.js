/*
 * Test kit — make a browser page behave like a cheaper device and measure how it feels.
 * No project knowledge: copy into any project (Playwright + Chromium).
 *   await device(page, { cpu: 4, latencyMs: 30 });   // CPU N× slower, slower network (CDP)
 *   await probe(page);                               // before goto: long tasks, input delay, DOM quiet
 *   const m = await take(page);                      // { longTasks, events, quietMaxMs, heapMb } and reset
 *   const ms = await tapLatency(page, '#btn');       // click → visible change → painted (ms)
 *   await audioProbe(page); … await takeAudio(page)  // peak/loudness dBFS + clipping of what it plays
 *   await heapMb(page)                              // live heap after a forced GC (leak checks)
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

/** Listen to everything the page plays: an analyser is wired beside the speakers (every connect() to
 * an AudioContext's destination also feeds it), sampled 10×/s. Call before page.goto.
 * @param {any} page */
async function audioProbe(page) {
  await page.addInitScript(() => {
    /** @type {any} */ const A = { peak: 0, sumSq: 0, n: 0, clipped: 0 };
    /** @type {any} */ (window).__audio = A;
    const taps = new WeakMap();
    const orig = AudioNode.prototype.connect;
    /** @this {AudioNode} @param {any} dest @param {...any} rest */
    function connect(dest, ...rest) {
      const out = /** @type {any} */ (orig).call(this, dest, ...rest);
      try {
        if (dest && dest === this.context.destination) {
          let an = taps.get(this.context);
          if (!an) {
            an = this.context.createAnalyser(); an.fftSize = 2048; taps.set(this.context, an);
            const buf = new Float32Array(an.fftSize);
            setInterval(() => {
              an.getFloatTimeDomainData(buf);
              let pk = 0, sq = 0;
              for (const v of buf) { const a = Math.abs(v); if (a > pk) pk = a; sq += v * v; }
              if (pk > 1e-4) { A.peak = Math.max(A.peak, pk); A.sumSq += sq / buf.length; A.n++; if (pk >= 0.999) A.clipped++; }
            }, 100);
          }
          /** @type {any} */ (orig).call(this, an);
        }
      } catch (e) { /* measuring must never break the page */ }
      return out;
    }
    /** @type {any} */ (AudioNode.prototype).connect = connect;
  });
}
/** Read and reset what audioProbe heard: loudest peak and average loudness (dBFS), clipped samples.
 * @param {any} page */
function takeAudio(page) {
  return page.evaluate(() => {
    /** @type {any} */ const A = /** @type {any} */ (window).__audio;
    if (!A || !A.n) return { peakDb: null, rmsDb: null, clipped: 0 };
    const db = (/** @type {number} */ x) => Math.round(20 * Math.log10(Math.max(x, 1e-6)) * 10) / 10;
    const out = { peakDb: db(A.peak), rmsDb: db(Math.sqrt(A.sumSq / A.n)), clipped: A.clipped };
    A.peak = 0; A.sumSq = 0; A.n = 0; A.clipped = 0;
    return out;
  });
}

/** Live JS heap in MB after a full garbage collection (what the page really keeps), via CDP.
 * @param {any} page */
async function heapMb(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return Math.round((usedSize / 1048576) * 10) / 10;
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

module.exports = { device, probe, take, tapLatency, cpuProfile, heapMb, audioProbe, takeAudio, stats };
