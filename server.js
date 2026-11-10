/*
 * Rumpus — self-hosted Jackbox-style party game platform.
 * Copyright (C) 2026
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version. See LICENSE for details.
 */
'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const QRCode = require('qrcode');
const library = require('./games/library');
const flow = require('./games/flow');
const { cleanLook, LOOK_PARTS } = require('./games/avatar-schema');
const botBrain = require('./games/bot-brain');
const { NightGame, placePoints } = require('./games/night');
const stats = require('./games/stats');
const house = require('./games/house');
const NIGHT_GAP_MS = parseInt(process.env.RUMPUS_NIGHT_GAP_MS || '12000', 10);

const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '12', 10);
// How long a dropped phone / TV keeps its seat before being removed.
const PLAYER_GRACE_MS = parseInt(process.env.PLAYER_GRACE_MS || '120000', 10);
const HOST_GRACE_MS = parseInt(process.env.HOST_GRACE_MS || '300000', 10);
const DEBUG = process.env.RUMPUS_DEBUG === '1';
const dlog = (...a) => { if (DEBUG) console.log('[debug]', new Date().toISOString().slice(11, 23), ...a); };
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const MUSIC_DIR = process.env.RUMPUS_MUSIC_DIR || path.join(__dirname, 'music');
const AVATAR_COUNT = 17; // must match public/sprites.js

// Order here = order on the TV's game picker.
const GAMES = {};
for (const mod of [
  'quiplash', 'fibbage', 'trivia', 'closest', 'majority', 'mostlikely',
  'imposter', 'twotruths', 'telephone', 'minigames', 'looncall', 'crush', 'cah',
]) {
  const G = require(`./games/${mod}`);
  GAMES[G.meta.id] = G;
}
const GAME_LIST = Object.values(GAMES).map((G) => G.meta);

const app = express();
const server = http.createServer(app);
// Drawings travel as data URLs; allow up to 2 MB per message.
const io = new Server(server, { maxHttpBufferSize: 2e6, pingInterval: 10000, pingTimeout: 8000 });

