/*
 * Rumpus Cards-Against-Humanity-style game module (pick-1 prompts only, MVP).
 *
 * Card deck: games/data/cah-cards.js if present (gitignored — bring your own
 * deck; the actual CAH cards are CC BY-NC-SA and not shipped here), otherwise
 * falls back to the small original sample deck in cah-cards.sample.js.
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame } = require('./base');

const stats = require('./stats');

const library = require('./library');
// Fallback deck if the pools are missing.
const { WHITE, BLACK } = require('./data/cah-cards.sample');

const REVEAL_MS = parseInt(process.env.RUMPUS_CAH_REVEAL_MS || '10000', 10);
// Nobody waits forever on a phone that fell asleep: both steps have a (generous) clock, which also
// gives the TV its Skip button and the phones their "hurry" vote here.
const SUBMIT_MS = parseInt(process.env.RUMPUS_CAH_SUBMIT_MS || '75000', 10);
const CZAR_MS = parseInt(process.env.RUMPUS_CAH_CZAR_MS || '60000', 10);
const TOTAL_ROUNDS = parseInt(process.env.RUMPUS_CAH_ROUNDS || '8', 10);
const HAND_SIZE = 7;
const POINTS_PER_WIN = 500;
/** Room favourite (todo 3.2): while the Czar judges, everyone else taps the card they like best
 * (not their own); the most-liked card(s) earn this bonus — the Czar's pick is still the big win. */
const FAV_POINTS = 200;

class CAHGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.phase = 'cah-submit';
    this.totalRounds = this.rounds(TOTAL_ROUNDS);
    this.whiteDeck = this.rng.shuffleIn(WHITE.slice());
    this.blackDeck = this.rng.shuffleIn(BLACK.slice());
    this.hands = new Map(); // playerId -> [cardText]
    this.blackCard = null;
    /** @type {string[]} everyone who has sat at the table, in order: the Czar goes round it */
    this.seats = [];
    /** @type {string | null} */
    this.czarId = null;
    /** @type {string | null} who picked the next prompt (kept even if they leave) */
    this.nextPickBy = null;
    this.submissions = new Map(); // playerId -> cardText
    /** @type {{ playerId: string, text: string, gone?: boolean }[]} shuffled at the czar phase (gone: its player left) */
    this.revealList = [];
    /** @type {{ playerId: string, nickname: string, text: string } | null} */
    this.winner = null;
    /** @type {Map<string, number>} voter → index into revealList */
    this.favVotes = new Map();
    /** @type {{ nickname: string, text: string, votes: number }[]} the room's favourite card(s) last round */
    this.favourites = [];

    for (const p of room.players.values()) {
      this.hands.set(p.id, this.drawWhite(HAND_SIZE));
    }
  }

  /** @param {number} n @returns {string[]} */
  drawWhite(n) {
    const got = library.draw('cah-white', n, { spicy: this.spicy() }).map((c) => c.text || '').filter(Boolean);
    while (got.length < n) {
      if (this.whiteDeck.length === 0) this.whiteDeck = this.rng.shuffleIn(WHITE.slice());
      const card = this.whiteDeck.pop();
      if (card) got.push(card);
    }
    return got;
  }

  drawBlack() {
    const c = library.drawOne('cah-black', { spicy: this.spicy() });
    if (c) return c.text;
    if (this.blackDeck.length === 0) this.blackDeck = this.rng.shuffleIn(BLACK.slice());
    return this.blackDeck.pop();
  }

  start() {
    this.nextRound();
  }

  get skippablePhases() { return ['cah-submit']; }

  // New prompt card, same Card Czar; played cards go back to their owners.
  skipQuestion() {
    if (this.phase !== 'cah-submit') return;
    this.returnCards();
    this.blackCard = this.drawBlack();
    this.pickedBy = null; // a fresh card: nobody chose it
    this.skipSeq = (this.skipSeq || 0) + 1;
    this.setTimer(SUBMIT_MS, () => this.submitTimeUp());
    this.push();
  }

  /** The next Czar round the table: the seat after the last Czar that's still here. (A cursor over
   * whoever is present skipped someone each time a player left.) */
  nextCzar() {
    for (const id of this.room.players.keys()) if (!this.seats.includes(id)) this.seats.push(id);
    const n = this.seats.length;
    if (!n) return null;
    const from = this.czarId ? this.seats.indexOf(this.czarId) : -1;
    for (let k = 1; k <= n; k++) {
      const id = this.seats[(from + k + n) % n];
      if (this.room.players.has(id)) return id;
    }
    return null;
  }

  /** Played cards go back to their owners (a round that never got judged). */
  returnCards() {
    for (const [id, text] of this.submissions) {
      const hand = this.hands.get(id);
      if (hand) hand.push(text);
    }
    this.submissions = new Map();
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
    this.pickedBy = prev && this.nextPick != null ? this.nextPickBy : null;
    this.blackCard = prev ? prev[this.nextPick != null ? this.nextPick : this.rng.int(0, prev.length - 1)] : this.drawBlack();
    this.czarId = this.nextCzar();
    this.nextOptions = this.round < this.totalRounds ? [this.drawBlack(), this.drawBlack(), this.drawBlack()] : null;
    this.nextPick = null;
    this.submissions = new Map();
    this.revealList = [];
    this.winner = null;
    this.phase = 'cah-submit';
    this.setTimer(SUBMIT_MS, () => this.submitTimeUp());
    this.push();
  }

  /** Time's up (or the TV pressed Skip): judge the cards that are in; with none, a new round. */
  submitTimeUp() {
    if (this.phase !== 'cah-submit') return;
    if (this.submissions.size) this.finishSubmitting(); else this.nextRound();
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
        this.nextPickBy = this.czarNickname();
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
      if (playerId !== this.czarId) {
        // Room favourite: one tap each, any card but your own.
        const f = payload.fav;
        if (this.favVotes.has(playerId) || !Number.isInteger(f) || f < 0 || f >= this.revealList.length) return;
        if (this.revealList[f].playerId === playerId || this.revealList[f].gone) return;
        this.favVotes.set(playerId, f);
        this.push();
        return;
      }
      const choice = payload.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= this.revealList.length || this.revealList[choice].gone) return;
      this.pickWinner(choice);
    }
  }

  finishSubmitting() {
    if (this.phase !== 'cah-submit') return;
    this.revealList = this.rng.shuffleIn(
      [...this.submissions.entries()].map(([playerId, text]) => ({ playerId, text }))
    );
    this.favVotes = new Map();
    this.favourites = [];
    this.phase = 'cah-czar';
    // The Czar is taking too long (or the TV pressed Skip): a card wins at random.
    this.setTimer(CZAR_MS, () => {
      const live = this.revealList.map((e, i) => (e.gone ? -1 : i)).filter((i) => i >= 0);
      if (live.length) this.pickWinner(this.rng.pick(live)); else this.nextRound();
    });
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
    this.awardFavourites();
    // Replenish everyone who played a card back up to HAND_SIZE.
    for (const playerId of this.submissions.keys()) {
      const hand = this.hands.get(playerId);
      if (hand) hand.push(...this.drawWhite(HAND_SIZE - hand.length));
    }
    this.phase = 'cah-reveal';
    this.setTimer(REVEAL_MS, () => this.nextRound(), false);
    this.push();
  }

  /** The card(s) with the most room votes (ties all count) get FAV_POINTS each. */
  awardFavourites() {
    /** @type {number[]} */
    const counts = this.revealList.map(() => 0);
    for (const [voter, i] of this.favVotes) if (counts[i] != null && this.room.players.has(voter)) counts[i] += 1;
    const top = Math.max(0, ...counts);
    this.favourites = [];
    if (!top) return;
    counts.forEach((n, i) => {
      if (n !== top || this.revealList[i].gone) return;
      const entry = this.revealList[i];
      const fp = this.room.players.get(entry.playerId);
      if (fp) fp.score += FAV_POINTS * this.mult();
      this.favourites.push({ nickname: fp ? fp.nickname : '(left the game)', text: entry.text, votes: n });
    });
  }

  /** @param {string} playerId */
  onPlayerLeft(playerId) {
    if (this.destroyed) return;
    this.hands.delete(playerId);
    this.submissions.delete(playerId);
    this.favVotes.delete(playerId);
    if (this.room.players.size === 0) return;
    // Their card can't win or be the favourite any more (points would go to nobody). It's marked,
    // not removed: phones pick cards by index.
    for (const e of this.revealList) if (e.playerId === playerId) e.gone = true;
    const judging = this.phase === 'cah-submit' || this.phase === 'cah-czar';
    if (playerId === this.czarId && judging) {
      // Czar vanished mid-round — no one left to judge: everyone gets their card back, next round.
      // (During the reveal the round is already decided: it plays out.)
      this.returnCards();
      this.nextRound();
      return;
    }
    if (this.phase === 'cah-submit' && (this.room.players.size < 2 || this.submissions.size >= this.neededSubmissions())) {
      if (this.room.players.size < 2) this.nextRound(); else this.finishSubmitting();
    } else if (this.phase === 'cah-czar' && this.revealList.every((e) => e.gone)) {
      this.nextRound(); // only the Czar is left with cards to judge: don't make them stare at nothing
    }
  }

  czarNickname() {
    const p = this.czarId ? this.room.players.get(this.czarId) : undefined;
    return p ? p.nickname : '???';
  }

  // --- views ---------------------------------------------------------------

  hostGameState() {
    const base = {
      ...this.base(),
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
          submissions: this.revealList.map((s, i) => ({ index: i, text: s.text, gone: !!s.gone })).filter((s) => !s.gone).map(({ index, text }) => ({ index, text })),
          favCount: [...this.favVotes.keys()].filter((id) => this.room.players.has(id)).length,
          // Who can still vote: everyone but the Czar who has someone else's card to pick.
          favNeeded: [...this.room.players.keys()].filter((id) => id !== this.czarId && this.revealList.some((e) => e.playerId !== id && !e.gone)).length,
        };
      case 'cah-reveal':
        return { ...base, winner: this.winner, favourites: this.favourites, favPoints: FAV_POINTS * this.mult() };
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
            // The Czar judges them all; everyone else sees them too, to pick a room favourite.
            submissions: this.revealList.map((s, i) => ({ index: i, text: s.text, mine: s.playerId === playerId, gone: !!s.gone })).filter((s) => !s.gone).map(({ gone, ...rest }) => rest),
          },
          you: { isCzar: playerId === this.czarId, fav: this.favVotes.has(playerId) ? this.favVotes.get(playerId) : null },
        };
      case 'cah-reveal':
        return { gameState: { ...base, winner: this.winner, favourites: this.favourites, favPoints: FAV_POINTS * this.mult() }, you: {} };
      case 'gameover':
        return { gameState: { ...base, standings: this.standings() }, you: {} };
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
