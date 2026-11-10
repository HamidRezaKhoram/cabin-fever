/* Rumpus host (TV) view — renderer of room:stateUpdate. AGPLv3, see LICENSE. */
'use strict';

const { esc, store, sfx, countdown, games, av, sprites, music, fx, morph, clock, playerImg, playerUrl, fitAll , hit } = window.Rumpus;
const socket = io();

const codeEl = document.getElementById('room-code');
const phaseView = document.getElementById('phase-view');
const playerList = document.getElementById('player-list');
const controls = document.getElementById('controls');
const fsBtn = document.getElementById('fs-btn');
const overlay = document.getElementById('start-overlay');
const timerbar = document.getElementById('timerbar');

let state = null;
let roomCode = null;
// Test tools (bot players) show with /host?debug=1 or /host?bots=1.
const TEST_TOOLS = (() => { try { return /[?&](debug|bots)=1/.test(location.search) || localStorage.getItem('rumpus.debug') === '1'; } catch (e) { return false; } })();
let baseUrl = location.origin;
let lastPhaseKey = null;
let lastPlayerCount = 0;
let prevScores = new Map();
let lastRoundSeen = null;
let timerTotal = { endsAt: null, total: 1 };
let wiping = false;
let pendingHtml = null;
let lastAwards = [];

const scene = window.Rumpus.background(document.getElementById('bg'), { fps: 12 });
let sidebarTimer = null;
let rosterKey = '';
/** In a game the player strip is hidden; flash it for 5 s when someone joins, leaves or reconnects. */
function peekSidebar() {
  document.body.classList.add('sidebar-peek');
  clearTimeout(sidebarTimer);
  sidebarTimer = setTimeout(() => document.body.classList.remove('sidebar-peek'), 5000);
}

// --- press start (unlocks audio) -----------------------------------------------
overlay.addEventListener('click', async () => {
  overlay.hidden = true;
  await music.enable();
  music.play(cueFor(state));
});

// "Now playing" toast, like a radio station in a racing game.
const nowPlaying = document.getElementById('now-playing');
let npTimer = null;
music.onTrack(({ name }) => {
  nowPlaying.innerHTML = `♪ ${esc(name)}`;
  nowPlaying.classList.remove('show'); void nowPlaying.offsetWidth; nowPlaying.classList.add('show');
  clearTimeout(npTimer);
  npTimer = setTimeout(() => nowPlaying.classList.remove('show'), 4000);
});

