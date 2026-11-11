// Load: a full room of phones on real sockets, pushed harder than any real party.
// 1. Tap storm: 12 phones answer instantly, mash duplicate taps 20×/s each and send radio keep-warm
//    pings — every update still reaches every phone fast and every tap is acknowledged fast.
// 2. Real-time: Lantern Lake with 12 phones streaming tilt at 4× the real rate — the TV keeps
//    getting its 30 fps frames on time.
// 3. Reconnect storm: every phone drops at once mid-game and rejoins together — everyone has their
//    seat back quickly and the game finishes.
// The server reports its own event-loop delay (how late it handles anything) at /api/debug/perf.
// Budgets leave room for Raspberry Pi–class machines and a busy CI box; set LOAD_REPORT=1 to print numbers.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const helpers = require('../helpers');
const { until, makeHost, makePlayer, sleep, get } = helpers;
// LOAD_SERVER_URL: drive a server running elsewhere (e.g. a CPU-limited container) instead of a local one.
const startServer = process.env.LOAD_SERVER_URL ? remoteServer : helpers.startServer;
/** @param {Record<string, string>} _env (the remote server was started with its own) */
async function remoteServer(_env) {
  const { io } = require('socket.io-client');
  /** @type {any[]} */
  const clients = [];
  const url = String(process.env.LOAD_SERVER_URL);
  return { url, connect() { const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false }); clients.push(s); return s; }, async stop() { clients.forEach((c) => c.disconnect()); } };
}

const N = 12; // MAX_PLAYERS
// scripts/load-harsh.sh adds a bad-Wi-Fi link or a starved server: latency budgets grow by
// LOAD_SLACK_MS and the TV frame-rate floor drops to LOAD_MIN_FPS for those runs.
const SLACK = parseInt(process.env.LOAD_SLACK_MS || '0', 10);
const MIN_FPS = parseFloat(process.env.LOAD_MIN_FPS || '27');
/** @param {number[]} xs @param {number} q */
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
/** @param {any} srv @param {boolean} [reset] */
const perf = async (srv, reset) => JSON.parse((await get(srv.url, `/api/debug/perf${reset ? '?reset=1' : ''}`)).body);
/** @param {string} msg */
const report = (msg) => console.log(`# load: ${msg}`);

test('tap storm: 12 phones mashing — fan-out and tap acks stay fast, updates stay small', { timeout: 90000 }, async () => {
  const srv = await startServer({ RUMPUS_DEBUG: '1', RUMPUS_TRIVIA_ROUNDS: '8', RUMPUS_TRIVIA_QUESTION_MS: '1500', RUMPUS_TRIVIA_REVEAL_MS: '300' });
  /** @type {NodeJS.Timeout[]} */
  const timers = [];
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (let i = 0; i < N; i++) ps.push(await makePlayer(srv, h.code, `P${i}`));
    await until(() => h.state.players.length === N, '12 joined');
    /** @type {number[]} */ const lags = [];
    /** @type {number[]} */ const acks = [];
    /** @type {number[]} */ const sizes = [];
    const seen = new Map();
    const mark = (/** @type {string} */ k) => { if (!seen.has(k)) seen.set(k, Date.now()); return seen.get(k); };
    h.sock.on('room:stateUpdate', (s) => { mark(s.phase + '/' + (s.gameState && s.gameState.round)); });
    for (const p of ps) {
      const got = new Set();
      p.sock.on('room:stateUpdate', (s) => {
        sizes.push(JSON.stringify(s).length);
        const k = s.phase + '/' + (s.gameState && s.gameState.round);
        const t0 = mark(k);
        if (got.has(k)) return;
        got.add(k);
        lags.push(Date.now() - t0);
        if (s.phase === 'trivia-question' && !s.you.answered) {
          const t1 = Date.now();
          p.sock.emit('player:submit', { payload: { choice: 0 } }, () => acks.push(Date.now() - t1));
        }
        if (s.phase === 'trivia-category' && s.you.isChooser) p.submit({ choice: 0 });
      });
      // The mashing: duplicate taps (ignored by the game, still acked) and keep-warm pings.
      timers.push(setInterval(() => p.sock.emit('player:submit', { payload: { choice: 1 } }, () => {}), 50));
      timers.push(setInterval(() => p.sock.volatile.emit('k'), 200));
    }
    await perf(srv, true);
    h.emit('host:startGame', { gameId: 'trivia' });
    await h.phase('gameover', 60000);
    const pf = await perf(srv);
    const fan95 = pct(lags, 0.95), fan99 = pct(lags, 0.99), ack95 = pct(acks, 0.95), ack99 = pct(acks, 0.99);
    const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
    if (process.env.LOAD_REPORT) report(`tap storm — fan-out p95 ${fan95} / p99 ${fan99} ms, tap ack p95 ${ack95} / p99 ${ack99} ms, phone update avg ${avg} B, server loop p99 ${pf.loopP99} ms (max ${pf.loopMax}), RSS ${pf.rssMb} MB`);
    assert.ok(lags.length >= N * 8, `measured ${lags.length} deliveries`);
    assert.ok(acks.length >= N * 4, `measured ${acks.length} taps`);
    assert.ok(fan95 <= 100 + SLACK && fan99 <= 250 + SLACK, `fan-out p95 ${fan95} ms, p99 ${fan99} ms`);
    assert.ok(ack95 <= 60 + SLACK && ack99 <= 150 + SLACK, `tap round trip p95 ${ack95} ms, p99 ${ack99} ms`);
    assert.ok(avg <= 3000, `phone updates average ${avg} bytes (no game list on phones)`);
    assert.ok(pf.loopP99 <= 50 + SLACK, `server event loop p99 ${pf.loopP99} ms`);
    assert.ok(pf.rssMb < 200, `server RSS ${pf.rssMb} MB`);
  } finally { timers.forEach(clearInterval); await srv.stop(); }
});

