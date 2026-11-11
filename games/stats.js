/*
 * Persistent stats, achievements and highlights (data/stats.json).
 *
 * Players are keyed by nickname (case-insensitive) — the same friends come back
 * to the cottage with the same names. Games report:
 *   stats.feat(room, playerId, 'fooled' | 'shutouts' | 'favs' | 'crowd', n)
 *   stats.highlight(room, { game, prompt?, text?, image?, by, note })
 * and server.js calls stats.recordGame(room, gameId) at every game over.
 * /highlights shows tonight's best moments + the all-time hall of fame.
 * AGPLv3 — see LICENSE.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.RUMPUS_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'stats.json');
const MAX_HIGHLIGHTS = 150;
const MAX_IMAGES = 40; // drawings are big — keep only the newest ones on disk

/**
 * @typedef {{ name: string, games: number, wins: number, points: number, nightWins: number,
 *   fooled: number, shutouts: number, favs: number, perGame: Record<string, { played: number, wins: number }> }} PlayerStats
 * @typedef {{ game: string, prompt?: string, text?: string, image?: string, by: string, note: string, at?: number }} Highlight
 * @typedef {{ players: Record<string, PlayerStats>, highlights: Highlight[] }} StatsFile
 */

/** @type {StatsFile} */
let data = { players: {}, highlights: [] };
try { data = { players: {}, highlights: [], ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) { /* first run */ }
// Players are keyed by nickname, which players choose: a prototype-free object means names like
// "constructor" or "__proto__" are just names (on a normal object they broke or poisoned the stats).
data.players = Object.assign(Object.create(null), data.players && typeof data.players === 'object' ? data.players : {});
if (!Array.isArray(data.highlights)) data.highlights = [];

/** @type {NodeJS.Timeout | null} */
let timer = null;
function write() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(data));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { /* best effort: stats are a nice-to-have */ }
}
/** Shutting down: write a pending save now. */
function flush() { if (timer) { clearTimeout(timer); timer = null; write(); } }
function save() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; write(); }, 1000);
  if (timer.unref) timer.unref(); // (browsers have no unref)
}

/** @param {string} name @returns {PlayerStats} */
function rec(name) {
  const k = name.trim().toLowerCase();
  if (!data.players[k]) data.players[k] = { name, games: 0, wins: 0, points: 0, nightWins: 0, fooled: 0, shutouts: 0, favs: 0, perGame: {} };
  data.players[k].name = name; // keep the latest spelling
  return data.players[k];
}

/** @param {Room} room @param {string} id */
function nameOf(room, id) {
  const p = room.players.get(id);
  return p && !p.bot ? p.nickname : null; // bots don't collect stats
}

/** @param {Room} room @param {string} id @param {'fooled' | 'shutouts' | 'favs'} field @param {number} [n] */
function feat(room, id, field, n = 1) {
  const name = nameOf(room, id);
  if (!name || !n) return;
  rec(name)[field] += n;
  save();
}

/** @param {Room} room @param {Highlight} h */
function highlight(room, h) {
  const entry = { ...h, at: Date.now() };
  room.highlights = room.highlights || [];
  room.highlights.unshift(entry);
  if (room.highlights.length > 60) room.highlights.length = 60;
  data.highlights.unshift(entry);
  if (data.highlights.length > MAX_HIGHLIGHTS) data.highlights.length = MAX_HIGHLIGHTS;
  let imgs = 0;
  for (const x of data.highlights) if (x.image && ++imgs > MAX_IMAGES) delete x.image;
  data.highlights = data.highlights.filter((x) => x.text || x.image);
  save();
}

/** Game over: everyone's games/points, winners' wins. @param {Room} room @param {string} gameId */
function recordGame(room, gameId) {
  const ps = [...room.players.values()].filter((p) => !p.bot);
  const top = Math.max(0, ...ps.map((p) => p.score));
  for (const p of ps) {
    const r = rec(p.nickname);
    const g = r.perGame[gameId] || (r.perGame[gameId] = { played: 0, wins: 0 });
    r.games++; g.played++;
    r.points += p.score;
    if (top > 0 && p.score === top) { r.wins++; g.wins++; }
  }
  save();
}

/** @param {Room} room @param {string} id */
function nightWin(room, id) {
  const name = nameOf(room, id);
  if (!name) return;
  rec(name).nightWins++;
  save();
}

/** Achievements earned from lifetime stats. @param {PlayerStats} r @returns {{ icon: string, title: string, desc: string }[]} */
function achievements(r) {
  /** @type {{ icon: string, title: string, desc: string }[]} */
  const out = [];
  const add = (/** @type {boolean} */ ok, /** @type {string} */ icon, /** @type {string} */ title, /** @type {string} */ desc) => { if (ok) out.push({ icon, title, desc }); };
  add(r.wins >= 1, '🥇', 'First blood', 'Won a game');
  add(r.wins >= 5, '🏆', 'Hat trick and then some', 'Won 5 games');
  add(r.games >= 10, '🦉', 'Night owl', 'Played 10 games');
  add(r.games >= 50, '🛶', 'Cottage regular', 'Played 50 games');
  add(r.fooled >= 10, '🤥', 'Master liar', 'Fooled people 10 times');
  add(r.shutouts >= 3, '💯', 'Crowd killer', '3 Campfire Quips shutouts');
  add(r.favs >= 5, '🎨', 'Fan favourite', '5 favourite steps / doodles');
  add(r.nightWins >= 1, '👑', 'Champion of the night', 'Won a game night');
  add(Object.keys(r.perGame).length >= 8, '🧭', 'Explorer', 'Played 8 different games');
  return out;
}

/** @param {Room | null} room */
function summary(room) {
  const players = Object.values(data.players)
    .map((r) => ({ ...r, achievements: achievements(r) }))
    .sort((a, b) => b.wins - a.wins || b.points - a.points);
  return { tonight: room ? room.highlights || [] : [], allTime: data.highlights.slice(0, 60), players };
}

/** For tests: forget everything (in memory). */
function _reset() { data = { players: Object.create(null), highlights: [] }; }

module.exports = { feat, highlight, recordGame, nightWin, achievements, summary, flush, _reset };