// How-to-play cards shown when a game starts.
const RULES = {
  quiplash: ['You get 2 prompts — a rival gets each one too', 'Everyone else votes: who\'s funnier?', 'Win every vote = SHUTOUT bonus'],
  fibbage: ['Write a believable fake answer', 'Find the TRUE answer among the lies', 'Points for every friend you fool'],
  trivia: ['Pick the right answer — fast!', 'Answer streaks add bonus points 🔥', 'Last place picks the next category'],
  closest: ['Guess the number', 'Closest gets the most points', 'Exact hit = BULLSEYE bonus'],
  majority: ['Type what everyone ELSE will say', 'Match the crowd to score', 'Unique answers get nothing'],
  mostlikely: ['Vote which friend fits the prompt', 'Vote with the majority to score', 'No hard feelings… probably'],
  imposter: ['Everyone gets a secret word — except one', 'Give a one-word clue', 'Vote out the imposter!'],
  twotruths: ['Write 2 truths and 1 lie about you', 'Spot everyone else\'s lie', 'Points for each person you fool'],
  telephone: ['Write a phrase, draw, describe, repeat', 'Watch the chains go off the rails', 'Vote for the best doodle'],
  cah: ['A Card Czar reads the prompt', 'Everyone plays their worst card', 'The Czar picks a winner'],
  minigames: ['Quick real-time challenges on your phone', 'Tap, react, count, roast — rules shown each time', 'Turn on Teams for Red vs Blue!'],
};
function showIntro(gameId) {
  const meta = (state.availableGames || []).find((g) => g.id === gameId);
  if (!meta) return;
  const el = document.createElement('div');
  el.className = 'intro-card';
  el.innerHTML = `<div class="intro-inner">
      ${sprites.iconUrl(gameId) ? `<img class="intro-icon" src="${sprites.iconUrl(gameId)}" alt="">` : ''}
      <div class="intro-title">${esc(meta.name)}</div>
      <ol class="intro-rules">${(RULES[gameId] || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
      <div class="intro-crew">${state.players.map((p) => playerImg(p, 'avatar big bob')).join('')}</div>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4400);
}

// Attract mode: avatars stroll across the bottom of the lobby screen.
setInterval(() => {
  if (!state || state.phase !== 'lobby' || document.hidden) return;
  const pool = state.players.length ? state.players.map((p) => p.avatar) : [...Array(sprites.count).keys()];
  const w = document.createElement('img');
  w.className = 'walker' + (Math.random() < 0.5 ? ' rtl' : '');
  w.src = sprites.avatarUrl(pool[Math.floor(Math.random() * pool.length)]);
  document.body.appendChild(w);
  setTimeout(() => w.remove(), 14000);
}, 4500);

// --- volume sliders ----------------------------------------------------------------
for (const kind of ['music', 'sfx']) {
  const el = /** @type {HTMLInputElement} */ (document.getElementById('vol-' + kind));
  el.value = String(Math.round(music.volumes()[kind] * 100));
  el.addEventListener('input', () => music.setVolume(kind, Number(el.value) / 100));
  // Preview the effects volume once, when the slider is released (not on every step).
  if (kind === 'sfx') el.addEventListener('change', () => sfx.pop());
}

// Work out the address phones should use. If the TV opened us via localhost,
// fall back to the server's LAN IP so the QR code actually works.
fetch('/api/info').then((r) => r.json()).then((info) => {
  const local = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname);
  if (info.publicUrl) baseUrl = info.publicUrl;
  else if (local && info.lan && info.lan.length) baseUrl = info.lan[0];
  updateJoinInfo();
}).catch(() => {});

function joinUrl(withCode) {
  return baseUrl + '/play' + (withCode && roomCode ? '?code=' + roomCode : '');
}

const startJoin = document.getElementById('start-join');
function updateJoinInfo() {
  if (roomCode) {
    /** @type {HTMLImageElement} */ (document.getElementById('start-qr')).src = '/qr.svg?data=' + encodeURIComponent(joinUrl(true));
    document.getElementById('start-code').textContent = roomCode;
    document.getElementById('start-addr').textContent = joinUrl(false).replace(/^https?:\/\//, '');
    startJoin.hidden = false;
  }
  if (state && (state.phase === 'lobby' || state.phase === 'gameover')) render();
}

// --- connection / room resume ------------------------------------------------

socket.on('connect', () => {
  document.body.classList.remove('offline');
  const saved = store('rumpus.host');
  if (saved && saved.code && saved.hostToken) socket.emit('host:resume', saved);
  else socket.emit('host:createRoom');
});
socket.on('host:resumeFailed', () => { store('rumpus.host', null); socket.emit('host:createRoom'); });
socket.on('host:roomCreated', (msg) => {
  roomCode = msg.code;
  codeEl.textContent = msg.code || 'ERR';
  if (msg.code) store('rumpus.host', { code: msg.code, hostToken: msg.hostToken });
  updateJoinInfo();
});
socket.on('host:replaced', () => {
  phaseView.innerHTML = '<h1>This room was opened on another screen.</h1><p>Reload to start a new room here.</p>';
  store('rumpus.host', null);
});
socket.on('room:stateUpdate', (msg) => { state = msg; window.Rumpus.setState(msg); render(); });
socket.on('room:reaction', (r) => {
  fx.reaction(esc(r.emoji), playerUrl({ id: r.playerId, avatar: r.avatar, look: r.look }), esc(r.nickname));
  sfx.pop();
});
socket.on('disconnect', () => document.body.classList.add('offline'));
socket.on('room:event', (ev) => {
  if (ev.type === 'skipped') { fx.banner('QUESTION SKIPPED!\nFresh one coming up'); sfx.whoosh(); }
  else if (ev.type === 'hurry') { fx.banner('HURRY UP!\n10 SECONDS LEFT'); sfx.boo(); }
  else if (ev.type === 'ready') sfx.whoosh();
});

// --- input --------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const kick = hit(e.target, '[data-kick]');
  if (kick) {
    const p = state && state.players.find((x) => x.id === kick.dataset.kick);
    if (p && confirm(`Kick ${p.nickname}?`)) socket.emit('host:kickPlayer', { playerId: p.id });
    return;
  }
  const pickBtn = hit(e.target, '.game-pick');
  if (pickBtn && !pickBtn.disabled) return socket.emit('host:startGame', { gameId: pickBtn.dataset.gameId });
  const act = hit(e.target, '[data-act]');
  if (!act) return;
  if (act.dataset.act === 'skip') socket.emit('host:skip');
  if (act.dataset.act === 'night') socket.emit('host:startNight', { count: +act.dataset.n });
  if (act.dataset.act === 'bots') socket.emit('host:addBots', { count: +act.dataset.n, speed: +(act.dataset.speed || 1) });
  if (act.dataset.act === 'nobots') socket.emit('host:removeBots');
  if (act.dataset.act === 'end' && confirm('End this game and go back to the menu?')) socket.emit('host:endGame');
  if (act.dataset.act === 'newroom' && confirm('Close this room and make a new one? Everyone will need to rejoin.')) {
    store('rumpus.host', null);
    location.reload();
  }
});
document.addEventListener('change', (e) => {
  const t = /** @type {HTMLInputElement} */ (e.target);
  if (t.id === 'set-rounds') socket.emit('host:settings', { rounds: t.value === '' ? null : +t.value });
  else if (t.id === 'set-timer') socket.emit('host:settings', { timerScale: +t.value });
  else if (t.id === 'set-spicy') socket.emit('host:settings', { spicy: t.checked });
  else if (t.id === 'set-teams') socket.emit('host:settings', { teams: t.checked });
});
fsBtn.addEventListener('click', () => {
  // Fullscreen can be refused (no user gesture, kiosk mode) — that's fine, just stay windowed.
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
});

// --- music moods ----------------------------------------------------------------

const isRevealPhase = (p) => /reveal|results/.test(p);
function cueFor(st) {
  if (!st) return 'title';
  const p = st.phase;
  const g = st.gameState || {};
  if (p === 'lobby') return st.players.length ? 'menu' : 'title';
  if (p === 'gameover') return 'scoreboard';
  if (p === 'trivia-category') return 'category';
  // Within a game the music stays on the game's theme (stingers mark votes and
  // reveals) — switching tracks every 10–20 s between vote/reveal was jarring.
  if (g.stage === 3 || g.multiplier === 3) return 'final';
  if (p === 'imp-vote' || p === 'ml-vote') return 'vote';     // accusation moments get tension music
  if (p === 'tel-reveal') return 'reveal';                    // the long chain showcase
  return 'game:' + g.gameId;
}

// --- per-game stats for end-of-game awards -----------------------------------
let gameStats = null; // { gameId, rounds: [{ scores: Map }] , start: Map }
let leaderId = null;
function snapshotScores() { return new Map(state.players.map((p) => [p.id, p.score])); }
function computeAwards() {
  if (!gameStats || !gameStats.snaps.length) return [];
  const snaps = [gameStats.start, ...gameStats.snaps];
  const players = state.players;
  const name = (id) => (players.find((p) => p.id === id) || {}).nickname;
  const avatar = (id) => (players.find((p) => p.id === id) || {}).avatar;
  const gains = new Map(players.map((p) => [p.id, []]));
  for (let i = 1; i < snaps.length; i++) {
    for (const p of players) gains.get(p.id).push((snaps[i].get(p.id) || 0) - (snaps[i - 1].get(p.id) || 0));
  }
  const awards = [];
  const best = (fn, min = 1) => {
    let top = null, v = -Infinity;
    for (const p of players) { const x = fn(p.id); if (x > v) { v = x; top = p.id; } }
    return v >= min ? { id: top, v } : null;
  };
  const clutch = best((id) => { const g = gains.get(id); return g[g.length - 1] || 0; });
  if (clutch) awards.push({ title: 'CLUTCH', desc: `+${clutch.v} in the last round`, id: clutch.id });
  const consistent = best((id) => gains.get(id).filter((x) => x > 0).length, 2);
  if (consistent) awards.push({ title: 'MR. RELIABLE', desc: `scored in ${consistent.v} rounds`, id: consistent.id });
  const big = best((id) => Math.max(0, ...gains.get(id)));
  if (big) awards.push({ title: 'BIG MOMENT', desc: `+${big.v} in one round`, id: big.id });
  // Biggest climb from the midpoint ranking to the final ranking.
  const mid = snaps[Math.floor(snaps.length / 2)];
  const rank = (m) => { const ids = players.map((p) => p.id).sort((a, b) => (m.get(b) || 0) - (m.get(a) || 0)); return (id) => ids.indexOf(id); };
  const rMid = rank(mid), rEnd = rank(snaps[snaps.length - 1]);
  const climb = best((id) => rMid(id) - rEnd(id));
  if (climb) awards.push({ title: 'COMEBACK KID', desc: `climbed ${climb.v} place${climb.v > 1 ? 's' : ''}`, id: climb.id });
  const last = players.slice().sort((a, b) => a.score - b.score)[0];
  if (last && players.length > 2) awards.push({ title: 'PARTICIPATION TROPHY', desc: 'there\'s always next game', id: last.id });
  // Don't give one person every award.
  const seen = new Map();
  return awards.filter((a) => { const n = (seen.get(a.id) || 0) + 1; seen.set(a.id, n); return n <= 2; })
    .map((a) => ({ ...a, name: name(a.id), avatar: avatar(a.id) }));
}

// --- rendering ----------------------------------------------------------------

const T = '<span class="timer"></span>';
// Each game's art is drawn at 4× its own pixel size, on its own colour theme.
const ART_BG = {
  quiplash: '#3b1f5e', fibbage: '#5a3b22', trivia: '#1d2b5c', closest: '#173d2a', majority: '#2b5f8f',
  mostlikely: '#5c1d3e', imposter: '#3d4a1d', twotruths: '#24324a', telephone: '#4a3a12', cah: '#1a1423', minigames: '#123d4f',
};
const art = (id) => {
  const u = sprites.iconUrl(id);
  if (!u) return '';
  const [w, h] = sprites.iconSize(id);
  return `<div class="game-art" style="--art-bg:${ART_BG[id] || '#2f2850'}"><img src="${u}" width="${w * 4}" height="${h * 4}" alt=""></div>`;
};

function gamePicker(label) {
  const count = state.players.length;
  const st = state.settings || {};
  const opt = (v, cur, text) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${text}</option>`;
  const fig = (p) => `<figure class="${p.team ? 'team-' + p.team : ''}">${playerImg(p, 'avatar big bob')}${esc(p.nickname)}</figure>`;
  const crew = st.teams
    ? ['red', 'blue'].map((t) => `<div class="team-col team-${t}"><b>${t === 'red' ? '🔴 RED' : '🔵 BLUE'}</b>${state.players.filter((p) => p.team === t).map(fig).join('')}</div>`).join('')
    : state.players.map(fig).join('');
  const max = state.maxPlayers || 12;
  // One join card: QR + room code + address together (nothing else on screen repeats them).
  const joinCard = roomCode ? `<div class="join-card">
      <img class="qr-big" src="/qr.svg?data=${encodeURIComponent(joinUrl(true))}" alt="QR code to join">
      <div class="join-text">
        <span class="join-label">Scan or go to</span>
        <span class="join-addr">${esc(joinUrl(false).replace(/^https?:\/\//, ''))}</span>
        <span class="join-label">Room code</span>
        <span class="join-code">${esc(roomCode)}</span>
        <span class="join-count">${count ? `${count}/${max} joined` : 'Nobody here yet'}</span>
      </div>
    </div>` : '';
  return `<div class="lobby-head">
      <div>
        <h1>${label}</h1>
        <div class="night-row">🎉 <b>Game night</b> — a playlist chosen by your phones, with a grand champion:
          ${[3, 5, 7].map((n) => `<button data-act="night" data-n="${n}" ${count < 2 ? 'disabled' : ''}>${n} games</button>`).join('')}</div>
        <div class="settings">
          <label>Rounds <select id="set-rounds">${opt('', st.rounds == null ? '' : st.rounds, 'Default')}
            ${[3, 5, 8, 10].map((n) => opt(n, st.rounds, n)).join('')}</select></label>
          <label>Timers <select id="set-timer">${opt(0.6, st.timerScale, 'Fast')}${opt(1, st.timerScale, 'Normal')}
            ${opt(1.5, st.timerScale, 'Relaxed')}${opt(2, st.timerScale, 'Extra slow')}</select></label>
          <label class="toggle ${st.spicy !== false ? 'spicy-on' : ''}"><input type="checkbox" id="set-spicy" ${st.spicy !== false ? 'checked' : ''}> 🌶 18+ content</label>
          <label class="toggle ${st.teams ? 'teams-on' : ''}"><input type="checkbox" id="set-teams" ${st.teams ? 'checked' : ''}> 👥 Teams</label>
          ${TEST_TOOLS ? `<span class="bot-tools">🤖 <button data-act="bots" data-n="1">+1 bot</button><button data-act="bots" data-n="3">+3</button>
            <button data-act="bots" data-n="3" data-speed="8">+3 fast</button>${state.players.some((p) => p.bot) ? '<button data-act="nobots">Remove bots</button>' : ''}</span>` : ''}
        </div>
        ${crew ? `<div class="lobby-crew">${crew}</div>` : ''}
      </div>
      ${joinCard}
    </div>
    <div class="game-grid">` +
    (state.availableGames || []).map((gm) => {
      const disabled = count < gm.minPlayers;
      return `<button class="game-pick" data-game-id="${esc(gm.id)}" ${disabled ? 'disabled' : ''}>
        ${art(gm.id)}
        <span class="game-text">
          <span class="game-name">${esc(gm.name)}</span>
          <span class="game-blurb">${esc(gm.blurb)}</span>
          <span class="game-min">${disabled ? `Needs ${gm.minPlayers}+ players` : `${gm.minPlayers}+ players`}</span>
        </span>
      </button>`;
    }).join('') + `</div>
    <p class="hint footer-hint"><button class="link-btn" data-act="newroom">Start a fresh room</button></p>`;
}

