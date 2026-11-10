/* Rumpus animated pixel background: night lake, cottage, pines, stars,
 * moon, fireflies. Rendered at low resolution and scaled up (pixelated).
 * AGPLv3, see LICENSE.
 */
'use strict';

(function () {
  const W = 320, H = 180;

  function rand(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  function start(canvas, opts = {}) {
    const fps = opts.fps || 12;
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const r = rand(42);
    const horizon = 112;

    const stars = Array.from({ length: 90 }, () => ({ x: (r() * W) | 0, y: (r() * (horizon - 30)) | 0, p: r() * 6.28, b: r() }));
    const hills = [];
    for (let x = 0; x < W; x++) hills.push(horizon - 14 - Math.round(8 * Math.sin(x / 37) + 5 * Math.sin(x / 13 + 1) + 3 * Math.sin(x / 5)));
    const pines = [];
    for (let x = -6; x < W + 6; x += 5 + ((r() * 7) | 0)) {
      if (x > 196 && x < 252) continue; // gap for the cottage
      pines.push({ x, h: 14 + ((r() * 18) | 0) });
    }
    const flies = Array.from({ length: 14 }, () => ({ x: r() * W, y: horizon - 30 + r() * 26, vx: (r() - 0.5) * 0.3, vy: (r() - 0.5) * 0.2, p: r() * 6.28 }));
    let shooting = null;
    let t = 0;
    let last = 0;
    let raf = null;

    function sky() {
      const bands = ['#0d0b1e', '#120f2a', '#181437', '#1f1a45', '#272052', '#31275e', '#3d2f66'];
      const bh = Math.ceil(horizon / bands.length);
      bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * bh, W, bh); });
      // dithered seams between bands
      for (let i = 1; i < bands.length; i++) {
        g.fillStyle = bands[i];
        for (let x = (i % 2); x < W; x += 2) g.fillRect(x, i * bh - 1, 1, 1);
      }
    }

    function moon() {
      const cx = 262, cy = 28, rad = 11;
      g.fillStyle = '#fff6d5';
      for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad) g.fillRect(cx + x, cy + y, 1, 1);
      g.fillStyle = '#e8dcae';
      [[-4, -3, 2], [3, 2, 3], [-2, 5, 1], [5, -5, 1]].forEach(([x, y, rr]) => {
        for (let yy = -rr; yy <= rr; yy++) for (let xx = -rr; xx <= rr; xx++) if (xx * xx + yy * yy <= rr * rr) g.fillRect(cx + x + xx, cy + y + yy, 1, 1);
      });
    }

    function pine(x, base, h, col) {
      g.fillStyle = col;
      for (let i = 0; i < h; i++) {
        const w = Math.max(1, Math.round((i / h) * (h / 2.2)) - ((i % 4 === 0) ? 1 : 0));
        g.fillRect(x - w, base - h + i, w * 2 + 1, 1);
      }
      g.fillRect(x, base, 1, 2);
    }

    function cottage(lit) {
      const x = 206, base = horizon;
      g.fillStyle = '#1b1426';
      g.fillRect(x, base - 16, 34, 16);            // walls
      for (let i = 0; i < 12; i++) g.fillRect(x - 3 + i, base - 16 - i, 40 - i * 2, 1); // roof
      g.fillRect(x + 25, base - 30, 4, 10);         // chimney
      g.fillStyle = lit ? '#ffcf5a' : '#c9962e';
      g.fillRect(x + 5, base - 11, 6, 5); g.fillRect(x + 22, base - 11, 6, 5); // windows
      g.fillStyle = '#5a3b22';
      g.fillRect(x + 14, base - 9, 5, 9);          // door
      g.fillStyle = '#3a2a1a';
      g.fillRect(x + 8, base, 30, 2);               // dock
      g.fillRect(x + 36, base, 2, 4);
    }

    function smoke() {
      g.fillStyle = 'rgba(200,200,220,0.25)';
      for (let i = 0; i < 6; i++) {
        const yy = horizon - 32 - i * 4 - ((t * 3) % 4);
        const xx = 233 + Math.round(Math.sin((t + i * 7) / 9) * 2) + i;
        g.fillRect(xx, yy, 3 + (i >> 1), 2);
      }
    }

    function draw() {
      sky();
      for (const s of stars) {
        const tw = Math.sin(t / 6 + s.p) * 0.5 + 0.5;
        if (tw < 0.25 && s.b < 0.6) continue;
        g.fillStyle = tw > 0.85 && s.b > 0.7 ? '#ffffff' : '#a9a3d9';
        g.fillRect(s.x, s.y, 1, 1);
        if (s.b > 0.93 && tw > 0.8) { g.fillRect(s.x - 1, s.y, 3, 1); g.fillRect(s.x, s.y - 1, 1, 3); }
      }
      moon();
      // shooting star
      if (!shooting && Math.random() < 0.004) shooting = { x: 40 + Math.random() * 180, y: 6 + Math.random() * 30, l: 0 };
      if (shooting) {
        g.fillStyle = '#ffffff';
        for (let i = 0; i < 8; i++) g.fillRect(Math.round(shooting.x - i * 2), Math.round(shooting.y - i), 1, 1);
        shooting.x += 4; shooting.y += 2; shooting.l++;
        if (shooting.l > 18) shooting = null;
      }
      // hills
      g.fillStyle = '#1a1735';
      hills.forEach((hy, x) => g.fillRect(x, hy, 1, horizon - hy));
      // pines
      pines.forEach((p) => pine(p.x, horizon, p.h, '#0f1a1f'));
      cottage(Math.sin(t / 10) > -0.95);
      smoke();
      // lake
      const lake = ['#141233', '#171538', '#1b183e', '#1f1b45'];
      for (let y = horizon; y < H; y++) {
        g.fillStyle = lake[Math.min(lake.length - 1, ((y - horizon) / 18) | 0)];
        g.fillRect(0, y, W, 1);
      }
      // reflections: moon column + cottage windows + shimmer
      for (let y = horizon + 2; y < H; y += 2) {
        const wob = Math.round(Math.sin((y + t) / 3) * 2);
        const w = 4 + ((y * 7 + t) % 5);
        g.fillStyle = 'rgba(255,246,213,0.35)';
        g.fillRect(262 - w / 2 + wob, y, w, 1);
        if (y < horizon + 22) {
          g.fillStyle = 'rgba(255,207,90,0.35)';
          g.fillRect(211 + wob, y, 5, 1); g.fillRect(228 + wob, y, 5, 1);
        }
      }
      g.fillStyle = 'rgba(169,163,217,0.18)';
      for (let i = 0; i < 26; i++) {
        const x = (i * 53 + t * (1 + (i % 3))) % W;
        const y = horizon + 4 + ((i * 29) % (H - horizon - 6));
        g.fillRect(x | 0, y, 3 + (i % 4), 1);
      }
      // fireflies
      for (const f of flies) {
        f.x += f.vx + Math.sin((t + f.p * 10) / 15) * 0.15;
        f.y += f.vy + Math.cos((t + f.p * 10) / 20) * 0.1;
        if (f.x < 0) f.x = W; if (f.x > W) f.x = 0;
        if (f.y < horizon - 40) f.vy = Math.abs(f.vy); if (f.y > horizon + 4) f.vy = -Math.abs(f.vy);
        if (Math.sin(t / 4 + f.p * 3) > 0.2) {
          g.fillStyle = '#d4ff6b';
          g.fillRect(f.x | 0, f.y | 0, 1, 1);
          g.fillStyle = 'rgba(212,255,107,0.25)';
          g.fillRect((f.x | 0) - 1, f.y | 0, 3, 1); g.fillRect(f.x | 0, (f.y | 0) - 1, 1, 3);
        }
      }
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / fps) return;
      last = now;
      t++;
      draw();
    }
    draw();
    if (fps > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(loop);
    return { stop: () => cancelAnimationFrame(raf) };
  }

  window.Rumpus.background = start;
})();
