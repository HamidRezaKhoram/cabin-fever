/*
 * "Campfire Quips" — head-to-head comedy. Every round each player answers two
 * prompts; every prompt is answered by exactly two players. Then the
 * matchups are shown one at a time and everyone else votes for the funnier
 * answer. 100 per vote, +250 SHUTOUT when one answer takes every vote
 * (2+ voters). Final round is worth double. AGPLv3 — see LICENSE.
 */
'use strict';

const stats = require('./stats');

const library = require('./library');
const { BaseGame, cleanText } = require('./base');

const PROMPTS = [
  'The worst thing to say on a first date', 'The real reason the dinosaurs went extinct',
  'A rejected flavour of sports drink', 'The worst possible name for a cruise ship',
  'Something you should never say to your barber', 'A terrible slogan for a funeral home',
];

const ANSWER_MS = parseInt(process.env.RUMPUS_ANSWER_MS || '75000', 10);
const VOTE_MS = parseInt(process.env.RUMPUS_VOTE_MS || '20000', 10);
const RESULTS_MS = parseInt(process.env.RUMPUS_RESULTS_MS || '7000', 10);
const TOTAL_ROUNDS = parseInt(process.env.RUMPUS_ROUNDS || '2', 10);
const POINTS_PER_VOTE = 100;
const SHUTOUT_BONUS = 250;
/** Side bets an author can place on their own matchup while the room votes. */
const SIDE_BETS = {
  win: { label: "I'll win", win: 100, lose: 50 },
  landslide: { label: 'Landslide (75%+)', win: 250, lose: 100 },
};

/** @typedef {{ prompt: string, authors: string[], answers: (string | null)[] }} Matchup */
/** @typedef {{ text: string, nickname: string, votes: number, gained: number, shutout: boolean, shutoutPts: number, pct: number, voters: string[], bet: { kind: string, label: string, won: boolean, pts: number } | null }} Side */

class QuiplashGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(TOTAL_ROUNDS);
    /** @type {Matchup[]} */
    this.matchups = [];
    /** @type {Map<string, { mi: number, side: number }[]>} each author's two prompts */
    this.todo = new Map();
    this.matchIndex = -1;
    /** @type {Map<string, number>} voter → side */
    this.votes = new Map();
    /** @type {Map<string, string>} author → side bet */
    this.bets = new Map();
    /** @type {{ prompt: string, sides: Side[], winner: number } | null} */
    this.result = null;
  }

  start() { this.nextRound(); }

  get skippablePhases() { return ['answering']; }

  // Round 1 ×1, later rounds ×2, and the very last matchup of the game ×3.
  mult() {
    if (this.round < 2 && this.totalRounds > 1) return 1;
    if (this.totalRounds < 2) return 1;
    const last = this.round === this.totalRounds && this.matchups && this.matchIndex === this.matchups.length - 1;
    return last ? 3 : 2;
  }

  /** The music's stage follows Quips' own stakes (×1, ×2, the last matchup ×3), not the generic one. */
  base() {
    return { ...super.base(), stage: this.mult() };
  }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    let ids = this.rng.shuffleIn(this.playerIds());
    // Team mode: alternate red/blue around the circle so neighbours (= matchups) are rivals.
    if (this.room.settings && this.room.settings.teams) {
      const team = (/** @type {string} */ id) => (this.room.players.get(id) || {}).team;
      const red = ids.filter((id) => team(id) === 'red'), blue = ids.filter((id) => team(id) !== 'red');
      ids = [];
      while (red.length || blue.length) { const r = red.shift(), b = blue.shift(); if (r) ids.push(r); if (b) ids.push(b); }
    }
    const n = ids.length;
    const drawn = library.draw('punchline', n, { spicy: this.spicy(), lang: this.room.settings.lang });
    // Prompt k is answered by players k and k+1 (mod n): everyone gets 2 prompts.
    this.matchups = ids.map((id, k) => ({
      prompt: (drawn[k] && drawn[k].text) || PROMPTS[(this.round * n + k) % PROMPTS.length],
      authors: [ids[k], ids[(k + 1) % n]],
      answers: /** @type {(string | null)[]} */ ([null, null]),
    }));
    this.todo = new Map(ids.map((id) => [id, []]));
    this.matchups.forEach((m, mi) => m.authors.forEach((a, side) => { const list = this.todo.get(a); if (list) list.push({ mi, side }); }));
    for (const list of this.todo.values()) this.rng.shuffleIn(list);
    this.matchIndex = -1;
    this.phase = 'answering';
    this.setTimer(ANSWER_MS, () => this.startVoting());
    this.push();
  }

  /** @param {string} id */
  remaining(id) {
    return (this.todo.get(id) || []).filter(({ mi, side }) => this.matchups[mi].answers[side] == null);
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase === 'answering') {
      const text = cleanText(payload.text, 100);
      const next = this.remaining(id)[0];
      if (!text || !next) return;
      this.matchups[next.mi].answers[next.side] = text;
      if (this.playerIds().every((p) => this.remaining(p).length === 0)) this.startVoting();
      else this.push();
    } else if (this.phase === 'voting' && payload.bet !== undefined) {
      // Authors aren't idle while the room votes: a side bet on their own matchup.
      const m = this.matchIndex == null ? undefined : this.matchups[this.matchIndex];
      const bets = this.bets;
      if (!m || !bets || !m.authors.includes(id) || bets.has(id) || typeof payload.bet !== 'string' || !Object.prototype.hasOwnProperty.call(SIDE_BETS, payload.bet)) return;
      bets.set(id, payload.bet);
      this.push();
    } else if (this.phase === 'voting') {
      const m = this.matchups[this.matchIndex];
      const c = payload.choice;
      if (m.authors.includes(id) || this.votes.has(id) || (c !== 0 && c !== 1)) return;
      this.votes.set(id, c);
      if (this.voters().every((v) => this.votes.has(v))) this.finishMatchup();
      else this.push();
    }
  }

  voters() {
    const m = this.matchups[this.matchIndex];
    return this.playerIds().filter((p) => !m.authors.includes(p));
  }

  startVoting() {
    if (this.phase !== 'answering') return;
    this.nextMatchup();
  }

  nextMatchup() {
    this.matchIndex += 1;
    if (this.matchIndex >= this.matchups.length) return this.nextRound();
    const m = this.matchups[this.matchIndex];
    this.votes = new Map();
    this.bets = new Map();
    // Forfeits: if one or both players didn't answer, skip straight to results.
    if (m.answers[0] == null || m.answers[1] == null || this.voters().length === 0) return this.finishMatchup();
    this.phase = 'voting';
    this.setTimer(VOTE_MS, () => this.finishMatchup());
    this.push();
  }

  finishMatchup() {
    const m = this.matchups[this.matchIndex];
    const tally = [0, 0];
    for (const c of this.votes.values()) tally[c] += 1;
    const voterCount = this.voters().length;
    // A missing answer forfeits: the other side takes every vote.
    if (m.answers[0] == null && m.answers[1] != null) { tally[1] = voterCount; tally[0] = 0; }
    if (m.answers[1] == null && m.answers[0] != null) { tally[0] = voterCount; tally[1] = 0; }
    const totalVotes = tally[0] + tally[1];
    // A forfeit takes the votes (the points) but isn't a SHUTOUT: nobody chose it over anything.
    const forfeit = m.answers[0] == null || m.answers[1] == null;
    /** @param {number} i @returns {Side} */
    const side = (i) => {
      const id = m.authors[i];
      const shutout = !forfeit && totalVotes >= 2 && tally[i] === totalVotes;
      const gained = this.award(id, tally[i] * POINTS_PER_VOTE + (shutout ? SHUTOUT_BONUS : 0));
      return {
        text: m.answers[i] ?? '(no answer — forfeit!)',
        nickname: this.nick(id), votes: tally[i], gained, shutout, shutoutPts: shutout ? SHUTOUT_BONUS * this.mult() : 0,
        pct: totalVotes ? Math.round((tally[i] / totalVotes) * 100) : 0,
        voters: [...this.votes].filter(([, c]) => c === i).map(([v]) => this.nick(v)),
        bet: null,
      };
    };
    const sides = [side(0), side(1)];
    // Side bets: "I'll win" / "Landslide" (75%+ of the votes). Losses never take a score below 0.
    const bets = this.bets || new Map();
    sides.forEach((sd, i) => {
      const author = /** @type {string} */ (m.authors[i]);
      const kind = bets.get(author);
      if (!kind) return;
      const bet = SIDE_BETS[/** @type {keyof typeof SIDE_BETS} */ (kind)];
      const won = kind === 'landslide' ? totalVotes > 0 && tally[i] / totalVotes >= 0.75 : tally[i] > tally[1 - i];
      const p = this.room.players.get(author);
      let pts;
      if (won) pts = this.award(author, bet.win);
      else { pts = -(p ? Math.min(p.score, bet.lose * this.mult()) : 0); if (p) p.score += pts; } // same stakes as a win
      sd.bet = { kind, label: bet.label, won, pts };
      sd.gained += pts;
    });
    sides.forEach((sd, i) => { if (sd.shutout) stats.feat(this.room, m.authors[i], 'shutouts'); });
    const best = tally[0] === tally[1] ? -1 : tally[0] > tally[1] ? 0 : 1;
    if (best >= 0 && sides[best].votes > 0 && !forfeit) {
      stats.highlight(this.room, { game: 'Campfire Quips', prompt: m.prompt, text: sides[best].text, by: sides[best].nickname,
        note: `${sides[best].votes} vote${sides[best].votes === 1 ? '' : 's'}${sides[best].shutout ? ' · SHUTOUT' : ''}` });
    }
    this.result = {
      prompt: m.prompt,
      sides,
      winner: tally[0] === tally[1] ? -1 : tally[0] > tally[1] ? 0 : 1,
    };
    this.phase = 'results';
    this.setTimer(RESULTS_MS, () => this.nextMatchup(), false);
    this.push();
  }

  onPlayerLeft() {
    if (this.phase === 'answering' && this.room.players.size && this.playerIds().every((p) => this.remaining(p).length === 0)) {
      this.startVoting();
    } else if (this.phase === 'voting' && this.voters().every((v) => this.votes.has(v))) {
      this.finishMatchup();
    }
  }

  // --- views ---------------------------------------------------------------

  hostView() {
    if (this.phase === 'answering') {
      const need = this.matchups.length * 2;
      const done = this.matchups.reduce((n, m) => n + m.answers.filter((a) => a != null).length, 0);
      return { submittedCount: done, totalAnswers: need, totalPlayers: this.room.players.size, matchCount: this.matchups.length };
    }
    const m = this.matchups[this.matchIndex];
    const common = { prompt: m.prompt, matchIndex: this.matchIndex, matchCount: this.matchups.length };
    if (this.phase === 'voting') {
      return { ...common, answers: m.answers.map((text) => ({ text })), votedCount: this.votes.size, voterCount: this.voters().length };
    }
    return { ...common, result: this.result };
  }

  /** @param {string} id */
  playerOnly(id) {
    if (this.phase === 'answering') {
      const left = this.remaining(id);
      const next = left[0];
      return {
        gameState: { prompt: next ? this.matchups[next.mi].prompt : null, promptNumber: 3 - left.length, promptTotal: 2 },
        you: { submitted: !next },
      };
    }
    const m = this.matchups[this.matchIndex];
    if (this.phase === 'voting') {
      return {
        gameState: { prompt: m.prompt, answers: m.answers.map((text) => ({ text })) },
        you: { isAuthor: m.authors.includes(id), voted: this.votes.has(id), bet: this.bets ? this.bets.get(id) || null : null },
      };
    }
    const mine = m.authors.indexOf(id);
    return { gameState: { prompt: m.prompt, result: this.result }, you: { side: mine } };
  }
}

QuiplashGame.meta = {
  id: 'quiplash',
  name: 'Campfire Quips',
  blurb: 'Head-to-head comedy: two players, one prompt, everyone else votes.',
  minPlayers: 3,
};

module.exports = QuiplashGame;
