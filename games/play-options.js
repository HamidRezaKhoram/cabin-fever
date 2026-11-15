/*
 * Per-game choices for the TV menu: how long a game is (its rounds, in its own words) and whether the
 * timer setting means anything for it. ⚙ Settings holds the room-wide default; a game's own choice
 * (the menu's description box) overrides it for that game only. AGPLv3 — see LICENSE.
 *
 * - `rounds`: null when the game sets its own length (one step per player, a fixed number of chores).
 *   `def` is the game's normal length; `opts` the lengths that make sense for it.
 * - `timed`: false for real-time games (tap races, rhythm, steering): their clocks ARE the game, so
 *   "relaxed" or "fast" answer timers don't apply.
 */
'use strict';

/** @typedef {{ rounds: { def: number, opts: number[], unit: string } | null, timed: boolean }} PlayOptions */

/** @type {Record<string, PlayOptions>} */
const PLAY = {
  quiplash: { rounds: { def: 2, opts: [1, 2, 3], unit: 'rounds' }, timed: true },
  cah: { rounds: { def: 8, opts: [3, 5, 8, 10, 12], unit: 'rounds' }, timed: true },
  fibbage: { rounds: { def: 5, opts: [3, 5, 8], unit: 'questions' }, timed: true },
  trivia: { rounds: { def: 10, opts: [5, 10, 15, 20], unit: 'questions' }, timed: true },
  closest: { rounds: { def: 10, opts: [5, 8, 10, 15], unit: 'questions' }, timed: true },
  majority: { rounds: { def: 6, opts: [4, 6, 8, 10], unit: 'questions' }, timed: true },
  mostlikely: { rounds: { def: 10, opts: [5, 8, 10, 15], unit: 'questions' }, timed: true },
  imposter: { rounds: { def: 3, opts: [2, 3, 4, 5], unit: 'rounds' }, timed: true },
  crush: { rounds: { def: 4, opts: [2, 3, 4, 5, 6], unit: 'evenings' }, timed: true },
  twotruths: { rounds: { def: 3, opts: [1, 2, 3], unit: 'rounds' }, timed: true },
  telephone: { rounds: null, timed: true }, // one step per player
  storm: { rounds: null, timed: true }, // five chores
  minigames: { rounds: { def: 9, opts: [3, 5, 7, 9, 11], unit: 'challenges' }, timed: false },
  lantern: { rounds: { def: 4, opts: [2, 3, 4, 5, 6], unit: 'races' }, timed: false },
  looncall: { rounds: { def: 3, opts: [1, 2, 3], unit: 'songs' }, timed: false },
};

/** The answer-timer choices (⚙ Settings and per game). */
const TIMER_SCALES = [0.6, 1, 1.5, 2];

/** @param {string} id @returns {PlayOptions} */
function playOptions(id) { return PLAY[id] || { rounds: null, timed: true }; }

/**
 * How many rounds a game plays: its own choice, else the room-wide one (kept within what this game
 * offers), else its default. @param {string} id @param {Partial<RoomSettings>} settings @param {number} def
 */
function roundsFor(id, settings, def) {
  const own = settings.perGame && settings.perGame[id] && settings.perGame[id].rounds;
  if (own) return own;
  const all = settings.rounds;
  if (!all) return def;
  const r = playOptions(id).rounds;
  return r ? Math.max(1, Math.min(r.opts[r.opts.length - 1], all)) : all;
}

/** The timer scale a game runs with (1 for real-time games). @param {string} id @param {Partial<RoomSettings>} settings */
function timerScaleFor(id, settings) {
  if (!playOptions(id).timed) return 1;
  const own = settings.perGame && settings.perGame[id] && settings.perGame[id].timerScale;
  return own || settings.timerScale || 1;
}

module.exports = { PLAY, TIMER_SCALES, playOptions, roundsFor, timerScaleFor };
