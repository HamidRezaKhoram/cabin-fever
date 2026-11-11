/* Rumpus host (TV) view — renderer of room:stateUpdate. AGPLv3, see LICENSE. */
'use strict';

const { esc, store, sfx, countdown, games, av, sprites, music, fx, morph, clock, playerImg, playerUrl, fitAll , hit } = window.Rumpus;
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true, reconnectionDelay: 400, reconnectionDelayMax: 3000 });
window.Rumpus.time.sync(socket);
// Real-time games (Lantern Lake) stream positions to the TV 30×/s outside the normal state push.
socket.on('room:frame', (/** @type {Record<string, any>} */ f) => { window.Rumpus.frame = f; });

const codeEl = /** @type {HTMLElement} */ (document.getElementById('room-code'));
const phaseView = /** @type {HTMLElement} */ (document.getElementById('phase-view'));
const playerList = /** @type {HTMLElement} */ (document.getElementById('player-list'));
const controls = /** @type {HTMLElement} */ (document.getElementById('controls'));
const fsBtn = /** @type {HTMLElement} */ (document.getElementById('fs-btn'));
const overlay = /** @type {HTMLElement} */ (document.getElementById('start-overlay'));
const timerbar = /** @type {HTMLElement} */ (document.getElementById('timerbar'));

/** Latest room:stateUpdate from the server (plain JSON, shape varies by game). @type {any} */
let state = null;
/** After a game: the scores are showing (false) or the game menu (true). */
let pickNext = false;
// The browser build asks before reloading for an update (web/offline.js): not while people are in the room.
/** @type {any} */ (window).cfBusy = () => !!(state && state.players && state.players.length);
/** @type {string | null} */
let roomCode = null;
/** Games with French content (others use English question banks). */
const FRENCH_GAMES = ['quiplash', 'mostlikely', 'majority', 'telephone', 'twotruths', 'minigames', 'looncall', 'lantern'];
document.body.classList.toggle('cb', store('rumpus.cb') === true); // colour-blind palette (this TV)
// Test tools (bot players) show with /host?debug=1 or /host?bots=1.
const TEST_TOOLS = (() => { try { return /[?&](debug|bots)=1/.test(location.search) || localStorage.getItem('rumpus.debug') === '1'; } catch (e) { return false; } })();
let baseUrl = location.origin;
/** @type {string | null} */
let lastPhaseKey = null;
let lastPlayerCount = 0;
/** @type {Map<string, number>} */
let prevScores = new Map();
/** @type {number | null} */
let lastRoundSeen = null;
/** @type {{ endsAt: number | null, total: number }} */
let timerTotal = { endsAt: null, total: 1 };
let wiping = false;
/** @type {string | null} */
let pendingHtml = null;
/** @type {any[]} awards shown at game over */
let lastAwards = [];

const scene = window.Rumpus.background(document.getElementById('bg'), { fps: 12 });
/** @type {number | null} */
let sidebarTimer = null;
let rosterKey = '';
/** In a game the player strip is hidden; flash it for 5 s when someone joins, leaves or reconnects. */
function peekSidebar() {
  document.body.classList.add('sidebar-peek');
  if (sidebarTimer) clearTimeout(sidebarTimer);
  sidebarTimer = setTimeout(() => document.body.classList.remove('sidebar-peek'), 5000);
}

// --- press start (unlocks audio) -----------------------------------------------
overlay.addEventListener('click', async () => {
  overlay.hidden = true;
  await music.enable();
  music.play(cueFor(state));
});

// "Now playing" toast, like a radio station in a racing game.
const nowPlaying = /** @type {HTMLElement} */ (document.getElementById('now-playing'));
/** @type {number | null} */
let npTimer = null;
music.onTrack((/** @type {{ name: string }} */ { name }) => {
  nowPlaying.innerHTML = `♪ ${esc(name)}`;
  nowPlaying.classList.remove('show'); void nowPlaying.offsetWidth; nowPlaying.classList.add('show');
  if (npTimer) clearTimeout(npTimer);
  npTimer = setTimeout(() => nowPlaying.classList.remove('show'), 4000);
});

