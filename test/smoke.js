/*
 * Smoke test against a running server (e.g. the Docker container): a TV makes a room, two phones
 * join, a trivia game starts and a phone answers. Run in the node container or CI:
 *   SMOKE_URL=http://localhost:8012 node test/smoke.js
 * AGPLv3 — see LICENSE.
 */
'use strict';
const { io: ioClient } = require('socket.io-client');
const { makeHost, makePlayer } = require('./helpers');
const { until } = require('./kit/wait');

const URL = process.env.SMOKE_URL || 'http://localhost:8012';
/** @type {any[]} */ const sockets = [];
const srv = { connect() { const s = ioClient(URL, { transports: ['websocket'], forceNew: true, reconnection: false }); sockets.push(s); return s; } };

(async () => {
  const h = await makeHost(srv);
  const a = await makePlayer(srv, h.code, 'Smoke A');
  await makePlayer(srv, h.code, 'Smoke B');
  await until(() => h.state && h.state.players.length === 2, 'two phones in the lobby', 10000);
  h.emit('host:startGame', { gameId: 'trivia' });
  await until(() => a.state && /^trivia-(category|question)$/.test(a.state.phase), `trivia starts (at ${a.state && a.state.phase})`, 15000);
  console.log(`smoke: room ${h.code}, 2 phones, trivia started (${a.state.phase}) — ok`);
  sockets.forEach((s) => s.disconnect());
  process.exit(0);
})().catch((e) => { console.error('smoke: FAILED —', e.message); process.exit(1); });
