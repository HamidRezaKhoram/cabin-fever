/* Rumpus touch drawing pad. AGPLv3, see LICENSE. */
'use strict';

(function () {
  const COLORS = ['#111111', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41', '#ffffff'];
  const SIZES = [4, 10, 22];
  const W = 480, H = 480;

  /** @typedef {{ color: string, size: number, pts: number[][] }} Stroke */
  /** @param {HTMLElement} host */
  function drawPad(host) {
    host.innerHTML = `
      <canvas class="draw-canvas" width="${W}" height="${H}"></canvas>
      <div class="draw-tools">
        <div class="swatches">${COLORS.map((c, i) =>
          `<button type="button" class="swatch${i === 0 ? ' on' : ''}" data-color="${c}" style="background:${c}" aria-label="color ${c}"></button>`).join('')}</div>
        <div class="draw-row">
          ${SIZES.map((s, i) => `<button type="button" class="size${i === 1 ? ' on' : ''}" data-size="${s}"><span style="width:${Math.max(4, s / 1.5)}px;height:${Math.max(4, s / 1.5)}px"></span></button>`).join('')}
          <button type="button" class="tool-btn" data-act="undo">Undo</button>
          <button type="button" class="tool-btn" data-act="clear">Clear</button>
        </div>
      </div>`;
    const canvas = /** @type {HTMLCanvasElement} */ (host.querySelector('canvas'));
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    let color = COLORS[0];
    let size = SIZES[1];
    /** @type {Stroke[]} */
    const strokes = [];
    /** @type {Stroke | null} */
    let cur = null;

    function redraw() {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const s of strokes.concat(cur ? [cur] : [])) {
        g.strokeStyle = s.color;
        g.lineWidth = s.size;
        g.beginPath();
        s.pts.forEach(([x, y], /** @type {number} */ i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        if (s.pts.length === 1) g.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
        g.stroke();
      }
    }
    /** @param {PointerEvent} e */
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    }
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      cur = { color, size, pts: [pos(e)] };
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!cur) return;
      e.preventDefault();
      cur.pts.push(pos(e));
      redraw();
    });
    const end = () => { if (cur) { strokes.push(cur); cur = null; redraw(); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    /** @type {HTMLElement} */ (host.querySelector('.draw-tools')).addEventListener('click', (e) => {
      const b = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('button') : null);
      if (!b) return;
      if (b.dataset.color) {
        color = b.dataset.color;
        host.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b));
      } else if (b.dataset.size) {
        size = Number(b.dataset.size);
        host.querySelectorAll('.size').forEach((x) => x.classList.toggle('on', x === b));
      } else if (b.dataset.act === 'undo') {
        strokes.pop(); redraw();
      } else if (b.dataset.act === 'clear') {
        strokes.length = 0; redraw();
      }
    });
    redraw();
    return {
      isEmpty: () => strokes.length === 0,
      toDataURL: (/** @type {number} [size] */ size) => {
        end();
        if (!size) return canvas.toDataURL('image/jpeg', 0.72);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).drawImage(canvas, 0, 0, size, size);
        return c.toDataURL('image/jpeg', 0.8);
      },
      clear: () => { strokes.length = 0; redraw(); },
    };
  }

  window.Rumpus.drawPad = drawPad;
})();
