/*
 * "Storm Watch" — a hidden-role strategy game (design: docs/design/strategy-game-plan.md).
 * A storm is coming; the cottage needs five chores done, but some guests are raccoons in
 * disguise. Leaders pick crews, everyone votes, crews secretly help or sabotage. An event deck
 * bends every chore's rules; random roles change who knows what. Nobody is ever eliminated.
 * Original story, roles, events and names (the mission-vote structure is a genre staple).
 * AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame, shuffle } = require('./base');

const env = (/** @type {string} */ k, /** @type {number} */ d) => Number(process.env[k] || d);
const ROLES_MS = env('RUMPUS_ST_ROLES_MS', 20000);
const TALK_MS = env('RUMPUS_ST_TALK_MS', 60000);
const VOTE_MS = env('RUMPUS_ST_VOTE_MS', 20000);
const VOTE_SHOW_MS = env('RUMPUS_ST_VOTE_SHOW_MS', 5000);
const CREW_MS = env('RUMPUS_ST_CREW_MS', 20000);
const CARD_MS = env('RUMPUS_ST_CARD_MS', 1600);
const ACCUSE_MS = env('RUMPUS_ST_ACCUSE_MS', 25000);
const FINAL_MS = env('RUMPUS_ST_FINAL_MS', 9000);

const WIN = 500, ACCUSE_RIGHT = 100, UNSEEN = 200, LUCKY = 100;

/** @typedef {'cottager' | 'lookout' | 'handyman' | 'snoop' | 'raccoon' | 'sly'} RoleId */
/** @type {Record<RoleId, { name: string, side: 'cottage' | 'raccoon', desc: string }>} */
const ROLES = {
  cottager: { name: 'Cottager', side: 'cottage', desc: 'Get three chores done before the storm. Find the raccoons.' },
  lookout: { name: 'Lookout', side: 'cottage', desc: 'You spotted one raccoon sneaking around. Use it carefully — they will want to find you.' },
  handyman: { name: 'Handyman', side: 'cottage', desc: 'Once per game, on a crew, you can Fix It: one sabotage is cancelled.' },
  snoop: { name: 'Snoop', side: 'cottage', desc: 'Once per game, after a chore, peek at one crew member’s card.' },
  raccoon: { name: 'Raccoon', side: 'raccoon', desc: 'Ruin three chores (or let the storm win). You know the other raccoons.' },
  sly: { name: 'Sly Raccoon', side: 'raccoon', desc: 'A raccoon the Lookout can’t spot. Ruin three chores.' },
};

/** @typedef {'big' | 'thunder' | 'outage' | 'bonfire' | 'bear' | 'lucky' | 'leaky' | 'calm' | 'wind' | 'cold'} EventId */
/** @type {Record<EventId, { name: string, desc: string }>} */
const EVENTS = {
  big: { name: 'Big Chore', desc: 'It takes two sabotages to ruin this one.' },
  thunder: { name: 'Thunder', desc: 'One extra pair of hands on the crew.' },
  outage: { name: 'Power Outage', desc: 'In the dark: only the vote totals are shown.' },
  bonfire: { name: 'Bonfire', desc: 'The leader secretly sees one crew card.' },
  bear: { name: 'Bear Sighting', desc: 'Nobody from the last crew may go.' },
  lucky: { name: 'Lucky Loon', desc: 'If it gets done, the crew earns +100 each.' },
  leaky: { name: 'Leaky Canoe', desc: 'If it gets ruined, the storm meter rises too.' },
  calm: { name: 'Calm Evening', desc: 'Nothing strange tonight… or is there?' },
  wind: { name: 'Second Wind', desc: 'If this crew is voted down, the storm meter doesn’t rise.' },
  cold: { name: 'Cold Snap', desc: 'Everyone wants to get inside: less time to talk.' },
};
const CHORES = ['Stack the woodpile', 'Pull the canoes up the shore', 'Fix the generator', 'Tie down the dock', 'Board up the windows', 'Bring in the laundry', 'Clear the eavestroughs', 'Light the lanterns'];

