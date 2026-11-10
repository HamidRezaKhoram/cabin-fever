/*
 * "Porch Confessions" — everyone writes two true facts and one lie about
 * themselves, then the group tries to spot each person's lie.
 * AGPLv3 — see LICENSE.
 */
'use strict';

const stats = require('./stats');

const { BaseGame, shuffle, cleanText } = require('./base');

const WRITE_MS = parseInt(process.env.RUMPUS_TT_WRITE_MS || '90000', 10); // playtest: 120 s was the game's dead air
const GUESS_MS = parseInt(process.env.RUMPUS_TT_GUESS_MS || '25000', 10);
const REVEAL_MS = parseInt(process.env.RUMPUS_REVEAL_MS || '7000', 10);

class TwoTruthsGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    /** @type {Map<string, { statements: string[], lieIndex: number }>} */
    this.sets = new Map();
    /** @type {string[]} */
    this.queue = [];
    this.subject = '';
    /** @type {Map<string, number>} */
    this.guesses = new Map();
    /** @type {{ lieIndex: number, right: string[], fooled: string[], subjectGained: number, picks: string[][] } | null} */
    this.result = null;
    this.totalRounds = 0;
    this.doubleFinal = false;
  }

  start() {
    this.phase = 'tt-write';
    this.setTimer(WRITE_MS, () => this.beginGuessing());
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase === 'tt-write') {
      if (this.sets.has(id)) return;
      const truths = Array.isArray(payload.truths) ? payload.truths.map((/** @type {unknown} */ t) => cleanText(t, 100)) : [];
      const lie = cleanText(payload.lie, 100);
      if (truths.length !== 2 || truths.some((/** @type {string} */ t) => !t) || !lie) return;
      const statements = shuffle([
        { text: truths[0], lie: false },
        { text: truths[1], lie: false },
        { text: lie, lie: true },
      ]);
      this.sets.set(id, {
        statements: statements.map((s) => s.text),
        lieIndex: statements.findIndex((s) => s.lie),
      });
      if (this.allIn(this.sets)) this.beginGuessing();
      else this.push();
    } else if (this.phase === 'tt-guess') {
      if (id === this.subject || this.guesses.has(id)) return;
      const c = payload.choice;
      if (!Number.isInteger(c) || c < 0 || c > 2) return;
      this.guesses.set(id, c);
      if (this.allIn(this.guesses, [this.subject])) this.reveal();
      else this.push();
    }
  }

  beginGuessing() {
    if (this.phase !== 'tt-write') return;
    this.queue = shuffle([...this.sets.keys()].filter((id) => this.room.players.has(id)));
    this.totalRounds = this.queue.length;
    if (!this.queue.length) return this.gameOver();
    this.nextSubject();
  }

  nextSubject() {
    // Skip anyone who left mid-game.
    while (this.queue.length && !this.room.players.has(this.queue[0])) this.queue.shift();
    if (!this.queue.length) return this.gameOver();
    this.subject = this.queue.shift() || '';
    this.round += 1;
    this.guesses = new Map();
    this.result = null;
    this.phase = 'tt-guess';
    this.setTimer(GUESS_MS, () => this.reveal());
    this.push();
  }

  reveal() {
    if (this.phase !== 'tt-guess') return;
    const set = this.sets.get(this.subject);
    if (!set) return this.nextSubject();
    /** @type {string[]} */
    const right = [];
    /** @type {string[]} */
    const fooled = [];
    for (const [id, c] of this.guesses) {
      if (c === set.lieIndex) { right.push(id); this.award(id, 100); } else fooled.push(id);
    }
    const subjectGained = this.award(this.subject, fooled.length * 75);
    stats.feat(this.room, this.subject, 'fooled', fooled.length);
    if (fooled.length >= 2) stats.highlight(this.room, { game: 'Porch Confessions', text: set.statements[set.lieIndex], by: this.nick(this.subject), note: `lie that fooled ${fooled.length}` });
    this.result = {
      lieIndex: set.lieIndex,
      right: right.map((id) => this.nick(id)),
      fooled: fooled.map((id) => this.nick(id)),
      subjectGained,
      picks: [0, 1, 2].map((i) => [...this.guesses].filter(([, c]) => c === i).map(([id]) => this.nick(id))),
    };
    this.phase = 'tt-reveal';
    this.setTimer(REVEAL_MS, () => this.nextSubject(), false);
    this.push();
  }

  /** @param {string} id */
  onPlayerLeft(id) {
    if (this.phase === 'tt-write') {
      if (this.room.players.size && this.allIn(this.sets)) this.beginGuessing();
    } else if (this.phase === 'tt-guess') {
      if (id === this.subject) { this.clearTimer(); this.nextSubject(); return; }
      this.guesses.delete(id);
      if (this.allIn(this.guesses, [this.subject])) this.reveal();
    }
  }

  current() {
    const set = this.sets.get(this.subject);
    return { subject: this.nick(this.subject), statements: set ? set.statements : [] };
  }

  hostView() {
    if (this.phase === 'tt-write') {
      return {
        submittedCount: this.sets.size, totalPlayers: this.room.players.size,
        waitingOn: [...this.room.players.keys()].filter((id) => !this.sets.has(id)).map((id) => this.nick(id)),
      };
    }
    if (this.phase === 'tt-guess') {
      return { ...this.current(), guessedCount: this.guesses.size, needed: Math.max(0, this.room.players.size - 1) };
    }
    return { ...this.current(), result: this.result };
  }

  /** @param {string} id */
  playerOnly(id) {
    if (this.phase === 'tt-write') return { gameState: {}, you: { submitted: this.sets.has(id) } };
    const isSubject = id === this.subject;
    if (this.phase === 'tt-guess') {
      return { gameState: this.current(), you: { isSubject, guessed: this.guesses.has(id) } };
    }
    const mine = this.guesses.get(id);
    return {
      gameState: { ...this.current(), result: this.result },
      you: { isSubject, correct: mine != null && !!this.result && mine === this.result.lieIndex, guessed: mine != null },
    };
  }
}

TwoTruthsGame.meta = {
  id: 'twotruths',
  name: 'Porch Confessions',
  blurb: 'Write two facts and one fib about yourself. Can your friends spot it?',
  minPlayers: 3,
};

module.exports = TwoTruthsGame;