// How-to-play cards shown when a game starts.
/** How-to-play lines per game (intro card + narrator). @type {Record<string, string[]>} */
const RULES = {
  quiplash: ['You get 2 prompts — a rival gets each one too', 'Everyone else votes: who\'s funnier?', 'Win every vote = SHUTOUT bonus'],
  fibbage: ['Write a believable fake answer', 'Find the TRUE answer among the lies', 'Points for every friend you fool'],
  trivia: ['Pick the right answer — fast!', 'Answer streaks add bonus points 🔥', 'Last place picks the next category'],
  closest: ['Guess the number', 'Closest gets the most points', 'Exact hit = BULLSEYE bonus'],
  majority: ['Type what everyone ELSE will say', 'Then the room votes which answers count as the herd', 'Match the herd to score — loners get nothing'],
  mostlikely: ['Vote which friend fits the prompt', 'Vote with the majority to score', 'No hard feelings… probably'],
  imposter: ['Everyone gets a secret word — except one', 'Give a one-word clue', 'Vote out the imposter!'],
  twotruths: ['Your phone secretly says TRUTH or LIE', 'Answer the confession — real or made up', 'Call everyone else\'s: points for right calls and for fooling people'],
  telephone: ['Write a phrase, draw, describe, repeat', 'Watch the chains go off the rails', 'Vote for the best doodle'],
  cah: ['A Card Czar reads the prompt', 'Everyone plays their worst card', 'The Czar picks a winner'],
  storm: ['Secret roles: most of you are Cottagers — a few are Raccoons', 'The leader picks a crew; everyone votes; the crew secretly helps or sabotages', 'Three chores done: Cottagers win — unless the Raccoons unmask the Lookout'],
  crush: ['Slip notes to your crushes — phones only', 'Reply, then secretly pick a date', 'Secret agendas change the scoring'],
  lantern: ['Tilt your phone to glide (or drag on the circle)', 'Four scenes: fireflies, moonbeam, tag, lily pad, ducklings…', 'One of them: everyone steers the same raft'],
  looncall: ['Listen to the loon\'s call', 'Tap the same rhythm back on your phone', 'Nail it together for IN SYNC bonuses'],
  minigames: ['Quick real-time challenges on your phone', 'Eleven minis — the rules show before each one', 'Turn on Teams for Red vs Blue!'],
};
// --- narrator (Rocco reads prompts aloud and in a speech bubble) -------------
let lastSpoken = '';
/** @param {string} gameId */
function narrateIntro(gameId) {
  const meta = (state.availableGames || []).find((/** @type {{id: string}} */ x) => x.id === gameId);
  const rule = (RULES[gameId] || [])[0];
  if (meta) window.Rumpus.host.say(`${meta.name}! ${rule || ''}`);
}
/** The main prompt of a screen (question, prompt card), read once when it appears. @param {any} g */
function narratePrompt(g) {
  if (!g || isRevealPhase(state.phase)) return;
  const text = g.prompt || g.question || g.blackCard || '';
  if (!text || text === lastSpoken) return;
  lastSpoken = text;
  // Let the intro card finish first on a game's first prompt.
  setTimeout(() => window.Rumpus.host.say(text), 900);
}

function showIntro(/** @type {any} */ gameId) {
  const meta = (state.availableGames || []).find((/** @type {any} */ g) => g.id === gameId);
  if (!meta) return;
  const el = document.createElement('div');
  el.className = 'intro-card';
  el.innerHTML = `<div class="intro-inner">
      ${sprites.iconUrl(gameId) ? `<img class="intro-icon" src="${sprites.iconUrl(gameId)}" alt="">` : ''}
      <div class="intro-title">${esc(meta.name)}</div>
      <ol class="intro-rules">${(RULES[gameId] || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
      <div class="intro-crew">${state.players.map((/** @type {any} */ p) => playerImg(p, 'avatar big bob')).join('')}</div>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4400);
}

// Attract mode: avatars stroll across the bottom of the lobby screen.
setInterval(() => {
  if (!state || state.phase !== 'lobby' || document.hidden) return;
  const pool = state.players.length ? state.players.map((/** @type {any} */ p) => p.avatar) : [...Array(sprites.count).keys()];
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

function joinUrl(/** @type {any} */ withCode) {
  return baseUrl + '/play' + (withCode && roomCode ? '?code=' + roomCode : '');
}

const startJoin = /** @type {HTMLElement} */ (document.getElementById('start-join'));
function updateJoinInfo() {
  if (roomCode) {
    /** @type {HTMLImageElement} */ (document.getElementById('start-qr')).src = window.Rumpus.qrSrc(joinUrl(true));
    /** @type {HTMLElement} */ (document.getElementById('start-code')).textContent = roomCode;
    /** @type {HTMLElement} */ (document.getElementById('start-addr')).textContent = joinUrl(false).replace(/^https?:\/\//, '');
    startJoin.hidden = false;
  }
  if (state && (state.phase === 'lobby' || state.phase === 'gameover')) render();
}

// --- connection / room resume ------------------------------------------------

/** This TV's room (code + key), kept so a reload — or closing and reopening the browser — takes
 * the same room back. In the browser build a second TV tab keeps its own, per tab, so it can't
 * take over the first tab's room. @param {{ code: string, hostToken: string } | null} [v] */
function hostSeat(v) {
  const cabin = /** @type {any} */ (window).CABIN;
  if (!(cabin && cabin.secondTab && cabin.secondTab())) return v === undefined ? store('rumpus.host') : store('rumpus.host', v);
  try {
    if (v === undefined) return JSON.parse(sessionStorage.getItem('rumpus.host2') || 'null');
    if (v === null) sessionStorage.removeItem('rumpus.host2'); else sessionStorage.setItem('rumpus.host2', JSON.stringify(v));
  } catch (e) { return null; }
  return v;
}
// Browser build: the game runs in this page, so leaving it mid-game ends that game (the room and
// everyone's seat come back). Ask first. (Docker: the server keeps the game; reload freely.)
window.addEventListener('beforeunload', (e) => {
  const inGame = state && !['lobby', 'gameover'].includes(state.phase);
  if (!(/** @type {any} */ (window).CABIN) || !inGame) return;
  e.preventDefault();
  e.returnValue = '';
});

socket.on('connect', () => {
  document.body.classList.remove('offline');
  const saved = hostSeat();
  if (saved && saved.code && saved.hostToken) socket.emit('host:resume', saved);
  else socket.emit('host:createRoom');
});
socket.on('host:resumeFailed', () => { hostSeat(null); socket.emit('host:createRoom'); });
socket.on('host:roomCreated', (/** @type {any} */ msg) => {
  roomCode = msg.code;
  codeEl.textContent = msg.code || 'ERR';
  if (msg.code) hostSeat({ code: msg.code, hostToken: msg.hostToken });
  updateJoinInfo();
});
socket.on('host:replaced', () => {
  phaseView.innerHTML = '<h1>This room was opened on another screen.</h1><p>Reload to start a new room here.</p>';
  hostSeat(null);
});
socket.on('room:stateUpdate', (/** @type {any} */ msg) => { state = msg; window.Rumpus.setState(msg); render(); });
socket.on('room:reaction', (/** @type {any} */ r) => {
  fx.reaction(esc(r.emoji), playerUrl({ id: r.playerId, avatar: r.avatar, look: r.look }), esc(r.nickname));
  sfx.pop();
});
socket.on('disconnect', () => document.body.classList.add('offline'));
socket.on('room:event', (/** @type {any} */ ev) => {
  if (ev.type === 'skipped') { fx.banner('QUESTION SKIPPED!\nFresh one coming up'); sfx.whoosh(); }
  else if (ev.type === 'hurry') { fx.banner('HURRY UP!\n10 SECONDS LEFT'); sfx.boo(); }
  else if (ev.type === 'wrap') { fx.banner('ROUND OVER!\nThe room voted to move on'); sfx.whoosh(); }
  // Back after a TV reload / server restart: the room and seats were kept, the game was not.
  else if (ev.type === 'interrupted') fx.banner(`WE'RE BACK!\n${String(ev.game || 'The game').toUpperCase()} was cut short — pick it again`);
  else if (ev.type === 'ready') sfx.whoosh();
});

