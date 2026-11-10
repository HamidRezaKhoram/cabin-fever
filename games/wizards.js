/*
 * "Campfire Wizards" — a spell-duel strategy party game (design: docs/design/wizards-game-plan.md).
 * Every round everyone secretly picks a spell and a target; all spells resolve together
 * (shields → mirrors → attacks → mends → ghost actions → knockouts). Knocked-out wizards become
 * ghosts who still act and score. A bounty sits on the points leader; the campfire's mood (an
 * arena event) changes every round. Original game. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame, shuffle } = require('./base');

const env = (/** @type {string} */ k, /** @type {number} */ d) => Number(process.env[k] || d);
const PICK_MS = env('RUMPUS_WZ_PICK_MS', 12000);
const STEP_MS = env('RUMPUS_WZ_STEP_MS', 900); // playtest: 1.2 s per spell left people idle ~30 s
const FINAL_MS = env('RUMPUS_WZ_FINAL_MS', 7000);
const ROUNDS = env('RUMPUS_WZ_ROUNDS', 10);

const MAX_HEARTS = 5, MAX_SPARKS = 5;
const PTS = { dmg: 20, mend: 40, ko: 150, bounty: 50, ghost: 15, place: [400, 200, 100] };

/** @typedef {'bolt' | 'frost' | 'shield' | 'mirror' | 'mend' | 'charge' | 'meteor'} SpellId */
/** @type {Record<SpellId, { name: string, cost: number, target: 'other' | 'any' | 'none', desc: string }>} */
const SPELLS = {
  bolt: { name: 'Firebolt', cost: 1, target: 'other', desc: '2 damage' },
  frost: { name: 'Frost Shard', cost: 2, target: 'other', desc: '1 damage; their next spell costs +1' },
  shield: { name: 'Shield', cost: 0, target: 'none', desc: 'Block all damage this round (not twice in a row)' },
  mirror: { name: 'Mirror', cost: 1, target: 'other', desc: "That wizard's attacks on you bounce back" },
  mend: { name: 'Mend', cost: 1, target: 'any', desc: '+2 hearts to anyone' },
  charge: { name: 'Charge', cost: 0, target: 'none', desc: '+2 sparks (you stay open)' },
  meteor: { name: 'Meteor', cost: 4, target: 'none', desc: '2 damage to everyone else' },
};
/** @typedef {'moon' | 'gale' | 'fireflies' | 'still' | 'mist' | 'embers'} EventId */
/** @type {Record<EventId, { name: string, desc: string }>} */
const EVENTS = {
  moon: { name: 'Full Moon', desc: 'Mend heals 3 tonight.' },
  gale: { name: 'Gale', desc: 'Firebolts hit for 3.' },
  fireflies: { name: 'Fireflies', desc: 'Everyone gets +1 spark.' },
  still: { name: 'Still Night', desc: 'The fire crackles quietly…' },
  mist: { name: 'Mist', desc: 'Mirrors are free.' },
  embers: { name: 'Ember Rain', desc: 'Everyone not shielded takes 1 damage.' },
};

/** @typedef {{ hearts: number, sparks: number, ghost: boolean, frosted: boolean, last: string | null, koRound: number }} Wizard */
/** @typedef {{ spell: string, target: string | null }} Pick */
/** @typedef {{ kind: string, from: string | null, to: string | null, amount?: number }} Beat */

class WizardsGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(ROUNDS);
    this.noPaceVotes = true;
    /** @type {string[]} seats around the fire */
    this.seats = shuffle(this.playerIds());
    /** @type {Map<string, Wizard>} */
    this.wiz = new Map(this.seats.map((id) => [id, { hearts: MAX_HEARTS, sparks: 2, ghost: false, frosted: false, last: null, koRound: 0 }]));
    /** @type {Map<string, Pick>} */
    this.picks = new Map();
    /** @type {EventId} */
    this.event = 'still';
    /** @type {Beat[]} */
    this.beats = [];
    /** @type {string | null} the points leader when the round started */
    this.bounty = null;
    /** @type {{ nickname: string, place: number, gained: number, ghost: boolean }[]} */
    this.finalRows = [];
    this.stepMs = STEP_MS;
  }

  start() { this.nextRound(); }

  living() { return this.seats.filter((id) => this.room.players.has(id) && !(/** @type {Wizard} */ (this.wiz.get(id))).ghost); }

  nextRound() {
    if (this.round >= this.totalRounds || this.living().length <= 1) return this.finish();
    this.round += 1;
    const evs = /** @type {EventId[]} */ (Object.keys(EVENTS));
    this.event = this.round === 1 ? 'still' : shuffle([...evs])[0];
    for (const id of this.living()) {
      const w = /** @type {Wizard} */ (this.wiz.get(id));
      w.sparks = Math.min(MAX_SPARKS, w.sparks + (this.round > 1 ? 1 : 0) + (this.event === 'fireflies' ? 1 : 0));
    }
    // Bounty: the living points leader (if anyone has points yet).
    const lead = this.living().map((id) => /** @type {Player} */ (this.room.players.get(id))).sort((a, b) => b.score - a.score)[0];
    this.bounty = lead && lead.score > 0 ? lead.id : null;
    this.picks = new Map();
    this.beats = [];
    this.phase = 'wz-pick';
    this.setTimer(PICK_MS, () => this.resolve());
    this.push();
  }

  /** What a spell costs this wizard right now. @param {string} id @param {SpellId} s */
  cost(id, s) {
    const w = /** @type {Wizard} */ (this.wiz.get(id));
    return (s === 'mirror' && this.event === 'mist' ? 0 : SPELLS[s].cost) + (w.frosted ? 1 : 0);
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase !== 'wz-pick' || this.picks.has(id) || !this.wiz.has(id)) return;
    const w = /** @type {Wizard} */ (this.wiz.get(id));
    const spell = String(payload.spell || '');
    const target = payload.target == null ? null : String(payload.target);
    const alive = (/** @type {string | null} */ t) => !!t && this.living().includes(t);
    if (w.ghost) {
      if ((spell !== 'haunt' && spell !== 'bless') || !alive(target)) return;
    } else {
      if (!(spell in SPELLS)) return;
      const s = /** @type {SpellId} */ (spell);
      if (this.cost(id, s) > w.sparks) return;
      if (s === 'shield' && w.last === 'shield') return;
      const kind = SPELLS[s].target;
      if (kind === 'other' && (!alive(target) || target === id)) return;
      if (kind === 'any' && !alive(target)) return;
    }
    this.picks.set(id, { spell, target: SPELLS[/** @type {SpellId} */ (spell)] && SPELLS[/** @type {SpellId} */ (spell)].target === 'none' ? null : target });
    const actors = this.seats.filter((x) => this.room.players.has(x));
    if (actors.every((x) => this.picks.has(x))) this.resolve();
    else this.push();
  }

  /** @param {string} id @param {number} pts */
  give(id, pts) { if (pts && this.room.players.has(id)) this.award(id, pts); }

  resolve() {
    if (this.phase !== 'wz-pick') return;
    const living = this.living();
    // Too slow: living wizards charge, ghosts rest.
    for (const id of living) if (!this.picks.has(id)) this.picks.set(id, { spell: 'charge', target: null });
    /** @type {Beat[]} */
    const beats = [];
    const W = (/** @type {string} */ id) => /** @type {Wizard} */ (this.wiz.get(id));
    /** @type {Map<string, number>} */
    const dmg = new Map();
    /** @type {Map<string, Set<string>>} who damaged whom (knockout credit) */
    const hitBy = new Map();
    // 1. Pay, charge, shields, mirrors.
    /** @type {Set<string>} */
    const shielded = new Set();
    /** @type {Map<string, string>} mirror owner → the attacker they named */
    const mirrors = new Map();
    for (const id of living) {
      const p = /** @type {Pick} */ (this.picks.get(id));
      const s = /** @type {SpellId} */ (p.spell);
      const w = W(id);
      w.sparks -= this.cost(id, s);
      w.frosted = false;
      w.last = s;
      if (s === 'charge') { w.sparks = Math.min(MAX_SPARKS, w.sparks + 2); beats.push({ kind: 'charge', from: id, to: null }); }
      if (s === 'shield') { shielded.add(id); beats.push({ kind: 'shield', from: id, to: null }); }
      if (s === 'mirror' && p.target) { mirrors.set(id, p.target); beats.push({ kind: 'mirror', from: id, to: p.target }); }
    }
    /** @param {string | null} from @param {string} to @param {number} amount @param {string} kind */
    const hit = (from, to, amount, kind) => {
      if (shielded.has(to)) { beats.push({ kind: 'blocked', from, to }); return; }
      dmg.set(to, (dmg.get(to) || 0) + amount);
      if (from) {
        const set = hitBy.get(to) || new Set(); set.add(from); hitBy.set(to, set);
        this.give(from, amount * PTS.dmg + (to === this.bounty ? PTS.bounty : 0));
      }
      beats.push({ kind, from, to, amount });
    };
    // 2. Ember Rain.
    if (this.event === 'embers') for (const id of living) hit(null, id, 1, 'ember');
    // 3. Attacks (mirrors bounce them back to the attacker).
    for (const id of living) {
      const p = /** @type {Pick} */ (this.picks.get(id));
      const targets = p.spell === 'meteor' ? living.filter((x) => x !== id) : p.spell === 'bolt' || p.spell === 'frost' ? [/** @type {string} */ (p.target)] : [];
      for (const t of targets) {
        const amount = p.spell === 'bolt' ? (this.event === 'gale' ? 3 : 2) : p.spell === 'frost' ? 1 : 2;
        if (mirrors.get(t) === id) { beats.push({ kind: 'reflect', from: t, to: id }); hit(t, id, amount, p.spell); continue; }
        hit(id, t, amount, p.spell);
        if (p.spell === 'frost' && !shielded.has(t)) W(t).frosted = true;
      }
    }
    // 4. Mends and ghost blessings land before anyone is knocked out.
    /** @type {Map<string, number>} */
    const heal = new Map();
    for (const id of living) {
      const p = /** @type {Pick} */ (this.picks.get(id));
      if (p.spell !== 'mend' || !p.target) continue;
      const n = this.event === 'moon' ? 3 : 2;
      heal.set(p.target, (heal.get(p.target) || 0) + n);
      if (p.target !== id) this.give(id, n * PTS.dmg); // healing a friend pays like hurting a foe
      beats.push({ kind: 'mend', from: id, to: p.target, amount: n });
    }
    for (const id of this.seats.filter((x) => W(x).ghost && this.room.players.has(x))) {
      const p = this.picks.get(id);
      if (!p || !p.target || !living.includes(p.target)) continue;
      if (p.spell === 'bless') heal.set(p.target, (heal.get(p.target) || 0) + 1);
      else W(p.target).sparks = Math.max(0, W(p.target).sparks - 1);
      this.give(id, PTS.ghost);
      beats.push({ kind: p.spell, from: id, to: p.target, amount: 1 });
    }
    // 5. Apply, then knock out.
    for (const id of living) {
      const w = W(id);
      w.hearts = Math.min(MAX_HEARTS, w.hearts - (dmg.get(id) || 0) + (heal.get(id) || 0));
      if (w.hearts <= 0) {
        w.hearts = 0; w.ghost = true; w.koRound = this.round;
        for (const by of hitBy.get(id) || []) if (by !== id) this.give(by, PTS.ko);
        beats.push({ kind: 'ko', from: null, to: id });
      }
    }
    this.beats = beats;
    this.phase = 'wz-reveal';
    // Big fights play faster: the whole reveal stays under ~7 s (playtest: 6 players idled 30 s).
    this.stepMs = Math.max(STEP_MS * 0.4, Math.min(STEP_MS, (STEP_MS * 8) / Math.max(1, beats.length)));
    this.setTimer(this.stepMs * (beats.length + 2), () => this.nextRound(), false);
    this.push();
  }

  finish() {
    // Places: the living by hearts, then ghosts by how long they lasted.
    const order = this.seats.filter((id) => this.room.players.has(id)).sort((a, b) => {
      const A = /** @type {Wizard} */ (this.wiz.get(a)), B = /** @type {Wizard} */ (this.wiz.get(b));
      if (A.ghost !== B.ghost) return A.ghost ? 1 : -1;
      return A.ghost ? B.koRound - A.koRound : B.hearts - A.hearts;
    });
    this.finalRows = order.map((id, i) => {
      const before = (/** @type {Player} */ (this.room.players.get(id))).score;
      this.give(id, PTS.place[i] || 0);
      return { nickname: this.nick(id), place: i + 1, gained: (/** @type {Player} */ (this.room.players.get(id))).score - before, ghost: (/** @type {Wizard} */ (this.wiz.get(id))).ghost };
    });
    this.phase = 'wz-final';
    this.setTimer(FINAL_MS, () => this.gameOver(), false);
    this.push();
  }

  onPlayerLeft() {
    if (this.phase === 'wz-pick' && this.seats.filter((x) => this.room.players.has(x)).every((x) => this.picks.has(x))) this.resolve();
  }

  // --- views ------------------------------------------------------------------

  circle() {
    return this.seats.filter((id) => this.room.players.has(id)).map((id) => {
      const w = /** @type {Wizard} */ (this.wiz.get(id));
      return { nickname: this.nick(id), hearts: w.hearts, sparks: w.sparks, ghost: w.ghost, frosted: w.frosted, bounty: id === this.bounty, picked: this.picks.has(id) };
    });
  }

  beatsView() {
    return this.beats.map((b) => ({ kind: b.kind, from: b.from ? this.nick(b.from) : null, to: b.to ? this.nick(b.to) : null, amount: b.amount || 0 }));
  }

  hostView() {
    return {
      wizards: this.circle(),
      event: { id: this.event, ...EVENTS[this.event] },
      pickedCount: this.picks.size, totalPlayers: this.seats.filter((x) => this.room.players.has(x)).length,
      // Picks stay secret until everything goes off together.
      beats: this.phase === 'wz-reveal' ? this.beatsView() : [],
      stepMs: this.stepMs,
      finalRows: this.phase === 'wz-final' ? this.finalRows : null,
    };
  }

  /** @param {string} id */
  playerOnly(id) {
    const w = this.wiz.get(id) || { hearts: 0, sparks: 0, ghost: true, frosted: false, last: null, koRound: 0 };
    const others = this.living().filter((x) => x !== id).map((x) => ({ id: x, nickname: this.nick(x) }));
    const any = this.living().map((x) => ({ id: x, nickname: this.nick(x) }));
    const spells = w.ghost
      ? [{ id: 'haunt', name: 'Haunt', cost: 0, target: 'other', desc: '−1 spark to a living wizard', ok: true },
        { id: 'bless', name: 'Bless', cost: 0, target: 'other', desc: '+1 heart to a living wizard', ok: true }]
      : (/** @type {SpellId[]} */ (Object.keys(SPELLS))).map((s) => ({
        id: s, ...SPELLS[s], cost: this.cost(id, s),
        ok: this.cost(id, s) <= w.sparks && !(s === 'shield' && w.last === 'shield') && (SPELLS[s].target !== 'other' || others.length > 0),
      }));
    const pick = this.picks.get(id);
    return {
      gameState: { wizards: this.circle(), event: { id: this.event, ...EVENTS[this.event] }, beats: this.phase === 'wz-reveal' ? this.beatsView() : [], finalRows: this.phase === 'wz-final' ? this.finalRows : null },
      you: { ...w, picked: !!pick, pick: pick || null, spells, others, any: w.ghost ? others.concat(any.filter((x) => x.id === id)) : any, bounty: id === this.bounty },
    };
  }
}

WizardsGame.meta = {
  id: 'wizards',
  name: 'Campfire Wizards',
  blurb: 'A spell duel around the campfire: everyone casts at once — bolts, shields, mirrors, meteors. Knocked out? Haunt them as a ghost.',
  minPlayers: 3,
};
WizardsGame.SPELLS = SPELLS;
WizardsGame.EVENTS = EVENTS;

module.exports = WizardsGame;
