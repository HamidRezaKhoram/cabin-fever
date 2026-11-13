/*
 * "Cottage Olympics" — a series of short real-time phone challenges.
 * Team mode (Red vs Blue) when teams are on, otherwise every player for themselves.
 * The server is the referee: tap rates are capped, times are measured on the server clock (it's a
 * local network, so latency is a few ms), and every random thing (which minis, how long to hold,
 * where the mosquitoes are) comes from the game's seed, always between set bounds (games/rng.js).
 * AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame } = require('./base');

const env = (/** @type {string} */ k, /** @type {number} */ d) => parseInt(process.env[k] || String(d), 10);
const INTRO_MS = env('RUMPUS_MG_INTRO_MS', 3500);
// Playtest: 6 s result screens were the main dead air between minis.
const RESULT_MS = env('RUMPUS_MG_RESULT_MS', 4500);
const TUG_MS = env('RUMPUS_MG_TUG_MS', 15000);
const DRAW_WAIT_MIN = env('RUMPUS_MG_DRAW_MIN', 2000);
const DRAW_WAIT_MAX = env('RUMPUS_MG_DRAW_MAX', 5000);
const DRAW_WINDOW_MS = env('RUMPUS_MG_DRAW_WINDOW', 4000);
const FLY_SHOW_MS = env('RUMPUS_MG_FLY_SHOW_MS', 5000);
const FLY_GUESS_MS = env('RUMPUS_MG_FLY_GUESS_MS', 10000);
const ROAST_MS = env('RUMPUS_MG_ROAST_MS', 12000);
const PLAY_MS = env('RUMPUS_MG_PLAY_MS', 12000);      // most of the new minis
const SHOW_MS = env('RUMPUS_MG_SHOW_MS', 600);        // one step of the campfire sequence
const MAX_TAPS_PER_SEC = 15;

/** @typedef {'tug'|'quickdraw'|'fireflies'|'roast'|'skip'|'spot'|'swat'|'balance'|'paddle'|'simon'|'stack'} MiniId */
/** @type {Record<MiniId, { name: string, rule: string, better: 'low' | 'high' }>} */
const MINIS = {
  tug: { name: 'Tug of Lake', rule: 'TAP AS FAST AS YOU CAN!', better: 'high' },
  quickdraw: { name: 'Quick Draw', rule: 'Wait for GO… then tap first. Too early = SPLASH!', better: 'low' },
  fireflies: { name: 'Firefly Count', rule: 'Count the fireflies on the TV. Closest guess wins.', better: 'low' },
  roast: { name: 'Marshmallow Roast', rule: 'Hold to roast, let go at the target time — no clock to help you. Too long = burnt!', better: 'low' },
  skip: { name: 'Skip Stones', rule: 'Three throws: tap when the swinging arrow is in the green. Most skips wins.', better: 'high' },
  spot: { name: 'Loon Spotting', rule: 'One loon is hiding among the ducks on the TV. Tap its spot on your phone — first right answer wins!', better: 'low' },
  swat: { name: 'Mosquito Swat', rule: 'Mosquitoes land on your phone. Swat as many as you can!', better: 'high' },
  balance: { name: 'Dock Balance', rule: 'Keep your finger inside the drifting ring. Longest inside wins.', better: 'high' },
  paddle: { name: 'Canoe Sprint', rule: 'Paddle LEFT, RIGHT, LEFT, RIGHT… only alternating strokes count!', better: 'high' },
  simon: { name: 'Campfire Sequence', rule: 'Watch the sparks on the TV, then repeat the colours on your phone. Right and fast wins.', better: 'low' },
  stack: { name: 'Woodpile Stack', rule: 'Tap to drop the sliding log on the pile. Miss the edge and it gets smaller. Tallest pile wins!', better: 'high' },
};
const ORDER = /** @type {MiniId[]} */ ((process.env.RUMPUS_MG_ORDER || '').split(',').filter((x) => x in MINIS));
const SPOT_CELLS = 12;
const COLOURS = 4;

