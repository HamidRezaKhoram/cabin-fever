/*
 * "Campfire Consensus" — type the answer you think most people will type.
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
// Once every answer is in, bets get a short window (playtest: fast players waited out the full timer).
const BET_WINDOW_MS = parseInt(process.env.RUMPUS_MR_BET_WINDOW_MS || '8000', 10);
// The herd call: players decide which answers count as the same (no fussy spelling rules).
const HERD_MS = parseInt(process.env.RUMPUS_MR_HERD_MS || '20000', 10);

// "The Bananas!" -> "banana"
/** @param {string} s */
function normalize(s) {
  let t = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(a|an|the) /, '');
  t = t.split(' ').map((/** @type {string} */ w) => (w.length > 3 && w.endsWith('es') && /(ch|sh|x|s|z|o)es$/.test(w)
    ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
  return t.replace(/ /g, '');
}

class MajorityGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(6);
    this.prompt = '';
    /** @type {Map<string, string>} id → answer */
    this.answers = new Map();
    /** @type {Map<string, number>} id → how many others they expect to match them */
    this.bets = new Map();
    /** @type {{ bets: { nickname: string, bet: number, actual: number, gained: number }[], groups: { label: string, count: number, names: string[], top: boolean, herd: boolean, votes: number }[], gained: { nickname: string, gained: number }[] } | null} */
    this.result = null;
    this.poolName = 'majority';
    /** @type {PoolItem | null} */
    this.item = null;
    /** @type {{ label: string, ids: string[] }[]} answers grouped by spelling (the herd call's cards) */
    this.groups = [];
    /** @type {Map<string, number[]>} */
    this.herdVotes = new Map();
  }

  start() { this.nextRound(); }

  get skippablePhases() { return ['mr-answer']; }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    const item = library.drawOne('majority', { spicy: this.spicy(), lang: this.room.settings.lang });
    this.poolName = 'majority';
    this.item = item;
    this.prompt = (item && item.text) || BUILTIN[this.round % BUILTIN.length];
    this.answers = new Map();
    this.bets = new Map();
    this.groups = [];
    this.herdVotes = new Map();
    this.result = null;
    this.phase = 'mr-answer';
    this.setTimer(ANSWER_MS, () => this.reveal());
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase === 'mr-herd') {
      const groups = this.groups;
      const pick = Array.isArray(payload.herd) ? payload.herd : null;
      if (!pick || this.herdVotes.has(id)) return;
      const ix = [...new Set(pick.filter((/** @type {unknown} */ i) => Number.isInteger(i) && /** @type {number} */ (i) >= 0 && /** @type {number} */ (i) < groups.length))];
      if (!ix.length) return;
      this.herdVotes.set(id, /** @type {number[]} */ (ix));
      if (this.allIn(this.herdVotes)) return this.score();
      return this.push();
    }
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
    if (this.allIn(this.answers) && this.allIn(this.bets)) return this.reveal();
    if (this.allIn(this.answers) && this.endsAt && this.endsAt - Date.now() > BET_WINDOW_MS) this.setTimer(BET_WINDOW_MS, () => this.reveal(), false);
    this.push();
  }

  /** Answers grouped by spelling ("Bananas!" = "banana"): the starting point for the herd call. */
  autoGroups() {
    /** @type {Map<string, { label: string, ids: string[] }>} */
    const groups = new Map();
    for (const [id, text] of this.answers) {
      const k = normalize(text);
      const g = groups.get(k) || { label: text, ids: [] };
      g.ids.push(id);
      groups.set(k, g);
    }
    return [...groups.values()].sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));
  }

  /** Answers are in: if there's anything to judge, everyone picks which answers are THE HERD. */
  reveal() {
    if (this.phase !== 'mr-answer') return;
    this.groups = this.autoGroups();
    /** @type {Map<string, number[]>} voter → indexes of the answers they call the herd */
    this.herdVotes = new Map();
    if (this.groups.length < 2) return this.score();
    this.phase = 'mr-herd';
    this.setTimer(HERD_MS, () => this.score());
    this.push();
  }

  /** Score the round: answers voted into the herd by a majority merge into one group. */
  score() {
    if (this.phase !== 'mr-answer' && this.phase !== 'mr-herd') return;
    const auto = this.groups && this.groups.length ? this.groups : this.autoGroups();
    const votes = this.herdVotes || new Map();
    const tally = auto.map((_, i) => [...votes.values()].filter((v) => v.includes(i)).length);
    const need = Math.floor(votes.size / 2) + 1;
    let herdIx = votes.size ? tally.map((n, i) => (n >= need ? i : -1)).filter((i) => i >= 0) : [];
    if (!herdIx.length && votes.size) {
      // Nobody got a majority: the most-voted answer(s) are the herd.
      const most = Math.max(...tally);
      if (most > 0) herdIx = tally.map((n, i) => (n === most ? i : -1)).filter((i) => i >= 0);
    }
    /** @type {{ label: string, ids: string[], herd: boolean, labels: string[], votes: number }[]} */
    const list = [];
    if (herdIx.length) {
      const ids = herdIx.flatMap((i) => auto[i].ids);
      list.push({ label: auto[herdIx[0]].label, ids, herd: true, labels: herdIx.map((i) => auto[i].label), votes: Math.max(...herdIx.map((i) => tally[i])) });
    }
    auto.forEach((g, i) => { if (!herdIx.includes(i)) list.push({ label: g.label, ids: g.ids, herd: false, labels: [g.label], votes: tally[i] }); });
    list.sort((a, b) => b.ids.length - a.ids.length || Number(b.herd) - Number(a.herd));
    const biggest = list.length ? list[0].ids.length : 0;
    /** @type {{ nickname: string, gained: number }[]} */
    const gained = [];
    for (const g of list) {
      if (g.ids.length < 2) continue;
      // 100 per matching friend, +100 bonus for the (tied) biggest group.
      const pts = (g.ids.length - 1) * 100 + (g.ids.length === biggest ? 100 : 0);
      for (const id of g.ids) {
        gained.push({ nickname: this.nick(id), gained: this.award(id, pts) });
      }
    }
    /** @type {{ nickname: string, bet: number, actual: number, gained: number }[]} */
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
        label: g.labels.join(' = '),
        count: g.ids.length,
        names: g.ids.map((id) => this.nick(id)),
        top: g.ids.length === biggest && biggest > 1,
        herd: g.herd,
        votes: g.votes,
      })),
      gained,
    };
    this.phase = 'mr-reveal';
    this.setTimer(REVEAL_MS, () => this.nextRound(), false);
    this.push();
  }

  onPlayerLeft() {
    if (this.phase === 'mr-answer' && this.room.players.size && this.allIn(this.answers) && this.allIn(this.bets)) this.reveal();
    else if (this.phase === 'mr-herd' && this.room.players.size && this.allIn(this.herdVotes)) this.score();
  }

  hostView() {
    if (this.phase === 'mr-herd') {
      return { prompt: this.prompt, answers: (this.groups || []).map((g) => g.label), judgedCount: this.herdVotes.size, totalPlayers: this.room.players.size,
        waitingOn: [...this.room.players.values()].filter((p) => p.connected && !this.herdVotes.has(p.id)).map((p) => p.nickname) };
    }
    if (this.phase === 'mr-answer') {
      return { prompt: this.prompt, submittedCount: this.answers.size, betCount: this.bets.size, totalPlayers: this.room.players.size };
    }
    return { prompt: this.prompt, result: this.result };
  }

  /** @param {string} id */
  playerOnly(id) {
    if (this.phase === 'mr-herd') {
      const groups = this.groups;
      const mine = groups.findIndex((g) => g.ids.includes(id));
      return {
        gameState: { prompt: this.prompt, answers: groups.map((g) => g.label) },
        you: { mine, herdVoted: this.herdVotes.has(id), herd: this.herdVotes.get(id) || null },
      };
    }
    if (this.phase === 'mr-answer') {
      return {
        gameState: { prompt: this.prompt, maxBet: this.room.players.size - 1 },
        you: { submitted: this.answers.has(id), answer: this.answers.get(id) || null, bet: this.bets.has(id) ? this.bets.get(id) : null },
      };
    }
    const mine = this.answers.get(id);
    const g = mine && this.result ? this.result.groups.find((x) => x.names.includes(this.nick(id))) : null;
    return {
      gameState: { prompt: this.prompt, result: this.result },
      you: { answer: mine || null, matched: g ? g.count - 1 : 0, bet: this.bets.has(id) ? this.bets.get(id) : null },
    };
  }
}

MajorityGame.meta = {
  id: 'majority',
  name: 'Campfire Consensus',
  blurb: 'Answer what you think everyone else will. Matching the herd pays.',
  minPlayers: 3,
};
MajorityGame.normalize = normalize;

module.exports = MajorityGame;
