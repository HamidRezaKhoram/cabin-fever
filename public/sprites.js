/* Rumpus pixel art — original 16×16 sprites drawn as character grids.
 * AGPLv3, see LICENSE. '.' = transparent; other chars map to the palette.
 */
'use strict';

(function () {
  const BASE = {
    K: '#1a1423', W: '#f4f1e8', E: '#1a1423', O: '#e8762b', B: '#8a5a3b', L: '#d9b38c',
    T: '#e6c48a', G: '#8e8fa3', P: '#f2a0b5', D: '#d46a8a', N: '#4caf50', Y: '#ffd23f',
    R: '#e83f5b', A: '#4fc3f7', S: '#6b7a8f', M: '#5e3a8c', C: '#2b2d42', V: '#9c6ade', H: '#ff9f1c',
  };

  const AVATARS = [
    { name: 'Fox', pal: {}, px: `
.K............K.
KOK..........KOK
KOOK........KOOK
KOOOKKKKKKKKOOOK
KOOOOOOOOOOOOOOK
KOOOOOOOOOOOOOOK
KOOEEOOOOOOEEOOK
KOOEEOOOOOOEEOOK
KWOOOOOOOOOOOOWK
KWWOOOOOOOOOOWWK
.KWWWOOKKOOWWWK.
..KWWWWKKWWWWK..
...KWWWWWWWWK...
....KKWWWWKK....
......KKKK......
................` },
    { name: 'Bear', pal: {}, px: `
..KKK......KKK..
.KBBBK....KBBBK.
.KBLBKKKKKKBLBK.
.KBBBBBBBBBBBBK.
KBBBBBBBBBBBBBBK
KBBBBBBBBBBBBBBK
KBBEEBBBBBBEEBBK
KBBEEBBBBBBEEBBK
KBBBBBLLLLBBBBBK
KBBBBLLKKLLBBBBK
KBBBBLLKKLLBBBBK
.KBBBLLLLLLBBBK.
..KBBBLKKLBBBK..
...KBBBBBBBBK...
....KKKKKKKK....
................` },
    { name: 'Panda', pal: {}, px: `
..KKK......KKK..
.KKKKK....KKKKK.
.KKKKKKKKKKKKKK.
.KWWWWWWWWWWWWK.
KWWWWWWWWWWWWWWK
KWKKKWWWWWWKKKWK
KWKWKKWWWWKKWKWK
KWKKKWWWWWWKKKWK
KWWWWWWWWWWWWWWK
KWWWWWWKKWWWWWWK
KWWWWWWKKWWWWWWK
.KWWWWKWWKWWWWK.
..KWWWWKKWWWWK..
...KWWWWWWWWK...
....KKKKKKKK....
................` },
    { name: 'Cat', pal: {}, px: `
.K............K.
KGK..........KGK
KGGK........KGGK
KGPGKKKKKKKKGPGK
KGGGGGGGGGGGGGGK
KGGGGGGGGGGGGGGK
KGGEEGGGGGGEEGGK
KGGEYGGGGGGEYGGK
KGGGGGGGGGGGGGGK
KGGGGGGPPGGGGGGK
KWGGGGGKKGGGGGWK
.KWWGGKGGKGGWWK.
..KWGGGGGGGGWK..
...KKGGGGGGKK...
.....KKKKKK.....
................` },
    { name: 'Frog', pal: {}, px: `
................
..KKKK....KKKK..
.KWWWWK..KWWWWK.
.KWEEWKKKKWEEWK.
.KWEEWNNNNWEEWK.
KNKWWKNNNNKWWKNK
KNNKKNNNNNNKKNNK
KNNNNNNNNNNNNNNK
KNNNNNNNNNNNNNNK
KNKNNNNNNNNNNKNK
KNNKKKKKKKKKKNNK
KNNNNPPPPPPNNNNK
.KNNNNNNNNNNNNK.
..KKNNNNNNNNKK..
....KKKKKKKK....
................` },
    { name: 'Owl', pal: {}, px: `
.KK..........KK.
.KBK........KBK.
.KBBKKKKKKKKBBK.
.KBBBBBBBBBBBBK.
KBBWWWWBBWWWWBBK
KBWWYYWBBWYYWWBK
KBWYEEYWWYEEYWBK
KBWYEEYWWYEEYWBK
KBWWYYWOOWYYWWBK
KBBWWWWOOWWWWBBK
KBTTTTBBBBTTTTBK
KBTBTBTTTTBTBTBK
.KTTTTTTTTTTTTK.
..KBTBTBTBTBTK..
...KKKKKKKKKK...
................` },
    { name: 'Pig', pal: {}, px: `
................
.KKK........KKK.
.KPDK......KDPK.
.KPPDKKKKKKDPPK.
.KPPPPPPPPPPPPK.
KPPPPPPPPPPPPPPK
KPPPEPPPPPPEPPPK
KPPPEPPPPPPEPPPK
KPPPPKKKKKKPPPPK
KPPPKDDDDDDKPPPK
KPPPKDKDDKDKPPPK
KPPPKDDDDDDKPPPK
.KPPPKKKKKKPPPK.
..KPPPPPPPPPPK..
...KKKKKKKKKK...
................` },
    { name: 'Bunny', pal: {}, px: `
...KKK....KKK...
..KWPWK..KWPWK..
..KWPWK..KWPWK..
..KWPWK..KWPWK..
..KWPWKKKKWPWK..
.KWWWWWWWWWWWWK.
KWWWWWWWWWWWWWWK
KWWWEWWWWWWEWWWK
KWWWEWWWWWWEWWWK
KWPWWWWPPWWWWPWK
KWWWWWWKKWWWWWWK
.KWWWWKWWKWWWWK.
..KWWWWWWWWWWK..
...KKWWWWWWKK...
.....KKKKKK.....
................` },
    { name: 'Penguin', pal: { N: '#2b3a67' }, px: `
................
.....KKKKKK.....
...KKNNNNNNKK...
..KNNNNNNNNNNK..
.KNNNWWNNWWNNNK.
.KNNWWWWWWWWNNK.
KNNWWEWWWWEWWNNK
KNNWWEWWWWEWWNNK
KNNWWWWOOWWWWNNK
KNNWWWOOOOWWWNNK
KNNWWWWWWWWWWNNK
.KNNWWWWWWWWNNK.
..KNNWWWWWWNNK..
...KKNNNNNNKK...
.....KKKKKK.....
................` },
    { name: 'Raccoon', pal: {}, px: `
.KK..........KK.
KGGK........KGGK
KGWGKKKKKKKKGWGK
KGGGGGGGGGGGGGGK
KGWWWGGGGGGWWWGK
KKKKKKWWWWKKKKKK
KKWEKKWWWWKKEWKK
KKKKKKWWWWKKKKKK
KGGWWWWWWWWWWGGK
KGGGWWWKKWWWGGGK
.KGGGWWKKWWGGGK.
..KGGGWWWWGGGK..
...KKGGGGGGKK...
.....KKKKKK.....
................
................` },
    { name: 'Moose', pal: {}, px: `
TT.T........T.TT
.TTT........TTT.
..TTT.KKKK.TTT..
...TTKBBBBKTT...
....KBBBBBBK....
...KBBBBBBBBK...
..KBBEBBBBEBBK..
..KBBBBBBBBBBK..
..KBBBBBBBBBBK..
..KBBBLLLLBBBK..
.KBBBLLLLLLBBBK.
.KBBLKLLLLKLBBK.
.KBBLLLLLLLLBBK.
..KBBLLLLLLBBK..
...KKKKKKKKKK...
................` },
    { name: 'Dog', pal: {}, px: `
................
..KKKKKKKKKKKK..
.KBBKTTTTTTKBBK.
KBBBKTTTTTTKBBBK
KBBBTTTTTTTTBBBK
KBBTTETTTTETTBBK
KBBTTETTTTETTBBK
.KBTTTTTTTTTTBK.
..KTTTWWWWTTTK..
..KTTWWKKWWTTK..
..KTTWWKKWWTTK..
..KTTWWWWWWTTK..
...KTTWPPWTTK...
....KKKKKKKK....
................
................` },
    { name: 'Beaver', pal: {}, px: `
................
..KK........KK..
.KBBK......KBBK.
.KBBKKKKKKKKBBK.
.KBBBBBBBBBBBBK.
KBBBBBBBBBBBBBBK
KBBEBBBBBBBBEBBK
KBBEBBBBBBBBEBBK
KBBBBBLLLLBBBBBK
KBBBBLLKKLLBBBBK
KBBBBLLLLLLBBBBK
.KBBBBLWWLBBBBK.
..KBBBBWWBBBBK..
...KKBBKKBBKK...
.....KKKKKK.....
................` },
    { name: 'Duck', pal: {}, px: `
................
.....KKKKKK.....
....KYYYYYYK....
...KYYYYYYYYK...
..KYYYYYYYYYYK..
..KYYEYYYYEYYK..
..KYYEYYYYEYYK..
..KYYYYYYYYYYK..
.KOOOOOOOOOOOOK.
KOOOOOOOOOOOOOOK
.KOOOOKKKKOOOOK.
..KKKKYYYYKKKK..
...KYYYYYYYYK...
....KKKKKKKK....
................
................` },
    { name: 'Otter', pal: {}, px: `
................
...KK......KK...
..KBBKKKKKKBBK..
..KBBBBBBBBBBK..
.KBBBBBBBBBBBBK.
.KBLLLLBBLLLLBK.
KBLLEELLLLEELLBK
KBLLEELLLLEELLBK
KBLLLLLKKLLLLLBK
KBLWLLKKKKLLWLBK
.KBLWLLLLLLWLBK.
.KBLLWLKKLWLLBK.
..KBLLLLLLLLBK..
...KKBBBBBBKK...
.....KKKKKK.....
................` },
    { name: 'Wolf', pal: { L: '#c9cbd8' }, px: `
.K............K.
KGK..........KGK
KGGK........KGGK
KGGGKKKKKKKKGGGK
KGGGGGGGGGGGGGGK
KGGGGGGGGGGGGGGK
KGGYEGGGGGGEYGGK
KGGGGGGGGGGGGGGK
KLGGGGGLLGGGGGLK
KLLGGGLLLLGGGLLK
.KLLGLLKKLLGLLK.
..KLLLLKKLLLLK..
...KLLLLLLLLK...
....KKLLLLKK....
......KKKK......
................` },
    { name: 'Axolotl', pal: {}, px: `
................
R..............R
RR...KKKKKK...RR
.RRKKPPPPPPKKRR.
RRKPPPPPPPPPPKRR
.RKPPPPPPPPPPKR.
.KPPEPPPPPPEPPK.
.KPPEPPPPPPEPPK.
.KPPPPPPPPPPPPK.
.KPPPKPPPPKPPPK.
.KPPPPKKKKPPPPK.
..KPPPPPPPPPPK..
...KKPPPPPPKK...
.....KKKKKK.....
................
................` },
  ];

  // Game icons (16×16).
  const ICONS = {
    quiplash: `
..KKKKKKKKKKKK..
.KWWWWWWWWWWWWK.
KWWWWWWKKWWWWWWK
KWWWWWWKKWWWWWWK
KWWWWWWKKWWWWWWK
KWWWWWWKKWWWWWWK
KWWWWWWKKWWWWWWK
KWWWWWWWWWWWWWWK
KWWWWWWKKWWWWWWK
.KWWWWWWWWWWWWK.
..KKKKWWKKKKKK..
.....KWK........
....KWK.........
...KK...........
................
................`,
    fibbage: `
................
.....KKKKKK.....
....KLLLLLLK....
...KLLLLLLLLK...
...KLEELLEELK...
...KLLLLLLLLK...
...KLLLLLLLLOOOK
...KLLLLLLLLOOOO
...KLLLLLLLLOOOK
...KLLKKKKLLK...
....KLLLLLLK....
.....KKKKKK.....
................
................
................
................`,
    trivia: `
.....KKKKKK.....
....KYYYYYYK....
...KYYWWYYYYK...
..KYYWWYYYYYYK..
..KYYWYYYYYYYK..
..KYYYYYYYYYYK..
..KYYYYYYYYYYK..
...KYYYYYYYYK...
....KYYYYYYK....
.....KYYYYK.....
.....KSSSSK.....
.....KSSSSK.....
.....KSSSSK.....
......KKKK......
................
................`,
    closest: `
................
.....KKKKKK.....
...KKRRRRRRKK...
..KRRWWWWWWRRK..
..KRWWRRRRWWRK..
.KRRWRRWWRRWRRK.
.KRWWRWWWWRWWRK.
.KRWWRWRRWRWWRK.
.KRWWRWRRWRWWRK.
.KRWWRWWWWRWWRK.
.KRRWRRWWRRWRRK.
..KRWWRRRRWWRK..
..KRRWWWWWWRRK..
...KKRRRRRRKK...
.....KKKKKK.....
................`,
    majority: `
................
................
..KKK..KKK..KKK.
.KWWWKKWWWKKWWWK
.KWEWKKWEWKKWEWK
.KWWWKKWWWKKWWWK
..KKK..KKK..KKK.
.KWWWKKWWWKKWWWK
KWWWWWKWWWKWWWWWK
KWWWWWKWWWKWWWWWK
KWWWWWKWWWKWWWWWK
.KKKKK.KKK.KKKKK.
................
................
................
................`,
    mostlikely: `
................
................
.K....K..K....K.
KYK..KYKKYK..KYK
KYYK.KYYYYK.KYYK
KYYYKKYYYYKKYYYK
KYYYYYYYYYYYYYYK
KYYYYYRYYRYYYYYK
KYYYYRRRRRRYYYYK
KYYYYYRYYRYYYYYK
KYYYYYYYYYYYYYYK
KHHHHHHHHHHHHHHK
KHHAHHHRRHHHAHHK
KHHHHHHHHHHHHHHK
.KKKKKKKKKKKKKK.
................`,
    imposter: `
................
.....KKKKKK.....
....KCCCCCCK....
....KCCCCCCK....
..KKKKKKKKKKKK..
....KLLLLLLK....
...KKKKKKKKKKK..
...KCCKLLKCCK...
....KLLLLLLK....
....KLLKKLLK....
.....KLLLLK.....
....KCCCCCCK....
...KCCCCCCCCK...
...KCCCCCCCCK...
................
................`,
    twotruths: `
................
.KKKKKK..KKKKKK.
KWWWWWWKKWWWWWWK
KWWWWNWKKWWWWNWK
KWNWNWWKKWNWNWWK
KWWNWWWKKWWNWWWK
.KKKKKK..KKKKKK.
................
....KKKKKKKK....
...KWWWWWWWWK...
...KWRWWWWRWK...
...KWWRWWRWWK...
...KWWWRRWWWK...
...KWWRWWRWWK...
...KWRWWWWRWK...
....KKKKKKKK....`,
    telephone: `
............KKK.
...........KPPK.
..........KWWK..
.........KYYK...
........KYYK....
.......KYYK.....
......KYYK......
.....KYYK.......
....KYYK........
...KLLK.........
...KLK..........
..KKK...........
..K.............
................
.KKKK.KK.KKK.KK.
................`,
    cah: `
................
...KKKKKKKK.....
..KCCCCCCCCK....
..KCWCCCCCCKKKK.
..KCCCWWCCKWWWWK
..KCCCCCCKWWWWWK
..KCCWWCCKWKKWWK
..KCCCCCCKWWWWWK
..KCCCCCCKWKKKWK
..KCCCCCCKWWWWWK
..KCCCCCCKWWWWWK
..KKKKKKKKWWWWWK
.........KWWWWWK
..........KKKKK.
................
................`,
  };

  const cache = new Map();
  function render(px, pal, scale = 1) {
    const rows = px.trim().split('\n');
    const h = rows.length, w = Math.max(...rows.map((r) => r.length));
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    const g = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      g.fillStyle = pal[ch] || BASE[ch] || '#f0f';
      g.fillRect(x * scale, y * scale, scale, scale);
    }));
    return c.toDataURL();
  }

  function avatarUrl(i) {
    const n = ((i | 0) % AVATARS.length + AVATARS.length) % AVATARS.length;
    const key = 'a' + n;
    if (!cache.has(key)) cache.set(key, render(AVATARS[n].px, { ...BASE, ...AVATARS[n].pal }));
    return cache.get(key);
  }

  function iconUrl(gameId) {
    if (!ICONS[gameId]) return null;
    const key = 'i' + gameId;
    if (!cache.has(key)) cache.set(key, render(ICONS[gameId], BASE));
    return cache.get(key);
  }

  function avatarImg(i, cls = 'avatar') {
    return `<img class="${cls}" src="${avatarUrl(i)}" alt="">`;
  }

  window.Rumpus.sprites = {
    AVATARS, avatarUrl, iconUrl, avatarImg, count: AVATARS.length,
    avatarName: (i) => AVATARS[((i | 0) % AVATARS.length + AVATARS.length) % AVATARS.length].name,
  };
})();
