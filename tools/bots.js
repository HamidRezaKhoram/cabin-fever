#!/usr/bin/env node
/*
 * Command-line bot phones: join N bots to a running room over the network,
 * exactly like real phones (Socket.IO), and play whatever game the TV starts.
 *
 *   ./scripts/bots.sh ABCD 5          # 5 bots join room ABCD on localhost:8012
 *   ./scripts/bots.sh ABCD 5 8 http://192.168.1.20:8012   # 8× faster thinking, other server
 *
 * Decisions come from games/bot-brain.js (shared with the in-room bots and the
 * playtest report). AGPLv3 — see LICENSE.
 */
'use strict';
const { io } = require('socket.io-client');
const { decide, thinkMs } = require('../games/bot-brain');

const [code, n = '4', speed = '1', url = 'http://localhost:8012'] = process.argv.slice(2);
if (!code) { console.error('usage: node tools/bots.js CODE [count] [speed] [url]'); process.exit(2); }
const NAMES = ['Ava Bot', 'Ben Bot', 'Cy Bot', 'Dee Bot', 'Eli Bot', 'Fay Bot', 'Gus Bot', 'Hal Bot', 'Ivy Bot', 'Jo Bot', 'Kai Bot', 'Lu Bot'];

for (let i = 0; i < Math.min(12, +n); i++) {
  const name = NAMES[i];
  const s = io(url, { transports: ['websocket'] });
  let state = null;
  let timer = null;
  const tick = () => {
    if (timer || !state) return;
    const first = decide(state);
    if (!first) return;
    timer = setTimeout(() => {
      timer = null;
      const now = state && decide(state);
      if (!now) return;
      s.emit('player:submit', { payload: now.payload });
      console.log(`${name.padEnd(8)} ${state.phase.padEnd(16)} → ${JSON.stringify(now.payload).slice(0, 70)}`);
    }, thinkMs(first.kind) / +speed);
  };
  s.on('connect', () => s.emit('player:joinRoom', { code: code.toUpperCase(), nickname: name, avatar: i }));
  s.on('player:joinError', (e) => { console.error(`${name}: ${e.reason}`); s.close(); });
  s.on('room:stateUpdate', (st) => {
    if (st.phase === 'closed') { console.log(`${name}: room closed`); s.close(); return; }
    state = st;
    tick();
  });
  s.on('player:kicked', () => { console.log(`${name}: kicked`); s.close(); });
}
console.log(`${n} bots joining ${code} at ${url} (speed ×${speed}). Ctrl+C to stop.`);
