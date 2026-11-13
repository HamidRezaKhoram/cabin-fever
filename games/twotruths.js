/*
 * "Porch Confessions" — a fresh confession prompt every round ("The pettiest thing I've ever
 * done…"). Each phone secretly says TRUTH or LIE: truth-tellers confess something real, liars make
 * something up. Then everyone calls every answer: real, or made up? Points for good calls, and the
 * author earns for everyone they fool — so liars want to be believed and truth-tellers want a truth
 * so wild nobody buys it. New prompts and random roles every round keep it replayable.
 * (Was "two truths and a lie": inventing three facts about yourself every game wore thin.)
 * AGPLv3 — see LICENSE.
 */
'use strict';

const stats = require('./stats');
const library = require('./library');
const { BaseGame, cleanText } = require('./base');

const WRITE_MS = parseInt(process.env.RUMPUS_TT_WRITE_MS || '55000', 10);
const JUDGE_MS = parseInt(process.env.RUMPUS_TT_JUDGE_MS || '35000', 10);
const STEP_MS = parseInt(process.env.RUMPUS_TT_STEP_MS || '3200', 10);
const RIGHT = 100, FOOLED = 50;

const BUILTIN = [
  'The pettiest thing I\'ve ever done', 'The worst haircut I\'ve ever had', 'The strangest thing I believed as a kid',
  'The dumbest way I\'ve ever hurt myself', 'My most irrational fear', 'A time I got away with something',
];

class TwoTruthsGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(3);
    this.prompt = '';
    /** @type {Map<string, boolean>} who must lie this round */
    this.liars = new Map();
    /** @type {Map<string, { text: string, lie: boolean }>} */
    this.answers = new Map();
    /** @type {Map<string, Map<string, boolean>>} voter → author → "it's true" */
    this.calls = new Map();
    /** @type {string[]} reveal order (authors) */
    this.order = [];
    this.revealIndex = -1;
    /** @type {{ author: string, text: string, lie: boolean, believed: string[], doubted: string[], gained: number }[]} */
    this.revealed = [];
    /** @type {Map<string, number>} points this round */
    this.gained = new Map();
    this.poolName = 'confessions';
    /** @type {PoolItem | null} */
    this.item = null;
    /** fewer than two confessions came in this round */
    this.empty = false;
    /** this round is already a replay of an empty one (replay once only) */
    this.retried = false;
  }

  start() { this.nextRound(); }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    const item = library.drawOne('confessions', { spicy: this.spicy() });
    this.item = item;
    this.prompt = (item && item.text) || BUILTIN[(this.round - 1) % BUILTIN.length];
    // Secret roles: about half lie (never nobody, never everyone), different every round.
    const ids = this.rng.shuffle(this.playerIds());
    const n = ids.length;
    const liars = n <= 1 ? 0 : this.rng.int(Math.max(1, Math.floor(n * 0.3)), Math.max(1, Math.ceil(n * 0.6)));
    this.liars = new Map(ids.map((id, i) => [id, i < Math.min(n - 1, liars)]));
    this.answers = new Map();
    this.calls = new Map();
    this.order = [];
    this.revealIndex = -1;
    this.revealed = [];
    this.gained = new Map();
    this.empty = false;
    this.phase = 'tt-write';
    this.setTimer(WRITE_MS, () => this.judge());
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase === 'tt-write') {
      // Nothing true comes to mind: a truth-teller may switch to lying (never the other way).
      // …as long as someone else is still telling the truth (a round of only lies isn't the game).
      if (payload.switchToLie && !this.answers.has(id) && this.liars.get(id) === false) {
        if ([...this.liars.values()].filter((v) => !v).length < 2) return;
        this.liars.set(id, true);
        return this.push();
      }
      const text = cleanText(payload.text, 110);
      if (!text || this.answers.has(id) || !this.liars.has(id)) return;
      this.answers.set(id, { text, lie: !!this.liars.get(id) });
      if (this.allIn(this.answers)) return this.judge();
      return this.push();
    }
    if (this.phase === 'tt-judge') {
      if (this.calls.has(id) || !payload.calls || typeof payload.calls !== 'object') return;
      /** @type {Map<string, boolean>} */
      const mine = new Map();
      for (const [author, v] of Object.entries(payload.calls)) {
        if (author !== id && this.answers.has(author) && typeof v === 'boolean') mine.set(author, v);
      }
      if (!mine.size && this.answers.size > (this.answers.has(id) ? 1 : 0)) return;
      this.calls.set(id, mine);
      if (this.allIn(this.calls)) return this.reveal();
      this.push();
    }
  }

  judge() {
    if (this.phase !== 'tt-write') return;
    if (this.answers.size < 2) {
      // Nothing to judge. Say so on the TV (it used to just move on), and play the round again once
      // with a new prompt so a quiet round — the last one included — isn't simply lost.
      this.clearTimer();
      if (!this.retried) { this.retried = true; this.round -= 1; } else this.retried = false;
      this.empty = true;
      this.order = [];
      this.revealIndex = 0;
      this.phase = 'tt-reveal';
      this.setTimer(STEP_MS, () => this.nextRound(), false);
      return this.push();
    }
    this.retried = false;
    this.order = this.rng.shuffle([...this.answers.keys()]);
    this.phase = 'tt-judge';
    this.setTimer(JUDGE_MS, () => this.reveal());
    this.push();
  }

  reveal() {
    if (this.phase !== 'tt-judge') return;
    this.phase = 'tt-reveal';
    this.step();
  }

  /** Flip the next answer: real or made up? */
  step() {
    this.revealIndex += 1;
    if (this.revealIndex >= this.order.length) {
      this.setTimer(STEP_MS, () => this.nextRound(), false);
      return this.push();
    }
    const author = this.order[this.revealIndex];
    const a = /** @type {{ text: string, lie: boolean }} */ (this.answers.get(author));
    /** @type {string[]} */
    const believed = [];
    /** @type {string[]} */
    const doubted = [];
    for (const [voter, mine] of this.calls) {
      if (!mine.has(author)) continue;
      const callTrue = /** @type {boolean} */ (mine.get(author));
      (callTrue ? believed : doubted).push(voter);
      if (callTrue === !a.lie) this.give(voter, RIGHT);
    }
    const fooled = a.lie ? believed.length : doubted.length;
    const gained = this.give(author, fooled * FOOLED);
    stats.feat(this.room, author, 'fooled', fooled);
    if (fooled >= 2) stats.highlight(this.room, { game: 'Porch Confessions', text: `${this.prompt}: ${a.text}`, by: this.nick(author), note: a.lie ? `a lie that fooled ${fooled}` : `a truth ${fooled} didn't believe` });
    this.revealed.push({ author: this.nick(author), text: a.text, lie: a.lie, believed: believed.map((x) => this.nick(x)), doubted: doubted.map((x) => this.nick(x)), gained });
    this.setTimer(STEP_MS, () => this.step(), false);
    this.push();
  }

  /** @param {string} id @param {number} pts */
  give(id, pts) {
    if (!pts) return 0;
    const real = this.award(id, pts);
    this.gained.set(id, (this.gained.get(id) || 0) + real);
    return real;
  }

  /** @param {string} id */
  onPlayerLeft(id) {
    this.liars.delete(id);
    // While writing, their confession leaves with them (once judging starts it stays: it's on the TV).
    if (this.phase === 'tt-write') this.answers.delete(id);
    if (this.phase === 'tt-write' && this.room.players.size && this.allIn(this.answers)) this.judge();
    else if (this.phase === 'tt-judge' && this.room.players.size && this.allIn(this.calls)) this.reveal();
  }

  /** The answers to judge (in reveal order), without who lied. */
  list() {
    return this.order.filter((id) => this.answers.has(id)).map((id) => ({ id, nickname: this.nick(id), text: /** @type {{ text: string }} */ (this.answers.get(id)).text }));
  }

  waitingOn(/** @type {{ has(id: string): boolean }} */ set) {
    return [...this.room.players.values()].filter((p) => p.connected && !set.has(p.id)).map((p) => p.nickname);
  }

  /** How many people still here are in `set` (a leaver's entry mustn't show "3 / 2 in"). @param {{ has(id: string): boolean }} set */
  present(set) {
    return this.playerIds().filter((id) => set.has(id)).length;
  }

  hostView() {
    const base = { prompt: this.prompt };
    if (this.phase === 'tt-write') return { ...base, submittedCount: this.present(this.answers), totalPlayers: this.room.players.size, waitingOn: this.waitingOn(this.answers) };
    if (this.phase === 'tt-judge') return { ...base, answers: this.list().map(({ nickname, text }) => ({ nickname, text })), judgedCount: this.present(this.calls), totalPlayers: this.room.players.size, waitingOn: this.waitingOn(this.calls) };
    const cur = this.revealed[this.revealIndex] || null;
    return { ...base, current: cur, revealed: this.revealed, total: this.order.length, done: this.revealIndex >= this.order.length, empty: !!this.empty,
      gained: this.revealIndex >= this.order.length ? [...this.gained].filter(([id]) => this.room.players.has(id)).map(([id, g]) => ({ nickname: this.nick(id), gained: g })).sort((a, b) => b.gained - a.gained) : null };
  }

  /** @param {string} id */
  playerOnly(id) {
    const base = { prompt: this.prompt };
    if (this.phase === 'tt-write') {
      return { gameState: base, you: { lie: !!this.liars.get(id), submitted: this.answers.has(id), canSwitch: this.liars.get(id) === false && !this.answers.has(id) && [...this.liars.values()].filter((v) => !v).length >= 2 } };
    }
    if (this.phase === 'tt-judge') {
      return { gameState: { ...base, answers: this.list().filter((a) => a.id !== id) }, you: { judged: this.calls.has(id), mine: this.answers.has(id) ? /** @type {{ text: string }} */ (this.answers.get(id)).text : null } };
    }
    const cur = this.revealed[this.revealIndex] || null;
    return {
      gameState: { ...base, current: cur, done: this.revealIndex >= this.order.length, empty: !!this.empty },
      you: { gained: this.gained.get(id) || 0, isAuthor: !!cur && cur.author === this.nick(id),
        right: !!cur && (cur.believed.includes(this.nick(id)) ? !cur.lie : cur.doubted.includes(this.nick(id)) ? cur.lie : null) },
    };
  }
}

TwoTruthsGame.meta = {
  id: 'twotruths',
  name: 'Porch Confessions',
  blurb: 'A new confession every round — your phone secretly tells you to tell the truth or lie. Who\'s making it up?',
  minPlayers: 3,
};

module.exports = TwoTruthsGame;
