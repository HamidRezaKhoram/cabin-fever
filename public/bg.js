/* Rumpus animated pixel background: night lake, cottage, pines, stars,
 * moon, fireflies. Rendered at 320×180 and scaled up (pixelated).
 * Runs on the shared 30 fps clock. The static scenery is painted once into
 * an offscreen layer; each frame only redraws the moving bits.
 * AGPLv3, see LICENSE.
 */
'use strict';

(function () {
  const W = 320, H = 180, HORIZON = 112;
  // Motion speeds are in "ticks". 0.2 ticks per 30 fps frame: a calm evening (0.4 felt hurried — the
  // smoke, the shimmer and the fireflies all at double speed).
  const TICKS_PER_FRAME = 0.2;

  /** @param {number} seed @returns {() => number} */
  function rand(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  /**
   * Per-game scenes: same lake/cottage/pines, different time of day and palette.
   * @typedef {{ sky: string[], hills: string, pines: string, lake: string[], orb: string, orbShade: string,
   *             stars: boolean, fly: string, glow: string, window: string, name?: string, glowFill?: string }} Theme
   * @type {Record<string, Theme>}
   */
  const THEMES = {
    lobby:      { sky: ['#0d0b1e', '#120f2a', '#181437', '#1f1a45', '#272052', '#31275e', '#3d2f66'], hills: '#1a1735', pines: '#0f1a1f', lake: ['#141233', '#171538', '#1b183e', '#1f1b45'], orb: '#fff6d5', orbShade: '#e8dcae', stars: true, fly: '#d4ff6b', glow: '255,246,213', window: '#ffcf5a' },
    quiplash:   { sky: ['#14051f', '#200a33', '#2e0f4a', '#3f1460', '#561a73', '#6f2181', '#8a2a8a'], hills: '#2a0d3a', pines: '#12051c', lake: ['#1c0830', '#230b3b', '#2b0e47', '#331152'], orb: '#ffd6f5', orbShade: '#f0a8dd', stars: true, fly: '#ff7bd5', glow: '255,140,220', window: '#ff9be0' },
    fibbage:    { sky: ['#2b0f0a', '#4a1a0e', '#6e2a12', '#943d16', '#b8561c', '#d97324', '#f2953a'], hills: '#3d160c', pines: '#1f0b06', lake: ['#3a170d', '#4a1f12', '#5a2717', '#6a2f1c'], orb: '#ffe0a3', orbShade: '#f2c070', stars: false, fly: '#ffd27a', glow: '255,214,150', window: '#ffe08a' },
    trivia:     { sky: ['#071a3a', '#0b2550', '#103268', '#164180', '#1e5198', '#2a63ae', '#3a78c2'], hills: '#0c2242', pines: '#06132a', lake: ['#0b2148', '#0e2853', '#11305f', '#14386b'], orb: '#e6f2ff', orbShade: '#b8d6f5', stars: true, fly: '#7fd4ff', glow: '200,230,255', window: '#9be0ff' },
    closest:    { sky: ['#06170f', '#0a2416', '#0f321d', '#154226', '#1c5330', '#25663b', '#2f7a47'], hills: '#0d2a19', pines: '#04110a', lake: ['#0a2418', '#0d2c1d', '#113422', '#143d27'], orb: '#f2ffe0', orbShade: '#cfe8a8', stars: true, fly: '#e6ff6b', glow: '220,255,180', window: '#e6ff8a' },
    majority:   { sky: ['#5fb2ff', '#6fbcff', '#81c6ff', '#95cfff', '#aad8ff', '#bfe2ff', '#d4ebff'], hills: '#5f9e5a', pines: '#2f6a3a', lake: ['#3d8fd6', '#3585cc', '#2d7bc2', '#2671b8'], orb: '#fff3a3', orbShade: '#ffe066', stars: false, fly: '#ffffff', glow: '255,255,255', window: '#fff6c8' },
    mostlikely: { sky: ['#2a0a2a', '#4a1236', '#701a42', '#99254b', '#c23a52', '#e0595a', '#f58066'], hills: '#3a0e2c', pines: '#1c0614', lake: ['#3a0f2e', '#481437', '#561a40', '#641f49'], orb: '#ffe0d0', orbShade: '#ffb8a0', stars: false, fly: '#ffb0c8', glow: '255,190,200', window: '#ffc0a8' },
    imposter:   { sky: ['#0a120d', '#0f1a13', '#152319', '#1b2d20', '#223828', '#2b4431', '#35503b'], hills: '#16241b', pines: '#070d09', lake: ['#0f1a14', '#121f18', '#16251c', '#1a2b20'], orb: '#d8f0d0', orbShade: '#a8c8a0', stars: false, fly: '#ff4a4a', glow: '200,230,190', window: '#ff5050' },
    twotruths:  { sky: ['#050816', '#081026', '#0c1836', '#102046', '#152a58', '#1b356a', '#22417c'], hills: '#0b1430', pines: '#03060f', lake: ['#08102a', '#0a1432', '#0c183a', '#0e1c42'], orb: '#f0f4ff', orbShade: '#c0ccf0', stars: true, fly: '#b0c8ff', glow: '220,230,255', window: '#ffd27a' },
    telephone:  { sky: ['#3a1a05', '#5a2a08', '#7e3d0c', '#a35411', '#c76d18', '#e68a24', '#ffaa3a'], hills: '#4a2a12', pines: '#2a1406', lake: ['#5a2e0e', '#6a3812', '#7a4216', '#8a4c1a'], orb: '#fff0b0', orbShade: '#ffd870', stars: false, fly: '#fff3a0', glow: '255,230,160', window: '#fff0a0' },
    cah:        { sky: ['#0a0303', '#160505', '#220808', '#2e0a0a', '#3c0d0d', '#4b1010', '#5a1414'], hills: '#1a0606', pines: '#050101', lake: ['#160404', '#1c0606', '#220808', '#280a0a'], orb: '#ffd0c0', orbShade: '#e09080', stars: true, fly: '#ff6040', glow: '255,160,140', window: '#ff8050' },
    storm:      { sky: ['#06080f', '#0a0e18', '#0e1422', '#121a2c', '#161f35', '#1a243d', '#1e2944'], hills: '#0a0f1a', pines: '#05080e', lake: ['#0c1424', '#0e1729', '#101a2e', '#121d33'], orb: '#3a4560', orbShade: '#2a3348', stars: false, fly: '#9fb7ff', glow: '160,180,255', window: '#ffcf80' },
    lantern:    { sky: ['#1b1030', '#2a1640', '#3d1f4f', '#57285a', '#7a345e', '#a1455e', '#c9605a'], hills: '#1a1028', pines: '#0d0816', lake: ['#162a4c', '#193055', '#1c365e', '#1f3c67'], orb: '#ffd9a0', orbShade: '#ffb870', stars: true, fly: '#ffd23f', glow: '255,200,120', window: '#ffcf80' },
    looncall:   { sky: ['#0b1630', '#10203f', '#162b4f', '#1d3760', '#264570', '#30537f', '#3d628c'], hills: '#0f1e33', pines: '#08121f', lake: ['#12304d', '#153657', '#183c61', '#1b426b'], orb: '#f4f1e8', orbShade: '#cfd2dc', stars: true, fly: '#7fe3d0', glow: '200,255,240', window: '#ffe9a8' },
    crush:      { sky: ['#1a0820', '#2a0d33', '#3d1248', '#53185c', '#6b1f6c', '#86287a', '#a33486'], hills: '#2a0b2e', pines: '#140516', lake: ['#2a0c33', '#33103d', '#3c1447', '#451851'], orb: '#ffd6e8', orbShade: '#ffa8cc', stars: true, fly: '#ff8fb3', glow: '255,170,210', window: '#ffb0d0' },
    minigames:  { sky: ['#0a6fb0', '#1580c0', '#2391cf', '#35a2dc', '#4ab3e6', '#62c3ee', '#7dd2f4'], hills: '#2f8f5a', pines: '#14603a', lake: ['#1a78c8', '#176ebc', '#1464b0', '#115aa4'], orb: '#fff4a0', orbShade: '#ffe060', stars: false, fly: '#ffffff', glow: '255,255,220', window: '#fff6c8' },
  };


  // ------------------------------------------------------------------ game scenes
  // Original pixel motifs that show what each game is about. STATIC parts are
  // painted once into the background layer; ANIM parts are drawn every frame.
  /** @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {number} w @param {number} h @param {string} c */
  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  /** @param {CanvasRenderingContext2D} g @param {number} cx @param {number} cy @param {number} r @param {string} c */
  const D = (g, cx, cy, r, c) => { g.fillStyle = c; for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) g.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1); };
  /** @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {number} [s] */
  const sheepAt = (g, x, y, s = 1) => {
    R(g, x - 3 * s, y + 2 * s, 1, 2 * s, '#2b2d42'); R(g, x + 2 * s, y + 2 * s, 1, 2 * s, '#2b2d42');
    D(g, x - 2 * s, y, 2 * s, '#f4f1e8'); D(g, x + 1 * s, y, 2 * s, '#f4f1e8'); D(g, x, y - 1 * s, 2 * s, '#ffffff');
    R(g, x + 3 * s, y - 2 * s, 2 * s, 3 * s, '#2b2d42'); R(g, x + 4 * s, y - 1 * s, 1, 1, '#ffffff');
  };
  /** @type {Record<string, (g: CanvasRenderingContext2D) => void>} */
  const STATIC = {
    quiplash(g) { // comedy-club stage: curtains, valance, stage floor, mic stand
      for (let x = 0; x < 46; x++) R(g, x, 0, 1, H, x % 6 < 3 ? '#8a0f24' : '#6a0a1a');
      for (let x = W - 46; x < W; x++) R(g, x, 0, 1, H, x % 6 < 3 ? '#8a0f24' : '#6a0a1a');
      for (let x = 0; x < W; x++) R(g, x, 0, 1, 10 + (x % 12 < 6 ? 3 : 0), '#a01530');
      R(g, 0, 140, W, 40, '#5a3418'); for (let x = 0; x < W; x += 20) R(g, x, 140, 1, 40, '#3e220f');
      R(g, 0, 140, W, 2, '#ffcf5a');
      R(g, 159, 104, 2, 36, '#8e8fa3'); R(g, 152, 138, 16, 2, '#8e8fa3'); D(g, 160, 101, 4, '#cfd2dc');
    },
    fibbage(g) { // drama masks — one smiling, one frowning (who's lying?)
      for (const [cx, sad] of /** @type {[number, boolean][]} */ ([[70, false], [110, true]])) {
        D(g, cx, 34, 13, '#f4f1e8');
        R(g, cx - 7, 29, 4, 3, '#2b0f0a'); R(g, cx + 3, 29, 4, 3, '#2b0f0a');
        for (let i = -5; i <= 5; i++) R(g, cx + i, 40 + (sad ? -Math.round((25 - i * i) / 8) : Math.round((25 - i * i) / 8)), 1, 2, '#2b0f0a');
      }
      R(g, 88, 44, 4, 18, '#d97324');
    },
    trivia(g) { // quiz-show studio: light rig + giant question mark
      R(g, 0, 6, W, 3, '#1d2b5c');
      const q = ['.####.', '##..##', '....##', '...##.', '..##..', '..##..', '......', '..##..'];
      q.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') R(g, 142 + x * 6, 22 + y * 6, 6, 6, '#ffd23f'); }));
    },
    closest(g) { // target board on the dock + measuring ticks along the shore
      for (const [r, c] of /** @type {[number, string][]} */ ([[16, '#f4f1e8'], [13, '#e83f5b'], [10, '#f4f1e8'], [7, '#e83f5b'], [4, '#f4f1e8'], [2, '#4caf50']])) D(g, 70, 92, r, c);
      R(g, 69, 108, 3, 6, '#5a3b22');
      for (let x = 0; x < W; x += 8) R(g, x, 113, 1, x % 32 === 0 ? 5 : 2, '#f4f1e8');
    },
    majority(g) { // the flock on the hills
      [[30, 100, 1], [52, 104, 1], [84, 98, 1], [118, 102, 1], [150, 97, 1], [96, 106, 1]].forEach(([x, y, s]) => sheepAt(g, x, y, s));
      sheepAt(g, 300, 104, 1);
    },
    mostlikely(g) { // audience silhouettes along the bottom
      for (let x = 4; x < W; x += 14) { D(g, x + 5, 160, 5, '#1c0614'); R(g, x, 166, 11, 14, '#1c0614'); }
    },
    imposter(g) { // twisted dead tree in the foreground
      R(g, 28, 70, 5, 50, '#070d09'); R(g, 18, 80, 12, 3, '#070d09'); R(g, 32, 74, 14, 3, '#070d09'); R(g, 14, 76, 3, 6, '#070d09');
    },
    twotruths(g) { // check, check, cross as constellations
      const pts = [[40, 30], [44, 34], [52, 24], [80, 30], [84, 34], [92, 24]];
      pts.forEach(([x, y]) => D(g, x, y, 1, '#b0c8ff'));
      R(g, 118, 22, 1, 1, '#ff6b7f'); for (let i = 0; i < 10; i++) { R(g, 118 + i, 22 + i, 2, 2, '#ff6b7f'); R(g, 127 - i, 22 + i, 2, 2, '#ff6b7f'); }
    },
    telephone(g) { // painter's easel with a doodle on the dock
      R(g, 60, 70, 3, 44, '#6a4a2a'); R(g, 84, 70, 3, 44, '#6a4a2a'); R(g, 72, 66, 3, 48, '#6a4a2a');
      R(g, 56, 72, 36, 28, '#f4f1e8');
      for (let x = 0; x < 28; x++) R(g, 60 + x, 86 + Math.round(Math.sin(x / 3) * 5), 2, 2, '#1e88e5');
      D(g, 66, 80, 3, '#e83f5b'); D(g, 84, 94, 2, '#4caf50');
    },
    cah(g) { // giant tilted cards: black prompt card + white answer card
      R(g, 40, 30, 34, 46, '#111111'); R(g, 44, 36, 22, 2, '#f4f1e8'); R(g, 44, 42, 16, 2, '#f4f1e8'); R(g, 44, 48, 20, 2, '#f4f1e8');
      R(g, 62, 44, 34, 46, '#f4f1e8'); R(g, 66, 50, 22, 2, '#111111'); R(g, 66, 56, 18, 2, '#111111');
    },
    crush(g) { // two chairs on the dock under a heart-shaped moon glow
      R(g, 150, 120, 60, 4, '#5a3418'); R(g, 158, 124, 4, 14, '#3d220f'); R(g, 198, 124, 4, 14, '#3d220f');
      for (const x of [164, 186]) { R(g, x, 106, 10, 3, '#e83f5b'); R(g, x, 109, 10, 2, '#b8283f'); R(g, x + 1, 111, 2, 9, '#8a1e30'); R(g, x + 7, 111, 2, 9, '#8a1e30'); }
      for (const [dx, dy] of [[0, 0], [6, 0], [-3, 3], [9, 3], [-3, 6], [9, 6], [0, 9], [6, 9], [3, 12]]) R(g, 178 + dx, 60 + dy, 5, 5, '#ff8fb3');
    },
    storm(g) { // the cottage hunkered down, one lit window, storm clouds overhead
      R(g, 140, 92, 40, 22, '#2a1d14'); for (let i = 0; i < 12; i++) R(g, 136 + i * 2, 92 - i, 48 - i * 4, 1, '#3a1c1c');
      R(g, 166, 100, 6, 6, '#ffcf80'); R(g, 150, 102, 6, 12, '#120c08');
      for (const [x, w] of [[40, 90], [150, 120], [250, 80]]) { R(g, x, 18, w, 8, '#1c2236'); R(g, x + 10, 12, w - 20, 8, '#232a42'); }
    },
    lantern(g) { // paper lantern-boats drifting on the dusk lake
      for (const [x, y, c] of /** @type {[number, number, string][]} */ ([[70, 140, '#ff8a3d'], [150, 152, '#4fc3f7'], [250, 136, '#ffd23f']])) {
        R(g, x - 6, y, 12, 2, c); R(g, x - 5, y + 2, 10, 1, '#1a1423'); R(g, x, y - 7, 1, 7, '#8a5a3b'); R(g, x + 1, y - 7, 4, 6, '#f4f1e8'); D(g, x - 3, y - 3, 2, '#ffd23f');
      }
    },
    looncall(g) { // a loon floating on the moonlit lake
      R(g, 196, 126, 22, 5, '#1a1423'); R(g, 198, 124, 18, 3, '#2b2d42');
      for (let x = 199; x < 214; x += 3) R(g, x, 125, 1, 1, '#f4f1e8');
      R(g, 214, 116, 3, 9, '#2b2d42'); R(g, 214, 119, 3, 1, '#f4f1e8'); R(g, 213, 113, 5, 4, '#1a1423'); R(g, 216, 114, 1, 1, '#e83f5b'); R(g, 218, 115, 4, 1, '#6b7a8f');
    },
    minigames(g) { // finish line buoys + flag on the far shore
      for (let y = 118; y < 178; y += 10) { D(g, 286, y, 2, '#ff9f1c'); }
      R(g, 290, 92, 2, 22, '#f4f1e8');
      for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) R(g, 292 + x, 92 + y, 1, 1, (x + y) % 2 ? '#111' : '#fff');
    },
  };
  /** @type {Record<string, (g: CanvasRenderingContext2D, t: number) => void>} */
  const ANIM = {
    quiplash(g, t) { // two sweeping spotlights
      for (const [x0, ph] of [[90, 0], [230, 2]]) {
        const tx = 160 + Math.sin(t / 12 + ph) * 60;
        g.fillStyle = 'rgba(255,240,180,0.10)';
        g.beginPath(); g.moveTo(x0, 12); g.lineTo(tx - 22, 140); g.lineTo(tx + 22, 140); g.closePath(); g.fill();
      }
    },
    trivia(g, t) { for (let x = 6; x < W; x += 12) R(g, x, 9, 4, 3, (Math.floor(t / 2) + x / 12) % 3 < 1 ? '#ffd23f' : '#5a4a10'); },
    mostlikely(g, t) { // spotlights hunting for "who"
      const tx = 160 + Math.sin(t / 9) * 120;
      g.fillStyle = 'rgba(255,220,200,0.14)';
      g.beginPath(); g.moveTo(160, 0); g.lineTo(tx - 16, 170); g.lineTo(tx + 16, 170); g.closePath(); g.fill();
    },
    imposter(g, t) { // fog drifting + red eyes blinking in the trees
      g.fillStyle = 'rgba(200,230,200,0.08)';
      for (let i = 0; i < 4; i++) g.fillRect(Math.round(((t * (0.6 + i * 0.2)) + i * 90) % (W + 120)) - 120, 92 + i * 8, 120, 5);
      for (const [x, y, p] of [[60, 98, 0], [130, 95, 3], [250, 100, 7]]) if (Math.sin(t / 7 + p) > -0.6) { R(g, x, y, 2, 1, '#ff3030'); R(g, x + 4, y, 2, 1, '#ff3030'); }
    },
    twotruths(g, t) { // polygraph trace across the sky
      for (let x = 0; x < W; x++) {
        const k = x + t * 2;
        const y = 70 + Math.round(Math.sin(k / 9) * 3 + (k % 97 < 6 ? (k % 97) * 3 - 9 : 0));
        R(g, x, y, 1, 1, 'rgba(255,107,127,0.7)');
      }
    },
    telephone(g, t) { // paper planes gliding past
      for (let i = 0; i < 2; i++) {
        const x = (t * 1.5 + i * 170) % (W + 40) - 20, y = 30 + i * 22 + Math.sin(t / 8 + i) * 4;
        g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 10, y - 3); g.lineTo(x - 7, y + 3); g.closePath(); g.fill();
      }
    },
    cah(g, t) { // flickering neon sign
      const on = Math.sin(t * 1.7) > -0.8;
      const c = on ? '#ff3b6b' : '#5a1020';
      const sign = ['#.###.#.#', '#.#.#.###', '#.###..#.', '#.#.#.###', '#.###.#.#'];
      sign.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') R(g, 236 + x * 3, 40 + y * 3, 3, 3, c); }));
    },
    crush(g, t) { // little hearts drifting up from the dock
      for (let i = 0; i < 5; i++) {
        const y = 110 - ((t * 0.6 + i * 23) % 80), x = 170 + i * 6 + Math.round(Math.sin(t / 9 + i) * 4);
        R(g, x, y, 2, 2, '#ff8fb3'); R(g, x + 3, y, 2, 2, '#ff8fb3'); R(g, x + 1, y + 2, 3, 2, '#ff8fb3');
      }
    },
    storm(g, t) { // slanted rain and the odd far-off flash
      for (let i = 0; i < 60; i++) { const x = (i * 53 + t * 4) % (W + 20) - 10, y = (i * 29 + t * 9) % 112; R(g, x, y, 1, 3, 'rgba(160,185,230,0.35)'); }
      if (t % 210 < 3) { g.fillStyle = 'rgba(200,215,255,0.12)'; g.fillRect(0, 0, W, 112); }
    },
    lantern(g, t) { // lantern glows breathing + fireflies over the water
      for (const [x, y, p] of [[67, 137, 0], [147, 149, 2], [247, 133, 4]]) { const a = 0.12 + 0.08 * Math.sin(t / 10 + p); g.fillStyle = `rgba(255,200,90,${a.toFixed(2)})`; g.fillRect(x - 6, y - 6, 12, 12); }
      for (let i = 0; i < 7; i++) { const x = (i * 47 + Math.sin(t / 20 + i) * 12 + 400) % W, y = 100 + Math.sin(t / 13 + i * 2) * 12; if ((Math.floor(t / 3) + i * 5) % 14 < 10) R(g, x, y, 1, 1, '#ffd23f'); }
    },
    looncall(g, t) { // music notes rising from the loon + moon ripples
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.7 + i * 30) % 90, x = 222 + i * 9 + Math.round(Math.sin(t / 8 + i) * 3), y = 112 - k;
        if (k < 80) { R(g, x, y, 3, 2, '#7fe3d0'); R(g, x + 2, y - 6, 1, 6, '#7fe3d0'); R(g, x + 3, y - 6, 2, 1, '#7fe3d0'); }
      }
      for (let i = 0; i < 3; i++) { const w = 10 + ((t * 0.5 + i * 12) % 36); R(g, 207 - w / 2, 133 + i, w, 1, 'rgba(244,241,232,0.18)'); }
    },
    minigames(g, t) { // red vs blue canoes racing
      for (const [y, col, sp] of /** @type {[number, string, number][]} */ ([[132, '#e83f5b', 1.1], [152, '#1e88e5', 1.0]])) {
        const x = (t * sp * 1.6) % (W + 60) - 40, bob = Math.round(Math.sin(t / 4 + y) * 1);
        R(g, x, y + bob, 26, 3, col); R(g, x + 2, y + 3 + bob, 22, 2, col);
        D(g, x + 9, y - 3 + bob, 2, '#f1c27d'); D(g, x + 17, y - 3 + bob, 2, '#f1c27d');
        R(g, x + 20, y - 6 + bob, 1, 10, '#8a5a3b');
      }
    },
  };

  /** Mix two #rrggbb colours (t = 0 → a, 1 → b): used for hue-shifted highlights/shadows. @param {string} a @param {string} b @param {number} t */
  function mix(a, b, t) {
    const p = (/** @type {string} */ c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const A = p(a), B = p(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  /** The cottage, lit from inside: log walls, shingles, framed windows, a warm door seam and porch lantern,
   * and light spilling onto the ground (dithered, so it stays pixel-art). @param {CanvasRenderingContext2D} g @param {Theme} th */
  function paintCottage(g, th) {
    const cx = 206, base = HORIZON;
    const warm = th.window;
    const wallA = mix('#3b2a24', th.hills, 0.25), wallB = mix('#2c1f1c', th.hills, 0.25);
    // light spill on the ground in front (checkerboard dither, fading out)
    for (let y = base - 2; y < base + 6; y++) for (let x = cx - 6; x < cx + 46; x++) {
      const d = Math.abs(x - (cx + 17)) / 26 + (y - base + 2) / 10;
      if (d < 1 && (x + y) % 2 === 0) { g.fillStyle = `rgba(255,200,110,${(0.22 * (1 - d)).toFixed(3)})`; g.fillRect(x, y, 1, 1); }
    }
    // log walls (alternating warm-dark rows; the moon side gets a cool rim)
    for (let y = 0; y < 16; y++) { g.fillStyle = y % 3 === 2 ? wallB : wallA; g.fillRect(cx, base - 16 + y, 34, 1); }
    g.fillStyle = mix(wallA, th.orb, 0.35); g.fillRect(cx + 33, base - 16, 1, 16);
    // shingled roof: hue-shifted toward purple in shadow, toward the moon on the lit edge
    const roof = mix('#2a1a2e', th.hills, 0.3), roofDark = mix(roof, '#120a1a', 0.5);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? roof : roofDark; g.fillRect(cx - 3 + i, base - 16 - i, 40 - i * 2, 1);
      g.fillStyle = mix(roof, th.orb, 0.45); g.fillRect(cx + 36 - i, base - 16 - i, 1, 1);
    }
    // chimney (stone)
    g.fillStyle = '#4a4552'; g.fillRect(cx + 25, base - 30, 4, 10);
    g.fillStyle = '#5e5868'; g.fillRect(cx + 25, base - 30, 4, 1); g.fillRect(cx + 26, base - 27, 1, 1); g.fillRect(cx + 27, base - 24, 1, 1);
    // window frames (panes are lit each frame), soft halo around them
    for (const wx of [cx + 4, cx + 21]) {
      g.fillStyle = `rgba(255,200,110,0.12)`; g.fillRect(wx - 1, base - 13, 10, 9);
      g.fillStyle = '#1a1016'; g.fillRect(wx, base - 12, 8, 7);
    }
    // door with a warm light seam + porch lantern
    g.fillStyle = '#5a3b22'; g.fillRect(cx + 14, base - 9, 5, 9);
    g.fillStyle = '#6e4a2c'; g.fillRect(cx + 14, base - 9, 5, 1);
    g.fillStyle = warm; g.fillRect(cx + 18, base - 8, 1, 8);
    g.fillStyle = '#1a1016'; g.fillRect(cx + 20, base - 11, 1, 2);
    g.fillStyle = warm; g.fillRect(cx + 20, base - 9, 1, 1);
    // dock
    g.fillStyle = '#3a2a1a'; g.fillRect(cx + 8, base, 30, 2); g.fillRect(cx + 36, base, 2, 4);
    g.fillStyle = '#4e3a24'; for (let x = cx + 8; x < cx + 38; x += 4) g.fillRect(x, base, 1, 1);
    // campfire stones on the shore (the flames flicker each frame)
    for (const [dx, c] of /** @type {[number, string][]} */ ([[-2, '#5c6373'], [0, '#6b7280'], [2, '#5c6373'], [4, '#4b5260']])) { g.fillStyle = c; g.fillRect(cx - 18 + dx, base - 1, 2, 1); }
  }

  /** @param {CanvasRenderingContext2D} g @param {() => number} r @param {Theme} th */
  function paintStatic(g, r, th) {
    const bands = th.sky;
    const bh = Math.ceil(HORIZON / bands.length);
    bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * bh, W, bh); });
    for (let i = 1; i < bands.length; i++) {
      g.fillStyle = bands[i];
      for (let x = (i % 2); x < W; x += 2) g.fillRect(x, i * bh - 1, 1, 1);
    }
    // moon
    const disc = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ rad, /** @type {string} */ col) => {
      g.fillStyle = col;
      for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad) g.fillRect(cx + x, cy + y, 1, 1);
    };
    disc(262, 28, 11, th.orb);
    [[-4, -3, 2], [3, 2, 3], [-2, 5, 1], [5, -5, 1]].forEach(([x, y, rr]) => disc(262 + x, 28 + y, rr, th.orbShade));
    // hills
    g.fillStyle = th.hills;
    for (let x = 0; x < W; x++) {
      const hy = HORIZON - 14 - Math.round(8 * Math.sin(x / 37) + 5 * Math.sin(x / 13 + 1) + 3 * Math.sin(x / 5));
      g.fillRect(x, hy, 1, HORIZON - hy);
      // moonlit rim: stronger toward the moon, hue-shifted toward its colour
      const near = Math.max(0, 1 - Math.abs(x - 262) / 200);
      g.fillStyle = mix(th.hills, th.orb, 0.18 + 0.32 * near);
      g.fillRect(x, hy, 1, 1);
      g.fillStyle = th.hills;
    }
    // pines
    g.fillStyle = th.pines;
    for (let x = -6; x < W + 6; x += 5 + ((r() * 7) | 0)) {
      if (x > 196 && x < 252) continue;
      const h = 14 + ((r() * 18) | 0);
      for (let i = 0; i < h; i++) {
        const w = Math.max(1, Math.round((i / h) * (h / 2.2)) - ((i % 4 === 0) ? 1 : 0));
        g.fillRect(x - w, HORIZON - h + i, w * 2 + 1, 1);
        if (i % 3 === 0 && w > 0) { g.fillStyle = mix(th.pines, th.orb, 0.22); g.fillRect(x + w, HORIZON - h + i, 1, 1); g.fillStyle = th.pines; }
      }
      g.fillRect(x, HORIZON, 1, 2);
    }
    // cottage (after the lake so its light spills onto the shore)
    // lake
    const lake = th.lake;
    for (let y = HORIZON; y < H; y++) {
      g.fillStyle = lake[Math.min(lake.length - 1, ((y - HORIZON) / 18) | 0)];
      g.fillRect(0, y, W, 1);
    }
    paintCottage(g, th);
    const sc = th.name ? STATIC[th.name] : undefined;
    if (sc) sc(g);
  }

  // The campfire glow (a dithered disc that pulses): drawn once per pulse level (16 steps) and checker
  // parity into a small canvas, then pasted each frame. It used to be ~57 one-pixel fills with a new
  // colour string each, every frame: the TV's top cost after layout (Cottage Lab profile, feel-plan.md).
  /** @type {Map<number, HTMLCanvasElement>} */
  const glowSprites = new Map();
  /** @param {number} pulse 0.7–1 @param {number} parity frame & 1 */
  function glowSprite(pulse, parity) {
    const level = Math.round(((pulse - 0.7) / 0.3) * 15);
    const id = level * 2 + parity;
    let c = glowSprites.get(id);
    if (!c) {
      c = document.createElement('canvas'); c.width = 21; c.height = 11;
      const gg = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      const p = 0.7 + (level / 15) * 0.3;
      for (let y = -8; y <= 2; y++) for (let x = -10; x <= 10; x++) {
        const d = Math.hypot(x / 10, y / 7);
        if (d < 1 && (x + y + parity) % 2 === 0) { gg.fillStyle = `rgba(255,150,60,${(0.16 * (1 - d) * p).toFixed(3)})`; gg.fillRect(x + 10, y + 8, 1, 1); }
      }
      glowSprites.set(id, c);
    }
    return c;
  }

  /** Pixel sprite: rows of characters, each a colour from `pal` ('.' = clear). Drawn at (x, y),
   * mirrored when `flip`. @param {CanvasRenderingContext2D} g @param {string[]} rows @param {Record<string, string>} pal @param {number} x @param {number} y @param {boolean} [flip] */
  function sprite(g, rows, pal, x, y, flip) {
    for (const [c, col] of Object.entries(pal)) {
      g.fillStyle = col;
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === c) g.fillRect(x + (flip ? row.length - 1 - i : i), y + j, 1, 1); });
    }
  }
  const DUCK = ['.hh.', 'hhbk', '.bbb', 'bbbb'];
  const DUCKLING = ['yy', 'yo'];
  const FOX = ['f..f', 'ffff', 'fewf', '.ww.'];
  const RACCOON = ['g..g', 'gmmg', 'gggg', 'gggg', 'g.g.'];
  /** Life around the cottage, slow and quiet, one thing at a time: a duck family paddles across the
   * lake, a fox peeks out from the pines, a raccoon wanders up to the door and slips inside.
   * (This replaced the avatars that marched along the bottom of the menu.) @param {CanvasRenderingContext2D} g @param {number} frame */
  function life(g, frame) {
    const s = frame / 30; // seconds
    // Ducks: cross every 70 s, taking 45 s about it; a little V of ripples behind.
    const dk = s % 70;
    if (dk < 45) {
      const x = Math.round(-16 + (dk / 45) * (W + 32)), y = HORIZON + 26 + Math.round(Math.sin(s * 1.3));
      g.fillStyle = 'rgba(169,163,217,0.25)';
      for (let k = 1; k < 4; k++) { g.fillRect(x - 3 * k, y + 4 + (k >> 1), 2, 1); g.fillRect(x - 3 * k, y + 2 - (k >> 1), 2, 1); }
      sprite(g, DUCK, { h: '#2f7d4a', b: '#8a6a4a', k: '#f2a33a' }, x, y);
      sprite(g, DUCKLING, { y: '#ffd84a', o: '#f2a33a' }, x - 8, y + 2);
      sprite(g, DUCKLING, { y: '#ffd84a', o: '#f2a33a' }, x - 13, y + 2);
    }
    // Fox: every 50 s, at the pines on the left, rises, looks about for 4 s, ducks down.
    const fk = (s + 20) % 50;
    if (fk < 6) {
      const up = fk < 1 ? fk : fk > 5 ? 6 - fk : 1; // 0 → 1 → 0
      const look = fk > 2.5 && fk < 4; // turns its head
      sprite(g, FOX, { f: '#e2702a', e: '#1a1016', w: '#f4f1e8' }, 74, HORIZON - Math.round(up * 4), look);
    }
    // Raccoon: every 90 s, walks along the shore from the left to the cottage door (16 s) and in.
    const rk = (s + 40) % 90;
    if (rk < 16) {
      const x = Math.round(150 + (rk / 16) * 69), y = HORIZON - 5 + ((frame >> 3) & 1);
      sprite(g, RACCOON, { g: '#6b6d78', m: '#1a1016' }, x, y);
    }
  }

  /** Draws every `round(30 / fps)` clock frames (the TV asks for 12, phones 4); motion is in clock frames,
   * so speeds stay the same whatever the rate — only the number of drawings changes.
   * @param {HTMLCanvasElement} canvas @param {{ fps?: number }} [opts] */
  function start(canvas, opts) {
    const fps = opts && opts.fps;
    const step = fps && fps > 0 ? Math.max(1, Math.round(30 / fps)) : 1;
    canvas.width = W; canvas.height = H;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const r = rand(42);
    const layer = document.createElement('canvas');
    layer.width = W; layer.height = H;
    for (const [k, v] of Object.entries(THEMES)) v.name = k;
    let th = THEMES.lobby;
    const repaint = () => paintStatic(/** @type {CanvasRenderingContext2D} */ (layer.getContext('2d')), rand(7), th);
    repaint();

    const stars = Array.from({ length: 90 }, () => ({ x: (r() * W) | 0, y: (r() * (HORIZON - 30)) | 0, p: r() * 6.28, b: r() }));
    const flies = Array.from({ length: 14 }, () => ({ x: r() * W, y: HORIZON - 30 + r() * 26, vx: (r() - 0.5) * 0.12, vy: (r() - 0.5) * 0.08, p: r() * 6.28 }));
    /** @type {{ x: number, y: number, l: number } | null} */
    let shooting = null;

    let drawn = 0; // drawings so far: the campfire flicker steps per drawing, so it flickers at any rate
    let lastFrame = 0;
    /** @param {number} frame clock frame @param {number} dt clock frames since the last drawing (0 = redraw, nothing moves) */
    function paint(frame, dt) {
      const t = frame * TICKS_PER_FRAME;
      if (dt) drawn++;
      const flick = step === 1 ? frame : drawn;
      g.drawImage(layer, 0, 0);
      // Stars, one colour at a time (switching the fill colour per star is what costs).
      for (const bright of [false, true]) {
        g.fillStyle = bright ? '#ffffff' : '#a9a3d9';
        for (const s of th.stars ? stars : []) {
          const tw = Math.sin(t / 6 + s.p) * 0.5 + 0.5;
          if ((tw < 0.25 && s.b < 0.6) || (tw > 0.85 && s.b > 0.7) !== bright) continue;
          g.fillRect(s.x, s.y, 1, 1);
          if (s.b > 0.93 && tw > 0.8) { g.fillRect(s.x - 1, s.y, 3, 1); g.fillRect(s.x, s.y - 1, 1, 3); }
        }
      }
      if (!shooting && dt && Math.random() < 0.0016 * dt) shooting = { x: 40 + Math.random() * 180, y: 6 + Math.random() * 30, l: 0 };
      if (shooting) {
        g.fillStyle = '#ffffff';
        for (let i = 0; i < 8; i++) g.fillRect(Math.round(shooting.x - i * 2), Math.round(shooting.y - i), 1, 1);
        shooting.x += 1.6 * dt; shooting.y += 0.8 * dt; shooting.l += dt;
        if (shooting.l > 45) shooting = null;
      }
      // lit windows flicker
      g.fillStyle = Math.sin(t / 10) > -0.95 ? th.window : '#7a5a2e';
      g.fillRect(211, HORIZON - 11, 6, 5); g.fillRect(228, HORIZON - 11, 6, 5);
      g.fillStyle = '#1a1016'; g.fillRect(214, HORIZON - 11, 1, 5); g.fillRect(231, HORIZON - 11, 1, 5); g.fillRect(211, HORIZON - 9, 6, 1); g.fillRect(228, HORIZON - 9, 6, 1);
      // campfire on the shore: flickering flames, sparks, a warm glow and its reflection
      const fx = 190, fy = HORIZON - 2;
      // round, dithered glow (a flat rectangle read as a grey box)
      g.drawImage(glowSprite(0.85 + 0.15 * Math.sin(frame / 5), flick & 1), fx - 10, fy - 8);
      for (let k = 0; k < 3; k++) { const h = 2 + ((flick + k * 5) % 4); g.fillStyle = k === 1 ? '#ffd23f' : '#ff8a3d'; g.fillRect(fx - 1 + k, fy - h, 1, h); }
      if (frame % 20 < 3) { g.fillStyle = '#ffd23f'; g.fillRect(fx + ((frame >> 2) % 3) - 1, fy - 6 - (frame % 20), 1, 1); }
      for (let y = HORIZON + 1; y < HORIZON + 10; y += 2) { g.fillStyle = 'rgba(255,150,60,0.22)'; g.fillRect(fx - 1 + Math.round(Math.sin((y + t) / 2)), y, 3, 1); }
      // chimney smoke: slow puffs that rise, drift with the breeze, grow and fade
      for (let i = 0; i < 7; i++) {
        const age = ((t * 0.012 + i / 7) % 1); // 0 = just out of the chimney, 1 = gone
        const yy = Math.round(HORIZON - 31 - age * 30);
        const xx = Math.round(232 + age * 14 + Math.sin(age * 6 + i) * 1.5);
        const size = 2 + Math.round(age * 4);
        g.fillStyle = `rgba(205,205,222,${(0.32 * (1 - age)).toFixed(2)})`;
        g.fillRect(xx, yy, size, Math.max(2, size - 1));
      }
      life(g, frame);
      // reflections + shimmer
      g.fillStyle = th.glowFill || (th.glowFill = `rgba(${th.glow},0.35)`);
      for (let y = HORIZON + 2; y < H; y += 2) {
        const wob = Math.round(Math.sin((y + t) / 3) * 2);
        const w = 4 + (Math.round(y * 7 + t) % 5);
        g.fillRect(262 - (w >> 1) + wob, y, w, 1);
      }
      g.fillStyle = 'rgba(255,207,90,0.35)';
      for (let y = HORIZON + 2; y < HORIZON + 22; y += 2) {
        const wob = Math.round(Math.sin((y + t) / 3) * 2);
        g.fillRect(211 + wob, y, 5, 1); g.fillRect(228 + wob, y, 5, 1);
      }
      g.fillStyle = 'rgba(169,163,217,0.18)';
      for (let i = 0; i < 26; i++) {
        const x = Math.round((i * 53 + t * (1 + (i % 3))) % W);
        const y = HORIZON + 4 + ((i * 29) % (H - HORIZON - 6));
        g.fillRect(x, y, 3 + (i % 4), 1);
      }
      const lit = [];
      for (const f of flies) {
        f.x += (f.vx + Math.sin((t + f.p * 10) / 15) * 0.06) * dt;
        f.y += (f.vy + Math.cos((t + f.p * 10) / 20) * 0.04) * dt;
        if (f.x < 0) f.x = W; if (f.x > W) f.x = 0;
        if (f.y < HORIZON - 40) f.vy = Math.abs(f.vy); if (f.y > HORIZON + 4) f.vy = -Math.abs(f.vy);
        if (Math.sin(t / 4 + f.p * 3) > 0.2) lit.push(Math.round(f.x), Math.round(f.y));
      }
      g.fillStyle = th.fly;
      for (let i = 0; i < lit.length; i += 2) g.fillRect(lit[i], lit[i + 1], 1, 1);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      for (let i = 0; i < lit.length; i += 2) { g.fillRect(lit[i] - 1, lit[i + 1], 3, 1); g.fillRect(lit[i], lit[i + 1] - 1, 1, 3); }
      const an = th.name ? ANIM[th.name] : undefined;
      if (an) an(g, t);
    }
    /** Clock subscriber: draws only every `step` frames. @param {number} frame */
    function draw(frame) {
      if (frame - lastFrame < step && frame > lastFrame) return;
      const dt = frame > lastFrame ? Math.min(frame - lastFrame, step * 4) : step;
      lastFrame = frame;
      paint(frame, dt);
    }

    paint(0, 1);
    /** Switch scene palette (game id or 'lobby'). @param {string} name */
    const setTheme = (name) => {
      const next = THEMES[name] || THEMES.lobby;
      if (next === th) return;
      th = next;
      repaint();
      paint(lastFrame, 0);
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { stop() {}, setTheme, step };
    return { stop: window.Rumpus.clock.add(draw), setTheme, step };
  }

  window.Rumpus.background = start;
  window.Rumpus.bgThemes = Object.keys(THEMES);
})();
