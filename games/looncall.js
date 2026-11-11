/*
 * "Loon Call" — a call-and-response rhythm party game (design: docs/design/rhythm-game-plan.md).
 * The lead loon sings a one-bar call; everyone echoes it on their phone in the next bar.
 * Phones timestamp taps in server time (Rumpus.time); a tune-up at the start measures each
 * phone's delay (TV audio + touch + clock), and judging subtracts it.
 * Mechanics only are genre-standard; names, music and art are original. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame, guarded } = require('./base');

const env = (/** @type {string} */ k, /** @type {number} */ d) => Number(process.env[k] || d);
const LEAD_MS = env('RUMPUS_LC_LEAD_MS', 1800);      // time for every screen to get the schedule
const RESULT_MS = env('RUMPUS_LC_RESULT_MS', 5000);
const GRACE_MS = env('RUMPUS_LC_GRACE_MS', 600);     // late taps/batches after a window closes
const TEMPO = env('RUMPUS_LC_TEMPO', 1);              // tests/playtest speed everything up
const PHRASES = env('RUMPUS_LC_PHRASES', 6);          // phrases per song
const CALL_REPEATS = env('RUMPUS_LC_CALL_REPEATS', 3);

// Judging windows (after calibration). Party-sized: tighter would punish phones, not players.
const PERFECT = 70, GOOD = 140, MATCH = 220;
const PTS = { perfect: 30, good: 15, extra: -5, clean: 20, sync: 10, callNote: 10 };
const STEPS = 8; // a caller's own call: 8th-note grid, one bar of 4/4
// The alignment costs: a missed note costs more than any real match, a stray tap a bit less.
const MISS_COST = MATCH + 40, EXTRA_COST = 150;

/** A song: tempo, metre (beats per bar) and grid (steps per bar: 6/8 = 8ths, 12 = triplets,
 * 16 = 16ths). Tier 1 is easy, 3 is hard; a game plays one song of each tier, picked by its seed.
 * @typedef {{ name: string, bpm: number, root: number, beats: number, steps: number, tier: 1 | 2 | 3, feel: string, patterns: number[][] }} Song */
/** @type {Song[]} */
const SONGS = [
  { name: 'Dawn Chorus', bpm: 92, root: 392, beats: 4, steps: 8, tier: 1, feel: 'straight 8ths', patterns: [[0, 2, 4, 6], [0, 4], [0, 2, 4], [0, 4, 6], [0, 1, 2, 4], [0, 2, 3, 4], [0, 2, 4, 5, 6], [0, 6]] },
  { name: 'Loon Waltz', bpm: 100, root: 349, beats: 3, steps: 6, tier: 1, feel: 'a waltz in 3', patterns: [[0, 2, 4], [0, 4], [0, 2, 3, 4], [0, 1, 2], [0, 4, 5], [0, 2, 4, 5]] },
  { name: 'Paddle Groove', bpm: 108, root: 440, beats: 4, steps: 8, tier: 2, feel: 'off-beats', patterns: [[0, 3, 6], [0, 3, 4, 6], [0, 2, 3, 5, 6], [0, 1, 4, 5], [0, 3, 5], [2, 4, 6], [0, 2, 5, 6], [1, 2, 4]] },
  { name: 'Swamp Swing', bpm: 88, root: 330, beats: 4, steps: 12, tier: 2, feel: 'swung triplets', patterns: [[0, 3, 6, 9], [0, 2, 3, 6], [0, 3, 5, 6, 9], [0, 2, 6, 8], [3, 5, 6, 9], [0, 1, 2, 6], [0, 3, 6, 8, 9], [0, 2, 3, 5, 6]] },
  { name: 'Rain on the Roof', bpm: 96, root: 415, beats: 4, steps: 16, tier: 2, feel: 'quick rolls', patterns: [[0, 1, 2, 4], [0, 4, 5, 6, 8], [0, 8, 9, 10], [0, 2, 4, 5, 6], [4, 5, 6, 8, 12], [0, 1, 2, 3, 4], [0, 6, 7, 8], [0, 4, 8, 9, 10, 12]] },
  { name: 'Moonlight Remix', bpm: 120, root: 494, beats: 4, steps: 8, tier: 3, feel: 'fast and busy', patterns: [[0, 1, 2, 3, 4], [0, 3, 6, 7], [0, 2, 5, 6], [1, 2, 4, 6], [0, 1, 3, 4, 6], [0, 3, 4, 7], [0, 2, 3, 6, 7], [0, 1, 2, 4, 6]] },
  { name: 'Firefly Funk', bpm: 94, root: 370, beats: 4, steps: 16, tier: 3, feel: 'syncopated 16ths', patterns: [[0, 3, 6, 8], [0, 3, 6, 10, 12], [0, 2, 3, 6, 9], [0, 6, 8, 11, 12], [0, 3, 4, 7, 10], [2, 4, 8, 10, 14], [0, 3, 6, 9, 12, 14], [0, 1, 4, 6, 10]] },
  { name: 'Northern Lights', bpm: 84, root: 311, beats: 3, steps: 12, tier: 3, feel: '16ths in 3', patterns: [[0, 3, 4, 8], [0, 2, 4, 6, 8], [0, 3, 6, 9, 10], [0, 1, 2, 6, 8], [0, 4, 7, 8], [2, 4, 6, 10], [0, 3, 5, 8, 11], [0, 6, 7, 8, 10]] },
];
const TUNE = { name: 'Tune-up', bpm: 100, clicks: 8 };

