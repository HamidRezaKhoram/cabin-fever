/*
 * "The Deep End" — name something in the category, but not the obvious thing: the rarer your answer,
 * the deeper you dive off the dock. (A genre mechanic — reverse survey — with an original name, look
 * and content.)
 *
 * How deep an answer goes (the hard part, offline):
 *   1. The chart: every category has answers sorted 0 (what nearly everyone says) … 4 (lake bottom):
 *      hand-written (content-src/deepend.txt), plus Wikidata's members of the category placed by how
 *      many Wikipedias know them (tools/fetch-deepend.py, tools/build-content.py).
 *   2. The room: players who give the same answer "jump in the same spot" — each drops a tier.
 *   3. Off the chart: the room votes whether it counts. Accepted = a Drop-off (the chart missed it,
 *      so it's probably rare); turned down = a belly flop (0).
 * Stakes rise ×1 → ×2 → ×3; a score never drops. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame, cleanText } = require('./base');
const library = require('./library');

const env = (/** @type {string} */ k, /** @type {number} */ d) => parseInt(process.env[k] || String(d), 10);
const ANSWER_MS = env('RUMPUS_DD_ANSWER_MS', 30000);
const JUDGE_MS = env('RUMPUS_DD_JUDGE_MS', 15000);
const REVEAL_STEP_MS = env('RUMPUS_DD_REVEAL_STEP_MS', 1800);
const REVEAL_END_MS = env('RUMPUS_DD_REVEAL_END_MS', 5000);

/** Depth tiers: name, metres (the dive) and points. */
const TIERS = [
  { name: 'Splash', m: 2, pts: 50 },
  { name: 'Shallows', m: 6, pts: 150 },
  { name: 'Weed Bed', m: 12, pts: 300 },
  { name: 'Drop-off', m: 20, pts: 450 },
  { name: 'Lake Bottom', m: 30, pts: 600 },
];
const OFF_CHART_TIER = 3;
/** 🤯 "Never heard of it!" during the reveal: each one gives the answer's diver this much. */
const WOW_PTS = 25;

/** @typedef {{ id: string, q: string, answers: (number | string)[][], a?: boolean, src?: string }} DeepItem */
/** @type {DeepItem[]} used when the built pool is missing (tests, a broken install) */
const BUILTIN = [
  { id: 'dd-b1', q: 'Name a fruit', answers: [[0, 'apple'], [0, 'banana'], [1, 'mango'], [2, 'papaya'], [3, 'lychee'], [4, 'durian'], [4, 'rambutan']] },
  { id: 'dd-b2', q: 'Name a bird', answers: [[0, 'eagle'], [0, 'robin'], [1, 'penguin'], [2, 'loon'], [3, 'puffin'], [4, 'hoatzin'], [4, 'shoebill']] },
];

/** An answer as a match key: lower case, no accents or punctuation, no "the/a/an", each word singular.
 * @param {string} s */
function keyOf(s) {
  const words = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && ['the', 'a', 'an', 'some'].includes(words[0])) words.shift();
  return words.map((w) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y'
    : w.length > 4 && /(ches|shes|xes|sses|oes)$/.test(w) ? w.slice(0, -2)
      : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w)).join('');
}

/** Edit distance with a cap (stops early past it). @param {string} a @param {string} b @param {number} cap */
function distance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** A chart as match keys → [tier, display name, answer index]. @param {DeepItem} item */
function chartOf(item) {
  /** @type {Map<string, { tier: number, name: string, n: number }>} */
  const map = new Map();
  item.answers.forEach((row, n) => {
    const tier = Number(row[0]);
    for (const form of row.slice(1)) {
      const k = keyOf(String(form));
      if (k && !map.has(k)) map.set(k, { tier, name: String(row[1]), n });
    }
  });
  return map;
}

/** Find an answer on a chart: exact key, else one typo (two for long words).
 * @param {Map<string, { tier: number, name: string, n: number }>} chart @param {string} text */
function lookup(chart, text) {
  const k = keyOf(text);
  if (!k) return null;
  const hit = chart.get(k);
  if (hit) return hit;
  if (k.length < 5) return null;
  const cap = k.length >= 9 ? 2 : 1;
  /** @type {{ tier: number, name: string, n: number } | null} */
  let best = null, bestD = cap + 1;
  for (const [ck, v] of chart) {
    if (ck.length < 4) continue;
    const d = distance(k, ck, cap);
    if (d < bestD || (d === bestD && best && v.tier < best.tier)) { best = v; bestD = d; }
  }
  return bestD <= cap ? best : null;
}

class DeepEndGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = this.rounds(6);
    /** @type {DeepItem | null} */
    this.item = null;
    /** @type {Map<string, { tier: number, name: string, n: number }>} */
    this.chart = new Map();
    /** @type {Map<string, string>} what each player typed */
    this.answers = new Map();
    /** @type {Map<string, Map<string, boolean>>} off-chart answer key → voter → counts? */
    this.judging = new Map();
    /** @type {{ key: string, text: string, by: string[] }[]} the off-chart answers on the vote */
    this.offChart = [];
    /** @type {any} */
    this.result = null;
    /** @type {Map<string, Set<string>>} 🤯 on the reveal: whose answer → who reacted */
    this.wows = new Map();
  }

  get skippablePhases() { return ['dd-answer']; }

  start() { this.nextRound(); }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    const drawn = /** @type {DeepItem | null} */ (/** @type {unknown} */ (library.drawOne('deepend', { spicy: this.spicy() })));
    this.item = drawn && Array.isArray(drawn.answers) && drawn.answers.length ? drawn : BUILTIN[(this.round - 1) % BUILTIN.length];
    this.chart = chartOf(this.item);
    this.answers = new Map();
    this.judging = new Map();
    this.offChart = [];
    this.result = null;
    this.wows = new Map();
    this.phase = 'dd-answer';
    this.setTimer(ANSWER_MS, () => this.closeAnswers());
    this.push();
  }

  /** @param {string} text */
  match(text) { return lookup(this.chart, text); }

  /** Answers in: off-chart ones go to the room, or straight to the reveal. */
  closeAnswers() {
    if (this.phase !== 'dd-answer') return;
    /** @type {Map<string, { key: string, text: string, by: string[] }>} */
    const off = new Map();
    for (const [id, text] of this.answers) {
      if (this.match(text)) continue;
      const key = keyOf(text);
      const o = off.get(key) || { key, text, by: [] };
      o.by.push(id);
      off.set(key, o);
    }
    this.offChart = [...off.values()];
    // Someone other than the author has to be able to judge it.
    const judges = (/** @type {{ by: string[] }} */ o) => this.playerIds().some((id) => !o.by.includes(id));
    if (this.offChart.some(judges)) {
      this.phase = 'dd-judge';
      this.judging = new Map(this.offChart.map((o) => [o.key, new Map()]));
      this.setTimer(JUDGE_MS, () => this.reveal());
      this.push();
    } else this.reveal();
  }

  /** Has `id` judged every off-chart answer they may judge? @param {string} id */
  judgedAll(id) {
    return this.offChart.every((o) => o.by.includes(id) || (this.judging.get(o.key) || new Map()).has(id));
  }

  /** Did the room let this off-chart answer count? Most votes yes (a tie counts; no votes at all doesn't). @param {string} key */
  accepted(key) {
    const v = [...(this.judging.get(key) || new Map()).values()];
    const yes = v.filter(Boolean).length;
    return yes > 0 && yes >= v.length - yes;
  }

  reveal() {
    if (this.phase !== 'dd-answer' && this.phase !== 'dd-judge') return;
    /** One entry per answer the room gave (players who gave the same one share it). */
    /** @type {Map<string, { text: string, by: string[], tier: number | null, chart: boolean, note: string }>} */
    const spots = new Map();
    for (const [id, text] of this.answers) {
      const hit = this.match(text);
      const key = hit ? 'c' + hit.n : 'o' + keyOf(text);
      const s = spots.get(key) || { text: hit ? hit.name : text, by: [], tier: hit ? hit.tier : null, chart: !!hit, note: '' };
      s.by.push(id);
      spots.set(key, s);
    }
    const rows = [];
    for (const s of spots.values()) {
      let tier = s.tier;
      if (!s.chart) {
        const ok = this.accepted(keyOf(s.text));
        tier = ok ? OFF_CHART_TIER : null;
        s.note = ok ? 'Off the chart — the room let it count!' : 'Belly flop — the room said no';
      }
      // Two or more of you in the same spot: everyone sharing it goes one tier shallower.
      if (tier !== null && s.by.length > 1) { tier = Math.max(0, tier - 1); s.note = `${s.by.length} of you jumped in the same spot!`; }
      for (const id of s.by) {
        const gained = tier === null ? 0 : this.award(id, TIERS[tier].pts);
        rows.push({ id, nickname: this.nick(id), text: s.text, tier, tierName: tier === null ? 'Belly flop' : TIERS[tier].name, m: tier === null ? 0 : TIERS[tier].m, gained, note: s.note, shared: s.by.length > 1 });
      }
    }
    for (const id of this.playerIds()) if (!this.answers.has(id)) rows.push({ id, nickname: this.nick(id), text: '', tier: null, tierName: 'Stayed on the dock', m: 0, gained: 0, note: '', shared: false });
    // Shallowest first: the deepest dive is the last thing the room sees.
    rows.sort((a, b) => (a.tier === null ? -1 : a.tier) - (b.tier === null ? -1 : b.tier) || a.gained - b.gained);
    const chart = /** @type {DeepItem} */ (this.item).answers;
    const named = (/** @type {number} */ t) => chart.filter((r) => Number(r[0]) === t).map((r) => String(r[1]));
    const said = new Set(rows.map((r) => keyOf(r.text)));
    this.result = {
      rows,
      obvious: named(0).slice(0, 4),
      // A treasure from the lake bottom nobody said (seeded, so a replay shows the same one).
      treasure: this.rng.pick(named(4).filter((n) => !said.has(keyOf(n)))) || null,
    };
    this.phase = 'dd-reveal';
    this.setTimer(REVEAL_STEP_MS * rows.length + REVEAL_END_MS, () => this.nextRound(), false);
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload @returns {void | boolean} */
  handleSubmit(id, payload) {
    if (this.phase === 'dd-answer' && typeof payload.text === 'string') {
      const text = cleanText(payload.text, 40);
      if (!text || !keyOf(text)) return false;
      this.answers.set(id, text); // a new answer replaces the last one until time's up
      if (this.allIn(this.answers)) this.closeAnswers(); else this.push();
      return;
    }
    if (this.phase === 'dd-reveal' && typeof payload.wow === 'string') {
      // 🤯 "Never heard of it!" — on someone else's answer, once each (a decision while the dives play).
      const row = this.result && this.result.rows.find((/** @type {{ id: string, text: string }} */ r) => r.id === payload.wow && r.text);
      if (!row || row.id === id) return false;
      const set = this.wows.get(row.id) || new Set();
      if (set.has(id)) return;
      set.add(id);
      this.wows.set(row.id, set);
      if (this.room.players.has(row.id)) this.award(row.id, WOW_PTS);
      this.push();
      return;
    }
    if (this.phase === 'dd-judge' && typeof payload.judge === 'string' && typeof payload.ok === 'boolean') {
      const o = this.offChart.find((x) => x.key === payload.judge);
      if (!o || o.by.includes(id)) return false; // not on the vote, or your own
      /** @type {Map<string, boolean>} */ (this.judging.get(o.key)).set(id, payload.ok);
      if (this.playerIds().every((p) => this.judgedAll(p))) this.reveal(); else this.push();
    }
  }

  /** @param {string} id */
  onPlayerLeft(id) {
    this.answers.delete(id);
    for (const v of this.judging.values()) v.delete(id);
    if (this.phase === 'dd-answer' && this.room.players.size && this.allIn(this.answers)) this.closeAnswers();
    else if (this.phase === 'dd-judge' && this.room.players.size && this.playerIds().every((p) => this.judgedAll(p))) this.reveal();
  }

  common() {
    return { prompt: this.item ? this.item.q : '', tiers: TIERS.map((t) => ({ name: t.name, m: t.m, pts: t.pts })), src: (this.item && this.item.src) || null };
  }

  hostView() {
    const c = this.common();
    const waiting = (/** @type {(id: string) => boolean} */ done) => this.playerIds().filter((id) => !done(id)).map((id) => this.nick(id));
    if (this.phase === 'dd-answer') return { ...c, answeredCount: this.answers.size, totalPlayers: this.room.players.size, waitingOn: waiting((id) => this.answers.has(id)) };
    if (this.phase === 'dd-judge') {
      return { ...c, judging: this.offChart.map((o) => ({ key: o.key, text: o.text })), waitingOn: waiting((id) => this.judgedAll(id)),
        judgedCount: this.playerIds().filter((id) => this.judgedAll(id)).length, totalPlayers: this.room.players.size };
    }
    return { ...c, result: this.publicResult(), stepMs: REVEAL_STEP_MS };
  }

  /** The reveal as screens see it: each row with its 🤯 count (player ids stay on the server, except
   * as the key a phone reacts with). */
  publicResult() {
    if (!this.result) return null;
    return { ...this.result, rows: this.result.rows.map((/** @type {{ id: string }} */ r) => ({ ...r, wows: (this.wows.get(r.id) || new Set()).size })) };
  }

  /** @param {string} id */
  playerOnly(id) {
    const c = this.common();
    const mine = this.answers.get(id) || '';
    if (this.phase === 'dd-answer') {
      // Private feedback: on the chart or not (never how deep: that's the reveal).
      return { gameState: c, you: { answer: mine || null, onChart: mine ? !!this.match(mine) : null } };
    }
    if (this.phase === 'dd-judge') {
      const votes = this.offChart.filter((o) => !o.by.includes(id)).map((o) => ({ key: o.key, text: o.text, vote: (this.judging.get(o.key) || new Map()).get(id) ?? null }));
      return { gameState: c, you: { answer: mine || null, judge: votes, judged: this.judgedAll(id) } };
    }
    const row = this.result && this.result.rows.find((/** @type {{ nickname: string }} */ r) => r.nickname === this.nick(id));
    const mineWows = [...this.wows].filter(([, set]) => set.has(id)).map(([who]) => who);
    return { gameState: { ...c, result: this.publicResult() }, you: { answer: mine || null, row: row || null, wowed: mineWows, playerId: id } };
  }
}

DeepEndGame.meta = {
  id: 'deepend',
  name: 'The Deep End',
  blurb: 'Name something in the category, but not the obvious thing. Rare answers dive deep; the one everyone says barely gets you wet.',
  minPlayers: 2,
};
DeepEndGame.keyOf = keyOf;
DeepEndGame.lookup = lookup;
DeepEndGame.chartOf = chartOf;
DeepEndGame.TIERS = TIERS;

module.exports = DeepEndGame;
