// The reusable test kit (test/kit/) checks itself: the flash meter and its PNG decoder, golden files,
// seeded randomness and the waits. AGPLv3 — see LICENSE.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { decodePng, luminance, flashMeter } = require('../kit/flash');
const { until, once, sleep } = require('../kit/wait');
const { seeded, mulberry32 } = require('../kit/seeded');
const { EventEmitter } = require('events');

/** A solid-colour image the meter can read. @param {number[]} rgb */
const solid = (rgb) => ({ w: 16, h: 12, px: () => rgb });

test('flash meter: black/white every 100 ms is 5 flashes a second; a steady screen or a slow fade is none', () => {
  const m = flashMeter();
  for (let i = 0; i < 20; i++) m.frame(solid(i % 2 ? [255, 255, 255] : [0, 0, 0]), i * 100);
  assert.ok(m.worst().perSecond >= 4, `strobe seen (${m.worst().perSecond}/s)`);
  m.reset();
  for (let i = 0; i < 20; i++) m.frame(solid([40, 40, 60]), i * 100);
  assert.strictEqual(m.worst().perSecond, 0, 'steady');
  m.reset();
  for (let i = 0; i < 20; i++) m.frame(solid([i * 12, i * 12, i * 12]), i * 100);
  assert.strictEqual(m.worst().perSecond, 0, 'a fade one way is not a flash');
  m.reset();
  // One lightning strike (two bright pulses, like Storm Watch) = 2 flashes: under the 3-per-second line.
  [0, 0, 255, 20, 230, 0, 0, 0].forEach((v, i) => m.frame(solid([v, v, v]), i * 100));
  assert.ok(m.worst().perSecond <= 3);
});

test('flash meter: a small flashing corner (under 10% of the screen) does not count', () => {
  const m = flashMeter();
  for (let i = 0; i < 20; i++) m.frame({ w: 16, h: 12, px: (x, y) => (x < 2 && y < 2 && i % 2 ? [255, 255, 255] : [0, 0, 0]) }, i * 100);
  assert.strictEqual(m.worst().perSecond, 0);
});

test('PNG decoder reads what zlib + filters write (RGB, all five filter types)', () => {
  const w = 3, h = 5, bpp = 3;
  const pixel = (/** @type {number} */ x, /** @type {number} */ y) => [x * 80, y * 50, (x + y) * 30];
  // Encode each row with a different filter (0–4), the way PNG writers do.
  const rows = [];
  const raw = (/** @type {number} */ y) => Buffer.from(Array.from({ length: w }, (_, x) => pixel(x, y)).flat());
  for (let y = 0; y < h; y++) {
    const f = y % 5, cur = raw(y), prev = y ? raw(y - 1) : Buffer.alloc(w * bpp), out = Buffer.alloc(w * bpp);
    for (let i = 0; i < cur.length; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[i] = (cur[i] - pred) & 255;
    }
    rows.push(Buffer.from([f]), out);
  }
  const chunk = (/** @type {string} */ type, /** @type {Buffer} */ data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
  const img = decodePng(png);
  assert.deepStrictEqual([img.w, img.h], [w, h]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.deepStrictEqual(img.px(x, y), pixel(x, y), `pixel ${x},${y}`);
  assert.ok(Math.abs(luminance([255, 255, 255]) - 1) < 1e-9 && luminance([0, 0, 0]) === 0);
});

test('waits: until resolves with the value, rejects with the label; once times out', async () => {
  let n = 0;
  assert.strictEqual(await until(() => (++n > 2 ? 'ready' : null), 'n'), 'ready');
  await assert.rejects(until(() => false, 'never', 60), /never/);
  const e = new EventEmitter();
  setTimeout(() => e.emit('ping', 7), 10);
  assert.strictEqual(await once(e, 'ping'), 7);
  await assert.rejects(once(e, 'pong', 30), /pong/);
  await sleep(1);
});

test('seeded: the same seed gives the same numbers; SEED overrides the fallback', () => {
  const a = mulberry32(42), b = mulberry32(42);
  assert.deepStrictEqual([a(), a(), a()], [b(), b(), b()]);
  const before = process.env.SEED;
  process.env.SEED = '99';
  try { assert.strictEqual(seeded('kit test', 1).seed, 99); } finally { if (before === undefined) delete process.env.SEED; else process.env.SEED = before; }
  assert.strictEqual(seeded('kit test', 5).seed, 5);
});