/** @typedef {'perfect' | 'good' | 'miss'} HitKind */
/** @typedef {{ steps: number[], by: string | null, callAt: number, echoAt: number }} Phrase */
/** @typedef {{ kind: 'tune' | 'song' | 'call', name: string, bpm: number, root: number, startAt: number, barMs: number, beats: number, steps: number, feel: string, countIn: number, phrases: Phrase[], clicks: number[], caller: string | null, endAt: number }} Schedule */

/**
 * Judge one echoed bar. Taps (server ms, already calibrated) are lined up with the notes by the
 * best overall alignment (a dynamic-programming match, in time order): a tap between two notes
 * goes where it makes the whole bar make most sense, not just to the nearest note. Taps that
 * match nothing are extras (anti-mash).
 * @param {number[]} notes expected times @param {number[]} taps
 */
function judge(notes, taps) {
  const N = [...notes].sort((a, b) => a - b), T = [...taps].sort((a, b) => a - b);
  const n = N.length, m = T.length;
  // cost[i][j]: best cost for the first i notes and j taps; how[i][j]: 0 match, 1 miss, 2 extra.
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const how = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(-1));
  cost[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const c = cost[i][j];
      if (c === Infinity) continue;
      if (i < n && c + MISS_COST < cost[i + 1][j]) { cost[i + 1][j] = c + MISS_COST; how[i + 1][j] = 1; }
      if (j < m && c + EXTRA_COST < cost[i][j + 1]) { cost[i][j + 1] = c + EXTRA_COST; how[i][j + 1] = 2; }
      if (i < n && j < m) {
        const d = Math.abs(T[j] - N[i]);
        if (d <= MATCH && c + d < cost[i + 1][j + 1]) { cost[i + 1][j + 1] = c + d; how[i + 1][j + 1] = 0; }
      }
    }
  }
  /** @type {{ kind: HitKind, d: number | null }[]} */
  const sorted = N.map(() => ({ kind: /** @type {HitKind} */ ('miss'), d: null }));
  let extras = 0;
  for (let i = n, j = m; i > 0 || j > 0;) {
    const h = how[i][j];
    if (h === 0) {
      const d = Math.round(T[j - 1] - N[i - 1]);
      sorted[i - 1] = { kind: Math.abs(d) <= PERFECT ? 'perfect' : Math.abs(d) <= GOOD ? 'good' : 'miss', d };
      i--; j--;
    } else if (h === 1) i--;
    else { extras++; j--; }
  }
  // Report hits in the caller's note order.
  const hits = notes.map((t) => sorted[N.indexOf(t)]);
  const clean = extras === 0 && hits.every((h) => h.kind !== 'miss');
  const raw = hits.reduce((s, h) => s + (h.kind === 'perfect' ? PTS.perfect : h.kind === 'good' ? PTS.good : 0), 0);
  const points = Math.max(0, raw + extras * PTS.extra + (clean ? PTS.clean : 0));
  return { hits, extras, clean, points };
}

/**
 * A phone's delay: the median of (tap − nearest click) over taps that were near a click.
 * Needs 3+ usable taps; clamped to ±350 ms (beyond that it's a mis-tap, not latency).
 * @param {number[]} clicks @param {number[]} taps
 */
