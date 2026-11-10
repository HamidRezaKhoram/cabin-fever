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
  // New options are appended (saved looks keep their indexes); ORDER sets how they're shown.
  const SKIN = ['#f6d5b8', '#eec09a', '#d9a07a', '#b97c55', '#8d5a3a', '#5e3a24', '#fde7d6', '#c99467', '#a5683f', '#3f2416'];
  const HAIR_COLOR = ['#2b1d14', '#5a3a22', '#8a5a2b', '#d9a441', '#f2e2a0', '#b0322e', '#e8e8e8', '#e86fb0', '#7a5cff', '#140c08', '#c4622d', '#7a6450', '#3a7bd5'];
  const TOP = ['#e83f5b', '#1e88e5', '#4caf50', '#ffb02e', '#9c6ade', '#2b2d42', '#f4f1e8', '#ff8fb3', '#00a6a6'];
  const BG = ['', '#5ee0a0', '#4fc3f7', '#ffd23f', '#ff8fb3', '#9c6ade', '#ff7a45', '#2b2d42'];
  const NAMES = {
    faceShape: ['Round', 'Oval', 'Square', 'Heart', 'Long'],
    skin: ['Light', 'Fair', 'Tan', 'Medium', 'Brown', 'Deep', 'Porcelain', 'Olive', 'Bronze', 'Ebony'],
    eyes: ['Dots', 'Lashes', 'Wide', 'Sleepy', 'Almond', 'Big'],
    mouth: ['Smile', 'Grin', 'Open', 'Smirk'],
    makeup: ['None', 'Blush', 'Lipstick', 'Both'],
    hair: ['Short', 'Long', 'Wavy', 'Bob', 'Pigtails', 'Braids', 'Side swept', 'Bun', 'Ponytail', 'Curly', 'Buzz', 'Mohawk', 'Bald',
      'Afro', 'Afro puffs', 'Box braids', 'Cornrows', 'Locs', 'Coils', 'Twists', 'High top', 'Long curls', 'Long straight',
      'Long plait', 'Top knot', 'Bantu knots', 'Waves', 'Undercut'],
    hairColor: ['Black', 'Brown', 'Auburn', 'Blond', 'Platinum', 'Red', 'Grey', 'Pink', 'Purple', 'Jet black', 'Ginger', 'Ash', 'Blue'],
    facial: ['None', 'Moustache', 'Beard', 'Goatee', 'Full beard', 'Stubble', 'Chinstrap'],
    glasses: ['None', 'Round', 'Square', 'Shades'],
    hat: ['None', 'Toque', 'Cap', 'Cowboy', 'Crown', 'Party', 'Bow', 'Hijab', 'Turban', 'Headwrap', 'Kufi', 'Durag', 'Bandana',
      'Santa hat', 'Witch hat', 'Bunny ears', 'Maple crown', 'Grad cap'],
    earrings: ['None', 'Studs', 'Hoops'],
    top: ['Red', 'Blue', 'Green', 'Orange', 'Purple', 'Navy', 'White', 'Pink', 'Teal'],
    bg: ['None', 'Mint', 'Sky', 'Sun', 'Bubblegum', 'Grape', 'Sunset', 'Night'],
  };
  const LABELS = {
    faceShape: 'Face shape', skin: 'Skin', eyes: 'Eyes', mouth: 'Mouth', makeup: 'Makeup', hair: 'Hair',
    hairColor: 'Hair colour', facial: 'Facial hair', glasses: 'Glasses', hat: 'Hat', earrings: 'Earrings', top: 'Top', bg: 'Backdrop',
  };
  const SWATCH = { skin: SKIN, hairColor: HAIR_COLOR, top: TOP, bg: BG };
  /** Display order (light → deep skin; similar hair styles together). Parts not listed show in index order. */
  /** Seasonal hat for a date: Christmas, Halloween, Easter, Canada Day, graduation. @param {Date} d @returns {number} */
  function seasonHat(d) {
    const m = d.getMonth() + 1, day = d.getDate();
    if (m === 12) return 13;
    if (m === 10) return 14;
    if (m === 3 || m === 4) return 15;
    if ((m === 6 && day >= 20) || (m === 7 && day <= 10)) return 16;
    if (m === 5 || m === 6) return 17;
    return -1;
  }
  const SEASON = seasonHat(new Date());
  const hatOrder = [0, ...(SEASON > 0 ? [SEASON] : []), ...Array.from({ length: 17 }, (_, i) => i + 1).filter((i) => i !== SEASON)];
  /** @type {Record<string, number[]>} */
  const ORDER = {
    hat: hatOrder,
    skin: [6, 0, 1, 2, 7, 3, 8, 4, 5, 9],
    hairColor: [9, 0, 1, 2, 11, 10, 5, 3, 4, 6, 7, 8, 12],
    hair: [0, 10, 26, 27, 11, 12, 18, 19, 20, 13, 14, 25, 16, 9, 21, 15, 17, 5, 23, 1, 22, 2, 3, 6, 4, 7, 24, 8],
  };
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
    { faceShape: 1, skin: 9, eyes: 1, mouth: 0, makeup: 2, hair: 15, hairColor: 9, facial: 0, glasses: 0, hat: 0, earrings: 2, top: 3, bg: 2 },
    { faceShape: 0, skin: 4, eyes: 5, mouth: 1, makeup: 0, hair: 13, hairColor: 0, facial: 0, glasses: 0, hat: 0, earrings: 0, top: 8, bg: 3 },
    { faceShape: 1, skin: 7, eyes: 4, mouth: 0, makeup: 1, hair: 12, hairColor: 0, facial: 0, glasses: 0, hat: 7, earrings: 0, top: 4, bg: 4 },
    { faceShape: 2, skin: 8, eyes: 0, mouth: 1, makeup: 0, hair: 12, hairColor: 0, facial: 4, glasses: 0, hat: 8, earrings: 0, top: 1, bg: 3 },
    { faceShape: 4, skin: 5, eyes: 0, mouth: 3, makeup: 0, hair: 17, hairColor: 9, facial: 5, glasses: 0, hat: 0, earrings: 0, top: 5, bg: 6 },
    { faceShape: 3, skin: 9, eyes: 1, mouth: 1, makeup: 3, hair: 12, hairColor: 0, facial: 0, glasses: 0, hat: 9, earrings: 2, top: 0, bg: 2 },
    { faceShape: 0, skin: 6, eyes: 4, mouth: 0, makeup: 0, hair: 22, hairColor: 9, facial: 0, glasses: 1, hat: 0, earrings: 1, top: 7, bg: 1 },
    { faceShape: 1, skin: 7, eyes: 2, mouth: 3, makeup: 0, hair: 21, hairColor: 0, facial: 6, glasses: 0, hat: 0, earrings: 0, top: 2, bg: 5 },
  ];

  /** Clamp/convert any stored look (incl. older formats) to valid indexes. @param {Record<string, number>} look */
  function norm(look) {
    /** @type {Record<string, number>} */
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
    const dk = shade(hc, 0.7); // texture pixels (coils, braid crossings, cornrow lines)
    const covered = look.hat === 7; // the hijab covers all hair
    const hair = covered ? -1 : look.hair;
    const [tx0, tx1] = shape[topY];
    const disc = (cx, cy, rx, ry, c, tex) => {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(x, y, tex && (x + y) % 3 === 0 ? tex : c);
      }
    };
    // Big textured shapes sit behind the head.
    if (hair === 13) disc(7.5, topY + 2, 6.4, 5.2, hc, dk);                                      // afro
    if (hair === 14) { disc(ex0 - 0.5, topY - 1, 2.3, 2.3, hc, dk); disc(ex1 + 0.5, topY - 1, 2.3, 2.3, hc, dk); } // afro puffs
    if (hair === 21) { disc(7.5, topY + 1, 6, 3.5, hc, dk); for (let y = topY + 2; y < 14; y++) { set(ex0 - 1 - (y % 2), y, hc); set(ex0 - 1, y, y % 2 ? dk : hc); set(ex1 + 1 + (y % 2), y, hc); set(ex1 + 1, y, y % 2 ? dk : hc); } } // long curls
    // hair that hangs behind the head/shoulders first
    if ([1, 2, 5].includes(hair)) { rect(ex0 - 1, topY + 1, 1, 10, hc); rect(ex1 + 1, topY + 1, 1, 10, hc); }
    if (hair === 2) for (let y = topY + 2; y < topY + 11; y += 2) { set(ex0 - 2, y, hc); set(ex1 + 2, y, hc); }   // waves
    if (hair === 5) { for (let y = topY + 2; y < 12; y += 2) { set(ex0 - 1, y, dk); set(ex1 + 1, y, dk); } set(ex0 - 1, 12, '#e83f5b'); set(ex1 + 1, 12, '#e83f5b'); } // braids: woven texture + ties
    // body
    rect(3, 14, 10, 2, top); rect(2, 15, 12, 1, top); rect(7, 13, 2, 1, skin);
    // Long styles that fall over the shoulders (in front of the body, behind the face).
    if (hair === 15 || hair === 17) {                                                            // box braids / locs
      for (const [x0, dir] of [[ex0 - 1, -1], [ex1 + 1, 1]]) {
        for (let y = topY + 1; y < 16; y++) {
          set(x0, y, (y % 2) && hair === 15 ? dk : hc);
          if (y > topY + 2) set(x0 + dir, y, hair === 15 ? (y % 2 ? hc : dk) : ((y + 1) % 3 ? hc : dk));
        }
        if (hair === 15) set(x0 + dir, 15, '#ffd23f'); // bead
      }
    }
    if (hair === 22) { rect(ex0 - 1, topY + 1, 1, 15 - topY, hc); rect(ex1 + 1, topY + 1, 1, 15 - topY, hc); rect(ex0 - 2, topY + 3, 1, 13 - topY, hc); rect(ex1 + 2, topY + 3, 1, 13 - topY, hc); } // long straight
    if (hair === 23) for (let y = topY + 2; y < 16; y++) { set(ex1 + 1, y, y % 2 ? dk : hc); set(ex1 + 2, y, y % 2 ? hc : dk); } // long plait
    // head
    for (const y of rows) { const [a, b] = shape[y]; rect(a, y, b - a + 1, 1, skin); }
    set(ex0 - 1, 8, skin); set(ex1 + 1, 8, skin); // ears
    if (look.earrings === 1) { set(ex0 - 1, 9, '#ffd23f'); set(ex1 + 1, 9, '#ffd23f'); }
    if (look.earrings === 2) { set(ex0 - 1, 9, '#ffd23f'); set(ex0 - 1, 10, '#ffd23f'); set(ex1 + 1, 9, '#ffd23f'); set(ex1 + 1, 10, '#ffd23f'); }
    // hair on top
    const cap = () => { rect(tx0, topY - 1, tx1 - tx0 + 1, 2, hc); set(ex0, topY + 1, hc); set(ex1, topY + 1, hc); };
    const w = tx1 - tx0 + 1;
    switch (hair) {
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
      case 13: rect(tx0, topY, w, 1, hc); set(ex0, topY + 1, hc); set(ex1, topY + 1, hc); break; // afro hairline
      case 14: cap(); for (let x = tx0; x <= tx1; x += 2) set(x, topY, dk); break;            // puffs: parted, pulled back
      case 15: case 17: cap(); for (let x = tx0; x <= tx1; x += 2) set(x, topY - 1, dk); rect(ex0, topY + 1, 1, 2, hc); rect(ex1, topY + 1, 1, 2, hc); break;
      case 16: { const scalp = shade(skin, 0.7); for (let x = tx0; x <= tx1; x++) { set(x, topY - 1, x % 2 ? hc : scalp); set(x, topY, x % 2 ? (topY % 2 ? dk : hc) : scalp); } rect(tx0 + 1, topY - 2, w - 2, 1, hc); set(ex0, topY + 1, hc); set(ex1, topY + 1, hc); break; } // cornrows: rows with scalp lines between
      case 18: for (let x = tx0 - 1; x <= tx1 + 1; x++) { set(x, topY - 1, (x % 2) ? dk : hc); set(x, topY, hc); if (x % 2 === 0 && x >= tx0) set(x, topY - 2, hc); } set(ex0, topY + 1, hc); set(ex1, topY + 1, hc); break; // coils (short)
      case 19: cap(); for (let x = tx0; x <= tx1; x += 2) { set(x, topY - 2, hc); set(x, topY - 3, x % 4 ? dk : hc); } break; // twists
      case 20: rect(tx0, topY - 4, w, 5, hc); for (let x = tx0; x <= tx1; x++) if ((x + topY) % 3 === 0) set(x, topY - 3, dk); set(ex0, topY + 1, dk); set(ex1, topY + 1, dk); break; // high top, faded sides
      case 21: rect(tx0, topY, w, 1, hc); break;                                              // long curls hairline
      case 22: cap(); set(7, topY - 1, shade(skin, 0.9)); set(8, topY - 1, hc); break;          // long straight, centre part
      case 23: cap(); set(ex1, topY + 2, hc); set(ex1 + 1, 15, '#e83f5b'); break;             // long plait + tie
      case 24: rect(tx0, topY, w, 1, hc); set(ex0, topY + 1, dk); set(ex1, topY + 1, dk); rect(7, topY - 2, 2, 2, hc); set(7, topY - 3, hc); set(8, topY - 3, dk); break; // top knot
      case 25: cap(); for (const [x, y] of [[tx0 - 1, topY - 2], [7, topY - 3], [tx1, topY - 2]]) { rect(x, y, 2, 2, hc); set(x + 1, y, dk); } break; // bantu knots, spaced apart
      case 26: for (let x = tx0; x <= tx1; x++) set(x, topY, x % 2 ? hc : dk); for (let x = tx0 + 1; x < tx1; x++) set(x, topY - 1, (x + 1) % 2 ? hc : dk); break; // waves
      case 27: rect(tx0, topY - 2, w, 2, hc); rect(tx0 + 2, topY - 3, w - 3, 1, hc); set(tx1, topY - 1, dk); set(ex0, topY + 1, shade(hc, 0.55)); set(ex1, topY + 1, shade(hc, 0.55)); break; // undercut
      default: break;                                                                          // bald
    }
    // eyes
    const E = OUT;
    if (look.eyes === 0) { set(6, 8, E); set(9, 8, E); }
    if (look.eyes === 1) { set(6, 8, E); set(9, 8, E); set(5, 7, E); set(10, 7, E); set(6, 7, E); set(9, 7, E); } // lashes
    if (look.eyes === 2) { rect(5, 7, 2, 2, '#fff'); rect(9, 7, 2, 2, '#fff'); set(6, 8, E); set(9, 8, E); }
    if (look.eyes === 3) { rect(5, 8, 2, 1, E); rect(9, 8, 2, 1, E); }
    if (look.eyes === 4) { rect(5, 7, 2, 1, E); rect(9, 7, 2, 1, E); set(5, 8, '#fff'); set(6, 8, E); set(9, 8, E); set(10, 8, '#fff'); } // almond
    if (look.eyes === 5) { rect(5, 7, 2, 2, E); rect(9, 7, 2, 2, E); set(5, 7, '#fff'); set(9, 7, '#fff'); } // big
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
    const jaw = (/** @type {(x: number, y: number, edge: boolean) => void} */ fn) => {
      for (const y of [9, 10, 11, 12]) { const r = shape[y]; if (r) for (let x = r[0]; x <= r[1]; x++) fn(x, y, x === r[0] || x === r[1] || y === 12); }
    };
    if (look.facial === 4) { jaw((x, y, edge) => { if (y >= 10 || edge) set(x, y, hc); }); rect(7, 11, 2, 1, look.makeup >= 2 ? '#d21f4a' : '#8a2a3a'); } // full beard
    if (look.facial === 5) jaw((x, y) => { if (y >= 10 && (x + y) % 2 === 0 && g[y][x] === skin) set(x, y, shade(skin, 0.82)); }); // stubble
    if (look.facial === 6) jaw((x, y, edge) => { if (edge) set(x, y, hc); }); // chinstrap
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
      case 7: { // hijab: frames the face, covers hair, ears and neck, drapes over the shoulders
        const HJ = '#2a9d8f', fold = shade(HJ, 0.78);
        for (let y = topY - 2; y < 16; y++) for (let x = ex0 - 2; x <= ex1 + 2; x++) {
          const r = shape[y];
          const face = r && y >= topY + 2 && y <= 12 && x >= r[0] + (y === topY + 2 ? 1 : 0) && x <= r[1] - (y === topY + 2 ? 1 : 0);
          const round = (y === topY - 2 && (x < tx0 || x > tx1)) || (y === topY - 1 && (x === ex0 - 2 || x === ex1 + 2));
          if (!face && !round) set(x, y, (x === ex0 - 1 || x === ex1 + 1) && y > topY + 3 ? fold : HJ);
        }
        rect(2, 15, 12, 1, HJ); rect(3, 14, 10, 1, HJ);
        break;
      }
      case 8: { // turban
        const TB = '#ff9f1c', fold = shade(TB, 0.75);
        for (let y = hy - 3; y <= hy + 1; y++) for (let x = tx0 - 1; x <= tx1 + 1; x++) {
          if (y === hy - 3 && (x < tx0 + 1 || x > tx1 - 1)) continue;
          set(x, y, (x - y) % 4 === 0 ? fold : TB);
        }
        break;
      }
      case 9: { // headwrap: tall wrap, wider at the top, patterned
        const HW = '#e63946', dot = '#ffd23f';
        for (let y = hy - 4; y <= hy + 1; y++) {
          const grow = Math.max(0, hy - 1 - y);
          for (let x = tx0 - 1 - grow; x <= tx1 + 1 + grow; x++) set(x, y, (x + y) % 3 === 0 ? dot : HW);
        }
        set(ex1 + 1, hy + 2, HW); set(ex1 + 2, hy + 1, HW);
        break;
      }
      case 10: rect(tx0, hy - 1, w, 2, '#f4f1e8'); for (let x = tx0; x <= tx1; x += 2) set(x, hy - 1, '#c9b98f'); break; // kufi
      case 11: rect(tx0 - 1, hy, w + 2, 2, '#1e1e2e'); rect(tx0, hy - 1, w, 1, '#1e1e2e'); set(tx0 + 1, hy - 1, '#4a4a6a'); rect(ex1 + 1, hy + 2, 1, 4, '#1e1e2e'); set(ex1 + 2, hy + 5, '#1e1e2e'); break; // durag + tail
      case 13: { // Santa hat: white trim, red cone flopping right, pompom
        rect(tx0 - 1, hy, w + 2, 1, '#f4f1e8');
        rect(tx0, hy - 1, w, 1, '#d62839'); rect(tx0 + 1, hy - 2, w - 1, 1, '#d62839'); rect(tx0 + 3, hy - 3, w - 2, 1, '#d62839');
        set(tx1 + 1, hy - 2, '#d62839'); set(tx1 + 2, hy - 1, '#f4f1e8');
        break;
      }
      case 14: { // witch hat: wide brim, tall cone, purple band
        rect(tx0 - 2, hy, w + 4, 1, '#2b1d3a');
        rect(tx0 + 1, hy - 1, w - 2, 1, '#9c6ade');
        rect(tx0 + 2, hy - 2, w - 4, 1, '#2b1d3a'); rect(7, hy - 3, 2, 1, '#2b1d3a'); set(9, hy - 3, '#2b1d3a'); // tip bends over
        break;
      }
      case 15: // bunny ears on a headband
        rect(tx0, hy, w, 1, '#f4f1e8');
        for (const x of [tx0 + 1, tx1 - 2]) { rect(x, hy - 3, 2, 3, '#f4f1e8'); set(x + 1, hy - 2, '#ff8fb3'); }
        break;
      case 16: // maple-leaf crown (Canada Day)
        rect(tx0, hy, w, 1, '#d62839');
        set(7, hy - 3, '#d62839'); set(8, hy - 3, '#d62839'); rect(6, hy - 2, 4, 1, '#d62839'); set(7, hy - 1, '#d62839'); set(8, hy - 1, '#d62839');
        set(5, hy - 2, '#d62839'); set(10, hy - 2, '#d62839');
        break;
      case 17: // graduation cap with a gold tassel
        rect(tx0, hy, w, 1, '#1e1e2e'); rect(tx0 - 2, hy - 1, w + 4, 1, '#1e1e2e'); set(7, hy - 2, '#1e1e2e'); set(8, hy - 2, '#1e1e2e');
        rect(tx1 + 2, hy - 1, 1, 3, '#ffd23f');
        break;
      case 12: rect(tx0 - 1, hy + 1, w + 2, 1, '#e83f5b'); for (let x = tx0; x <= tx1; x += 2) set(x, hy + 1, '#f4f1e8'); set(ex0 - 2, hy + 2, '#e83f5b'); set(ex0 - 2, hy + 3, '#e83f5b'); break; // bandana
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

  /** Darken a #rrggbb colour by factor f (0..1). @param {string} hex @param {number} f */
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (s) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0');
    return '#' + c(16) + c(8) + c(0);
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
    /** @type {Record<string, number>} */
    const l = {};
    for (const p of PARTS) l[p] = Math.floor(Math.random() * NAMES[p].length);
    for (const [p, keep] of /** @type {[string, number][]} */ ([['facial', 0.3], ['glasses', 0.35], ['hat', 0.4], ['earrings', 0.5], ['makeup', 0.5]])) if (Math.random() > keep) l[p] = 0;
    if (SEASON > 0 && Math.random() < 0.35) l.hat = SEASON; // in season: more festive randoms
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
      const idx = ORDER[p] || NAMES[p].map((_, i) => i);
      const items = idx.map((i) => { const name = NAMES[p][i];
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
    PARTS, NAMES, TABS, PRESETS, ORDER, url, random, editor, norm, build, seasonHat,
    counts: Object.fromEntries(PARTS.map((p) => [p, NAMES[p].length])),
  };
})();
