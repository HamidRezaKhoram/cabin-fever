/* Shared test helpers: boot a real server process, drive it with socket.io
 * clients, wait for states. AGPLv3 — see LICENSE. */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { until, once, sleep } = require('./kit/wait');
const { startApp } = require('./kit/process');

const ROOT = path.join(__dirname, '..');
const FAST = {
  RUMPUS_ANSWER_MS: '4000', RUMPUS_VOTE_MS: '4000', RUMPUS_RESULTS_MS: '300', RUMPUS_ROUNDS: '1',
  RUMPUS_TRIVIA_QUESTION_MS: '4000', RUMPUS_TRIVIA_REVEAL_MS: '300', RUMPUS_TRIVIA_ROUNDS: '1',
  RUMPUS_CAH_REVEAL_MS: '300', RUMPUS_CAH_ROUNDS: '1',
  RUMPUS_FIB_BLUFF_MS: '4000', RUMPUS_FIB_CHOOSE_MS: '4000', RUMPUS_FIB_REVEAL_MS: '300', RUMPUS_FIB_ROUNDS: '1',
  RUMPUS_REVEAL_MS: '300', RUMPUS_TEL_ENTRY_MS: '50', RUMPUS_TEL_FAV_MS: '1500', RUMPUS_TT_STEP_MS: '150',
};

function tmpDir(prefix = 'rumpus-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Start server.js in a child process. Resolves when it's listening. */
async function startServer(env = {}) {
  const app = await startApp(path.join(ROOT, 'server.js'), {
    cwd: ROOT,
    env: { ...FAST, PORT: '0', RUMPUS_DATA_DIR: tmpDir(), RUMPUS_CONTENT_DIR: '/nonexistent', RUMPUS_MUSIC_DIR: '/nonexistent', ...env },
  });
  const clients = [];
  const url = `http://127.0.0.1:${app.port}`;
  return {
    port: app.port, url, proc: app.proc, log: app.log,
    connect() { const s = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false }); clients.push(s); return s; },
    async stop() { clients.forEach((c) => c.disconnect()); await app.stop(); },
  };
}




/** Host client that tracks the latest state. */
async function makeHost(srv) {
  const sock = srv.connect();
  const h = { sock, state: null, reactions: [] };
  sock.on('room:stateUpdate', (s) => { h.state = s; });
  sock.on('room:reaction', (r) => h.reactions.push(r));
  sock.emit('host:createRoom');
  const msg = await once(sock, 'host:roomCreated');
  h.code = msg.code; h.hostToken = msg.hostToken;
  h.emit = (ev, data) => sock.emit(ev, data);
  h.phase = (p, ms) => until(() => h.state && h.state.phase === p && h.state, `host phase ${p} (at ${h.state && h.state.phase})`, ms);
  return h;
}

/** Player client that tracks the latest state. */
async function makePlayer(srv, code, nickname, extra = {}) {
  const sock = srv.connect();
  const p = { sock, nickname, state: null, events: [] };
  sock.on('room:stateUpdate', (s) => { p.state = s; });
  sock.onAny((ev) => p.events.push(ev));
  await once(sock, 'connect');
  sock.emit('player:joinRoom', { code, nickname, ...extra });
  const res = await Promise.race([once(sock, 'player:joined'), once(sock, 'player:joinError').then((e) => { throw new Error(e.reason); })]);
  p.id = res.playerId; p.token = res.token;
  p.submit = (payload) => sock.emit('player:submit', { payload });
  p.phase = (ph, ms) => until(() => p.state && p.state.phase === ph && p.state, `${nickname} phase ${ph} (at ${p.state && p.state.phase})`, ms);
  return p;
}

/** A room with a host and players, joined and (optionally) set up. `who` is a list of nicknames
 * or a count (P0, P1, …). Returns { h, ps, by: nickname → player, score(nickname) }. */
async function makeRoom(srv, who, settings) {
  const names = typeof who === 'number' ? Array.from({ length: who }, (_, i) => 'P' + i) : who;
  const h = await makeHost(srv);
  const ps = [];
  for (const n of names) ps.push(await makePlayer(srv, h.code, n));
  await until(() => h.state.players.length === names.length, 'all joined');
  if (settings) {
    h.emit('host:settings', settings);
    await until(() => Object.entries(settings).every(([k, v]) => h.state.settings[k] === v), 'settings');
  }
  const by = Object.fromEntries(ps.map((p) => [p.nickname, p]));
  const score = (n) => h.state.players.find((p) => p.nickname === n).score;
  return { h, ps, by, score };
}

/** Attempt a join and return the error reason (or null on success). */
async function joinError(srv, code, nickname, extra = {}) {
  const sock = srv.connect();
  await once(sock, 'connect');
  sock.emit('player:joinRoom', { code, nickname, ...extra });
  return Promise.race([once(sock, 'player:joined').then(() => null), once(sock, 'player:joinError').then((e) => e.reason)]);
}

function get(url, p) {
  return new Promise((resolve, reject) => {
    http.get(url + p, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

/** Write a custom content dir with the given pools (RUMPUS_CONTENT_MODE=replace). */
function contentDir(pools) {
  const dir = tmpDir('rumpus-content-');
  for (const [name, items] of Object.entries(pools)) fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(items));
  return dir;
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Short real-time timers so bots can finish every game quickly (bots + chaos tests). */
const QUICK = {
  RUMPUS_MG_INTRO_MS: '200', RUMPUS_MG_RESULT_MS: '200', RUMPUS_MG_TUG_MS: '1500', RUMPUS_MG_ROAST_MS: '3000',
  RUMPUS_MG_FLY_SHOW_MS: '300', RUMPUS_MG_FLY_GUESS_MS: '3000', RUMPUS_MG_DRAW_WINDOW: '1500',
  RUMPUS_TEL_FAV_MS: '3000', RUMPUS_TRIVIA_CATEGORY_MS: '2000', RUMPUS_CR_REVEAL_STEP_MS: '150',
  RUMPUS_LC_TEMPO: '4', RUMPUS_LC_PHRASES: '2', RUMPUS_LC_LEAD_MS: '300', RUMPUS_LC_RESULT_MS: '200',
  RUMPUS_ST_ROLES_MS: '2000', RUMPUS_ST_VOTE_SHOW_MS: '150', RUMPUS_ST_CARD_MS: '100', RUMPUS_ST_FINAL_MS: '200',
  RUMPUS_TT_STEP_MS: '60', RUMPUS_MG_PLAY_MS: '1500', RUMPUS_MG_SHOW_MS: '40',
  RUMPUS_LL_INTRO_MS: '300', RUMPUS_LL_PLAY_MS: '2500', RUMPUS_LL_RESULT_MS: '200',
};

module.exports = { QUICK, ROOT, startServer, once, until, sleep, makeHost, makePlayer, makeRoom, joinError, get, contentDir, tmpDir, PNG };