function calibrate(clicks, taps) {
  const ds = taps.map((t) => {
    const near = clicks.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), Infinity);
    return t - near;
  }).filter((d) => Math.abs(d) <= 400).sort((a, b) => a - b);
  if (ds.length < 3) return 0;
  const mid = ds.length % 2 ? ds[(ds.length - 1) / 2] : (ds[ds.length / 2 - 1] + ds[ds.length / 2]) / 2;
  return Math.round(Math.max(-350, Math.min(350, mid)));
}

/**
 * A player's own call: taps → 8th-note steps of the bar starting at `barStart`.
 * @param {number[]} taps @param {number} barStart @param {number} barMs
 */
function quantise(taps, barStart, barMs) {
  const step = barMs / STEPS;
  const out = new Set();
  for (const t of taps) {
    const s = Math.round((t - barStart) / step);
    if (s >= 0 && s < STEPS) out.add(s);
  }
  return [...out].sort((a, b) => a - b);
}

class LoonCallGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = Math.min(3, this.rounds(3));
    this.realtime = true; // phones vote to end a round (games/flow.js), not to hurry answers
    /** @type {Map<string, number>} per-phone delay from the tune-up */
    this.calib = new Map();
    /** @type {Schedule | null} */
    this.sched = null;
    /** @type {Map<string, number[]>} this schedule's raw taps per player */
    this.taps = new Map();
    /** @type {Map<string, { kind: HitKind | 'extra', d: number | null, seq: number }>} last tap feedback (TV) */
    this.last = new Map();
    this.tapSeq = 0;
    /** @type {Map<string, Map<number, ReturnType<typeof judge>>>} judged phrases per player */
    this.judged = new Map();
    /** @type {Set<number>} phrases already scored */
    this.scored = new Set();
    /** @type {{ phrase: number, sync: boolean }[]} */
    this.phraseLog = [];
    /** @type {Map<string, number>} points this schedule */
    this.gained = new Map();
    /** @type {Set<string>} who has already been a caller */
    this.callers = new Set();
    /** @type {string | null} */
    this.composer = null;
    /** @type {NodeJS.Timeout[]} */
    this.phraseTimers = [];
    this.result = null;
    /** @type {NodeJS.Timeout | null} */
    this.pushTimer = null;
    /** @type {Song[] | null} */
    this.songs = null;
  }

  /** ×1, ×2, ×3 for the three songs (a Your Call scores at the stake of the song it leads into). */
  mult() {
    if (this.totalRounds === 3) return this.round >= 3 ? 3 : this.round === 2 ? 2 : 1;
    return super.mult();
  }

  destroy() {
    this.phraseTimers.forEach(clearTimeout);
    super.destroy();
  }

  start() { this.tune(); }

  // --- schedules -------------------------------------------------------------

  /** @param {Omit<Schedule, 'startAt' | 'barMs' | 'endAt' | 'phrases' | 'clicks' | 'beats' | 'steps' | 'feel'> & { phrases?: number[][], clicks?: number, beats?: number, steps?: number, feel?: string }} spec */
  schedule(spec) {
    const bpm = spec.bpm * TEMPO;
    const beats = spec.beats || 4, steps = spec.steps || STEPS;
    const barMs = (beats * 60000) / bpm;
    const startAt = Date.now() + LEAD_MS;
    const beat = barMs / beats;
    const firstBar = startAt + spec.countIn * barMs;
    /** @type {Phrase[]} */
    const phrases = (spec.phrases || []).map((steps, i) => ({
      steps, by: spec.caller ? this.nick(spec.caller) : null,
      callAt: firstBar + 2 * i * barMs, echoAt: firstBar + (2 * i + 1) * barMs,
    }));
    // Clicks start right away: the count-in of a song, the tune-up beats, or a caller's metronome.
    const clicks = Array.from({ length: spec.clicks || 0 }, (_, i) => startAt + i * beat);
    const endAt = phrases.length ? phrases[phrases.length - 1].echoAt + barMs : (clicks.length ? clicks[clicks.length - 1] + beat : firstBar + barMs);
    this.sched = { kind: spec.kind, name: spec.name, bpm, root: spec.root, caller: spec.caller, countIn: spec.countIn, startAt, barMs, beats, steps, feel: spec.feel || '', phrases, clicks, endAt };
    this.taps = new Map();
    this.last = new Map();
    this.judged = new Map();
    this.scored = new Set();
    this.phraseLog = [];
    this.gained = new Map();
    this.phraseTimers.forEach(clearTimeout);
    this.phraseTimers = phrases.map((p, i) => setTimeout(() => { if (!this.destroyed) guarded(() => this.scorePhrase(i), 'loon call scoring', this); }, Math.max(0, p.echoAt + barMs + GRACE_MS - Date.now())));
    // Push when each echo bar ends, so bots (and the TV) see the phrase is done.
    for (const at of [...phrases.map((p) => p.echoAt + barMs), endAt]) this.phraseTimers.push(setTimeout(() => { if (!this.destroyed) this.push(); }, Math.max(0, at - Date.now() + 5)));
    return this.sched;
  }

  tune() {
    this.phase = 'lc-tune';
    const s = this.schedule({ kind: 'tune', name: TUNE.name, bpm: TUNE.bpm, root: 392, countIn: 0, clicks: TUNE.clicks, caller: null });
    this.setTimer(s.endAt + GRACE_MS - Date.now(), () => this.endTune(), false);
    this.push();
  }

  endTune() {
    const s = /** @type {Schedule} */ (this.sched);
    for (const id of this.playerIds()) this.calib.set(id, calibrate(s.clicks, this.taps.get(id) || []));
    this.nextRound();
  }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    // Before songs 2 and 3: the trailing player writes a call (players are the content + a comeback).
    if (this.round > 1 && this.room.players.size >= 2) return this.compose();
    this.song();
  }

  /** This game's songs: one easy, one medium, one hard (by its seed), easiest first. */
  playlist() {
    if (!this.songs) this.songs = [1, 2, 3].map((tier) => this.rng.pick(SONGS.filter((x) => x.tier === tier)));
    return this.songs;
  }

  /** The song of the current round. */
  current() {
    const list = this.playlist();
    return list[(this.round - 1) % list.length];
  }

  song() {
    const song = this.current();
    // Ramp: easier half first, then the rest, each half shuffled.
    const half = Math.ceil(song.patterns.length / 2);
    const order = [...this.rng.shuffle(song.patterns.slice(0, half)), ...this.rng.shuffle(song.patterns.slice(half))];
    const phrases = Array.from({ length: PHRASES }, (_, i) => order[Math.floor((i * order.length) / PHRASES)]);
    this.phase = 'lc-song';
    const s = this.schedule({ kind: 'song', name: song.name, bpm: song.bpm, root: song.root, beats: song.beats, steps: song.steps, feel: song.feel, countIn: 1, clicks: song.beats, phrases, caller: null });
    this.setTimer(s.endAt + GRACE_MS + 100 - Date.now(), () => this.results(), false);
    this.push();
  }

  compose() {
    const ids = this.playerIds();
    const fresh = ids.filter((id) => !this.callers.has(id));
    const pool = fresh.length ? fresh : ids;
    const low = Math.min(...pool.map((id) => (this.player(id) || { score: 0 }).score));
    const caller = this.rng.pick(pool.filter((id) => (this.player(id) || { score: 0 }).score === low));
    this.callers.add(caller);
    this.composer = caller;
    const song = this.current();
    this.phase = 'lc-compose';
    // One bar of count-in clicks, then the caller taps their call over the second bar.
    const s = this.schedule({ kind: 'call', name: 'Your Call', bpm: song.bpm, root: song.root, countIn: 0, clicks: 8, caller });
    this.setTimer(s.endAt + GRACE_MS - Date.now(), () => this.callSong(), false);
    this.push();
  }

  callSong() {
    const s = /** @type {Schedule} */ (this.sched);
    const caller = /** @type {string} */ (this.composer);
    const recStart = s.startAt + s.barMs; // the second bar of clicks
    let steps = quantise((this.taps.get(caller) || []).map((t) => t - (this.calib.get(caller) || 0)), recStart, s.barMs);
    if (steps.length < 2) steps = [0, 2, 4, 6]; // too shy: the loon helps out
    const song = this.current();
    this.phase = 'lc-song';
    const next = this.schedule({ kind: 'call', name: `${this.nick(caller)}'s Call`, bpm: song.bpm, root: song.root, countIn: 1, clicks: 4, phrases: Array(CALL_REPEATS).fill(steps), caller });
    this.setTimer(next.endAt + GRACE_MS + 100 - Date.now(), () => this.results(), false);
    this.push();
  }

  // --- taps -------------------------------------------------------------------

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (!this.sched || !['lc-tune', 'lc-song', 'lc-compose'].includes(this.phase)) return;
    const now = Date.now();
    // Phones send one tap at a time ({tap: serverMs}); bots send a finished bar ({taps: [...]}).
    const list = Array.isArray(payload.taps) ? payload.taps.slice(0, 16) : [payload.tap];
    const s = this.sched;
    const mine = this.taps.get(id) || [];
    let added = 0;
    for (const raw of list) {
      const t = Number(raw);
      // Taps must be in this schedule and not from the future (a little clock slack allowed).
      if (!Number.isFinite(t) || t < s.startAt - 500 || t > now + 300 || t > s.endAt + GRACE_MS) continue;
      if (mine.length >= 200) break;
      mine.push(t);
      added++;
      if (list.length === 1) this.feedback(id, t);
    }
    if (!added) return;
    this.taps.set(id, mine);
    this.pushSoon();
  }

  /** Live TV feedback for one tap: nearest note in the current echo bar. @param {string} id @param {number} t */
  feedback(id, t) {
    const s = /** @type {Schedule} */ (this.sched);
    if (s.kind === 'tune' || (s.kind === 'call' && this.phase === 'lc-compose')) {
      this.last.set(id, { kind: 'good', d: null, seq: ++this.tapSeq });
      return;
    }
    const ct = t - (this.calib.get(id) || 0);
    const notes = s.phrases.flatMap((p) => p.steps.map((st) => p.echoAt + (st * s.barMs) / s.steps));
    const near = notes.reduce((a, b) => (Math.abs(b - ct) < Math.abs(a - ct) ? b : a), Infinity);
    const d = Math.round(ct - near);
    const kind = Math.abs(d) <= PERFECT ? 'perfect' : Math.abs(d) <= GOOD ? 'good' : Math.abs(d) <= MATCH ? 'miss' : 'extra';
    this.last.set(id, { kind, d: kind === 'extra' ? null : d, seq: ++this.tapSeq });
  }

  pushSoon() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => { this.pushTimer = null; if (!this.destroyed) this.push(); }, 80);
  }

  /** Score echo bar `i` for everyone once its window (plus grace) has passed. @param {number} i */
  scorePhrase(i) {
    const s = this.sched;
    if (!s || this.destroyed || this.scored.has(i) || !s.phrases[i]) return;
    this.scored.add(i);
    const p = s.phrases[i];
    const notes = p.steps.map((st) => p.echoAt + (st * s.barMs) / s.steps);
    const from = p.echoAt - MATCH, to = p.echoAt + s.barMs + MATCH;
    // Everyone echoes — the caller too (playtest: sitting out their own call left them idle 33 s).
    const echoers = this.playerIds();
    const others = echoers.filter((id) => id !== s.caller);
    let allClean = echoers.length > 1;
    let hitsForCaller = 0;
    for (const id of echoers) {
      const off = this.calib.get(id) || 0;
      const taps = (this.taps.get(id) || []).map((t) => t - off).filter((t) => t >= from && t < to);
      const j = judge(notes, taps);
      if (!this.judged.has(id)) this.judged.set(id, new Map());
      /** @type {Map<number, ReturnType<typeof judge>>} */ (this.judged.get(id)).set(i, j);
      if (!j.clean) allClean = false;
      // Keep tuning each phone as it plays: if a clean-ish bar was consistently early or late,
      // nudge its delay halfway towards it (speakers and phones drift; the tune-up is 8 taps).
      const ds = j.hits.filter((h) => h.d !== null && h.kind !== 'miss').map((h) => /** @type {number} */ (h.d));
      if (!j.extras && ds.length >= 2) {
        const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
        if (Math.abs(mean) >= 15) this.calib.set(id, Math.max(-350, Math.min(350, Math.round(off + mean / 2))));
      }
      if (id !== s.caller) hitsForCaller += j.hits.filter((h) => h.kind !== 'miss').length;
      this.give(id, j.points);
    }
    if (allClean) for (const id of echoers) this.give(id, PTS.sync);
    // The caller earns for every note the room echoed back: tricky-but-fair calls pay best.
    if (s.caller && others.length) this.give(s.caller, Math.round((PTS.callNote * hitsForCaller) / others.length));
    this.phraseLog.push({ phrase: i, sync: allClean });
    this.push();
  }

  /** @param {string} id @param {number} pts */
  give(id, pts) {
    if (!pts) return;
    this.gained.set(id, (this.gained.get(id) || 0) + this.award(id, pts));
  }

  results() {
    const s = /** @type {Schedule} */ (this.sched);
    s.phrases.forEach((_, i) => this.scorePhrase(i));
    const rows = this.playerIds().map((id) => {
      const js = [...(this.judged.get(id) || /** @type {Map<number, ReturnType<typeof judge>>} */ (new Map())).values()];
      const notes = js.reduce((n, j) => n + j.hits.length, 0);
      const hit = js.reduce((n, j) => n + j.hits.filter((h) => h.kind !== 'miss').length, 0);
      const perfect = js.reduce((n, j) => n + j.hits.filter((h) => h.kind === 'perfect').length, 0);
      const pct = notes ? Math.round((100 * hit) / notes) : null;
      const offs = js.flatMap((j) => j.hits.filter((h) => h.d !== null).map((h) => /** @type {number} */ (h.d)));
      const lean = offs.length >= 3 ? Math.round(offs.reduce((a, b) => a + b, 0) / offs.length) : 0;
      return {
        nickname: this.nick(id), caller: id === s.caller, pct, perfect,
        grade: pct === null ? null : pct >= 85 ? 'Nailed it!' : pct >= 55 ? 'Close enough' : 'Off the beat',
        lean: Math.abs(lean) < 35 ? null : lean > 0 ? 'late' : 'early',
        gained: this.gained.get(id) || 0,
      };
    }).sort((a, b) => b.gained - a.gained);
    this.result = { name: s.name, kind: s.kind, rows, sync: this.phraseLog.filter((x) => x.sync).length, phrases: s.phrases.length };
    this.phase = 'lc-result';
    this.setTimer(RESULT_MS, () => (s.kind === 'call' ? this.song() : this.nextRound()), false);
    this.push();
  }

  onPlayerLeft() { /* timers drive every phase; leavers simply stop scoring */ }

  // --- views --------------------------------------------------------------------

  schedView() {
    const s = this.sched;
    if (!s) return null;
    return { kind: s.kind, name: s.name, bpm: s.bpm, root: s.root, startAt: s.startAt, barMs: s.barMs, countIn: s.countIn, endAt: s.endAt,
      clicks: s.clicks, phrases: s.phrases, caller: s.caller ? this.nick(s.caller) : null, steps: s.steps, beats: s.beats, feel: s.feel };
  }

  hostView() {
    return {
      sched: ['lc-tune', 'lc-song', 'lc-compose'].includes(this.phase) ? this.schedView() : null,
      choir: this.playerIds().map((id) => {
        const l = this.last.get(id);
        return { nickname: this.nick(id), hit: l ? l.kind : null, d: l ? l.d : null, seq: l ? l.seq : 0, score: (this.player(id) || { score: 0 }).score };
      }),
      syncs: this.phraseLog.filter((x) => x.sync).map((x) => x.phrase),
      scoredPhrases: this.scored.size,
      composer: this.phase === 'lc-compose' && this.composer ? this.nick(this.composer) : null,
      result: this.phase === 'lc-result' ? this.result : null,
      serverNow: Date.now(),
    };
  }

  /** @param {string} id */
  playerOnly(id) {
    const s = this.sched;
    const me = this.result && this.result.rows.find((r) => r.nickname === this.nick(id));
    return {
      gameState: { sched: ['lc-tune', 'lc-song', 'lc-compose'].includes(this.phase) ? this.schedView() : null, serverNow: Date.now(),
        composer: this.phase === 'lc-compose' && this.composer ? this.nick(this.composer) : null, result: this.phase === 'lc-result' ? this.result : null },
      you: {
        calib: this.calib.get(id) || 0,
        isCaller: !!(s && s.caller === id),
        taps: (this.taps.get(id) || []).length,
        // Echo bars this phone has tapped in (bots use it to answer each bar once).
        tapped: s ? s.phrases.map((p, i) => ((this.taps.get(id) || []).some((t) => t >= p.echoAt - MATCH && t < p.echoAt + s.barMs + MATCH) ? i : -1)).filter((i) => i >= 0) : [],
        judged: [...((this.judged.get(id) || new Map()).keys())],
        last: this.last.get(id) || null,
        result: me || null,
      },
    };
  }
}

LoonCallGame.meta = {
  id: 'looncall',
  name: 'Loon Call',
  blurb: 'A rhythm game for the whole room: listen to the loon, then echo the call on your phone — together.',
  minPlayers: 2,
};
LoonCallGame.judge = judge;
LoonCallGame.calibrate = calibrate;
LoonCallGame.quantise = quantise;
LoonCallGame.SONGS = SONGS;

module.exports = LoonCallGame;