/** Crew size per chore for n players. @param {number} n */
function crewSizes(n) {
  const t = n <= 4 ? [2, 2, 2, 3, 3] : n === 5 ? [2, 3, 2, 3, 3] : n === 6 ? [2, 3, 4, 3, 4] : n === 7 ? [2, 3, 3, 4, 4] : [3, 4, 4, 5, 5];
  return t.map((x) => Math.min(x, n - 1));
}

/** The role deck for n players (shuffled onto them by the game). @param {number} n @returns {RoleId[]} */
function roleDeck(n) {
  const raccoons = n <= 5 ? 1 : n <= 8 ? 2 : 3;
  /** @type {RoleId[]} */
  const bad = n >= 6 ? ['sly', ...Array(raccoons - 1).fill('raccoon')] : Array(raccoons).fill('raccoon');
  /** @type {RoleId[]} */
  const good = ['lookout'];
  if (n >= 5) good.push('handyman');
  if (n >= 6) good.push('snoop');
  while (good.length + bad.length < n) good.push('cottager');
  return [...good, ...bad];
}

class StormGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.doubleFinal = false; // points come from winning, not from rounds
    this.noPaceVotes = true;
    const ids = shuffle(this.playerIds());
    const deck = shuffle(roleDeck(ids.length));
    /** @type {Map<string, RoleId>} */
    this.roles = new Map(ids.map((id, i) => [id, deck[i]]));
    /** @type {string[]} seat order (leaders rotate) */
    this.seats = shuffle(this.playerIds());
    this.sizes = crewSizes(ids.length);
    this.totalRounds = 5;
    /** @type {(boolean | null)[]} */
    this.chores = [null, null, null, null, null];
    this.choreNames = shuffle([...CHORES]).slice(0, 5);
    /** @type {EventId[]} */
    this.events = shuffle(/** @type {EventId[]} */ (Object.keys(EVENTS)));
    this.leaderIdx = 0;
    this.storm = 0; // crews voted down in a row
    /** @type {EventId} */
    this.event = 'calm';
    /** @type {string[]} */
    this.crew = [];
    /** @type {string[]} */
    this.lastCrew = [];
    /** @type {Map<string, boolean>} */
    this.votes = new Map();
    /** @type {Map<string, 'help' | 'sabotage'>} */
    this.cards = new Map();
    /** @type {Set<string>} players who already used their one-off power */
    this.used = new Set();
    /** @type {string | null} who used Fix It on this chore */
    this.fixedBy = null;
    /** @type {Map<string, string>} snooper → private result text */
    this.peeks = new Map();
    /** @type {{ crew: string[], cards: Map<string, 'help' | 'sabotage'> } | null} the last played chore (Snoop) */
    this.lastPlayed = null;
    /** @type {Set<string>} */
    this.ready = new Set();
    /** @type {Map<string, string>} */
    this.accusations = new Map();
    /** @type {{ ok: boolean, cards: ('help' | 'sabotage')[], fixed: boolean, needed: number, index: number } | null} */
    this.reveal = null;
    /** @type {'cottage' | 'raccoon' | null} */
    this.winner = null;
    this.winReason = '';
    /** Lookout's sighting: one non-Sly raccoon. */
    const spotted = shuffle(ids.filter((id) => this.roles.get(id) === 'raccoon'));
    this.spotted = spotted[0] || null;
    /** @type {Record<string, number>} */
    this.finalGains = {};
    this.approved = false;
  }

  /** @param {string} id */
  side(id) { const r = this.roles.get(id); return r ? ROLES[r].side : 'cottage'; }
  leader() { return this.seats[this.leaderIdx % this.seats.length]; }
  chore() { return this.chores.findIndex((c) => c === null); }
  crewSize() {
    const base = this.sizes[Math.max(0, this.chore())] || 2;
    return Math.min(this.room.players.size - 1, base + (this.event === 'thunder' ? 1 : 0));
  }

  start() {
    this.phase = 'st-roles';
    this.setTimer(ROLES_MS, () => this.nextChore());
    this.push();
  }

  nextChore() {
    if (this.winner) return this.toAccuse();
    this.round = this.chore() + 1;
    this.event = this.events[(this.round - 1 + this.leaderIdx) % this.events.length];
    this.crew = [];
    this.votes = new Map();
    this.cards = new Map();
    this.fixedBy = null;
    this.reveal = null;
    // Skip leaders who left.
    for (let k = 0; k < this.seats.length && !this.room.players.has(this.leader()); k++) this.leaderIdx++;
    this.phase = 'st-talk';
    this.setTimer(this.event === 'cold' ? TALK_MS * 0.66 : TALK_MS, () => this.autoCrew());
    this.push();
  }

  /** The talk timer ran out: the leader's crew is filled at random. */
  autoCrew() {
    if (this.phase !== 'st-talk') return;
    const pool = shuffle(this.allowed());
    this.pickCrew(this.leader(), pool.slice(0, this.crewSize()));
  }

  /** Who may go on this chore's crew. */
  allowed() {
    const ids = this.playerIds();
    if (this.event !== 'bear') return ids;
    const ok = ids.filter((id) => !this.lastCrew.includes(id));
    return ok.length >= this.crewSize() ? ok : ids; // never an impossible crew
  }

  /** @param {string} id @param {string[]} crew */
  pickCrew(id, crew) {
    if (this.phase !== 'st-talk' || id !== this.leader()) return;
    const ok = new Set(this.allowed());
    const uniq = [...new Set(crew)].filter((x) => ok.has(x));
    if (uniq.length !== this.crewSize()) return;
    this.crew = uniq;
    this.phase = 'st-vote';
    this.setTimer(VOTE_MS, () => this.countVotes());
    this.push();
  }

  countVotes() {
    if (this.phase !== 'st-vote') return;
    // A missing vote counts as yes (the leader's call stands unless the room objects).
    for (const id of this.playerIds()) if (!this.votes.has(id)) this.votes.set(id, true);
    const yes = [...this.votes.values()].filter(Boolean).length;
    const approved = yes > this.votes.size / 2;
    this.phase = 'st-votes';
    this.approved = approved;
    if (!approved) {
      if (this.event !== 'wind') this.storm += 1;
      if (this.storm >= 3) { this.winner = 'raccoon'; this.winReason = 'The room argued too long — the storm hit an unprepared cottage.'; }
    }
    this.setTimer(VOTE_SHOW_MS, () => (approved ? this.toCrew() : this.passLeader()), false);
    this.push();
  }

  passLeader() {
    this.leaderIdx++;
    if (this.winner) return this.toAccuse();
    this.nextChore();
  }

  toCrew() {
    this.storm = 0;
    this.phase = 'st-crew';
    this.setTimer(CREW_MS, () => this.playChore());
    this.push();
  }

  playChore() {
    if (this.phase !== 'st-crew') return;
    for (const id of this.crew) if (!this.cards.has(id)) this.cards.set(id, 'help'); // left / slow → helps
    const cards = shuffle([...this.cards.values()]);
    let sabotage = cards.filter((c) => c === 'sabotage').length;
    if (this.fixedBy && sabotage > 0) sabotage -= 1;
    const needed = this.event === 'big' && this.crew.length >= 3 ? 2 : 1;
    const ok = sabotage < needed;
    const i = this.chore();
    this.chores[i] = ok;
    if (ok && this.event === 'lucky') for (const id of this.crew) this.award(id, LUCKY);
    if (!ok && this.event === 'leaky') this.storm = Math.min(2, this.storm + 1);
    this.lastCrew = [...this.crew];
    this.lastPlayed = { crew: [...this.crew], cards: new Map(this.cards) };
    // Bonfire: the leader privately sees one crew card.
    if (this.event === 'bonfire') {
      const who = shuffle([...this.crew])[0];
      this.peeks.set(this.leader(), `🔥 By the bonfire you saw ${this.nick(who)} play ${this.cards.get(who) === 'sabotage' ? 'SABOTAGE' : 'HELP'}.`);
    }
    this.reveal = { ok, cards, fixed: !!this.fixedBy, needed, index: i };
    const done = this.chores.filter((c) => c === true).length, ruined = this.chores.filter((c) => c === false).length;
    if (done >= 3) { this.winner = 'cottage'; this.winReason = 'Three chores done — the cottage is ready for the storm!'; }
    else if (ruined >= 3) { this.winner = 'raccoon'; this.winReason = 'Three chores ruined — the raccoons are feasting in the wreckage.'; }
    this.phase = 'st-reveal';
    this.setTimer(CARD_MS * (cards.length + 2), () => this.passLeader(), false);
    this.push();
  }

  toAccuse() {
    this.phase = 'st-accuse';
    this.setTimer(ACCUSE_MS, () => this.final());
    this.push();
  }

  final() {
    if (this.phase !== 'st-accuse') return;
    /** @type {Record<string, number>} */
    const g = {};
    const add = (/** @type {string} */ id, /** @type {number} */ n) => { g[id] = (g[id] || 0) + this.award(id, n); };
    for (const id of this.playerIds()) if (this.side(id) === this.winner) add(id, WIN);
    const accused = new Set(this.accusations.values());
    for (const [by, who] of this.accusations) if (this.side(who) === 'raccoon' && this.side(by) === 'cottage') add(by, ACCUSE_RIGHT);
    for (const id of this.playerIds()) if (this.side(id) === 'raccoon' && !accused.has(id)) add(id, UNSEEN);
    this.finalGains = g;
    this.phase = 'st-final';
    this.setTimer(FINAL_MS, () => this.gameOver(), false);
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase === 'st-roles' && payload.ready) {
      this.ready.add(id);
      if (this.allIn(this.ready)) this.nextChore(); else this.push();
    } else if (this.phase === 'st-talk' && Array.isArray(payload.crew)) {
      this.pickCrew(id, payload.crew.map(String));
    } else if (this.phase === 'st-vote' && typeof payload.vote === 'boolean' && !this.votes.has(id)) {
      this.votes.set(id, payload.vote);
      if (this.allIn(this.votes)) this.countVotes(); else this.push();
    } else if (this.phase === 'st-crew' && this.crew.includes(id) && !this.cards.has(id) && (payload.card === 'help' || payload.card === 'sabotage')) {
      // Cottagers can only help; that's what makes a sabotage card a clue.
      this.cards.set(id, this.side(id) === 'raccoon' ? payload.card : 'help');
      if (payload.fix && this.roles.get(id) === 'handyman' && !this.used.has(id)) { this.used.add(id); this.fixedBy = id; }
      if (this.crew.every((c) => this.cards.has(c) || !this.room.players.has(c))) this.playChore(); else this.push();
    } else if (payload.snoop && this.roles.get(id) === 'snoop' && !this.used.has(id) && this.lastPlayed && this.lastPlayed.crew.includes(String(payload.snoop)) && ['st-reveal', 'st-talk'].includes(this.phase)) {
      const who = String(payload.snoop);
      this.used.add(id);
      this.peeks.set(id, `🔍 You snooped: ${this.nick(who)} played ${this.lastPlayed.cards.get(who) === 'sabotage' ? 'SABOTAGE' : 'HELP'}.`);
      this.push();
    } else if (this.phase === 'st-accuse' && payload.accuse && !this.accusations.has(id)) {
      const who = String(payload.accuse);
      if (who === id || !this.room.players.has(who)) return;
      this.accusations.set(id, who);
      if (this.allIn(this.accusations)) this.final(); else this.push();
    }
  }

  /** @param {string} id */
  onPlayerLeft(id) {
    if (this.phase === 'st-talk' && id === this.leader()) { this.leaderIdx++; this.nextChore(); return; }
    if (this.phase === 'st-vote' && this.room.players.size && this.allIn(this.votes)) this.countVotes();
    else if (this.phase === 'st-crew' && this.crew.every((c) => this.cards.has(c) || !this.room.players.has(c))) this.playChore();
    else if (this.phase === 'st-accuse' && this.room.players.size && this.allIn(this.accusations)) this.final();
  }

  // --- views ------------------------------------------------------------------

  boardView() {
    const i = this.chore();
    return {
      chores: this.chores, choreNames: this.choreNames, choreIndex: i,
      storm: this.storm, leader: this.nick(this.leader()), crewSize: this.crewSize(),
      event: { id: this.event, ...EVENTS[this.event] },
      crew: this.crew.map((id) => this.nick(id)),
      seats: this.seats.filter((id) => this.room.players.has(id)).map((id) => this.nick(id)),
      raccoons: this.roleDeckCount(),
      winner: this.winner, winReason: this.winner && ['st-accuse', 'st-final', 'st-reveal', 'st-votes'].includes(this.phase) ? this.winReason : null,
    };
  }

  roleDeckCount() { return [...this.roles.values()].filter((r) => ROLES[r].side === 'raccoon').length; }

  votesView() {
    if (this.phase !== 'st-votes') return null;
    const yes = [...this.votes.values()].filter(Boolean).length;
    return {
      approved: !!this.approved, yes, no: this.votes.size - yes,
      // Power Outage: only totals.
      list: this.event === 'outage' ? null : [...this.votes].map(([id, v]) => ({ nickname: this.nick(id), yes: v })),
    };
  }

  hostView() {
    return {
      ...this.boardView(),
      readyCount: this.ready.size, votedCount: this.votes.size, playedCount: this.cards.size, accusedCount: this.accusations.size,
      totalPlayers: this.room.players.size,
      votes: this.votesView(),
      reveal: this.phase === 'st-reveal' ? this.reveal : null,
      cardMs: CARD_MS,
      // Roles are only ever shown once the game is decided.
      roles: this.phase === 'st-final' ? this.playerIds().map((id) => {
        const r = /** @type {RoleId} */ (this.roles.get(id));
        return { nickname: this.nick(id), role: ROLES[r].name, side: ROLES[r].side, gained: this.finalGains[id] || 0, accusedBy: [...this.accusations].filter(([, w]) => w === id).length };
      }) : null,
    };
  }

  /** @param {string} id */
  playerOnly(id) {
    const r = /** @type {RoleId} */ (this.roles.get(id) || 'cottager');
    const raccoon = ROLES[r].side === 'raccoon';
    return {
      gameState: { ...this.boardView(), votes: this.votesView(), reveal: this.phase === 'st-reveal' ? { ok: this.reveal && this.reveal.ok } : null },
      you: {
        role: { id: r, ...ROLES[r] },
        // Raccoons know each other; the Lookout knows one (non-Sly) raccoon.
        allies: raccoon ? this.playerIds().filter((x) => x !== id && this.side(x) === 'raccoon').map((x) => this.nick(x)) : [],
        spotted: r === 'lookout' && this.spotted && this.room.players.has(this.spotted) ? this.nick(this.spotted) : null,
        isLeader: this.leader() === id,
        candidates: this.phase === 'st-talk' && this.leader() === id ? this.allowed().map((x) => ({ id: x, nickname: this.nick(x) })) : [],
        ready: this.ready.has(id),
        voted: this.votes.has(id),
        onCrew: this.crew.includes(id),
        played: this.cards.has(id),
        canSabotage: raccoon,
        canFix: r === 'handyman' && !this.used.has(id) && this.crew.includes(id),
        canSnoop: r === 'snoop' && !this.used.has(id) && !!this.lastPlayed && ['st-reveal', 'st-talk'].includes(this.phase)
          ? this.lastPlayed.crew.filter((x) => x !== id && this.room.players.has(x)).map((x) => ({ id: x, nickname: this.nick(x) })) : [],
        peek: this.peeks.get(id) || null,
        accused: this.accusations.has(id),
        accuseTargets: this.phase === 'st-accuse' ? this.playerIds().filter((x) => x !== id).map((x) => ({ id: x, nickname: this.nick(x) })) : [],
        won: this.phase === 'st-final' ? this.side(id) === this.winner : null,
        gained: this.phase === 'st-final' ? this.finalGains[id] || 0 : null,
      },
    };
  }
}

StormGame.meta = {
  id: 'storm',
  name: 'Storm Watch',
  blurb: 'A storm is coming and some guests are raccoons in disguise. Pick crews, vote, sabotage — 10–15 min strategy.',
  minPlayers: 4,
};
StormGame.ROLES = ROLES;
StormGame.EVENTS = EVENTS;
StormGame.roleDeck = roleDeck;
StormGame.crewSizes = crewSizes;

module.exports = StormGame;
