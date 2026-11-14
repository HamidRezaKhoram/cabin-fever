/*
 * Cabin Fever room server core: rooms, players, reconnect tokens, settings, bots, game night and
 * every socket event. Transport-agnostic: `connection(socket)` takes anything shaped like a
 * socket.io socket (id, data, emit, on, connected, disconnect). server.js feeds it socket.io
 * sockets; the GitHub Pages build runs this same file inside the TV's browser and feeds it
 * WebRTC data-channel sockets. AGPLv3 — see LICENSE.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const library = require('../games/library');
const flow = require('../games/flow');
const { cleanLook, LOOK_PARTS } = require('../games/avatar-schema');
const botBrain = require('../games/bot-brain');
const { NightGame, placePoints } = require('../games/night');
const stats = require('../games/stats');

const NIGHT_GAP_MS = parseInt(process.env.RUMPUS_NIGHT_GAP_MS || '12000', 10);
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '12', 10);
// How long a dropped phone / TV keeps its seat before being removed. Phones go to sleep in a
// pocket all the time, so a seat is held for half an hour (the TV can kick anyone sooner).
const PLAYER_GRACE_MS = parseInt(process.env.PLAYER_GRACE_MS || '1800000', 10);
// How long a room waits for its TV (asleep, lid closed, reloading) — as long as phones keep their seats.
const HOST_GRACE_MS = parseInt(process.env.HOST_GRACE_MS || '1800000', 10);
const DEBUG = process.env.RUMPUS_DEBUG === '1';
const dlog = (/** @type {unknown[]} */ ...a) => { if (DEBUG) console.log('[debug]', new Date().toISOString().slice(11, 23), ...a); };
const AVATAR_COUNT = 17; // must match public/sprites.js

// Order here = order on the TV's game picker. (Static requires so the browser build can bundle them.)
/** @type {Record<string, any>} game classes by id (BaseGame subclasses and two legacy games) */
const GAMES = Object.create(null); // no prototype: a game id like "constructor" finds nothing
for (const G of [
  require('../games/quiplash'), require('../games/fibbage'), require('../games/trivia'), require('../games/closest'),
  require('../games/majority'), require('../games/mostlikely'), require('../games/imposter'), require('../games/twotruths'),
  require('../games/telephone'), require('../games/minigames'), require('../games/looncall'), require('../games/lantern'),
  require('../games/storm'), require('../games/crush'), require('../games/cah'),
]) GAMES[G.meta.id] = G;
const GAME_LIST = Object.values(GAMES).map((G) => G.meta);

// ---------------------------------------------------------------------------
// Rooms (in-memory, ephemeral)
// ---------------------------------------------------------------------------

const rooms = new Map(); // code -> room

// --- rooms survive a restart ---------------------------------------------------------------
// The room itself (code, players and their seats, scores, settings, game-night standings) is saved
// as it changes and restored at start-up: a TV page reload (browser build — the server IS that
// page), or a container restart (Docker), keeps everyone's seat. Phones find the room again by
// themselves. The game in progress is not saved: the room comes back in the lobby and the TV says
// which game was interrupted. (Through `fs`: a file in Docker, localStorage in the browser build.)
const ROOMS_FILE = path.join(process.env.RUMPUS_DATA_DIR || path.join(__dirname, '..', 'data'), 'rooms.json');
// A second TV tab in the same browser must not adopt the first tab's live room (web/host-entry.js).
const SAVE_ROOMS = process.env.RUMPUS_ROOMS_SAVE !== '0' && !(/** @type {any} */ (globalThis).CF_SECOND_TAB);
/** A saved room older than this is forgotten (nobody is coming back to it). */
const ROOM_KEEP_MS = parseInt(process.env.RUMPUS_ROOM_KEEP_MS || '1800000', 10);
/** @type {ReturnType<typeof setTimeout> | null} */
let roomsTimer = null;
let roomsSaved = '';

