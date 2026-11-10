/* Rumpus animated pixel background: night lake, cottage, pines, stars,
 * moon, fireflies. Rendered at 320×180 and scaled up (pixelated).
 * Runs on the shared 30 fps clock. The static scenery is painted once into
 * an offscreen layer; each frame only redraws the moving bits.
 * AGPLv3, see LICENSE.
 */
'use strict';

(function () {
  const W = 320, H = 180, HORIZON = 112;
  // Motion speeds were designed in "ticks"; 0.4 ticks per 30 fps frame keeps
  // the original pace while every frame now moves a little (smooth, no jumps).
  const TICKS_PER_FRAME = 0.4;

  function rand(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  function paintStatic(g, r) {
    const bands = ['#0d0b1e', '#120f2a', '#181437', '#1f1a45', '#272052', '#31275e', '#3d2f66'];
    const bh = Math.ceil(HORIZON / bands.length);
    bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * bh, W, bh); });
    for (let i = 1; i < bands.length; i++) {
      g.fillStyle = bands[i];
      for (let x = (i % 2); x < W; x += 2) g.fillRect(x, i * bh - 1, 1, 1);
    }
    // moon
    const disc = (cx, cy, rad, col) => {
      g.fillStyle = col;
      for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad) g.fillRect(cx + x, cy + y, 1, 1);
    };
    disc(262, 28, 11, '#fff6d5');
    [[-4, -3, 2], [3, 2, 3], [-2, 5, 1], [5, -5, 1]].forEach(([x, y, rr]) => disc(262 + x, 28 + y, rr, '#e8dcae'));
    // hills
    g.fillStyle = '#1a1735';
    for (let x = 0; x < W; x++) {
      const hy = HORIZON - 14 - Math.round(8 * Math.sin(x / 37) + 5 * Math.sin(x / 13 + 1) + 3 * Math.sin(x / 5));
      g.fillRect(x, hy, 1, HORIZON - hy);
    }
    // pines
    g.fillStyle = '#0f1a1f';
    for (let x = -6; x < W + 6; x += 5 + ((r() * 7) | 0)) {
      if (x > 196 && x < 252) continue;
      const h = 14 + ((r() * 18) | 0);
      for (let i = 0; i < h; i++) {
        const w = Math.max(1, Math.round((i / h) * (h / 2.2)) - ((i % 4 === 0) ? 1 : 0));
        g.fillRect(x - w, HORIZON - h + i, w * 2 + 1, 1);
      }
      g.fillRect(x, HORIZON, 1, 2);
    }
    // cottage
    const cx = 206;
    g.fillStyle = '#1b1426';
    g.fillRect(cx, HORIZON - 16, 34, 16);
    for (let i = 0; i < 12; i++) g.fillRect(cx - 3 + i, HORIZON - 16 - i, 40 - i * 2, 1);
    g.fillRect(cx + 25, HORIZON - 30, 4, 10);
    g.fillStyle = '#5a3b22';
    g.fillRect(cx + 14, HORIZON - 9, 5, 9);
    g.fillStyle = '#3a2a1a';
    g.fillRect(cx + 8, HORIZON, 30, 2);
    g.fillRect(cx + 36, HORIZON, 2, 4);
    // lake
    const lake = ['#141233', '#171538', '#1b183e', '#1f1b45'];
    for (let y = HORIZON; y < H; y++) {
      g.fillStyle = lake[Math.min(lake.length - 1, ((y - HORIZON) / 18) | 0)];
      g.fillRect(0, y, W, 1);
    }
  }

  function start(canvas) {
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const r = rand(42);
    const layer = document.createElement('canvas');
    layer.width = W; layer.height = H;
    paintStatic(layer.getContext('2d'), rand(7));

    const stars = Array.from({ length: 90 }, () => ({ x: (r() * W) | 0, y: (r() * (HORIZON - 30)) | 0, p: r() * 6.28, b: r() }));
    const flies = Array.from({ length: 14 }, () => ({ x: r() * W, y: HORIZON - 30 + r() * 26, vx: (r() - 0.5) * 0.12, vy: (r() - 0.5) * 0.08, p: r() * 6.28 }));
    let shooting = null;

    function draw(frame) {
      const t = frame * TICKS_PER_FRAME;
      g.drawImage(layer, 0, 0);
      for (const s of stars) {
        const tw = Math.sin(t / 6 + s.p) * 0.5 + 0.5;
        if (tw < 0.25 && s.b < 0.6) continue;
        g.fillStyle = tw > 0.85 && s.b > 0.7 ? '#ffffff' : '#a9a3d9';
        g.fillRect(s.x, s.y, 1, 1);
        if (s.b > 0.93 && tw > 0.8) { g.fillRect(s.x - 1, s.y, 3, 1); g.fillRect(s.x, s.y - 1, 1, 3); }
      }
      if (!shooting && Math.random() < 0.0016) shooting = { x: 40 + Math.random() * 180, y: 6 + Math.random() * 30, l: 0 };
      if (shooting) {
        g.fillStyle = '#ffffff';
        for (let i = 0; i < 8; i++) g.fillRect(Math.round(shooting.x - i * 2), Math.round(shooting.y - i), 1, 1);
        shooting.x += 1.6; shooting.y += 0.8; shooting.l++;
        if (shooting.l > 45) shooting = null;
      }
      // lit windows flicker
      g.fillStyle = Math.sin(t / 10) > -0.95 ? '#ffcf5a' : '#c9962e';
      g.fillRect(211, HORIZON - 11, 6, 5); g.fillRect(228, HORIZON - 11, 6, 5);
      // chimney smoke
      g.fillStyle = 'rgba(200,200,220,0.25)';
      for (let i = 0; i < 6; i++) {
        const yy = Math.round(HORIZON - 32 - i * 4 - ((t * 3) % 4));
        const xx = 233 + Math.round(Math.sin((t + i * 7) / 9) * 2) + i;
        g.fillRect(xx, yy, 3 + (i >> 1), 2);
      }
      // reflections + shimmer
      for (let y = HORIZON + 2; y < H; y += 2) {
        const wob = Math.round(Math.sin((y + t) / 3) * 2);
        const w = 4 + (Math.round(y * 7 + t) % 5);
        g.fillStyle = 'rgba(255,246,213,0.35)';
        g.fillRect(262 - (w >> 1) + wob, y, w, 1);
        if (y < HORIZON + 22) {
          g.fillStyle = 'rgba(255,207,90,0.35)';
          g.fillRect(211 + wob, y, 5, 1); g.fillRect(228 + wob, y, 5, 1);
        }
      }
      g.fillStyle = 'rgba(169,163,217,0.18)';
      for (let i = 0; i < 26; i++) {
        const x = Math.round((i * 53 + t * (1 + (i % 3))) % W);
        const y = HORIZON + 4 + ((i * 29) % (H - HORIZON - 6));
        g.fillRect(x, y, 3 + (i % 4), 1);
      }
      for (const f of flies) {
        f.x += f.vx + Math.sin((t + f.p * 10) / 15) * 0.06;
        f.y += f.vy + Math.cos((t + f.p * 10) / 20) * 0.04;
        if (f.x < 0) f.x = W; if (f.x > W) f.x = 0;
        if (f.y < HORIZON - 40) f.vy = Math.abs(f.vy); if (f.y > HORIZON + 4) f.vy = -Math.abs(f.vy);
        if (Math.sin(t / 4 + f.p * 3) > 0.2) {
          const x = Math.round(f.x), y = Math.round(f.y);
          g.fillStyle = '#d4ff6b';
          g.fillRect(x, y, 1, 1);
          g.fillStyle = 'rgba(212,255,107,0.25)';
          g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3);
        }
      }
    }

    draw(0);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { stop() {} };
    return { stop: window.Rumpus.clock.add(draw) };
  }

  window.Rumpus.background = start;
})();
