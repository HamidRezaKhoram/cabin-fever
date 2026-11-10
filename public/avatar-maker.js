/* Rumpus character maker — original 16×16 pixel characters built from parts.
 * AGPLv3, see LICENSE.
 *
 * Focused on the choices that change a character the most (face shape, hair,
 * makeup, accessories) — tiny details that barely show at 16 px were removed.
 * Layout: presets to start from, big live preview, Face/Hair/Style/Outfit tabs,
 * options as tiles rendered on your character, colours as swatches, Random + Undo.
 * Part counts must match games/avatar-schema.js (a static test checks).
 */
'use strict';

(function () {
  const OUT = '#1a1423';
  const SKIN = ['#f6d5b8', '#eec09a', '#d9a07a', '#b97c55', '#8d5a3a', '#5e3a24'];
  const HAIR_COLOR = ['#2b1d14', '#5a3a22', '#8a5a2b', '#d9a441', '#f2e2a0', '#b0322e', '#e8e8e8', '#e86fb0', '#7a5cff'];
  const TOP = ['#e83f5b', '#1e88e5', '#4caf50', '#ffb02e', '#9c6ade', '#2b2d42', '#f4f1e8', '#ff8fb3', '#00a6a6'];
  const BG = ['', '#5ee0a0', '#4fc3f7', '#ffd23f', '#ff8fb3', '#9c6ade', '#ff7a45', '#2b2d42'];
  const NAMES = {
    faceShape: ['Round', 'Oval', 'Square', 'Heart', 'Long'],
    skin: ['Light', 'Fair', 'Tan', 'Medium', 'Brown', 'Deep'],
    eyes: ['Dots', 'Lashes', 'Wide', 'Sleepy'],
    mouth: ['Smile', 'Grin', 'Open', 'Smirk'],
    makeup: ['None', 'Blush', 'Lipstick', 'Both'],
    hair: ['Short', 'Long', 'Wavy', 'Bob', 'Pigtails', 'Braids', 'Side swept', 'Bun', 'Ponytail', 'Curly', 'Buzz', 'Mohawk', 'Bald'],
    hairColor: ['Black', 'Brown', 'Auburn', 'Blond', 'Platinum', 'Red', 'Grey', 'Pink', 'Purple'],
    facial: ['None', 'Moustache', 'Beard', 'Goatee'],
    glasses: ['None', 'Round', 'Square', 'Shades'],
    hat: ['None', 'Toque', 'Cap', 'Cowboy', 'Crown', 'Party', 'Bow'],
    earrings: ['None', 'Studs', 'Hoops'],
    top: ['Red', 'Blue', 'Green', 'Orange', 'Purple', 'Navy', 'White', 'Pink', 'Teal'],
    bg: ['None', 'Mint', 'Sky', 'Sun', 'Bubblegum', 'Grape', 'Sunset', 'Night'],
  };
  const LABELS = {
    faceShape: 'Face shape', skin: 'Skin', eyes: 'Eyes', mouth: 'Mouth', makeup: 'Makeup', hair: 'Hair',
    hairColor: 'Hair colour', facial: 'Facial hair', glasses: 'Glasses', hat: 'Hat', earrings: 'Earrings', top: 'Top', bg: 'Backdrop',
  };
  const SWATCH = { skin: SKIN, hairColor: HAIR_COLOR, top: TOP, bg: BG };
  const TABS = [
    { id: 'face', icon: '🙂', label: 'Face', parts: ['faceShape', 'skin', 'eyes', 'mouth', 'makeup'] },
    { id: 'hair', icon: '💇', label: 'Hair', parts: ['hair', 'hairColor', 'facial'] },
    { id: 'style', icon: '🎩', label: 'Style', parts: ['glasses', 'hat', 'earrings'] },
    { id: 'outfit', icon: '👕', label: 'Outfit', parts: ['top', 'bg'] },
  ];
  const PARTS = Object.keys(NAMES);
  /** Starting points — tweak from here. */
  const PRESETS = [
    { faceShape: 3, skin: 1, eyes: 1, mouth: 0, makeup: 3, hair: 1, hairColor: 3, facial: 0, glasses: 0, hat: 0, earrings: 2, top: 7, bg: 4 },
    { faceShape: 1, skin: 4, eyes: 1, mouth: 1, makeup: 2, hair: 9, hairColor: 0, facial: 0, glasses: 0, hat: 0, earrings: 1, top: 3, bg: 3 },
    { faceShape: 0, skin: 2, eyes: 1, mouth: 0, makeup: 1, hair: 4, hairColor: 5, facial: 0, glasses: 1, hat: 0, earrings: 0, top: 2, bg: 1 },
    { faceShape: 1, skin: 3, eyes: 1, mouth: 3, makeup: 2, hair: 6, hairColor: 8, facial: 0, glasses: 3, hat: 0, earrings: 2, top: 5, bg: 5 },
    { faceShape: 2, skin: 3, eyes: 0, mouth: 1, makeup: 0, hair: 0, hairColor: 1, facial: 2, glasses: 0, hat: 1, earrings: 0, top: 0, bg: 2 },
    { faceShape: 4, skin: 5, eyes: 2, mouth: 0, makeup: 0, hair: 10, hairColor: 0, facial: 1, glasses: 2, hat: 0, earrings: 1, top: 1, bg: 6 },
    { faceShape: 0, skin: 0, eyes: 3, mouth: 3, makeup: 0, hair: 11, hairColor: 7, facial: 0, glasses: 3, hat: 0, earrings: 2, top: 4, bg: 7 },
    { faceShape: 3, skin: 2, eyes: 1, mouth: 0, makeup: 1, hair: 7, hairColor: 2, facial: 0, glasses: 0, hat: 6, earrings: 1, top: 6, bg: 1 },
  ];

  /** Clamp/convert any stored look (incl. older formats) to valid indexes. @param {Record<string, number>} look */
  function norm(look) {
    const l = {};
    for (const p of PARTS) {
      const v = look && look[p];
      l[p] = Number.isInteger(v) ? ((v % NAMES[p].length) + NAMES[p].length) % NAMES[p].length : 0;
    }
    if (look && Number.isInteger(look.shirt) && !Number.isInteger(look.top)) l.top = look.shirt % TOP.length; // v1 field
    return l;
  }

  /** Head rows: y → [x0, x1] per face shape. */
  const SHAPES = [
    { 4: [5, 10], 5: [4, 11], 6: [4, 11], 7: [4, 11], 8: [4, 11], 9: [4, 11], 10: [4, 11], 11: [4, 11], 12: [5, 10] }, // round
    { 4: [5, 10], 5: [4, 11], 6: [4, 11], 7: [4, 11], 8: [4, 11], 9: [4, 11], 10: [4, 11], 11: [5, 10], 12: [6, 9] }, // oval
    { 4: [4, 11], 5: [4, 11], 6: [4, 11], 7: [4, 11], 8: [4, 11], 9: [4, 11], 10: [4, 11], 11: [4, 11], 12: [4, 11] }, // square
    { 4: [4, 11], 5: [4, 11], 6: [4, 11], 7: [4, 11], 8: [4, 11], 9: [4, 11], 10: [5, 10], 11: [6, 9], 12: [7, 8] },  // heart
    { 3: [5, 10], 4: [5, 10], 5: [5, 10], 6: [5, 10], 7: [5, 10], 8: [5, 10], 9: [5, 10], 10: [5, 10], 11: [5, 10], 12: [6, 9] }, // long
  ];

  /** @param {Record<string, number>} raw @returns {string[][]} */
  function build(raw) {
    const look = norm(raw);
    const g = Array.from({ length: 16 }, () => Array(16).fill(''));
    const set = (x, y, c) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
    const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c); };
    const skin = SKIN[look.skin], hc = HAIR_COLOR[look.hairColor], top = TOP[look.top];
    const shape = SHAPES[look.faceShape];
    const rows = Object.keys(shape).map(Number);
    const topY = Math.min(...rows);
    const [ex0, ex1] = shape[8];
    // hair that hangs behind the head/shoulders first
    if ([1, 2, 5].includes(look.hair)) { rect(ex0 - 1, topY + 1, 1, 10, hc); rect(ex1 + 1, topY + 1, 1, 10, hc); }
    if (look.hair === 2) for (let y = topY + 2; y < topY + 11; y += 2) { set(ex0 - 2, y, hc); set(ex1 + 2, y, hc); }   // waves
    if (look.hair === 5) { rect(ex0 - 1, 12, 1, 3, hc); rect(ex1 + 1, 12, 1, 3, hc); set(ex0 - 1, 15, '#e83f5b'); set(ex1 + 1, 15, '#e83f5b'); } // braids + ties
    // body
    rect(3, 14, 10, 2, top); rect(2, 15, 12, 1, top); rect(7, 13, 2, 1, skin);
    // head
    for (const y of rows) { const [a, b] = shape[y]; rect(a, y, b - a + 1, 1, skin); }
    set(ex0 - 1, 8, skin); set(ex1 + 1, 8, skin); // ears
    if (look.earrings === 1) { set(ex0 - 1, 9, '#ffd23f'); set(ex1 + 1, 9, '#ffd23f'); }
    if (look.earrings === 2) { set(ex0 - 1, 9, '#ffd23f'); set(ex0 - 1, 10, '#ffd23f'); set(ex1 + 1, 9, '#ffd23f'); set(ex1 + 1, 10, '#ffd23f'); }
    // hair on top
    const [tx0, tx1] = shape[topY];
    const cap = () => { rect(tx0, topY - 1, tx1 - tx0 + 1, 2, hc); set(ex0, topY + 1, hc); set(ex1, topY + 1, hc); };
    switch (look.hair) {
      case 0: cap(); break;                                                                   // short
      case 1: case 2: case 5: cap(); rect(ex0, topY + 1, 1, 2, hc); rect(ex1, topY + 1, 1, 2, hc); break; // long / wavy / braids
      case 3: cap(); rect(ex0 - 1, topY, 1, 6, hc); rect(ex1 + 1, topY, 1, 6, hc); rect(ex0, topY + 1, 2, 1, hc); break; // bob
      case 4: cap(); rect(ex0 - 2, topY + 2, 2, 4, hc); rect(ex1 + 1, topY + 2, 2, 4, hc); set(ex0 - 1, topY + 1, '#e83f5b'); set(ex1 + 1, topY + 1, '#e83f5b'); break; // pigtails
      case 6: cap(); rect(tx0, topY + 1, 4, 1, hc); set(tx0, topY + 2, hc); rect(ex1 + 1, topY, 1, 5, hc); break; // side swept
      case 7: cap(); rect(6, topY - 3, 4, 2, hc); break;                                     // bun
      case 8: cap(); rect(ex1 + 1, topY + 1, 1, 1, hc); rect(ex1 + 2, topY + 2, 1, 5, hc); break; // ponytail
      case 9: for (let x = tx0 - 1; x <= tx1 + 1; x++) { set(x, topY - 1, hc); if (x % 2) set(x, topY - 2, hc); } rect(ex0 - 1, topY, 1, 3, hc); rect(ex1 + 1, topY, 1, 3, hc); break; // curly
      case 10: rect(tx0, topY, tx1 - tx0 + 1, 1, hc); break;                                  // buzz
      case 11: rect(7, topY - 4, 2, 5, hc); break;                                            // mohawk
      default: break;                                                                          // bald
    }
    // eyes
    const E = OUT;
    if (look.eyes === 0) { set(6, 8, E); set(9, 8, E); }
    if (look.eyes === 1) { set(6, 8, E); set(9, 8, E); set(5, 7, E); set(10, 7, E); set(6, 7, E); set(9, 7, E); } // lashes
    if (look.eyes === 2) { rect(5, 7, 2, 2, '#fff'); rect(9, 7, 2, 2, '#fff'); set(6, 8, E); set(9, 8, E); }
    if (look.eyes === 3) { rect(5, 8, 2, 1, E); rect(9, 8, 2, 1, E); }
    // makeup + mouth
    if (look.makeup === 1 || look.makeup === 3) { set(5, 10, '#ff8fa3'); set(10, 10, '#ff8fa3'); }
    const lips = look.makeup >= 2 ? '#d21f4a' : '#8a2a3a';
    if (look.mouth === 0) { set(6, 10, lips); rect(7, 11, 2, 1, lips); set(9, 10, lips); }
    if (look.mouth === 1) { rect(6, 10, 4, 2, '#fff'); rect(6, 10, 4, 1, lips); }
    if (look.mouth === 2) rect(7, 10, 2, 2, lips);
    if (look.mouth === 3) { rect(6, 11, 3, 1, lips); set(9, 10, lips); }
    if (look.makeup >= 2 && look.mouth !== 1) rect(7, 11, 2, 1, lips);
    // facial hair follows the jaw
    if (look.facial === 1) rect(6, 10, 4, 1, hc);
    if (look.facial === 2) { for (const y of [10, 11, 12]) { const r = shape[y]; if (r) { set(r[0], y, hc); set(r[1], y, hc); } } const c = shape[12] || shape[11]; rect(c[0], 12, c[1] - c[0] + 1, 1, hc); rect(6, 10, 4, 1, hc); }
    if (look.facial === 3) { rect(6, 10, 4, 1, hc); rect(7, 12, 2, 1, hc); }
    // glasses
    const F = '#2b2d42';
    if (look.glasses === 1) { for (const ox of [5, 9]) { set(ox - 1, 8, F); set(ox + 2, 8, F); set(ox, 7, F); set(ox + 1, 7, F); set(ox, 9, F); set(ox + 1, 9, F); } set(7, 8, F); set(8, 8, F); }
    if (look.glasses === 2) { rect(4, 7, 4, 1, F); rect(8, 7, 4, 1, F); rect(4, 9, 4, 1, F); rect(8, 9, 4, 1, F); set(4, 8, F); set(7, 8, F); set(8, 8, F); set(11, 8, F); }
    if (look.glasses === 3) { rect(4, 7, 8, 2, F); set(5, 7, '#6a6f8a'); set(9, 7, '#6a6f8a'); }
    // hats (sit on the top of the head)
    const hy = topY - 1;
    switch (look.hat) {
      case 1: rect(tx0 - 1, hy - 2, tx1 - tx0 + 3, 3, '#e83f5b'); rect(tx0 - 1, hy, tx1 - tx0 + 3, 1, '#f4f1e8'); rect(7, hy - 3, 2, 1, '#f4f1e8'); break;
      case 2: rect(tx0 - 1, hy - 1, tx1 - tx0 + 3, 2, '#1e88e5'); rect(9, hy + 1, 5, 1, '#1e88e5'); break;
      case 3: rect(5, hy - 3, 6, 3, '#8a5a3b'); rect(2, hy, 12, 1, '#8a5a3b'); rect(5, hy - 1, 6, 1, '#5a3418'); break;
      case 4: rect(tx0, hy - 1, tx1 - tx0 + 1, 2, '#ffd23f'); set(tx0, hy - 2, '#ffd23f'); set(7, hy - 2, '#ffd23f'); set(8, hy - 2, '#ffd23f'); set(tx1, hy - 2, '#ffd23f'); set(7, hy - 1, '#e83f5b'); break;
      case 5: set(8, hy - 3, '#ffd23f'); rect(7, hy - 2, 3, 1, '#9c6ade'); rect(6, hy - 1, 5, 1, '#4caf50'); rect(5, hy, 7, 1, '#9c6ade'); break;
      case 6: rect(9, hy - 1, 2, 2, '#ff4f8b'); set(11, hy - 2, '#ff4f8b'); set(11, hy + 1, '#ff4f8b'); set(8, hy - 2, '#ff4f8b'); set(8, hy + 1, '#ff4f8b'); break; // bow
      default: break;
    }
    // outline, then backdrop
    const add = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (g[y][x]) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const v = g[y + dy] && g[y + dy][x + dx]; return v && v !== OUT; })) add.push([x, y]);
    }
    for (const [x, y] of add) g[y][x] = OUT;
    if (BG[look.bg]) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!g[y][x]) g[y][x] = BG[look.bg];
    return g;
  }

  const cache = new Map();
  /** @param {Record<string, number>} look @returns {string} */
  function url(look) {
    const l = norm(look);
    const key = PARTS.map((p) => l[p]).join('.');
    if (cache.has(key)) return cache.get(key);
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    build(l).forEach((row, y) => row.forEach((col, x) => { if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); } }));
    const u = c.toDataURL();
    cache.set(key, u);
    return u;
  }

  /** @returns {Record<string, number>} */
  function random() {
    const l = {};
    for (const p of PARTS) l[p] = Math.floor(Math.random() * NAMES[p].length);
    for (const [p, keep] of [['facial', 0.3], ['glasses', 0.35], ['hat', 0.4], ['earrings', 0.5], ['makeup', 0.5]]) if (Math.random() > keep) l[p] = 0;
    return l;
  }

  /**
   * @param {HTMLElement} el @param {Record<string, number>} look @param {(look: Record<string, number>) => void} onChange
   */
  function editor(el, look, onChange) {
    let cur = norm(look);
    /** @type {Record<string, number>[]} */
    const undo = [];
    let tab = 'face';
    const optionHtml = (p) => {
      const items = NAMES[p].map((name, i) => {
        const on = cur[p] === i;
        if (SWATCH[p]) {
          return `<button type="button" class="swatch-opt ${on ? 'on' : ''}" data-part="${p}" data-val="${i}" aria-label="${LABELS[p]}: ${name}" aria-pressed="${on}"
            style="background:${SWATCH[p][i] || 'repeating-conic-gradient(#444 0 25%, #222 0 50%) 0 0 / 12px 12px'}"></button>`;
        }
        return `<button type="button" class="tile-opt ${on ? 'on' : ''}" data-part="${p}" data-val="${i}" aria-label="${LABELS[p]}: ${name}" aria-pressed="${on}">
          <img src="${url({ ...cur, [p]: i })}" alt=""><span>${name}</span></button>`;
      }).join('');
      return `<section class="maker-part"><h3>${LABELS[p]}</h3><div class="${SWATCH[p] ? 'swatch-row' : 'tile-grid'}">${items}</div></section>`;
    };
    const render = () => {
      const t = TABS.find((x) => x.id === tab) || TABS[0];
      el.innerHTML = `<div class="maker">
        <div class="maker-top">
          <img class="maker-preview" src="${url(cur)}" alt="Your character" width="160" height="160">
          <div class="maker-actions">
            <button type="button" class="maker-random" data-random="1">🎲 Random</button>
            <button type="button" class="maker-undo" data-undo="1" ${undo.length ? '' : 'disabled'}>↶ Undo</button>
          </div>
        </div>
        <section class="maker-part"><h3>Start from</h3><div class="preset-row">${PRESETS.map((pr, i) =>
          `<button type="button" class="preset-opt" data-preset="${i}" aria-label="Preset ${i + 1}"><img src="${url(pr)}" alt=""></button>`).join('')}</div></section>
        <div class="maker-tabs" role="tablist">${TABS.map((x) => `<button type="button" role="tab" class="maker-tab ${x.id === tab ? 'on' : ''}" data-tab="${x.id}" aria-selected="${x.id === tab}">${x.icon}<span>${x.label}</span></button>`).join('')}</div>
        <div class="maker-panel" role="tabpanel">${t.parts.map(optionHtml).join('')}</div>
      </div>`;
    };
    el.addEventListener('click', (e) => {
      const b = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('button') : null);
      if (!b || !el.contains(b)) return;
      if (b.dataset.tab) { tab = b.dataset.tab; render(); return; }
      if (b.dataset.undo) { if (undo.length) cur = undo.pop(); }
      else if (b.dataset.random) { undo.push(cur); cur = random(); }
      else if (b.dataset.preset) { undo.push(cur); cur = norm(PRESETS[Number(b.dataset.preset)]); }
      else if (b.dataset.part) { undo.push(cur); cur = { ...cur, [b.dataset.part]: Number(b.dataset.val) }; }
      else return;
      if (undo.length > 30) undo.shift();
      render();
      onChange(cur);
    });
    render();
    return { get: () => cur };
  }

  window.Rumpus.avatarMaker = {
    PARTS, NAMES, TABS, PRESETS, url, random, editor, norm,
    counts: Object.fromEntries(PARTS.map((p) => [p, NAMES[p].length])),
  };
})();
