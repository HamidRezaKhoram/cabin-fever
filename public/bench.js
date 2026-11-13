/* Device speed check (/bench): a fixed workload shaped like the game's — JavaScript (dice, sorting,
 * state messages), page layout (fitting text) and pixel drawing — timed on this device. Compared with
 * the lab machine's time it gives the CPU factor for the Cottage Lab's simulated TV and phone
 * (test/lab/run.js PROFILES). `?base=<lab ms>` shows that factor here. AGPLv3 — see LICENSE. */
'use strict';
(function () {
  /** @param {number} a */
  const rng = (a) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  function js() {
    const r = rng(7);
    const xs = Array.from({ length: 60000 }, () => r());
    xs.sort((a, b) => a - b);
    const state = { phase: 'voting', players: Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, nickname: 'Player ' + i, score: i * 100, look: { hair: i, hat: 2 } })), gameState: { prompt: 'x'.repeat(120), choices: ['a', 'b', 'c', 'd'] } };
    let n = 0;
    for (let i = 0; i < 400; i++) n += JSON.parse(JSON.stringify(state)).players.length;
    return n;
  }
  function layout() {
    const box = /** @type {HTMLElement} */ (document.getElementById('bench-scratch'));
    box.innerHTML = Array.from({ length: 200 }, (_, i) => `<p style="font:16px sans-serif">Line ${i} — the quick brown fox jumps over the lazy loon</p>`).join('');
    let h = 0;
    for (let i = 0; i < 40; i++) { box.style.fontSize = (12 + (i % 10)) + 'px'; /** @type {HTMLElement} */ (box.firstElementChild).style.fontSize = (12 + (i % 7)) + 'px'; h += box.scrollHeight; }
    box.innerHTML = '';
    return h;
  }
  function draw() {
    const g = /** @type {CanvasRenderingContext2D} */ (/** @type {HTMLCanvasElement} */ (document.getElementById('bench-canvas')).getContext('2d'));
    const r = rng(3);
    for (let i = 0; i < 40000; i++) { g.fillStyle = i % 2 ? '#a9a3d9' : 'rgba(255,150,60,0.2)'; g.fillRect((r() * 320) | 0, (r() * 180) | 0, 2, 1); }
    return 0;
  }
  /** @param {() => unknown} f */
  const time = (f) => { const t0 = performance.now(); f(); return performance.now() - t0; };
  /** @param {number[]} a */
  const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  function run() {
    /** @type {Record<string, number[]>} */ const parts = { js: [], layout: [], draw: [] };
    for (let i = 0; i < 5; i++) { parts.js.push(time(js)); parts.layout.push(time(layout)); parts.draw.push(time(draw)); }
    const m = { js: median(parts.js), layout: median(parts.layout), draw: median(parts.draw) };
    const total = Math.round(m.js + m.layout + m.draw);
    const base = Number(new URLSearchParams(location.search).get('base'));
    /** @type {HTMLElement} */ (document.getElementById('bench-result')).textContent = `${total} ms` + (base > 0 ? ` — ${(total / base).toFixed(1)}× the lab machine` : '');
    /** @type {HTMLElement} */ (document.getElementById('bench-detail')).textContent = `JavaScript ${Math.round(m.js)} ms · layout ${Math.round(m.layout)} ms · drawing ${Math.round(m.draw)} ms (median of 5). ${navigator.userAgent}`;
    /** @type {any} */ (window).cfBench = { total, ...m };
  }
  // After the first paint, so loading doesn't count.
  setTimeout(run, 300);
})();