// --- loading card (TV) ---------------------------------------------------------
const loadingEl = document.createElement('div');
loadingEl.id = 'tv-loading';
loadingEl.className = 'tv-loading';
loadingEl.hidden = true;
document.body.appendChild(loadingEl);
/** @type {number | null} */
let loadingTimer = null;
/** @param {string} text */
function showLoading(text) {
  loadingEl.innerHTML = `<div class="spinner" aria-hidden="true"></div><p>${esc(text)}</p>`;
  loadingEl.hidden = false;
  if (loadingTimer) clearTimeout(loadingTimer);
  loadingTimer = window.setTimeout(hideLoading, 8000); // never hang on it
}
function hideLoading() {
  loadingEl.hidden = true;
  if (loadingTimer) clearTimeout(loadingTimer);
  loadingTimer = null;
}

// --- input --------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const kick = hit(e.target, '[data-kick]');
  if (kick) {
    const p = state && state.players.find((/** @type {any} */ x) => x.id === kick.dataset.kick);
    if (p && confirm(`Kick ${p.nickname}?`)) socket.emit('host:kickPlayer', { playerId: p.id });
    return;
  }
  const pickBtn = hit(e.target, '.game-pick');
  if (pickBtn && !pickBtn.disabled) {
    // Show a loading card until the game's first screen arrives (content is being drawn).
    const name = (pickBtn.querySelector('.game-name') || pickBtn).textContent || '';
    showLoading(`Loading ${name.trim()}…`);
    return socket.emit('host:startGame', { gameId: pickBtn.dataset.gameId });
  }
  const act = hit(e.target, '[data-act]');
  if (!act) return;
  if (act.dataset.act === 'skip') socket.emit('host:skip');
  if (act.dataset.act === 'picknext' || act.dataset.act === 'scores') { pickNext = act.dataset.act === 'picknext'; render(); }
  if (act.dataset.act === 'night') socket.emit('host:startNight', { count: +act.dataset.n });
  if (act.dataset.act === 'bots') socket.emit('host:addBots', { count: +act.dataset.n, speed: +(act.dataset.speed || 1) });
  if (act.dataset.act === 'nobots') socket.emit('host:removeBots');
  if (act.dataset.act === 'end' && confirm('End this game and go back to the menu?')) socket.emit('host:endGame');
  if (act.dataset.act === 'newroom' && confirm('Close this room and make a new one? Everyone will need to rejoin.')) {
    hostSeat(null);
    location.reload();
  }
});
document.addEventListener('change', (e) => {
  const t = /** @type {HTMLInputElement} */ (e.target);
  if (t.id === 'set-rounds') socket.emit('host:settings', { rounds: t.value === '' ? null : +t.value });
  else if (t.id === 'set-timer') socket.emit('host:settings', { timerScale: +t.value });
  else if (t.id === 'set-spicy') socket.emit('host:settings', { spicy: t.checked });
  else if (t.id === 'set-teams') socket.emit('host:settings', { teams: t.checked });
  else if (t.id === 'set-lang') socket.emit('host:settings', { lang: t.value });
  else if (t.id === 'set-narrator') window.Rumpus.host.setEnabled(t.checked);
  else if (t.id === 'set-voice') { window.Rumpus.host.setVoice(t.value); window.Rumpus.host.say(t.value === 'classic' ? 'Beep boop. Classic voice.' : t.value.startsWith('sys:') ? 'G\'day! I will be your host tonight.' : 'Hi! I will be your host tonight.'); }
  else if (t.id === 'set-cb') { store('rumpus.cb', t.checked); document.body.classList.toggle('cb', t.checked); }
});
fsBtn.addEventListener('click', () => {
  // Fullscreen can be refused (no user gesture, kiosk mode) — that's fine, just stay windowed.
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
});

