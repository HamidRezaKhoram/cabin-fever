/* Shared test helpers: boot a real server process, drive it with socket.io
 * clients, wait for states. AGPLv3 — see LICENSE. */
'use strict';

const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { io: ioClient } = require('socket.io-client');

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
function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    const proc = fork(path.join(ROOT, 'server.js'), [], {
      cwd: ROOT,
      env: {
        ...process.env, ...FAST, PORT: '0',
        RUMPUS_DATA_DIR: tmpDir(), RUMPUS_CONTENT_DIR: '/nonexistent', RUMPUS_MUSIC_DIR: '/nonexistent',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let out = '';
    const onData = (d) => {
      out += d;
      const m = /listening on port (\d+)/.exec(out);
      if (m) {
        proc.stdout.off('data', onData);
        const port = +m[1];
        const clients = [];
        resolve({
          port, url: `http://127.0.0.1:${port}`, proc, log: () => out,
          connect() { const s = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false }); clients.push(s); return s; },
          async stop() {
            clients.forEach((c) => c.disconnect());
            proc.kill('SIGTERM');
            await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)));
          },
        });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => { out += d; });
    proc.once('exit', (code) => reject(new Error(`server exited (${code}) before listening:\n${out}`)));
    setTimeout(() => reject(new Error('server did not start:\n' + out)), 15000).unref();
  });
}

function once(sock, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for '${event}'`)), ms);
    sock.once(event, (msg) => { clearTimeout(t); resolve(msg); });
  });
}

/** Wait until fn() returns truthy (polls). */
function until(fn, label = 'condition', ms = 8000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      let v;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return resolve(v);
      if (Date.now() - t0 > ms) return reject(new Error('timed out waiting for ' + label));
      setTimeout(poll, 20);
    })();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

module.exports = { ROOT, startServer, once, until, sleep, makeHost, makePlayer, joinError, get, contentDir, tmpDir, PNG };
