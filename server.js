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

const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '12', 10);
// How long a dropped phone / TV keeps its seat before being removed.
const PLAYER_GRACE_MS = parseInt(process.env.PLAYER_GRACE_MS || '120000', 10);
const HOST_GRACE_MS = parseInt(process.env.HOST_GRACE_MS || '300000', 10);
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
app.get('/api/music', (req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|ogg|m4a|wav|opus)$/i.test(f)).sort();
  } catch (e) { /* no music dir */ }
  res.json(files.map((f) => '/music/' + encodeURIComponent(f)));
});
app.use('/music', express.static(MUSIC_DIR, { maxAge: '1d' }));
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
  }));
}

// Push a full state update to the host and to every player. The host gets the
// shared-screen view; each player gets a personalized view that never exposes
// other players' in-progress input.
function broadcast(room) {
  if (room.closed) return;
  const base = {
    code: room.code,
    phase: roomPhase(room),
    players: playersSummary(room),
    availableGames: GAME_LIST,
    settings: room.settings,
    hostConnected: !!(room.hostSocket && room.hostSocket.connected),
    maxPlayers: MAX_PLAYERS,
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
      you: { playerId: p.id, nickname: p.nickname, ...view.you },
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
    const rounds = msg.rounds == null ? null : parseInt(msg.rounds, 10);
    if (rounds === null || (rounds >= 1 && rounds <= 20)) room.settings.rounds = rounds;
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
      room.hostSocket.emit('room:reaction', { playerId: p.id, nickname: p.nickname, avatar: p.avatar, emoji });
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
  console.log(`Rumpus listening on port ${PORT}`);
  console.log('TV screen:  /host   Phones:  /play');
  for (const ip of lanAddresses()) console.log(`  LAN: http://${ip}:${server.address().port}/host`);
});

// Exit promptly on `docker stop` (node as PID 1 ignores SIGTERM by default).
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