function podium(standings) {
  const top = standings.slice(0, 3);
  const order = [1, 0, 2].filter((i) => top[i]);
  return '<div class="podium">' + order.map((i) => {
    const s = top[i];
    return `<div class="step p${i + 1}">
      ${av(s.nickname, `avatar ${i === 0 ? 'huge' : 'big'} bob`)}
      <div class="who">${i === 0 ? '👑 ' : ''}${esc(s.nickname)}</div>
      <div class="pts">${s.score}</div>
      <div class="block">${i + 1}</div>
    </div>`;
  }).join('') + '</div>' +
  (standings.length > 3 ? '<ol class="answers standings" start="4">' + standings.slice(3).map((s) =>
    `<li>${av(s.nickname)} ${esc(s.nickname)} <span class="votes">${s.score}</span></li>`).join('') + '</ol>' : '');
}

const voterIcons = (names) => names && names.length
  ? `<span class="voters">${names.map((n) => av(n)).join('')}</span>` : '';

// The original four games' screens.
function legacyHost(phase, g) {
  const roundTag = g.round ? `<p class="round-tag">Question ${g.round} of ${g.totalRounds}${g.multiplier > 1 ? `<span class="double-badge">${g.multiplier}× POINTS</span>` : ''}</p>` : '';
  switch (phase) {
    case 'trivia-category':
      return `<p class="round-tag">Category round</p>
        <h1>${av(g.chooser, 'avatar big bob')} ${esc(g.chooser)} is in last place…</h1>
        <p class="big-sub">…so they pick the next category! ${T}</p>
        <div class="cat-card">${g.categoryOptions.map((c) => `<div>${esc(c)}</div>`).join('')}</div>`;
    case 'trivia-question':
      return `${roundTag}${g.category ? `<span class="cat-banner">${esc(g.category)}</span>` : ''}<h1 class="prompt">${esc(g.question)}</h1>
        <p class="big-sub">Fast answers score more! ${T}</p>
        <ol class="answers">${g.choices.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
        <p class="count">${g.answeredCount} / ${g.totalPlayers} answers in</p>`;
    case 'trivia-reveal':
      return `${roundTag}<h1 class="prompt">${esc(g.question)}</h1><ol class="answers results">` +
        g.choices.map((c, i) => `<li class="${i === g.correct ? 'winner' : ''}">${esc(c)}</li>`).join('') +
        '</ol><ul class="scored-list">' +
        g.scored.map((s) => `<li class="${s.correct ? 'correct' : 'wrong'}">${av(s.nickname)} ${esc(s.nickname)} ${s.correct ? `+${s.gained}` : `✗${s.gained < 0 ? ` ${s.gained}` : ''}`}${s.double ? ' <span class="streak">🎲 DOUBLE DOWN</span>' : ''}${s.streak > 1 ? ` <span class="streak">🔥×${s.streak}</span>` : ''}</li>`).join('') + '</ul>';
    case 'cah-submit':
      return `${roundTag}<p class="round-tag">Card Czar: ${av(g.czarNickname)} ${esc(g.czarNickname)}${g.pickedBy ? ` · prompt chosen by ${av(g.pickedBy)} ${esc(g.pickedBy)}` : ''}</p>
        <h1 class="prompt">${esc(g.blackCard)}</h1><p class="big-sub">Everyone else, play your worst card!</p>
        <p class="count">${g.submittedCount} / ${g.neededCount} cards in</p>`;
    case 'cah-czar':
      return `${roundTag}<p class="round-tag">Card Czar: ${av(g.czarNickname)} ${esc(g.czarNickname)}</p>
        <h1 class="prompt">${esc(g.blackCard)}</h1><p class="big-sub">${esc(g.czarNickname)} is picking a winner…</p>
        <ol class="answers">${g.submissions.map((s) => `<li>${esc(s.text)}</li>`).join('')}</ol>`;
    case 'cah-reveal':
      return `${roundTag}<h1 class="prompt">${esc(g.blackCard)}</h1>
        <p class="big-answer">${esc(g.winner.text)}</p>
        <p class="big-sub winner-line">${av(g.winner.nickname, 'avatar big bob')} ${esc(g.winner.nickname)} wins the round!</p>`;
    case 'fib-bluff':
      return `${roundTag}<h1 class="prompt">${esc(g.prompt)}</h1>
        <p class="big-sub">Write a believable LIE on your phone! ${T}</p><p class="count">${g.submittedCount} / ${g.totalPlayers} lies in</p>`;
    case 'fib-choose':
      return `${roundTag}<h1 class="prompt">${esc(g.prompt)}</h1>
        <p class="big-sub">One of these is TRUE. Find it! ${T}</p>
        <ol class="answers">${g.options.map((o) => `<li>${esc(o.text)}</li>`).join('')}</ol>
        <p class="count">${g.pickedCount} / ${g.totalPlayers} guesses in</p>`;
    case 'fib-reveal':
      return `${roundTag}<h1 class="prompt">${esc(g.prompt)}</h1><ol class="answers results">` +
        g.result.options.map((o) => `<li class="${o.isTruth ? 'winner' : ''}">${esc(o.text)}
          <span class="byline">${o.isTruth ? '— THE TRUTH!' : (o.authors.length ? '— ' + o.authors.map((n) => av(n) + ' ' + esc(n)).join(', ') + '\'s lie' : '')}</span>
          ${o.pickedBy.length ? `<span class="votes">${o.isTruth ? 'found by' : 'fooled'}</span>${voterIcons(o.pickedBy)}` : ''}
          ${o.likes ? `<span class="votes likes">👍 ${o.likes}</span>` : ''}</li>`).join('') +
        '</ol>' + window.Rumpus.scoredList(g.result.scored);
    default:
      return null;
  }
}

