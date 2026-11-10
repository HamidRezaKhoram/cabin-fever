/*
 * "Most Likely To" — everyone votes which player best fits the prompt.
 * You score by voting with the crowd. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame } = require('./base');
const library = require('./library');

const BUILTIN = [
  'Who is most likely to get lost on a hiking trail?',
  'Who is most likely to survive a zombie apocalypse?',
  'Who is most likely to accidentally become famous?',
  'Who is most likely to eat the last snack without asking?',
  'Who is most likely to adopt way too many pets?',
  'Who is most likely to fall asleep first tonight?',
  'Who is most likely to win a staring contest with a moose?',
  'Who is most likely to start a conversation with a stranger?',
  'Who is most likely to cry at a commercial?',
  'Who is most likely to forget their own birthday?',
  'Who is most likely to become a millionaire?',
  'Who is most likely to get kicked out of a library?',
  'Who is most likely to bring way too much luggage?',
  'Who is most likely to burn the toast?',
  'Who is most likely to talk their way out of a speeding ticket?',
  'Who is most likely to secretly be a superhero?',
  'Who is most likely to fall into the lake fully clothed?',
  'Who is most likely to win a reality TV show?',
  'Who is most likely to reply to a text three days later?',
  'Who is most likely to know every word of a cheesy song?',
  'Who is most likely to get scared by their own reflection?',
  'Who is most likely to build a raft and sail away?',
  'Who is most likely to befriend a raccoon?',
  'Who is most likely to win at board games and gloat about it?',
  'Who is most likely to take 200 photos of one sunset?',
  'Who is most likely to argue with a GPS?',
  'Who is most likely to start a band?',
  'Who is most likely to eat something off the floor?',
  'Who is most likely to plan the whole trip in a spreadsheet?',
  'Who is most likely to laugh at the worst possible moment?',
];

const VOTE_MS = parseInt(process.env.RUMPUS_ML_VOTE_MS || '25000', 10);
const REVEAL_MS = parseInt(process.env.RUMPUS_REVEAL_MS || '7000', 10);

class MostLikelyGame extends BaseGame {
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(6);
  }

  start() { this.nextRound(); }

  get skippablePhases() { return ['ml-vote']; }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    const item = library.drawOne('mostlikely', { spicy: this.spicy() });
    this.prompt = item ? item.text : BUILTIN[this.round % BUILTIN.length];
    this.spicyRound = !!(item && item.a);
    this.votes = new Map(); // voter -> target
    this.result = null;
    this.phase = 'ml-vote';
    this.setTimer(VOTE_MS, () => this.reveal());
    this.push();
  }

  handleSubmit(id, payload) {
    if (this.phase !== 'ml-vote' || this.votes.has(id)) return;
    const target = payload.target;
    if (!this.room.players.has(target)) return;
    this.votes.set(id, target);
    if (this.allIn(this.votes)) this.reveal();
    else this.push();
  }

  reveal() {
    if (this.phase !== 'ml-vote') return;
    const tally = new Map();
    for (const t of this.votes.values()) tally.set(t, (tally.get(t) || 0) + 1);
    const max = Math.max(0, ...tally.values());
    const top = [...tally.entries()].filter(([, n]) => n === max && max > 0).map(([t]) => t);
    const topSet = new Set(top);
    const gained = [];
    for (const [voter, t] of this.votes) {
      if (topSet.has(t)) {
        gained.push({ nickname: this.nick(voter), gained: this.award(voter, 100) });
      }
    }
    this.result = {
      tally: [...tally.entries()]
        .map(([t, n]) => ({ id: t, nickname: this.nick(t), votes: n, voters: [...this.votes].filter(([, x]) => x === t).map(([v]) => this.nick(v)) }))
        .sort((a, b) => b.votes - a.votes),
      winners: top.map((t) => this.nick(t)),
      topIds: top,
      gained,
    };
    this.phase = 'ml-reveal';
    this.setTimer(REVEAL_MS, () => this.nextRound(), false);
    this.push();
  }

  onPlayerLeft(id) {
    if (this.phase !== 'ml-vote') return;
    for (const [v, t] of this.votes) if (v === id || t === id) this.votes.delete(v);
    if (this.room.players.size && this.allIn(this.votes)) this.reveal();
  }

  targets() {
    return [...this.room.players.values()].map((p) => ({ id: p.id, nickname: p.nickname }));
  }

  hostView() {
    if (this.phase === 'ml-vote') {
      return { prompt: this.prompt, votedCount: this.votes.size, totalPlayers: this.room.players.size };
    }
    return { prompt: this.prompt, result: this.result };
  }

  playerOnly(id) {
    if (this.phase === 'ml-vote') {
      return { gameState: { prompt: this.prompt, targets: this.targets() }, you: { voted: this.votes.has(id) } };
    }
    const mine = this.votes.get(id);
    return {
      gameState: { prompt: this.prompt, result: this.result },
      you: { withCrowd: mine != null && this.result.topIds.includes(mine), picked: mine != null },
    };
  }
}

MostLikelyGame.meta = {
  id: 'mostlikely',
  name: 'Most Likely To',
  blurb: 'Vote which friend fits the prompt. Score by agreeing with the crowd.',
  minPlayers: 3,
};

module.exports = MostLikelyGame;
