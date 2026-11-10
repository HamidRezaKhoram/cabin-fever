/* Rumpus character maker — original 16×16 pixel characters built from parts.
 * AGPLv3, see LICENSE.
 *
 * Phone-editor pattern (common in avatar creators): big live preview on top,
 * category tabs, options shown as tiles rendered ON YOUR character, colour
 * parts as swatches, plus Random and Undo.
 * Part counts must match games/avatar-schema.js (a static test checks).
 */
'use strict';

(function () {
  const OUT = '#1a1423';
  const SKIN = ['#f6d5b8', '#eec09a', '#d9a07a', '#b97c55', '#8d5a3a', '#5e3a24'];
  const HAIR_COLOR = ['#2b1d14', '#5a3a22', '#8a5a2b', '#d9a441', '#f2e2a0', '#b0322e', '#e8e8e8', '#7a5cff', '#2fbf8a'];
  const EYE_COLOR = ['#1a1423', '#1e6fd9', '#2e9d4f', '#7a4a1e', '#8a3fd1'];
  const SHIRT = ['#e83f5b', '#1e88e5', '#4caf50', '#ffb02e', '#9c6ade', '#2b2d42', '#f4f1e8', '#ff8fb3', '#00a6a6'];
  const BG = ['', '#5ee0a0', '#4fc3f7', '#ffd23f', '#ff8fb3', '#9c6ade', '#ff7a45', '#2b2d42'];
  const NAMES = {
    skin: ['Light', 'Fair', 'Tan', 'Medium', 'Brown', 'Deep'],
    eyes: ['Dots', 'Wide', 'Sleepy', 'Wink', 'Lashes', 'Angry'],
    eyeColor: ['Dark', 'Blue', 'Green', 'Hazel', 'Violet'],
    brows: ['None', 'Thin', 'Thick', 'Raised', 'Unibrow'],
    nose: ['None', 'Dot', 'Button', 'Long'],
    mouth: ['Smile', 'Grin', 'Open', 'Flat', 'Smirk', 'Tongue'],
    cheeks: ['None', 'Blush', 'Freckles'],
    hair: ['Short', 'Long', 'Bun', 'Mohawk', 'Curly', 'Bald', 'Ponytail', 'Bob', 'Spiky'],
    hairColor: ['Black', 'Brown', 'Auburn', 'Blond', 'Platinum', 'Red', 'Grey', 'Purple', 'Teal'],
    facial: ['None', 'Moustache', 'Beard', 'Goatee'],
    hat: ['None', 'Toque', 'Cap', 'Cowboy', 'Crown', 'Party', 'Bucket'],
    glasses: ['None', 'Round', 'Square', 'Shades'],
    earrings: ['None', 'Studs', 'Hoops'],
    accessory: ['None', 'Headphones', 'Bandana', 'Flower', 'Scarf'],
    shirtStyle: ['Tee', 'Hoodie', 'Collar', 'Flannel', 'Tank'],
    shirt: ['Red', 'Blue', 'Green', 'Orange', 'Purple', 'Navy', 'White', 'Pink', 'Teal'],
    bg: ['None', 'Mint', 'Sky', 'Sun', 'Bubblegum', 'Grape', 'Sunset', 'Night'],
  };
  const LABELS = {
    skin: 'Skin', eyes: 'Eyes', eyeColor: 'Eye colour', brows: 'Eyebrows', nose: 'Nose', mouth: 'Mouth', cheeks: 'Cheeks',
    hair: 'Hair', hairColor: 'Hair colour', facial: 'Facial hair', hat: 'Hat', glasses: 'Glasses', earrings: 'Earrings',
    accessory: 'Extras', shirtStyle: 'Top', shirt: 'Top colour', bg: 'Backdrop',
  };
  /** Colour parts get swatches instead of tiles. */
  const SWATCH = { skin: SKIN, hairColor: HAIR_COLOR, eyeColor: EYE_COLOR, shirt: SHIRT, bg: BG };
  const TABS = [
    { id: 'face', icon: '🙂', label: 'Face', parts: ['skin', 'eyes', 'eyeColor', 'brows', 'nose', 'mouth', 'cheeks'] },
    { id: 'hair', icon: '💇', label: 'Hair', parts: ['hair', 'hairColor', 'facial'] },
    { id: 'style', icon: '🎩', label: 'Style', parts: ['hat', 'glasses', 'earrings', 'accessory'] },
    { id: 'outfit', icon: '👕', label: 'Outfit', parts: ['shirtStyle', 'shirt', 'bg'] },
  ];
  const PARTS = Object.keys(NAMES);

  /** @param {Record<string, number>} look */
  function norm(look) {
    const l = {};
    for (const p of PARTS) l[p] = Number.isInteger(look && look[p]) ? look[p] : 0;
    return l;
  }

  /** @param {Record<string, number>} raw @returns {string[][]} 16×16 colour grid ('' = transparent) */
  function build(raw) {
    const look = norm(raw);
    const g = Array.from({ length: 16 }, () => Array(16).fill(''));
    const set = (x, y, c) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
    const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c); };
    const skin = SKIN[look.skin], hc = HAIR_COLOR[look.hairColor], shirt = SHIRT[look.shirt];
    const dark = (hex) => '#' + hex.slice(1).match(/../g).map((h) => Math.max(0, parseInt(h, 16) - 50).toString(16).padStart(2, '0')).join('');
    // top (shirt style)
    rect(3, 14, 10, 2, shirt); rect(2, 15, 12, 1, shirt); rect(6, 14, 4, 1, shirt);
    switch (look.shirtStyle) {
      case 1: rect(3, 13, 2, 2, shirt); rect(11, 13, 2, 2, shirt); set(7, 15, '#f4f1e8'); set(8, 15, '#f4f1e8'); break; // hoodie + strings
      case 2: set(6, 14, '#f4f1e8'); set(9, 14, '#f4f1e8'); set(7, 15, dark(shirt)); set(8, 15, dark(shirt)); break;   // collar
      case 3: for (let x = 2; x < 14; x++) for (let y = 14; y < 16; y++) if ((x + y) % 3 === 0) set(x, y, dark(shirt)); break; // flannel
      case 4: rect(3, 14, 2, 2, skin); rect(11, 14, 2, 2, skin); rect(2, 15, 1, 1, skin); rect(13, 15, 1, 1, skin); break; // tank
      default: break;
    }
    // head + neck + ears
    rect(7, 13, 2, 1, skin);
    rect(4, 4, 8, 9, skin); set(4, 4, ''); set(11, 4, ''); set(4, 12, ''); set(11, 12, '');
    set(3, 8, skin); set(12, 8, skin);
    // earrings
    if (look.earrings === 1) { set(3, 9, '#ffd23f'); set(12, 9, '#ffd23f'); }
    if (look.earrings === 2) { set(3, 9, '#ffd23f'); set(3, 10, '#ffd23f'); set(12, 9, '#ffd23f'); set(12, 10, '#ffd23f'); }
    // hair
    switch (look.hair) {
      case 0: rect(4, 3, 8, 2, hc); set(4, 5, hc); set(11, 5, hc); break;
      case 1: rect(4, 3, 8, 2, hc); rect(3, 4, 1, 9, hc); rect(12, 4, 1, 9, hc); set(4, 5, hc); set(11, 5, hc); break;
      case 2: rect(4, 3, 8, 2, hc); rect(6, 1, 4, 2, hc); break;
      case 3: rect(7, 0, 2, 5, hc); break;
      case 4: for (let x = 3; x <= 12; x++) { set(x, 3, hc); if (x % 2) set(x, 2, hc); } set(3, 4, hc); set(12, 4, hc); set(3, 5, hc); set(12, 5, hc); break;
      case 5: break;
      case 6: rect(4, 3, 8, 2, hc); rect(12, 5, 1, 1, hc); rect(13, 6, 1, 4, hc); break;
      case 7: rect(4, 3, 8, 2, hc); rect(3, 4, 1, 5, hc); rect(12, 4, 1, 5, hc); rect(4, 5, 2, 1, hc); break;
      default: for (let x = 4; x <= 11; x++) set(x, x % 2 ? 2 : 3, hc); rect(4, 3, 8, 1, hc); break;
    }
    // eyebrows
    const B = look.hairColor === 6 || look.hairColor === 4 ? '#8a7a6a' : hc;
    if (look.brows === 1) { set(5, 6, B); set(6, 6, B); set(9, 6, B); set(10, 6, B); }
    if (look.brows === 2) { rect(5, 6, 3, 1, B); rect(8, 6, 3, 1, B); }
    if (look.brows === 3) { set(5, 6, B); set(6, 5, B); set(9, 5, B); set(10, 6, B); }
    if (look.brows === 4) rect(5, 6, 6, 1, B);
    // eyes
    const E = EYE_COLOR[look.eyeColor];
    switch (look.eyes) {
      case 0: set(6, 8, E); set(9, 8, E); break;
      case 1: rect(5, 7, 2, 2, '#fff'); rect(9, 7, 2, 2, '#fff'); set(6, 8, E); set(9, 8, E); break;
      case 2: rect(5, 8, 2, 1, E); rect(9, 8, 2, 1, E); break;
      case 3: set(6, 8, E); rect(9, 8, 2, 1, OUT); break;
      case 4: set(6, 8, E); set(9, 8, E); set(5, 7, OUT); set(10, 7, OUT); break;
      default: set(6, 8, E); set(9, 8, E); set(5, 7, OUT); set(10, 7, OUT); break;
    }
    // nose + cheeks
    const N = dark(skin);
    if (look.nose === 1) set(8, 9, N);
    if (look.nose === 2) { set(7, 9, N); set(8, 9, N); }
    if (look.nose === 3) { set(8, 8, N); set(8, 9, N); set(7, 9, N); }
    if (look.cheeks === 1) { set(5, 10, '#ff8fa3'); set(10, 10, '#ff8fa3'); }
    if (look.cheeks === 2) { set(5, 9, N); set(6, 10, N); set(10, 9, N); set(9, 10, N); }
    // mouth
    const M = '#8a2a3a';
    switch (look.mouth) {
      case 0: set(6, 10, M); rect(7, 11, 2, 1, M); set(9, 10, M); break;
      case 1: rect(6, 10, 4, 2, '#fff'); rect(6, 10, 4, 1, M); break;
      case 2: rect(7, 10, 2, 2, M); break;
      case 3: rect(6, 11, 4, 1, M); break;
      case 4: rect(6, 11, 3, 1, M); set(9, 10, M); break;
      default: rect(6, 10, 4, 1, M); rect(7, 11, 2, 1, '#ff7a90'); break;
    }
    // facial hair
    if (look.facial === 1) rect(6, 10, 4, 1, hc);
    if (look.facial === 2) { rect(4, 10, 1, 3, hc); rect(11, 10, 1, 3, hc); rect(5, 12, 6, 1, hc); rect(6, 10, 4, 1, hc); }
    if (look.facial === 3) { rect(6, 10, 4, 1, hc); rect(7, 12, 2, 1, hc); }
    // glasses
    const F = '#2b2d42';
    if (look.glasses === 1) { for (const ox of [5, 9]) { set(ox - 1, 8, F); set(ox + 2, 8, F); set(ox, 7, F); set(ox + 1, 7, F); set(ox, 9, F); set(ox + 1, 9, F); } set(7, 8, F); set(8, 8, F); }
    if (look.glasses === 2) { rect(4, 7, 4, 1, F); rect(8, 7, 4, 1, F); rect(4, 9, 4, 1, F); rect(8, 9, 4, 1, F); set(4, 8, F); set(7, 8, F); set(8, 8, F); set(11, 8, F); }
    if (look.glasses === 3) { rect(4, 7, 8, 2, F); set(5, 7, '#6a6f8a'); set(9, 7, '#6a6f8a'); }
    // extras
    if (look.accessory === 1) { rect(3, 3, 10, 1, '#2b2d42'); rect(2, 7, 2, 3, '#e83f5b'); rect(12, 7, 2, 3, '#e83f5b'); }       // headphones
    if (look.accessory === 2) { rect(4, 4, 8, 1, '#e83f5b'); set(12, 5, '#e83f5b'); set(13, 6, '#e83f5b'); }                     // bandana
    if (look.accessory === 3) { set(11, 3, '#ff8fb3'); set(12, 4, '#ff8fb3'); set(10, 4, '#ff8fb3'); set(11, 5, '#ff8fb3'); set(11, 4, '#ffd23f'); } // flower
    if (look.accessory === 4) { rect(4, 13, 8, 1, '#ffb02e'); rect(9, 14, 2, 2, '#ffb02e'); }                                       // scarf
    // hats
    switch (look.hat) {
      case 1: rect(4, 1, 8, 3, '#e83f5b'); rect(4, 3, 8, 1, '#f4f1e8'); rect(7, 0, 2, 1, '#f4f1e8'); break;
      case 2: rect(4, 2, 8, 2, '#1e88e5'); rect(9, 4, 5, 1, '#1e88e5'); break;
      case 3: rect(5, 0, 6, 3, '#8a5a3b'); rect(2, 3, 12, 1, '#8a5a3b'); rect(5, 2, 6, 1, '#5a3418'); break;
      case 4: rect(4, 2, 8, 2, '#ffd23f'); set(4, 1, '#ffd23f'); set(7, 1, '#ffd23f'); set(8, 1, '#ffd23f'); set(11, 1, '#ffd23f'); set(7, 2, '#e83f5b'); break;
      case 5: set(8, 0, '#ffd23f'); rect(7, 1, 3, 1, '#9c6ade'); rect(6, 2, 5, 1, '#4caf50'); rect(5, 3, 7, 1, '#9c6ade'); break;
      case 6: rect(4, 2, 8, 2, '#6b8f5a'); rect(3, 4, 10, 1, '#6b8f5a'); break;
      default: break;
    }
    // outline, then backdrop behind everything
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
  /** @param {Record<string, number>} look @returns {string} PNG data URL */
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
    for (const [p, keep] of [['facial', 0.35], ['glasses', 0.35], ['hat', 0.5], ['earrings', 0.3], ['accessory', 0.3], ['brows', 0.8], ['cheeks', 0.4], ['nose', 0.7]]) {
      if (Math.random() > keep) l[p] = 0;
    }
    if (l.brows === 4 && Math.random() < 0.7) l.brows = 2; // unibrow is a rare treat
    return l;
  }

  /**
   * Mount the editor into `el`. Calls onChange(look) on every change.
   * @param {HTMLElement} el @param {Record<string, number>} look @param {(look: Record<string, number>) => void} onChange
   */
  function editor(el, look, onChange) {
    let cur = norm(look);
    /** @type {Record<string, number>[]} */
    const undo = [];
    let tab = 'face';
    const optionHtml = (p) => {
      const n = NAMES[p].length;
      const items = Array.from({ length: n }, (_, i) => {
        const on = cur[p] === i;
        if (SWATCH[p]) {
          const col = SWATCH[p][i];
          return `<button type="button" class="swatch-opt ${on ? 'on' : ''}" data-part="${p}" data-val="${i}" aria-label="${LABELS[p]}: ${NAMES[p][i]}" aria-pressed="${on}"
            style="background:${col || 'repeating-conic-gradient(#444 0 25%, #222 0 50%) 0 0 / 12px 12px'}"></button>`;
        }
        return `<button type="button" class="tile-opt ${on ? 'on' : ''}" data-part="${p}" data-val="${i}" aria-label="${LABELS[p]}: ${NAMES[p][i]}" aria-pressed="${on}">
          <img src="${url({ ...cur, [p]: i })}" alt=""><span>${NAMES[p][i]}</span></button>`;
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
    PARTS, NAMES, TABS, url, random, editor,
    counts: Object.fromEntries(PARTS.map((p) => [p, NAMES[p].length])),
  };
})();
