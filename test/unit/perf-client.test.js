'use strict';
/* Client performance fixes, checked with fake DOM/canvas stubs (no browser):
 * - bg.js honours its { fps } option and keeps motion speeds the same at any rate;
 * - debug.js does no JSON work and no latency pings while its panel is off, and skips 30 Hz frames;
 * - common.js esc() gives exactly what the old DOM-based version gave. */
const { test } = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------- bg.js
/** A 2D context that records fly-coloured 1×1 rects and counts full-layer pastes. */
function fakeCanvas(rec) {
  const c = { width: 0, height: 0 };
  const g = new Proxy({ fillStyle: '' }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'drawImage') return (img) => { if (rec && img === rec.layer()) rec.paints++; };
      if (k === 'fillRect') return (x, y, w, h) => { if (rec && rec.on && t.fillStyle === rec.fly && w === 1 && h === 1) rec.flies.push([x, y]); };
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  c.getContext = () => g;
  return c;
}
function loadBg(fps) {
  const subs = new Set();
  const made = [];
  const rec = { paints: 0, flies: [], on: false, fly: '#d4ff6b', layer: () => made[0] };
  global.matchMedia = () => ({ matches: false });
  global.document = { createElement: () => { const c = fakeCanvas(rec); made.push(c); return c; } };
  global.window = { Rumpus: { clock: { add: (fn) => { subs.add(fn); return () => subs.delete(fn); } } } };
  delete require.cache[require.resolve('../../public/bg.js')];
  require('../../public/bg.js');
  const scene = window.Rumpus.background(fakeCanvas(rec), fps ? { fps } : undefined);
  let frame = 0;
  const run = (n) => { for (let i = 0; i < n; i++) { frame++; for (const fn of subs) fn(frame); } };
  return { scene, rec, run };
}

test('bg.js draws every round(30 / fps) clock frames (TV 12 → every 3rd, phone 4 → every 8th)', () => {
  for (const [fps, every] of [[undefined, 1], [30, 1], [12, 3], [4, 8]]) {
    const { scene, rec, run } = loadBg(fps);
    assert.strictEqual(scene.step, every);
    const before = rec.paints;
    run(240);
    assert.strictEqual(rec.paints - before, 240 / every, `fps ${fps}: ${rec.paints - before} drawings in 240 frames`);
  }
});

test('bg.js: fireflies move at the same speed whatever the drawing rate', () => {
  const at = (fps) => {
    const rnd = Math.random; Math.random = () => 0.99; // no shooting star
    try {
      const { rec, run } = loadBg(fps);
      run(191); rec.on = true; run(1); // frame 192 is drawn at every rate (a multiple of 1, 3 and 8) and has 9 lit
      return rec.flies.slice(); // drawn in the flies' array order, so the same index is the same firefly
    } finally { Math.random = rnd; }
  };
  const full = at(undefined), tv = at(12), phone = at(4);
  assert.ok(full.length >= 3, 'some fireflies are lit');
  for (const other of [tv, phone]) {
    assert.strictEqual(other.length, full.length, 'the same fireflies are lit');
    // x wraps at the screen edge (0 and 320 are the same place), so measure the short way round
    const dx = (a, b) => { const d = Math.abs(a - b) % 320; return Math.min(d, 320 - d); };
    const off = full.reduce((sum, [x, y], i) => sum + dx(x, other[i][0]) + Math.abs(y - other[i][1]), 0) / full.length;
    assert.ok(off < 2, `fireflies within 2 px of the 30 fps path (off by ${off.toFixed(2)})`);
  }
});