function renderSidebar(phase) {
  const sorted = state.players.slice();
  if (phase !== 'lobby') sorted.sort((a, b) => b.score - a.score);
  const ts = state.teamScores;
  const teamBar = document.getElementById('team-bar');
  if (ts) {
    const total = Math.max(1, ts.red + ts.blue);
    teamBar.hidden = false;
    morph(teamBar, `<div class="tb red" style="flex:${Math.max(0.15, ts.red / total)}">🔴 ${ts.red}</div><div class="tb blue" style="flex:${Math.max(0.15, ts.blue / total)}">${ts.blue} 🔵</div>`);
  } else teamBar.hidden = true;
  morph(playerList, sorted.map((p, i) => {
    const cls = [!p.connected && 'offline', i === 0 && p.score > 0 && phase !== 'lobby' && 'leader'].filter(Boolean).join(' ');
    return `<li data-id="${esc(p.id)}" class="${cls}${p.team ? ' team-' + p.team : ''}">${playerImg(p)}` +
      `<span class="pname">${esc(p.nickname)}${p.connected ? '' : ' <small>(zzz)</small>'}</span>` +
      `<span class="pscore">${p.score}</span><button class="kick" data-kick="${esc(p.id)}" title="Kick ${esc(p.nickname)}">✕</button></li>`;
  }).join(''));
  // Score pop-ups
  for (const p of state.players) {
    const before = prevScores.get(p.id);
    if (before != null && p.score > before) {
      fx.scorePop(playerList.querySelector(`li[data-id="${p.id}"] .pscore`), p.score - before);
    }
  }
  prevScores = new Map(state.players.map((p) => [p.id, p.score]));
}

