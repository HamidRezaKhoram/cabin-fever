/*
 * Rumpus Cards-Against-Humanity-style game module (pick-1 prompts only, MVP).
 *
 * Card deck: games/data/cah-cards.js if present (gitignored — bring your own
 * deck; the actual CAH cards are CC BY-NC-SA and not shipped here), otherwise
 * falls back to the small original sample deck in cah-cards.sample.js.
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const house = require('./house');

const stats = require('./stats');

const crypto = require('crypto');
const library = require('./library');
const flow = require('./flow');
// Fallback deck if the pools are missing.
const { WHITE, BLACK } = require('./data/cah-cards.sample');

const REVEAL_MS = parseInt(process.env.RUMPUS_CAH_REVEAL_MS || '10000', 10);
const TOTAL_ROUNDS = parseInt(process.env.RUMPUS_CAH_ROUNDS || '8', 10);
const HAND_SIZE = 7;
const POINTS_PER_WIN = 500;

/** @template T @param {T[]} arr @returns {T[]} */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class CAHGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    this.room = room;
    this.push = push;
    this.phase = 'cah-submit';
    this.round = 0;
    this.totalRounds = (room.settings && room.settings.rounds) || TOTAL_ROUNDS;
    this.whiteDeck = shuffle(WHITE.slice());
    this.blackDeck = shuffle(BLACK.slice());
    this.hands = new Map(); // playerId -> [cardText]
    this.blackCard = null;
    this.czarCursor = 0;
    /** @type {string | null} */
    this.czarId = null;
    this.submissions = new Map(); // playerId -> cardText
    /** @type {{ playerId: string, text: string }[]} shuffled at the czar phase */
    this.revealList = [];
    /** @type {{ playerId: string, nickname: string, text: string } | null} */
    this.winner = null;
    this.timer = null;
    this.endsAt = null;
    this.destroyed = false;

    for (const p of room.players.values()) {
      this.hands.set(p.id, this.drawWhite(HAND_SIZE));
    }
  }

  /** @param {number} n @returns {string[]} */
  drawWhite(n) {
    const got = library.draw('cah-white', n, { spicy: this.spicy() }).map((c) => c.text || '').filter(Boolean);
    while (got.length < n) {
      if (this.whiteDeck.length === 0) this.whiteDeck = shuffle(WHITE.slice());
      const card = this.whiteDeck.pop();
      if (card) got.push(card);
    }
    return got;
  }

  drawBlack() {
    const c = library.drawOne('cah-black', { spicy: this.spicy() });
    if (c) return c.text;
    if (this.blackDeck.length === 0) this.blackDeck = shuffle(BLACK.slice());
    return this.blackDeck.pop();
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
    const scale = ((this.room.settings && this.room.settings.timerScale) || 1) * house.timerFor('cah');
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

  get skippablePhases() { return ['cah-submit']; }

  // New prompt card, same Card Czar; played cards go back to their owners.
  skipQuestion() {
    if (this.phase !== 'cah-submit') return;
    for (const [id, text] of this.submissions) {
      const hand = this.hands.get(id);
      if (hand) hand.push(text);
    }
    this.submissions = new Map();
    this.blackCard = this.drawBlack();
    this.skipSeq = (this.skipSeq || 0) + 1;
    this.push();
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

  currentCzar() {
    const ids = [...this.room.players.keys()];
    if (ids.length === 0) return null;
    return ids[this.czarCursor % ids.length];
  }

  nextRound() {
    if (this.round >= this.totalRounds) {
      this.gameOver();
      return;
    }
    if (this.room.players.size < 2) {
      this.gameOver();
      return;
    }
    this.round += 1;
    // The previous czar picked this round's prompt from three while they waited.
    const prev = this.nextOptions;
    this.pickedBy = prev && this.nextPick != null ? this.czarNickname() : null;
    this.blackCard = prev ? prev[this.nextPick != null ? this.nextPick : crypto.randomInt(prev.length)] : this.drawBlack();
    this.czarId = this.currentCzar();
    this.czarCursor += 1;
    this.nextOptions = this.round < this.totalRounds ? [this.drawBlack(), this.drawBlack(), this.drawBlack()] : null;
    this.nextPick = null;
    this.submissions = new Map();
    this.revealList = [];
    this.winner = null;
    this.phase = 'cah-submit';
    this.timer = null;
    this.endsAt = null;
    this.push();
  }

  neededSubmissions() {
    return Math.max(0, this.room.players.size - 1); // everyone except the czar
  }

  /** @param {string} playerId @param {Record<string, any>} payload */
  handleSubmit(playerId, payload) {
    if (this.destroyed) return;
    if (this.phase === 'cah-submit' && playerId === this.czarId) {
      // The czar's job while cards come in: choose next round's prompt card.
      const n = payload.nextBlack;
      if (this.nextOptions && this.nextPick == null && Number.isInteger(n) && n >= 0 && n < this.nextOptions.length) {
        this.nextPick = n;
        this.push();
      }
      return;
    }
    if (this.phase === 'cah-submit') {
      if (this.submissions.has(playerId)) return;
      const hand = this.hands.get(playerId);
      if (!hand) return;
      const idx = payload.cardIndex;
      if (!Number.isInteger(idx) || idx < 0 || idx >= hand.length) return;
      const text = hand.splice(idx, 1)[0];
      this.submissions.set(playerId, text);
      if (this.submissions.size >= this.neededSubmissions()) {
        this.finishSubmitting();
      } else {
        this.push();
      }
    } else if (this.phase === 'cah-czar') {
      if (playerId !== this.czarId) return;
      const choice = payload.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= this.revealList.length) return;
      this.pickWinner(choice);
    }
  }

  finishSubmitting() {
    if (this.phase !== 'cah-submit') return;
    this.revealList = shuffle(
      [...this.submissions.entries()].map(([playerId, text]) => ({ playerId, text }))
    );
    this.phase = 'cah-czar';
    this.push();
  }

  /** @param {number} choiceIndex */
  pickWinner(choiceIndex) {
    if (this.phase !== 'cah-czar') return;
    const pick = this.revealList[choiceIndex];
    if (!pick) return;
    const p = this.room.players.get(pick.playerId);
    if (p) p.score += POINTS_PER_WIN * this.mult();
    this.winner = { playerId: pick.playerId, nickname: p ? p.nickname : '(left the game)', text: pick.text };
    if (p) stats.highlight(this.room, { game: 'Rainy Day Cards', prompt: this.blackCard || '', text: pick.text, by: p.nickname, note: 'won the round' });
    // Replenish everyone who played a card back up to HAND_SIZE.
    for (const playerId of this.submissions.keys()) {
      const hand = this.hands.get(playerId);
      if (hand) hand.push(...this.drawWhite(HAND_SIZE - hand.length));
    }
    this.phase = 'cah-reveal';
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
    this.hands.delete(playerId);
    this.submissions.delete(playerId);
    if (this.room.players.size === 0) return;
    if (playerId === this.czarId) {
      // Czar vanished mid-round — no one left to judge, just move on.
      this.nextRound();
      return;
    }
    if (this.phase === 'cah-submit' && this.submissions.size >= this.neededSubmissions()) {
      this.finishSubmitting();
    }
  }

  standings() {
    return [...this.room.players.values()]
      .map((p) => ({ nickname: p.nickname, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  czarNickname() {
    const p = this.czarId ? this.room.players.get(this.czarId) : undefined;
    return p ? p.nickname : '???';
  }

  // --- views ---------------------------------------------------------------

  hostGameState() {
    const base = {
      gameId: 'cah',
      round: this.round,
      totalRounds: this.totalRounds,
      doublePoints: this.mult() > 1,
      multiplier: this.mult(),
      stage: flow.stage(this.round, this.totalRounds),
      skipSeq: this.skipSeq || 0,
      czarNickname: this.czarNickname(),
      blackCard: this.blackCard,
      pickedBy: this.pickedBy || null,
    };
    switch (this.phase) {
      case 'cah-submit':
        return {
          ...base,
          submittedCount: this.submissions.size,
          neededCount: this.neededSubmissions(),
        };
      case 'cah-czar':
        return {
          ...base,
          submissions: this.revealList.map((/** @type {{ text: string }} */ s, /** @type {number} */ i) => ({ index: i, text: s.text })),
        };
      case 'cah-reveal':
        return { ...base, winner: this.winner };
      case 'gameover':
        return { gameId: 'cah', standings: this.standings() };
      default:
        return base;
    }
  }

  /** @param {string} playerId */
  playerView(playerId) {
    const base = {
      gameId: 'cah',
      round: this.round,
      totalRounds: this.totalRounds,
      doublePoints: this.mult() > 1,
      multiplier: this.mult(),
      stage: flow.stage(this.round, this.totalRounds),
      skipSeq: this.skipSeq || 0,
      czarNickname: this.czarNickname(),
      blackCard: this.blackCard,
      isCzar: playerId === this.czarId,
    };
    switch (this.phase) {
      case 'cah-submit':
        return {
          gameState: base,
          you: {
            nextOptions: playerId === this.czarId ? this.nextOptions : null,
            nextPick: playerId === this.czarId ? this.nextPick : null,
            isCzar: playerId === this.czarId,
            hand: this.hands.get(playerId) || [],
            submitted: this.submissions.has(playerId),
          },
        };
      case 'cah-czar':
        return {
          gameState: {
            ...base,
            submissions: playerId === this.czarId
              ? this.revealList.map((/** @type {{ text: string }} */ s, /** @type {number} */ i) => ({ index: i, text: s.text }))
              : [],
          },
          you: { isCzar: playerId === this.czarId },
        };
      case 'cah-reveal':
        return { gameState: { ...base, winner: this.winner }, you: {} };
      case 'gameover':
        return { gameState: { gameId: 'cah', standings: this.standings() }, you: {} };
      default:
        return { gameState: base, you: {} };
    }
  }
}

CAHGame.meta = {
  id: 'cah',
  name: 'Rainy Day Cards',
  blurb: 'Fill in the blank. Whoever the Card Czar picks wins the round.',
  minPlayers: 3,
};

module.exports = CAHGame;
