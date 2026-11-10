/*
 * "Odd One Out" — social deduction. Everyone gets the same secret word except
 * one imposter, who only knows the category. Give a one-word clue, then vote
 * out the imposter. If caught, the imposter can still steal by guessing the
 * word. AGPLv3 — see LICENSE.
 */
'use strict';

const crypto = require('crypto');
const { BaseGame, shuffle, cleanText } = require('./base');
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

const CLUE_MS = parseInt(process.env.RUMPUS_IMP_CLUE_MS || '40000', 10);
const VOTE_MS = parseInt(process.env.RUMPUS_IMP_VOTE_MS || '40000', 10);
const GUESS_MS = parseInt(process.env.RUMPUS_IMP_GUESS_MS || '20000', 10);
const REVEAL_MS = parseInt(process.env.RUMPUS_REVEAL_MS || '9000', 10);

class ImposterGame extends BaseGame {
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(3);
  }

  start() { this.nextRound(); }

  get skippablePhases() { return ['imp-clue']; }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    const item = library.drawOne('imposter', {
      spicy: this.spicy(),
      filter: (x) => Array.isArray(x.words) && x.words.length >= 4,
    });
    const fallback = BUILTIN[this.round % BUILTIN.length];
    this.category = item ? item.category : fallback.category;
    this.word = item ? item.word : fallback.words[0];
    const decoys = shuffle((item ? item.words : fallback.words).filter((w) => w !== this.word)).slice(0, 7);
    this.options = shuffle([this.word, ...decoys]);
    const ids = this.playerIds();
    this.imposter = ids[crypto.randomInt(ids.length)];
    this.order = shuffle(ids.slice());
    this.clues = new Map();
    this.votes = new Map();
    this.guess = null;
    this.result = null;
    this.phase = 'imp-clue';
    this.setTimer(CLUE_MS, () => this.beginVote());
    this.push();
  }

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
      this.guess = this.options[c];
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
    const gained = [];
    const add = (id, pts) => { if (pts) gained.push({ nickname: this.nick(id), gained: this.award(id, pts) }); };
    for (const [voter, t] of this.votes) if (voter !== this.imposter && t === this.imposter) add(voter, 100);
    if (!this.caught) add(this.imposter, 300);
    else if (guessedRight) add(this.imposter, 200);
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
    };
    this.phase = 'imp-reveal';
    this.setTimer(REVEAL_MS, () => this.nextRound(), false);
    this.push();
  }

  onPlayerLeft(id) {
    if (id === this.imposter && (this.phase === 'imp-clue' || this.phase === 'imp-vote' || this.phase === 'imp-guess')) {
      // Round can't continue without the imposter — reshuffle.
      this.clearTimer();
      this.round -= 1;
      this.nextRound();
      return;
    }
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
      return { ...common, clues: this.clueList(), votedCount: this.votes.size, totalPlayers: this.room.players.size };
    }
    if (this.phase === 'imp-guess') {
      return { ...common, clues: this.clueList(), imposter: this.nick(this.imposter), options: this.options };
    }
    return { ...common, clues: this.clueList(), result: this.result };
  }

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
  name: 'Odd One Out',
  blurb: 'Everyone knows the secret word — except the imposter. Give clues, find the faker.',
  minPlayers: 3,
};

module.exports = ImposterGame;