function updateTimerBar(endsAt) {
  if (!endsAt) { timerbar.hidden = true; return; }
  if (timerTotal.endsAt !== endsAt) timerTotal = { endsAt, total: Math.max(1000, endsAt - Date.now()) };
  timerbar.hidden = false;
}
// Timer bar drains smoothly on the shared 30 fps clock (transform, not width:
// no layout work per frame).
clock.add(() => {
  if (timerbar.hidden || !timerTotal.endsAt) return;
  const left = Math.max(0, timerTotal.endsAt - Date.now());
  /** @type {HTMLElement} */ (timerbar.firstElementChild).style.transform = `scaleX(${(left / timerTotal.total).toFixed(4)})`;
  timerbar.classList.toggle('urgent', left < 5000);
});

function render() {
  if (!state) return;
  const g = state.gameState || {};
  const phase = state.phase;

  renderSidebar(phase);
  if (state.players.length > lastPlayerCount && phase === 'lobby') { sfx.join(); music.play(cueFor(state)); }
  lastPlayerCount = state.players.length;

  const inGame = phase !== 'lobby' && phase !== 'gameover';
  // Per-game look: colour scheme (CSS) + background scene; lobby/gameover use the default.
  const themeId = inGame && g.gameId !== 'night' ? g.gameId : 'lobby';
  if (document.body.dataset.theme !== themeId) {
    document.body.dataset.theme = themeId;
    scene.setTheme(themeId);
  }
  // In a game: hide the join clutter, and tuck the sidebar away after 10 s
  // (it pops back for 10 s whenever someone new joins).
  const wasInGame = document.body.classList.contains('in-game');
  document.body.classList.toggle('in-game', inGame);
  document.body.classList.toggle('lobby', phase === 'lobby'); // the lobby shows the players itself
  if (!inGame || !wasInGame) { clearTimeout(sidebarTimer); document.body.classList.remove('sidebar-peek'); }
  // Someone joined, left or (re)connected → flash the player strip for 5 s.
  const roster = state.players.map((p) => p.id + (p.connected ? '+' : '-')).sort().join(',');
  if (inGame && wasInGame && roster !== rosterKey) peekSidebar();
  rosterKey = roster;
  controls.hidden = !inGame;
  const pc = state.pace || { counts: {}, need: 0 };
  const paceTxt = ['skipq', 'hurry', 'ready'].filter((k) => pc.counts[k]).map((k) =>
    `<span class="pace-pill">${{ skipq: '🔄 skip', hurry: '⏩ hurry', ready: '▶ next' }[k]} ${pc.counts[k]}/${pc.need}</span>`).join('');
  controls.innerHTML = inGame
    ? `${paceTxt}<button data-act="skip" ${state.canSkip ? '' : 'disabled'}>Skip ⏭</button><button data-act="end" class="danger">End</button>`
    : '';

  // Work out end-of-game awards before the game-over screen is drawn.
  if (phase === 'gameover' && lastPhaseKey && !lastPhaseKey.startsWith('gameover')) {
    if (gameStats) gameStats.snaps.push(snapshotScores());
    lastAwards = computeAwards();
    gameStats = null;
  }

  let html;
  if (phase === 'lobby') {
    html = gamePicker('Choose a game');
  } else if (phase === 'gameover') {
    const awards = lastAwards;
    const ts2 = state.teamScores;
    const teamWin = ts2 ? `<p class="team-win ${ts2.red === ts2.blue ? '' : ts2.red > ts2.blue ? 'red' : 'blue'}">${ts2.red === ts2.blue ? 'TEAMS TIED!' : (ts2.red > ts2.blue ? '🔴 RED' : '🔵 BLUE') + ' TEAM WINS!'} <small>${ts2.red} – ${ts2.blue}</small></p>` : '';
    html = '<h1>🏆 Final scores</h1>' + teamWin + podium(g.standings || []) +
      (awards.length ? '<div class="awards">' + awards.map((a, i) => `<div class="award" style="animation-delay:${1 + i * 0.5}s">
        ${av(a.name, 'avatar big')}<div><b>${esc(a.title)}</b><span>${esc(a.name)} — ${esc(a.desc)}</span></div></div>`).join('') + '</div>' : '') +
      (state.night ? window.Rumpus.nightTable(state.night, true) : gamePicker('Play again?'));
  } else if (games[g.gameId]) {
    html = games[g.gameId].host(state);
    if (g.multiplier > 1 && !/× POINTS/.test(html)) {
      html = html.replace(/(<p class="round-tag">[^<]*)/, `$1<span class="double-badge">${g.multiplier}× POINTS</span>`);
    }
  } else {
    html = legacyHost(phase, g) || `<h1>${esc(phase)}</h1>`;
  }

  const key = [phase, g.round || 0, g.chainIndex || 0, g.matchIndex == null ? '' : g.matchIndex, g.skipSeq || 0].join(':');
  const phaseChanged = key !== lastPhaseKey;
  if (phaseChanged) {
    const wasInGame = lastPhaseKey && !/^(lobby|gameover)/.test(lastPhaseKey);
    lastPhaseKey = key;
    // Game just started: title card + stinger, start tracking stats.
    if (inGame && !wasInGame) {
      gameStats = { gameId: g.gameId, start: snapshotScores(), snaps: [] };
      leaderId = null;
      showIntro(g.gameId);
      music.play('intro', { then: cueFor(state) });
    } else if (phase === 'gameover') {
      sfx.win(); fx.confetti(240);
      music.play('victory', { then: 'scoreboard' });
      lastAwards.forEach((a, i) => setTimeout(() => sfx.award(), 1000 + i * 500));
    } else {
      music.setIntensity(g.multiplier === 2 ? 2 : 1);
      music.play(cueFor(state));
      if (isRevealPhase(phase)) {
        if (['cg-reveal', 'mr-reveal', 'ml-reveal'].includes(phase)) sfx.drumroll();
        else sfx.reveal();
        shake();
        if (gameStats) gameStats.snaps.push(snapshotScores());
      } else if (inGame) sfx.phase();
      if (phase === 'cah-reveal' || (phase === 'results' && g.result && g.result.sides.some((sd) => sd.shutout))) fx.confetti(90);
      if (phase === 'results' && g.result && g.result.sides.some((sd) => sd.shutout)) fx.banner('SHUTOUT!', 'gold');
      if (phase === 'trivia-category') fx.banner('CATEGORY ROUND!', 'gold');
      if (phase === 'cg-reveal' && g.result && g.result.list.some((e) => e.exact)) { fx.banner('BULLSEYE!', 'gold'); fx.confetti(120); }
      if (phase === 'imp-reveal' && g.result) fx.banner(g.result.outcome === 'caught' ? 'GOTCHA!' : g.result.outcome === 'stole' ? 'STOLEN!' : 'GOT AWAY!', g.result.outcome === 'caught' ? 'gold' : '');
    }
    // Lead change alert (only mid-game, only when the leader actually changes).
    if (inGame && isRevealPhase(phase)) {
      const top = state.players.slice().sort((a, b) => b.score - a.score)[0];
      if (top && top.score > 0 && leaderId && top.id !== leaderId) {
        setTimeout(() => { fx.banner(`NEW LEADER!\n${top.nickname}`, 'gold'); sfx.leader(); }, 900);
      }
      if (top && top.score > 0) leaderId = top.id;
    }
    if (phase === 'lobby') music.play(cueFor(state));
    // Stage title cards: ROUND 2 (×2) and FINAL QUESTION (×3).
    const mult = g.multiplier || 1;
    if (inGame && !isRevealPhase(phase) && mult !== lastRoundSeen) {
      if (mult === 2) fx.banner('ROUND 2!\nDOUBLE POINTS', 'gold');
      if (mult === 3) fx.banner('FINAL QUESTION!\nTRIPLE POINTS', 'gold');
      if (mult > 1) sfx.leader();
    }
    if (inGame && !isRevealPhase(phase)) lastRoundSeen = mult;
    if (!inGame) lastRoundSeen = 1;
    // Pixel wipe between screens (not between lobby re-renders).
    pendingHtml = html;
    if (!wiping) {
      wiping = true;
      fx.wipe(() => {
        phaseView.innerHTML = pendingHtml;
        layoutStage();
        wiping = false;
        countdown((state.gameState || {}).endsAt, '.timer', tick);
      });
    }
  } else if (wiping) {
    pendingHtml = html;
  } else {
    morph(phaseView, html); // small updates (counts, votes) without restarting animations
    layoutStage();
  }
  updateTimerBar(inGame ? g.endsAt : null);
  // Content attribution for sourced questions (Wikidata, Open Trivia DB, …).
  const srcEl = document.getElementById('source-line');
  srcEl.hidden = !(inGame && g.source);
  if (inGame && g.source && srcEl.textContent !== 'Source: ' + g.source) srcEl.textContent = 'Source: ' + g.source;
  if (!wiping) countdown(g.endsAt, '.timer', tick);
}

