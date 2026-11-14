/*
 * "Closest Cast" — numeric estimation. Nearest guess wins the most points.
 * AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame } = require('./base');
const library = require('./library');

// { q, answer, unit? } — keep answers to well-established facts.
const BUILTIN = [
  { q: 'How many keys are on a standard piano?', answer: 88 },
  { q: 'In what year was the first iPhone released?', answer: 2007 },
  { q: 'How many bones are in the adult human body?', answer: 206 },
  { q: 'How tall is Mount Everest, in metres?', answer: 8849, unit: 'm' },
  { q: 'How many member states are in the United Nations?', answer: 193 },
  { q: 'What is the boiling point of water at sea level, in °F?', answer: 212, unit: '°F' },
  { q: 'How many minutes are in a week?', answer: 10080 },
  { q: 'In what year did the Berlin Wall fall?', answer: 1989 },
  { q: 'How many hearts does an octopus have?', answer: 3 },
  { q: 'Average distance from Earth to the Moon, in km?', answer: 384400, unit: 'km' },
  { q: 'In what year did humans first land on the Moon?', answer: 1969 },
  { q: 'How many teeth does a full adult set have (including wisdom teeth)?', answer: 32 },
  { q: 'Speed of light, in km per second (roughly)?', answer: 299792, unit: 'km/s' },
  { q: 'In what year did Canada become a country (Confederation)?', answer: 1867 },
  { q: 'How many Earth days does it take Mars to orbit the Sun?', answer: 687 },
  { q: 'How tall is the CN Tower, in metres?', answer: 553, unit: 'm' },
  { q: 'How many time zones does Russia span?', answer: 11 },
  { q: 'In what year did the Titanic sink?', answer: 1912 },
  { q: 'How many elements are on the periodic table?', answer: 118 },
  { q: 'How many seconds are in a day?', answer: 86400 },
  { q: 'How many dots are on a standard six-sided die (all faces)?', answer: 21 },
  { q: 'How long is a marathon, in kilometres?', answer: 42.195, unit: 'km' },
  { q: 'How many symphonies did Beethoven complete?', answer: 9 },
  { q: 'How many squares are on a chessboard?', answer: 64 },
  { q: 'How many players per side are on the ice in hockey (including the goalie)?', answer: 6 },
  { q: 'In what year was the World Wide Web invented (first proposal)?', answer: 1989 },
  { q: 'How many countries are in Africa?', answer: 54 },
  { q: 'How many litres are in one US gallon?', answer: 3.785, unit: 'L' },
  { q: 'How many weeks are in a year? (to one decimal)', answer: 52.1 },
  { q: 'How many moons does Mars have?', answer: 2 },
  { q: 'What is normal human body temperature, in °C?', answer: 37, unit: '°C' },
  { q: 'In what year did the first Star Wars movie come out?', answer: 1977 },
  { q: 'How many strings does a standard violin have?', answer: 4 },
  { q: 'How many provinces does Canada have?', answer: 10 },
  { q: 'How many sides does a stop sign have?', answer: 8 },
];

const GUESS_MS = parseInt(process.env.RUMPUS_CG_GUESS_MS || '30000', 10);
const REVEAL_MS = parseInt(process.env.RUMPUS_REVEAL_MS || '8000', 10);
const DOUBLE_RISK = 200; // lost on a Double Down that doesn't finish in the top half
const RANK_POINTS = [300, 200, 100];

class ClosestGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(10);
    /** @type {{ q: string, answer: number, unit?: string, src?: string }} */
    this.q = BUILTIN[0];
    /** @type {Map<string, number>} */
    this.guesses = new Map();
    /** @type {{ answer: number, unit: string, list: { nickname: string, guess: number, off: number, rank: number, exact: boolean, gained: number, double: boolean }[] } | null} */
    this.result = null;
    this.poolName = 'closest';
    /** @type {any} */
    this.item = null;
    /** @type {Set<string>} players who've used their one Double Down this game */
    this.doubled = new Set();
    /** @type {Set<string>} doubling this round */
    this.doubling = new Set();
  }

  start() { this.nextRound(); }

  /** Where the game is, for a TV reload / server restart (core/rooms.js snapshot; todo 2.1). */
  save() {
    return { round: this.round, totalRounds: this.totalRounds, q: this.q, phase: this.phase, doubled: [...this.doubled] };
  }
  /** Pick a saved game up: the current question is asked again (fresh clock); a finished one moves on.
   * @param {any} d */
  resume(d) {
    this.totalRounds = Number(d.totalRounds) || this.totalRounds;
    this.round = Math.max(0, Number(d.round) || 0);
    this.doubled = new Set(Array.isArray(d.doubled) ? d.doubled.map(String) : []);
    if (d.phase !== 'cg-guess' || !d.q || typeof d.q.q !== 'string' || !Number.isFinite(Number(d.q.answer))) return this.nextRound();
    this.q = d.q;
    this.item = this.q;
    this.guesses = new Map();
    this.result = null;
    this.doubling = new Set();
    this.phase = 'cg-guess';
    this.setTimer(GUESS_MS, () => this.reveal());
    this.push();
  }

  get skippablePhases() { return ['cg-guess']; }

  /** A skipped question gives back the Double Downs played on it (it never counted). */
  skipQuestion() {
    if (this.phase === 'cg-guess') for (const id of this.doubling) this.doubled.delete(id);
    super.skipQuestion();
  }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    this.q = /** @type {{ q: string, answer: number, unit?: string, src?: string }} */ (/** @type {unknown} */ (library.drawOne('closest', { spicy: this.spicy() }) || BUILTIN[this.round % BUILTIN.length]));
    this.poolName = 'closest';
    this.item = this.q;
    this.guesses = new Map();
    this.result = null;
    this.doubling = new Set();
    this.phase = 'cg-guess';
    this.setTimer(GUESS_MS, () => this.reveal());
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase !== 'cg-guess' || this.guesses.has(id)) return;
    const n = typeof payload.number === 'number' ? payload.number : parseFloat(String(payload.number || '').replace(/,/g, ''));
    if (!Number.isFinite(n) || Math.abs(n) > 1e12) return;
    this.guesses.set(id, n);
    // Double Down (once per game): ×2 if you finish in the top half, −DOUBLE_RISK if you don't.
    if (payload.double === true && !this.doubled.has(id)) { this.doubled.add(id); this.doubling.add(id); }
    if (this.allIn(this.guesses)) this.reveal();
    else this.push();
  }

  reveal() {
    if (this.phase !== 'cg-guess') return;
    const ans = this.q.answer;
    // Only people still here take places (a guess from someone who left can't push anyone down).
    // The distance is rounded so 0.1 + 0.2 style float noise can't split a tie.
    const list = [...this.guesses.entries()].filter(([id]) => this.room.players.has(id))
      .map(([id, n]) => ({ id, nickname: this.nick(id), guess: n, off: Math.round(Math.abs(n - ans) * 1e6) / 1e6, rank: 0, exact: false, gained: 0, double: false }))
      .sort((a, b) => a.off - b.off);
    // A Double Down pays in the top half only: with 2–3 players every guess "places", so it was free.
    const topHalf = Math.max(1, Math.floor(list.length / 2));
    // Ties share a rank.
    let rank = 0;
    list.forEach((e, i) => {
      if (i > 0 && e.off !== list[i - 1].off) rank = i;
      e.rank = rank;
      e.exact = e.off === 0;
      const pts = (RANK_POINTS[rank] || 0) + (e.exact ? 200 : 0);
      if (this.doubling.has(e.id)) {
        e.double = true;
        // Top half is safe even past the paying ranks (8+ players: 4th place pays 0, ×2 = 0, no penalty).
        if (rank < topHalf) e.gained = this.award(e.id, pts * 2);
        else { const p = this.room.players.get(e.id); const lost = p ? Math.min(p.score, DOUBLE_RISK) : 0; if (p) p.score -= lost; e.gained = -lost; }
      } else e.gained = this.award(e.id, pts);
    });
    this.result = { answer: ans, unit: this.q.unit || '', list: list.map(({ id, ...rest }) => rest) };
    this.phase = 'cg-reveal';
    this.setTimer(REVEAL_MS, () => this.nextRound(), false);
    this.push();
  }

  onPlayerLeft() {
    if (this.phase === 'cg-guess' && this.room.players.size && this.allIn(this.guesses)) this.reveal();
  }

  hostView() {
    if (this.phase === 'cg-guess') {
      return { question: this.q.q, unit: this.q.unit || '', submittedCount: this.guesses.size, totalPlayers: this.room.players.size, source: this.q.src || null };
    }
    return { question: this.q.q, result: this.result, source: this.q.src || null };
  }

  /** @param {string} id */
  playerOnly(id) {
    if (this.phase === 'cg-guess') {
      return { gameState: { question: this.q.q, unit: this.q.unit || '' }, you: { submitted: this.guesses.has(id), canDouble: !this.doubled.has(id) } };
    }
    const me = this.result ? this.result.list.find((e) => e.nickname === this.nick(id)) : null;
    return { gameState: { question: this.q.q, result: this.result }, you: { mine: me || null } };
  }
}

ClosestGame.meta = {
  id: 'closest',
  /** Anyone can act on any screen: phones may join mid-game (core/rooms.js join, todo 3.4). */
  lateJoin: true,
  name: 'Closest Cast',
  blurb: 'Guess the number. Nearest wins — exact hits earn a bonus.',
  minPlayers: 2,
};

module.exports = ClosestGame;