// --- music moods ----------------------------------------------------------------

const isRevealPhase = (/** @type {any} */ p) => /reveal|result/.test(p);
function cueFor(/** @type {any} */ st) {
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
  if (p === 'lc-tune' || p === 'lc-song' || p === 'lc-compose') return 'silence'; // Loon Call plays its own beat
  return 'game:' + g.gameId;
}

// --- per-game stats for end-of-game awards -----------------------------------
/** @type {{ gameId: string, start: Map<string, number>, snaps: Map<string, number>[] } | null} per-game score history for the awards */
let gameStats = null;
/** @type {string | null} */
let leaderId = null;
function snapshotScores() { return new Map(state.players.map((/** @type {any} */ p) => [p.id, p.score])); }
function computeAwards() {
  if (!gameStats || !gameStats.snaps.length) return [];
  const snaps = [gameStats.start, ...gameStats.snaps];
  const players = state.players;
  const name = (/** @type {any} */ id) => (players.find((/** @type {any} */ p) => p.id === id) || {}).nickname;
  const avatar = (/** @type {any} */ id) => (players.find((/** @type {any} */ p) => p.id === id) || {}).avatar;
  const gains = new Map(players.map((/** @type {any} */ p) => [p.id, []]));
  for (let i = 1; i < snaps.length; i++) {
    for (const p of players) gains.get(p.id).push((snaps[i].get(p.id) || 0) - (snaps[i - 1].get(p.id) || 0));
  }
  const awards = [];
  const best = (/** @type {any} */ fn, min = 1) => {
    let top = null, v = -Infinity;
    for (const p of players) { const x = fn(p.id); if (x > v) { v = x; top = p.id; } }
    return v >= min ? { id: top, v } : null;
  };
  const clutch = best((/** @type {any} */ id) => { const g = gains.get(id); return g[g.length - 1] || 0; });
  if (clutch) awards.push({ title: 'CLUTCH', desc: `+${clutch.v} in the last round`, id: clutch.id });
  const consistent = best((/** @type {any} */ id) => gains.get(id).filter((/** @type {any} */ x) => x > 0).length, 2);
  if (consistent) awards.push({ title: 'MR. RELIABLE', desc: `scored in ${consistent.v} rounds`, id: consistent.id });
  const big = best((/** @type {any} */ id) => Math.max(0, ...gains.get(id)));
  if (big) awards.push({ title: 'BIG MOMENT', desc: `+${big.v} in one round`, id: big.id });
  // Biggest climb from the midpoint ranking to the final ranking.
  const mid = snaps[Math.floor(snaps.length / 2)];
  const rank = (/** @type {any} */ m) => { const ids = players.map((/** @type {any} */ p) => p.id).sort((/** @type {any} */ a, /** @type {any} */ b) => (m.get(b) || 0) - (m.get(a) || 0)); return (/** @type {any} */ id) => ids.indexOf(id); };
  const rMid = rank(mid), rEnd = rank(snaps[snaps.length - 1]);
  const climb = best((/** @type {any} */ id) => rMid(id) - rEnd(id));
  if (climb) awards.push({ title: 'COMEBACK KID', desc: `climbed ${climb.v} place${climb.v > 1 ? 's' : ''}`, id: climb.id });
  const last = players.slice().sort((/** @type {any} */ a, /** @type {any} */ b) => a.score - b.score)[0];
  if (last && players.length > 2) awards.push({ title: 'PARTICIPATION TROPHY', desc: 'there\'s always next game', id: last.id });
  // Don't give one person every award.
  const seen = new Map();
  return awards.filter((a) => { const n = (seen.get(a.id) || 0) + 1; seen.set(a.id, n); return n <= 2; })
    .map((a) => ({ ...a, name: name(a.id), avatar: avatar(a.id) }));
}

// --- rendering ----------------------------------------------------------------

const T = '<span class="timer"></span>';
// Each game's art is drawn at 4× its own pixel size, on its own colour theme.
/** @type {Record<string, string>} */
const ART_BG = {
  quiplash: '#3b1f5e', fibbage: '#5a3b22', trivia: '#1d2b5c', closest: '#173d2a', majority: '#2b5f8f',
  mostlikely: '#5c1d3e', imposter: '#3d4a1d', twotruths: '#24324a', telephone: '#4a3a12', cah: '#1a1423', minigames: '#123d4f', looncall: '#0f2a3d', lantern: '#13284a', storm: '#141a2e',
};
const art = (/** @type {any} */ id) => {
  const u = sprites.iconUrl(id);
  if (!u) return '';
  const [w, h] = sprites.iconSize(id);
  return `<div class="game-art" style="--art-bg:${ART_BG[id] || '#2f2850'}"><img src="${u}" width="${w * 4}" height="${h * 4}" alt=""></div>`;
};

