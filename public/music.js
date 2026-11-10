/* Rumpus soundtrack: chiptune engine + 50 original tracks. AGPLv3, see LICENSE.
 *
 * How it's organised (the way a game would do it):
 *   CUES  — a music "cue" per screen/moment: title, menu, game:<id>, vote,
 *           reveal, final, victory, scoreboard, intro.
 *   Each cue owns a set of tracks and rotates through them (round-robin,
 *   remembered between sessions), crossfading on change.
 *   Signature themes (title / menu) are hand-written; the rest are composed
 *   from a seed by a small procedural composer that writes in phrases
 *   (motif A, A', B, A'') over a chord progression, so tracks sound like songs
 *   rather than random notes. Everything is synthesized live with WebAudio:
 *   pulse-wave leads, triangle bass, noise drums. No audio files, all offline.
 *
 * If the server has files in ./music, those are shuffled instead.
 */
'use strict';

(function () {
  // ------------------------------------------------------------------ theory
  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const midiOf = (n) => { const m = /^([A-G][#b]?)(\d)$/.exec(n); return m ? 12 * (+m[2] + 1) + NOTE[m[1]] : null; };
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const MODES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
    mixo: [0, 2, 4, 5, 7, 9, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], lydian: [0, 2, 4, 6, 7, 9, 11],
  };
  const PROGS = {
    major: [[0, 5, 3, 4], [0, 4, 5, 3], [0, 3, 4, 3], [3, 4, 2, 5], [0, 3, 0, 4], [5, 3, 0, 4], [0, 2, 3, 4], [0, 4, 3, 4], [0, 5, 1, 4]],
    minor: [[0, 5, 6, 0], [0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 6], [0, 3, 6, 2], [0, 2, 3, 4]],
    dorian: [[0, 3, 0, 3], [0, 3, 6, 3], [0, 1, 3, 0]],
    mixo: [[0, 6, 3, 0], [0, 6, 0, 3], [0, 3, 6, 0]],
    harmonic: [[0, 5, 4, 4], [0, 3, 4, 0], [0, 5, 3, 4]],
    lydian: [[0, 1, 0, 1], [0, 1, 4, 0]],
  };

  function rng(seed) {
    let s = (seed * 2654435761) >>> 0 || 1;
    return () => ((s ^= s << 13, s ^= s >>> 17, s ^= s << 5) >>> 0) / 4294967296;
  }

  // Lead rhythms per 2 bars (32 steps): x = note on, - = hold, . = rest
  const RHYTHMS = {
    melodic: [
      'x-x-x-x-x---x-x-x-x-x---x-------', 'x---x-x-x---x---x-x-x-x-x-------', 'x-x---x-x-x---x-x---x-x-x-------',
      'x---x---x-x-x---x---x---x-x-x---', 'x-x-x---x-------x-x-x---x---x---',
    ],
    bouncy: [
      'x.x.x.x.x.x.x...x.x.x.x.x...x...', 'x..x..x.x..x..x.x..x..x.x.......', 'x.x..x.x.x..x.x.x.x..x.x.x......',
    ],
    sparse: [
      'x-------x---x---x-------x-------', 'x---x-------x---x---x-----------', 'x-----x-x-------x-------x---x---',
    ],
    staccato: [
      'x.x.x.x...x.x...x.x.x.x...x.....', 'x...x.x.x...x...x...x.x.x.x.....', 'x.x...x.x.x...x.x.x...x.x.......',
    ],
  };
  const DRUMS = {
    pop: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    four: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.' },
    halftime: { k: 'x.........x.....', s: '........x.......', h: 'x...x...x...x...' },
    drive: { k: 'x..x..x.x..x..x.', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
    shuffle: { k: 'x.....x.x.......', s: '....x.......x..x', h: 'x.xxx.xxx.xxx.xx' },
    tense: { k: 'x.....x.....x...', s: '............x...', h: 'x.x.x.x.x.x.x.x.' },
    bossa: { k: 'x..x..x.x..x..x.', s: '..x..x....x..x..', h: 'x.x.x.x.x.x.x.x.' },
    march: { k: 'x...x...x...x...', s: '..x...x...x.x.x.', h: '' },
    none: { k: '', s: '', h: '' },
  };

  // --------------------------------------------------------------- composer
  // Produces a compiled track: per-16th-step lists of events.
  function compose(spec) {
    const r = rng(spec.seed);
    const mode = MODES[spec.mode];
    const root = spec.root; // midi of tonic, around 60
    const prog = spec.prog || PROGS[spec.mode][Math.floor(r() * PROGS[spec.mode].length)];
    const bars = spec.bars || 8;
    const chords = [];
    for (let b = 0; b < bars; b++) {
      let deg = prog[b % prog.length];
      if (b === bars - 1 && spec.resolve !== false) deg = b % 2 ? 4 : 0; // cadence feel
      chords.push(deg);
    }
    // Scale-degree -> midi (degree index can exceed 7)
    const deg2midi = (d) => root + 12 * Math.floor(d / 7) + mode[((d % 7) + 7) % 7];
    const chordTones = (deg) => [deg, deg + 2, deg + 4];
    const nearestChordTone = (pitchDeg, chordDeg) => {
      let best = pitchDeg, bd = 99;
      for (let o = -14; o <= 14; o += 7) for (const t of chordTones(chordDeg)) {
        const c = t + o, d = Math.abs(c - pitchDeg);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    };

    const style = spec.lead || 'melodic';
    const pickRhythm = () => RHYTHMS[style][Math.floor(r() * RHYTHMS[style].length)];
    // Motif: rhythm + contour (scale steps between notes)
    const makeMotif = () => {
      const rhythm = pickRhythm();
      const contour = [];
      for (let i = 0; i < 16; i++) {
        const x = r();
        contour.push(x < 0.35 ? 1 : x < 0.6 ? -1 : x < 0.72 ? 2 : x < 0.84 ? -2 : x < 0.92 ? 0 : (r() < 0.5 ? 3 : -3));
      }
      return { rhythm, contour };
    };
    const A = makeMotif(), B = makeMotif();
    const plan = bars >= 8 ? ['A', 'A2', 'B', 'A3'] : ['A', 'A3'];
    if (bars >= 16) plan.push('B', 'B2', 'A', 'A3');

    const steps = bars * 16;
    const lead = new Array(steps).fill(null); // { midi, len }
    let pitch = 4 + Math.floor(r() * 3); // start near the 5th
    plan.forEach((sec, si) => {
      const motif = sec[0] === 'A' ? A : B;
      const startStep = si * 32;
      if (startStep >= steps) return;
      if (sec === 'B') pitch += 2; // lift for the B section
      const onsets = [];
      for (let i = 0; i < 32; i++) if (motif.rhythm[i] === 'x') onsets.push(i);
      onsets.forEach((st, ni) => {
        const abs = startStep + st;
        const chord = chords[Math.floor(abs / 16)];
        let p = pitch + (ni ? motif.contour[ni % motif.contour.length] : 0);
        if (st % 4 === 0) p = nearestChordTone(p, chord);      // strong beats land on chord tones
        if (sec === 'A2' && ni === onsets.length - 1) p = nearestChordTone(p + 1, chord);
        if (sec === 'A3' && ni === onsets.length - 1) p = 7; // end phrase on the tonic
        p = Math.max(2, Math.min(12, p));                      // keep in a singable range
        pitch = p;
        let len = 1;
        while (st + len < 32 && motif.rhythm[st + len] === '-') len++;
        lead[abs] = { midi: deg2midi(p) + (root < 62 ? 12 : 0), len };
      });
    });

    return {
      name: spec.name, bpm: spec.bpm, swing: spec.swing || 0, steps, once: !!spec.once,
      chords: chords.map((d) => chordTones(d).map((t) => deg2midi(t))),
      lead, arp: spec.arp || 'up', bass: spec.bass || 'octave', drums: DRUMS[spec.drums || 'pop'],
      wave: spec.wave || 0.25, leadVol: spec.leadVol || 0.085, echo: spec.echo !== false,
    };
  }

  // Hand-written signature tracks, converted into the same compiled format.
  const CHORD_NAMES = {
    C: ['C', 'E', 'G'], Am: ['A', 'C', 'E'], F: ['F', 'A', 'C'], G: ['G', 'B', 'D'], Em: ['E', 'G', 'B'],
    Dm: ['D', 'F', 'A'], Bb: ['Bb', 'D', 'F'], A: ['A', 'C#', 'E'],
  };
  function handwritten(spec) {
    const lead = [];
    for (const bar of spec.lead) for (const tok of bar.trim().split(/\s+/)) lead.push(tok, '_');
    const steps = spec.chords.length * 16;
    const L = new Array(steps).fill(null);
    for (let s = 0; s < steps; s++) {
      const tok = lead[s % lead.length];
      if (!tok || tok === '.' || tok === '-' || tok === '_') continue;
      let len = 1;
      while (lead[(s + len) % lead.length] === '.' || lead[(s + len) % lead.length] === '_') { if (len > 16) break; len++; }
      L[s] = { midi: midiOf(tok), len };
    }
    return {
      name: spec.name, bpm: spec.bpm, swing: spec.swing || 0, steps, once: !!spec.once,
      chords: spec.chords.map((c) => CHORD_NAMES[c].map((n, i) => midiOf(n + (i && NOTE[n] < NOTE[CHORD_NAMES[c][0]] ? 5 : 4)))),
      lead: L, arp: spec.arp, bass: spec.bass, drums: DRUMS[spec.drums], wave: 0.25, leadVol: 0.09, echo: true,
    };
  }

  // ------------------------------------------------------------------ catalog
  const ADJ = ['Moonlit', 'Pixel', 'Sneaky', 'Canoe', 'Firefly', 'Loon', 'Midnight', 'Maple', 'Campfire', 'Cottage', 'Neon', 'Lakeside',
    'Raccoon', 'Thunder', 'Starlit', 'Turbo', 'Wobbly', 'Snack', 'Sauna', 'Dockside', 'Mosquito', 'Pinecone', 'Hot Tub', 'Moose'];
  const NOUN = ['Shuffle', 'Boogie', 'Groove', 'Waltz', 'Hustle', 'Jam', 'Rumble', 'Strut', 'Bop', 'Stomp', 'Getaway', 'Swing',
    'Caper', 'Showdown', 'Serenade', 'Parade', 'Two-Step', 'Fever', 'Heist', 'Anthem', 'Overture', 'March', 'Lullaby', 'Fanfare'];
  const usedNames = new Set(['Rumpus Theme', 'Lakeside Lounge', 'Ballot Box Boogie', "Champion's Fanfare"]);
  const titleFor = (seed) => {
    const r = rng(seed + 7);
    for (;;) {
      const n = ADJ[Math.floor(r() * ADJ.length)] + ' ' + NOUN[Math.floor(r() * NOUN.length)];
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
  };

  // Per-game musical identity.
  const GAME_STYLE = {
    quiplash:   { mode: 'major', bpm: 128, lead: 'bouncy', drums: 'pop', arp: 'up', bass: 'octave', root: 60 },
    fibbage:    { mode: 'mixo', bpm: 112, lead: 'staccato', drums: 'shuffle', arp: 'broken', bass: 'walk', root: 62, swing: 0.18 },
    trivia:     { mode: 'major', bpm: 144, lead: 'melodic', drums: 'four', arp: 'updown', bass: 'eighth', root: 64 },
    closest:    { mode: 'dorian', bpm: 116, lead: 'melodic', drums: 'halftime', arp: 'up', bass: 'root', root: 62 },
    majority:   { mode: 'major', bpm: 120, lead: 'melodic', drums: 'march', arp: 'eighths', bass: 'walk', root: 65 },
    mostlikely: { mode: 'mixo', bpm: 124, lead: 'bouncy', drums: 'pop', arp: 'up', bass: 'octave', root: 67 },
    imposter:   { mode: 'harmonic', bpm: 100, lead: 'staccato', drums: 'tense', arp: 'broken', bass: 'root', root: 57 },
    twotruths:  { mode: 'minor', bpm: 108, lead: 'melodic', drums: 'bossa', arp: 'eighths', bass: 'walk', root: 59, swing: 0.12 },
    telephone:  { mode: 'lydian', bpm: 92, lead: 'sparse', drums: 'halftime', arp: 'updown', bass: 'root', root: 60, swing: 0.15 },
    cah:        { mode: 'minor', bpm: 136, lead: 'staccato', drums: 'drive', arp: 'up', bass: 'eighth', root: 57 },
  };

  const CATALOG = {}; // cue -> [spec]
  const add = (cue, spec) => (CATALOG[cue] = CATALOG[cue] || []).push(spec);

  // Title + menu signature themes (hand-written) and generated companions.
  add('title', { hand: true, name: 'Rumpus Theme', bpm: 132, arp: 'up', bass: 'octave', drums: 'pop',
    chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G', 'F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'],
    lead: ['E5 G5 C6 G5 E5 G5 A5 G5', 'A5 . G5 E5 C5 . D5 E5', 'F5 . A5 . C6 . A5 F5', 'G5 . . D5 G5 A5 B5 .',
      'C6 . B5 C6 G5 . E5 G5', 'A5 . C6 . E6 . D6 C6', 'A5 . F5 A5 G5 . E5 D5', 'D5 . E5 . G5 . - -',
      'A5 . G5 A5 C6 . A5 .', 'B5 . A5 B5 D6 . B5 .', 'G5 . E5 G5 B5 . G5 E5', 'A5 . . . C6 . E6 .',
      'F6 . E6 D6 C6 . A5 .', 'G5 . A5 B5 D6 . B5 G5', 'C6 . G5 . E5 . G5 .', 'C6 . . . - - - -'] });
  add('title', { seed: 101, mode: 'major', bpm: 126, lead: 'melodic', drums: 'pop', arp: 'updown', bass: 'octave', root: 62, bars: 16 });
  add('menu', { hand: true, name: 'Lakeside Lounge', bpm: 96, swing: 0.12, arp: 'eighths', bass: 'root', drums: 'halftime',
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'],
    lead: ['E5 . . . C5 . D5 E5', 'C5 . A4 . . . - -', 'G4 . C5 . E5 . D5 C5', 'D5 . . . B4 . - -',
      'A5 . G5 . E5 . . .', 'F5 . E5 . C5 . A4 .', 'G4 . A4 C5 E5 . G5 .', 'D5 . . . . . - -'] });
  [[201, 'major', 104, 'sparse', 'bossa', 65], [202, 'dorian', 100, 'melodic', 'halftime', 62], [203, 'mixo', 110, 'bouncy', 'shuffle', 67]]
    .forEach(([seed, mode, bpm, lead, drums, root]) => add('menu', { seed, mode, bpm, lead, drums, root, arp: 'eighths', bass: 'walk', swing: 0.1, bars: 16 }));

  // Two themes per game (20).
  Object.entries(GAME_STYLE).forEach(([id, st], gi) => {
    add('game:' + id, { ...st, seed: 300 + gi * 2, bars: 16 });
    add('game:' + id, { ...st, seed: 301 + gi * 2, bars: 16, root: st.root + 2, bpm: st.bpm + 6 });
  });

  // Voting tension (4) — the hand-written one plus three.
  add('vote', { hand: true, name: 'Ballot Box Boogie', bpm: 124, arp: 'up', bass: 'eighth', drums: 'drive',
    chords: ['Dm', 'Bb', 'C', 'A', 'Dm', 'Bb', 'C', 'A'],
    lead: ['D5 - F5 - A5 - D6 -', 'D6 - C6 - A5 - F5 -', 'E5 - G5 - C6 - E6 -', 'C#6 - A5 - E5 - C#5 -',
      'D5 D5 F5 - A5 A5 F5 -', 'Bb5 - A5 - F5 - D5 -', 'C5 E5 G5 - E5 G5 C6 -', 'A5 . . . E5 . C#5 .'] });
  [[401, 'harmonic', 118], [402, 'minor', 126], [403, 'dorian', 122]].forEach(([seed, mode, bpm]) =>
    add('vote', { seed, mode, bpm, lead: 'staccato', drums: 'tense', arp: 'up', bass: 'eighth', root: 60 }));
  // Reveal / results grooves (5)
  [[501, 'major', 116, 'pop'], [502, 'mixo', 120, 'four'], [503, 'major', 110, 'shuffle'], [504, 'dorian', 112, 'bossa'], [505, 'lydian', 104, 'halftime']]
    .forEach(([seed, mode, bpm, drums]) => add('reveal', { seed, mode, bpm, drums, lead: 'melodic', arp: 'updown', bass: 'octave', root: 62 }));
  // Final round — faster, driving (3)
  [[601, 'minor', 150], [602, 'harmonic', 146], [603, 'major', 156]].forEach(([seed, mode, bpm]) =>
    add('final', { seed, mode, bpm, lead: 'bouncy', drums: 'drive', arp: 'up', bass: 'eighth', root: 64 }));
  // Scoreboard after the fanfare (3)
  [[701, 'major', 100], [702, 'lydian', 94], [703, 'mixo', 106]].forEach(([seed, mode, bpm]) =>
    add('scoreboard', { seed, mode, bpm, lead: 'sparse', drums: 'halftime', arp: 'updown', bass: 'root', root: 60, swing: 0.1 }));
  // Victory fanfares, play once (4)
  add('victory', { hand: true, name: 'Champion\'s Fanfare', bpm: 150, arp: 'up', bass: 'octave', drums: 'pop', once: true,
    chords: ['C', 'F', 'G', 'C'], lead: ['C5 E5 G5 C6 . G5 C6 .', 'A5 C6 F6 . A5 C6 F6 .', 'B5 D6 G6 . D6 B5 G5 .', 'C6 . . . . . . -'] });
  [801, 802, 803].forEach((seed, i) => add('victory', { seed, mode: 'major', bpm: 150 + i * 6, bars: 4, lead: 'bouncy', drums: 'four', arp: 'up', bass: 'octave', root: 60 + i * 2, once: true }));
  // Category-pick jingles (2)
  add('category', { seed: 951, mode: 'lydian', bpm: 132, lead: 'bouncy', drums: 'march', arp: 'updown', bass: 'walk', root: 64, bars: 8 });
  add('category', { seed: 952, mode: 'mixo', bpm: 128, lead: 'staccato', drums: 'four', arp: 'up', bass: 'octave', root: 62, bars: 8 });
  // Game-start stingers, play once (5)
  [901, 902, 903, 904, 905].forEach((seed, i) => add('intro', { seed, mode: i % 2 ? 'mixo' : 'major', bpm: 140, bars: 2, lead: 'bouncy', drums: 'march', arp: 'up', bass: 'octave', root: 62 + i, once: true }));

  const compiled = new Map();
  function track(cue, i) {
    const key = cue + '#' + i;
    if (!compiled.has(key)) {
      const spec = CATALOG[cue][i];
      const t = spec.hand ? handwritten(spec) : compose({ ...spec, name: spec.name || titleFor(spec.seed) });
      compiled.set(key, t);
    }
    return compiled.get(key);
  }
  const TOTAL = Object.values(CATALOG).reduce((n, l) => n + l.length, 0);

  // -------------------------------------------------------------- audio graph
  let ctx = null, master = null, musicBus = null, sfxBus = null, duckGain = null;
  let musicVol = 0.5, sfxVol = 0.7;
  try {
    const v = JSON.parse(localStorage.getItem('rumpus.vol') || 'null');
    if (v) { musicVol = v.music; sfxVol = v.sfx; }
  } catch (e) { /* ignore */ }
  const waves = {};
  let noiseBuf = null;

  function ensure() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    duckGain = ctx.createGain(); duckGain.gain.value = 1; duckGain.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = musicVol * musicVol; musicBus.connect(duckGain);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxVol * sfxVol; sfxBus.connect(master);
    for (const duty of [0.125, 0.25, 0.5]) {
      const n = 32, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      waves[duty] = ctx.createPeriodicWave(re, im);
    }
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function voice(dest, f, t, dur, { wave = 0.25, type = null, vol = 0.12, attack = 0.005, release = 0.05, slide = 0 } = {}) {
    if (!f) return;
    const o = ctx.createOscillator();
    if (type) o.type = type; else o.setPeriodicWave(waves[wave]);
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dest, t, dur, vol, hp) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t); s.stop(t + dur + 0.02);
  }

  // -------------------------------------------------------------- sequencer
  // A "deck" plays one compiled track into its own gain (for crossfades).
  let decks = [];
  let hurry = false;
  let schedTimer = null;
  const listeners = [];

  function newDeck(tr, onEnd) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.25);
    gain.connect(musicBus);
    return { tr, gain, step: 0, next: ctx.currentTime + 0.08, stopping: false, onEnd };
  }

  function scheduleDeck(d) {
    const tr = d.tr;
    const tempo = tr.bpm * (hurry && !tr.once ? 1.12 : 1);
    const six = 60 / tempo / 4;
    const out = d.gain;
    while (!d.stopping && d.next < ctx.currentTime + 0.15) {
      const s = d.step % tr.steps;
      const inBar = s % 16;
      let t = d.next;
      if (tr.swing && inBar % 2 === 1) t += six * tr.swing;
      const chord = tr.chords[Math.floor(s / 16) % tr.chords.length];

      const n = tr.lead[s];
      if (n) {
        voice(out, hz(n.midi), t, n.len * six * 0.92, { wave: tr.wave, vol: tr.leadVol });
        if (tr.echo) voice(out, hz(n.midi - 12), t + six * 0.5, n.len * six * 0.6, { wave: 0.125, vol: 0.022 });
      }
      // arpeggio
      const arpNote = (i) => hz(chord[i % 3] + (i >= 3 ? 12 : 0));
      if (tr.arp === 'up') voice(out, arpNote(inBar % 4), t, six * 0.8, { wave: 0.125, vol: 0.032 });
      else if (tr.arp === 'updown') voice(out, arpNote([0, 1, 2, 3, 2, 1][inBar % 6]), t, six * 0.8, { wave: 0.125, vol: 0.032 });
      else if (tr.arp === 'eighths' && inBar % 2 === 0) voice(out, arpNote((inBar / 2) % 4), t, six * 1.6, { wave: 0.125, vol: 0.03 });
      else if (tr.arp === 'broken' && inBar % 2 === 0) voice(out, arpNote([0, 2, 1, 3][(inBar / 2) % 4]), t, six * 1.2, { wave: 0.5, vol: 0.022 });
      // bass
      const rootMidi = chord[0] - 24;
      if (tr.bass === 'octave' && inBar % 2 === 0) voice(out, hz(rootMidi + (inBar % 4 ? 12 : 0)), t, six * 1.8, { type: 'triangle', vol: 0.22 });
      else if (tr.bass === 'eighth' && inBar % 2 === 0) voice(out, hz(rootMidi), t, six * 1.6, { type: 'triangle', vol: 0.22 });
      else if (tr.bass === 'root' && inBar % 8 === 0) voice(out, hz(rootMidi), t, six * 7.5, { type: 'triangle', vol: 0.22 });
      else if (tr.bass === 'walk' && inBar % 4 === 0) voice(out, hz(rootMidi + [0, 7, 12, 7][inBar / 4]), t, six * 3.6, { type: 'triangle', vol: 0.22 });
      // drums
      const D = tr.drums;
      if (D.k[inBar] === 'x') voice(out, 150, t, 0.18, { type: 'sine', vol: 0.45, slide: 0.3 });
      if (D.s[inBar] === 'x') { noise(out, t, 0.14, 0.16, 1200); voice(out, 220, t, 0.06, { type: 'triangle', vol: 0.07 }); }
      if (D.h[inBar] === 'x' || (hurry && !tr.once)) noise(out, t, inBar % 8 === 6 ? 0.1 : 0.03, 0.05, 7000);

      d.step++;
      d.next += six;
      if (tr.once && d.step >= tr.steps) {
        d.stopping = true;
        setTimeout(() => { d.gain.disconnect(); if (d.onEnd) d.onEnd(); }, (d.next - ctx.currentTime) * 1000 + 300);
      }
    }
  }

  function tickAll() {
    decks = decks.filter((d) => !d.dead);
    decks.forEach(scheduleDeck);
  }

  function fadeOut(d, secs = 0.8) {
    if (d.stopping) return;
    d.stopping = true;
    d.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, secs / 4);
    setTimeout(() => { d.dead = true; d.gain.disconnect(); }, secs * 1000 + 200);
  }

  // -------------------------------------------------------------- cue logic
  let enabled = false;
  let currentCue = null;
  let pendingCue = null;
  let afterOnce = null;
  let rotation = {};
  try { rotation = JSON.parse(localStorage.getItem('rumpus.rotation') || '{}'); } catch (e) { rotation = {}; }
  let customAudio = null, customList = [];

  function nextIndex(cue) {
    const n = CATALOG[cue].length;
    const i = rotation[cue] == null ? Math.floor(Math.random() * n) : (rotation[cue] + 1) % n;
    rotation[cue] = i;
    try { localStorage.setItem('rumpus.rotation', JSON.stringify(rotation)); } catch (e) { /* ignore */ }
    return i;
  }

  function startCue(cue, then) {
    if (!CATALOG[cue]) cue = 'menu';
    const tr = track(cue, nextIndex(cue));
    decks.forEach((d) => fadeOut(d, tr.once ? 0.3 : 0.9));
    currentCue = cue;
    const deck = newDeck(tr, () => {
      // One-shots hand over to the follow-up cue (or the last requested one).
      const follow = pendingCue || then || afterOnce;
      pendingCue = null;
      if (follow && currentCue === cue) startCue(follow);
    });
    decks.push(deck);
    listeners.forEach((fn) => fn({ cue, name: tr.name }));
  }

  /**
   * play(cue, { then }) — switch to a cue. Looping cues rotate tracks each
   * time they're entered. One-shot cues (victory, intro) play, then go to
   * `then` (or whatever was requested meanwhile).
   */
  function play(cue, opts = {}) {
    if (!enabled) { pendingCue = cue; return; }
    if (customAudio) return;
    if (cue === currentCue && decks.some((d) => !d.stopping)) return;
    const playingOnce = decks.some((d) => !d.stopping && d.tr.once);
    if (playingOnce && !CATALOG[cue][0].once) { pendingCue = cue; return; } // let the jingle finish
    afterOnce = opts.then || null;
    startCue(cue, opts.then);
  }

  function nextCustom() {
    if (!customList.length) return;
    customAudio.src = customList[Math.floor(Math.random() * customList.length)];
    customAudio.play().catch(() => {});
    listeners.forEach((fn) => fn({ cue: 'custom', name: decodeURIComponent(customAudio.src.split('/').pop()).replace(/\.\w+$/, '') }));
  }

  async function enable() {
    ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    if (enabled) return;
    enabled = true;
    try { customList = await (await fetch('/api/music')).json(); } catch (e) { customList = []; }
    if (customList.length) {
      customAudio = new Audio();
      customAudio.volume = musicVol;
      customAudio.addEventListener('ended', nextCustom);
      nextCustom();
      return;
    }
    schedTimer = setInterval(tickAll, 25);
    const first = pendingCue || 'title';
    pendingCue = null;
    startCue(first);
  }

  function setHurry(on) { hurry = !!on; }

  // Briefly lower the music so a reveal sting cuts through.
  function duck(ms = 1200, level = 0.35) {
    if (!ctx) return;
    const t = ctx.currentTime;
    duckGain.gain.cancelScheduledValues(t);
    duckGain.gain.setTargetAtTime(level, t, 0.04);
    duckGain.gain.setTargetAtTime(1, t + ms / 1000, 0.25);
    if (customAudio) { customAudio.volume = musicVol * level; setTimeout(() => { customAudio.volume = musicVol; }, ms); }
  }

  function setVolume(kind, v) {
    if (kind === 'music') musicVol = v; else sfxVol = v;
    try { localStorage.setItem('rumpus.vol', JSON.stringify({ music: musicVol, sfx: sfxVol })); } catch (e) { /* ignore */ }
    if (musicBus) musicBus.gain.setTargetAtTime(musicVol * musicVol, ctx.currentTime, 0.05);
    if (sfxBus) sfxBus.gain.setTargetAtTime(sfxVol * sfxVol, ctx.currentTime, 0.05);
    if (customAudio) customAudio.volume = musicVol;
  }

  function sfx(fn) { if (ctx && enabled) fn(ctx.currentTime, sfxBus); }
  const SFX = {
    join: () => sfx((t, d) => { voice(d, 660, t, 0.1, { vol: 0.15 }); voice(d, 990, t + 0.09, 0.14, { vol: 0.15 }); }),
    phase: () => sfx((t, d) => { voice(d, 523, t, 0.1, { vol: 0.12 }); voice(d, 784, t + 0.1, 0.18, { vol: 0.12 }); }),
    tick: () => sfx((t, d) => voice(d, 1400, t, 0.04, { wave: 0.5, vol: 0.06 })),
    submit: () => sfx((t, d) => voice(d, 880, t, 0.06, { wave: 0.5, vol: 0.08 })),
    reveal: () => { duck(1300); sfx((t, d) => [523, 659, 784, 1047].forEach((f, i) => voice(d, f, t + i * 0.08, 0.2, { vol: 0.12 }))); },
    drumroll: () => sfx((t, d) => { for (let i = 0; i < 20; i++) noise(d, t + i * 0.045, 0.04, 0.05 + i * 0.004, 900); }),
    win: () => sfx((t, d) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => voice(d, f, t + i * 0.11, 0.25, { wave: 0.5, vol: 0.09 }))),
    boo: () => sfx((t, d) => voice(d, 220, t, 0.5, { wave: 0.5, vol: 0.12, slide: 0.5 })),
    pop: () => sfx((t, d) => voice(d, 1200, t, 0.05, { wave: 0.125, vol: 0.08, slide: 1.6 })),
    whoosh: () => sfx((t, d) => noise(d, t, 0.25, 0.08, 2500)),
    coin: () => sfx((t, d) => { voice(d, 988, t, 0.07, { wave: 0.5, vol: 0.08 }); voice(d, 1319, t + 0.07, 0.2, { wave: 0.5, vol: 0.08 }); }),
    leader: () => { duck(900); sfx((t, d) => [392, 523, 659, 784].forEach((f, i) => voice(d, f, t + i * 0.06, 0.12, { wave: 0.25, vol: 0.1 }))); },
    award: () => sfx((t, d) => { voice(d, 784, t, 0.12, { vol: 0.1 }); voice(d, 1175, t + 0.12, 0.3, { vol: 0.1 }); }),
  };

  window.Rumpus.music = {
    enable, play, setVolume, setHurry, duck, sfx: SFX,
    volumes: () => ({ music: musicVol, sfx: sfxVol }),
    isEnabled: () => enabled,
    onTrack: (fn) => listeners.push(fn),
    trackCount: TOTAL,
    details: () => Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v.map((sp, i) => {
      const t = track(k, i);
      const notes = t.lead.filter(Boolean).map((n) => n.midi);
      return { name: t.name, bpm: t.bpm, bars: t.steps / 16, notes: notes.length, lo: Math.min(...notes), hi: Math.max(...notes) };
    })])),
    catalog: () => Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v.map((s, i) => track(k, i).name)])),
  };
})();
