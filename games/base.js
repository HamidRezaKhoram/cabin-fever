/*
 * Shared plumbing for Rumpus game modules: timers (scaled by host settings),
 * skip support, standings, content-pack loading. AGPLv3 — see LICENSE.
 */
'use strict';

const house = require('./house');

const fs = require('fs');
const path = require('path');
const flow = require('./flow');
const { makeRng, newSeed } = require('./rng');

const CONTENT_DIR = process.env.RUMPUS_CONTENT_DIR || path.join(__dirname, '..', 'content');

// Merge a built-in list with an optional content/<name>.json array, so people
// can add their own prompts without rebuilding the image (mount ./content).
/** @template T @param {string} name @param {T[]} builtin @returns {T[]} */
function loadContent(name, builtin) {
  const file = path.join(CONTENT_DIR, `${name}.json`);
  try {
    const extra = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(extra) && extra.length) {
      const mode = process.env.RUMPUS_CONTENT_MODE === 'replace' ? 'replace' : 'append';
      return mode === 'replace' ? extra : builtin.concat(extra);
    }
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code !== 'ENOENT') console.warn(`[content] could not load ${file}: ${e.message}`);
  }
  return builtin;
}

/** Run a timer's work; a bug in one game is logged instead of crashing the server (a throw in a
 * timer is an uncaught exception). With a game, its `onGlitch` hook is told too, so the TV can say
 * "something went wrong — press Skip" instead of sitting silently.
 * @param {() => void} fn @param {string} what
 * @param {{ onGlitch?: ((what: string, e: unknown) => void) | null, timerFn?: (() => void) | null, endsAt?: number | null }} [game]
 * @param {boolean} [retry] a phase timer: on a throw, leave it pending so Skip can retry it */
function guarded(fn, what, game, retry = false) {
  try { fn(); } catch (e) {
    console.error(`[game] ${what} failed:`, e);
    // A phase timer threw before setting the next one: keep it as the pending timer, so the TV's
    // Skip (and the phones' vote) can try it again instead of the screen sitting there for good.
    if (retry && game && !game.timerFn) { game.timerFn = fn; game.endsAt = Date.now(); }
    if (game && game.onGlitch) { try { game.onGlitch(what, e); } catch (e2) { /* never throw from here */ } }
  }
}

/** Player text: trimmed, single-spaced, capped, house-rule banned words masked. */
/** @param {unknown} v @param {number} [max] */
function cleanText(v, max = 120) {
  return typeof v === 'string' ? house.mask(v.trim().replace(/\s+/g, ' ').slice(0, max)) : '';
}