function gamePicker(/** @type {any} */ label) {
  const count = state.players.length;
  const st = state.settings || {};
  const opt = (/** @type {any} */ v, /** @type {any} */ cur, /** @type {any} */ text) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${text}</option>`;
  // Each player in the lobby: their picture, an asleep/relay marker, and a ✕ to kick them.
  const fig = (/** @type {any} */ p) => `<figure class="${[p.team ? 'team-' + p.team : '', p.connected ? '' : 'offline'].join(' ')}">${playerImg(p, 'avatar big bob')}${esc(p.nickname)}${p.connected ? '' : ' <small>💤</small>'}${p.net === 'relay' ? ' <small title="Connected through the internet (slower) — same Wi-Fi?">🌐</small>' : ''}<button class="kick lobby-kick" data-kick="${esc(p.id)}" title="Kick ${esc(p.nickname)}" aria-label="Kick ${esc(p.nickname)}">✕</button></figure>`;
  const crew = st.teams
    ? ['red', 'blue'].map((t) => `<div class="team-col team-${t}"><b>${t === 'red' ? '🔴 RED' : '🔵 BLUE'}</b>${state.players.filter((/** @type {any} */ p) => p.team === t).map(fig).join('')}</div>`).join('')
    : state.players.map(fig).join('');
  const max = state.maxPlayers || 12;
  // One join card: QR + room code + address together (nothing else on screen repeats them).
  const joinCard = roomCode ? `<div class="join-card">
      <img class="qr-big" src="${window.Rumpus.qrSrc(joinUrl(true))}" alt="QR code to join">
      <div class="join-text">
        <span class="join-label">Scan or go to</span>
        <span class="join-addr">${esc(joinUrl(false).replace(/^https?:\/\//, ''))}</span>
        <span class="join-label">Room code</span>
        <span class="join-code">${esc(roomCode)}</span>
        <span class="join-count">${count ? `${count}/${max} joined` : 'Nobody here yet'}</span>
      </div>
    </div>` : '';
  // One screen, no scrolling: games fill the space left of the join card + players column; the
  // settings sit in a compact bar underneath (public/style.css ".game-menu").
  const settings = `<div class="settings">
          <label>Rounds <select id="set-rounds">${opt('', st.rounds == null ? '' : st.rounds, 'Default')}
            ${[3, 5, 8, 10].map((n) => opt(n, st.rounds, n)).join('')}</select></label>
          <label>Timers <select id="set-timer">${opt(0.6, st.timerScale, 'Fast')}${opt(1, st.timerScale, 'Normal')}
            ${opt(1.5, st.timerScale, 'Relaxed')}${opt(2, st.timerScale, 'Extra slow')}</select></label>
          <label class="toggle ${st.spicy !== false ? 'spicy-on' : ''}"><input type="checkbox" id="set-spicy" ${st.spicy !== false ? 'checked' : ''}> 🌶 18+</label>
          <label class="toggle ${st.teams ? 'teams-on' : ''}"><input type="checkbox" id="set-teams" ${st.teams ? 'checked' : ''}> 👥 Teams</label>
          <label class="toggle"><input type="checkbox" id="set-cb" ${document.body.classList.contains('cb') ? 'checked' : ''}> 👁 Colour-blind</label>
          <label>🌐 <select id="set-lang">${opt('en', st.lang || 'en', 'English')}${opt('fr', st.lang || 'en', 'Français')}</select></label>
          <label class="toggle"><input type="checkbox" id="set-narrator" ${window.Rumpus.host.isEnabled() ? 'checked' : ''}> 🗣 Narrator</label>
          <label>🎙 <select id="set-voice">${window.Rumpus.host.voices().map((/** @type {string[]} */ v) => (v[2] ? `<option disabled>${esc(v[1])}</option>` : opt(esc(v[0]), esc(window.Rumpus.host.voice()), esc(v[1])))).join('')}</select> <small id="voice-status" class="voice-status">${window.Rumpus.host.voiceStatus()}</small></label>
          <a class="hl-link" href="/admin" target="_blank">⚙ House rules</a> <a class="hl-link" href="/highlights" target="_blank">🏆 Hall of fame</a>
          <button class="link-btn" data-act="newroom">Fresh room</button>
          ${TEST_TOOLS ? `<span class="bot-tools">🤖 <button data-act="bots" data-n="1">+1 bot</button><button data-act="bots" data-n="3">+3</button>
            <button data-act="bots" data-n="3" data-speed="8">+3 fast</button>${state.players.some((/** @type {any} */ p) => p.bot) ? '<button data-act="nobots">Remove bots</button>' : ''}</span>` : ''}
        </div>`;
  return `<div class="game-menu">
      <div class="lobby-top">
        <h1>${label}</h1>
        <div class="night-row">🎉 <b>Game night</b> <span class="night-what">— a playlist your phones vote on:</span>
          ${[3, 5, 7].map((n) => `<button data-act="night" data-n="${n}" ${count < 2 ? 'disabled' : ''}>${n} games</button>`).join('')}
          ${state.phase === 'gameover' ? '<button data-act="scores" class="ghost">◀ Scores</button>' : ''}</div>
      </div>
      <div class="game-grid">` +
    (state.availableGames || []).map((/** @type {any} */ gm) => {
      const disabled = count < gm.minPlayers;
      return `<button class="game-pick" data-game-id="${esc(gm.id)}" ${disabled ? 'disabled' : ''}>
        ${art(gm.id)}
        <span class="game-text">
          <span class="game-name">${esc(gm.name)}</span>
          <span class="game-blurb">${esc(gm.blurb)}</span>
          <span class="game-min">${disabled ? `Needs ${gm.minPlayers}+ players` : `${gm.minPlayers}+ players`}</span>
          ${st.lang === 'fr' && !FRENCH_GAMES.includes(gm.id) ? '<span class="game-lang" title="Questions in English">EN</span>' : ''}
        </span>
      </button>`;
    }).join('') + `</div>
      <aside class="lobby-side">
        ${joinCard}
        <div class="lobby-crew ${st.teams ? 'teams' : ''}" style="--rows:${Math.max(1, st.teams ? Math.ceil(Math.max(...['red', 'blue'].map((t) => state.players.filter((/** @type {any} */ p) => p.team === t).length)) / 2) : Math.ceil(count / 4))}">${crew || '<p class="hint">Scan the code with your phone to join.</p>'}</div>
      </aside>
      ${settings}
    </div>`;
}

function podium(/** @type {any} */ standings) {
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
  (standings.length > 3 ? '<ol class="answers standings" start="4">' + standings.slice(3).map((/** @type {any} */ s) =>
    `<li>${av(s.nickname)} ${esc(s.nickname)} <span class="votes">${s.score}</span></li>`).join('') + '</ol>' : '');
}

const voterIcons = (/** @type {any} */ names) => names && names.length
  ? `<span class="voters">${names.map((/** @type {any} */ n) => av(n)).join('')}</span>` : '';

// The original four games' screens.
function legacyHost(/** @type {any} */ phase, /** @type {any} */ g) {
  const roundTag = g.round ? `<p class="round-tag">Question ${g.round} of ${g.totalRounds}${g.multiplier > 1 ? `<span class="double-badge">${g.multiplier}× POINTS</span>` : ''}</p>` : '';
  switch (phase) {
    case 'trivia-category':
      return `<p class="round-tag">Category round</p>
        <h1>${av(g.chooser, 'avatar big bob')} ${esc(g.chooser)} is in last place…</h1>
        <p class="big-sub">…so they pick the next category! ${T}</p>
        <div class="cat-card">${g.categoryOptions.map((/** @type {any} */ c) => `<div>${esc(c)}</div>`).join('')}</div>`;
    case 'trivia-question':
      return `${roundTag}${g.category ? `<span class="cat-banner">${esc(g.category)}</span>` : ''}<h1 class="prompt">${esc(g.question)}</h1>
        <p class="big-sub">Fast answers score more! ${T}</p>
        <ol class="answers">${g.choices.map((/** @type {any} */ c) => `<li>${esc(c)}</li>`).join('')}</ol>
        <p class="count">${g.answeredCount} / ${g.totalPlayers} answers in</p>`;
    case 'trivia-reveal':
      return `${roundTag}<h1 class="prompt">${esc(g.question)}</h1><ol class="answers results">` +
        g.choices.map((/** @type {any} */ c, /** @type {any} */ i) => `<li class="${i === g.correct ? 'winner' : ''}">${esc(c)}</li>`).join('') +
        '</ol><ul class="scored-list">' +
        g.scored.map((/** @type {any} */ s) => `<li class="${s.correct ? 'correct' : 'wrong'}">${av(s.nickname)} ${esc(s.nickname)} ${s.correct ? `+${s.gained}` : `✗${s.gained < 0 ? ` ${s.gained}` : ''}`}${s.double ? ' <span class="streak">🎲 DOUBLE DOWN</span>' : ''}${s.streak > 1 ? ` <span class="streak">🔥×${s.streak}</span>` : ''}</li>`).join('') + '</ul>';
    case 'cah-submit':
      return `${roundTag}<p class="round-tag">Card Czar: ${av(g.czarNickname)} ${esc(g.czarNickname)}${g.pickedBy ? ` · prompt chosen by ${av(g.pickedBy)} ${esc(g.pickedBy)}` : ''}</p>
        <h1 class="prompt">${esc(g.blackCard)}</h1><p class="big-sub">Everyone else, play your worst card!</p>
        <p class="count">${g.submittedCount} / ${g.neededCount} cards in</p>`;
    case 'cah-czar':
      return `${roundTag}<p class="round-tag">Card Czar: ${av(g.czarNickname)} ${esc(g.czarNickname)}</p>
        <h1 class="prompt">${esc(g.blackCard)}</h1><p class="big-sub">${esc(g.czarNickname)} is picking a winner…</p>
        <ol class="answers">${g.submissions.map((/** @type {any} */ s) => `<li>${esc(s.text)}</li>`).join('')}</ol>`;
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
        <ol class="answers">${g.options.map((/** @type {any} */ o) => `<li>${esc(o.text)}</li>`).join('')}</ol>
        <p class="count">${g.pickedCount} / ${g.totalPlayers} guesses in</p>`;
    case 'fib-reveal':
      return `${roundTag}<h1 class="prompt">${esc(g.prompt)}</h1><ol class="answers results">` +
        g.result.options.map((/** @type {any} */ o) => `<li class="${o.isTruth ? 'winner' : ''}">${esc(o.text)}
          <span class="byline">${o.isTruth ? '— THE TRUTH!' : (o.authors.length ? '— ' + o.authors.map((/** @type {any} */ n) => av(n) + ' ' + esc(n)).join(', ') + '\'s lie' : '')}</span>
          ${o.pickedBy.length ? `<span class="votes">${o.isTruth ? 'found by' : 'fooled'}</span>${voterIcons(o.pickedBy)}` : ''}
          ${o.likes ? `<span class="votes likes">👍 ${o.likes}</span>` : ''}</li>`).join('') +
        '</ol>' + window.Rumpus.scoredList(g.result.scored);
    default:
      return null;
  }
}

function renderSidebar(/** @type {any} */ phase) {
  const sorted = state.players.slice();
  if (phase !== 'lobby') sorted.sort((/** @type {any} */ a, /** @type {any} */ b) => b.score - a.score);
  const ts = state.teamScores;
  const teamBar = /** @type {HTMLElement} */ (document.getElementById('team-bar'));
  if (ts) {
    const total = Math.max(1, ts.red + ts.blue);
    teamBar.hidden = false;
    morph(teamBar, `<div class="tb red" style="flex:${Math.max(0.15, ts.red / total)}">🔴 ${ts.red}</div><div class="tb blue" style="flex:${Math.max(0.15, ts.blue / total)}">${ts.blue} 🔵</div>`);
  } else teamBar.hidden = true;
  morph(playerList, sorted.map((/** @type {any} */ p, /** @type {any} */ i) => {
    const cls = [!p.connected && 'offline', i === 0 && p.score > 0 && phase !== 'lobby' && 'leader'].filter(Boolean).join(' ');
    return `<li data-id="${esc(p.id)}" class="${cls}${p.team ? ' team-' + p.team : ''}">${playerImg(p)}` +
      `<span class="pname">${esc(p.nickname)}${p.connected ? '' : ' <small>(zzz)</small>'}${p.net === 'relay' ? ' <small title="Connected through the internet (slower)">🌐</small>' : ''}</span>` +
      `<span class="pscore">${p.score}</span><button class="kick" data-kick="${esc(p.id)}" title="Kick ${esc(p.nickname)}">✕</button></li>`;
  }).join(''));
  // Score pop-ups
  for (const p of state.players) {
    const before = prevScores.get(p.id);
    if (before != null && p.score > before) {
      fx.scorePop(playerList.querySelector(`li[data-id="${p.id}"] .pscore`), p.score - before);
    }
  }
  prevScores = new Map(state.players.map((/** @type {any} */ p) => [p.id, p.score]));
}

function updateTimerBar(/** @type {any} */ endsAt) {
  if (!endsAt) { timerbar.hidden = true; return; }
  if (timerTotal.endsAt !== endsAt) timerTotal = { endsAt, total: Math.max(1000, endsAt - window.Rumpus.time.now()) };
  timerbar.hidden = false;
}
// Timer bar drains smoothly on the shared 30 fps clock (transform, not width:
// no layout work per frame).
clock.add(() => {
  if (timerbar.hidden || !timerTotal.endsAt) return;
  const left = Math.max(0, timerTotal.endsAt - window.Rumpus.time.now());
  /** @type {HTMLElement} */ (timerbar.firstElementChild).style.transform = `scaleX(${(left / timerTotal.total).toFixed(4)})`;
  timerbar.classList.toggle('urgent', left < 5000);
});

function render() {
  window.Rumpus.i18n.setLang(state && state.settings && state.settings.lang);
  if (!state) return;
  const g = state.gameState || {};
  const phase = state.phase;
  if (phase !== 'lobby' && phase !== 'gameover' && !loadingEl.hidden) hideLoading();

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
  // Storm Watch takes over the whole screen with its own frame.
  document.body.classList.toggle('mode-storm', inGame && g.gameId === 'storm');
  document.body.classList.toggle('lobby', phase === 'lobby'); // the lobby shows the players itself
  if (phase !== 'gameover') pickNext = false;
  // The game menu is on screen (lobby, or "choose the next game" after the scores): fixed layout, no scrolling.
  document.body.classList.toggle('picking', phase === 'lobby' || (phase === 'gameover' && pickNext && !state.night));
  if (!inGame || !wasInGame) { if (sidebarTimer) clearTimeout(sidebarTimer); document.body.classList.remove('sidebar-peek'); }
  // Someone joined, left or (re)connected → flash the player strip for 5 s.
  const roster = state.players.map((/** @type {any} */ p) => p.id + (p.connected ? '+' : '-')).sort().join(',');
  if (inGame && wasInGame && roster !== rosterKey) peekSidebar();
  rosterKey = roster;
  controls.hidden = !inGame;
  const pc = state.pace || { counts: {}, need: 0 };
  const paceTxt = ['skipq', 'hurry', 'wrap', 'ready'].filter((k) => pc.counts[k]).map((k) =>
    `<span class="pace-pill">${{ skipq: '🔄 skip', hurry: '⏩ hurry', wrap: '⏭ end round', ready: '▶ next' }[k]} ${pc.counts[k]}/${pc.need}</span>`).join('');
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
      `<p class="hint">📸 Best moments &amp; hall of fame: <span class="hl-link">${esc(joinUrl(false).replace(/^https?:\/\//, '').replace(/\/play$/, '/highlights'))}</span></p>` +
      (state.night ? window.Rumpus.nightTable(state.night, true) : '<p class="next-row"><button data-act="picknext" class="next-game-btn">🎮 Choose the next game</button></p>');
    // The picker takes the whole screen (it never scrolls): one press swaps the scores for it.
    if (pickNext && !state.night) html = gamePicker('Play again?');
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
      // Storm Watch is its own mode: a storm rolls in before the title card.
      if (g.gameId === 'storm') { window.Rumpus.stormTransition(); setTimeout(() => showIntro(g.gameId), 3400); } else showIntro(g.gameId);
      music.play('intro', { then: cueFor(state) });
      narrateIntro(g.gameId);
    } else if (phase === 'gameover') {
      sfx.win(); fx.confetti(240);
      const champ = (g.standings || [])[0];
      if (champ && champ.score > 0) { window.Rumpus.host.cheer(); window.Rumpus.host.say(`${champ.nickname} wins with ${champ.score} points!`); }
      music.play('victory', { then: 'scoreboard' });
      lastAwards.forEach((a, i) => setTimeout(() => sfx.award(), 1000 + i * 500));
    } else {
      music.setIntensity(g.multiplier === 2 ? 2 : 1);
      music.play(cueFor(state));
      narratePrompt(g);
      // Games with their own narration (spell duels, hidden roles, the dock reveal…) give Rocco a line.
      const impl = window.Rumpus.games[g.gameId];
      const line = impl && impl.narrate ? impl.narrate(state) : null;
      if (line) setTimeout(() => window.Rumpus.host.say(line), 400);
      // …and big moments: a shake (and confetti) timed to the reveal.
      const m = impl && impl.moment ? impl.moment(state) : null;
      if (m && m.shakeAt != null) fx.shake(m.shakeAt);
      if (m && m.confettiAt != null) setTimeout(() => fx.confetti(120), m.confettiAt);
      if (isRevealPhase(phase)) {
        window.Rumpus.host.cheer();
        if (['cg-reveal', 'mr-reveal', 'ml-reveal'].includes(phase)) sfx.drumroll();
        else sfx.reveal();
        shake();
        if (gameStats) gameStats.snaps.push(snapshotScores());
      } else if (inGame) sfx.phase();
      if (phase === 'cah-reveal' || (phase === 'results' && g.result && g.result.sides.some((/** @type {any} */ sd) => sd.shutout))) fx.confetti(90);
      if (phase === 'results' && g.result && g.result.sides.some((/** @type {any} */ sd) => sd.shutout)) fx.banner('SHUTOUT!', 'gold');
      if (phase === 'trivia-category') fx.banner('CATEGORY ROUND!', 'gold');
      if (phase === 'cg-reveal' && g.result && g.result.list.some((/** @type {any} */ e) => e.exact)) { fx.banner('BULLSEYE!', 'gold'); fx.confetti(120); }
      if (phase === 'imp-reveal' && g.result) fx.banner(g.result.outcome === 'caught' ? 'GOTCHA!' : g.result.outcome === 'stole' ? 'STOLEN!' : 'GOT AWAY!', g.result.outcome === 'caught' ? 'gold' : '');
    }
    // Lead change alert (only mid-game, only when the leader actually changes).
    if (inGame && isRevealPhase(phase)) {
      const top = state.players.slice().sort((/** @type {any} */ a, /** @type {any} */ b) => b.score - a.score)[0];
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
        phaseView.innerHTML = pendingHtml || '';
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
  const srcEl = /** @type {HTMLElement} */ (document.getElementById('source-line'));
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
  phaseView.style.setProperty('--shrink', '1');
  fitAll(phaseView);
  shrinkToStage();
}

/** Never scroll during a game: if the screen's content is taller than the stage (long answers,
 * many players), scale it down until it fits (CSS zoom keeps it crisp and re-flows the text). */
function shrinkToStage() {
  const stage = /** @type {HTMLElement} */ (document.getElementById('stage'));
  const fits = () => stage.scrollHeight - stage.clientHeight <= 1;
  let z = 1;
  if (!fits()) {
    // Binary search for the biggest zoom that fits (gaps and padding don't scale, so ratios alone undershoot).
    let lo = 0.45, hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      phaseView.style.setProperty('--shrink', mid.toFixed(3));
      if (fits()) lo = mid; else hi = mid;
    }
    z = lo;
    phaseView.style.setProperty('--shrink', z.toFixed(3));
  }
  phaseView.classList.toggle('shrunk', z < 1);
}
window.addEventListener('resize', () => layoutStage());
// Refit when the stage changes size (sidebar sliding away, fonts loading, …).
let lastStageW = 0;
new ResizeObserver(() => {
  const w = phaseView.clientWidth;
  if (Math.abs(w - lastStageW) > 4) { lastStageW = w; layoutStage(); }
}).observe(phaseView);
if (document.fonts) void document.fonts.ready.then(() => layoutStage());
// Avatars and drawings load after the screen is laid out and make it taller: fit again once they're in.
/** @type {number | null} */
let refitTimer = null;
phaseView.addEventListener('load', () => {
  if (refitTimer) return;
  refitTimer = window.setTimeout(() => { refitTimer = null; layoutStage(); }, 50);
}, true);

function tick(/** @type {any} */ left) {
  if (left > 0 && left <= 5) sfx.tick();
  const inputish = state && !/lobby|gameover|reveal|results/.test(state.phase);
  music.setHurry(inputish && left > 0 && left <= 10);
}

function shake() {
  const st = /** @type {HTMLElement} */ (document.getElementById('stage'));
  st.classList.remove('shake'); void st.offsetWidth; st.classList.add('shake');
}

// The lobby shows what the narrator will really sound like (loading / ready / too slow → robot).
document.addEventListener('cf:voice', (e) => {
  const el = document.getElementById('voice-status');
  if (el) el.textContent = /** @type {CustomEvent} */ (e).detail || '';
});
// The browser's own voices arrive a moment after the page loads: refresh the 🎙 list when they do.
document.addEventListener('cf:voices', () => { if (state && document.body.classList.contains('picking') && document.activeElement !== document.getElementById('set-voice')) render(); });
