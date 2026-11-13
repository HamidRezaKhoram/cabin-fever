/*
 * Rumpus Fibbage-style game module — bluffing trivia.
 *
 * Each round everyone sees a fact with a blank and secretly writes a FAKE
 * answer (a lie). The real answer is then shuffled in with everyone's lies and
 * players hunt for the truth. You score for finding the truth, and for every
 * player your lie fools into picking it.
 *
 * Payload shapes on player:submit — deliberately the same primitives the other
 * modules use so the phone client needs no new input widgets:
 *   fib-bluff  : { text }    (like a Quiplash answer)
 *   fib-choose : { choice }  (index into the shuffled options, like a vote)
 *
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame } = require('./base');
const house = require('./house');

const stats = require('./stats');

const { QUESTIONS } = require('./data/fibbage-questions');
const library = require('./library');

const BLUFF_MS = parseInt(process.env.RUMPUS_FIB_BLUFF_MS || '40000', 10);
const CHOOSE_MS = parseInt(process.env.RUMPUS_FIB_CHOOSE_MS || '30000', 10);
const REVEAL_MS = parseInt(process.env.RUMPUS_FIB_REVEAL_MS || '8000', 10);
const TOTAL_ROUNDS = parseInt(process.env.RUMPUS_FIB_ROUNDS || '5', 10);
const TRUTH_POINTS = 1000; // for finding the real answer
const FOOL_POINTS = 500;   // per player your lie fools
const LIKE_POINTS = 50;    // per 👍 on your lie (players like funny lies while waiting for the rest)

// Loose match so a lie that's really the truth (or two identical lies) collapse
// together regardless of casing / surrounding whitespace / trailing period.
/** @param {unknown} s */
function normalize(s) {
  return String(s).trim().toLowerCase().replace(/[.!?]+$/, '');
}

/** @typedef {{ text: string, authorIds: Set<string>, isTruth: boolean, index: number }} Option */

class FibbageGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.phase = 'fib-bluff';
    this.totalRounds = Math.min(this.rounds(TOTAL_ROUNDS), QUESTIONS.length);
    this.deck = this.rng.shuffleIn(QUESTIONS.map((q, i) => i));
    this.prompt = '';
    this.answer = '';
    /** @type {Map<string, string>} playerId → lie text */
    this.bluffs = new Map();
    /** @type {Set<string>} players whose last try accidentally was the truth */
    this.collided = new Set();
    /** @type {Set<string>} players who hit the truth while lying this round (no truth points for them) */
    this.peeked = new Set();
    /** @type {Map<string, number>} playerId → option index */
    this.picks = new Map();
    /** @type {Map<number, Set<string>>} option index → who liked it */
    this.likes = new Map();
    /** @type {Option[]} */
    this.options = [];
    /** @type {any} the reveal (shape documented by the renderer) */
    this.roundResult = null;
    this.poolName = 'fibbage';
    /** @type {PoolItem | null} */
    this.item = null;
    /** @type {string | null} */
    this.source = null;
  }

  start() {
    this.nextRound();
  }

  get skippablePhases() { return ['fib-bluff']; }

  skipQuestion() {
    if (this.phase !== 'fib-bluff') return;
    this.skipSeq = (this.skipSeq || 0) + 1;
    this.round -= 1;
    this.nextRound();
  }

  nextRound() {
    if (this.round >= this.totalRounds) {
      this.gameOver();
      return;
    }
    this.round += 1;
    const q = library.drawOne('fibbage', { spicy: this.spicy() }) || QUESTIONS[this.round % QUESTIONS.length];
    this.prompt = q.q || '';
    this.poolName = 'fibbage';
    this.item = /** @type {PoolItem} */ (/** @type {unknown} */ (q));
    this.source = /** @type {{ src?: string }} */ (q).src || null;
    this.answer = q.answer;
    this.bluffs = new Map();
    this.collided = new Set();
    this.peeked = new Set();
    this.picks = new Map();
    this.likes = new Map();
    this.options = [];
    this.roundResult = null;
    this.phase = 'fib-bluff';
    this.setTimer(BLUFF_MS, () => this.finishBluffing());
    this.push();
  }

  /** @param {string} playerId @param {Record<string, any>} payload */
  handleSubmit(playerId, payload) {
    if (this.destroyed) return;
    if (!this.room.players.has(playerId)) return;
    if (this.phase === 'fib-bluff') {
      const text = typeof payload.text === 'string' ? house.mask(payload.text.trim().slice(0, 120)) : '';
      if (!text) return;
      if (this.bluffs.has(playerId)) return; // one lie each
      if (normalize(text) === normalize(this.answer)) {
        // They stumbled onto the real answer — reject it and nudge them. But probing ("Audi? Toyota?")
        // mustn't pay: once you've hit the truth here, finding it in the vote scores nothing this round.
        this.collided.add(playerId);
        this.peeked.add(playerId);
        this.push();
        return;
      }
      this.collided.delete(playerId);
      this.bluffs.set(playerId, text);
      if (this.allIn(this.bluffs)) {
        this.finishBluffing();
      } else {
        this.push();
      }
    } else if (this.phase === 'fib-choose' && payload.like !== undefined) {
      // Likes: after locking in a guess, tap any other lie you found funny.
      const i = payload.like;
      if (!this.picks.has(playerId) || !Number.isInteger(i) || i < 0 || i >= this.options.length) return;
      if (this.options[i].authorIds.has(playerId)) return;
      const set = this.likes.get(i) || new Set();
      if (set.has(playerId)) return;
      set.add(playerId);
      this.likes.set(i, set);
      this.push();
    } else if (this.phase === 'fib-choose') {
      const choice = payload.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= this.options.length) return;
      if (this.options[choice].authorIds.has(playerId)) return; // can't pick your own lie
      if (this.picks.has(playerId)) return; // one pick each
      this.picks.set(playerId, choice);
      if (this.allIn(this.picks)) {
        this.finishChoosing();
      } else {
        this.push();
      }
    }
  }

  finishBluffing() {
    if (this.phase !== 'fib-bluff') return;
    // Collapse identical lies into one option credited to every author.
    /** @type {Map<string, { text: string, authorIds: Set<string> }>} normalized → lie */
    const byText = new Map();
    for (const [playerId, text] of this.bluffs.entries()) {
      const key = normalize(text);
      const o = byText.get(key) || { text, authorIds: new Set() };
      o.authorIds.add(playerId);
      byText.set(key, o);
    }
    const opts = [...byText.values()].map((o) => ({ ...o, isTruth: false }));
    opts.push({ text: this.answer, authorIds: new Set(), isTruth: true });
    this.rng.shuffleIn(opts);
    this.options = opts.map((o, i) => ({ ...o, index: i }));
    this.picks = new Map();
    this.phase = 'fib-choose';
    this.setTimer(CHOOSE_MS, () => this.finishChoosing());
    this.push();
  }

  finishChoosing() {
    if (this.phase !== 'fib-choose') return;
    /** @type {Map<string, number>} playerId → points this round */
    const gained = new Map();
    const add = (/** @type {string} */ id, /** @type {number} */ n) => gained.set(id, (gained.get(id) || 0) + n);
    /** @type {string[][]} option index → who picked it */
    const pickedBy = this.options.map(() => []);

    for (const [playerId, choice] of this.picks.entries()) {
      pickedBy[choice].push(playerId);
      const opt = this.options[choice];
      if (opt.isTruth) {
        // Only the truth to pick from (yours was the only lie, or nobody lied): no free points.
        const choices = this.options.filter((o) => !o.authorIds.has(playerId)).length;
        if (choices >= 2 && !this.peeked.has(playerId)) add(playerId, TRUTH_POINTS);
      } else {
        for (const authorId of opt.authorIds) add(authorId, FOOL_POINTS);
      }
    }

    // Stats: every fooled player counts for the lie's authors; the best lie of the round is a highlight.
    let bestLie = -1;
    const options = this.options;
    options.forEach((o, i) => {
      if (o.isTruth || !pickedBy[i].length) return;
      for (const a of o.authorIds) stats.feat(this.room, a, 'fooled', pickedBy[i].length);
      if (bestLie < 0 || pickedBy[i].length > pickedBy[bestLie].length) bestLie = i;
    });
    if (bestLie >= 0) {
      const o = options[bestLie];
      const by = [...o.authorIds].map((id) => (this.room.players.get(id) || { nickname: '?' }).nickname).join(' & ');
      stats.highlight(this.room, { game: 'Fish Tales', prompt: this.prompt, text: o.text, by, note: `fooled ${pickedBy[bestLie].length}` });
    }
    for (const [i, who] of this.likes) {
      if (this.options[i].isTruth) continue;
      for (const authorId of this.options[i].authorIds) add(authorId, LIKE_POINTS * who.size);
    }

    for (const [playerId, n] of gained.entries()) {
      const p = this.room.players.get(playerId);
      if (p) p.score += n * this.mult();
      gained.set(playerId, n * this.mult());
    }

    const nick = (/** @type {string} */ id) => {
      const p = this.room.players.get(id);
      return p ? p.nickname : '(left the game)';
    };
    this.roundResult = {
      options: this.options.map((o, i) => ({
        text: o.text,
        isTruth: o.isTruth,
        authors: [...o.authorIds].map(nick),
        pickedBy: pickedBy[i].map(nick),
        likes: (this.likes.get(i) || new Set()).size,
      })),
      scored: [...gained.entries()].filter(([id]) => this.room.players.has(id))
        .map(([id, n]) => ({ nickname: nick(id), gained: n }))
        .sort((a, b) => b.gained - a.gained),
    };
    this.phase = 'fib-reveal';
    this.setTimer(REVEAL_MS, () => this.nextRound(), false);
    this.push();
  }

  /** @param {string} playerId */
  onPlayerLeft(playerId) {
    if (this.destroyed) return;
    // Their lie leaves with them while lies are still being written. A pick they already made stays:
    // whoever's lie fooled them earned those points before they left.
    if (this.phase === 'fib-bluff') this.bluffs.delete(playerId);
    this.collided.delete(playerId);
    if (this.room.players.size === 0) return;
    if (this.phase === 'fib-bluff') {
      if (this.allIn(this.bluffs)) this.finishBluffing();
    } else if (this.phase === 'fib-choose') {
      // A departing author may have been the only thing blocking someone's
      // pick; recount against the remaining players.
      if (this.allIn(this.picks)) this.finishChoosing();
    }
  }

  // --- views ---------------------------------------------------------------

  hostGameState() {
    const base = {
      ...this.base(),
      source: this.source || null,
    };
    switch (this.phase) {
      case 'fib-bluff':
        return {
          ...base,
          prompt: this.prompt,
          submittedCount: this.bluffs.size,
          totalPlayers: this.room.players.size,
        };
      case 'fib-choose':
        return {
          ...base,
          prompt: this.prompt,
          options: this.options.map((o) => ({ index: o.index, text: o.text })),
          pickedCount: this.picks.size,
          totalPlayers: this.room.players.size,
        };
      case 'fib-reveal':
        return { ...base, prompt: this.prompt, answer: this.answer, result: this.roundResult };
      case 'gameover':
        return { ...base, standings: this.standings() };
      default:
        return base;
    }
  }

  /** @param {string} playerId */
  playerView(playerId) {
    const base = {
      ...this.base(),
    };
    switch (this.phase) {
      case 'fib-bluff':
        return {
          gameState: { ...base, prompt: this.prompt },
          you: {
            submitted: this.bluffs.has(playerId),
            collidedWithTruth: this.collided.has(playerId),
          },
        };
      case 'fib-choose':
        return {
          gameState: {
            ...base,
            prompt: this.prompt,
            // Hide the player's own lie so they can't vote for it; real indexes
            // are preserved so the choice maps back correctly server-side.
            options: this.options
              .filter((o) => !o.authorIds.has(playerId))
              .map((o) => ({ index: o.index, text: o.text })),
          },
          you: { picked: this.picks.has(playerId), liked: [...this.likes].filter(([, s]) => s.has(playerId)).map(([i]) => i) },
        };
      case 'fib-reveal': {
        const myPick = this.picks.get(playerId);
        const foundTruth = myPick !== undefined && !!this.options[myPick] && this.options[myPick].isTruth;
        return {
          gameState: { ...base, prompt: this.prompt, answer: this.answer, result: this.roundResult },
          you: { foundTruth },
        };
      }
      case 'gameover':
        return { gameState: { ...base, standings: this.standings() }, you: {} };
      default:
        return { gameState: base, you: {} };
    }
  }
}

FibbageGame.meta = {
  id: 'fibbage',
  name: 'Fish Tales',
  blurb: 'Bluffing trivia — invent a fake answer, then spot the real one hidden among everyone\'s lies.',
  minPlayers: 2,
};

module.exports = FibbageGame;
