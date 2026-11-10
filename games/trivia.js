/*
 * Rumpus trivia ("Trivia Blast") — multiple-choice, speed-scored, with
 * category segments: every 3–5 questions the player in LAST place picks the
 * next category from three random ones (a comeback mechanic). Streaks add
 * bonus points; the final question is worth double.
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const house = require('./house');

const crypto = require('crypto');
const { QUESTIONS } = require('./data/trivia-questions');
const library = require('./library');
const flow = require('./flow');

const QUESTION_MS = parseInt(process.env.RUMPUS_TRIVIA_QUESTION_MS || '20000', 10);
const REVEAL_MS = parseInt(process.env.RUMPUS_TRIVIA_REVEAL_MS || '8000', 10);
const CATEGORY_MS = parseInt(process.env.RUMPUS_TRIVIA_CATEGORY_MS || '12000', 10);
const TOTAL_ROUNDS = parseInt(process.env.RUMPUS_TRIVIA_ROUNDS || '10', 10);
const BASE_POINTS = 500;
const SPEED_BONUS = 500;
const DOUBLE_RISK = 300; // lost on a wrong Double Down answer
const MIN_PER_CATEGORY = 6;

/** @template T @param {T[]} arr @returns {T[]} */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// "Entertainment: Video Games" -> "Video Games"
/** @param {unknown} cat */
function prettyCategory(cat) {
  return String(cat || '').replace(/^(Entertainment|Science): /, '').replace(/&amp;/g, '&');
}

/** @typedef {{ q: string, choices: string[], correct: number, cat?: string, src?: string, id?: string }} TriviaQ */

class TriviaGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    this.room = room;
    this.push = push;
    this.phase = 'trivia-question';
    this.round = 0;
    this.totalRounds = (room.settings && room.settings.rounds) || TOTAL_ROUNDS;
    /** @type {TriviaQ | null} */
    this.question = null;
    /** @type {Map<string, { choice: number, answeredAt: number, double: boolean }>} */
    this.answers = new Map();
    /** @type {Set<string>} players who've used their one Double Down this game */
    this.doubled = new Set();
    /** @type {Map<string, number>} */
    this.streaks = new Map();
    this.roundStartedAt = 0;
    /** @type {NodeJS.Timeout | null} */
    this.timer = null;
    /** @type {(() => void) | null} */
    this.timerFn = null;
    /** @type {number | null} */
    this.endsAt = null;
    this.destroyed = false;
    /** @type {string | null} raw category of the current segment */
    this.category = null;
    this.segmentLeft = 0;       // questions left in this category segment
    /** @type {string[]} */
    this.categoryOptions = [];
    /** @type {string | null} */
    this.chooserId = null;
    /** @type {Set<string>} */
    this.usedCategories = new Set();
    this.categoryAuto = false;
    this.skipSeq = 0;
    this.poolName = 'trivia';
    /** @type {TriviaQ | null} */
    this.item = null;
    /** @type {{ correct: number, scored: { nickname: string, correct: boolean, gained: number, streak: number, double: boolean }[] } | null} */
    this.roundResult = null;
  }

  start() {
    this.nextRound();
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** @param {number} ms @param {() => void} fn */
  setTimer(ms, fn) {
    if (this.timer) clearTimeout(this.timer);
    const scale = ((this.room.settings && this.room.settings.timerScale) || 1) * house.timerFor('trivia');
    ms = Math.round(ms * scale);
    this.endsAt = Date.now() + ms;
    this.timerFn = fn;
    this.timer = setTimeout(() => {
      this.timerFn = null;
      if (!this.destroyed) fn();
    }, ms);
  }

  // Escalating stakes: first half ×1, second half ×2, final question ×3.
  mult() {
    return flow.stage(this.round, this.totalRounds);
  }

  isFinal() {
    return this.mult() > 1;
  }

  spicy() {
    return !(this.room.settings && this.room.settings.spicy === false);
  }

  get skippablePhases() { return ['trivia-question']; }

  // Majority voted to skip: same round, fresh question from the same category.
  skipQuestion() {
    if (this.phase !== 'trivia-question') return;
    this.skipSeq = (this.skipSeq || 0) + 1;
    this.round -= 1;
    this.segmentLeft += 1;
    this.askQuestion();
  }

  // Host pressed "skip": run the pending phase transition now.
  skip() {
    if (!this.timerFn || this.destroyed) return;
    const fn = this.timerFn;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerFn = null;
    fn();
  }

  // Categories with enough questions for the current 18+ setting.
  availableCategories() {
    /** @type {Map<string, number>} */
    const counts = new Map();
    const spicy = this.spicy();
    for (const q of library.load('trivia').all) {
      if (!q.cat || (q.a && !spicy)) continue;
      counts.set(q.cat, (counts.get(q.cat) || 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n >= MIN_PER_CATEGORY).map(([c]) => c);
  }

  nextRound() {
    if (this.round >= this.totalRounds) {
      this.gameOver();
      return;
    }
    if (this.segmentLeft <= 0 && this.startCategoryPick()) return;
    this.askQuestion();
  }

  // Returns false when there aren't enough categories (e.g. custom packs).
  startCategoryPick() {
    let cats = this.availableCategories();
    if (cats.length < 2) return false;
    const fresh = cats.filter((c) => !this.usedCategories.has(c));
    if (fresh.length >= 3) cats = fresh;
    this.categoryOptions = shuffle(cats).slice(0, 3);
    // Comeback mechanic: the player in last place chooses (ties: random).
    const players = shuffle([...this.room.players.values()]);
    players.sort((/** @type {Player} */ a, /** @type {Player} */ b) => a.score - b.score);
    this.chooserId = players.length ? players[0].id : null;
    this.phase = 'trivia-category';
    this.setTimer(CATEGORY_MS, () => this.pickCategory(crypto.randomInt(this.categoryOptions.length), true));
    this.push();
    return true;
  }

  /** @param {number} index @param {boolean} [auto] */
  pickCategory(index, auto = false) {
    if (this.phase !== 'trivia-category') return;
    this.category = this.categoryOptions[index] || null;
    if (this.category) this.usedCategories.add(this.category);
    this.categoryAuto = auto;
    this.segmentLeft = 3 + crypto.randomInt(3); // 3–5 questions per category
    this.askQuestion();
  }

  askQuestion() {
    this.round += 1;
    const spicy = this.spicy();
    const cat = this.category;
    this.question = /** @type {TriviaQ} */ (/** @type {unknown} */ ((cat && library.drawOne('trivia', { spicy, filter: (/** @type {PoolItem} */ q) => q.cat === cat }))
      || library.drawOne('trivia', { spicy })
      || QUESTIONS[this.round % QUESTIONS.length]));
    this.segmentLeft -= 1;
    this.poolName = 'trivia';
    this.item = this.question;
    this.answers = new Map();
    this.phase = 'trivia-question';
    this.roundStartedAt = Date.now();
    this.setTimer(QUESTION_MS, () => this.reveal());
    this.push();
  }

  /** @param {string} playerId @param {Record<string, any>} payload */
  handleSubmit(playerId, payload) {
    if (this.destroyed || !this.room.players.has(playerId)) return;
    if (this.phase === 'trivia-category') {
      const c = payload.choice;
      if (playerId !== this.chooserId || !Number.isInteger(c) || c < 0 || c >= this.categoryOptions.length) return;
      this.pickCategory(c);
      return;
    }
    if (this.phase !== 'trivia-question') return;
    const choice = payload.choice;
    const q = this.question;
    if (!q || !Number.isInteger(choice) || choice < 0 || choice >= q.choices.length) return;
    if (this.answers.has(playerId)) return; // one answer each
    // Double Down (once per game): ×2 if right, −DOUBLE_RISK if wrong.
    const double = payload.double === true && !this.doubled.has(playerId);
    if (double) this.doubled.add(playerId);
    this.answers.set(playerId, { choice, answeredAt: Date.now(), double });
    if (this.answers.size >= this.room.players.size) this.reveal();
    else this.push();
  }

  reveal() {
    if (this.phase !== 'trivia-question' || !this.question) return;
    const question = this.question;
    const correct = question.correct;
    /** @type {{ nickname: string, correct: boolean, gained: number, streak: number, double: boolean }[]} */
    const scored = [];
    for (const [playerId, a] of this.answers.entries()) {
      const p = this.room.players.get(playerId);
      if (!p) continue;
      if (a.choice === correct) {
        const elapsed = Math.min(QUESTION_MS, a.answeredAt - this.roundStartedAt);
        const speedFrac = Math.max(0, 1 - elapsed / QUESTION_MS);
        const streak = (this.streaks.get(playerId) || 0) + 1;
        this.streaks.set(playerId, streak);
        // Streak bonus: +100 for every consecutive correct answer after the first.
        const gained = (BASE_POINTS + Math.round(SPEED_BONUS * speedFrac) + (streak - 1) * 100) * this.mult() * (a.double ? 2 : 1);
        p.score += gained;
        scored.push({ nickname: p.nickname, correct: true, gained, streak, double: a.double });
      } else {
        this.streaks.set(playerId, 0);
        const lost = a.double ? Math.min(p.score, DOUBLE_RISK) : 0; // never below zero
        p.score -= lost;
        scored.push({ nickname: p.nickname, correct: false, gained: -lost, streak: 0, double: a.double });
      }
    }
    // Players who didn't answer lose their streak too.
    for (const id of this.room.players.keys()) if (!this.answers.has(id)) this.streaks.set(id, 0);
    scored.sort((a, b) => b.gained - a.gained);
    if (question.id) library.recordAnswers('trivia', question.id, scored.filter((x) => x.correct).length, scored.length);
    this.roundResult = { correct, scored };
    this.phase = 'trivia-reveal';
    this.setTimer(REVEAL_MS, () => this.nextRound());
    this.push();
  }

  gameOver() {
    this.phase = 'gameover';
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.endsAt = null;
    this.push();
  }

  /** @param {string} playerId */
  onPlayerLeft(playerId) {
    if (this.destroyed) return;
    this.answers.delete(playerId);
    if (this.room.players.size === 0) return;
    if (this.phase === 'trivia-category' && playerId === this.chooserId) {
      this.pickCategory(crypto.randomInt(this.categoryOptions.length), true);
    } else if (this.phase === 'trivia-question' && this.answers.size >= this.room.players.size) {
      this.reveal();
    }
  }

  standings() {
    return [...this.room.players.values()]
      .map((p) => ({ nickname: p.nickname, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  // --- views ---------------------------------------------------------------

  base() {
    const chooser = this.chooserId ? this.room.players.get(this.chooserId) : undefined;
    return {
      gameId: 'trivia',
      round: this.round,
      totalRounds: this.totalRounds,
      endsAt: this.endsAt,
      doublePoints: (this.phase === 'trivia-question' || this.phase === 'trivia-reveal') && this.mult() > 1,
      multiplier: this.phase === 'trivia-category' ? 1 : this.mult(),
      stage: flow.stage(this.round, this.totalRounds),
      skipSeq: this.skipSeq || 0,
      category: this.category ? prettyCategory(this.category) : (this.question && prettyCategory(this.question.cat)),
      segmentLeft: this.segmentLeft,
      chooser: chooser ? chooser.nickname : null,
      source: this.phase === 'trivia-category' || !this.question ? null : this.question.src || null,
    };
  }

  hostGameState() {
    const base = this.base();
    const q = /** @type {TriviaQ} */ (this.question), rr = this.roundResult || { correct: -1, scored: [] };
    switch (this.phase) {
      case 'trivia-category':
        return { ...base, categoryOptions: this.categoryOptions.map(prettyCategory) };
      case 'trivia-question':
        return {
          ...base,
          question: q.q,
          choices: q.choices,
          answeredCount: this.answers.size,
          totalPlayers: this.room.players.size,
          categoryAuto: !!this.categoryAuto,
        };
      case 'trivia-reveal':
        return {
          ...base,
          question: q.q,
          choices: q.choices,
          correct: rr.correct,
          scored: rr.scored,
        };
      case 'gameover':
        return { ...base, standings: this.standings() };
      default:
        return base;
    }
  }

  /** @param {string} playerId */
  playerView(playerId) {
    const base = this.base();
    const q = /** @type {TriviaQ} */ (this.question), rr = this.roundResult || { correct: -1, scored: [] };
    switch (this.phase) {
      case 'trivia-category':
        return {
          gameState: { ...base, categoryOptions: this.categoryOptions.map(prettyCategory) },
          you: { isChooser: playerId === this.chooserId },
        };
      case 'trivia-question':
        return {
          gameState: { ...base, question: q.q, choices: q.choices },
          you: { answered: this.answers.has(playerId), canDouble: !this.doubled.has(playerId) },
        };
      case 'trivia-reveal': {
        const mine = this.answers.get(playerId);
        return {
          gameState: {
            ...base,
            question: q.q,
            choices: q.choices,
            correct: rr.correct,
          },
          you: {
            answered: !!mine,
            wasCorrect: !!mine && mine.choice === rr.correct,
            streak: this.streaks.get(playerId) || 0,
          },
        };
      }
      case 'gameover':
        return { gameState: { ...base, standings: this.standings() }, you: {} };
      default:
        return { gameState: base, you: {} };
    }
  }
}

TriviaGame.meta = {
  id: 'trivia',
  name: 'Trivia Blast',
  blurb: 'Fast trivia in category rounds — last place picks the next category.',
  minPlayers: 2,
};
TriviaGame.prettyCategory = prettyCategory;

module.exports = TriviaGame;
