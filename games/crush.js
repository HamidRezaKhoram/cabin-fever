/*
 * "Cottage Crush" — a speed-dating party game for a singles weekend at the lake.
 * Each evening: Mingle (slip notes to other players' phones), Reply, then secretly
 * pick a date (or stay in). The dock reveal pairs everyone up on the TV.
 * Secret agendas bend the scoring, and from evening 3 the leader's agenda is exposed.
 * Mechanics only are genre-standard; everything here is original. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame, shuffle, cleanText } = require('./base');
const library = require('./library');

// Playtest-tuned: 60/30 s left fast note-senders idle for over a minute.
const MINGLE_MS = parseInt(process.env.RUMPUS_CR_MINGLE_MS || '45000', 10);
const REPLY_MS = parseInt(process.env.RUMPUS_CR_REPLY_MS || '25000', 10);
const PICK_MS = parseInt(process.env.RUMPUS_CR_PICK_MS || '20000', 10);
const REVEAL_STEP_MS = parseInt(process.env.RUMPUS_CR_REVEAL_STEP_MS || '1800', 10);

const MUTUAL = 200, EGO = 100, STAY_IN = 100;
const REPLY_EMOJI = ['😍', '😂', '🙈', '🔥', '🤔', '💔'];

/** @typedef {'heartbreaker' | 'romantic' | 'wallflower' | 'player'} AgendaId */
/** @type {Record<AgendaId, { name: string, desc: string }>} */
const AGENDAS = {
  heartbreaker: { name: 'Heartbreaker', desc: '+200 for every one-sided pick on you, but mutual dates cost you 100.' },
  romantic: { name: 'Hopeless Romantic', desc: 'Mutual dates score double — but staying in costs 300.' },
  wallflower: { name: 'Wallflower', desc: 'Your notes are anonymous. +300 for a mutual date on the last evening.' },
  player: { name: 'Player', desc: 'You get 5 notes a night instead of 3.' },
};

/** @typedef {{ id: number, from: string, to: string, text: string, reply: string | null }} Note */

class CrushGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(4);
    const ids = shuffle(this.playerIds());
    const deck = /** @type {AgendaId[]} */ (Object.keys(AGENDAS));
    /** @type {Map<string, AgendaId>} */
    this.agendas = new Map(ids.map((/** @type {string} */ id, /** @type {number} */ i) => [id, deck[i % deck.length]]));
    /** @type {Note[]} */
    this.notes = [];
    this.noteSeq = 0;
    /** @type {Map<string, string | null>} */
    this.picks = new Map();
    /** @type {Map<string, string[]>} opener cards dealt per player this evening */
    this.cards = new Map();
    /** @type {string[]} reply cards this evening */
    this.replyCards = [];
    /** @type {{ a: string, b: string | null, mutual: boolean, gained: Record<string, number> }[]} */
    this.pairs = [];
    /** @type {Set<string>} players whose agenda the TV has exposed */
    this.exposed = new Set();
  }

  start() { this.nextRound(); }

  /** @param {string} id */
  budget(id) { return this.agendas.get(id) === 'player' ? 5 : 3; }
  /** @param {string} id */
  sent(id) { return this.notes.filter((n) => n.from === id).length; }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    this.notes = [];
    this.picks = new Map();
    this.pairs = [];
    const spicy = this.spicy();
    this.cards = new Map(this.playerIds().map((id) => [id, library.draw('crush-openers', 4, { spicy }).map((x) => x.text || '')]));
    this.replyCards = library.draw('crush-replies', 3, { spicy }).map((x) => x.text || '');
    // Comeback: from evening 3 the leader's secret agenda goes up on the TV.
    if (this.round >= 3) {
      const leader = [...this.room.players.values()].sort((a, b) => b.score - a.score)[0];
      if (leader && leader.score > 0) this.exposed.add(leader.id);
    }
    this.phase = 'cr-mingle';
    this.setTimer(MINGLE_MS, () => this.toReply());
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase === 'cr-mingle') {
      const to = String(payload.to || '');
      const text = cleanText(payload.text, 80);
      if (!text || to === id || !this.room.players.has(to) || this.sent(id) >= this.budget(id)) return;
      this.notes.push({ id: ++this.noteSeq, from: id, to, text, reply: null });
      if (this.playerIds().every((p) => this.sent(p) >= this.budget(p))) this.toReply();
      else this.push();
    } else if (this.phase === 'cr-reply') {
      const note = this.notes.find((n) => n.id === payload.reply && n.to === id);
      const text = cleanText(payload.text, 80);
      if (!note || note.reply || !text) return;
      note.reply = text;
      if (this.notes.every((n) => n.reply || !this.room.players.has(n.to))) this.toPick();
      else this.push();
    } else if (this.phase === 'cr-pick') {
      if (this.picks.has(id)) return;
      const pick = payload.pick === null ? null : String(payload.pick || '');
      if (pick !== null && (pick === id || !this.room.players.has(pick))) return;
      this.picks.set(id, pick);
      if (this.allIn(this.picks)) this.reveal();
      else this.push();
    }
  }

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
    const last = this.round === this.totalRounds;
    /** @type {Record<string, number>} */
    const pts = {};
    const add = (/** @type {string} */ id, /** @type {number} */ n) => { pts[id] = (pts[id] || 0) + n; };
    const ids = this.playerIds();
    const done = new Set();
    this.pairs = [];
    for (const a of ids) {
      if (done.has(a)) continue;
      const b = this.picks.has(a) ? this.picks.get(a) || null : null;
      const ag = this.agendas.get(a);
      if (!b) {
        add(a, -(ag === 'romantic' ? 3 * STAY_IN : STAY_IN));
        this.pairs.push({ a, b: null, mutual: false, gained: {} });
        done.add(a);
        continue;
      }
      const mutual = this.picks.get(b) === a;
      if (mutual) {
        for (const x of [a, b]) {
          const g = this.agendas.get(x);
          add(x, g === 'heartbreaker' ? -100 : g === 'romantic' ? 2 * MUTUAL : MUTUAL);
          if (g === 'wallflower' && last) add(x, 300);
        }
        done.add(a); done.add(b);
      } else {
        add(b, this.agendas.get(b) === 'heartbreaker' ? 2 * EGO : EGO); // ego boost for the one who was asked
        done.add(a);
      }
      this.pairs.push({ a, b, mutual, gained: {} });
    }
    // Apply (×1/×2/×3 by evening), never below zero.
    for (const [id, n] of Object.entries(pts)) {
      const p = this.room.players.get(id);
      if (!p) continue;
      const real = n * this.mult();
      const before = p.score;
      p.score = Math.max(0, p.score + real);
      for (const pr of this.pairs) if (pr.a === id || pr.b === id) pr.gained[id] = p.score - before;
    }
    this.phase = 'cr-reveal';
    this.setTimer(REVEAL_STEP_MS * (this.pairs.length + 2), () => this.nextRound(), false);
    this.push();
  }

  onPlayerLeft() {
    if (this.phase === 'cr-pick' && this.room.players.size && this.allIn(this.picks)) this.reveal();
  }

  // --- views ---------------------------------------------------------------

  /** @param {string} id */
  agendaView(id) {
    const a = this.agendas.get(id);
    return a ? { id: a, ...AGENDAS[a] } : null;
  }

  exposedView() {
    return [...this.exposed].filter((id) => this.room.players.has(id)).map((id) => ({ nickname: this.nick(id), agenda: (this.agendaView(id) || { name: '?' }).name }));
  }

  hostView() {
    /** @type {Record<string, number>} admirers: notes received (never their content) */
    const admirers = {};
    for (const n of this.notes) admirers[this.nick(n.to)] = (admirers[this.nick(n.to)] || 0) + 1;
    return {
      evening: this.round,
      admirers: Object.entries(admirers).map(([nickname, count]) => ({ nickname, count })).sort((x, y) => y.count - x.count),
      notesSent: this.notes.length,
      repliesSent: this.notes.filter((n) => n.reply).length,
      pickedCount: this.picks.size,
      totalPlayers: this.room.players.size,
      exposed: this.exposedView(),
      pairs: this.phase === 'cr-reveal' ? this.pairs.map((p) => ({
        a: this.nick(p.a), b: p.b ? this.nick(p.b) : null, mutual: p.mutual,
        gained: Object.fromEntries(Object.entries(p.gained).map(([k, v]) => [this.nick(k), v])),
      })) : [],
      stepMs: REVEAL_STEP_MS,
    };
  }

  /** @param {string} id */
  playerOnly(id) {
    const anon = (/** @type {string} */ from) => this.agendas.get(from) === 'wallflower';
    // Privacy: a phone only ever sees notes it sent or received.
    const inbox = this.notes.filter((n) => n.to === id).map((n) => ({ id: n.id, from: anon(n.from) ? 'Secret admirer' : this.nick(n.from), text: n.text, reply: n.reply }));
    const outbox = this.notes.filter((n) => n.from === id).map((n) => ({ id: n.id, to: this.nick(n.to), text: n.text, reply: n.reply }));
    const me = this.pairs.find((p) => p.a === id || p.b === id);
    return {
      gameState: {
        evening: this.round,
        targets: this.playerIds().filter((p) => p !== id).map((p) => ({ id: p, nickname: this.nick(p) })),
        exposed: this.exposedView(),
      },
      you: {
        agenda: this.agendaView(id),
        notesLeft: this.budget(id) - this.sent(id),
        cards: this.cards.get(id) || [],
        replyCards: [...REPLY_EMOJI, ...this.replyCards],
        inbox, outbox,
        picked: this.picks.has(id),
        date: me ? { with: me.a === id ? (me.b ? this.nick(me.b) : null) : this.nick(me.a), mutual: me.mutual, askedBy: me.b === id && !me.mutual, gained: me.gained[id] || 0 } : null,
      },
    };
  }
}

CrushGame.meta = {
  id: 'crush',
  name: 'Cottage Crush',
  blurb: 'A singles weekend at the lake: slip notes, reply, pick a date. Secret agendas change everything.',
  minPlayers: 4,
};
CrushGame.AGENDAS = AGENDAS;

module.exports = CrushGame;
