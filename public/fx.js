/* Rumpus visual effects: pixel-block screen wipes, pixel confetti, floating
 * emoji reactions and score pop-ups. AGPLv3, see LICENSE.
 */
'use strict';

(function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Pixel wipe: blocks fill the screen in random order, then clear.
  let wipeCanvas = null;
  function wipe(midpoint, colors = ['#ffb02e', '#5ee0a0', '#ff5d73', '#7c5cff', '#14121f']) {
    if (reduced) { midpoint(); return; }
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
    cells.sort((a, b) => a[2] - b[2]);
    const dur = 280;
    let t0 = null, swapped = false;
    wipeCanvas.style.display = 'block';
    const col = colors[(Math.random() * colors.length) | 0];
    function frame(now) {
      if (t0 === null) t0 = now;
      const e = now - t0;
      g.clearRect(0, 0, cols, rows);
      if (e < dur) {
        const n = Math.floor((e / dur) * cells.length);
        g.fillStyle = col;
        for (let i = 0; i < n; i++) g.fillRect(cells[i][0], cells[i][1], 1, 1);
      } else {
        if (!swapped) { swapped = true; midpoint(); }
        const n = Math.floor(((e - dur) / dur) * cells.length);
        g.fillStyle = col;
        for (let i = n; i < cells.length; i++) g.fillRect(cells[i][0], cells[i][1], 1, 1);
      }
      if (e < dur * 2) requestAnimationFrame(frame);
      else wipeCanvas.style.display = 'none';
    }
    requestAnimationFrame(frame);
  }

  // ---- Confetti: chunky pixel squares with gravity.
  let confCanvas = null, parts = [], confRaf = null;
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
      parts.push({ x: W / 2 + (Math.random() - 0.5) * 120, y: H + 4, vx: (Math.random() - 0.5) * 4, vy: -3 - Math.random() * 4.5,
        c: cols[(Math.random() * cols.length) | 0], s: Math.random() < 0.3 ? 2 : 1, life: 140 + Math.random() * 60 });
    }
    if (confRaf) return;
    const g = confCanvas.getContext('2d');
    confCanvas.style.display = 'block';
    (function frame() {
      g.clearRect(0, 0, W, H);
      parts = parts.filter((p) => p.life-- > 0 && p.y < H + 10);
      for (const p of parts) {
        p.vy += 0.09; p.vx *= 0.99; p.x += p.vx; p.y += p.vy;
        g.fillStyle = p.c;
        g.fillRect(p.x | 0, p.y | 0, p.s, p.s);
      }
      if (parts.length) confRaf = requestAnimationFrame(frame);
      else { confRaf = null; confCanvas.style.display = 'none'; }
    })();
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

  window.Rumpus.fx = { wipe, confetti, reaction, scorePop, banner };
})();
