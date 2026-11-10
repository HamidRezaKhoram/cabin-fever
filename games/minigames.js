/*
 * "Minigame Mayhem" — a series of short real-time phone challenges.
 * Team mode (Red vs Blue) when teams are on, otherwise every player for themselves.
 * The server is the referee: tap rates are capped and reaction times are measured on
 * the server clock (it's a local network, so latency is a few ms).
 * AGPLv3 — see LICENSE.
 */
'use strict';

const crypto = require('crypto');
const { BaseGame, shuffle } = require('./base');

const env = (k, d) => parseInt(process.env[k] || String(d), 10);
const INTRO_MS = env('RUMPUS_MG_INTRO_MS', 3500);
const RESULT_MS = env('RUMPUS_MG_RESULT_MS', 6000);
const TUG_MS = env('RUMPUS_MG_TUG_MS', 15000);
const DRAW_WAIT_MIN = env('RUMPUS_MG_DRAW_MIN', 2000);
const DRAW_WAIT_MAX = env('RUMPUS_MG_DRAW_MAX', 5000);
const DRAW_WINDOW_MS = env('RUMPUS_MG_DRAW_WINDOW', 4000);
const FLY_SHOW_MS = env('RUMPUS_MG_FLY_SHOW_MS', 5000);
const FLY_GUESS_MS = env('RUMPUS_MG_FLY_GUESS_MS', 10000);
const ROAST_MS = env('RUMPUS_MG_ROAST_MS', 12000);
const ROAST_TARGET = 3000;
const ROAST_BURN = 3600;
const MAX_TAPS_PER_SEC = 15;

/** @typedef {'tug'|'quickdraw'|'fireflies'|'roast'} MiniId */
/** @type {Record<MiniId, { name: string, rule: string }>} */
const MINIS = {
  tug: { name: 'Tug of Lake', rule: 'TAP AS FAST AS YOU CAN!' },
  quickdraw: { name: 'Quick Draw', rule: 'Wait for GO… then tap first. Too early = SPLASH!' },
  fireflies: { name: 'Firefly Count', rule: 'Count the fireflies on the TV. Closest guess wins.' },
  roast: { name: 'Marshmallow Roast', rule: 'Hold to roast. Let go at 3 seconds. Too long = burnt!' },
};
const ORDER = /** @type {MiniId[]} */ ((process.env.RUMPUS_MG_ORDER || '').split(',').filter((x) => x in MINIS));

class MinigamesGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(6);
    this.noPaceVotes = true;
    /** @type {MiniId[]} */
    this.queue = [];
    /** @type {MiniId | null} */
    this.mini = null;
    this.sub = '';
    /** @type {Map<string, number>} taps (tug) */
    this.taps = new Map();
    /** @type {Map<string, number>} */
    this.firstTapAt = new Map();
    /** @type {Map<string, number>} reaction ms (quickdraw) */
    this.reactions = new Map();
    /** @type {Set<string>} */
    this.early = new Set();
    /** @type {Map<string, number>} number guesses / hold ms */
    this.entries = new Map();
    this.goAt = 0;
    this.playStart = 0;
    /** @type {{x:number,y:number,d:number}[]} */
    this.flies = [];
    this.result = null;
    this.pushTimer = null;
  }

  teamsOn() { return !!(this.room.settings && this.room.settings.teams); }
  /** @param {string} id */
  teamOf(id) { const p = this.room.players.get(id); return p && p.team; }

  start() { this.nextRound(); }

  nextMini() {
    if (ORDER.length) return ORDER[(this.round - 1) % ORDER.length];
    if (!this.queue.length) this.queue = shuffle(/** @type {MiniId[]} */ (Object.keys(MINIS)));
    if (this.queue[0] === this.mini && this.queue.length > 1) this.queue.push(/** @type {MiniId} */ (this.queue.shift()));
    return /** @type {MiniId} */ (this.queue.shift());
  }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    this.mini = this.nextMini();
    this.taps = new Map(); this.firstTapAt = new Map(); this.reactions = new Map();
    this.early = new Set(); this.entries = new Map(); this.result = null; this.sub = '';
    this.phase = 'mg-intro';
    this.setTimer(INTRO_MS, () => this.play(), false);
    this.push();
  }

  play() {
    this.phase = 'mg-play';
    this.playStart = Date.now();
    if (this.mini === 'tug') {
      this.sub = 'go';
      this.setTimer(TUG_MS, () => this.finish(), false);
    } else if (this.mini === 'quickdraw') {
      this.sub = 'wait';
      const wait = DRAW_WAIT_MIN + crypto.randomInt(Math.max(1, DRAW_WAIT_MAX - DRAW_WAIT_MIN));
      this.setTimer(wait, () => {
        this.sub = 'go';
        this.goAt = Date.now();
        this.setTimer(DRAW_WINDOW_MS, () => this.finish(), false);
        this.push();
      }, false);
    } else if (this.mini === 'fireflies') {
      this.sub = 'show';
      const n = 12 + crypto.randomInt(29);
      this.flies = Array.from({ length: n }, () => ({ x: 4 + crypto.randomInt(92), y: 6 + crypto.randomInt(86), d: crypto.randomInt(10) }));
      this.setTimer(FLY_SHOW_MS, () => {
        this.sub = 'guess';
        this.setTimer(FLY_GUESS_MS, () => this.finish(), false);
        this.push();
      }, false);
    } else {
      this.sub = 'go';
      this.setTimer(ROAST_MS, () => this.finish(), false);
    }
    this.push();
  }

  // Throttled push (10/s) for rapid tap updates.
  pushSoon() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => { this.pushTimer = null; if (!this.destroyed) this.push(); }, 100);
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase !== 'mg-play') return;
    const now = Date.now();
    if (this.mini === 'tug' && Number.isInteger(payload.tap) && payload.tap > 0) {
      // Rate cap: no more than MAX_TAPS_PER_SEC since the start (+ a little burst).
      const allowed = Math.floor(((now - this.playStart) / 1000) * MAX_TAPS_PER_SEC) + 5;
      const have = this.taps.get(id) || 0;
      this.taps.set(id, Math.min(allowed, have + Math.min(payload.tap, 20)));
      if (this.teamsOn()) {
        const { red, blue } = this.tugTotals();
        const need = this.tugGoal();
        if (Math.abs(red - blue) >= need) return this.finish();
      }
      this.pushSoon();
    } else if (this.mini === 'quickdraw' && payload.tap) {
      if (this.early.has(id) || this.reactions.has(id)) return;
      if (this.sub === 'wait') this.early.add(id);
      else this.reactions.set(id, now - this.goAt);
      if (this.playerIds().every((p) => this.early.has(p) || this.reactions.has(p))) return this.finish();
      this.push();
    } else if (this.mini === 'fireflies' && this.sub === 'guess') {
      const n = Number(payload.number);
      if (!Number.isFinite(n) || n < 0 || n > 999 || this.entries.has(id)) return;
      this.entries.set(id, Math.round(n));
      if (this.allIn(this.entries)) return this.finish();
      this.push();
    } else if (this.mini === 'roast') {
      const ms = Number(payload.hold);
      if (!Number.isFinite(ms) || ms < 0 || ms > 20000 || this.entries.has(id)) return;
      this.entries.set(id, Math.round(ms));
      if (this.allIn(this.entries)) return this.finish();
      this.push();
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

  /** Lower score = better. Returns [id, score][] for everyone who has a valid result. */
  ranking() {
    /** @type {[string, number][]} */
    let rows = [];
    if (this.mini === 'tug') rows = this.playerIds().map((id) => [id, -(this.taps.get(id) || 0)]);
    else if (this.mini === 'quickdraw') rows = [...this.reactions.entries()];
    else if (this.mini === 'fireflies') rows = [...this.entries.entries()].map(([id, n]) => [id, Math.abs(n - this.flies.length)]);
    else rows = [...this.entries.entries()].filter(([, ms]) => ms <= ROAST_BURN).map(([id, ms]) => [id, Math.abs(ms - ROAST_TARGET)]);
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
        winnerTeam = !best ? 'tie' : new Set(tied).size > 1 ? 'tie' : /** @type {'red'|'blue'} */ (this.teamOf(best[0]));
      }
      for (const id of this.playerIds()) {
        const t = this.teamOf(id);
        const pts = winnerTeam === 'tie' ? 100 : t === winnerTeam ? 200 : 0;
        if (pts) gained.set(id, this.award(id, pts));
      }
    } else {
      const POINTS = [300, 200, 100];
      let r = 0;
      rank.forEach((row, i) => {
        if (i > 0 && row[1] !== rank[i - 1][1]) r = i;
        if (POINTS[r] && !(this.mini === 'tug' && row[1] === 0)) gained.set(row[0], this.award(row[0], POINTS[r]));
      });
    }
    const unit = this.mini === 'tug' ? 'taps' : this.mini === 'quickdraw' ? 'ms' : this.mini === 'fireflies' ? '' : 'ms';
    const valueOf = (/** @type {string} */ id) => this.mini === 'tug' ? (this.taps.get(id) || 0)
      : this.mini === 'quickdraw' ? (this.early.has(id) ? 'SPLASH' : this.reactions.has(id) ? this.reactions.get(id) : '—')
        : this.entries.has(id) ? this.entries.get(id) : '—';
    this.result = {
      winnerTeam,
      answer: this.mini === 'fireflies' ? this.flies.length : this.mini === 'roast' ? ROAST_TARGET : null,
      tug: this.mini === 'tug' && this.teamsOn() ? this.tugTotals() : null,
      rows: this.playerIds()
        .map((id) => ({ nickname: this.nick(id), team: this.teamOf(id) || null, value: valueOf(id), unit,
          burnt: this.mini === 'roast' && (this.entries.get(id) || 0) > ROAST_BURN, gained: gained.get(id) || 0 }))
        .sort((a, b) => b.gained - a.gained),
    };
    this.phase = 'mg-result';
    this.setTimer(RESULT_MS, () => this.nextRound(), false);
    this.push();
  }

  /** @param {string} id */
  onPlayerLeft(id) {
    this.taps.delete(id); this.entries.delete(id); this.reactions.delete(id);
    if (this.phase === 'mg-play' && this.room.players.size && this.mini !== 'tug'
      && this.playerIds().every((p) => this.entries.has(p) || this.reactions.has(p) || this.early.has(p))) this.finish();
  }

  destroy() {
    super.destroy();
    if (this.pushTimer) clearTimeout(this.pushTimer);
  }

  common() {
    const m = this.mini ? MINIS[this.mini] : { name: '', rule: '' };
    return { mini: this.mini, miniName: m.name, rule: m.rule, sub: this.sub, teams: this.teamsOn() };
  }

  hostView() {
    const c = this.common();
    if (this.phase === 'mg-result') return { ...c, result: this.result };
    if (this.phase === 'mg-play' && this.mini === 'tug') {
      return this.teamsOn()
        ? { ...c, tug: { ...this.tugTotals(), goal: this.tugGoal() } }
        : { ...c, taps: this.playerIds().map((id) => ({ nickname: this.nick(id), taps: this.taps.get(id) || 0 })).sort((a, b) => b.taps - a.taps) };
    }
    if (this.phase === 'mg-play' && this.mini === 'fireflies' && this.sub === 'show') return { ...c, flies: this.flies };
    return { ...c, doneCount: this.entries.size + this.reactions.size + this.early.size, totalPlayers: this.room.players.size };
  }

  /** @param {string} id */
  playerOnly(id) {
    const c = this.common();
    if (this.phase === 'mg-result') return { gameState: { ...c, result: this.result }, you: { gained: (this.result.rows.find((r) => r.nickname === this.nick(id)) || {}).gained || 0 } };
    return {
      gameState: c,
      you: {
        team: this.teamOf(id) || null,
        early: this.early.has(id),
        done: this.entries.has(id) || this.reactions.has(id),
      },
    };
  }
}

MinigamesGame.meta = {
  id: 'minigames',
  name: 'Minigame Mayhem',
  blurb: 'Quick real-time phone challenges — tap, react, count, roast. Best with Teams on!',
  minPlayers: 2,
};
MinigamesGame.MINIS = MINIS;

module.exports = MinigamesGame;
