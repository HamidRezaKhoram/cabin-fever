/*
 * "Odd Duck Out" — social deduction. Everyone gets the same secret word except
 * one imposter, who only knows the category. Give a one-word clue, then vote
 * out the imposter. If caught, the imposter can still steal by guessing the
 * word. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame, cleanText } = require('./base');
const library = require('./library');

// { category, words: [8+] }
const BUILTIN = [
  { category: 'Camping gear', words: ['Tent', 'Lantern', 'Sleeping bag', 'Compass', 'Canoe', 'Hatchet', 'Cooler', 'Bug spray'] },
  { category: 'Animals', words: ['Moose', 'Beaver', 'Penguin', 'Giraffe', 'Octopus', 'Kangaroo', 'Owl', 'Raccoon'] },
  { category: 'Foods', words: ['Pizza', 'Sushi', 'Tacos', 'Pancakes', 'Poutine', 'Spaghetti', 'Burger', 'Curry'] },
  { category: 'Jobs', words: ['Firefighter', 'Dentist', 'Pilot', 'Chef', 'Teacher', 'Astronaut', 'Plumber', 'Lifeguard'] },
  { category: 'Places', words: ['Airport', 'Hospital', 'Library', 'Beach', 'Casino', 'Zoo', 'Movie theatre', 'Gym'] },
  { category: 'Sports', words: ['Hockey', 'Tennis', 'Golf', 'Bowling', 'Surfing', 'Boxing', 'Curling', 'Basketball'] },
  { category: 'Household items', words: ['Toaster', 'Vacuum', 'Mirror', 'Couch', 'Fridge', 'Lamp', 'Blender', 'Pillow'] },
  { category: 'Weather', words: ['Thunderstorm', 'Blizzard', 'Rainbow', 'Fog', 'Hail', 'Heatwave', 'Tornado', 'Drizzle'] },
  { category: 'Instruments', words: ['Guitar', 'Drums', 'Violin', 'Trumpet', 'Piano', 'Harmonica', 'Banjo', 'Flute'] },
  { category: 'Vehicles', words: ['Bicycle', 'Helicopter', 'Submarine', 'Tractor', 'Motorcycle', 'Sailboat', 'Train', 'Snowmobile'] },
  { category: 'Holidays', words: ['Halloween', 'Christmas', 'Thanksgiving', 'New Year', 'Valentine\'s Day', 'Easter', 'Canada Day', 'Birthday'] },
  { category: 'Fantasy', words: ['Dragon', 'Wizard', 'Unicorn', 'Castle', 'Mermaid', 'Troll', 'Ghost', 'Vampire'] },
];

const CLUE_MS = parseInt(process.env.RUMPUS_IMP_CLUE_MS || '25000', 10);
const VOTE_MS = parseInt(process.env.RUMPUS_IMP_VOTE_MS || '25000', 10);
const GUESS_MS = parseInt(process.env.RUMPUS_IMP_GUESS_MS || '20000', 10);
const REVEAL_MS = parseInt(process.env.RUMPUS_REVEAL_MS || '9000', 10);

class ImposterGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(3);
    this.category = '';
    this.word = '';
    /** @type {string[]} */
    this.options = [];
    this.imposter = '';
    /** @type {string[]} */
    this.order = [];
    /** @type {Map<string, string>} */
    this.clues = new Map();
    /** @type {Map<string, string>} voter → suspect */
    this.votes = new Map();
    /** @type {string | null} */
    this.guess = null;
    /** @type {Record<string, any> | null} */
    this.result = null;
    this.caught = false;
    /** @type {string | null} */
    this.accused = null;
    /** @type {{ nickname: string, votes: number }[]} */
    this.voteCounts = [];
    this.poolName = 'imposter';
    /** @type {PoolItem | null} */
    this.item = null;
  }

  start() { this.nextRound(); }

  get skippablePhases() { return ['imp-clue']; }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    const item = library.drawOne('imposter', {
      spicy: this.spicy(),
      filter: (/** @type {PoolItem} */ x) => Array.isArray(x.words) && x.words.length >= 4,
    });
    this.poolName = 'imposter';
    this.item = item;
    const fallback = BUILTIN[this.round % BUILTIN.length];
    this.category = item ? item.category : fallback.category;
    // Roles first: who the imposter is must not depend on how many words this card has.
    const ids = this.playerIds();
    this.imposter = ids[this.rng.int(0, ids.length - 1)] || '';
    // A built-in card has no set word: any of its words can be the secret (it was always the first).
    this.word = item ? item.word : this.rng.pick(fallback.words);
    this.order = this.rng.shuffleIn(ids.slice());
    const decoys = this.rng.shuffleIn(/** @type {string[]} */ (item ? item.words : fallback.words).filter((w) => w !== this.word)).slice(0, 7);
    this.options = this.rng.shuffleIn([this.word, ...decoys]);
    this.clues = new Map();
    this.votes = new Map();
    this.guess = null;
    this.result = null;
    this.phase = 'imp-clue';
    this.setTimer(CLUE_MS, () => this.beginVote());
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase === 'imp-clue') {
      if (this.clues.has(id)) return;
      const clue = cleanText(payload.text, 30);
      if (!clue) return;
      this.clues.set(id, clue);
      if (this.allIn(this.clues)) this.beginVote();
      else this.push();
    } else if (this.phase === 'imp-vote') {
      if (this.votes.has(id)) return;
      const t = payload.target;
      if (t === id || !this.room.players.has(t)) return;
      this.votes.set(id, t);
      if (this.allIn(this.votes)) this.tally();
      else this.push();
    } else if (this.phase === 'imp-guess') {
      if (id !== this.imposter || this.guess != null) return;
      const c = payload.choice;
      if (!Number.isInteger(c) || c < 0 || c >= this.options.length) return;
      this.guess = this.options[c] || null;
      this.finish();
    }
  }

  beginVote() {
    if (this.phase !== 'imp-clue') return;
    this.phase = 'imp-vote';
    this.setTimer(VOTE_MS, () => this.tally());
    this.push();
  }

  tally() {
    if (this.phase !== 'imp-vote') return;
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const t of this.votes.values()) counts.set(t, (counts.get(t) || 0) + 1);
    const max = Math.max(0, ...counts.values());
    const top = [...counts.entries()].filter(([, n]) => n === max).map(([t]) => t);
    // Caught only on a clear plurality — ties let the imposter slip away.
    this.caught = max > 0 && top.length === 1 && top[0] === this.imposter;
    this.accused = top.length === 1 ? top[0] : null;
    this.voteCounts = [...counts.entries()]
      .map(([t, n]) => ({ nickname: this.nick(t), votes: n }))
      .sort((a, b) => b.votes - a.votes);
    if (this.caught && this.room.players.has(this.imposter)) {
      this.phase = 'imp-guess';
      this.setTimer(GUESS_MS, () => this.finish());
      this.push();
    } else {
      this.finish();
    }
  }

  finish() {
    if (this.phase !== 'imp-vote' && this.phase !== 'imp-guess') return;
    const guessedRight = this.guess === this.word;
    /** @type {{ nickname: string, gained: number }[]} */
    const gained = [];
    const add = (/** @type {string} */ id, /** @type {number} */ pts) => { if (pts) gained.push({ nickname: this.nick(id), gained: this.award(id, pts) }); };
    for (const [voter, t] of this.votes) if (voter !== this.imposter && t === this.imposter) add(voter, 100);
    if (!this.caught) add(this.imposter, 300);
    else if (guessedRight) add(this.imposter, 200);
    const mine = gained.find((x) => x.nickname === this.nick(this.imposter));
    let outcome;
    if (!this.caught) outcome = 'escaped';
    else if (guessedRight) outcome = 'stole';
    else outcome = 'caught';
    this.result = {
      imposter: this.nick(this.imposter),
      word: this.word,
      guess: this.guess,
      outcome,
      accused: this.accused ? this.nick(this.accused) : null,
      voteCounts: this.voteCounts,
      gained,
      /** what the imposter really got (×2/×3 stakes) */
      impGained: mine ? mine.gained : 0,
    };
    this.phase = 'imp-reveal';
    this.setTimer(REVEAL_MS, () => this.nextRound(), false);
    this.push();
  }

  /** @param {string} id */
  onPlayerLeft(id) {
    if (this.phase !== 'gameover' && this.room.players.size < (ImposterGame.meta.minPlayers || 3)) { this.clearTimer(); return this.gameOver(); }
    if (id === this.imposter && (this.phase === 'imp-clue' || this.phase === 'imp-vote' || this.phase === 'imp-guess')) {
      // Round can't continue without the imposter — reshuffle. It's a new round: phones must drop
      // anything half-typed for the old word (skipSeq makes them redraw; pace votes start over).
      this.clearTimer();
      this.skipSeq = (this.skipSeq || 0) + 1;
      this.round -= 1;
      this.nextRound();
      return;
    }
    // Their own clue and vote go with them (the TV mustn't say "3/3 in" while someone still has to).
    if (this.phase === 'imp-clue') this.clues.delete(id);
    this.votes.delete(id);
    if (this.phase === 'imp-clue' && this.room.players.size && this.allIn(this.clues)) this.beginVote();
    else if (this.phase === 'imp-vote') {
      for (const [v, t] of this.votes) if (t === id) this.votes.delete(v);
      if (this.room.players.size && this.allIn(this.votes)) this.tally();
    }
  }

  clueList() {
    return this.order
      .filter((id) => this.room.players.has(id))
      .map((id) => ({ id, nickname: this.nick(id), clue: this.clues.get(id) || '…' }));
  }

  hostView() {
    const common = { category: this.category };
    if (this.phase === 'imp-clue') {
      return { ...common, submittedCount: this.clues.size, totalPlayers: this.room.players.size };
    }
    if (this.phase === 'imp-vote') {
      // Suspicion meter: how many votes each suspect has so far (never who cast them).
      /** @type {Record<string, number>} */
      const tally = {};
      for (const t of this.votes.values()) tally[t] = (tally[t] || 0) + 1;
      const clues = this.clueList().map((c) => ({ ...c, suspicion: tally[c.id] || 0 }));
      return { ...common, clues, votedCount: this.votes.size, totalPlayers: this.room.players.size };
    }
    if (this.phase === 'imp-guess') {
      return { ...common, clues: this.clueList(), imposter: this.nick(this.imposter), options: this.options };
    }
    return { ...common, clues: this.clueList(), result: this.result };
  }

  /** @param {string} id */
  playerOnly(id) {
    const isImposter = id === this.imposter;
    const common = { category: this.category };
    const you = { isImposter, word: isImposter ? null : this.word };
    if (this.phase === 'imp-clue') {
      return { gameState: common, you: { ...you, submitted: this.clues.has(id) } };
    }
    if (this.phase === 'imp-vote') {
      return {
        gameState: { ...common, clues: this.clueList().filter((c) => c.id !== id) },
        you: { ...you, voted: this.votes.has(id) },
      };
    }
    if (this.phase === 'imp-guess') {
      return {
        gameState: { ...common, imposter: this.nick(this.imposter), options: isImposter ? this.options : [] },
        you,
      };
    }
    return { gameState: { ...common, result: this.result }, you };
  }
}

ImposterGame.meta = {
  id: 'imposter',
  name: 'Odd Duck Out',
  blurb: 'Everyone knows the secret word — except the imposter. Give clues, find the faker.',
  minPlayers: 3,
};

module.exports = ImposterGame;
