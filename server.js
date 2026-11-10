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
  'imposter', 'twotruths', 'telephone', 'cah',
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
app.use('/music', express.static(MUSIC_DIR, { maxAge: '1d' }));
// Players' hand-drawn profile pictures.
app.get('/avatar/:code/:id', (req, res) => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  const p = room && room.players.get(req.params.id);
  if (!p || !p.avatarImage) return res.status(404).end();
  const m = /^data:(image\/(?:png|jpeg));base64,(.*)$/.exec(p.avatarImage);
  res.type(m[1]).set('Cache-Control', 'max-age=86400').send(Buffer.from(m[2], 'base64'));
});
// Debug-only: full room dump (no tokens). Enable with RUMPUS_DEBUG=1.
app.get('/api/debug', (req, res) => {
  if (!DEBUG) return res.status(404).json({ error: 'start the server with RUMPUS_DEBUG=1' });
  const out = [...rooms.values()].map((r) => ({
    code: r.code, hostConnected: !!(r.hostSocket && r.hostSocket.connected), settings: r.settings,
    phase: roomPhase(r),
    pace: { key: r.pace.key, ready: r.pace.ready.size, hurry: r.pace.hurry.size, skipq: r.pace.skipq.size },
    players: [...r.players.values()].map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, connected: p.connected, avatar: p.avatar, drawn: p.avatarVer || 0 })),
    game: r.game && {
      id: r.game.constructor.meta.id, phase: r.game.phase, round: r.game.round, totalRounds: r.game.totalRounds,
      multiplier: typeof r.game.mult === 'function' ? r.game.mult() : 1, matchIndex: r.game.matchIndex,
      timerMsLeft: r.game.endsAt ? r.game.endsAt - Date.now() : null, hasTimer: !!r.game.timerFn, skipSeq: r.game.skipSeq || 0,
    },
  }));
  res.json({ uptimeSec: Math.round(process.uptime()), memoryMB: Math.round(process.memoryUsage().rss / 1048576), rooms: out, library: library.stats() });
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
    drawn: p.avatarVer || 0, // >0 = player drew their own picture (served at /avatar/:code/:id)
  }));
}

// --- pace votes (hurry / ready / skip question) ------------------------------
const MAX_DRAWING = 80 * 1024;
function validDrawing(s) {
  return typeof s === 'string' && s.length < MAX_DRAWING && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s);
}

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

function closeRoom(room) {
  if (room.closed) return;
  room.closed = true;
  clearTimeout(room.closeTimer);
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

function removePlayer(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return;
  clearTimeout(p.dropTimer);
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
  if (DEBUG) {
    dlog('connect', socket.id);
    socket.onAny((ev, payload) => {
      if (ev === 'debug:ping') return;
      let s = '';
      try { s = JSON.stringify(payload) ?? ''; } catch (e) { s = String(payload); }
      dlog('◀', socket.id.slice(0, 6), socket.data.role || '-', ev, s.length > 200 ? s.slice(0, 200) + '…' : s);
    });
    socket.on('disconnect', (r) => dlog('disconnect', socket.id, r));
  }
  socket.on('host:createRoom', () => {
    if (socket.data.room) return;
    const code = makeRoomCode();
    if (!code) return socket.emit('host:roomCreated', { code: null });
    const room = {
      code,
      hostToken: token(),
      hostSocket: null,
      players: new Map(),
      game: null,
      closed: false,
      settings: { rounds: null, timerScale: 1, spicy: process.env.RUMPUS_SPICY_DEFAULT !== 'false' },
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
      return socket.emit('host:resumeFailed');
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
    if (room.game) room.game.destroy();
    for (const p of room.players.values()) p.score = 0;
    room.game = new GameClass(room, () => broadcast(room));
    console.log(`[room ${room.code}] starting game: ${GameClass.meta.id}`);
    room.game.start();
  });

  socket.on('host:skip', () => {
    const room = hostRoom(socket);
    if (room && room.game && typeof room.game.skip === 'function') room.game.skip();
  });

  socket.on('host:endGame', () => {
    const room = hostRoom(socket);
    if (!room || !room.game) return;
    room.game.destroy();
    room.game = null;
    broadcast(room);
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
    if (!room || room.closed) return socket.emit('player:joinError', { reason: 'No room with that code.' });
    if (!nickname) return socket.emit('player:joinError', { reason: 'Pick a nickname.' });
    const existing = [...room.players.values()].find((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (existing) {
      // Same name while that seat is offline = probably the same person on a
      // new browser/cleared storage. Let them reclaim it.
      if (!existing.connected) {
        console.log(`[room ${room.code}] ${nickname} reclaimed seat by name`);
        return attachPlayer(room, existing, socket);
      }
      return socket.emit('player:joinError', { reason: 'That nickname is taken.' });
    }
    if (roomPhase(room) !== 'lobby' && roomPhase(room) !== 'gameover') {
      return socket.emit('player:joinError', { reason: 'Game in progress — join when this one ends.' });
    }
    if (room.players.size >= MAX_PLAYERS) {
      return socket.emit('player:joinError', { reason: `Room is full (${MAX_PLAYERS} players max).` });
    }
    // Avatar: the one they asked for if free, otherwise the first unused one.
    const used = new Set([...room.players.values()].map((x) => x.avatar));
    let avatar = Number.isInteger(msg.avatar) && msg.avatar >= 0 && msg.avatar < AVATAR_COUNT ? msg.avatar : -1;
    if (avatar < 0 || used.has(avatar)) {
      const free = [...Array(AVATAR_COUNT).keys()].filter((i) => !used.has(i));
      avatar = free.length ? free[crypto.randomInt(free.length)] : crypto.randomInt(AVATAR_COUNT);
    }
    const p = { id: crypto.randomBytes(8).toString('hex'), token: token(), nickname, socket, score: 0, connected: true, avatar };
    if (validDrawing(msg.drawing)) { p.avatarImage = msg.drawing; p.avatarVer = 1; }
    room.players.set(p.id, p);
    console.log(`[room ${room.code}] player joined: ${nickname}`);
    attachPlayer(room, p, socket);
  });

  socket.on('player:rejoin', (msg) => {
    if (socket.data.room) return;
    const room = rooms.get(String((msg && msg.code) || '').toUpperCase());
    const p = room && !room.closed && [...room.players.values()].find((x) => x.token === msg.token);
    if (!p) return socket.emit('player:rejoinFailed');
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
      else if (kind === 'skipq') { tellHost('skipped'); game.skipQuestion(); }
    }
    broadcast(room);
  });

  socket.on('player:drawAvatar', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed) return;
    const p = room.players.get(socket.data.playerId);
    if (!p) return;
    if (msg && msg.image === null) { p.avatarImage = null; p.avatarVer = 0; }
    else if (validDrawing(msg && msg.image)) { p.avatarImage = msg.image; p.avatarVer = (p.avatarVer || 0) + 1; }
    else return;
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
      room.hostSocket.emit('room:reaction', { playerId: p.id, nickname: p.nickname, avatar: p.avatar, drawn: p.avatarVer || 0, emoji });
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