app.get('/', (req, res) => res.redirect('/play'));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
// Pretty URLs the TV links to (static would only serve /admin.html, /highlights.html).
app.get('/admin', (/** @type {any} */ req, /** @type {any} */ res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/highlights', (/** @type {any} */ req, /** @type {any} */ res) => res.sendFile(path.join(__dirname, 'public', 'highlights.html')));

// LAN addresses so the TV can show a scannable URL even when opened via localhost.
function lanAddresses() {
  const out = [];
  const skip = /^(lo|docker|br-|veth|virbr|podman|cni|flannel|tun|tap|wg|tailscale)/i;
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

app.get('/api/info', (req, res) => {
  res.json({ publicUrl: PUBLIC_URL || null, lan: lanAddresses().map((ip) => `http://${ip}:${PORT}`) });
});

app.get('/qr.svg', async (req, res) => {
  const data = String(req.query.data || '').slice(0, 300);
  if (!/^https?:\/\//.test(data)) return res.status(400).end();
  try {
    const svg = await QRCode.toString(data, { type: 'svg', margin: 1, color: { dark: '#14121f', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'max-age=3600').send(svg);
  } catch (e) {
    res.status(500).end();
  }
});

// Optional: your own background music (mp3/ogg/m4a) in ./music replaces the chiptunes.
// music/<scenario>/*.mp3 (e.g. music/final, music/game/quiplash); files in music/ itself = "any".
const AUDIO_RE = /\.(mp3|ogg|m4a|wav|opus)$/i;
function musicCategories() {
  const out = {};
  const walk = (dir, rel, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && depth < 2) walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1);
      else if (e.isFile() && AUDIO_RE.test(e.name)) {
        const cat = rel || 'any';
        (out[cat] = out[cat] || []).push('/music/' + (rel ? rel.split('/').map(encodeURIComponent).join('/') + '/' : '') + encodeURIComponent(e.name));
      }
    }
  };
  walk(MUSIC_DIR, '', 0);
  return out;
}
app.get('/api/music', (req, res) => res.json(musicCategories()));
// Measured per-track info (tools/music-manifest.py): loudness gain + bitrate, keyed by URL.
app.get('/api/music-info', (req, res) => {
  /** @type {Record<string, {gain: number, kbps: number}>} */
  const out = {};
  try {
    const m = JSON.parse(fs.readFileSync(path.join(MUSIC_DIR, 'manifest.json'), 'utf8'));
    for (const [rel, v] of Object.entries(m)) out['/music/' + rel.split('/').map(encodeURIComponent).join('/')] = v;
  } catch (e) { /* no manifest: the TV measures tracks itself */ }
  res.json(out);
});
app.use('/music', express.static(MUSIC_DIR, { maxAge: '1d' }));
// --- /admin: house rules + content editor (local network, no auth by design) --------
app.use('/api/admin', express.json({ limit: '64kb' }));
const POOL_NAMES = fs.readdirSync(path.join(__dirname, 'games', 'data', 'pools')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
/** One-line summary of a pool item for the editor. @param {Record<string, any>} x */
const summarize = (x) => x.text || x.q || (x.category ? `${x.category}: ${(x.words || []).join(', ')}` : JSON.stringify(x));
/** Build a valid pool item from editor fields (or explain what's wrong). @param {string} pool @param {Record<string, any>} b
 * @returns {{ item?: Record<string, any>, error?: string }} */
function itemFromForm(pool, b) {
  const t = (/** @type {unknown} */ v, n = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '');
  const a = !!b.a;
  if (['punchline', 'majority', 'mostlikely', 'telephone', 'cah-white'].includes(pool)) {
    const text = t(b.text);
    return text ? { item: { text, a } } : { error: 'Write the prompt text.' };
  }
  if (pool === 'cah-black') {
    const text = t(b.text);
    return text.includes('____') || text.endsWith('?') ? { item: { text, pick: 1, a } } : { error: 'Prompt cards need a blank (____) or a question mark.' };
  }
  if (pool === 'trivia') {
    const q = t(b.q), correct = t(b.answer, 60), wrong = (Array.isArray(b.wrong) ? b.wrong : []).map((/** @type {unknown} */ w) => t(w, 60)).filter(Boolean);
    if (!q || !correct || wrong.length !== 3) return { error: 'Trivia needs a question, the right answer and 3 wrong answers.' };
    const choices = [...wrong, correct].sort(() => crypto.randomInt(3) - 1);
    return { item: { q, choices, correct: choices.indexOf(correct), cat: t(b.cat, 30) || 'House questions', a } };
  }
  if (pool === 'fibbage') {
    const q = t(b.q), answer = t(b.answer, 60);
    return q.includes('____') && answer ? { item: { q, answer, a } } : { error: 'Fib Finder needs a fact with a blank (____) and its real answer.' };
  }
  if (pool === 'closest') {
    const q = t(b.q), answer = Number(String(b.answer).replace(/,/g, ''));
    return q && Number.isFinite(answer) ? { item: { q, answer, unit: t(b.unit, 20), a } } : { error: 'Closest Guess needs a question and a number.' };
  }
  if (pool === 'imposter') {
    const words = [...new Set(String(b.words || '').split(',').map((w) => t(w, 30)).filter(Boolean))];
    return t(b.category) && words.length >= 4 ? { item: { category: t(b.category, 40), word: words[0], words, a } } : { error: 'Odd One Out needs a category and at least 4 comma-separated words.' };
  }
  return { error: 'Unknown pool.' };
}
app.get('/api/admin/rules', (/** @type {any} */ req, /** @type {any} */ res) => res.json({ rules: house.get(), games: GAME_LIST.map((m) => ({ id: m.id, name: m.name })), pools: POOL_NAMES }));
app.post('/api/admin/rules', (/** @type {any} */ req, /** @type {any} */ res) => res.json({ rules: house.update(req.body || {}) }));
app.get('/api/admin/content/:pool', (/** @type {any} */ req, /** @type {any} */ res) => {
  const pool = String(req.params.pool);
  if (!POOL_NAMES.includes(pool)) { res.status(404).json({ error: 'Unknown pool' }); return; }
  const q = String(req.query.q || '').toLowerCase();
  const all = library.load(pool).all.filter((/** @type {Record<string, any>} */ x) => !q || summarize(x).toLowerCase().includes(q));
  const page = Math.max(0, Number(req.query.page) || 0);
  res.json({
    total: all.length,
    items: all.slice(page * 50, page * 50 + 50).map((/** @type {Record<string, any>} */ x) => ({ id: x.id, text: summarize(x), a: !!x.a, custom: !!x.custom, disabled: house.isDisabled(pool, x.id), src: x.src || '' })),
  });
});
app.post('/api/admin/content/:pool', (/** @type {any} */ req, /** @type {any} */ res) => {
  const pool = String(req.params.pool);
  if (!POOL_NAMES.includes(pool)) { res.status(404).json({ error: 'Unknown pool' }); return; }
  const r = itemFromForm(pool, req.body || {});
  if (!r.item) { res.status(400).json({ error: r.error }); return; }
  res.json({ item: house.addCustom(pool, r.item) });
});
app.post('/api/admin/content/:pool/:id/disabled', (/** @type {any} */ req, /** @type {any} */ res) => {
  house.setDisabled(String(req.params.pool), String(req.params.id), !!(req.body && req.body.disabled));
  res.json({ ok: true });
});
app.delete('/api/admin/content/:pool/:id', (/** @type {any} */ req, /** @type {any} */ res) => {
  res.json({ ok: house.removeCustom(String(req.params.pool), String(req.params.id)) });
});

// Narrator: text → WAV with espeak-ng (installed in the container; fully offline).
const ttsCache = new Map();
app.get('/api/tts', (/** @type {any} */ req, /** @type {any} */ res) => {
  const text = String(req.query.text || '').replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '').trim().slice(0, 240);
  if (!text) { res.status(400).end(); return; }
  const cacheKey = (req.query.lang === 'fr' ? 'fr:' : 'en:') + text;
  if (ttsCache.has(cacheKey)) { res.type('audio/wav').send(ttsCache.get(cacheKey)); return; }
  /** @type {Buffer[]} */
  const chunks = [];
  // A cheery game-show voice: US English, male variant 3, a bit fast and high.
  const voice = req.query.lang === 'fr' ? 'fr+m3' : 'en-us+m3';
  const p = require('child_process').spawn('espeak-ng', ['-v', voice, '-s', '165', '-p', '60', '--stdout', text]);
  p.on('error', () => { if (!res.headersSent) res.status(501).json({ error: 'no narrator voice installed' }); });
  p.stdout.on('data', (/** @type {Buffer} */ d) => chunks.push(d));
  p.on('close', (/** @type {number} */ code) => {
    if (res.headersSent) return;
    if (code !== 0 || !chunks.length) { res.status(501).json({ error: 'narrator failed' }); return; }
    const wav = Buffer.concat(chunks);
    ttsCache.set(cacheKey, wav);
    if (ttsCache.size > 120) ttsCache.delete(ttsCache.keys().next().value);
    res.type('audio/wav').send(wav);
  });
});

// Highlights + hall of fame (tonight's room if ?room=CODE).
app.get('/api/highlights', (/** @type {any} */ req, /** @type {any} */ res) => { // express is untyped here
  const room = rooms.get(String(req.query.room || '').toUpperCase()) || null;
  res.json(stats.summary(room));
});
app.get('/api/content-stats', (req, res) => res.json(library.stats()));

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Rooms (in-memory, ephemeral)
// ---------------------------------------------------------------------------

const rooms = new Map(); // code -> room

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — easier to read off a TV
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += letters[crypto.randomInt(letters.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

const token = () => crypto.randomBytes(16).toString('hex');

function roomPhase(room) {
  return room.game ? room.game.phase : 'lobby';
}

function playersSummary(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    nickname: p.nickname,
    score: p.score,
    connected: p.connected,
    avatar: p.avatar,
    team: room.settings.teams ? p.team || null : null,
    look: p.look || null, // character-maker look (rendered on clients)
    bot: !!p.bot,
  }));
}

// --- teams -------------------------------------------------------------------
/** @param {Room} room */
function teamSizes(room) {
  const n = { red: 0, blue: 0 };
  for (const p of room.players.values()) if (p.team === 'red' || p.team === 'blue') n[p.team]++;
  return n;
}
/** Put a player on the smaller team (ties: red). @param {Room} room @param {Player} p */
function assignTeam(room, p) {
  const n = teamSizes(room);
  p.team = n.red <= n.blue ? 'red' : 'blue';
}
/** Re-deal everyone: snake draft by score so teams are balanced. @param {Room} room */
function balanceTeams(room) {
  const ps = [...room.players.values()].sort((a, b) => b.score - a.score || (crypto.randomInt(3) - 1));
  ps.forEach((p, i) => { p.team = [0, 3].includes(i % 4) ? 'red' : 'blue'; });
}
/** @param {Room} room */
function teamScores(room) {
  if (!room.settings.teams) return null;
  const s = { red: 0, blue: 0 };
  for (const p of room.players.values()) if (p.team === 'red' || p.team === 'blue') s[p.team] += p.score;
  return s;
}

// --- pace votes (hurry / ready / skip question) ------------------------------
function paceKey(game) {
  if (!game) return 'lobby';
  return [game.phase, game.round, game.matchIndex, game.revealIndex, game.skipSeq, game.subject].join('|');
}

function paceState(room) {
  const key = paceKey(room.game);
  if (room.pace.key !== key) room.pace = { key, ready: new Set(), hurry: new Set(), skipq: new Set() };
  const connected = [...room.players.values()].filter((p) => p.connected).length;
  return {
    allowed: flow.allowedVotes(room.game),
    need: Math.floor(connected / 2) + 1,
    counts: { ready: room.pace.ready.size, hurry: room.pace.hurry.size, skipq: room.pace.skipq.size },
  };
}

// Push a full state update to the host and to every player. The host gets the
// shared-screen view; each player gets a personalized view that never exposes
// other players' in-progress input.
function broadcast(room) {
  if (room.closed) return;
  recordStats(room);
  countNight(room);
  if (DEBUG) {
    const g = room.game;
    const key = g ? [g.phase, g.round, g.matchIndex, g.skipSeq].join('/') : 'lobby';
    if (key !== room.dbgKey) dlog(`[room ${room.code}] phase ${room.dbgKey || '-'} → ${key}${g && g.endsAt ? ` (timer ${Math.round((g.endsAt - Date.now()) / 100) / 10}s)` : ''}`);
    room.dbgKey = key;
  }
  const base = {
    code: room.code,
    phase: roomPhase(room),
    players: playersSummary(room),
    availableGames: GAME_LIST,
    settings: room.settings,
    hostConnected: !!(room.hostSocket && room.hostSocket.connected),
    maxPlayers: MAX_PLAYERS,
    pace: paceState(room),
    teamScores: teamScores(room),
    night: nightSummary(room),
  };
  if (room.hostSocket && room.hostSocket.connected) {
    room.hostSocket.emit('room:stateUpdate', {
      ...base,
      gameState: room.game ? room.game.hostGameState() : {},
      canSkip: !!(room.game && room.game.timerFn),
    });
  }
  for (const p of room.players.values()) {
    if (!p.connected || !p.socket.connected) continue;
    const view = room.game ? room.game.playerView(p.id) : { gameState: {}, you: {} };
    p.socket.emit('room:stateUpdate', {
      ...base,
      gameState: view.gameState,
      you: { playerId: p.id, nickname: p.nickname, paceVotes: ['ready', 'hurry', 'skipq'].filter((k) => room.pace[k].has(p.id)), ...view.you },
    });
  }
}

/** @param {Room} room @param {any} GameClass */
function startGame(room, GameClass) {
  if (room.game) room.game.destroy();
  for (const p of room.players.values()) p.score = 0;
  const game = new GameClass(room, () => broadcast(room));
  room.game = game;
  console.log(`[room ${room.code}] starting game: ${GameClass.meta.id}`);
  game.start();
}

// --- game night -------------------------------------------------------------
/** Between games: vote on 3 games not played yet tonight (or show the final table). @param {Room} room @param {boolean} final */
function nightVote(room, final) {
  const night = room.night;
  if (!night) return;
  const fits = GAME_LIST.filter((m) => room.players.size >= (m.minPlayers || 2));
  const fresh = fits.filter((m) => !night.played.includes(m.id));
  const pool = (fresh.length >= 3 ? fresh : fits).slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  if (room.game) room.game.destroy();
  for (const p of room.players.values()) p.score = 0;
  room.game = new NightGame(room, () => broadcast(room), {
    options: pool.slice(0, 3).map((m) => ({ id: m.id, name: m.name, minPlayers: m.minPlayers })),
    final,
    onPick: (/** @type {string} */ id) => { const G = /** @type {Record<string, any>} */ (GAMES)[id]; if (room.night && G) startGame(room, G); },
  });
  room.game.start();
}
/** A game of the night just ended: add placings, then queue the next vote (or the final table). @param {Room} room */
function countNight(room) {
  const night = room.night;
  const game = room.game;
  if (!night || !game || game instanceof NightGame || game.phase !== 'gameover' || game.nightCounted) return;
  game.nightCounted = true;
  const pts = placePoints([...room.players.values()].map((p) => ({ id: p.id, score: p.score })));
  for (const [id, n] of pts) night.points.set(id, (night.points.get(id) || 0) + n);
  night.played.push(/** @type {any} */ (game.constructor).meta.id);
  const final = night.played.length >= night.total;
  if (final) {
    const best = Math.max(0, ...night.points.values());
    for (const [id, n] of night.points) if (best > 0 && n === best) stats.nightWin(room, id);
  }
  night.nextAt = Date.now() + NIGHT_GAP_MS;
  night.timer = setTimeout(() => { night.timer = null; if (room.night === night) nightVote(room, final); }, NIGHT_GAP_MS);
}
/** Every finished game counts towards the all-time stats (once). @param {Room} room */
function recordStats(room) {
  const game = room.game;
  if (!game || game instanceof NightGame || game.phase !== 'gameover' || game.statsRecorded) return;
  game.statsRecorded = true;
  stats.recordGame(room, /** @type {any} */ (game.constructor).meta.id);
}

/** @param {Room} room */
function endNight(room) {
  if (room.night && room.night.timer) clearTimeout(room.night.timer);
  room.night = null;
}
/** @param {Room} room */
function nightSummary(room) {
  const night = room.night;
  if (!night) return null;
  return {
    total: night.total, played: night.played.length, nextAt: night.nextAt || null,
    standings: [...room.players.values()].map((p) => ({ nickname: p.nickname, points: night.points.get(p.id) || 0 }))
      .sort((a, b) => b.points - a.points),
  };
}

function closeRoom(room) {
  if (room.closed) return;
  room.closed = true;
  clearTimeout(room.closeTimer);
  endNight(room);
  if (room.game) room.game.destroy();
  room.game = null;
  for (const p of room.players.values()) {
    clearTimeout(p.dropTimer);
    if (p.socket.connected) {
      p.socket.emit('room:stateUpdate', { code: room.code, phase: 'closed', players: [], gameState: {} });
      p.socket.disconnect(true);
    }
  }
  rooms.delete(room.code);
  console.log(`[room ${room.code}] closed`);
}

// --- bots (test tool) ----------------------------------------------------------
const BOT_NAMES = ['Robo Rita', 'Beep Bob', 'Chip', 'Pixel Pat', 'Bolt', 'Sprocket', 'Widget', 'Gizmo', 'Byte', 'Cog', 'Servo', 'Tinker'];
/** A bot is a normal seat whose "socket" is a stub: it receives the same state a phone gets
 * and answers through the shared bot brain after a human-ish think time (÷ speed).
 * @param {Room} room @param {number} speed */
function addBot(room, speed) {
  const taken = new Set([...room.players.values()].map((x) => x.nickname.toLowerCase()));
  const nickname = BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) || `Bot ${room.players.size + 1}`;
  const used = new Set([...room.players.values()].map((x) => x.avatar));
  const free = [...Array(AVATAR_COUNT).keys()].filter((i) => !used.has(i));
  /** @type {Record<string, number>} */
  const look = {};
  for (const [k, count] of Object.entries(LOOK_PARTS)) look[k] = crypto.randomInt(count);
  /** @type {Player} */
  const p = {
    id: crypto.randomBytes(8).toString('hex'), token: token(), nickname, score: 0, connected: true,
    avatar: free.length ? free[crypto.randomInt(free.length)] : crypto.randomInt(AVATAR_COUNT), look, bot: true,
    socket: null,
  };
  p.socket = {
    connected: true, data: {},
    emit: (/** @type {string} */ ev) => { if (ev === 'room:stateUpdate') botTick(room, p, speed); },
    disconnect() { this.connected = false; },
  };
  if (room.settings.teams) assignTeam(room, p);
  room.players.set(p.id, p);
  console.log(`[room ${room.code}] bot joined: ${nickname}`);
}
/** @param {Room} room @param {Player} p @param {number} speed */
function botTick(room, p, speed) {
  if (p.botTimer || !room.game || !room.players.has(p.id)) return;
  const view = () => ({ phase: room.game.phase, ...room.game.playerView(p.id) });
  const first = botBrain.decide(view());
  if (!first) return;
  p.botTimer = setTimeout(() => {
    p.botTimer = null;
    if (!room.game || !room.players.has(p.id) || room.closed) return;
    const now = botBrain.decide(view()); // re-check: the screen may have moved on
    if (!now) return;
    try { room.game.handleSubmit(p.id, now.payload); } catch (e) { console.error(`[room ${room.code}] bot error:`, e); }
    // Some screens have a follow-up (bet after answering, likes, mashing): think again.
    setImmediate(() => botTick(room, p, speed));
  }, botBrain.thinkMs(first.kind) / speed);
}

function removePlayer(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return;
  clearTimeout(p.dropTimer);
  if (p.botTimer) clearTimeout(p.botTimer);
  room.players.delete(playerId);
  if (room.game) room.game.onPlayerLeft(playerId);
  console.log(`[room ${room.code}] player left: ${p.nickname}`);
  broadcast(room);
}

function attachHost(room, socket) {
  if (room.hostSocket && room.hostSocket !== socket && room.hostSocket.connected) {
    room.hostSocket.data.room = null; // old tab loses control quietly
    room.hostSocket.emit('host:replaced');
  }
  clearTimeout(room.closeTimer);
  room.closeTimer = null;
  room.hostSocket = socket;
  socket.data.role = 'host';
  socket.data.room = room;
  socket.emit('host:roomCreated', { code: room.code, hostToken: room.hostToken });
  broadcast(room);
}

function attachPlayer(room, p, socket) {
  if (p.socket && p.socket !== socket) {
    p.socket.data.room = null; // stale tab: ignore its disconnect
    if (p.socket.connected) p.socket.disconnect(true);
  }
  clearTimeout(p.dropTimer);
  p.dropTimer = null;
  p.socket = socket;
  p.connected = true;
  socket.data.role = 'player';
  socket.data.room = room;
  socket.data.playerId = p.id;
  socket.emit('player:joined', {
    playerId: p.id,
    token: p.token,
    nickname: p.nickname,
    roomState: { code: room.code, phase: roomPhase(room), players: playersSummary(room) },
  });
  broadcast(room);
}

function hostRoom(socket) {
  const room = socket.data.room;
  if (!room || socket.data.role !== 'host' || room.closed) return null;
  return room;
}

// ---------------------------------------------------------------------------
// Socket wiring
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  socket.on('debug:ping', (ack) => { if (typeof ack === 'function') ack(); });
  // Clock sync for rhythm games (phones timestamp taps in server time).
  socket.on('time:ping', (ack) => { if (typeof ack === 'function') ack(Date.now()); });
  if (DEBUG) {
    dlog('connect', socket.id);
    socket.onAny((ev, payload) => {
      if (ev === 'debug:ping' || ev === 'time:ping') return;
      let s = '';
      try { s = JSON.stringify(payload) ?? ''; } catch (e) { s = String(payload); }
      dlog('◀', socket.id.slice(0, 6), socket.data.role || '-', ev, s.length > 200 ? s.slice(0, 200) + '…' : s);
    });
    socket.on('disconnect', (r) => dlog('disconnect', socket.id, r));
  }
  socket.on('host:createRoom', () => {
    if (socket.data.room) return;
    const code = makeRoomCode();
    if (!code) return void socket.emit('host:roomCreated', { code: null });
    const room = {
      code,
      hostToken: token(),
      hostSocket: null,
      players: new Map(),
      game: null,
      closed: false,
      settings: { rounds: null, timerScale: 1, spicy: process.env.RUMPUS_SPICY_DEFAULT !== 'false', teams: false, lang: process.env.RUMPUS_LANG === 'fr' ? 'fr' : 'en' },
      pace: { key: null, ready: new Set(), hurry: new Set(), skipq: new Set() },
    };
    rooms.set(code, room);
    console.log(`[room ${code}] created`);
    attachHost(room, socket);
  });

  // TV refreshed or Wi-Fi blipped: take the room back.
  socket.on('host:resume', (msg) => {
    if (socket.data.room) return;
    const room = rooms.get(String((msg && msg.code) || '').toUpperCase());
    if (!room || room.closed || !msg.hostToken || msg.hostToken !== room.hostToken) {
      return void socket.emit('host:resumeFailed');
    }
    console.log(`[room ${room.code}] host resumed`);
    attachHost(room, socket);
  });

  socket.on('host:settings', (msg) => {
    const room = hostRoom(socket);
    if (!room || !msg) return;
    // Only touch the settings that were sent (the TV sends one at a time).
    if ('rounds' in msg) {
      const rounds = msg.rounds == null ? null : parseInt(msg.rounds, 10);
      if (rounds === null || (rounds >= 1 && rounds <= 20)) room.settings.rounds = rounds;
    }
    const scale = Number(msg.timerScale);
    if ([0.6, 1, 1.5, 2].includes(scale)) room.settings.timerScale = scale;
    if (typeof msg.spicy === 'boolean') room.settings.spicy = msg.spicy;
    if (msg.lang === 'en' || msg.lang === 'fr') room.settings.lang = msg.lang;
    if (typeof msg.teams === 'boolean' && msg.teams !== room.settings.teams) {
      const ph = roomPhase(room);
      if (ph === 'lobby' || ph === 'gameover') {
        room.settings.teams = msg.teams;
        if (msg.teams) balanceTeams(room);
      }
    }
    broadcast(room);
  });

  socket.on('host:startGame', (msg) => {
    const room = hostRoom(socket);
    if (!room) return;
    const phase = roomPhase(room);
    if (phase !== 'lobby' && phase !== 'gameover') return;
    const GameClass = GAMES[msg && msg.gameId];
    if (!GameClass) return;
    if (room.players.size < (GameClass.meta.minPlayers || 2)) return;
    if (room.night) endNight(room); // picking a game by hand ends a game night
    startGame(room, GameClass);
  });

  // Game night: a playlist of `count` games chosen by phone votes, with a running leaderboard.
  socket.on('host:startNight', (msg) => {
    const room = hostRoom(socket);
    if (!room) return;
    const phase = roomPhase(room);
    if ((phase !== 'lobby' && phase !== 'gameover') || room.players.size < 2) return;
    const total = Math.max(2, Math.min(10, Number(msg && msg.count) || 3));
    room.night = { total, played: [], points: new Map(), timer: null };
    console.log(`[room ${room.code}] game night: ${total} games`);
    nightVote(room, false);
  });

  socket.on('host:skip', () => {
    const room = hostRoom(socket);
    if (room && room.game && typeof room.game.skip === 'function') room.game.skip();
  });

  socket.on('host:endGame', () => {
    const room = hostRoom(socket);
    if (room && room.night) endNight(room);
    if (!room || !room.game) return;
    room.game.destroy();
    room.game = null;
    broadcast(room);
  });

  // Test tool: fill the room with bot players (TV lobby → "🤖 Add bots", or tools/bots.js).
  socket.on('host:addBots', (msg) => {
    const room = hostRoom(socket);
    if (!room || (roomPhase(room) !== 'lobby' && roomPhase(room) !== 'gameover')) return;
    const n = Math.max(1, Math.min(MAX_PLAYERS, Number(msg && msg.count) || 1));
    const speed = Math.max(1, Math.min(20, Number(msg && msg.speed) || 1));
    for (let i = 0; i < n && room.players.size < MAX_PLAYERS; i++) addBot(room, speed);
    broadcast(room);
  });
  socket.on('host:removeBots', () => {
    const room = hostRoom(socket);
    if (!room) return;
    for (const p of [...room.players.values()]) if (p.bot) removePlayer(room, p.id);
  });

  socket.on('host:kickPlayer', (msg) => {
    const room = hostRoom(socket);
    if (!room) return;
    const p = room.players.get(msg && msg.playerId);
    if (!p) return;
    const sock = p.socket;
    removePlayer(room, p.id);
    if (sock.connected) {
      sock.emit('player:kicked');
      sock.data.room = null;
      sock.disconnect(true);
    }
  });

  socket.on('player:joinRoom', (msg) => {
    if (socket.data.room) return;
    const code = (msg && typeof msg.code === 'string' ? msg.code : '').trim().toUpperCase();
    const nickname = (msg && typeof msg.nickname === 'string' ? msg.nickname : '').trim().replace(/\s+/g, ' ').slice(0, 16);
    const room = rooms.get(code);
    if (!room || room.closed) return void socket.emit('player:joinError', { reason: 'No room with that code.' });
    if (!nickname) return void socket.emit('player:joinError', { reason: 'Pick a nickname.' });
    const existing = [...room.players.values()].find((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (existing) {
      // Same name while that seat is offline = probably the same person on a
      // new browser/cleared storage. Let them reclaim it.
      if (!existing.connected) {
        console.log(`[room ${room.code}] ${nickname} reclaimed seat by name`);
        return void attachPlayer(room, existing, socket);
      }
      return void socket.emit('player:joinError', { reason: 'That nickname is taken.' });
    }
    if (roomPhase(room) !== 'lobby' && roomPhase(room) !== 'gameover') {
      return void socket.emit('player:joinError', { reason: 'Game in progress — join when this one ends.' });
    }
    if (room.players.size >= MAX_PLAYERS) {
      return void socket.emit('player:joinError', { reason: `Room is full (${MAX_PLAYERS} players max).` });
    }
    // Avatar: the one they asked for if free, otherwise the first unused one.
    const used = new Set([...room.players.values()].map((x) => x.avatar));
    let avatar = Number.isInteger(msg.avatar) && msg.avatar >= 0 && msg.avatar < AVATAR_COUNT ? msg.avatar : -1;
    if (avatar < 0 || used.has(avatar)) {
      const free = [...Array(AVATAR_COUNT).keys()].filter((i) => !used.has(i));
      avatar = free.length ? free[crypto.randomInt(free.length)] : crypto.randomInt(AVATAR_COUNT);
    }
    const p = { id: crypto.randomBytes(8).toString('hex'), token: token(), nickname, socket, score: 0, connected: true, avatar };
    const look = cleanLook(msg.look);
    if (look) p.look = look;
    if (room.settings.teams) assignTeam(room, p);
    room.players.set(p.id, p);
    console.log(`[room ${room.code}] player joined: ${nickname}`);
    attachPlayer(room, p, socket);
  });

  socket.on('player:rejoin', (msg) => {
    if (socket.data.room) return;
    const room = rooms.get(String((msg && msg.code) || '').toUpperCase());
    const p = room && !room.closed && [...room.players.values()].find((x) => x.token === msg.token);
    if (!p) return void socket.emit('player:rejoinFailed');
    console.log(`[room ${room.code}] player rejoined: ${p.nickname}`);
    attachPlayer(room, p, socket);
  });

  // Majority vote from phones: hurry / ready / skipq.
  socket.on('player:vote', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed || !room.game) return;
    const p = room.players.get(socket.data.playerId);
    const kind = msg && msg.kind;
    const pace = paceState(room);
    if (!p || !pace.allowed.includes(kind)) return;
    room.pace[kind].add(p.id);
    if (room.pace[kind].size >= pace.need) {
      room.pace[kind].clear();
      const game = room.game;
      const tellHost = (type) => room.hostSocket && room.hostSocket.connected && room.hostSocket.emit('room:event', { type });
      if (kind === 'ready') { tellHost('ready'); game.skip(); }
      else if (kind === 'hurry') { if (flow.hurry(game)) tellHost('hurry'); }
      else if (kind === 'skipq') {
        if (game.poolName && game.item && game.item.id) library.recordSkip(game.poolName, game.item.id); // retire it
        tellHost('skipped');
        game.skipQuestion();
      }
    }
    broadcast(room);
  });

  // Switch team (lobby / between games only).
  socket.on('player:team', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed || !room.settings.teams) return;
    const ph = roomPhase(room);
    if (ph !== 'lobby' && ph !== 'gameover') return;
    const p = room.players.get(socket.data.playerId);
    const team = msg && msg.team;
    if (!p || (team !== 'red' && team !== 'blue')) return;
    p.team = team;
    broadcast(room);
  });

  // Character maker: set/clear your look (null = back to the pixel animal).
  socket.on('player:look', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed) return;
    const p = room.players.get(socket.data.playerId);
    if (!p) return;
    if (msg && msg.look === null) p.look = null;
    else { const look = cleanLook(msg && msg.look); if (!look) return; p.look = look; }
    broadcast(room);
  });

  socket.on('player:avatar', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed) return;
    const p = room.players.get(socket.data.playerId);
    const a = msg && msg.avatar;
    if (!p || !Number.isInteger(a) || a < 0 || a >= AVATAR_COUNT) return;
    if ([...room.players.values()].some((x) => x !== p && x.avatar === a)) return;
    p.avatar = a;
    broadcast(room);
  });

  // Emoji reactions float up on the TV. Throttled per player.
  const REACTIONS = ['😂', '🔥', '💀', '👏', '😱', '🤮', '😍', '🍆', '🍑', '🍻', '🙄', '🤡'];
  socket.on('player:react', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed) return;
    const p = room.players.get(socket.data.playerId);
    const emoji = msg && msg.emoji;
    if (!p || !REACTIONS.includes(emoji)) return;
    const now = Date.now();
    if (p.lastReact && now - p.lastReact < 600) return;
    p.lastReact = now;
    if (room.hostSocket && room.hostSocket.connected) {
      room.hostSocket.emit('room:reaction', { playerId: p.id, nickname: p.nickname, avatar: p.avatar, look: p.look || null, emoji });
    }
  });

  socket.on('player:leave', () => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed) return;
    socket.data.room = null;
    removePlayer(room, socket.data.playerId);
  });

  socket.on('player:submit', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed || !room.game) return;
    if (!room.players.has(socket.data.playerId)) return;
    const payload = msg && typeof msg.payload === 'object' && msg.payload !== null ? msg.payload : {};
    try {
      room.game.handleSubmit(socket.data.playerId, payload);
    } catch (e) {
      console.error(`[room ${room.code}] game error:`, e);
    }
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room || room.closed) return;
    if (socket.data.role === 'host') {
      if (room.hostSocket !== socket) return;
      room.hostSocket = null;
      console.log(`[room ${room.code}] host disconnected — holding room ${HOST_GRACE_MS / 1000}s`);
      room.closeTimer = setTimeout(() => closeRoom(room), HOST_GRACE_MS);
      broadcast(room);
    } else if (socket.data.role === 'player') {
      const p = room.players.get(socket.data.playerId);
      if (!p || p.socket !== socket) return;
      p.connected = false;
      p.dropTimer = setTimeout(() => removePlayer(room, p.id), PLAYER_GRACE_MS);
      broadcast(room);
    }
  });
});

server.listen(PORT, () => {
  const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
  console.log(`Rumpus listening on port ${port}`);
  console.log('TV screen:  /host   Phones:  /play');
  for (const ip of lanAddresses()) console.log(`  LAN: http://${ip}:${port}/host`);
});

// Exit promptly on `docker stop` (node as PID 1 ignores SIGTERM by default).
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