/** @implements {GameLike} */
class BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    /** @type {number} */ this.totalRounds = 0;
    /** @type {boolean | undefined} game has no rounds of its own → always ×1 */ this.doubleFinal = undefined;
    /** @type {number} */ this.skipSeq = 0;
    this.room = room;
    this.push = push;
    /** @type {Partial<RoomSettings>} */
    this.settings = room.settings || {};
    this.phase = 'starting';
    this.round = 0;
    this.timer = null;
    this.timerFn = null;
    this.endsAt = null;
    this.destroyed = false;
    /** @type {((what: string, e: unknown) => void) | null} set by the room: a game error reached the TV */ this.onGlitch = null;
    /** Every random choice in this game comes from here (seeded, replayable: see games/rng.js). */
    this.seed = newSeed();
    this.rng = makeRng(this.seed);
  }

  /** @param {number} def */
  rounds(def) {
    return this.settings.rounds || def;
  }

  destroy() {
    this.destroyed = true;
    this.clearTimer();
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerFn = null;
    this.endsAt = null;
  }

  // Phase timers scale with the host's "timer speed"; reveal/results pauses
  // pass scale=false so they stay snappy.
  /** @param {number} ms @param {() => void} fn @param {boolean} [scale] */
  setTimer(ms, fn, scale = true) {
    this.clearTimer();
    const id = /** @type {any} */ (this.constructor).meta ? /** @type {any} */ (this.constructor).meta.id : '';
    const real = Math.round(scale ? ms * (this.settings.timerScale || 1) * house.timerFor(id) : ms);
    this.endsAt = Date.now() + real;
    this.timerFn = fn;
    /** whether the pending timer was scaled (flow.hurry keeps it that way) */
    this.timerScaled = scale;
    // Small grace so phones that auto-submit at 0s still make it in.
    this.timer = setTimeout(() => {
      if (this.destroyed) return;
      this.timer = null;
      this.timerFn = null;
      guarded(fn, `${id} timer`, this, true);
    }, real + (scale ? 1200 : 0));
  }

  // Host pressed "skip": fire the pending timer right now.
  skip() {
    if (!this.timerFn || this.destroyed) return;
    const fn = this.timerFn;
    this.clearTimer();
    fn();
  }

  /** @param {string} id */
  player(id) {
    return this.room.players.get(id);
  }

  /** @param {string} id */
  nick(id) {
    const p = this.room.players.get(id);
    return p ? p.nickname : '(left)';
  }

  // Escalating stakes: first half ×1, second half ×2, final question ×3.
  // Games without rounds of their own (doubleFinal = false) always score ×1.
  mult() {
    return this.doubleFinal === false ? 1 : flow.stage(this.round, this.totalRounds);
  }

  isFinal() {
    return this.mult() > 1;
  }

  // Majority voted to skip: replay this round with fresh content.
  skipQuestion() {
    if (!(this.skippablePhases || []).includes(this.phase)) return;
    this.skipSeq = (this.skipSeq || 0) + 1;
    this.clearTimer();
    this.round -= 1;
    this.nextRound();
  }

  // Returns the points actually awarded (after the final-round multiplier).
  /** @param {string} id @param {number} pts */
  award(id, pts) {
    const p = this.room.players.get(id);
    const real = pts * this.mult();
    if (p) p.score += real;
    return real;
  }

  spicy() {
    return this.settings.spicy !== false;
  }

  playerIds() {
    return [...this.room.players.keys()];
  }

  /** Who may be singled out (voted the answer, sent a note): everyone but the 🙈 "leave me out"
   * players — unless that leaves fewer than two, then everyone (the game must stay playable). */
  targetIds() {
    const ok = this.playerIds().filter((id) => !(this.room.players.get(id) || {}).shy);
    return ok.length >= 2 ? ok : this.playerIds();
  }
  /** @param {string} id */
  targetable(id) {
    return this.targetIds().includes(id);
  }

  // True once every *currently present* player has an entry in `set` (a Map/Set
  // keyed by playerId), optionally excluding some ids.
  /** @param {{ has(id: string): boolean }} set @param {string[]} [exclude] */
  allIn(set, exclude = []) {
    const ex = new Set(exclude);
    return this.playerIds().every((id) => ex.has(id) || set.has(id));
  }

  standings() {
    return [...this.room.players.values()]
      .map((p) => ({ nickname: p.nickname, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  gameOver() {
    this.phase = 'gameover';
    this.clearTimer();
    this.push();
  }

  base() {
    return {
      gameId: /** @type {any} */ (this.constructor).meta.id,
      round: this.round,
      totalRounds: this.totalRounds,
      endsAt: this.endsAt,
      doublePoints: this.mult() > 1,
      multiplier: this.mult(),
      stage: this.doubleFinal === false ? 0 : flow.stage(this.round, this.totalRounds),
      skipSeq: this.skipSeq || 0,
    };
  }

  /** Real-time games stream compact frames to the TV only (set by the server). @param {Record<string, any>} data */
  frame(data) {}

  // ---- implemented by each game -------------------------------------------
  /** @returns {string[]} phases where a majority may vote to skip the question */
  get skippablePhases() { return []; }
  start() {}
  nextRound() {}
  /** @param {string} id @param {Record<string, any>} payload */ handleSubmit(id, payload) {}  
  /** @param {string} id */ onPlayerLeft(id) {}  
  /** @returns {Record<string, any>} */ hostView() { return {}; }
  /** @param {string} id @returns {{ gameState?: Record<string, any>, you?: Record<string, any> }} */ playerOnly(id) { return {}; }  
  hostGameState() {
    if (this.phase === 'gameover') return { ...this.base(), standings: this.standings() };
    return { ...this.base(), ...this.hostView() };
  }

  /** @param {string} id */
  playerView(id) {
    if (this.phase === 'gameover') {
      return { gameState: { ...this.base(), standings: this.standings() }, you: {} };
    }
    const v = this.playerOnly(id) || {};
    return { gameState: { ...this.base(), ...(v.gameState || {}) }, you: v.you || {} };
  }
}

module.exports = { BaseGame, loadContent, cleanText, guarded };
