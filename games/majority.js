/*
 * "Majority Rules" — type the answer you think most people will type.
 * Points for every other player who matched you. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame, cleanText } = require('./base');
const library = require('./library');

const BUILTIN = [
  'Name a fruit that is yellow',
  'Name something you bring to the beach',
  'Name a famous wizard',
  'Name an animal you might see at a cottage',
  'Name a pizza topping',
  'Name something people are afraid of',
  'Name a breakfast food',
  'Name a board game',
  'Name a superhero',
  'Name something that is cold',
  'Name a color of the rainbow',
  'Name a sport played with a ball',
  'Name something you do on a rainy day',
  'Name a vegetable kids hate',
  'Name a planet',
  'Name a famous painter',
  'Name something you roast over a campfire',
  'Name a musical instrument',
  'Name a dog breed',
  'Name something in a junk drawer',
  'Name a holiday',
  'Name a candy bar',
  'Name a kitchen appliance',
  'Name something that has wheels',
  'Name a type of weather',
  'Name a cartoon character',
  'Name an ice cream flavor',
  'Name something you find in a forest',
  'Name a country in Europe',
  'Name a word that rhymes with "cat"',
];

const ANSWER_MS = parseInt(process.env.RUMPUS_MR_ANSWER_MS || '30000', 10);
const REVEAL_MS = parseInt(process.env.RUMPUS_REVEAL_MS || '7000', 10);
// Second decision per round: "how many others will match you?" — exact call pays.
const BET_PTS = 150;
const BET_ZERO_PTS = 50; // calling "nobody" is easy to force with a weird answer, so it pays less

// "The Bananas!" -> "banana"
function normalize(s) {
  let t = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(a|an|the) /, '');
  t = t.split(' ').map((w) => (w.length > 3 && w.endsWith('es') && /(ch|sh|x|s|z|o)es$/.test(w)
    ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
  return t.replace(/ /g, '');
}

class MajorityGame extends BaseGame {
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(6);
  }

  start() { this.nextRound(); }

  get skippablePhases() { return ['mr-answer']; }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    const item = library.drawOne('majority', { spicy: this.spicy() });
    this.poolName = 'majority';
    this.item = item;
    this.prompt = item ? item.text : BUILTIN[this.round % BUILTIN.length];
    this.answers = new Map(); // id -> text
    this.bets = new Map();    // id -> how many others they expect to match them
    this.result = null;
    this.phase = 'mr-answer';
    this.setTimer(ANSWER_MS, () => this.reveal());
    this.push();
  }

  handleSubmit(id, payload) {
    if (this.phase !== 'mr-answer') return;
    if (this.answers.has(id)) {
      const n = payload.bet;
      if (this.bets.has(id) || !Number.isInteger(n) || n < 0 || n > this.room.players.size - 1) return;
      this.bets.set(id, n);
    } else {
      const text = cleanText(payload.text, 40);
      if (!text || !normalize(text)) return;
      this.answers.set(id, text);
    }
    if (this.allIn(this.answers) && this.allIn(this.bets)) this.reveal();
    else this.push();
  }

  reveal() {
    if (this.phase !== 'mr-answer') return;
    const groups = new Map(); // key -> { label, ids }
    for (const [id, text] of this.answers) {
      const k = normalize(text);
      if (!groups.has(k)) groups.set(k, { label: text, ids: [] });
      groups.get(k).ids.push(id);
    }
    const list = [...groups.values()].sort((a, b) => b.ids.length - a.ids.length);
    const biggest = list.length ? list[0].ids.length : 0;
    const gained = [];
    for (const g of list) {
      if (g.ids.length < 2) continue;
      // 100 per matching friend, +100 bonus for the (tied) biggest group.
      const pts = (g.ids.length - 1) * 100 + (g.ids.length === biggest ? 100 : 0);
      for (const id of g.ids) {
        gained.push({ nickname: this.nick(id), gained: this.award(id, pts) });
      }
    }
    const bets = [];
    for (const [id, n] of this.bets) {
      const g = list.find((x) => x.ids.includes(id));
      const actual = g ? g.ids.length - 1 : 0;
      const won = n === actual ? this.award(id, n === 0 ? BET_ZERO_PTS : BET_PTS) : 0;
      bets.push({ nickname: this.nick(id), bet: n, actual, gained: won });
      if (won) {
        const row = gained.find((x) => x.nickname === this.nick(id));
        if (row) row.gained += won; else gained.push({ nickname: this.nick(id), gained: won });
      }
    }
    this.result = {
      bets,
      groups: list.map((g) => ({
        label: g.label,
        count: g.ids.length,
        names: g.ids.map((id) => this.nick(id)),
        top: g.ids.length === biggest && biggest > 1,
      })),
      gained,
    };
    this.phase = 'mr-reveal';
    this.setTimer(REVEAL_MS, () => this.nextRound(), false);
    this.push();
  }

  onPlayerLeft() {
    if (this.phase === 'mr-answer' && this.room.players.size && this.allIn(this.answers) && this.allIn(this.bets)) this.reveal();
  }

  hostView() {
    if (this.phase === 'mr-answer') {
      return { prompt: this.prompt, submittedCount: this.answers.size, betCount: this.bets.size, totalPlayers: this.room.players.size };
    }
    return { prompt: this.prompt, result: this.result };
  }

  playerOnly(id) {
    if (this.phase === 'mr-answer') {
      return {
        gameState: { prompt: this.prompt, maxBet: this.room.players.size - 1 },
        you: { submitted: this.answers.has(id), answer: this.answers.get(id) || null, bet: this.bets.has(id) ? this.bets.get(id) : null },
      };
    }
    const mine = this.answers.get(id);
    const g = mine && this.result.groups.find((x) => x.names.includes(this.nick(id)));
    return {
      gameState: { prompt: this.prompt, result: this.result },
      you: { answer: mine || null, matched: g ? g.count - 1 : 0, bet: this.bets.has(id) ? this.bets.get(id) : null },
    };
  }
}

MajorityGame.meta = {
  id: 'majority',
  name: 'Majority Rules',
  blurb: 'Answer what you think everyone else will. Matching the herd pays.',
  minPlayers: 3,
};
MajorityGame.normalize = normalize;

module.exports = MajorityGame;
