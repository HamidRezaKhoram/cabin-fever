/*
 * Test kit — photosensitive flash check on what a page really shows (canvas included), after WCAG 2.3.1:
 * no more than 3 general flashes in any one second. No project knowledge: copy into any project.
 *   const meter = flashMeter();
 *   const stop = sampleFlashes(page, meter, 100);   // tiny screenshots every 100 ms (CDP)
 *   …; await stop(); meter.worst() → { perSecond, at }
 * A "flash" here: a pair of opposing changes in relative luminance of ≥ 10% where the darker state is
 * below 0.8, in at least `minArea` of the screen at once (grid cells). Sampling at ~10 Hz sees flashing
 * up to ~5 Hz — enough for the 3-per-second line. Screenshots cost the page time: don't mix this pass
 * with speed measurements.
 */
'use strict';
const zlib = require('zlib');

/** Decode an 8-bit RGB/RGBA, non-interlaced PNG (what Chromium writes) → { w, h, px(x, y) → [r,g,b] }.
 * @param {Buffer} buf */
function decodePng(buf) {
  let pos = 8, w = 0, h = 0, type = 0;
  /** @type {Buffer[]} */ const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG'); }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!bpp) throw new Error('unsupported PNG colour type ' + type);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = y ? out[dst - stride + i] : 0, c = i >= bpp && y ? out[dst - stride + i - bpp] : 0;
      const x = raw[src + i];
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      out[dst + i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  return { w, h, px: (/** @type {number} */ x, /** @type {number} */ y) => [out[y * stride + x * bpp], out[y * stride + x * bpp + 1], out[y * stride + x * bpp + 2]] };
}

/** WCAG relative luminance of an sRGB colour (0–1). @param {number[]} rgb */
function luminance([r, g, b]) {
  const c = (/** @type {number} */ v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

/** Counts flashes from frames. @param {{ cols?: number, rows?: number, minArea?: number }} [o] */
function flashMeter({ cols = 8, rows = 6, minArea = 0.1 } = {}) {
  /** @type {number[] | null} */ let last = null;
  const dir = new Array(cols * rows).fill(0); // last change per cell: +1 brighter, -1 darker
  /** @type {number[]} */ const flashes = []; // times (ms) a flash completed over enough area
  let worst = { perSecond: 0, at: 0 };
  return {
    /** @param {{ w: number, h: number, px: (x: number, y: number) => number[] }} img @param {number} t ms */
    frame(img, t) {
      const lum = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let sum = 0, n = 0;
        for (let y = Math.floor((r * img.h) / rows); y < Math.floor(((r + 1) * img.h) / rows); y += 2) for (let x = Math.floor((c * img.w) / cols); x < Math.floor(((c + 1) * img.w) / cols); x += 2) { sum += luminance(img.px(x, y)); n++; }
        lum.push(n ? sum / n : 0);
      }
      if (last) {
        let completed = 0;
        lum.forEach((l, i) => {
          const prev = /** @type {number[]} */ (last)[i], d = l - prev;
          if (Math.abs(d) < 0.1 || Math.min(l, prev) >= 0.8) return;
          const s = Math.sign(d);
          if (dir[i] && s !== dir[i]) completed++; // an opposing pair = one flash in this cell
          dir[i] = s;
        });
        if (completed / (cols * rows) >= minArea) {
          flashes.push(t);
          while (flashes.length && flashes[0] < t - 1000) flashes.shift();
          if (flashes.length > worst.perSecond) worst = { perSecond: flashes.length, at: t };
        }
      }
      last = lum;
    },
    worst: () => worst,
    reset() { last = null; dir.fill(0); flashes.length = 0; worst = { perSecond: 0, at: 0 }; },
  };
}

/** Screenshot the page every `ms` (tiny: 5% scale) and feed the meter; returns stop().
 * @param {any} page @param {ReturnType<typeof flashMeter>} meter @param {number} [ms] */
async function sampleFlashes(page, meter, ms = 100) {
  const cdp = await page.context().newCDPSession(page);
  const vp = page.viewportSize() || { width: 1280, height: 720 };
  let on = true;
  const loop = (async () => {
    while (on) {
      const t0 = Date.now();
      try {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 0.05 } });
        meter.frame(decodePng(Buffer.from(data, 'base64')), t0);
      } catch (e) { /* page busy or navigating: skip a frame */ }
      await new Promise((r) => setTimeout(r, Math.max(0, ms - (Date.now() - t0))));
    }
  })();
  return async () => { on = false; await loop; await cdp.detach().catch(() => {}); };
}

module.exports = { decodePng, luminance, flashMeter, sampleFlashes };