/** @param {Room} room */
function snapshot(room) {
  const g = room.game;
  /** @type {unknown} */
  let saved = null;
  if (g && !(g instanceof NightGame) && g.phase !== 'gameover' && typeof (/** @type {any} */ (g)).save === 'function') {
    try { saved = /** @type {any} */ (g).save(); } catch (e) { saved = null; }
  }
  return {
    code: room.code, hostToken: room.hostToken, settings: room.settings, highlights: room.highlights || [],
    players: [...room.players.values()].filter((p) => !p.bot).map((p) => ({
      id: p.id, token: p.token, nickname: p.nickname, score: p.score, avatar: p.avatar, look: p.look || null, team: p.team || null, device: p.device || null, shy: !!p.shy,
    })),
    night: room.night ? { total: room.night.total, list: room.night.list, played: room.night.played, points: [...room.night.points], skipped: room.night.skipped || [], won: !!room.night.won } : null,
    // A game that can be picked up again (todo 2.1: trivia, Closest Cast so far) saves where it is.
    game: saved ? { id: /** @type {any} */ (g).constructor.meta.id, data: saved } : room.resumeGame || null,
    // A real game was on (not the lobby, a finished game or the game-night vote) and can't resume.
    interrupted: !saved && g && !(g instanceof NightGame) && g.phase !== 'gameover' ? /** @type {any} */ (g.constructor).meta.name : room.interrupted || null,
  };
}
/** @param {boolean} [force] write even if nothing changed (refreshes savedAt) */
function writeRooms(force = false) {
  roomsTimer = null;
  if (!SAVE_ROOMS) return;
  const list = [...rooms.values()].filter((r) => !r.closed).map(snapshot);
  const json = JSON.stringify(list);
  if (json === roomsSaved && !force) return;
  roomsSaved = json;
  try {
    fs.mkdirSync(path.dirname(ROOMS_FILE), { recursive: true });
    fs.writeFileSync(ROOMS_FILE + '.tmp', JSON.stringify({ savedAt: Date.now(), rooms: list }));
    fs.renameSync(ROOMS_FILE + '.tmp', ROOMS_FILE);
  } catch (e) { /* read-only data folder: rooms just won't survive a restart */ }
}
/** Save soon (many changes in a burst become one write). */
function saveRooms() {
  if (!SAVE_ROOMS || roomsTimer) return;
  roomsTimer = setTimeout(writeRooms, 400);
  if (roomsTimer.unref) roomsTimer.unref();
}
/** Shutting down: write now (with a fresh savedAt, so a long quiet lobby still comes back). */
function flushRooms() { if (roomsTimer) clearTimeout(roomsTimer); writeRooms(true); }
// A room in use but unchanged (a long dinner in the lobby) must not look abandoned: restoreRooms
// drops a save older than ROOM_KEEP_MS, so re-stamp it every few minutes while anyone is connected.
const KEEPALIVE_MS = parseInt(process.env.RUMPUS_ROOM_KEEPALIVE_MS || '300000', 10);
const keepalive = setInterval(() => {
  const inUse = [...rooms.values()].some((r) => !r.closed && ((r.hostSocket && r.hostSocket.connected) || [...r.players.values()].some((p) => p.connected && !p.bot)));
  if (inUse) writeRooms(true);
}, KEEPALIVE_MS);
if (keepalive.unref) keepalive.unref();

/** Bring saved rooms back: everyone is "away" until their phone (and the TV) reconnects. */
function restoreRooms() {
  if (!SAVE_ROOMS) return;
  /** @type {any} */
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')); } catch (e) { return; }
  if (!saved || !Array.isArray(saved.rooms) || Date.now() - Number(saved.savedAt) > ROOM_KEEP_MS) return;
  for (const s of saved.rooms) {
    if (!s || typeof s.code !== 'string' || !/^[A-Z]{4}$/.test(s.code) || typeof s.hostToken !== 'string' || rooms.has(s.code)) continue;
    /** @type {Room} */
    const room = {
      code: s.code, hostToken: s.hostToken, hostSocket: null, players: new Map(), game: null, closed: false,
      settings: { rounds: null, timerScale: 1, spicy: true, teams: false, lang: 'en', ...(s.settings || {}) },
      pace: { key: null, ready: new Set(), hurry: new Set(), skipq: new Set(), wrap: new Set() },
      highlights: Array.isArray(s.highlights) ? s.highlights : [],
      interrupted: typeof s.interrupted === 'string' ? s.interrupted : null,
      resumeGame: s.game && typeof s.game.id === 'string' && s.game.data ? s.game : null,
    };
    for (const sp of Array.isArray(s.players) ? s.players.slice(0, MAX_PLAYERS) : []) {
      if (!sp || typeof sp.id !== 'string' || typeof sp.token !== 'string' || typeof sp.nickname !== 'string') continue;
      /** @type {Player} */
      const p = {
        id: sp.id, token: sp.token, nickname: sp.nickname, score: Number(sp.score) || 0, connected: false,
        avatar: Number.isInteger(sp.avatar) ? sp.avatar : 0, device: cleanDevice(sp.device),
        // Nobody is connected yet: a stand-in socket until the phone is back.
        socket: /** @type {any} */ ({ connected: false, data: {}, emit() {}, disconnect() {} }),
      };
      const look = cleanLook(sp.look);
      if (look) p.look = look;
      if (sp.team === 'red' || sp.team === 'blue') p.team = sp.team;
      if (sp.shy === true) p.shy = true;
      p.dropTimer = setTimeout(() => removePlayer(room, p.id), PLAYER_GRACE_MS);
      if (p.dropTimer.unref) p.dropTimer.unref();
      room.players.set(p.id, p);
    }
    // A lineup comes back where it was — the final table too (played everything: the champion
    // stays on screen). `played` is the list's first N games, so both are filtered together: a game
    // id this version doesn't know drops out of both and the positions after it don't shift.
    if (s.night && Array.isArray(s.night.played) && Array.isArray(s.night.list) && s.night.played.length <= s.night.list.length) {
      const oldList = /** @type {unknown[]} */ (s.night.list);
      const oldSkipped = new Set(Array.isArray(s.night.skipped) ? s.night.skipped : []);
      /** @type {string[]} */ const list = [];
      /** @type {string[]} */ const played = [];
      /** @type {number[]} */ const skipped = [];
      oldList.forEach((id, i) => {
        if (typeof id !== 'string' || !/** @type {Record<string, any>} */ (GAMES)[id]) return;
        if (i < s.night.played.length) { if (oldSkipped.has(i)) skipped.push(list.length); played.push(id); }
        list.push(id);
      });
      if (list.length) {
        room.night = { total: list.length, list, played, skipped, won: s.night.won === true,
          points: new Map(Array.isArray(s.night.points) ? s.night.points : []), timer: null };
      }
    }
    room.closeTimer = setTimeout(() => closeRoom(room), HOST_GRACE_MS);
    if (room.closeTimer.unref) room.closeTimer.unref();
    rooms.set(room.code, room);
    console.log(`[room ${room.code}] restored (${room.players.size} seats kept${room.interrupted ? `, "${room.interrupted}" was interrupted` : ''})`);
  }
}

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
/** A phone's own id (made once and kept in its browser): the same phone always gets the same seat. @param {unknown} d */
const cleanDevice = (d) => (typeof d === 'string' && /^[\w-]{8,64}$/.test(d) ? d : null);
/** The seat this phone already has in the room, if any. @param {Room} room @param {string | null} device */
const seatOf = (room, device) => (device ? [...room.players.values()].find((p) => p.device === device) || null : null);

