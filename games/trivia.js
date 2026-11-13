/*
 * Rumpus trivia ("Lakeside Quiz") — multiple-choice, speed-scored, with
 * category segments: every 3–5 questions the player in LAST place picks the
 * next category from three random ones (a comeback mechanic). Streaks add
 * bonus points; stakes rise through the game (×2, then ×3 on the last question: BaseGame.mult).
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame } = require('./base');

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

// "Entertainment: Video Games" -> "Video Games"
/** @param {unknown} cat */
function prettyCategory(cat) {
  return String(cat || '').replace(/^(Entertainment|Science): /, '').replace(/&amp;/g, '&');
}

/** @typedef {{ q: string, choices: string[], correct: number, cat?: string, src?: string, id?: string }} TriviaQ */

class TriviaGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.phase = 'trivia-question';
    this.totalRounds = this.rounds(TOTAL_ROUNDS);
    /** @type {TriviaQ | null} */
    this.question = null;
    /** @type {Map<string, { choice: number, answeredAt: number, double: boolean }>} */
    this.answers = new Map();
    /** @type {Set<string>} players who've used their one Double Down this game */
    this.doubled = new Set();
    /** @type {Map<string, number>} */
    this.streaks = new Map();
    this.roundStartedAt = 0;
    this.questionWindow = 0;
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
    /** @type {Set<string>} franchises/titles already asked about this game */
    this.usedTopics = new Set();
    this.poolName = 'trivia';
    /** @type {TriviaQ | null} */
    this.item = null;
    /** @type {{ correct: number, scored: { nickname: string, correct: boolean, gained: number, streak: number, double: boolean }[] } | null} */
    this.roundResult = null;
  }

  start() {
    this.nextRound();
  }

  /** Where the game is, for a TV reload / server restart (core/rooms.js snapshot; todo 2.1). */
  save() {
    return {
      round: this.round, totalRounds: this.totalRounds, phase: this.phase, question: this.question, category: this.category,
      segmentLeft: this.segmentLeft, categoryOptions: this.categoryOptions, chooserId: this.chooserId,
      usedCategories: [...this.usedCategories], usedTopics: [...this.usedTopics], doubled: [...this.doubled], streaks: [...this.streaks],
    };
  }
  /** Pick a saved game up where it was: a category pick or the current question start again with a
   * fresh clock (answers given before the restart are gone); after a reveal, the next question.
   * @param {any} d */
  resume(d) {
    const strs = (/** @type {unknown} */ a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
    this.totalRounds = Number(d.totalRounds) || this.totalRounds;
    this.round = Math.max(0, Number(d.round) || 0);
    this.category = typeof d.category === 'string' ? d.category : null;
    this.segmentLeft = Number(d.segmentLeft) || 0;
    this.usedCategories = new Set(strs(d.usedCategories));
    this.usedTopics = new Set(strs(d.usedTopics));
    this.doubled = new Set(strs(d.doubled));
    this.streaks = new Map(Array.isArray(d.streaks) ? d.streaks.filter((/** @type {any} */ x) => Array.isArray(x) && typeof x[0] === 'string').map((/** @type {any} */ x) => [x[0], Number(x[1]) || 0]) : []);
    const opts = strs(d.categoryOptions);
    if (d.phase === 'trivia-category' && opts.length >= 2) {
      this.categoryOptions = opts;
      this.chooserId = typeof d.chooserId === 'string' && this.room.players.has(d.chooserId) ? d.chooserId : ([...this.room.players.keys()][0] || null);
      this.phase = 'trivia-category';
      this.setTimer(CATEGORY_MS, () => this.pickCategory(this.rng.int(0, this.categoryOptions.length - 1), true));
      return this.push();
    }
    const q = d.question;
    if (d.phase !== 'trivia-question' || !q || typeof q.q !== 'string' || !Array.isArray(q.choices) || !Number.isInteger(q.correct)) return this.nextRound();
    this.question = q;
    this.item = q;
    this.answers = new Map();
    this.phase = 'trivia-question';
    this.roundStartedAt = Date.now();
    this.setTimer(QUESTION_MS, () => this.reveal());
    this.questionWindow = Math.max(1, (this.endsAt || this.roundStartedAt + QUESTION_MS) - this.roundStartedAt);
    this.push();
  }

  get skippablePhases() { return ['trivia-question']; }

  // Majority voted to skip: same round, fresh question from the same category.
  skipQuestion() {
    if (this.phase !== 'trivia-question') return;
    // The skipped question never counted: its Double Downs are given back.
    for (const [id, a] of this.answers) if (a.double) this.doubled.delete(id);
    this.skipSeq = (this.skipSeq || 0) + 1;
    this.round -= 1;
    this.segmentLeft += 1;
    this.askQuestion();
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
    this.categoryOptions = this.rng.shuffleIn(cats).slice(0, 3);
    // Comeback mechanic: the player in last place chooses (ties: random). Someone whose phone is
    // asleep can't pick — everyone would wait out the clock — so connected players go first.
    const all = [...this.room.players.values()];
    const awake = all.filter((p) => p.connected !== false);
    const players = this.rng.shuffleIn(awake.length ? awake : all);
    players.sort((/** @type {Player} */ a, /** @type {Player} */ b) => a.score - b.score);
    this.chooserId = players.length ? players[0].id : null;
    this.phase = 'trivia-category';
    this.setTimer(CATEGORY_MS, () => this.pickCategory(this.rng.int(0, this.categoryOptions.length - 1), true));
    this.push();
    return true;
  }

  /** @param {number} index @param {boolean} [auto] */
  pickCategory(index, auto = false) {
    if (this.phase !== 'trivia-category') return;
    this.category = this.categoryOptions[index] || null;
    if (this.category) this.usedCategories.add(this.category);
    this.categoryAuto = auto;
    this.segmentLeft = this.rng.int(3, 5); // 3–5 questions per category
    this.askQuestion();
  }

  askQuestion() {
    this.round += 1;
    const spicy = this.spicy();
    const cat = this.category;
    // Never two questions on the same franchise/title in one game (the pool tags them by topic).
    const fresh = (/** @type {PoolItem} */ q) => !q.topic || !this.usedTopics.has(String(q.topic));
    this.question = /** @type {TriviaQ} */ (/** @type {unknown} */ ((cat && library.drawOne('trivia', { spicy, filter: (/** @type {PoolItem} */ q) => q.cat === cat && fresh(q) }))
      || library.drawOne('trivia', { spicy, filter: fresh })
      || library.drawOne('trivia', { spicy })
      || QUESTIONS[this.round % QUESTIONS.length]));
    const tp = /** @type {any} */ (this.question).topic;
    if (tp) this.usedTopics.add(String(tp));
    this.segmentLeft -= 1;
    this.poolName = 'trivia';
    this.item = this.question;
    this.answers = new Map();
    this.phase = 'trivia-question';
    this.roundStartedAt = Date.now();
    this.setTimer(QUESTION_MS, () => this.reveal());
    /** The real answer window (timer speed + house multiplier applied): the speed bonus scale. */
    this.questionWindow = Math.max(1, (this.endsAt || this.roundStartedAt + QUESTION_MS) - this.roundStartedAt);
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
        const span = this.questionWindow || QUESTION_MS;
        const elapsed = Math.min(span, a.answeredAt - this.roundStartedAt);
        const speedFrac = Math.max(0, 1 - elapsed / span);
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
    this.setTimer(REVEAL_MS, () => this.nextRound(), false);
    this.push();
  }

  /** @param {string} playerId */
  onPlayerLeft(playerId) {
    if (this.destroyed) return;
    this.answers.delete(playerId);
    if (this.room.players.size === 0) return;
    if (this.phase === 'trivia-category' && playerId === this.chooserId) {
      this.pickCategory(this.rng.int(0, this.categoryOptions.length - 1), true);
    } else if (this.phase === 'trivia-question' && this.answers.size >= this.room.players.size) {
      this.reveal();
    }
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
      // During a question the banner names that question's own category: when the chosen one runs dry
      // the question comes from elsewhere, and the banner mustn't claim otherwise.
      category: (() => { const c = this.phase === 'trivia-category' || !this.question ? this.category : this.question.cat; return c ? prettyCategory(c) : null; })(),
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
  /** Anyone can act on any screen: phones may join mid-game (core/rooms.js join, todo 3.4). */
  lateJoin: true,
  name: 'Lakeside Quiz',
  blurb: 'Fast trivia in category rounds — last place picks the next category.',
  minPlayers: 2,
};
TriviaGame.prettyCategory = prettyCategory;

module.exports = TriviaGame;
