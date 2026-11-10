/*
 * End-to-end test for the newer games + reconnect/skip/settings plumbing.
 * Boots the real server in-process and drives it with socket.io clients.
 * AGPLv3 — see LICENSE.
 */
'use strict';

process.env.PORT = '0';
process.env.PLAYER_GRACE_MS = '5000';
process.env.RUMPUS_REVEAL_MS = '300';
process.env.RUMPUS_TEL_ENTRY_MS = '100';
process.env.RUMPUS_TEL_FAV_MS = '300';
process.env.RUMPUS_CONTENT_DIR = '/nonexistent';
process.env.RUMPUS_DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'rumpus-'));

const path = require('path');
const http = require('http');
const { io: ioClient } = require('socket.io-client');

let server;
const sockets = [];
const done = (code) => {
  sockets.forEach((s) => s.disconnect());
  if (server) server.close();
  setTimeout(() => process.exit(code), 200).unref();
};
const fail = (msg, err) => { console.error('FAIL:', msg); if (err) console.error(err); done(1); };
const pass = (msg) => console.log('PASS:', msg);
setTimeout(() => fail('overall timeout'), 60000).unref();

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  const orig = http.createServer;
  http.createServer = (...a) => (server = orig.apply(http, a));
  require(path.join(__dirname, '..', 'server.js'));
  http.createServer = orig;
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const connect = () => { const s = ioClient(url, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };

  const latest = {};
  const host = connect();
  host.on('room:stateUpdate', (m) => { latest.host = m; });
  const { code, hostToken } = await new Promise((res) => {
    host.on('connect', () => host.emit('host:createRoom'));
    host.once('host:roomCreated', res);
  });
  if (!hostToken) return fail('no host token');
  pass(`room ${code} created`);

  const players = {};
  async function join(name) {
    const s = connect();
    s.on('room:stateUpdate', (m) => { latest[name] = m; });
    const msg = await new Promise((res, rej) => {
      s.on('connect', () => s.emit('player:joinRoom', { code, nickname: name }));
      s.once('player:joined', res);
      s.once('player:joinError', (e) => rej(new Error(e.reason)));
    });
    players[name] = { sock: s, id: msg.playerId, token: msg.token };
  }
  const NAMES = ['Ann', 'Ben', 'Cat', 'Dan'];
  for (const n of NAMES) await join(n);
  pass('4 players joined');

  const wait = (who, pred, label, ms = 8000) => new Promise((res, rej) => {
    const t0 = Date.now();
    (function chk() {
      const st = latest[who];
      if (st && pred(st)) return res(st);
      if (Date.now() - t0 > ms) return rej(new Error(`timeout waiting for ${who}: ${label}; at phase ${st && st.phase}`));
      setTimeout(chk, 30);
    })();
  });
  const phase = (who, p) => wait(who, (s) => s.phase === p, p);
  const all = (p) => Promise.all(NAMES.map((n) => phase(n, p)));
  const submit = (n, payload) => players[n].sock.emit('player:submit', { payload });

  // Settings: 1 round of everything.
  host.emit('host:settings', { rounds: 1, timerScale: 0.6 });
  await wait('host', (s) => s.settings && s.settings.rounds === 1, 'settings applied');
  pass('settings applied (rounds=1, fast timers)');

  // --- Reconnect: drop Ben's socket, rejoin with token on a new socket ----
  players.Ben.sock.disconnect();
  await wait('host', (s) => s.players.some((p) => p.nickname === 'Ben' && !p.connected), 'Ben offline');
  const ben2 = connect();
  ben2.on('room:stateUpdate', (m) => { latest.Ben = m; });
  const rj = await new Promise((res) => {
    ben2.on('connect', () => ben2.emit('player:rejoin', { code, token: players.Ben.token }));
    ben2.once('player:joined', res);
  });
  if (rj.playerId !== players.Ben.id) return fail('rejoin gave a different player id');
  players.Ben.sock = ben2;
  await wait('host', (s) => s.players.every((p) => p.connected), 'all connected');
  pass('player reconnect with token keeps the same seat');

  // --- Host resume ---------------------------------------------------------
  host.disconnect();
  const host2 = connect();
  host2.on('room:stateUpdate', (m) => { latest.host = m; });
  await new Promise((res, rej) => {
    host2.on('connect', () => host2.emit('host:resume', { code, hostToken }));
    host2.once('host:roomCreated', (m) => (m.code === code ? res() : rej(new Error('wrong room'))));
    host2.once('host:resumeFailed', () => rej(new Error('resume failed')));
  });
  const H = host2;
  pass('host resumed room after disconnect');

  const start = (id) => H.emit('host:startGame', { gameId: id });
  const over = async (label) => { await phase('host', 'gameover'); pass(`${label} reached gameover`); };

  // --- Most Likely To ----------------------------------------------------
  start('mostlikely');
  await all('ml-vote');
  for (const n of NAMES) submit(n, { target: players.Cat.id });
  const ml = await phase('host', 'ml-reveal');
  if (ml.gameState.result.winners[0] !== 'Cat') return fail('mostlikely winner should be Cat');
  pass('mostlikely tally correct');
  await over('mostlikely');

  // --- Majority Rules ----------------------------------------------------
  start('majority');
  await all('mr-answer');
  submit('Ann', { text: 'Bananas' }); submit('Ben', { text: 'the banana' });
  submit('Cat', { text: 'BANANA!' }); submit('Dan', { text: 'lemon' });
  const mr = await phase('host', 'mr-reveal');
  const top = mr.gameState.result.groups[0];
  if (top.count !== 3) return fail(`majority normalization grouped ${top.count}, expected 3: ${JSON.stringify(mr.gameState.result)}`);
  pass('majority groups "Bananas"/"the banana"/"BANANA!" together');
  await over('majority');

  // --- Closest Guess -------------------------------------------------------
  start('closest');
  await all('cg-guess');
  NAMES.forEach((n, i) => submit(n, { number: i * 1000 }));
  const cg = await phase('host', 'cg-reveal');
  if (cg.gameState.result.list.length !== 4 || cg.gameState.result.list[0].gained < 300) return fail('closest scoring');
  pass(`closest reveal (answer ${cg.gameState.result.answer}, winner ${cg.gameState.result.list[0].nickname})`);
  await over('closest');

  // --- Two Truths ----------------------------------------------------------
  start('twotruths');
  await all('tt-write');
  for (const n of NAMES) submit(n, { truths: [`${n} t1`, `${n} t2`], lie: `${n} LIE` });
  for (let i = 0; i < NAMES.length; i++) {
    const st = await wait('host', (s) => s.phase === 'tt-guess' && s.gameState.round === i + 1, `tt round ${i + 1}`);
    const subject = st.gameState.subject;
    const lieIdx = st.gameState.statements.findIndex((x) => x.endsWith('LIE'));
    for (const n of NAMES) if (n !== subject) submit(n, { choice: lieIdx });
    const rv = await wait('host', (s) => s.phase === 'tt-reveal' && s.gameState.round === i + 1, 'tt reveal');
    if (rv.gameState.result.right.length !== 3) return fail('twotruths: everyone should have spotted the lie');
  }
  pass('twotruths: 4 subjects guessed and revealed');
  await over('twotruths');

  // --- Odd One Out ---------------------------------------------------------
  start('imposter');
  await all('imp-clue');
  const imposter = NAMES.find((n) => latest[n].you.isImposter);
  const civ = NAMES.find((n) => n !== imposter);
  if (!imposter || NAMES.filter((n) => latest[n].you.isImposter).length !== 1) return fail('exactly one imposter expected');
  if (latest[imposter].you.word) return fail('imposter must not see the word');
  const word = latest[civ].you.word;
  for (const n of NAMES) submit(n, { text: 'clue' + n });
  await all('imp-vote');
  for (const n of NAMES) submit(n, { target: n === imposter ? players[civ].id : players[imposter].id });
  await phase(imposter, 'imp-guess');
  const opts = latest[imposter].gameState.options;
  submit(imposter, { choice: opts.indexOf(word) });
  const imp = await phase('host', 'imp-reveal');
  if (imp.gameState.result.outcome !== 'stole') return fail(`imposter outcome ${imp.gameState.result.outcome}`);
  pass('imposter caught, then stole with the right word');
  await over('imposter');

  // --- Doodle Telephone ----------------------------------------------------
  start('telephone');
  await all('tel-write');
  for (const n of NAMES) submit(n, { text: `${n}'s phrase` });
  await all('tel-draw');
  if (!latest.Ann.gameState.prev || !/phrase/.test(latest.Ann.gameState.prev.content)) return fail('drawer should see a phrase');
  for (const n of NAMES) submit(n, { image: PNG });
  await all('tel-describe');
  for (const n of NAMES) submit(n, { text: `${n} guess` });
  await all('tel-draw'); // step 3 is a draw again (4 players → 4 steps)
  // Skip: host forces the step to end; missing drawings become blanks.
  submit('Ann', { image: PNG });
  H.emit('host:skip');
  await phase('host', 'tel-reveal');
  const chain = latest.host.gameState.chain;
  if (chain.entries.length !== 4) return fail(`chain should have 4 entries, got ${chain.entries.length}`);
  pass('telephone chain of 4 built; host skip filled the gaps');
  await phase('host', 'tel-vote');
  for (const n of NAMES) {
    const d = latest[n].gameState.drawings;
    if (d.length) submit(n, { key: d[0].key });
  }
  await over('telephone');

  // --- End game mid-way ----------------------------------------------------
  start('mostlikely');
  await phase('host', 'ml-vote');
  H.emit('host:endGame');
  await phase('host', 'lobby');
  pass('host end-game returns to lobby');

  // --- QR + info endpoints -------------------------------------------------
  const get = (p) => new Promise((res) => http.get(url + p, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res({ status: r.statusCode, body: b })); }));
  const qr = await get('/qr.svg?data=' + encodeURIComponent('http://10.0.0.5:8012/play?code=' + code));
  if (qr.status !== 200 || !qr.body.includes('<svg')) return fail('qr endpoint');
  const info = JSON.parse((await get('/api/info')).body);
  if (!Array.isArray(info.lan)) return fail('info endpoint');
  pass('QR + info endpoints work');

  console.log('\nALL NEW-GAME CHECKS PASSED');
  done(0);
}

main().catch((e) => fail('unhandled', e));
