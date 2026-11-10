/*
 * Rumpus trivia ("Trivia Blast") — multiple-choice, speed-scored, with
 * category segments: every 3–5 questions the player in LAST place picks the
 * next category from three random ones (a comeback mechanic). Streaks add
 * bonus points; the final question is worth double.
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

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
const MIN_PER_CATEGORY = 6;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// "Entertainment: Video Games" -> "Video Games"
function prettyCategory(cat) {
  return String(cat || '').replace(/^(Entertainment|Science): /, '').replace(/&amp;/g, '&');
}

class TriviaGame {
  constructor(room, push) {
    this.room = room;
    this.push = push;
    this.phase = 'trivia-question';
    this.round = 0;
    this.totalRounds = (room.settings && room.settings.rounds) || TOTAL_ROUNDS;
    this.question = null;
    this.answers = new Map(); // playerId -> { choice, answeredAt }
    this.streaks = new Map();
    this.roundStartedAt = null;
    this.timer = null;
    this.endsAt = null;
    this.destroyed = false;
    this.category = null;       // raw category of the current segment
    this.segmentLeft = 0;       // questions left in this category segment
    this.categoryOptions = [];
    this.chooserId = null;
    this.usedCategories = new Set();
  }

  start() {
    this.nextRound();
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setTimer(ms, fn) {
    if (this.timer) clearTimeout(this.timer);
    const scale = (this.room.settings && this.room.settings.timerScale) || 1;
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
    clearTimeout(this.timer);
    this.timer = null;
    this.timerFn = null;
    fn();
  }

  // Categories with enough questions for the current 18+ setting.
  availableCategories() {
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
    players.sort((a, b) => a.score - b.score);
    this.chooserId = players.length ? players[0].id : null;
    this.phase = 'trivia-category';
    this.setTimer(CATEGORY_MS, () => this.pickCategory(crypto.randomInt(this.categoryOptions.length), true));
    this.push();
    return true;
  }

  pickCategory(index, auto = false) {
    if (this.phase !== 'trivia-category') return;
    this.category = this.categoryOptions[index];
    this.usedCategories.add(this.category);
    this.categoryAuto = auto;
    this.segmentLeft = 3 + crypto.randomInt(3); // 3–5 questions per category
    this.askQuestion();
  }

  askQuestion() {
    this.round += 1;
    const spicy = this.spicy();
    const cat = this.category;
    this.question = (cat && library.drawOne('trivia', { spicy, filter: (q) => q.cat === cat }))
      || library.drawOne('trivia', { spicy })
      || QUESTIONS[this.round % QUESTIONS.length];
    this.segmentLeft -= 1;
    this.answers = new Map();
    this.phase = 'trivia-question';
    this.roundStartedAt = Date.now();
    this.setTimer(QUESTION_MS, () => this.reveal());
    this.push();
  }

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
    if (!Number.isInteger(choice) || choice < 0 || choice >= this.question.choices.length) return;
    if (this.answers.has(playerId)) return; // one answer each
    this.answers.set(playerId, { choice, answeredAt: Date.now() });
    if (this.answers.size >= this.room.players.size) this.reveal();
    else this.push();
  }

  reveal() {
    if (this.phase !== 'trivia-question') return;
    const correct = this.question.correct;
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
        const gained = (BASE_POINTS + Math.round(SPEED_BONUS * speedFrac) + (streak - 1) * 100) * this.mult();
        p.score += gained;
        scored.push({ nickname: p.nickname, correct: true, gained, streak });
      } else {
        this.streaks.set(playerId, 0);
        scored.push({ nickname: p.nickname, correct: false, gained: 0, streak: 0 });
      }
    }
    // Players who didn't answer lose their streak too.
    for (const id of this.room.players.keys()) if (!this.answers.has(id)) this.streaks.set(id, 0);
    scored.sort((a, b) => b.gained - a.gained);
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
    const chooser = this.room.players.get(this.chooserId);
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
    };
  }

  hostGameState() {
    const base = this.base();
    switch (this.phase) {
      case 'trivia-category':
        return { ...base, categoryOptions: this.categoryOptions.map(prettyCategory) };
      case 'trivia-question':
        return {
          ...base,
          question: this.question.q,
          choices: this.question.choices,
          answeredCount: this.answers.size,
          totalPlayers: this.room.players.size,
          categoryAuto: !!this.categoryAuto,
        };
      case 'trivia-reveal':
        return {
          ...base,
          question: this.question.q,
          choices: this.question.choices,
          correct: this.roundResult.correct,
          scored: this.roundResult.scored,
        };
      case 'gameover':
        return { ...base, standings: this.standings() };
      default:
        return base;
    }
  }

  playerView(playerId) {
    const base = this.base();
    switch (this.phase) {
      case 'trivia-category':
        return {
          gameState: { ...base, categoryOptions: this.categoryOptions.map(prettyCategory) },
          you: { isChooser: playerId === this.chooserId },
        };
      case 'trivia-question':
        return {
          gameState: { ...base, question: this.question.q, choices: this.question.choices },
          you: { answered: this.answers.has(playerId) },
        };
      case 'trivia-reveal': {
        const mine = this.answers.get(playerId);
        return {
          gameState: {
            ...base,
            question: this.question.q,
            choices: this.question.choices,
            correct: this.roundResult.correct,
          },
          you: {
            answered: !!mine,
            wasCorrect: !!mine && mine.choice === this.roundResult.correct,
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
