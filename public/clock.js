/* Rumpus shared animation clock — every canvas/JS animation ticks here at a
 * fixed 30 fps so motion is evenly paced (no mixed 4/12/60 fps loops).
 * AGPLv3, see LICENSE.
 *
 *   const off = Rumpus.clock.add((frame) => { ...draw... });   // called 30×/s
 *   off();                                                     // unsubscribe
 *
 * Frames are scheduled on a fixed 33.33 ms grid (not "whenever rAF fires"),
 * so a 60/120/144 Hz display shows a steady 30 fps cadence. If the tab
 * stalls, we skip ahead instead of fast-forwarding a burst of catch-up frames.
 */
'use strict';

(function () {
  const FPS = 30;
  const STEP = 1000 / FPS;
  const subs = new Set();
  let raf = null;
  let next = 0;
  let frame = 0;
  const stats = { frames: 0, since: performance.now(), intervals: [] };

  function loop(now) {
    raf = requestAnimationFrame(loop);
    // Half a display frame of tolerance so 60 Hz screens land on every 2nd vsync.
    if (now < next - 4) return;
    if (now - next > STEP * 4) next = now; // stalled tab: resync, don't burst
    next += STEP;
    frame++;
    const last = stats.last;
    stats.last = now;
    stats.frames++;
    if (last) {
      stats.intervals.push(now - last);
      if (stats.intervals.length > 120) stats.intervals.shift();
    }
    for (const fn of subs) {
      try { fn(frame); } catch (e) { console.error(e); }
    }
  }

  function add(fn) {
    subs.add(fn);
    if (!raf) { next = performance.now(); raf = requestAnimationFrame(loop); }
    return () => {
      subs.delete(fn);
      if (!subs.size && raf) { cancelAnimationFrame(raf); raf = null; }
    };
  }

  window.Rumpus = window.Rumpus || {};
  window.Rumpus.clock = {
    FPS, add,
    frame: () => frame,
    // For tests: measured fps and frame-interval jitter over the last ~4 s.
    stats() {
      const iv = stats.intervals;
      const avg = iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0;
      return { fps: avg ? 1000 / avg : 0, avgMs: avg, maxMs: iv.length ? Math.max(...iv) : 0, samples: iv.length };
    },
  };
})();
