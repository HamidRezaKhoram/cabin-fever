/*
 * "Cottage Crush" — a speed-dating party game for a singles weekend at the lake.
 * Each evening: Mingle (slip up to 3 notes to other players' phones), Reply (answer the notes you
 * got: an emoji, a line, or your own words), then secretly pick a date (or stay in). The dock
 * reveal pairs everyone up on the TV. No secret roles: the notes and replies are the game.
 * Mechanics only are genre-standard; everything here is original. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame, cleanText } = require('./base');
const library = require('./library');

// Playtest-tuned: 60/30 s left fast note-senders idle for over a minute.
const MINGLE_MS = parseInt(process.env.RUMPUS_CR_MINGLE_MS || '45000', 10);
const REPLY_MS = parseInt(process.env.RUMPUS_CR_REPLY_MS || '25000', 10);
const PICK_MS = parseInt(process.env.RUMPUS_CR_PICK_MS || '20000', 10);
const REVEAL_STEP_MS = parseInt(process.env.RUMPUS_CR_REVEAL_STEP_MS || '1800', 10);

/** Notes each player can send per evening. */
const NOTES = 3;
const MUTUAL = 200, EGO = 100; // (staying in, or no pick, scores 0: it used to cost 100 — a napping phone lost points)
const REPLY_EMOJI = ['😍', '😂', '🙈', '🔥', '🤔', '💔'];
const REPLY_MAX = 60;

/** @typedef {{ id: number, from: string, to: string, text: string, reply: string | null }} Note */

class CrushGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(4);
    /** Order the dock reveal goes through the room (seeded). @type {string[]} */
    this.order = this.rng.shuffleIn(this.playerIds());
    /** @type {Note[]} */
    this.notes = [];
    /** Players done mingling before using all their notes ("up to 3"). @type {Set<string>} */
    this.mingled = new Set();
    this.noteSeq = 0;
    /** @type {Map<string, string | null>} */
    this.picks = new Map();
    /** @type {Map<string, string[]>} opener cards dealt per player this evening */
    this.cards = new Map();
    /** @type {string[]} reply cards this evening */
    this.replyCards = [];
    /** @type {{ a: string, b: string | null, mutual: boolean, gained: Record<string, number> }[]} */
    this.pairs = [];
  }

  start() { this.nextRound(); }

  /** @param {string} id */
  budget(id) { return this.room.players.has(id) ? NOTES : 0; }
  /** @param {string} id */
  sent(id) { return this.notes.filter((n) => n.from === id).length; }
  /** Sent all their notes, or said they're done. @param {string} id */
  mingleDone(id) { return this.mingled.has(id) || this.sent(id) >= this.budget(id); }
  /** Notes still waiting for this player's reply (from players still here). @param {string} id */
  toAnswer(id) { return this.notes.filter((n) => n.to === id && !n.reply); }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    this.notes = [];
    this.mingled = new Set();
    this.picks = new Map();
    this.pairs = [];
    const spicy = this.spicy();
    this.cards = new Map(this.playerIds().map((id) => [id, library.draw('crush-openers', 4, { spicy }).map((x) => x.text || '')]));
    this.replyCards = library.draw('crush-replies', 3, { spicy }).map((x) => x.text || '');
    this.phase = 'cr-mingle';
    this.setTimer(MINGLE_MS, () => this.toReply());
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload @returns {boolean | void} */
  handleSubmit(id, payload) {
    if (this.phase === 'cr-mingle') {
      // "Up to 3": done after 1 or 2 instead of holding the room for the full clock.
      if (payload.done === true) {
        this.mingled.add(id);
        if (this.playerIds().every((p) => this.mingleDone(p))) this.toReply(); else this.push();
        return;
      }
      const to = String(payload.to || '');
      const text = cleanText(payload.text, 80);
      if (!text || to === id || !this.targetable(to) || this.sent(id) >= this.budget(id)) return false;
      this.notes.push({ id: ++this.noteSeq, from: id, to, text, reply: null });
      if (this.playerIds().every((p) => this.mingleDone(p))) this.toReply();
      else this.push();
    } else if (this.phase === 'cr-reply') {
      const note = this.notes.find((n) => n.id === payload.reply && n.to === id);
      const text = cleanText(payload.text, REPLY_MAX);
      if (!note || note.reply || !text) return false;
      note.reply = text;
      if (this.repliesDone()) this.toPick();
      else this.push();
    } else if (this.phase === 'cr-pick') {
      if (this.picks.has(id)) return;
      const pick = payload.pick === null ? null : String(payload.pick || '');
      if (pick !== null && (pick === id || !this.targetable(pick))) return false;
      this.picks.set(id, pick);
      if (this.allIn(this.picks)) this.reveal();
      else this.push();
    }
  }

  repliesDone() { return this.notes.every((n) => n.reply || !this.room.players.has(n.to)); }

  toReply() {
    if (this.phase !== 'cr-mingle') return;
    if (!this.notes.length) return this.toPick();
    this.phase = 'cr-reply';
    this.setTimer(REPLY_MS, () => this.toPick());
    this.push();
  }

  toPick() {
    if (this.phase !== 'cr-mingle' && this.phase !== 'cr-reply') return;
    this.phase = 'cr-pick';
    this.setTimer(PICK_MS, () => this.reveal());
    this.push();
  }

  reveal() {
    if (this.phase !== 'cr-pick') return;
    /** @type {Record<string, number>} */
    const pts = {};
    const add = (/** @type {string} */ id, /** @type {number} */ n) => { pts[id] = (pts[id] || 0) + n; };
    const here = new Set(this.playerIds());
    const ids = [...this.order.filter((id) => here.has(id)), ...this.playerIds().filter((id) => !this.order.includes(id))];
    const done = new Set();
    this.pairs = [];
    for (const a of ids) {
      if (done.has(a)) continue;
      const b = this.picks.get(a) || null;
      if (!b || !here.has(b)) {
        add(a, 0);
        this.pairs.push({ a, b: null, mutual: false, gained: {} });
        done.add(a);
        continue;
      }
      const mutual = this.picks.get(b) === a;
      if (mutual) {
        add(a, MUTUAL); add(b, MUTUAL);
        done.add(a); done.add(b);
      } else {
        add(b, EGO); // an ego boost for the one who was asked
        done.add(a);
      }
      this.pairs.push({ a, b, mutual, gained: {} });
    }
    // Apply (×1/×2/×3 by evening), never below zero.
    for (const [id, n] of Object.entries(pts)) {
      const p = this.room.players.get(id);
      if (!p) continue;
      const before = p.score;
      p.score = Math.max(0, p.score + n * this.mult());
      const net = p.score - before;
      for (const pr of this.pairs) if (pr.a === id || pr.b === id) pr.gained[id] = net;
    }
    this.phase = 'cr-reveal';
    // One step per date, plus the intro and the outro.
    this.setTimer(REVEAL_STEP_MS * (this.pairs.length + 2), () => this.nextRound(), false);
    this.push();
  }

  onPlayerLeft() {
    if (!this.room.players.size) return;
    // Whoever was still to act may be the one who left: move on instead of waiting out the clock.
    if (this.phase === 'cr-mingle' && this.playerIds().every((p) => this.mingleDone(p))) this.toReply();
    else if (this.phase === 'cr-reply' && this.repliesDone()) this.toPick();
    else if (this.phase === 'cr-pick' && this.allIn(this.picks)) this.reveal();
  }

  // --- views ---------------------------------------------------------------

  hostView() {
    /** @type {Map<string, number>} admirers: notes received (never their content) */
    const admirers = new Map();
    for (const n of this.notes) admirers.set(this.nick(n.to), (admirers.get(this.nick(n.to)) || 0) + 1);
    const ids = this.playerIds();
    return {
      evening: this.round,
      admirers: [...admirers].map(([nickname, count]) => ({ nickname, count })).sort((x, y) => y.count - x.count),
      notesSent: this.notes.length,
      notesMax: ids.length * NOTES,
      repliesSent: this.notes.filter((n) => n.reply).length,
      pickedCount: this.picks.size,
      totalPlayers: this.room.players.size,
      // Who the room is waiting for, by phase (names only).
      waitingOn: (this.phase === 'cr-mingle' ? ids.filter((id) => !this.mingleDone(id))
        : this.phase === 'cr-reply' ? ids.filter((id) => this.toAnswer(id).length)
          : this.phase === 'cr-pick' ? ids.filter((id) => !this.picks.has(id)) : []).map((id) => this.nick(id)),
      pairs: this.phase === 'cr-reveal' ? this.pairs.map((p) => ({
        a: this.nick(p.a), b: p.b ? this.nick(p.b) : null, mutual: p.mutual,
        gained: Object.fromEntries(Object.entries(p.gained).map(([k, v]) => [this.nick(k), v])),
      })) : [],
      stepMs: REVEAL_STEP_MS,
    };
  }

  /** @param {string} id */
  playerOnly(id) {
    // Privacy: a phone only ever sees notes it sent or received.
    const inbox = this.notes.filter((n) => n.to === id).map((n) => ({ id: n.id, from: this.nick(n.from), text: n.text, reply: n.reply }));
    const outbox = this.notes.filter((n) => n.from === id).map((n) => ({ id: n.id, to: this.nick(n.to), text: n.text, reply: n.reply }));
    // You can be in two rows (your pick, and someone's one-sided pick of you): your own date wins —
    // a mutual one first, then the one you asked for.
    const mine = this.pairs.filter((p) => p.a === id || p.b === id);
    const me = mine.find((p) => p.mutual) || mine.find((p) => p.a === id) || mine[0];
    return {
      gameState: {
        evening: this.round,
        targets: this.targetIds().filter((p) => p !== id).map((p) => ({ id: p, nickname: this.nick(p) })),
      },
      you: {
        notesLeft: this.mingled.has(id) ? 0 : this.budget(id) - this.sent(id),
        notesMax: NOTES,
        cards: this.cards.get(id) || [],
        replyEmoji: REPLY_EMOJI,
        replyCards: this.replyCards,
        replyMax: REPLY_MAX,
        inbox, outbox,
        repliesLeft: this.toAnswer(id).length,
        picked: this.picks.has(id),
        pick: this.picks.has(id) ? (this.picks.get(id) ? this.nick(/** @type {string} */ (this.picks.get(id))) : null) : undefined,
        date: me ? { with: me.a === id ? (me.b ? this.nick(me.b) : null) : this.nick(me.a), mutual: me.mutual, askedBy: me.b === id && !me.mutual, gained: me.gained[id] || 0 } : null,
      },
    };
  }
}

CrushGame.meta = {
  id: 'crush',
  name: 'Cottage Crush',
  blurb: 'A singles weekend at the lake: slip notes, reply, pick a date. It’s a date only if they pick you too.',
  minPlayers: 4,
  endBelow: 3, // with 2 left it plays itself (the only card wins, each can deduce the other, a guaranteed date)
};
CrushGame.NOTES = NOTES;

module.exports = CrushGame;
