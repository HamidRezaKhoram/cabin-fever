/* Rumpus visual effects: pixel-block screen wipes, pixel confetti, floating
 * emoji reactions and score pop-ups. AGPLv3, see LICENSE.
 */
'use strict';

(function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clock = () => window.Rumpus.clock;

  // ---- Pixel wipe: blocks fill the screen in random order, then clear.
  // 9 frames in + 9 frames out at 30 fps (~0.6 s total).
  const WIPE_FRAMES = 9;
  let wipeCanvas = null;
  let wipeState = null;
  function wipe(midpoint, colors = ['#ffb02e', '#5ee0a0', '#ff5d73', '#7c5cff', '#14121f']) {
    if (reduced) { midpoint(); return; }
    if (wipeState) {
      // Already wiping. Before the middle: swap in the newest screen there.
      // Past the middle: the screen was already swapped, so apply this one now
      // (otherwise the callback would never run and the TV would freeze).
      if (wipeState.f < WIPE_FRAMES) wipeState.midpoint = midpoint;
      else midpoint();
      return;
    }
    if (!wipeCanvas) {
      wipeCanvas = document.createElement('canvas');
      wipeCanvas.className = 'wipe';
      document.body.appendChild(wipeCanvas);
    }
    const cols = 32, rows = 18;
    wipeCanvas.width = cols; wipeCanvas.height = rows;
    const g = wipeCanvas.getContext('2d');
    const cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push([x, y, (x + y * 0.6) / (cols + rows * 0.6) + Math.random() * 0.25]);
    cells.sort((p, q) => p[2] - q[2]);
    const col = colors[(Math.random() * colors.length) | 0];
    wipeState = { midpoint, f: 0 };
    wipeCanvas.style.display = 'block';
    const off = clock().add(() => {
      const st = wipeState;
      st.f++;
      g.clearRect(0, 0, cols, rows);
      g.fillStyle = col;
      if (st.f <= WIPE_FRAMES) {
        const n = Math.round((st.f / WIPE_FRAMES) * cells.length);
        for (let i = 0; i < n; i++) g.fillRect(cells[i][0], cells[i][1], 1, 1);
        if (st.f === WIPE_FRAMES) st.midpoint();
      } else {
        const n = Math.round(((st.f - WIPE_FRAMES) / WIPE_FRAMES) * cells.length);
        for (let i = n; i < cells.length; i++) g.fillRect(cells[i][0], cells[i][1], 1, 1);
        if (st.f >= WIPE_FRAMES * 2) {
          off();
          wipeCanvas.style.display = 'none';
          wipeState = null;
        }
      }
    });
  }
  const isWiping = () => !!wipeState;

  // ---- Confetti: chunky pixel squares with gravity, stepped at 30 fps.
  let confCanvas = null, parts = [], confOff = null;
  function confetti(n = 160) {
    if (reduced) return;
    if (!confCanvas) {
      confCanvas = document.createElement('canvas');
      confCanvas.className = 'confetti';
      document.body.appendChild(confCanvas);
    }
    const W = 320, H = 180;
    confCanvas.width = W; confCanvas.height = H;
    const cols = ['#ffb02e', '#5ee0a0', '#ff5d73', '#7c5cff', '#4fc3f7', '#ffd23f', '#ffffff'];
    for (let i = 0; i < n; i++) {
      parts.push({ x: W / 2 + (Math.random() - 0.5) * 120, y: H + 4, vx: (Math.random() - 0.5) * 8, vy: -6 - Math.random() * 9,
        c: cols[(Math.random() * cols.length) | 0], s: Math.random() < 0.3 ? 2 : 1, life: 70 + Math.random() * 30 });
    }
    if (confOff) return;
    const g = confCanvas.getContext('2d');
    confCanvas.style.display = 'block';
    confOff = clock().add(() => {
      g.clearRect(0, 0, W, H);
      parts = parts.filter((p) => p.life-- > 0 && p.y < H + 10);
      for (const p of parts) {
        p.vy += 0.36; p.vx *= 0.98; p.x += p.vx; p.y += p.vy;
        g.fillStyle = p.c;
        g.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
      }
      if (!parts.length) { confOff(); confOff = null; confCanvas.style.display = 'none'; }
    });
  }

  // ---- Floating emoji reaction with the sender's avatar.
  function reaction(emoji, avatarUrl, name) {
    const el = document.createElement('div');
    el.className = 'reaction';
    el.style.left = (8 + Math.random() * 78) + '%';
    el.innerHTML = `<span class="r-emoji">${emoji}</span>` +
      (avatarUrl ? `<img class="avatar tiny" src="${avatarUrl}" alt=""><span class="r-name">${name}</span>` : '');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ---- "+300" pop-up next to an element.
  function scorePop(el, delta) {
    if (!el || !delta) return;
    const r = el.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'score-pop' + (delta < 0 ? ' neg' : '');
    pop.textContent = (delta > 0 ? '+' : '') + delta;
    pop.style.left = (r.left + r.width - 20) + 'px';
    pop.style.top = (r.top) + 'px';
    document.body.appendChild(pop);
    setTimeout(() => pop.remove(), 1600);
  }

  // ---- Big banner that slams in (e.g. "FINAL ROUND! DOUBLE POINTS").
  function banner(text, cls = '') {
    const el = document.createElement('div');
    el.className = 'slam ' + cls;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  window.Rumpus.fx = { wipe, isWiping, confetti, reaction, scorePop, banner };
})();