// Make the main question/prompt fill the stage (TV readability).
function layoutStage() {
  const inGame = state && !['lobby', 'gameover'].includes(state.phase);
  phaseView.classList.toggle('in-game', !!inGame);
  if (!inGame) return;
  /** @type {NodeListOf<HTMLElement>} */ (phaseView.querySelectorAll('h1.prompt, h1:not(.prompt)')).forEach((h, i) => { if (i === 0) h.dataset.fit = h.dataset.fit || '0.13,4'; });
  /** @type {NodeListOf<HTMLElement>} */ (phaseView.querySelectorAll('.vs-card')).forEach((c) => { c.dataset.fit = '0.07,5'; });
  /** @type {NodeListOf<HTMLElement>} */ (phaseView.querySelectorAll('.big-answer')).forEach((c) => { c.dataset.fit = '0.12,2'; });
  fitAll(phaseView);
}
window.addEventListener('resize', () => layoutStage());
// Refit when the stage changes size (sidebar sliding away, fonts loading, …).
let lastStageW = 0;
new ResizeObserver(() => {
  const w = phaseView.clientWidth;
  if (Math.abs(w - lastStageW) > 4) { lastStageW = w; layoutStage(); }
}).observe(phaseView);
if (document.fonts) void document.fonts.ready.then(() => layoutStage());

function tick(left) {
  if (left > 0 && left <= 5) sfx.tick();
  const inputish = state && !/lobby|gameover|reveal|results/.test(state.phase);
  music.setHurry(inputish && left > 0 && left <= 10);
}

function shake() {
  const st = document.getElementById('stage');
  st.classList.remove('shake'); void st.offsetWidth; st.classList.add('shake');
}