/** Skip Stones: where the arrow is (0–1) at a time, swinging back and forth. @param {number} t ms since start @param {number} period */
function swing(t, period) {
  const x = ((t % period) + period) % period / period;
  return x < 0.5 ? x * 2 : 2 - x * 2;
}
/** Skips for a throw that landed at `v` with the green zone centred on `sweet`. @param {number} v @param {number} sweet */
function skipsFor(v, sweet) {
  return Math.max(0, Math.round(8 - Math.abs(v - sweet) / 0.035));
}

class MinigamesGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(9);
    this.realtime = true; // phones vote to end a round (games/flow.js), not to hurry answers
    /** @type {MiniId[]} */
    this.queue = [];
    /** @type {MiniId | null} */
    this.mini = null;
    this.sub = '';
    /** @type {Map<string, number>} taps (tug) / strokes (paddle) */
    this.taps = new Map();
    /** @type {Map<string, number>} reaction ms (quickdraw, spot, simon) */
    this.reactions = new Map();
    /** @type {Set<string>} too early / wrong answer */
    this.early = new Set();
    /** @type {Map<string, number>} number guesses / hold ms / skips / swats / balance % / stack height */
    this.entries = new Map();
    /** @type {Map<string, number>} Dock Balance / Woodpile Stack so far (phones report as they go), used
     * if the round is ended early — the final result only comes at the end */
    this.partial = new Map();
    /** @type {Map<string, number>} throws used (skip) */
    this.throws = new Map();
    /** @type {Map<string, Set<number>>} mosquitoes swatted */
    this.swatted = new Map();
    /** @type {Map<string, number>} skips of each player's latest throw (shown on their phone) */
    this.lastThrow = new Map();
    this.goAt = 0;
    this.playStart = 0;
    /** @type {{x:number,y:number,d:number}[]} */
    this.flies = [];
    /** Per-mini random parameters (seeded, bounded), sent to phones that need them. @type {Record<string, any>} */
    this.params = {};
    this.result = null;
    /** @type {NodeJS.Timeout | null} */
    this.pushTimer = null;
  }

  teamsOn() { return !!(this.room.settings && this.room.settings.teams); }
  /** @param {string} id */
  teamOf(id) { const p = this.room.players.get(id); return p && p.team; }

  start() { this.nextRound(); }

  nextMini() {
    if (ORDER.length) return ORDER[(this.round - 1) % ORDER.length];
    if (!this.queue.length) this.queue = this.rng.shuffle(/** @type {MiniId[]} */ (Object.keys(MINIS)));
    if (this.queue[0] === this.mini && this.queue.length > 1) this.queue.push(/** @type {MiniId} */ (this.queue.shift()));
    return /** @type {MiniId} */ (this.queue.shift());
  }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    this.mini = this.nextMini();
    this.taps = new Map(); this.reactions = new Map(); this.early = new Set(); this.entries = new Map(); this.partial = new Map();
    this.throws = new Map(); this.swatted = new Map(); this.lastThrow = new Map();
    this.result = null; this.sub = ''; this.params = this.makeParams(this.mini);
    this.phase = 'mg-intro';
    this.setTimer(INTRO_MS, () => this.play(), false);
    this.push();
  }

  /** The random parts of a mini, all within bounds. @param {MiniId} mini */
  makeParams(mini) {
    const r = this.rng;
    switch (mini) {
      case 'roast': {
        const target = Math.round(r.range(2000, 6000) / 100) * 100; // 2.0–6.0 s
        return { target, burn: target + Math.round(target * 0.2) };
      }
      case 'skip': return { period: r.int(1100, 1700), sweet: Math.round(r.range(0.25, 0.75) * 100) / 100, zone: 0.1 };
      case 'spot': return { loon: r.int(0, SPOT_CELLS - 1), cells: SPOT_CELLS, ducks: Array.from({ length: SPOT_CELLS }, () => r.int(0, 2)) };
      case 'swat': {
        const n = r.int(14, 20);
        return { bugs: Array.from({ length: n }, (_, i) => ({ at: Math.round((i * (PLAY_MS - 1800)) / n + r.range(0, 500)), x: r.int(8, 88), y: r.int(10, 86), life: r.int(700, 1100) })) };
      }
      case 'balance': return { ax: r.range(0.6, 1.1), ay: r.range(0.8, 1.4), px: r.range(0, 6.28), py: r.range(0, 6.28), radius: r.range(0.16, 0.2) };
      case 'simon': return { seq: Array.from({ length: r.int(5, 7) }, () => r.int(0, COLOURS - 1)) };
      case 'stack': return { speed: Math.round(r.range(0.9, 1.3) * 100) / 100, speedUp: 1.08 };
      case 'tug': return { ms: r.int(Math.round(TUG_MS * 0.75), TUG_MS) };
      case 'paddle': return { ms: r.int(Math.round(PLAY_MS * 0.7), PLAY_MS) };
      default: return {};
    }
  }

  play() {
    this.phase = 'mg-play';
    this.playStart = Date.now();
    const done = () => this.finish();
    const p = this.params;
    switch (this.mini) {
      case 'tug': this.sub = 'go'; this.setTimer(p.ms, done, false); break;
      case 'quickdraw': {
        this.sub = 'wait';
        const wait = this.rng.int(DRAW_WAIT_MIN, Math.max(DRAW_WAIT_MIN, DRAW_WAIT_MAX));
        this.setTimer(wait, () => { this.sub = 'go'; this.goAt = Date.now(); this.setTimer(DRAW_WINDOW_MS, done, false); this.push(); }, false);
        break;
      }
      case 'fireflies': {
        this.sub = 'show';
        const n = this.rng.int(12, 40);
        this.flies = Array.from({ length: n }, () => ({ x: this.rng.int(4, 95), y: this.rng.int(6, 91), d: this.rng.int(0, 9) }));
        this.setTimer(FLY_SHOW_MS, () => { this.sub = 'guess'; this.setTimer(FLY_GUESS_MS, done, false); this.push(); }, false);
        break;
      }
      case 'spot': this.sub = 'go'; this.goAt = Date.now(); this.setTimer(PLAY_MS, done, false); break;
      case 'simon': {
        // The TV shows the sequence, then phones repeat it.
        this.sub = 'show';
        this.setTimer(SHOW_MS * (p.seq.length + 1), () => { this.sub = 'go'; this.goAt = Date.now(); this.setTimer(PLAY_MS, done, false); this.push(); }, false);
        break;
      }
      case 'roast': this.sub = 'go'; this.setTimer(ROAST_MS, done, false); break;
      case 'paddle': this.sub = 'go'; this.setTimer(p.ms, done, false); break;
      case 'stack': this.sub = 'go'; this.setTimer(PLAY_MS + 8000, done, false); break;
      default: this.sub = 'go'; this.setTimer(PLAY_MS, done, false);
    }
    this.push();
  }

  // Throttled push (10/s) for rapid tap updates.
  pushSoon() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => { this.pushTimer = null; if (!this.destroyed) this.push(); }, 100);
  }

  /** Everyone has a final result (or is out): end early. */
  maybeDone() {
    if (this.playerIds().every((p) => this.entries.has(p) || this.reactions.has(p) || this.early.has(p))) { this.finish(); return true; }
    return false;
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase !== 'mg-play') return;
    const now = Date.now();
    const p = this.params;
    switch (this.mini) {
      case 'tug': case 'paddle': {
        // Rate cap: no more than MAX_TAPS_PER_SEC since the start (+ a little burst).
        const n = this.mini === 'tug' ? payload.tap : payload.strokes;
        if (!Number.isInteger(n) || n <= 0) return;
        const allowed = Math.floor(((now - this.playStart) / 1000) * (this.mini === 'paddle' ? 10 : MAX_TAPS_PER_SEC)) + 5;
        this.taps.set(id, Math.min(allowed, (this.taps.get(id) || 0) + Math.min(n, 20)));
        if (this.mini === 'tug' && this.teamsOn()) {
          const { red, blue } = this.tugTotals();
          if (Math.abs(red - blue) >= this.tugGoal()) return this.finish();
        }
        return this.pushSoon();
      }
      case 'quickdraw':
        if (!payload.tap || this.early.has(id) || this.reactions.has(id)) return;
        if (this.sub === 'wait') this.early.add(id); else this.reactions.set(id, now - this.goAt);
        if (!this.maybeDone()) this.push();
        return;
      case 'fireflies': { // lock in while they're still on screen, or after
        const n = Number(payload.number);
        if (!Number.isFinite(n) || n < 0 || n > 999 || this.entries.has(id)) return;
        this.entries.set(id, Math.round(n));
        if (!this.maybeDone()) this.push();
        return;
      }
      case 'roast': {
        const ms = Number(payload.hold);
        if (!Number.isFinite(ms) || ms < 0 || ms > 20000 || this.entries.has(id)) return;
        this.entries.set(id, Math.round(ms));
        if (!this.maybeDone()) this.push();
        return;
      }
      case 'skip': {
        // A throw at server time `at` (phones send their synced clock): the server reads the arrow.
        const at = Number(payload.throw);
        const used = this.throws.get(id) || 0;
        if (!Number.isFinite(at) || used >= 3 || at < this.playStart - 200 || at > now + 300) return;
        const skips = skipsFor(swing(at - this.playStart, p.period), p.sweet);
        this.throws.set(id, used + 1);
        this.lastThrow.set(id, skips);
        this.entries.set(id, (this.entries.get(id) || 0) + skips);
        if (this.playerIds().every((x) => (this.throws.get(x) || 0) >= 3)) return this.finish();
        return this.push();
      }
      case 'spot': {
        const cell = Number(payload.cell);
        if (!Number.isInteger(cell) || this.early.has(id) || this.reactions.has(id)) return;
        if (cell === p.loon) this.reactions.set(id, now - this.goAt); else this.early.add(id);
        if (!this.maybeDone()) this.push();
        return;
      }
      case 'swat': {
        const i = Number(payload.swat);
        const bug = Number.isInteger(i) ? p.bugs[i] : null;
        if (!bug) return;
        const t = now - this.playStart;
        if (t < bug.at - 150 || t > bug.at + bug.life + 300) return; // it wasn't there
        const mine = this.swatted.get(id) || new Set();
        if (mine.has(i)) return;
        mine.add(i);
        this.swatted.set(id, mine);
        return this.pushSoon();
      }
      case 'balance': case 'stack': {
        const v = Number(payload[this.mini]);
        const max = this.mini === 'balance' ? 100 : 40;
        if (!Number.isFinite(v) || v < 0 || v > max || this.entries.has(id)) return;
        if (payload.partial === true) { this.partial.set(id, Math.round(v)); return; } // progress, not done
        this.entries.set(id, Math.round(v));
        if (!this.maybeDone()) this.push();
        return;
      }
      case 'simon': {
        if (this.sub !== 'go' || !Array.isArray(payload.seq) || this.reactions.has(id) || this.early.has(id)) return;
        const ok = payload.seq.length === p.seq.length && payload.seq.every((/** @type {unknown} */ c, /** @type {number} */ k) => c === p.seq[k]);
        if (ok) this.reactions.set(id, now - this.goAt); else this.early.add(id);
        if (!this.maybeDone()) this.push();
        return;
      }
      default:
    }
  }

  tugTotals() {
    const t = { red: 0, blue: 0 };
    for (const [id, n] of this.taps) { const team = this.teamOf(id); if (team === 'red' || team === 'blue') t[team] += n; }
    return t;
  }

  tugGoal() {
    const per = Math.max(1, Math.ceil(this.room.players.size / 2));
    return 25 * per; // ~ a 2-second lead of hard tapping per player
  }

  /** One number per player: the raw result. @param {string} id @returns {number | null} */
  raw(id) {
    switch (this.mini) {
      case 'tug': case 'paddle': return this.taps.get(id) || 0;
      case 'quickdraw': case 'spot': case 'simon': return this.reactions.has(id) ? /** @type {number} */ (this.reactions.get(id)) : null;
      case 'swat': return (this.swatted.get(id) || new Set()).size;
      // Ended early ("End this round", Skip): what they had so far counts.
      default: return this.entries.has(id) ? /** @type {number} */ (this.entries.get(id)) : this.partial.has(id) ? /** @type {number} */ (this.partial.get(id)) : null;
    }
  }

  /** Lower score = better. Returns [id, score][] for everyone who has a valid result. */
  ranking() {
    /** @type {[string, number][]} */
    const rows = [];
    for (const id of this.playerIds()) {
      const v = this.raw(id);
      if (v === null) continue;
      if (this.mini === 'fireflies') rows.push([id, Math.abs(v - this.flies.length)]);
      else if (this.mini === 'roast') { if (v <= this.params.burn) rows.push([id, Math.abs(v - this.params.target)]); }
      else if (MINIS[/** @type {MiniId} */ (this.mini)].better === 'high') { if (v > 0) rows.push([id, -v]); }
      else rows.push([id, v]);
    }
    return rows.sort((a, b) => a[1] - b[1]);
  }

  finish() {
    if (this.phase !== 'mg-play') return;
    this.clearTimer();
    const rank = this.ranking();
    const gained = new Map();
    /** @type {'red'|'blue'|'tie'|null} */
    let winnerTeam = null;
    if (this.teamsOn()) {
      if (this.mini === 'tug') {
        const { red, blue } = this.tugTotals();
        winnerTeam = red === blue ? 'tie' : red > blue ? 'red' : 'blue';
      } else {
        const best = rank[0];
        const tied = best && rank.filter((r) => r[1] === best[1]).map((r) => this.teamOf(r[0]));
        // Nobody has a valid result: nobody scores (as in solo play) — not a 100-each "tie".
        winnerTeam = !best ? null : new Set(tied).size > 1 ? 'tie' : /** @type {'red'|'blue'} */ (this.teamOf(best[0]));
      }
      for (const id of this.playerIds()) {
        const t = this.teamOf(id);
        const pts = !winnerTeam ? 0 : winnerTeam === 'tie' ? 100 : t === winnerTeam ? 200 : 0;
        if (pts) gained.set(id, this.award(id, pts));
      }
    } else {
      const POINTS = [300, 200, 100];
      let r = 0;
      rank.forEach((row, i) => {
        if (i > 0 && row[1] !== rank[i - 1][1]) r = i;
        if (POINTS[r]) gained.set(row[0], this.award(row[0], POINTS[r]));
      });
    }
    /** @type {Record<MiniId, string>} */
    const UNIT = { tug: 'taps', quickdraw: 'ms', fireflies: '', roast: 'ms', skip: 'skips', spot: 'ms', swat: 'swats', balance: '%', paddle: 'strokes', simon: 'ms', stack: 'logs' };
    const valueOf = (/** @type {string} */ id) => {
      if (this.early.has(id)) return this.mini === 'quickdraw' ? 'SPLASH' : this.mini === 'spot' ? 'WRONG BIRD' : 'WRONG';
      const v = this.raw(id);
      return v === null ? '—' : v;
    };
    this.result = {
      winnerTeam,
      answer: this.mini === 'fireflies' ? this.flies.length : this.mini === 'roast' ? this.params.target : null,
      tug: this.mini === 'tug' && this.teamsOn() ? this.tugTotals() : null,
      rows: this.playerIds()
        .map((id) => ({ nickname: this.nick(id), team: this.teamOf(id) || null, value: valueOf(id), unit: UNIT[/** @type {MiniId} */ (this.mini)],
          burnt: this.mini === 'roast' && (this.entries.get(id) || 0) > this.params.burn, gained: gained.get(id) || 0 }))
        .sort((a, b) => b.gained - a.gained),
    };
    this.phase = 'mg-result';
    this.setTimer(RESULT_MS, () => this.nextRound(), false);
    this.push();
  }

  /** @param {string} id */
  onPlayerLeft(id) {
    this.taps.delete(id); this.entries.delete(id); this.reactions.delete(id); this.partial.delete(id);
    if (this.phase !== 'mg-play' || !this.room.players.size) return;
    if (this.mini === 'skip') { if (this.playerIds().every((x) => (this.throws.get(x) || 0) >= 3)) this.finish(); }
    else if (!['tug', 'paddle', 'swat'].includes(String(this.mini))) this.maybeDone();
  }

  /** "End this round" / the TV's Skip during play ends the minigame — not just its current step
   * (a watch or wait step used to only move on to the next step). */
  skip() {
    if (this.phase === 'mg-play' && !this.destroyed) return this.finish();
    super.skip();
  }

  /** Pace votes (hurry / end this round) start over at each step of a minigame. */
  get subject() { return this.sub; }

  destroy() {
    super.destroy();
    if (this.pushTimer) clearTimeout(this.pushTimer);
  }

  common() {
    const m = this.mini ? MINIS[this.mini] : { name: '', rule: '' };
    // Phones get the random parameters they need to draw (the TV keeps the answers it reveals).
    const p = this.params;
    /** @type {Record<string, unknown>} */
    const pub = this.mini === 'roast' ? { target: p.target } : this.mini === 'skip' ? { period: p.period, sweet: p.sweet, zone: p.zone }
      : this.mini === 'swat' ? { bugs: p.bugs } : this.mini === 'balance' ? { ax: p.ax, ay: p.ay, px: p.px, py: p.py, radius: p.radius }
        : this.mini === 'stack' ? { speed: p.speed, speedUp: p.speedUp } : this.mini === 'spot' ? { cells: SPOT_CELLS } : this.mini === 'simon' ? { colours: COLOURS, length: (p.seq || []).length } : {};
    // Marshmallow Roast hides the clock: no countdown on the TV or the phones while roasting.
    const noClock = this.mini === 'roast' && this.phase === 'mg-play' ? { endsAt: null } : {};
    return { mini: this.mini, miniName: m.name, rule: m.rule, sub: this.sub, teams: this.teamsOn(), playStart: this.phase === 'mg-play' ? this.playStart : null, ...pub, ...noClock };
  }

  hostView() {
    const c = this.common();
    if (this.phase === 'mg-result') return { ...c, result: this.result };
    if (this.phase === 'mg-play' && (this.mini === 'tug' || this.mini === 'paddle')) {
      return this.teamsOn() && this.mini === 'tug'
        ? { ...c, tug: { ...this.tugTotals(), goal: this.tugGoal() } }
        : { ...c, taps: this.playerIds().map((id) => ({ nickname: this.nick(id), taps: this.taps.get(id) || 0 })).sort((a, b) => b.taps - a.taps) };
    }
    if (this.phase === 'mg-play' && this.mini === 'fireflies' && this.sub === 'show') return { ...c, flies: this.flies };
    if (this.phase === 'mg-play' && this.mini === 'spot') return { ...c, loon: this.params.loon, ducks: this.params.ducks, doneCount: this.reactions.size + this.early.size, totalPlayers: this.room.players.size };
    if (this.phase === 'mg-play' && this.mini === 'simon' && this.sub === 'show') return { ...c, seq: this.params.seq, showMs: SHOW_MS };
    if (this.phase === 'mg-play' && this.mini === 'swat') return { ...c, board: this.playerIds().map((id) => ({ nickname: this.nick(id), n: (this.swatted.get(id) || new Set()).size })).sort((a, b) => b.n - a.n) };
    if (this.phase === 'mg-play' && this.mini === 'skip') return { ...c, board: this.playerIds().map((id) => ({ nickname: this.nick(id), n: this.entries.get(id) || 0, throws: this.throws.get(id) || 0 })).sort((a, b) => b.n - a.n) };
    return { ...c, doneCount: this.entries.size + this.reactions.size + this.early.size, totalPlayers: this.room.players.size };
  }

  /** @param {string} id */
  playerOnly(id) {
    const c = this.common();
    if (this.phase === 'mg-result') return { gameState: { ...c, result: this.result }, you: { gained: ((this.result && this.result.rows.find((/** @type {{ nickname: string }} */ r) => r.nickname === this.nick(id))) || { gained: 0 }).gained || 0 } };
    return {
      gameState: c,
      you: {
        team: this.teamOf(id) || null,
        early: this.early.has(id),
        done: (this.entries.has(id) && this.mini !== 'skip') || this.reactions.has(id) || (this.mini === 'skip' && (this.throws.get(id) || 0) >= 3),
        throws: this.throws.get(id) || 0,
        skips: this.mini === 'skip' ? this.entries.get(id) || 0 : null,
        lastSkips: this.mini === 'skip' ? this.lastThrow.get(id) ?? null : null,
        swats: this.mini === 'swat' ? [...(this.swatted.get(id) || [])] : null,
      },
    };
  }
}

MinigamesGame.meta = {
  id: 'minigames',
  name: 'Cottage Olympics',
  blurb: 'Eleven quick real-time phone challenges — tap, react, count, roast, swat, paddle, stack. Best with Teams on!',
  minPlayers: 2,
};
MinigamesGame.MINIS = MINIS;
MinigamesGame.swing = swing;
MinigamesGame.skipsFor = skipsFor;

module.exports = MinigamesGame;
