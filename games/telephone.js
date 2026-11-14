/*
 * "Message in a Bottle" — write a phrase, pass it on; the next person draws it,
 * the next describes the drawing, and so on. Watch the chains mutate on the
 * TV, then vote for the best doodle. AGPLv3 — see LICENSE.
 */
'use strict';

const stats = require('./stats');

const { BaseGame, cleanText } = require('./base');
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
const DRAW_MS = parseInt(process.env.RUMPUS_TEL_DRAW_MS || '45000', 10); // playtests: 80 s, then 60 s, left the fast drawers idle
const DESCRIBE_MS = parseInt(process.env.RUMPUS_TEL_DESCRIBE_MS || '40000', 10);
const ENTRY_SHOW_MS = parseInt(process.env.RUMPUS_TEL_ENTRY_MS || '3500', 10);
const VOTE_MS = parseInt(process.env.RUMPUS_TEL_VOTE_MS || '30000', 10);
/** Scribble pad: doodles per player per step, and how many float on the TV at once. */
const SCRIBBLES_PER_STEP = 3;
const SCRIBBLES_SHOWN = 6;
// After each chain is shown, everyone taps their favourite step (not their own): +50 to its author.
const FAV_MS = parseInt(process.env.RUMPUS_TEL_FAV_MS || '10000', 10);
const FAV_PTS = 50;
const SPLIT_AT = 6;
const MAX_IMAGE = 400 * 1024;

/** @param {unknown} s @returns {s is string} */
function validImage(s) {
  return typeof s === 'string' && s.length < MAX_IMAGE && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
}

/** @typedef {{ type: 'text' | 'drawing', by: string, content: string | null, auto?: boolean }} Entry */
/** @typedef {{ owner: string, entries: Entry[] }} Chain */
/** @typedef {{ key: string, by: string, image: string }} Drawing */

class TelephoneGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.order = this.rng.shuffleIn(this.playerIds());
    this.n = this.order.length;
    // 6+ players: two groups pass chains among themselves, so chains stay short and
    // the reveal comes sooner (playtest: one long chain each left people idle for 80 s).
    this.split = this.n >= SPLIT_AT ? Math.floor(this.n / 2) : 0;
    this.steps = this.split ? Math.min(this.split, this.n - this.split) : this.n;
    this.totalRounds = this.steps; // one "round" per step
    /** @type {Chain[]} */
    this.chains = this.order.map((owner) => ({ owner, entries: /** @type {Entry[]} */ ([]) }));
    this.doubleFinal = false;
    /** Scribble pad (todo 3.1): doodles from players who are done with a step float across the TV.
     * @type {{ key: number, by: string, image: string }[]} */
    this.scribbles = [];
    /** @type {Map<string, number>} scribbles sent this step, per player */
    this.scribbled = new Map();
    this.scribbleSeq = 0;
    const ideas = library.draw('telephone', this.order.length, { spicy: this.spicy(), lang: this.room.settings.lang });
    /** @type {Map<string, string>} */
    this.suggestions = new Map(this.order.map((id, i) => [id, (ideas[i] && ideas[i].text) || FALLBACK[i % FALLBACK.length]]));
    this.step = -1;
    /** @type {Map<string, boolean>} */
    this.done = new Map();
    this.revealIndex = 0;
    /** @type {Map<string, number>[]} per chain: voter → favourite entry index */
    this.favs = [];
    this.favOpen = false;
    /** @type {Drawing[]} */
    this.drawingList = [];
    /** @type {Map<string, string>} voter → drawing key */
    this.votes = new Map();
  }

  start() { this.nextStep(); }

  /** @param {number} k */
  stepType(k) {
    if (k === 0) return 'write';
    return k % 2 === 1 ? 'draw' : 'describe';
  }

  // Which chain does seat j work on at step k?
  /** @param {string} id @param {number} [k] @returns {number | null} */
  chainFor(id, k = this.step) {
    const j = this.order.indexOf(id);
    if (j < 0) return null;
    if (!this.split) return ((j - k) % this.n + this.n) % this.n;
    const start = j < this.split ? 0 : this.split;
    const size = j < this.split ? this.split : this.n - this.split;
    return start + ((j - start - k) % size + size) % size;
  }

  nextStep() {
    this.step += 1;
    this.round = this.step + 1;
    if (this.step >= this.steps) return this.beginReveal();
    this.done = new Map();
    this.scribbled = new Map();
    this.scribbles = []; // last step's doodles have floated by: don't replay them (keys keep counting)
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
      const ci = this.chainFor(id);
      const c = ci == null ? null : this.chains[ci];
      if (!c || c.entries.length > this.step) continue;
      c.entries.push({
        type: type === 'draw' ? 'drawing' : 'text',
        by: id,
        content: type === 'draw' ? null : (type === 'write' ? this.suggestions.get(id) || '' : '(no guess)'),
        auto: true,
      });
    }
    this.nextStep();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase === 'tel-vote') return this.handleVote(id, payload);
    if (this.phase === 'tel-reveal') return this.handleFav(id, payload);
    if (!['tel-write', 'tel-draw', 'tel-describe'].includes(this.phase)) return;
    if (payload.scribble !== undefined) return this.handleScribble(id, payload.scribble);
    if (this.done.has(id)) return;
    const ci = this.chainFor(id);
    if (ci == null) return;
    const chain = this.chains[ci];
    if (chain.entries.length !== this.step) return;
    /** @type {Entry} */
    let entry;
    if (this.phase === 'tel-draw') {
      if (!validImage(payload.image)) return false;
      entry = { type: 'drawing', by: id, content: payload.image };
    } else {
      const text = cleanText(payload.text, 80);
      if (!text) return false;
      entry = { type: 'text', by: id, content: text };
    }
    chain.entries.push(entry);
    this.done.set(id, true);
    if (this.allIn(this.done)) this.finishStep();
    else this.push();
  }

  /** A doodle from someone who already passed their step on: a few per step, the last few shown.
   * @param {string} id @param {unknown} image */
  handleScribble(id, image) {
    if (!this.done.has(id) || !validImage(image)) return;
    const n = this.scribbled.get(id) || 0;
    if (n >= SCRIBBLES_PER_STEP) return;
    this.scribbled.set(id, n + 1);
    this.scribbles.push({ key: ++this.scribbleSeq, by: id, image: /** @type {string} */ (image) });
    if (this.scribbles.length > SCRIBBLES_SHOWN) this.scribbles.shift();
    this.push();
  }

  beginReveal() {
    this.phase = 'tel-reveal';
    this.revealIndex = 0;
    this.favs = this.chains.map(() => new Map());
    this.scheduleReveal();
    this.push();
  }

  scheduleReveal() {
    const c = this.chains[this.revealIndex];
    this.favOpen = false;
    this.setTimer(ENTRY_SHOW_MS * c.entries.length, () => this.openFavs(), false);
  }

  // The whole chain is on the TV: phones can now pick a favourite step.
  openFavs() {
    if (this.phase !== 'tel-reveal') return;
    this.favOpen = true;
    if (!this.favVoters().length) { this.setTimer(ENTRY_SHOW_MS, () => this.advanceReveal(), false); this.push(); return; }
    this.setTimer(FAV_MS, () => this.advanceReveal(), false);
    this.push();
  }

  /** @param {string} id @param {number} i */
  favable(id, i) {
    const e = this.chains[this.revealIndex].entries[i];
    return !!e && e.by !== id && !e.auto && !(e.type === 'drawing' && !e.content);
  }

  favVoters() {
    const n = this.chains[this.revealIndex].entries.length;
    return this.playerIds().filter((id) => Array.from({ length: n }, (_, i) => i).some((i) => this.favable(id, i)));
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleFav(id, payload) {
    if (!this.favOpen) return;
    const votes = this.favs[this.revealIndex];
    const i = payload.fav;
    if (votes.has(id) || !Number.isInteger(i) || !this.favable(id, i)) return;
    votes.set(id, i);
    const author = this.chains[this.revealIndex].entries[i].by;
    this.award(author, FAV_PTS);
    stats.feat(this.room, author, 'favs');
    if (this.favVoters().every((v) => votes.has(v))) { this.clearTimer(); this.advanceReveal(); } else this.push();
  }

  advanceReveal() {
    this.revealIndex += 1;
    if (this.revealIndex >= this.chains.length) return this.beginVote();
    this.scheduleReveal();
    this.push();
  }

  drawings() {
    /** @type {Drawing[]} */
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

  /** @param {string} id @param {Record<string, any>} payload */
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
    /** @type {Map<string, number>} */
    const count = new Map();
    for (const key of this.votes.values()) {
      const d = this.drawingList.find((x) => x.key === key);
      if (d) { this.award(d.by, 200); count.set(key, (count.get(key) || 0) + 1); }
    }
    const top = [...count].sort((a, b) => b[1] - a[1])[0];
    const d = top && (this.drawingList || []).find((x) => x.key === top[0]);
    if (d) {
      stats.feat(this.room, d.by, 'favs');
      const [ci = 0, ei = 0] = d.key.split(':').map(Number);
      const prev = ei > 0 && this.chains[ci] ? this.chains[ci].entries[ei - 1] : null;
      const prompt = prev ? prev.content : '';
      stats.highlight(this.room, { game: 'Message in a Bottle', prompt: prompt || '', image: d.image, by: this.nick(d.by), note: `best doodle · ${top[1]} vote${top[1] === 1 ? '' : 's'}` });
    }
    this.gameOver();
  }

  onPlayerLeft() {
    if (!this.room.players.size) return;
    if (['tel-write', 'tel-draw', 'tel-describe'].includes(this.phase)) {
      if (this.allIn(this.done)) this.finishStep();
    } else if (this.phase === 'tel-vote') {
      // The last one still to vote left: everyone who can vote has.
      const canVote = this.playerIds().filter((pid) => this.drawingList.some((x) => x.by !== pid));
      if (canVote.every((pid) => this.votes.has(pid))) this.finishVote();
    } else if (this.phase === 'tel-reveal' && this.favOpen) {
      const votes = this.favs[this.revealIndex];
      if (this.favVoters().every((v) => votes.has(v))) { this.clearTimer(); this.advanceReveal(); }
    }
  }

  // --- pictures: each screen gets each drawing once (core/rooms.js sendState) ----------------
  /** A drawing as the view names it: `cfimg:<key>`, its data added to `out` (the view's `images`).
   * @param {Record<string, string>} out @param {string} key @param {string | null} data */
  pic(out, key, data) {
    if (!data) return null;
    const k = `${this.seed}-${key}`; // unique across games: a cached key never means another picture
    out[k] = data;
    return 'cfimg:' + k;
  }

  // --- views ---------------------------------------------------------------

  /** @param {Chain} c @param {number} ci @param {Record<string, string>} images */
  chainView(c, ci, images) {
    const votes = this.favs && this.favs[ci] ? [...this.favs[ci].values()] : [];
    return {
      owner: this.nick(c.owner),
      entries: c.entries.map((e, i) => ({ type: e.type, by: this.nick(e.by), content: e.type === 'drawing' ? this.pic(images, `${ci}:${i}`, e.content) : e.content, favs: votes.filter((v) => v === i).length })),
    };
  }

  hostView() {
    /** @type {Record<string, string>} */
    const images = {};
    if (this.phase === 'tel-reveal') {
      return {
        chainIndex: this.revealIndex,
        chainCount: this.chains.length,
        chain: this.chainView(this.chains[this.revealIndex], this.revealIndex, images),
        images,
        entryMs: ENTRY_SHOW_MS,
        favOpen: !!this.favOpen,
        favCount: this.favs ? this.favs[this.revealIndex].size : 0,
        favNeeded: this.favOpen ? this.favVoters().length : 0,
      };
    }
    if (this.phase === 'tel-vote') {
      return {
        drawings: this.drawingList.map((d) => ({ key: d.key, image: this.pic(images, d.key, d.image) })),
        images,
        votedCount: this.votes.size,
        totalPlayers: this.room.players.size,
      };
    }
    return {
      stepType: this.stepType(this.step),
      submittedCount: this.done.size,
      totalPlayers: this.room.players.size,
      // Who the room is waiting for — shown on the TV so it's never a silent counter.
      waitingOn: this.order.filter((id) => this.room.players.has(id) && !this.done.has(id)).map((id) => this.nick(id)),
      scribbles: this.scribbles.map((d) => ({ key: d.key, image: this.pic(images, 's' + d.key, d.image), by: this.nick(d.by) })),
      images,
    };
  }

  /** @param {string} id */
  playerOnly(id) {
    /** @type {Record<string, string>} */
    const images = {};
    if (this.phase === 'tel-reveal') {
      if (!this.favOpen) return { gameState: { favOpen: false }, you: {} };
      const c = this.chains[this.revealIndex];
      const mine = this.favs[this.revealIndex].get(id);
      return {
        gameState: {
          favOpen: true,
          entries: c.entries.map((e, i) => ({ type: e.type, content: e.type === 'drawing' ? this.pic(images, `${this.revealIndex}:${i}`, e.content) : e.content, by: this.nick(e.by), ok: this.favable(id, i) })),
          images,
        },
        you: { fav: mine == null ? null : mine, canFav: this.favVoters().includes(id) },
      };
    }
    if (this.phase === 'tel-vote') {
      return {
        gameState: { drawings: this.drawingList.filter((d) => d.by !== id).map((d) => ({ key: d.key, image: this.pic(images, d.key, d.image) })), images },
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
        prev: prev ? { type: prev.type, content: prev.type === 'drawing' ? this.pic(images, `${ci}:${this.step - 1}`, prev.content) : prev.content } : null,
        images,
      },
      you: { submitted: this.done.has(id), suggestion: this.suggestions.get(id),
        scribblesLeft: this.done.has(id) ? SCRIBBLES_PER_STEP - (this.scribbled.get(id) || 0) : 0 },
    };
  }
}

TelephoneGame.meta = {
  id: 'telephone',
  name: 'Message in a Bottle',
  blurb: 'Write, draw, describe, repeat. Watch your phrase get hilariously mangled.',
  minPlayers: 3,
};

module.exports = TelephoneGame;
