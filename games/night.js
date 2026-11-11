/*
 * Game night: a playlist of N games. Between games the phones vote on what's
 * next (3 options); each game's placings earn night points (F1-style, so games
 * with different scoring scales are fair) and the night ends with a grand
 * champion. This module is the "between games" screen; server.js runs the
 * playlist (room.night) and counts points at every game over. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame } = require('./base');

const VOTE_MS = parseInt(process.env.RUMPUS_NIGHT_VOTE_MS || '20000', 10);
const PICK_MS = parseInt(process.env.RUMPUS_NIGHT_PICK_MS || '3000', 10);
/** Night points by placing in each game (ties share the better placing). */
const PLACE_POINTS = [10, 6, 4, 3, 2, 1];

/**
 * @typedef {{ total: number, played: string[], points: Map<string, number>, timer?: NodeJS.Timeout | null }} Night
 * @typedef {{ id: string, name: string, minPlayers: number }} GameMeta
 */

class NightGame extends BaseGame {
  /**
   * @param {Room} room @param {() => void} push
   * @param {{ options: GameMeta[], final: boolean, onPick: (id: string) => void }} opts
   */
  constructor(room, push, opts) {
    super(room, push);
    this.doubleFinal = false;
    this.options = opts.options;
    this.final = opts.final;
    this.onPick = opts.onPick;
    /** @type {Map<string, number>} */
    this.votes = new Map();
    /** @type {number | null} */
    this.chosen = null;
  }

  start() {
    if (this.final) { this.phase = 'night-final'; this.push(); return; }
    this.phase = 'night-vote';
    this.setTimer(VOTE_MS, () => this.decide());
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase !== 'night-vote' || this.votes.has(id)) return;
    const c = payload.choice;
    if (!Number.isInteger(c) || c < 0 || c >= this.options.length) return;
    this.votes.set(id, c);
    if (this.allIn(this.votes)) this.decide();
    else this.push();
  }

  tally() {
    const t = this.options.map(() => 0);
    for (const c of this.votes.values()) t[c] += 1;
    return t;
  }

  decide() {
    if (this.phase !== 'night-vote') return;
    const t = this.tally();
    const best = Math.max(...t);
    const top = t.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0);
    this.chosen = top[this.rng.int(0, top.length - 1)];
    this.phase = 'night-pick';
    this.setTimer(PICK_MS, () => this.onPick(this.options[/** @type {number} */ (this.chosen)].id), false);
    this.push();
  }

  onPlayerLeft() {
    if (this.phase === 'night-vote' && this.room.players.size && this.allIn(this.votes)) this.decide();
  }

  hostView() {
    return { options: this.options, tally: this.tally(), chosen: this.chosen, votedCount: this.votes.size, totalPlayers: this.room.players.size };
  }

  /** @param {string} id */
  playerOnly(id) {
    return { gameState: { options: this.options, chosen: this.chosen }, you: { voted: this.votes.has(id) } };
  }
}

NightGame.meta = { id: 'night', name: 'Game night', blurb: 'A playlist of games with a running leaderboard.', minPlayers: 2, lateJoin: true };

/**
 * Night points for one finished game. @param {{ id: string, score: number }[]} players
 * @returns {Map<string, number>}
 */
function placePoints(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const out = new Map();
  sorted.forEach((p, i) => {
    // Ties share the better placing.
    const place = sorted.findIndex((q) => q.score === p.score);
    out.set(p.id, i < sorted.length && p.score > 0 ? PLACE_POINTS[place] || 0 : 0);
  });
  return out;
}

module.exports = { NightGame, placePoints, PLACE_POINTS };
