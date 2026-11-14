/*
 * The lineup: the host picks games in an order and they play back to back. Between games the TV
 * shows the next game's cartridge ("NEXT GAME", NEXT_MS); each game's placings earn lineup points
 * (F1-style, so games with different scoring scales are fair) and the lineup ends with a champion.
 * This module is the "between games" screen; core/rooms.js runs the list (room.night) and counts
 * points at every game over. AGPLv3 — see LICENSE.
 */
'use strict';
const { BaseGame } = require('./base');

const NEXT_MS = parseInt(process.env.RUMPUS_NIGHT_NEXT_MS || '5000', 10);
/** Lineup points by placing in each game (ties share the better placing). */
const PLACE_POINTS = [10, 6, 4, 3, 2, 1];

/**
 * @typedef {{ total: number, list: string[], played: string[], points: Map<string, number>, timer?: NodeJS.Timeout | null, nextAt?: number, skipped?: number[], won?: boolean }} Night
 * @typedef {{ id: string, name: string, minPlayers: number }} GameMeta
 */

class NightGame extends BaseGame {
  /**
   * @param {Room} room @param {() => void} push
   * @param {{ next: GameMeta | null, final: boolean, onPick: (id: string) => void }} opts
   */
  constructor(room, push, opts) {
    super(room, push);
    this.doubleFinal = false;
    this.next = opts.next;
    this.final = opts.final || !opts.next;
    this.onPick = opts.onPick;
  }

  start() {
    if (this.final) { this.phase = 'night-final'; this.push(); return; }
    // The next cartridge, centre screen, for a few seconds — then it starts.
    this.phase = 'night-next';
    const next = /** @type {GameMeta} */ (this.next);
    this.setTimer(NEXT_MS, () => this.onPick(next.id), false);
    this.push();
  }

  hostView() { return { next: this.next }; }

  /** @param {string} id */
  playerOnly(id) { void id; return { gameState: { next: this.next }, you: {} }; }
}

NightGame.meta = { id: 'night', name: 'Lineup', blurb: 'Games back to back in your order, with a running leaderboard.', minPlayers: 1, lateJoin: true };

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
