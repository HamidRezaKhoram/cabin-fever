/*
 * "Doodle Telephone" — write a phrase, pass it on; the next person draws it,
 * the next describes the drawing, and so on. Watch the chains mutate on the
 * TV, then vote for the best doodle. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame, shuffle, cleanText } = require('./base');
const library = require('./library');

const FALLBACK = ([
  'A moose doing yoga', 'Grandma on a skateboard', 'A haunted canoe', 'Pizza delivery in space',
  'A shark at a job interview', 'Raccoons robbing a bank', 'A snowman on vacation',
  'The world\'s tiniest horse', 'A wizard stuck in traffic', 'A cat running for president',
  'Dinosaur birthday party', 'A very sad campfire', 'Robot learning to dance',
  'A loon wearing sunglasses', 'Bigfoot taking a selfie', 'An angry cloud', 'Fishing for socks',
  'A volcano sneezing', 'Ghost doing laundry', 'Penguins on a roller coaster',
]);

const WRITE_MS = parseInt(process.env.RUMPUS_TEL_WRITE_MS || '45000', 10);
const DRAW_MS = parseInt(process.env.RUMPUS_TEL_DRAW_MS || '80000', 10);
const DESCRIBE_MS = parseInt(process.env.RUMPUS_TEL_DESCRIBE_MS || '40000', 10);
const ENTRY_SHOW_MS = parseInt(process.env.RUMPUS_TEL_ENTRY_MS || '3500', 10);
const VOTE_MS = parseInt(process.env.RUMPUS_TEL_VOTE_MS || '30000', 10);
const MAX_IMAGE = 400 * 1024;

function validImage(s) {
  return typeof s === 'string' && s.length < MAX_IMAGE && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
}

class TelephoneGame extends BaseGame {
  constructor(room, push) {
    super(room, push);
    this.order = shuffle(this.playerIds());
    this.n = this.order.length;
    this.totalRounds = this.n; // one "round" per step
    this.chains = this.order.map((owner) => ({ owner, entries: [] }));
    this.doubleFinal = false;
    const ideas = library.draw('telephone', this.order.length, { spicy: this.spicy() });
    this.suggestions = new Map(this.order.map((id, i) => [id, ideas[i] ? ideas[i].text : FALLBACK[i % FALLBACK.length]]));
    this.step = -1;
    this.done = new Map();
  }

  start() { this.nextStep(); }

  stepType(k) {
    if (k === 0) return 'write';
    return k % 2 === 1 ? 'draw' : 'describe';
  }

  // Which chain does seat j work on at step k?
  chainFor(id, k = this.step) {
    const j = this.order.indexOf(id);
    if (j < 0) return null;
    return ((j - k) % this.n + this.n) % this.n;
  }

  nextStep() {
    this.step += 1;
    this.round = this.step + 1;
    if (this.step >= this.n) return this.beginReveal();
    this.done = new Map();
    const type = this.stepType(this.step);
    this.phase = 'tel-' + type;
    const ms = type === 'write' ? WRITE_MS : type === 'draw' ? DRAW_MS : DESCRIBE_MS;
    this.setTimer(ms, () => this.finishStep());
    this.push();
  }

  finishStep() {
    if (!this.phase.startsWith('tel-') || this.phase === 'tel-reveal' || this.phase === 'tel-vote') return;
    const type = this.stepType(this.step);
    // Fill gaps for anyone who didn't submit (or left).
    for (const id of this.order) {
      const c = this.chains[this.chainFor(id)];
      if (c.entries.length > this.step) continue;
      c.entries.push({
        type: type === 'draw' ? 'drawing' : 'text',
        by: id,
        content: type === 'draw' ? null : (type === 'write' ? this.suggestions.get(id) : '(no guess)'),
        auto: true,
      });
    }
    this.nextStep();
  }

  handleSubmit(id, payload) {
    if (this.phase === 'tel-vote') return this.handleVote(id, payload);
    if (!['tel-write', 'tel-draw', 'tel-describe'].includes(this.phase)) return;
    if (this.done.has(id)) return;
    const ci = this.chainFor(id);
    if (ci == null) return;
    const chain = this.chains[ci];
    if (chain.entries.length !== this.step) return;
    let entry;
    if (this.phase === 'tel-draw') {
      if (!validImage(payload.image)) return;
      entry = { type: 'drawing', by: id, content: payload.image };
    } else {
      const text = cleanText(payload.text, 80);
      if (!text) return;
      entry = { type: 'text', by: id, content: text };
    }
    chain.entries.push(entry);
    this.done.set(id, true);
    if (this.allIn(this.done)) this.finishStep();
    else this.push();
  }

  beginReveal() {
    this.phase = 'tel-reveal';
    this.revealIndex = 0;
    this.scheduleReveal();
    this.push();
  }

  scheduleReveal() {
    const c = this.chains[this.revealIndex];
    this.setTimer(ENTRY_SHOW_MS * (c.entries.length + 1), () => this.advanceReveal(), false);
  }

  advanceReveal() {
    this.revealIndex += 1;
    if (this.revealIndex >= this.chains.length) return this.beginVote();
    this.scheduleReveal();
    this.push();
  }

  drawings() {
    const list = [];
    this.chains.forEach((c, ci) => c.entries.forEach((e, ei) => {
      if (e.type === 'drawing' && e.content) list.push({ key: `${ci}:${ei}`, by: e.by, image: e.content });
    }));
    return list;
  }

  beginVote() {
    this.drawingList = this.drawings();
    this.votes = new Map();
    if (this.drawingList.length < 2) return this.gameOver();
    this.phase = 'tel-vote';
    this.setTimer(VOTE_MS, () => this.finishVote());
    this.push();
  }

  handleVote(id, payload) {
    if (this.votes.has(id)) return;
    const d = this.drawingList.find((x) => x.key === payload.key);
    if (!d || d.by === id) return;
    this.votes.set(id, d.key);
    const canVote = this.playerIds().filter((pid) => this.drawingList.some((x) => x.by !== pid));
    if (canVote.every((pid) => this.votes.has(pid))) this.finishVote();
    else this.push();
  }

  finishVote() {
    if (this.phase !== 'tel-vote') return;
    for (const key of this.votes.values()) {
      const d = this.drawingList.find((x) => x.key === key);
      if (d) this.award(d.by, 200);
    }
    this.gameOver();
  }

  onPlayerLeft() {
    if (['tel-write', 'tel-draw', 'tel-describe'].includes(this.phase)) {
      if (this.room.players.size && this.allIn(this.done)) this.finishStep();
    }
  }

  // --- views ---------------------------------------------------------------

  chainView(c) {
    return {
      owner: this.nick(c.owner),
      entries: c.entries.map((e) => ({ type: e.type, by: this.nick(e.by), content: e.content })),
    };
  }

  hostView() {
    if (this.phase === 'tel-reveal') {
      return {
        chainIndex: this.revealIndex,
        chainCount: this.chains.length,
        chain: this.chainView(this.chains[this.revealIndex]),
        entryMs: ENTRY_SHOW_MS,
      };
    }
    if (this.phase === 'tel-vote') {
      return {
        drawings: this.drawingList.map((d) => ({ key: d.key, image: d.image })),
        votedCount: this.votes.size,
        totalPlayers: this.room.players.size,
      };
    }
    return {
      stepType: this.stepType(this.step),
      submittedCount: this.done.size,
      totalPlayers: this.room.players.size,
    };
  }

  playerOnly(id) {
    if (this.phase === 'tel-reveal') return { gameState: {}, you: {} };
    if (this.phase === 'tel-vote') {
      return {
        gameState: { drawings: this.drawingList.filter((d) => d.by !== id).map((d) => ({ key: d.key, image: d.image })) },
        you: { voted: this.votes.has(id) },
      };
    }
    const ci = this.chainFor(id);
    if (ci == null) return { gameState: { stepType: 'spectate' }, you: { submitted: true } };
    const prev = this.step > 0 ? this.chains[ci].entries[this.step - 1] : null;
    return {
      gameState: {
        stepType: this.stepType(this.step),
        step: this.step,
        prev: prev ? { type: prev.type, content: prev.content } : null,
      },
      you: { submitted: this.done.has(id), suggestion: this.suggestions.get(id) },
    };
  }
}

TelephoneGame.meta = {
  id: 'telephone',
  name: 'Doodle Telephone',
  blurb: 'Write, draw, describe, repeat. Watch your phrase get hilariously mangled.',
  minPlayers: 3,
};

module.exports = TelephoneGame;
