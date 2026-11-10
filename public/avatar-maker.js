/* Rumpus character maker — original 16×16 pixel characters built from parts.
 * AGPLv3, see LICENSE.
 *
 * A "look" is { skin, hair, hairColor, eyes, mouth, facial, glasses, hat, shirt }
 * (indexes; counts must match games/avatar-schema.js). Rendered client-side,
 * cached by key, outlined automatically.
 */
'use strict';

(function () {
  const OUT = '#1a1423';
  const SKIN = ['#f6d5b8', '#eec09a', '#d9a07a', '#b97c55', '#8d5a3a', '#5e3a24'];
  const HAIR_COLOR = ['#2b1d14', '#5a3a22', '#8a5a2b', '#d9a441', '#f2e2a0', '#b0322e', '#e8e8e8', '#7a5cff', '#2fbf8a'];
  const SHIRT = ['#e83f5b', '#1e88e5', '#4caf50', '#ffb02e', '#9c6ade', '#2b2d42', '#f4f1e8', '#ff8fb3', '#00a6a6'];
  const NAMES = {
    skin: ['Light', 'Fair', 'Tan', 'Medium', 'Brown', 'Deep'],
    hair: ['Short', 'Long', 'Bun', 'Mohawk', 'Curly', 'Bald', 'Ponytail', 'Bob', 'Spiky'],
    hairColor: ['Black', 'Brown', 'Auburn', 'Blond', 'Platinum', 'Red', 'Grey', 'Purple', 'Teal'],
    eyes: ['Dots', 'Wide', 'Sleepy', 'Wink', 'Lashes', 'Angry'],
    mouth: ['Smile', 'Grin', 'Open', 'Flat', 'Smirk', 'Tongue'],
    facial: ['None', 'Moustache', 'Beard', 'Goatee'],
    glasses: ['None', 'Round', 'Square', 'Shades'],
    hat: ['None', 'Toque', 'Cap', 'Cowboy', 'Crown', 'Party', 'Bucket'],
    shirt: ['Red', 'Blue', 'Green', 'Orange', 'Purple', 'Navy', 'White', 'Pink', 'Teal'],
  };
  const LABELS = { skin: 'Skin', hair: 'Hair', hairColor: 'Hair colour', eyes: 'Eyes', mouth: 'Mouth', facial: 'Facial hair', glasses: 'Glasses', hat: 'Hat', shirt: 'Shirt' };
  const PARTS = Object.keys(NAMES);

  /** @param {Record<string, number>} look @returns {string[][]} 16×16 colour grid ('' = transparent) */
  function build(look) {
    const g = Array.from({ length: 16 }, () => Array(16).fill(''));
    const set = (x, y, c) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
    const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c); };
    const skin = SKIN[look.skin], hc = HAIR_COLOR[look.hairColor], shirt = SHIRT[look.shirt];
    // body + head
    rect(3, 14, 10, 2, shirt); rect(2, 15, 12, 1, shirt); rect(6, 14, 4, 1, shirt);
    rect(7, 13, 2, 1, skin);
    rect(4, 4, 8, 9, skin); set(4, 4, ''); set(11, 4, ''); set(4, 12, ''); set(11, 12, '');
    set(3, 8, skin); set(12, 8, skin);
    // hair (behind/around the head)
    switch (look.hair) {
      case 0: rect(4, 3, 8, 2, hc); set(4, 5, hc); set(11, 5, hc); break;                              // short
      case 1: rect(4, 3, 8, 2, hc); rect(3, 4, 1, 9, hc); rect(12, 4, 1, 9, hc); set(4, 5, hc); set(11, 5, hc); break; // long
      case 2: rect(4, 3, 8, 2, hc); rect(6, 1, 4, 2, hc); break;                                         // bun
      case 3: rect(7, 0, 2, 5, hc); break;                                                               // mohawk
      case 4: for (let x = 3; x <= 12; x++) { set(x, 3, hc); if (x % 2) set(x, 2, hc); } set(3, 4, hc); set(12, 4, hc); set(3, 5, hc); set(12, 5, hc); break; // curly
      case 5: break;                                                                                     // bald
      case 6: rect(4, 3, 8, 2, hc); rect(12, 5, 1, 1, hc); rect(13, 6, 1, 4, hc); break;                 // ponytail
      case 7: rect(4, 3, 8, 2, hc); rect(3, 4, 1, 5, hc); rect(12, 4, 1, 5, hc); rect(4, 5, 2, 1, hc); break; // bob
      default: for (let x = 4; x <= 11; x++) set(x, x % 2 ? 2 : 3, hc); rect(4, 3, 8, 1, hc); break;     // spiky
    }
    // eyes (row 8)
    const E = '#1a1423';
    switch (look.eyes) {
      case 0: set(6, 8, E); set(9, 8, E); break;
      case 1: rect(5, 7, 2, 2, '#fff'); rect(9, 7, 2, 2, '#fff'); set(6, 8, E); set(9, 8, E); break;
      case 2: rect(5, 8, 2, 1, E); rect(9, 8, 2, 1, E); break;
      case 3: set(6, 8, E); rect(9, 8, 2, 1, E); break;
      case 4: set(6, 8, E); set(9, 8, E); set(5, 7, E); set(10, 7, E); break;
      default: set(6, 8, E); set(9, 8, E); set(5, 7, E); set(6, 7, ''); set(10, 7, E); break;
    }
    // mouth (rows 10–11)
    const M = '#8a2a3a';
    switch (look.mouth) {
      case 0: set(6, 10, M); rect(7, 11, 2, 1, M); set(9, 10, M); break;
      case 1: rect(6, 10, 4, 2, '#fff'); rect(6, 10, 4, 1, M); break;
      case 2: rect(7, 10, 2, 2, M); break;
      case 3: rect(6, 11, 4, 1, M); break;
      case 4: rect(6, 11, 3, 1, M); set(9, 10, M); break;
      default: rect(6, 10, 4, 1, M); rect(7, 11, 2, 1, '#ff7a90'); break;
    }
    // facial hair (hair colour)
    if (look.facial === 1) rect(6, 10, 4, 1, hc);
    if (look.facial === 2) { rect(4, 10, 1, 3, hc); rect(11, 10, 1, 3, hc); rect(5, 12, 6, 1, hc); rect(6, 10, 4, 1, hc); }
    if (look.facial === 3) { rect(6, 10, 4, 1, hc); rect(7, 12, 2, 1, hc); }
    // glasses
    const F = '#2b2d42';
    if (look.glasses === 1) { for (const ox of [5, 9]) { set(ox - 1, 8, F); set(ox + 2, 8, F); set(ox, 7, F); set(ox + 1, 7, F); set(ox, 9, F); set(ox + 1, 9, F); } set(7, 8, F); set(8, 8, F); }
    if (look.glasses === 2) { rect(4, 7, 4, 1, F); rect(8, 7, 4, 1, F); rect(4, 9, 4, 1, F); rect(8, 9, 4, 1, F); set(4, 8, F); set(7, 8, F); set(8, 8, F); set(11, 8, F); }
    if (look.glasses === 3) { rect(4, 7, 8, 2, F); set(5, 7, '#6a6f8a'); set(9, 7, '#6a6f8a'); }
    // hats
    switch (look.hat) {
      case 1: rect(4, 1, 8, 3, '#e83f5b'); rect(4, 3, 8, 1, '#f4f1e8'); rect(7, 0, 2, 1, '#f4f1e8'); break; // toque
      case 2: rect(4, 2, 8, 2, '#1e88e5'); rect(9, 4, 5, 1, '#1e88e5'); break;                           // cap
      case 3: rect(5, 0, 6, 3, '#8a5a3b'); rect(2, 3, 12, 1, '#8a5a3b'); rect(5, 2, 6, 1, '#5a3418'); break; // cowboy
      case 4: rect(4, 2, 8, 2, '#ffd23f'); set(4, 1, '#ffd23f'); set(7, 1, '#ffd23f'); set(8, 1, '#ffd23f'); set(11, 1, '#ffd23f'); set(7, 2, '#e83f5b'); break; // crown
      case 5: set(8, 0, '#ffd23f'); rect(7, 1, 3, 1, '#9c6ade'); rect(6, 2, 5, 1, '#4caf50'); rect(5, 3, 7, 1, '#9c6ade'); break; // party
      case 6: rect(4, 2, 8, 2, '#6b8f5a'); rect(3, 4, 10, 1, '#6b8f5a'); break;                          // bucket
      default: break;
    }
    // outline
    const add = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (g[y][x]) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const v = g[y + dy] && g[y + dy][x + dx]; return v && v !== OUT; })) add.push([x, y]);
    }
    for (const [x, y] of add) g[y][x] = OUT;
    return g;
  }

  const cache = new Map();
  /** @param {Record<string, number>} look @returns {string} PNG data URL */
  function url(look) {
    const key = PARTS.map((p) => look[p] | 0).join('.');
    if (cache.has(key)) return cache.get(key);
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    build(look).forEach((row, y) => row.forEach((col, x) => { if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); } }));
    const u = c.toDataURL();
    cache.set(key, u);
    return u;
  }

  /** @returns {Record<string, number>} */
  function random() {
    const l = {};
    for (const p of PARTS) l[p] = Math.floor(Math.random() * NAMES[p].length);
    if (Math.random() < 0.6) l.facial = 0;
    if (Math.random() < 0.6) l.glasses = 0;
    if (Math.random() < 0.4) l.hat = 0;
    return l;
  }

  /**
   * Mount an editor into `el`. Calls onChange(look) on every change.
   * @param {HTMLElement} el @param {Record<string, number>} look @param {(look: Record<string, number>) => void} onChange
   */
  function editor(el, look, onChange) {
    let cur = { ...look };
    const render = () => {
      el.innerHTML = `<div class="maker">
        <img class="maker-preview" src="${url(cur)}" alt="Your character preview" width="160" height="160">
        <div class="maker-rows">${PARTS.map((p) => `
          <div class="maker-row" role="group" aria-label="${LABELS[p]}">
            <button type="button" class="maker-arrow" data-part="${p}" data-step="-1" aria-label="Previous ${LABELS[p]}">◀</button>
            <span class="maker-label"><small>${LABELS[p]}</small>${NAMES[p][cur[p]]}</span>
            <button type="button" class="maker-arrow" data-part="${p}" data-step="1" aria-label="Next ${LABELS[p]}">▶</button>
          </div>`).join('')}
        </div>
        <button type="button" class="maker-random" data-random="1">🎲 Random</button>
      </div>`;
    };
    el.addEventListener('click', (e) => {
      const b = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('button') : null);
      if (!b) return;
      if (b.dataset.random) cur = random();
      else if (b.dataset.part) {
        const p = b.dataset.part, n = NAMES[p].length;
        cur = { ...cur, [p]: (cur[p] + Number(b.dataset.step) + n) % n };
      } else return;
      render();
      onChange(cur);
    });
    render();
    return { get: () => cur };
  }

  window.Rumpus.avatarMaker = {
    PARTS, NAMES, url, random, editor,
    counts: Object.fromEntries(PARTS.map((p) => [p, NAMES[p].length])),
  };
})();
