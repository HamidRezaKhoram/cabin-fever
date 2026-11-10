// Load: a full room of 12 phones on real sockets — every state update reaches every phone fast
// and the server stays small. (Raspberry Pi–class machines are slower; the budget leaves room.)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer } = require('../helpers');

test('12 phones: state updates fan out to everyone within 250 ms (p95), memory stays modest', { timeout: 90000 }, async () => {
  const srv = await startServer({ RUMPUS_TRIVIA_ROUNDS: '6', RUMPUS_TRIVIA_QUESTION_MS: '1500', RUMPUS_TRIVIA_REVEAL_MS: '300' });
  try {
    const h = await makeHost(srv);
    const ps = [];
    for (let i = 0; i < 12; i++) ps.push(await makePlayer(srv, h.code, `P${i}`));
    await until(() => h.state.players.length === 12, '12 joined');
    /** @type {number[]} */
    const lags = [];
    // Timestamp each new phase on the host, then measure when each phone sees it.
    const seen = new Map();
    h.sock.on('room:stateUpdate', (s) => { const k = s.phase + '/' + (s.gameState && s.gameState.round); if (!seen.has(k)) seen.set(k, Date.now()); });
    for (const p of ps) {
      const got = new Set();
      p.sock.on('room:stateUpdate', (s) => {
        const k = s.phase + '/' + (s.gameState && s.gameState.round);
        if (got.has(k) || !seen.has(k)) return;
        got.add(k);
        lags.push(Date.now() - seen.get(k));
        // Everyone answers right away, like a room full of fast tappers.
        if (s.phase === 'trivia-question' && !s.you.answered) p.submit({ choice: 0 });
        if (s.phase === 'trivia-category' && s.you.isChooser) p.submit({ choice: 0 });
      });
    }
    h.emit('host:startGame', { gameId: 'trivia' });
    await h.phase('gameover', 60000);
    lags.sort((a, b) => a - b);
    const p95 = lags[Math.floor(lags.length * 0.95)];
    assert.ok(lags.length >= 12 * 6, `measured ${lags.length} deliveries`);
    assert.ok(p95 <= 250, `p95 fan-out ${p95} ms`);
    // Server memory (Linux): resident set size of the server process.
    const status = require('fs').readFileSync(`/proc/${srv.proc.pid}/status`, 'utf8');
    const rssMb = Number((status.match(/VmRSS:\s+(\d+)/) || [0, 0])[1]) / 1024;
    assert.ok(rssMb > 0 && rssMb < 200, `server RSS ${rssMb.toFixed(0)} MB`);
  } finally { await srv.stop(); }
});