/** @param {Room} room */
function roomPhase(room) {
  return room.game ? room.game.phase : 'lobby';
}

/** @param {Room} room */
function playersSummary(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    nickname: p.nickname,
    score: p.score,
    connected: p.connected,
    avatar: p.avatar,
    team: room.settings.teams ? p.team || null : null,
    look: p.look || null, // character-maker look (rendered on clients)
    shy: !!p.shy, // left out of votes and notes about people (🙈 on the TV)
    bot: !!p.bot,
    // Browser build: how the phone reaches the TV ('relay' = through the internet, slower).
    ...(p.socket && p.socket.data && p.socket.data.net ? { net: p.socket.data.net } : {}),
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
/** @param {any} game */
function paceKey(game) {
  if (!game) return 'lobby';
  return [game.phase, game.round, game.matchIndex, game.revealIndex, game.skipSeq, game.subject].join('|');
}

/** @param {Room} room */
function paceState(room) {
  const key = paceKey(room.game);
  if (room.pace.key !== key) room.pace = { key, ready: new Set(), hurry: new Set(), skipq: new Set(), wrap: new Set() };
  const connected = [...room.players.values()].filter((p) => p.connected).length;
  return {
    allowed: flow.allowedVotes(room.game),
    need: Math.floor(connected / 2) + 1,
    counts: { ready: room.pace.ready.size, hurry: room.pace.hurry.size, skipq: room.pace.skipq.size, wrap: room.pace.wrap.size },
  };
}

// Push a full state update to the host and to every player. The host gets the
// shared-screen view; each player gets a personalized view that never exposes
// other players' in-progress input.
// Updates are coalesced: a burst of taps (8 phones answering at once) becomes one update per
// screen at most every BROADCAST_MS, and a screen whose view didn't change gets nothing. This
// keeps the TV smooth when it is also the server (browser build) and phones snappy.
const BROADCAST_MS = parseInt(process.env.RUMPUS_BROADCAST_MS || '30', 10);
/** @param {Room} room */
function broadcast(room) {
  if (room.closed || room.flushTimer) return;
  const wait = Math.max(0, (room.lastFlush || 0) + BROADCAST_MS - Date.now());
  room.flushTimer = setTimeout(() => { room.flushTimer = null; flush(room); }, wait);
}
/** Pictures (drawings) per update, at most about this much: a WebRTC message over ~256 KB fails, so a
 * phone that needs eight drawings at once gets them over a few updates (each one ≥ 1 picture). */
const IMAGE_BUDGET = 150 * 1024;
/**
 * Send a payload unless this socket already has exactly this view.
 * Pictures: a view names them by key (`gameState.images` = { key: data URL } for every picture it
 * shows, the view itself only says `cfimg:<key>`). Each socket gets each picture once — a phone or
 * TV that (re)attaches starts with none (attachPlayer / attachHost) — and keeps them by key
 * (public/games.js). Without this every vote resent every drawing to every screen (~1.7 MB a vote).
 * @param {any} sock @param {Record<string, any>} payload @returns {boolean} true if pictures are still to come
 */
function sendState(sock, payload) {
  const gs = payload.gameState;
  const all = gs && gs.images && typeof gs.images === 'object' ? /** @type {Record<string, string>} */ (gs.images) : null;
  /** @type {Record<string, string>} */
  const fresh = {};
  let more = false;
  if (all) {
    const data = sock.data || (sock.data = {});
    const have = data.images || (data.images = new Set());
    let size = 0;
    for (const [k, v] of Object.entries(all)) {
      if (have.has(k)) continue;
      if (size && size + v.length > IMAGE_BUDGET) { more = true; continue; }
      fresh[k] = v;
      size += v.length;
    }
    payload = { ...payload, gameState: { ...gs, images: fresh } };
  }
  const keys = Object.keys(fresh);
  // Compare the view without the picture data (the keys stand for it): cheap, and no big strings kept.
  const json = JSON.stringify(all ? { ...payload, gameState: { ...payload.gameState, images: keys } } : payload);
  if (sock.data && sock.data.lastState === json && !keys.length) return more;
  if (sock.data) sock.data.lastState = json;
  sock.emit('room:stateUpdate', payload);
  if (keys.length) for (const k of keys) sock.data.images.add(k);
  return more;
}
/** Between games (or once a game that takes newcomers is on): deal in the phones that queued.
 * @param {Room} room */
function admitQueue(room) {
  if (!room.queue || !room.queue.size) return;
  const phase = roomPhase(room);
  const meta = room.game ? /** @type {any} */ (room.game.constructor).meta : null;
  if (phase !== 'lobby' && phase !== 'gameover' && !(meta && meta.lateJoin)) return;
  const waiting = [...room.queue.values()];
  room.queue.clear();
  for (const q of waiting) {
    q.socket.data.queuedIn = null;
    if (q.socket.connected) q.join();
  }
}
/** @param {Room} room */
function flush(room) {
  if (room.closed) return;
  room.lastFlush = Date.now();
  recordStats(room);
  countNight(room);
  admitQueue(room);
  if (DEBUG) {
    const g = room.game;
    const key = g ? [g.phase, g.round, g.matchIndex, g.skipSeq].join('/') : 'lobby';
    if (key !== room.dbgKey) dlog(`[room ${room.code}] phase ${room.dbgKey || '-'} → ${key}${g && g.endsAt ? ` (timer ${Math.round((g.endsAt - Date.now()) / 100) / 10}s)` : ''}`);
    room.dbgKey = key;
  }
  const base = baseState(room);
  let more = false;
  // Phones first, then the TV: by the time the TV shows a change, every phone has been sent it.
  for (const p of room.players.values()) {
    if (!p.connected || !p.socket || !p.socket.connected) continue;
    if (p.bot) p.socket.emit('room:stateUpdate', null); // bots read the game directly
    else if (sendState(p.socket, playerPayload(room, p, base))) more = true;
  }
  if (room.hostSocket && room.hostSocket.connected && sendState(room.hostSocket, hostPayload(room, base))) more = true;
  if (more) broadcast(room); // the rest of the pictures in the next update
  saveRooms();
}

/** The part of the state every screen shares. @param {Room} room */
function baseState(room) {
  return {
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
}

/** What the TV gets. @param {Room} room @param {ReturnType<typeof baseState>} [base] */
function hostPayload(room, base = baseState(room)) {
  return { ...base, gameState: room.game ? room.game.hostGameState() : {}, canSkip: !!(room.game && room.game.timerFn),
    queued: room.queue ? [...room.queue.values()].map((q) => String(q.msg.nickname || '').trim().slice(0, 16)) : [] };
}

/** What one phone gets — only its own private view. @param {Room} room @param {Player} p @param {ReturnType<typeof baseState>} [base] */
function playerPayload(room, p, base = baseState(room)) {
  const view = room.game ? room.game.playerView(p.id) : { gameState: {}, you: {} };
  // Phones never show the game list (only the TV does): leaving it out halves every phone update.
  const { availableGames: _games, ...shared } = base;
  return {
    ...shared,
    gameState: view.gameState,
    you: { playerId: p.id, nickname: p.nickname, shy: !!p.shy, rated: !!(room.rated && room.rated.has(p.id)), paceVotes: /** @type {('ready' | 'hurry' | 'skipq' | 'wrap')[]} */ (['ready', 'hurry', 'skipq', 'wrap']).filter((k) => room.pace[k].has(p.id)), ...view.you },
  };
}

/** A game threw (timer, answer, skip, bot): log it and tell the TV, at most once every few seconds
 * (a real-time game's tick could throw 30 times a second), so the room isn't left waiting in
 * silence. The TV shows "Something went wrong — press Skip". @param {Room} room @param {string} what @param {unknown} e */
function glitch(room, what, e) {
  console.error(`[room ${room.code}] ${what} failed:`, e);
  const now = Date.now();
  if (room.lastGlitch && now - room.lastGlitch < GLITCH_GAP_MS) return;
  room.lastGlitch = now;
  if (room.hostSocket && room.hostSocket.connected) room.hostSocket.emit('room:event', { type: 'glitch' });
}
const GLITCH_GAP_MS = 5000;
/** Run game code for a room; a throw becomes a glitch instead of a silent log. @param {Room} room @param {string} what @param {() => void} fn */
function safely(room, what, fn) {
  try { fn(); } catch (e) { glitch(room, what, e); }
}
/** Hook a new game up to the room's glitch reporting. @param {Room} room @param {GameLike} game */
function watchGlitches(room, game) {
  // Reported for whichever game is on screen now: a game-night vote's timer that starts the next
  // game hands any error from that game's start() here.
  game.onGlitch = (what, e) => glitch(room, what, e);
}

/** A new game object hooked up to the room (frames, glitches), now on screen. @param {Room} room @param {any} GameClass */
function makeGame(room, GameClass) {
  const game = new GameClass(room, () => broadcast(room));
  // Real-time frames (positions at 30 Hz) go to the TV only and may be dropped when it's busy.
  game.frame = (/** @type {Record<string, any>} */ data) => { if (room.hostSocket && room.hostSocket.connected) room.hostSocket.volatile.emit('room:frame', data); };
  watchGlitches(room, game);
  room.game = game;
  return game;
}
/** @param {Room} room @param {any} GameClass */
function startGame(room, GameClass) {
  if (room.game) room.game.destroy();
  for (const p of room.players.values()) p.score = 0;
  room.rated = new Set();
  library.replayReset(); // RUMPUS_REPLAY=1: same seed → same questions (games/library.js)
  const game = makeGame(room, GameClass);
  console.log(`[room ${room.code}] starting game: ${GameClass.meta.id}`);
  safely(room, 'game start', () => game.start());
}

// --- the lineup -------------------------------------------------------------
/** Between games: the next game of the lineup ("NEXT GAME", then it starts), or the final table.
 * A game that needs more players than are here now is passed over. @param {Room} room */
function nightNext(room) {
  const night = room.night;
  if (!night) return;
  /** @type {any} */
  let next = null;
  while (night.played.length < night.list.length) {
    const id = night.list[night.played.length];
    const G = /** @type {Record<string, any>} */ (GAMES)[id];
    if (G && room.players.size >= (G.meta.minPlayers || 2)) { next = G.meta; break; }
    skipNight(night); // can't be played with who's here: skipped
  }
  const final = !next;
  if (final && night.played.length && !night.won) {
    night.won = true; // once: a TV reload on the final table shows it again without a second win
    const best = Math.max(0, ...night.points.values());
    for (const [id, n] of night.points) if (best > 0 && n === best) stats.nightWin(room, id);
  }
  if (room.game) room.game.destroy();
  for (const p of room.players.values()) p.score = 0;
  room.game = new NightGame(room, () => broadcast(room), {
    next: next ? { id: next.id, name: next.name, minPlayers: next.minPlayers } : null,
    final,
    onPick: (/** @type {string} */ id) => {
      const G = /** @type {Record<string, any>} */ (GAMES)[id];
      if (!room.night || room.night !== night || !G) return;
      // Someone left during "NEXT GAME": too few now → pass it over instead of starting a broken game.
      if (room.players.size < (G.meta.minPlayers || 2)) { skipNight(night); nightNext(room); return; }
      startGame(room, G);
    },
  });
  watchGlitches(room, room.game);
  const between = room.game;
  safely(room, 'lineup next', () => between.start());
}
/** The lineup's next game is passed over (too few players): it counts as gone by, not as played.
 * @param {NonNullable<Room['night']>} night */
function skipNight(night) {
  if (!night.skipped) night.skipped = [];
  night.skipped.push(night.played.length);
  night.played.push(night.list[night.played.length]);
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
  // The scores stay up for a while, then the next cartridge (or the final table).
  night.nextAt = Date.now() + NIGHT_GAP_MS;
  night.timer = setTimeout(() => { night.timer = null; if (room.night === night) nightNext(room); }, NIGHT_GAP_MS);
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
  const meta = (/** @type {string} */ id) => { const G = /** @type {Record<string, any>} */ (GAMES)[id]; return { id, name: G ? G.meta.name : id }; };
  return {
    total: night.total, played: night.played.length, nextAt: night.nextAt || null,
    // The lineup in order (the TV draws it as a row of cartridges: done, skipped, now, still to come).
    list: night.list.map((id, i) => ({ ...meta(id), skipped: !!(night.skipped && night.skipped.includes(i)) })),
    standings: [...room.players.values()].map((p) => ({ nickname: p.nickname, points: night.points.get(p.id) || 0 }))
      .sort((a, b) => b.points - a.points),
  };
}

/** @param {Room} room */
function closeRoom(room) {
  if (room.closed) return;
  room.closed = true;
  if (room.closeTimer) clearTimeout(room.closeTimer);
  if (room.flushTimer) clearTimeout(room.flushTimer);
  endNight(room);
  if (room.game) room.game.destroy();
  room.game = null;
  for (const p of room.players.values()) {
    if (p.dropTimer) clearTimeout(p.dropTimer);
    if (p.botTimer) clearTimeout(p.botTimer);
    if (p.socket && p.socket.connected) {
      p.socket.emit('room:stateUpdate', { code: room.code, phase: 'closed', players: [], gameState: {} });
      p.socket.disconnect(true);
    }
  }
  rooms.delete(room.code);
  saveRooms();
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
  const view = () => (room.game ? { phase: room.game.phase, ...room.game.playerView(p.id) } : { phase: 'lobby' });
  const first = botBrain.decide(view());
  if (!first) return;
  p.botTimer = setTimeout(() => {
    p.botTimer = null;
    if (!room.game || !room.players.has(p.id) || room.closed) return;
    const now = botBrain.decide(view()); // re-check: the screen may have moved on
    if (!now) return;
    const g = room.game; safely(room, 'bot answer', () => g.handleSubmit(p.id, now.payload));
    // Some screens have a follow-up (bet after answering, likes, mashing): think again.
    setTimeout(() => botTick(room, p, speed), 0); // (no setImmediate in the browser build)
  }, botBrain.thinkMs(first.kind) / speed);
}

/** @param {Room} room @param {string} playerId */
function removePlayer(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return;
  if (p.dropTimer) clearTimeout(p.dropTimer);
  if (p.botTimer) clearTimeout(p.botTimer);
  room.players.delete(playerId);
  if (room.game && !room.players.size) {
    // Everyone left (or was kicked): games assume someone is playing, so stop it — back to the lobby.
    endNight(room);
    room.game.destroy();
    room.game = null;
  } else if (room.game) { const g = room.game; safely(room, 'player left', () => g.onPlayerLeft(playerId)); }
  console.log(`[room ${room.code}] player left: ${p.nickname}`);
  broadcast(room);
}

/** @param {Room} room @param {import('socket.io').Socket} socket */
function attachHost(room, socket) {
  if (room.hostSocket && room.hostSocket !== socket && room.hostSocket.connected) {
    room.hostSocket.data.room = null; // old tab loses control quietly
    room.hostSocket.emit('host:replaced');
  }
  if (room.closeTimer) clearTimeout(room.closeTimer);
  room.closeTimer = null;
  room.hostSocket = socket;
  socket.data.role = 'host';
  socket.data.room = room;
  socket.emit('host:roomCreated', { code: room.code, hostToken: room.hostToken });
  // Back after a restart: a saved game picks up where it was (the TV is told); otherwise say what was
  // lost, and pick a game night up where it stopped.
  if (room.resumeGame && !room.game) {
    const r = room.resumeGame;
    room.resumeGame = null;
    const G = /** @type {Record<string, any>} */ (GAMES)[r.id];
    if (G && typeof G.prototype.resume === 'function') {
      const game = makeGame(room, G);
      safely(room, 'game resume', () => game.resume(r.data));
      socket.emit('room:event', { type: 'resumed', game: G.meta.name });
    } else if (G) room.interrupted = G.meta.name;
  }
  if (room.interrupted) {
    socket.emit('room:event', { type: 'interrupted', game: room.interrupted });
    room.interrupted = null;
  }
  // A lineup with nothing on screen (restored after a restart — the scores gap, "NEXT GAME" or the
  // final table): pick it up where it stopped.
  if (room.night && !room.game) nightNext(room);
  socket.data.lastState = null;
  socket.data.images = null;
  broadcast(room);
}

/** @param {Room} room @param {Player} p @param {import('socket.io').Socket} socket */
function attachPlayer(room, p, socket) {
  if (p.socket && p.socket !== socket) {
    p.socket.data.room = null; // stale tab: ignore its disconnect and anything it sends
    // The other tab/window is told and stops by itself (closing it from here could race the message).
    if (p.socket.connected) p.socket.emit('player:replaced');
  }
  if (p.dropTimer) clearTimeout(p.dropTimer);
  p.dropTimer = null;
  p.socket = socket;
  socket.data.lastState = null; // it may have missed updates: send the full view again
  socket.data.images = null; // …and every picture it needs
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

/** @param {import('socket.io').Socket} socket */
function hostRoom(socket) {
  const room = socket.data.room;
  if (!room || socket.data.role !== 'host' || room.closed) return null;
  return room;
}

// ---------------------------------------------------------------------------
// Socket wiring
// ---------------------------------------------------------------------------

/** Wire one socket (socket.io in Docker; in the browser build a WebRTC/BroadcastChannel socket with the same shape). @param {import('socket.io').Socket} socket */
function connection(socket) {
  // Every handler is guarded: one malformed message or game bug is logged, never fatal (a throw in
  // a socket.io listener would otherwise crash the whole server and every room on it).
  const on = socket.on.bind(socket);
  /** @type {any} */ (socket).on = (/** @type {string} */ ev, /** @type {(...a: any[]) => void} */ fn) => on(ev, (/** @type {any[]} */ ...a) => {
    try { fn(...a); } catch (e) { console.error(`[socket] ${ev} failed:`, e); }
  });
  socket.on('debug:ping', (ack) => { if (typeof ack === 'function') ack(); });
  socket.on('k', () => {}); // phones' radio keep-warm (public/play.js): nothing to do
  // Clock sync for rhythm games (phones timestamp taps in server time).
  socket.on('time:ping', (ack) => { if (typeof ack === 'function') ack(Date.now()); });
  if (DEBUG) {
    dlog('connect', socket.id);
    socket.onAny((ev, payload) => {
      if (ev === 'debug:ping' || ev === 'time:ping' || ev === 'k') return;
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
    /** @type {Room} */
    const room = {
      code,
      hostToken: token(),
      hostSocket: null,
      players: new Map(),
      game: null,
      closed: false,
      settings: { rounds: null, timerScale: 1, spicy: process.env.RUMPUS_SPICY_DEFAULT !== 'false', teams: false, lang: process.env.RUMPUS_LANG === 'fr' ? 'fr' : 'en' },
      pace: { key: null, ready: new Set(), hurry: new Set(), skipq: new Set(), wrap: new Set() },
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
    if (!room || !msg || typeof msg !== 'object') return;
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

  // The lineup: games the host picked, in their order, back to back, with a running leaderboard.
  socket.on('host:startNight', (msg) => {
    const room = hostRoom(socket);
    if (!room) return;
    const phase = roomPhase(room);
    if (phase !== 'lobby' && phase !== 'gameover') return;
    const list = (Array.isArray(msg && msg.games) ? msg.games : []).filter((/** @type {unknown} */ id) => typeof id === 'string' && /** @type {Record<string, any>} */ (GAMES)[id]).slice(0, 15);
    if (!list.length) return;
    // Nobody (or one player) here: it would go straight to an empty final table.
    const fits = list.some((/** @type {string} */ id) => room.players.size >= (/** @type {Record<string, any>} */ (GAMES)[id].meta.minPlayers || 2));
    if (room.players.size < 2 || !fits) return;
    room.night = { total: list.length, list, played: [], skipped: [], points: new Map(), timer: null };
    console.log(`[room ${room.code}] lineup: ${list.join(', ')}`);
    nightNext(room);
  });

  socket.on('host:skip', () => {
    const room = hostRoom(socket);
    const game = room && room.game;
    if (room && game && typeof game.skip === 'function') safely(room, 'skip', () => game.skip());
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
    if (sock && sock.connected) {
      sock.emit('player:kicked');
      sock.data.room = null;
      // A moment before closing, so the message gets out first (the browser build's WebRTC link
      // drops anything still queued when it closes).
      setTimeout(() => { if (sock.connected) sock.disconnect(true); }, 300);
    }
  });

  socket.on('player:joinRoom', (msg) => joinRoom(socket, msg));
  /** @param {any} socket @param {any} msg */
  function joinRoom(socket, msg) {
    if (socket.data.room) return;
    const code = (msg && typeof msg.code === 'string' ? msg.code : '').trim().toUpperCase();
    const nickname = (msg && typeof msg.nickname === 'string' ? msg.nickname : '').trim().replace(/\s+/g, ' ').slice(0, 16);
    const room = rooms.get(code);
    if (!room || room.closed) return void socket.emit('player:joinError', { reason: 'No room with that code.' });
    const device = cleanDevice(msg && msg.device);
    const mine = seatOf(room, device);
    if (mine) {
      // This phone already has a seat (new tab, cleared seat, rejoining after a nap): it's still theirs.
      console.log(`[room ${room.code}] ${mine.nickname} is back (same phone)`);
      return void attachPlayer(room, mine, socket);
    }
    if (!nickname) return void socket.emit('player:joinError', { reason: 'Pick a nickname.' });
    const existing = [...room.players.values()].find((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (existing) {
      // Same name while that seat is offline = probably the same person on a
      // new browser/cleared storage. Let them reclaim it. (While it's online they must say so:
      // "That's me" on the phone — a private window or another browser has no saved seat.)
      if (!existing.connected || (msg.takeover === true && !existing.bot)) {
        console.log(`[room ${room.code}] ${nickname} reclaimed seat by name`);
        if (device) existing.device = device;
        return void attachPlayer(room, existing, socket);
      }
      return void socket.emit('player:joinError', { reason: 'That nickname is taken.', taken: !existing.bot });
    }
    // Mid-game joins (todo 3.4): only games where a newcomer can act on any screen (trivia-style,
    // the game-night vote) take them; role/turn games say when to come back.
    const between = roomPhase(room) === 'lobby' || roomPhase(room) === 'gameover';
    const meta = room.game ? /** @type {any} */ (room.game.constructor).meta : null;
    if (!between && !(meta && meta.lateJoin)) {
      // A role/turn game can't take a newcomer mid-round: queue them; they're dealt in when it ends.
      if (room.players.size + (room.queue ? room.queue.size : 0) >= MAX_PLAYERS) return void socket.emit('player:joinError', { reason: `Room is full (${MAX_PLAYERS} players max).` });
      if (room.queue && [...room.queue.values()].some((q) => q.socket !== socket && String(q.msg.nickname || '').trim().toLowerCase() === nickname.toLowerCase())) {
        return void socket.emit('player:joinError', { reason: 'That nickname is taken.' });
      }
      if (!room.queue) room.queue = new Map();
      room.queue.set(socket.id, { socket, msg, join: () => joinRoom(socket, msg) });
      socket.data.queuedIn = room;
      socket.emit('player:queued', { nickname, game: meta ? meta.name : 'A game' });
      return void broadcast(room);
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
    /** @type {Player} */
    const p = { id: crypto.randomBytes(8).toString('hex'), token: token(), nickname, socket, score: 0, connected: true, avatar, device };
    const look = cleanLook(msg.look);
    if (look) p.look = look;
    if (room.settings.teams) assignTeam(room, p);
    room.players.set(p.id, p);
    console.log(`[room ${room.code}] player joined: ${nickname}`);
    attachPlayer(room, p, socket);
  }

  socket.on('player:rejoin', (msg) => {
    const room = rooms.get(String((msg && msg.code) || '').toUpperCase());
    // A socket already in a room may only re-take its own seat (its link dropped and came back).
    if (socket.data.room && (socket.data.room !== room || socket.data.role !== 'player')) return;
    const p = room && !room.closed && ([...room.players.values()].find((x) => x.token === (msg && msg.token)) || seatOf(room, cleanDevice(msg && msg.device)));
    if (!p) return void socket.emit('player:rejoinFailed');
    const device = cleanDevice(msg && msg.device);
    if (device && !p.device) p.device = device;
    console.log(`[room ${room.code}] player rejoined: ${p.nickname}`);
    attachPlayer(room, p, socket);
  });

  // Majority vote from phones: hurry / wrap / ready / skipq (games/flow.js says which fit right now).
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
      const tellHost = (/** @type {string} */ type) => room.hostSocket && room.hostSocket.connected && room.hostSocket.emit('room:event', { type });
      if (kind === 'ready') { tellHost('ready'); safely(room, 'skip', () => game.skip()); }
      else if (kind === 'hurry') safely(room, 'hurry', () => { if (flow.hurry(game)) tellHost('hurry'); });
      else if (kind === 'wrap') { tellHost('wrap'); safely(room, 'skip', () => game.skip()); }
      else if (kind === 'skipq') {
        if (game.poolName && game.item && game.item.id) library.recordSkip(game.poolName, game.item.id); // retire it
        tellHost('skipped');
        safely(room, 'skip question', () => { if (game.skipQuestion) game.skipQuestion(); });
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

  // 🙈 "Leave me out": the player can't be the answer in votes about people or get Crush notes/dates.
  socket.on('player:prefs', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed) return;
    const p = room.players.get(socket.data.playerId);
    if (!p || !msg || typeof msg.shy !== 'boolean') return;
    p.shy = msg.shy;
    broadcast(room); // (saves the room too)
  });

  // 😴 / 🙂 / 🤩 after a game: one tap per phone per game, kept in the house stats (/highlights).
  socket.on('player:rate', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed || roomPhase(room) !== 'gameover' || !room.game) return;
    const id = /** @type {any} */ (room.game.constructor).meta && /** @type {any} */ (room.game.constructor).meta.id;
    const pid = /** @type {string} */ (socket.data.playerId);
    room.rated = room.rated || new Set();
    if (!id || room.rated.has(pid) || !msg || ![1, 2, 3].includes(msg.score)) return;
    room.rated.add(pid);
    stats.rate(String(id), msg.score);
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

  // A phone's answer/tap. The ack tells the phone it arrived (it shows "Sending…" until then).
  socket.on('player:submit', (msg, ack) => {
    const done = (/** @type {boolean} */ ok) => { if (typeof ack === 'function') ack({ ok }); };
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed || !room.game) return void done(false);
    if (!room.players.has(socket.data.playerId)) return void done(false);
    const payload = msg && typeof msg.payload === 'object' && msg.payload !== null ? msg.payload : {};
    const game = room.game;
    // A game says `false` when it turned the answer down (empty, a duplicate, the wrong prompt): the
    // phone gets its form back instead of a "✓ Sent" for something that was never counted.
    let taken = true;
    safely(room, 'answer', () => { if (game.handleSubmit(socket.data.playerId, payload) === false) taken = false; });
    if (typeof ack === 'function') ack(taken ? { ok: true } : { ok: false, rejected: true });
  });

  socket.on('disconnect', () => {
    const queued = socket.data.queuedIn;
    if (queued && queued.queue) { queued.queue.delete(socket.id); broadcast(queued); }
    const room = socket.data.room;
    if (!room || room.closed) return;
    if (socket.data.role === 'host') {
      if (room.hostSocket !== socket) return;
      room.hostSocket = null;
      console.log(`[room ${room.code}] host disconnected — holding room ${HOST_GRACE_MS / 1000}s`);
      if (room.closeTimer) clearTimeout(room.closeTimer); // a second disconnect must not orphan the first timer
      room.closeTimer = setTimeout(() => closeRoom(room), HOST_GRACE_MS);
      broadcast(room);
    } else if (socket.data.role === 'player') {
      const p = room.players.get(socket.data.playerId);
      if (!p || p.socket !== socket) return;
      p.connected = false;
      // The browser build can report one link down twice (stale, revived, down again): an orphaned
      // first timer would remove this player 30 min later, mid-game.
      if (p.dropTimer) clearTimeout(p.dropTimer);
      p.dropTimer = setTimeout(() => removePlayer(room, p.id), PLAYER_GRACE_MS);
      broadcast(room);
    }
  });
}

restoreRooms();

module.exports = { connection, rooms, hostPayload, playerPayload, flushRooms, GAME_LIST, GAMES, DEBUG };