// ---------------------------------------------------------------- debug.js
function loadDebug(search) {
  const timers = [];
  const sent = [];
  const handlers = { any: null, out: null };
  const sock = {
    id: 'x', connected: true,
    on() {}, onAny(fn) { handlers.any = fn; }, onAnyOutgoing(fn) { handlers.out = fn; },
    timeout() { return { emit: (ev) => sent.push(ev) }; },
    volatile: { emit: (ev) => sent.push(ev) },
    emit: (ev) => sent.push(ev),
  };
  const el = () => ({ style: {}, innerHTML: '', textContent: '', firstChild: { textContent: '' }, lastChild: { innerHTML: '', scrollTop: 0, scrollHeight: 0 } });
  const origSetInterval = global.setInterval, origError = console.error, origDebug = console.debug;
  global.setInterval = (fn) => { timers.push(fn); return 0; };
  console.debug = () => {};
  global.location = { search, pathname: '/host' };
  global.localStorage = { _: {}, getItem(k) { return this._[k] || null; }, setItem(k, v) { this._[k] = v; }, removeItem(k) { delete this._[k]; } };
  global.document = { createElement: el, head: { appendChild() {} }, body: { appendChild() {} } };
  global.window = { io: () => sock, addEventListener() {}, Rumpus: {} };
  try {
    delete require.cache[require.resolve('../../public/debug.js')];
    require('../../public/debug.js');
    window.io(); // the latency probe's interval is set up here: it must land in `timers`, not keep node alive
  } finally { global.setInterval = origSetInterval; }
  const restore = () => { console.error = origError; console.debug = origDebug; };
  return { handlers, timers, sent, debug: window.Rumpus.debug, restore };
}
/** A payload that counts how often it is serialised. */
const counted = () => { const p = { n: 0, toJSON() { p.n++; return { big: 'x'.repeat(50) }; } }; return p; };

test('debug.js with the panel off: no JSON work, no latency pings, no 30 Hz frames in the log', () => {
  const { handlers, timers, sent, debug, restore } = loadDebug('');
  try {
    assert.strictEqual(debug.isEnabled(), false);
    const p = counted();
    for (let i = 0; i < 30; i++) handlers.any('room:frame', p);
    handlers.any('room:event', p);
    handlers.any('room:stateUpdate', { phase: 'lobby', players: [], gameState: { round: 1, big: p } });
    handlers.out('player:submit', p);
    handlers.out('k', undefined);
    assert.strictEqual(p.n, 0, 'payloads are never stringified while the panel is off');
    for (const fn of timers) fn();
    assert.deepStrictEqual(sent, [], 'no debug:ping while the panel is off');
    const tail = debug.tail(50);
    assert.ok(!/room:frame/.test(tail) && !/▶ k\b/.test(tail), 'frames and keep-warm are not logged');
    assert.match(tail, /◀ room:event/, 'event names stay in the log (failed tests print it)');
    assert.match(tail, /PHASE/, 'phase changes stay in the log');
    assert.match(tail, /▶ player:submit/);
  } finally { restore(); }
});

test('debug.js with the panel on: payloads are logged and the latency probe runs', () => {
  const { handlers, timers, sent, debug, restore } = loadDebug('?debug=1');
  try {
    assert.strictEqual(debug.isEnabled(), true);
    const p = counted();
    handlers.any('room:event', p);
    handlers.any('room:frame', p);
    assert.strictEqual(p.n, 1, 'the event payload is logged once; frames are skipped even with the panel on');
    for (const fn of timers) fn();
    assert.ok(sent.includes('debug:ping'), 'latency probe pings');
  } finally { restore(); }
});

// ---------------------------------------------------------------- common.js esc()
/** The old esc(): a div's textContent read back through innerHTML (the HTML fragment serializer
 * escapes & < > and U+00A0 in text), then " → &quot;. */
function oldEsc(s) {
  const text = String(s == null ? '' : s);
  return text.replace(/[&\u00a0<>]/g, (c) => ({ '&': '&amp;', '\u00a0': '&nbsp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/"/g, '&quot;');
}

test('esc() gives the same output as the old DOM-based version', () => {
  global.window = {};
  global.document = {};
  delete require.cache[require.resolve('../../public/common.js')];
  require('../../public/common.js');
  const { esc } = window.Rumpus;
  const inputs = [
    '', 'plain', 'Ann & Bob', '<script>alert("x")</script>', "it's", 'a\u00a0b', '&amp; already', '"quoted"',
    '>>><<<', 'emoji 🦝🐦 ok', 'line\nbreak\ttab\r', 'é ü ñ 日本', '\u0000nul', '\ud800 lone surrogate', 'a b',
    null, undefined, 0, 42, -1.5, true, false, NaN, ['a', '<b>'], { toString: () => '<obj & "x">' },
  ];
  for (const x of inputs) assert.strictEqual(esc(x), oldEsc(x), `esc(${JSON.stringify(String(x))})`);
  assert.strictEqual(esc('<a href="x">Tom & Jerry\u00a0</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&nbsp;&lt;/a&gt;');
  assert.strictEqual(esc("O'Neil"), "O'Neil", "' was never escaped: output unchanged");
  assert.strictEqual(esc(null), '');
  assert.strictEqual(esc(undefined), '');
});