test('real-time: Lantern Lake with 12 phones streaming tilt at 60/s — TV frames stay at 30 fps', { timeout: 90000 }, async () => {
  const srv = await startServer({ RUMPUS_DEBUG: '1', RUMPUS_LL_ORDER: 'tag', RUMPUS_LL_INTRO_MS: '300', RUMPUS_LL_PLAY_MS: '8000' });
  /** @type {NodeJS.Timeout[]} */
  const timers = [];
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (let i = 0; i < N; i++) ps.push(await makePlayer(srv, h.code, `P${i}`));
    await until(() => h.state.players.length === N, '12 joined');
    /** @type {number[]} */ const frames = [];
    h.sock.on('room:frame', () => frames.push(Date.now()));
    /** @type {number[]} */ const acks = [];
    for (const p of ps) {
      // Real phones send at most 15×/s (public/games.js llSend); this is 4× that, every one acked.
      timers.push(setInterval(() => {
        const t = Date.now();
        p.sock.emit('player:submit', { payload: { tilt: [Math.random() * 2 - 1, Math.random() * 2 - 1] } }, () => acks.push(Date.now() - t));
      }, 16));
    }
    h.emit('host:startGame', { gameId: 'lantern' });
    await h.phase('ll-play', 10000);
    await perf(srv, true);
    const from = frames.length;
    await sleep(6000);
    const pf = await perf(srv);
    const win = frames.slice(from);
    const fps = (win.length - 1) / ((win[win.length - 1] - win[0]) / 1000);
    const gaps = win.slice(1).map((t, i) => t - win[i]);
    const gap99 = pct(gaps, 0.99), ack95 = pct(acks, 0.95);
    if (process.env.LOAD_REPORT) report(`real-time — TV ${fps.toFixed(1)} fps, frame gap p99 ${gap99} ms (max ${Math.max(...gaps)}), tilt ack p95 ${ack95} ms over ${acks.length} tilts, server loop p99 ${pf.loopP99} ms`);
    assert.ok(fps >= MIN_FPS, `TV got ${fps.toFixed(1)} frames/s`);
    assert.ok(gap99 <= 70 + SLACK, `frame gap p99 ${gap99} ms`);
    assert.ok(ack95 <= 40 + SLACK, `tilt round trip p95 ${ack95} ms`);
    assert.ok(pf.loopP99 <= 50 + SLACK, `server event loop p99 ${pf.loopP99} ms`);
  } finally { timers.forEach(clearInterval); await srv.stop(); }
});

test('reconnect storm: all 12 phones drop at once mid-game and rejoin together', { timeout: 90000 }, async () => {
  const srv = await startServer({ RUMPUS_DEBUG: '1', RUMPUS_TRIVIA_ROUNDS: '4', RUMPUS_TRIVIA_QUESTION_MS: '2500', RUMPUS_TRIVIA_REVEAL_MS: '300' });
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (let i = 0; i < N; i++) ps.push(await makePlayer(srv, h.code, `P${i}`, { device: `dev-${i}-load-test` }));
    await until(() => h.state.players.length === N, '12 joined');
    for (const p of ps) p.sock.on('room:stateUpdate', (st) => { if (st.phase === 'trivia-category' && st.you.isChooser) p.submit({ choice: 0 }); });
    h.emit('host:startGame', { gameId: 'trivia' });
    await h.phase('trivia-question', 10000);
    // Everyone's Wi-Fi blinks at once.
    for (const p of ps) p.sock.disconnect();
    await until(() => h.state.players.every((x) => !x.connected), 'host sees everyone gone', 8000);
    const t0 = Date.now();
    /** @type {number[]} */ const back = [];
    const fresh = await Promise.all(ps.map((p) => new Promise((resolve) => {
      const s = srv.connect();
      s.on('connect', () => s.emit('player:rejoin', { code: h.code, token: p.token, device: `dev-${ps.indexOf(p)}-load-test` }));
      s.once('room:stateUpdate', (st) => { back.push(Date.now() - t0); resolve({ s, st }); });
    })));
    for (const [i, { st }] of fresh.entries()) assert.strictEqual(st.you.playerId, ps[i].id, 'same seat back');
    await until(() => h.state.players.every((x) => x.connected), 'host sees everyone back', 5000);
    // The game carries on to the end with the rejoined phones answering.
    for (const { s } of fresh) s.on('room:stateUpdate', (st) => { if (st.phase === 'trivia-question' && !st.you.answered) s.emit('player:submit', { payload: { choice: 0 } }); if (st.phase === 'trivia-category' && st.you.isChooser) s.emit('player:submit', { payload: { choice: 0 } }); });
    await h.phase('gameover', 60000);
    const pf = await perf(srv);
    const slowest = Math.max(...back);
    if (process.env.LOAD_REPORT) report(`reconnect storm — all 12 seats back in ${slowest} ms (p50 ${pct(back, 0.5)} ms), server loop max ${pf.loopMax} ms`);
    assert.strictEqual(new Set(h.state.players.map((x) => x.id)).size, N, 'no duplicate seats');
    assert.ok(slowest <= 1500 + SLACK * 5, `slowest rejoin ${slowest} ms`);
  } finally { await srv.stop(); }
});
