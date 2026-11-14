/* Rumpus player (phone) view — renderer of room:stateUpdate. AGPLv3, see LICENSE. */
'use strict';


const { esc, store, countdown, games, sprites, morph, playerImg , hit } = window.Rumpus;
// Everyone is on the same Wi-Fi: open a WebSocket straight away (no long-polling warm-up; polling
// only if a WebSocket can't be made), and reconnect quickly (a phone waking up should be back in a
// second or two, not five).
const socket = io({ transports: ['websocket', 'polling'], tryAllTransports: true, reconnectionDelay: 400, reconnectionDelayMax: 3000 });
window.Rumpus.time.sync(socket);

// This phone's own id, made once and kept: rejoining from any tab (or after the seat was lost)
// always gives back the same player.
// (Tab-to-tab mode, ?net=local, plays several phones in one browser: there each tab is a phone.)
const DEVICE = (() => {
  /** @type {Storage | null} */
  let tabs = null;
  try {
    const net = new URLSearchParams(location.search).get('net') || sessionStorage.getItem('cf.net');
    const local = net === 'local' || net === 'rtc-local'; // test modes: several phones in one browser
    if (local) tabs = sessionStorage;
  } catch (e) { /* storage blocked */ }
  let d = tabs ? tabs.getItem('cf.device') : store('cf.device');
  if (typeof d !== 'string' || !/^[\w-]{8,64}$/.test(d)) {
    d = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^\w-]/g, '');
    if (tabs) tabs.setItem('cf.device', d); else store('cf.device', d);
  }
  return /** @type {string} */ (d);
})();

const joinView = /** @type {HTMLElement} */ (document.getElementById('join-view'));
const gameView = /** @type {HTMLElement} */ (document.getElementById('game-view'));
const joinForm = /** @type {HTMLElement} */ (document.getElementById('join-form'));
const joinError = /** @type {HTMLElement} */ (document.getElementById('join-error'));
const meTag = /** @type {HTMLElement} */ (document.getElementById('me-tag'));
const codeInput = /** @type {HTMLInputElement} */ (document.getElementById('code-input'));
const nickInput = /** @type {HTMLInputElement} */ (document.getElementById('nick-input'));
const banner = /** @type {HTMLElement} */ (document.getElementById('banner'));
const leaveBtn = /** @type {HTMLElement} */ (document.getElementById('leave-btn'));
const reactBar = /** @type {HTMLElement} */ (document.getElementById('react-bar'));

// No zooming or copying on the phone: pinch / double-tap zoom and the long-press menu only get in
// the way of fast taps (iOS ignores user-scalable=no, so stop its gestures here). The Aa button
// below is the way to make text bigger. (Double-tap zoom is off via CSS touch-action, which keeps
// rapid taps working — a touchend handler would swallow every second tap of a mash game.)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => { const t = /** @type {any} */ (e.target); if (!(t && t.closest && t.closest('input, textarea'))) e.preventDefault(); });
document.addEventListener('selectstart', (e) => { const t = /** @type {any} */ (e.target); if (!(t && t.closest && t.closest('input, textarea'))) e.preventDefault(); });

// Text size (accessibility): 100% → 120% → 140%, remembered on this phone.
const SIZES = [1, 1.2, 1.4];
let sizeIx = Math.max(0, SIZES.indexOf(Number(store('rumpus.textSize')) || 1));
const applySize = () => document.body.style.setProperty('--phone-scale', String(SIZES[sizeIx]));
applySize();
/** @type {HTMLElement} */ (document.getElementById('text-size')).addEventListener('click', () => {
  sizeIx = (sizeIx + 1) % SIZES.length;
  store('rumpus.textSize', SIZES[sizeIx]);
  applySize();
});
// Colour-blind friendly palette (Okabe–Ito), remembered on this phone.
const cbBtn = /** @type {HTMLElement} */ (document.getElementById('cb-btn'));
const applyCb = (/** @type {boolean} */ on) => { document.body.classList.toggle('cb', on); cbBtn.setAttribute('aria-pressed', String(on)); };
applyCb(store('rumpus.cb') === true);
cbBtn.addEventListener('click', () => { const on = !document.body.classList.contains('cb'); store('rumpus.cb', on); applyCb(on); });
// Installable app (PWA): offline-friendly reloads on the phone.
// (Browsers only allow service workers on https or localhost; on a plain-http LAN this quietly does nothing.)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
const avatarPick = /** @type {HTMLElement} */ (document.getElementById('avatar-pick'));

window.Rumpus.background(document.getElementById('bg'), { fps: 4 });

// --- avatar picker (join form) ---------------------------------------------
let myAvatar = store('rumpus.avatar');
if (!Number.isInteger(myAvatar)) myAvatar = Math.floor(Math.random() * sprites.count);
function avatarGrid(/** @type {any} */ selected, taken = new Set()) {
  return sprites.AVATARS.map((/** @type {any} */ a, /** @type {any} */ i) =>
    `<button type="button" class="${i === selected ? 'on' : ''}" data-avatar="${i}" title="${a.name}" ${taken.has(i) && i !== selected ? 'disabled' : ''}>
      <img src="${sprites.avatarUrl(i)}" alt="${a.name}"></button>`).join('');
}
avatarPick.innerHTML = avatarGrid(myAvatar);

// --- make your character (default) or pick an animal ----------------------
const maker = window.Rumpus.avatarMaker;
let myLook = store('rumpus.look') ? maker.norm(store('rumpus.look')) : maker.random(); // migrates older saved looks
let avatarMode = store('rumpus.avatarMode') === 'pick' ? 'pick' : 'make';
const avatarMake = /** @type {HTMLElement} */ (document.getElementById('avatar-make'));
// Join page: just the picture, Random and Undo; the presets and part tabs open with "Customise".
maker.editor(avatarMake, myLook, (/** @type {any} */ l) => { myLook = l; store('rumpus.look', l); }, { open: false });
function setAvatarMode(/** @type {any} */ mode) {
  avatarMode = mode;
  store('rumpus.avatarMode', mode);
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.avatar-mode [data-mode]')).forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === mode);
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });
  avatarMake.hidden = mode !== 'make';
  avatarPick.hidden = mode !== 'pick';
}
/** @type {HTMLElement} */ (document.querySelector('.avatar-mode')).addEventListener('click', (e) => {
  const b = hit(e.target, '[data-mode]');
  if (b) setAvatarMode(b.dataset.mode);
});
setAvatarMode(avatarMode);

// Change your look from the lobby: your character, or a pixel animal (one panel, two modes).
const lobbyMaker = /** @type {HTMLElement} */ (document.getElementById('lobby-maker'));
const lobbyAnimals = /** @type {HTMLElement} */ (document.getElementById('lobby-animals'));
const lobbyBox = /** @type {HTMLElement} */ (document.getElementById('lobby-maker-box'));
let lobbyMakerReady = false;
let lobbyMode = 'make';
/** Show the character maker or the animal grid in the lobby panel. @param {string} mode */
function setLobbyMode(mode) {
  lobbyMode = mode;
  /** @type {NodeListOf<HTMLElement>} */ (lobbyMaker.querySelectorAll('[data-lobby-mode]')).forEach((b) => {
    b.classList.toggle('on', b.dataset.lobbyMode === mode);
    b.setAttribute('aria-pressed', String(b.dataset.lobbyMode === mode));
  });
  if (mode === 'make' && !lobbyMakerReady) { maker.editor(lobbyBox, myLook, (/** @type {any} */ l) => { myLook = l; store('rumpus.look', l); }, { toggle: false }); lobbyMakerReady = true; }
  lobbyBox.hidden = mode !== 'make';
  lobbyAnimals.hidden = mode !== 'pick';
  if (mode === 'pick') renderLobbyAnimals();
}
function renderLobbyAnimals() {
  if (!state) return;
  const myId = me ? me.playerId : null;
  const taken = new Set(state.players.filter((/** @type {any} */ p) => p.id !== myId).map((/** @type {any} */ p) => p.avatar));
  const mine = (state.players.find((/** @type {any} */ p) => p.id === myId) || {}).avatar;
  lobbyAnimals.innerHTML = avatarGrid(mine, taken);
}
lobbyMaker.addEventListener('click', (e) => {
  const m = hit(e.target, '[data-lobby-mode]');
  if (m) { setLobbyMode(m.dataset.lobbyMode || 'make'); return; }
  const av = hit(e.target, '.lobby-pick [data-avatar]');
  if (av && !av.disabled) {
    store('rumpus.avatar', +av.dataset.avatar);
    socket.emit('player:look', { look: null }); // back to the pixel animal
    socket.emit('player:avatar', { avatar: +av.dataset.avatar });
  }
});
/** @type {HTMLElement} */ (document.getElementById('lobby-maker-save')).addEventListener('click', () => {
  if (lobbyMode === 'make') socket.emit('player:look', { look: myLook });
  lobbyMaker.hidden = true;
});
avatarPick.addEventListener('click', (e) => {
  const b = hit(e.target, '[data-avatar]');
  if (!b) return;
  myAvatar = +b.dataset.avatar;
  store('rumpus.avatar', myAvatar);
  avatarPick.innerHTML = avatarGrid(myAvatar);
});

// --- reactions ----------------------------------------------------------------
const REACTIONS = ['😂', '🔥', '💀', '👏', '😱', '🤮', '😍', '🍆', '🍑', '🍻', '🙄', '🤡'];
/** @type {Record<string, string>} */
const REACT_NAMES = { '😂': 'laughing', '🔥': 'fire', '💀': 'dead', '👏': 'applause', '😱': 'shocked', '🤮': 'gross', '😍': 'love it', '🍆': 'eggplant', '🍑': 'peach', '🍻': 'cheers', '🙄': 'eye roll', '🤡': 'clown' };
reactBar.innerHTML = REACTIONS.map((r) => `<button data-react="${r}" aria-label="React: ${REACT_NAMES[r] || r}">${r}</button>`).join('');
reactBar.addEventListener('click', (e) => {
  const b = hit(e.target, '[data-react]');
  if (!b) return;
  socket.emit('player:react', { emoji: b.dataset.react });
  window.Rumpus.haptic(15);
});

/** @type {{ playerId: string } | null} */
let me = null;
/** The seat this tab holds right now (code + key), for reconnecting as the same player. @type {{ code: string, token: string } | null} */
let mySeat = null;
// The browser build asks before reloading for an update (web/offline.js): not once you have a seat.
/** @type {any} */ (window).cfBusy = () => !!me;
/** Latest room:stateUpdate from the server (plain JSON, shape varies by game). @type {any} */
let state = null;
/** @type {string | null} */
let lastHtml = null;
/** @type {(() => void)[]} */
let cleanups = [];
let ended = false;
/** @type {string | null} */
let lastScreenKey = null;

// Delegated input handling: works for nodes added later by morph().
// ---- Tap feedback (every button): a quick squish + flash you can see, and a buzz you can feel. ----
document.addEventListener('pointerdown', (e) => {
  const b = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('button, .toggle') : null);
  if (!b || /** @type {HTMLButtonElement} */ (b).disabled) return;
  b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap'); // restart the animation
  if (!b.matches('[data-send], [data-react]')) window.Rumpus.haptic(8); // (answers and reactions buzz on their own)
}, { passive: true });
document.addEventListener('animationend', (e) => { if (e.target instanceof Element && e.animationName === 'tap-pop') e.target.classList.remove('tap'); });
/** A form's answer didn't make sense (empty, not a number): shake it and buzz twice. @param {HTMLElement} el */
function nope(el) {
  el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope');
  window.Rumpus.haptic([20, 60, 20]);
}
gameView.addEventListener('invalid', (e) => { if (e.target instanceof HTMLElement) nope(/** @type {HTMLElement} */ (e.target.closest('form') || e.target)); }, true);
/** The form's button shows it went: ✓ Sent. @param {HTMLFormElement} f */
const formSent = (f) => {
  const btn = f.querySelector('button[type=submit], button:not([type])');
  if (btn && /** @type {HTMLElement} */ (btn).dataset) { btn.classList.add('sent'); /** @type {HTMLElement} */ (btn).dataset.label = btn.textContent || ''; btn.textContent = '✓ Sent'; }
  window.Rumpus.haptic(12);
};
gameView.addEventListener('submit', (e) => {
  const f = /** @type {HTMLFormElement} */ (e.target);
  const input = /** @type {HTMLInputElement | null} */ (f.querySelector('input'));
  if (!input) return;
  // Already sent (a double tap, Enter + the button): once is enough — the ack gives it back if it failed.
  if (f.querySelector('button.sent')) { e.preventDefault(); return; }
  if (f.matches('form.text-form')) {
    e.preventDefault();
    const v = input.value;
    // Which prompt this answers (Campfire Quips asks two in a row): the TV never files it under the next one.
    const g = (state && state.gameState) || {};
    if (v.trim()) { formSent(f); send(Number.isInteger(g.slot) ? { text: v, slot: g.slot } : { text: v }); } else nope(f);
  } else if (f.matches('form.number-form')) {
    e.preventDefault();
    const n = parseFloat(input.value.replace(/,/g, ''));
    if (Number.isFinite(n)) { formSent(f); send(document.querySelector('#game-view [data-dd][aria-pressed="true"]') ? { number: n, double: true } : { number: n }); } else nope(f);
  }
});
gameView.addEventListener('click', (e) => {
  const tb = hit(e.target, '[data-team]');
  if (tb) { socket.emit('player:team', { team: tb.dataset.team }); return; }
  if (hit(e.target, '[data-shy]')) { window.Rumpus.haptic(10); socket.emit('player:prefs', { shy: !(state && state.you && state.you.shy) }); return; }
  const rate = hit(e.target, '[data-rate]');
  if (rate) { window.Rumpus.haptic(10); socket.emit('player:rate', { score: +(rate.dataset.rate || 0) }); return; }
  if (hit(e.target, '[data-lobby-maker]')) {
    lobbyMaker.hidden = false;
    const p = state && state.players.find((/** @type {any} */ x) => x.id === (me && me.playerId));
    setLobbyMode(p && !p.look ? 'pick' : 'make'); // open on what they use now
    lobbyMaker.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const dd = hit(e.target, '[data-dd]');
  if (dd) { const on = dd.getAttribute('aria-pressed') !== 'true'; dd.setAttribute('aria-pressed', String(on)); dd.classList.toggle('on', on); return; }
  const b = hit(e.target, '[data-send]');
  if (!b || b.disabled) return;
  window.Rumpus.haptic(12); // every answer tap is felt
  b.classList.add('sent');
  for (const x of /** @type {NodeListOf<HTMLButtonElement>} */ (gameView.querySelectorAll('[data-send]'))) x.disabled = true;
  const payload = JSON.parse(b.dataset.send);
  const ddOn = gameView.querySelector('[data-dd][aria-pressed="true"]');
  if (ddOn) payload.double = true;
  send(payload);
});

// Prefill from QR link (?code=ABCD) and from last time.
const params = new URLSearchParams(location.search);
if (params.get('code')) codeInput.value = String(params.get('code')).toUpperCase().slice(0, 4);
// ?seat=CODE.TOKEN: the same seat on the other address (http ↔ https for tilt controls).
const seatParam = /^([A-Z]{4})\.([0-9a-f]{16,64})$/.exec(params.get('seat') || '');
if (seatParam) {
  store('rumpus.seat', { code: seatParam[1], token: seatParam[2] });
  history.replaceState(null, '', '/play');
}
nickInput.value = store('rumpus.nick') || '';
if (codeInput.value && !nickInput.value) setTimeout(() => nickInput.focus(), 50);

/** Ask for a seat. `takeover`: "that name is me" — move my seat here from wherever it is open
 * (a private window or another browser has no saved seat to show for it). @param {boolean} [takeover] */
function askToJoin(takeover) {
  if (joinBtn.disabled) return;
  joinError.textContent = '';
  store('rumpus.nick', nickInput.value.trim());
  joinBtn.disabled = true;
  joinBtn.textContent = 'Joining…';
  joinForm.setAttribute('aria-busy', 'true');
  joinTimer = window.setTimeout(() => {
    resetJoinBtn();
    // Keep a more precise message if the connection already gave one (e.g. "same Wi-Fi as the TV").
    if (!joinError.textContent) joinError.textContent = 'The TV did not respond. Check the room code and try again.';
  }, 10000);
  lastJoin = {
    code: codeInput.value, nickname: nickInput.value, avatar: myAvatar, device: DEVICE,
    look: avatarMode === 'make' ? myLook : undefined, ...(takeover ? { takeover: true } : {}),
  };
  socket.emit('player:joinRoom', lastJoin);
  void keepAwake();
}
/** The last join asked for, and — while this phone waits in line for a role game to end — the one to
 * send again after the link drops (the TV forgets a queued phone when it disconnects). @type {any} */
let lastJoin = null;
/** @type {any} */
let queuedJoin = null;
/** Back in line after a reconnect / a revived link (only while queued and not seated). */
function requeue() {
  if (queuedJoin && !me && !ended) socket.emit('player:joinRoom', queuedJoin);
}
joinForm.addEventListener('submit', (e) => { e.preventDefault(); askToJoin(); });
joinError.addEventListener('click', (e) => { if (hit(e.target, '[data-thats-me]')) askToJoin(true); });
const joinBtn = /** @type {HTMLButtonElement} */ (joinForm.querySelector('button[type="submit"]'));
/** @type {number | null} */
let joinTimer = null;
const resetJoinBtn = () => {
  if (joinTimer !== null) clearTimeout(joinTimer);
  joinTimer = null;
  joinForm.setAttribute('aria-busy', 'false');
  joinBtn.disabled = false;
  joinBtn.textContent = 'Join';
};

leaveBtn.addEventListener('click', () => {
  if (!confirm('Leave this room? Your score in this game is lost.')) return;
  ended = true;
  socket.emit('player:leave');
  store('rumpus.seat', null);
  setTimeout(() => { location.href = '/play'; }, 150); // let the goodbye reach the TV
});

// ---- connection: rejoin on every (re)connect, show the link state, keep the screen on
/** @type {number | null} */
let lostTimer = null;
const conn = /** @type {HTMLElement} */ (document.getElementById('conn-dot'));
/** @param {'ok' | 'wait' | 'lost'} st */
const setConn = (st) => { conn.dataset.state = st; conn.title = st === 'ok' ? 'Connected to the TV' : 'Reconnecting…'; };
const seat0 = store('rumpus.seat');
if (seat0 && seat0.code && seat0.token) showMessage('<div class="loading-card"><div class="spinner" aria-hidden="true"></div><h1>Getting your seat back…</h1><p>Connecting to the TV</p></div>');
socket.on('connect', () => {
  if (lostTimer) { clearTimeout(lostTimer); lostTimer = null; }
  banner.hidden = true;
  setConn('ok');
  // This tab's own seat first (two tabs of one browser share the saved one: each must come back as itself).
  const seat = mySeat || store('rumpus.seat');
  if (ended) return;
  if (seat && seat.code && seat.token) socket.emit('player:rejoin', { ...seat, device: DEVICE });
  requeue();
});
// Browser build: the TV saw this phone's direct link come back after a nap — re-take the seat.
socket.on('net:resync', () => {
  const seat = mySeat || store('rumpus.seat');
  if (!ended && seat && seat.code && seat.token) socket.emit('player:rejoin', { ...seat, device: DEVICE });
  requeue();
});
socket.on('player:rejoinFailed', () => {
  mySeat = null;
  store('rumpus.seat', null);
  resetJoinBtn();
  showJoin();
});
// A role game is on: this phone is queued and is dealt in (player:joined) when the game ends.
socket.on('player:queued', (/** @type {any} */ msg) => {
  // The TV did answer: no "did not respond" timeout while we wait in line (the button stays off).
  if (joinTimer !== null) { clearTimeout(joinTimer); joinTimer = null; }
  queuedJoin = lastJoin;
  joinBtn.disabled = true;
  joinError.textContent = `You're next! ${String(msg.game || 'A game')} is on right now — you'll join as soon as it ends. Keep this page open.`;
});
socket.on('player:joinError', (/** @type {any} */ msg) => {
  queuedJoin = null;
  resetJoinBtn();
  joinError.textContent = msg.reason || 'Could not join.';
  // The name is in use by someone who is connected. If that's this person on another browser or
  // tab, one tap moves the seat here (the other screen is told).
  if (msg.taken) joinError.insertAdjacentHTML('beforeend', ' <button type="button" class="ghost-btn" data-thats-me>That\'s me — play here</button>');
});
// This seat was opened in another tab or window: that one plays now; this one can take it back.
socket.on('player:replaced', () => {
  ended = true;
  socket.disconnect();
  showMessage('<div class="loading-card"><h1>You\'re playing in another tab</h1><p>Your character moved to the other tab or window on this phone.</p><button class="wide" data-takeback>Play here instead</button></div>');
});
document.addEventListener('click', (e) => {
  if (!hit(e.target, '[data-takeback]')) return;
  ended = false;
  showMessage('<div class="loading-card"><div class="spinner" aria-hidden="true"></div><h1>Taking your seat back…</h1></div>');
  socket.connect();
});
// Waking up (screen on, back to the tab): check the link at once instead of waiting for a ping.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || ended) return;
  void keepAwake();
  if (!socket.connected) return;
  socket.timeout(2500).emit('debug:ping', (/** @type {any} */ err) => {
    if (!err || ended) return;
    socket.disconnect(); // the link died in our sleep: start a fresh one
    socket.connect();
  });
});

// Keep the Wi-Fi radio awake during a game. An idle phone's Wi-Fi dozes between router beacons
// and the router holds incoming packets until it wakes, adding 100–300 ms to updates. A tiny
// message 5×/s keeps it in active mode (measured: p99 572 → 173 ms on Android, PR linked in
// docs/design/networking.md). Browsers can't take Android's low-latency Wi-Fi lock, so this is the lever we have.
const WARM_MS = 200;
setInterval(() => {
  if (ended || !socket.connected || document.visibilityState !== 'visible' || !state || state.phase === 'lobby') return;
  socket.volatile.emit('k');
}, WARM_MS);

/** Keep the screen on while in a room (needs a tap first; https uses the Wake Lock API, plain
 * http a tiny silent looping video — the standard trick for phones without it). */
/** @type {any} */
let wakeLock = null;
/** @type {HTMLVideoElement | null} */
let wakeVideo = null;
/** @param {boolean} [fromTap] called from a tap (only then can a refusal mean low-power mode) */
async function keepAwake(fromTap = false) {
  try {
    const wl = /** @type {any} */ (navigator).wakeLock;
    if (wl && window.isSecureContext) {
      if (!wakeLock || wakeLock.released) wakeLock = await wl.request('screen');
      return;
    }
  } catch (e) { /* not allowed right now: fall back */ }
  if (!wakeVideo) {
    wakeVideo = document.createElement('video');
    wakeVideo.setAttribute('playsinline', '');
    wakeVideo.muted = true;
    wakeVideo.loop = true;
    wakeVideo.className = 'keep-awake';
    wakeVideo.innerHTML = '<source src="/keep-awake.webm" type="video/webm"><source src="/keep-awake.mp4" type="video/mp4">';
    document.body.appendChild(wakeVideo);
  }
  // A refusal right after a tap means the phone won't play it at all (low-power mode); other
  // rejections (an interrupted play, a call from a non-tap) are not worth a warning.
  if (wakeVideo.paused) wakeVideo.play().catch((/** @type {unknown} */ e) => { if (fromTap && e instanceof DOMException && e.name === 'NotAllowedError') wakeHint(); });
}
/** Both keep-awake methods failed (often low-power mode): tell the player once, gently. */
let wakeHinted = false;
function wakeHint() {
  if (wakeHinted) return;
  wakeHinted = true;
  const el = document.createElement('div');
  el.className = 'wake-hint';
  el.setAttribute('role', 'status');
  el.textContent = 'Your screen may go to sleep during the game — turn off low-power mode, or tap now and then.';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}
document.addEventListener('pointerdown', () => { if (me && !ended) void keepAwake(true); }, { passive: true });

socket.on('player:joined', (/** @type {any} */ msg) => {
  queuedJoin = null;
  resetJoinBtn();
  me = { playerId: msg.playerId };
  mySeat = { code: msg.roomState.code, token: msg.token };
  store('rumpus.seat', mySeat);
  joinView.hidden = true;
  gameView.hidden = false;
  leaveBtn.hidden = false;
  reactBar.hidden = false;
  lastHtml = null;
});
socket.on('player:kicked', () => {
  ended = true;
  store('rumpus.seat', null);
  showMessage('<h1>You were removed from the room</h1><p><a href="/play">Join again</a></p>');
});
socket.on('room:stateUpdate', (/** @type {any} */ msg) => {
  // Drawings come once (core/rooms.js sendState): keep them even if this update isn't drawn.
  if (msg && msg.gameState && msg.gameState.images && window.Rumpus.learnPics) window.Rumpus.learnPics(msg.gameState);
  state = msg; render();
});
socket.on('disconnect', () => {
  if (ended) return;
  setConn('wait');
  if (joinTimer !== null) {
    resetJoinBtn();
    joinError.textContent = 'Connection lost. Try joining again when the TV reconnects.';
  } else if (queuedJoin && !me) {
    // Waiting in line: the TV dropped us from it. We get back in line by ourselves on reconnect
    // (requeue); meanwhile the button works again, in case they'd rather tap.
    resetJoinBtn();
    joinError.textContent = 'Connection lost — getting back in line when it reconnects…';
  }
  // Brief blips heal by themselves; only say something if it lasts.
  if (lostTimer) clearTimeout(lostTimer);
  lostTimer = window.setTimeout(() => {
    lostTimer = null;
    if (socket.connected || ended) return;
    setConn('lost');
    banner.innerHTML = '<span class="spinner small" aria-hidden="true"></span> Reconnecting to the TV… your seat is saved';
    banner.hidden = false;
  }, 1500);
});

function showJoin() {
  reactBar.hidden = true;
  joinView.hidden = false;
  gameView.hidden = true;
  leaveBtn.hidden = true;
}

function showMessage(/** @type {any} */ html) {
  // The game screen is going away: stop its timers and sensor listeners (tilt, tap batching).
  cleanups.forEach((fn) => fn());
  cleanups = [];
  lastScreenKey = '';
  gameView.innerHTML = html;
  gameView.hidden = false;
  joinView.hidden = true;
  leaveBtn.hidden = true;
  reactBar.hidden = true;
  lastHtml = null;
}

function myScore() {
  if (!state || !me) return 0;
  const myId = me.playerId;
  const p = state.players.find((/** @type {any} */ x) => x.id === myId);
  return p ? p.score : 0;
}

const waiting = (/** @type {any} */ t) => `<h1>${t} ✓</h1><div class="waiting-art">${meAvatar('avatar huge bob')}</div><p>Waiting for the slowpokes… send some taunts below 👇</p>`;
function meAvatar(/** @type {any} */ cls) {
  const myId = me && me.playerId;
  const p = state && myId && state.players.find((/** @type {any} */ x) => x.id === myId);
  return p ? playerImg(p, cls) : '';
}

// The original four games' phone screens.
function legacyPlayer(/** @type {any} */ phase, /** @type {any} */ g, /** @type {any} */ you) {
  switch (phase) {
    case 'trivia-category':
      if (!you.isChooser) return `<h1>Category round!</h1><p>${esc(g.chooser)} is picking the next category… 🤔</p>`;
      return `<h1>You're in last place 😅</h1><p>So YOU pick the next category:</p><div class="vote-list">` +
        g.categoryOptions.map((/** @type {any} */ c, /** @type {any} */ i) => `<button class="vote-btn" data-send='{"choice":${i}}'>${esc(c)}</button>`).join('') + '</div>';
    case 'trivia-question':
      if (you.answered) return waiting('Locked in');
      return `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p><h2 class="prompt">${esc(g.question)}</h2>
        ${you.canDouble ? `<button type="button" class="ghost-btn dd-toggle" data-dd aria-pressed="false">🎲 Double Down? ×2 if right · −300 if wrong (once per game)</button>` : ''}
        <div class="vote-list">` +
        g.choices.map((/** @type {any} */ c, /** @type {any} */ i) => `<button class="vote-btn" data-send='{"choice":${i}}'>${esc(c)}</button>`).join('') + '</div>';
    case 'trivia-reveal':
      return `<h1>${you.wasCorrect ? 'Nice! ✓' : you.answered ? 'Nope ✗' : 'No answer ⏱'}</h1><p class="prompt">${esc(g.choices[g.correct])}</p>${you.streak > 1 ? `<p class="streak">🔥 ${you.streak} in a row!</p>` : ''}`;
    case 'cah-submit':
      if (you.isCzar) {
        if (!you.nextOptions) return `<h1>You're the Card Czar</h1><p class="prompt">${esc(g.blackCard)}</p><p>Sit tight — everyone else is picking a card.</p>`;
        if (you.nextPick != null) return `<h1>You're the Card Czar</h1><p class="prompt">${esc(g.blackCard)}</p><p>Next round's prompt is locked in ✓ — now wait for the cards.</p>`;
        return `<h1>You're the Card Czar</h1><p>While everyone plays a card, choose <strong>next round's</strong> prompt:</p><div class="vote-list">` +
          you.nextOptions.map((/** @type {any} */ t, /** @type {any} */ i) => `<button class="vote-btn" data-send='{"nextBlack":${i}}'>${esc(t)}</button>`).join('') + '</div>';
      }
      if (you.submitted) return waiting('Card played');
      return `<p class="round-tag">Card Czar: ${esc(g.czarNickname)}</p><h2 class="prompt">${esc(g.blackCard)}</h2><p>Pick a card:</p><div class="vote-list">` +
        (you.hand || []).map((/** @type {any} */ text, /** @type {any} */ i) => `<button class="hand-btn" data-send='{"cardIndex":${i}}'>${esc(text)}</button>`).join('') + '</div>';
    case 'cah-czar':
      if (!you.isCzar) {
        // While the Czar judges: tap the room favourite (+bonus to its author; not your own card).
        if (you.fav != null) return `<h1>Favourite locked in ❤</h1><p>${esc(g.czarNickname)} is judging…</p>`;
        return `<h2 class="prompt">${esc(g.blackCard)}</h2><p>${esc(g.czarNickname)} is judging…</p><p>Tap your favourite: its author gets bonus points.</p><div class="vote-list">` +
          g.submissions.map((/** @type {any} */ s) => (s.mine
            ? `<button class="vote-btn" disabled>${esc(s.text)}</button>`
            : `<button class="vote-btn" data-send='{"fav":${s.index}}'>❤ ${esc(s.text)}</button>`)).join('') + '</div>';
      }
      return `<h2 class="prompt">${esc(g.blackCard)}</h2><p>Pick the winner:</p><div class="vote-list">` +
        g.submissions.map((/** @type {any} */ s) => `<button class="vote-btn" data-send='{"choice":${s.index}}'>${esc(s.text)}</button>`).join('') + '</div>';
    case 'cah-reveal':
      return `<h1>Round winner</h1><p class="prompt">"${esc(g.winner.text)}" — ${esc(g.winner.nickname)}</p>` +
        ((g.favourites || []).length ? `<p>❤ Room favourite: ${g.favourites.map((/** @type {any} */ f) => `${esc(f.nickname)} “${esc(f.text)}”`).join(' · ')} (+${g.favPoints})</p>` : '');
    case 'fib-bluff': {
      if (you.submitted) return waiting('Lie submitted');
      const oops = you.collidedWithTruth
        ? '<p class="error">That\'s the real answer! Write a convincing fake instead. (Finding it in the vote won\'t score this round.)</p>' : '';
      return `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p><h2 class="prompt">${esc(g.prompt)}</h2>
        <p>Make up a fake answer to fool everyone:</p>${oops}
        <form class="text-form"><input name="text" maxlength="120" autocomplete="off" placeholder="Your convincing lie…" required>
        <button type="submit">Send it</button></form>`;
    }
    case 'fib-choose':
      if (you.picked) {
        return `<h1>Guess locked in ✓</h1><p>While you wait: 👍 the answers that made you laugh (+50 each to whoever wrote them, if it's a lie).</p><div class="vote-list">` +
          g.options.map((/** @type {any} */ o) => ((you.liked || []).includes(o.index)
            ? `<button class="vote-btn like-btn on" disabled>👍 ${esc(o.text)}</button>`
            : `<button class="vote-btn like-btn" data-send='{"like":${o.index}}'>${esc(o.text)}</button>`)).join('') + '</div>';
      }
      return `<h2 class="prompt">${esc(g.prompt)}</h2><p>Which one is the truth?</p><div class="vote-list">` +
        g.options.map((/** @type {any} */ o) => `<button class="vote-btn" data-send='{"choice":${o.index}}'>${esc(o.text)}</button>`).join('') + '</div>';
    case 'fib-reveal':
      return `<h1>${you.foundTruth ? 'You found it! ✓' : 'Fooled ✗'}</h1><p class="prompt">The truth: ${esc(g.answer)}</p>`;
    default:
      return null;
  }
}

let sendSeq = 0;
/** Send an answer/tap. The TV confirms it; until then the screen says "Sending…", and if the
 * confirmation never comes (the link dropped) the buttons come back so it can be tapped again. */
function send(/** @type {any} */ payload) {
  const seq = ++sendSeq;
  const screen = lastScreenKey;
  const slow = window.setTimeout(() => { if (seq === sendSeq && screen === lastScreenKey) document.body.classList.add('sending'); }, 250);
  socket.timeout(6000).emit('player:submit', { payload }, (/** @type {any} */ err, /** @type {any} */ res) => {
    clearTimeout(slow);
    if (seq !== sendSeq) return;
    document.body.classList.remove('sending');
    if (screen !== lastScreenKey || ended) return;
    if (!err && res && res.ok) return;
    for (const x of /** @type {NodeListOf<HTMLButtonElement>} */ (gameView.querySelectorAll('[data-send]'))) { x.disabled = false; x.classList.remove('sent'); }
    for (const x of /** @type {NodeListOf<HTMLButtonElement>} */ (gameView.querySelectorAll('form button.sent'))) { x.classList.remove('sent'); x.textContent = (x.dataset && x.dataset.label) || 'Send it'; }
    if (window.Rumpus && window.Rumpus.haptic) window.Rumpus.haptic([30, 80, 30]); // it didn't go: a buzz you can feel
    banner.textContent = res && res.rejected ? 'The TV didn\'t take that — try again' : 'That didn\'t reach the TV — tap again';
    banner.hidden = false;
    setTimeout(() => { if (socket.connected) banner.hidden = true; }, 3000);
  });
}

/** Newest-wins input (tilt): no ack, no "Sending…", and it may be dropped — the next one replaces
 * it. In the browser build it rides the unordered WebRTC channel (web/net.js). */
function sendFast(/** @type {any} */ payload) {
  if (socket.connected) socket.volatile.emit('player:submit', { payload });
}

function render() {
  window.Rumpus.i18n.setLang(state && state.settings && state.settings.lang);
  if (!state || !me) return;
  const g = state.gameState || {};
  const you = state.you || {};
  window.Rumpus.setState(state);
  meTag.innerHTML = `${meAvatar('avatar tiny')} ${esc(you.nickname || '')} · ${myScore()} pts`;

  if (state.phase === 'closed') {
    ended = true;
    store('rumpus.seat', null);
    return showMessage('<h1>Room closed</h1><p>The host ended the room. <a href="/play">Join another</a></p>');
  }

  banner.hidden = state.hostConnected !== false;
  if (state.hostConnected === false) banner.textContent = 'TV disconnected — waiting for it to come back…';

  let html;
  const myId = me.playerId;
  if (state.phase !== 'lobby') lobbyMaker.hidden = true; // a game started: the look panel closes
  if (state.phase === 'lobby') {
    if (!lobbyMaker.hidden && lobbyMode === 'pick') renderLobbyAnimals(); // someone took an animal
    html = `<div class="lobby-card">
        <div class="waiting-art">${meAvatar('avatar huge bob')}</div>
        <h1>You're in!</h1>
        <p>${state.players.length < 2 ? 'Get a friend to scan the QR code on the TV.' : 'The host is picking a game on the TV.'}</p>
        <p class="hint">${state.players.length} player${state.players.length === 1 ? '' : 's'} here</p>
      </div>
      <div class="lobby-actions">
        <button class="ghost-btn" data-lobby-maker>✏️ Change my look</button>
        <button class="ghost-btn shy-btn" data-shy aria-pressed="${you.shy ? 'true' : 'false'}" title="Never the answer in votes about people, no notes or date picks">${you.shy ? '🙈 Left out ✓' : '🙈 Leave me out'}</button>
      </div>
      ${you.shy ? '<p class="hint shy-note">You\'re left out of votes &amp; notes about people. Tap again to join in.</p>' : ''}
      ${state.settings && state.settings.teams ? (() => {
        const mineTeam = (state.players.find((/** @type {any} */ p) => p.id === myId) || {}).team;
        const other = mineTeam === 'red' ? 'blue' : 'red';
        return `<p class="team-badge team-${mineTeam}">You're on ${mineTeam === 'red' ? '🔴 RED' : '🔵 BLUE'}</p>
          <button class="ghost-btn" data-team="${other}">Switch to ${other === 'red' ? '🔴 Red' : '🔵 Blue'}</button>`;
      })() : ''}`;
  } else if (state.phase === 'gameover') {
    const list = /** @type {any[]} */ (g.standings || []);
    const top = list[0];
    const winners = top ? list.filter((s) => s.score === top.score) : [];
    const mine = list.findIndex((s) => s.nickname === you.nickname);
    const place = mine < 0 ? 0 : list[mine].place || mine + 1; // ties share the better placing
    html = '<h1>Game over</h1>' +
      (top ? `<p class="prompt">${winners.length > 1 ? `${winners.map((s) => esc(s.nickname)).join(' & ')} tie with ${top.score}!` : `${esc(top.nickname)} wins with ${top.score}!`}</p>` : '') +
      `<p>You finished #${place}${place && list.filter((s) => (s.place || 0) === place).length > 1 ? ' (tied)' : ''} with <strong>${myScore()}</strong> points.</p>
      ${you.rated ? '<p class="hint">Thanks — noted! 🙏</p>' : `<p class="hint">How was that game?</p><div class="rate-row"><button class="vote-btn" data-rate="1" aria-label="boring">😴</button><button class="vote-btn" data-rate="2" aria-label="good">🙂</button><button class="vote-btn" data-rate="3" aria-label="great">🤩</button></div>`}
      <p>Watch the TV for the next game.</p>
      <p><a class="hl-link" href="/highlights?room=${esc(state.code)}" target="_blank">📸 Tonight's highlights &amp; hall of fame</a></p>`;
  } else if (games[g.gameId]) {
    html = games[g.gameId].player(state);
  } else {
    html = legacyPlayer(state.phase, g, you) || `<h1>${esc(state.phase)}</h1>`;
  }

  // Only touch the DOM if this phone's screen actually changed — otherwise
  // another player's submit would wipe what you're typing/drawing.
  // Same screen (phase/round/step unchanged): patch in place, no re-animation.
  // A new prompt/question is a new screen (fresh, empty answer box) even within the same phase:
  // Campfire Quips asks two prompts in one phase, and a skipped question keeps the phase.
  const screenKey = [state.phase, g.round, g.step, g.chainIndex, g.subject, g.promptNumber, g.matchIndex, g.revealIndex, g.skipSeq,
    typeof g.prompt === 'string' ? g.prompt : '', typeof g.question === 'string' ? g.question : ''].join('|');
  if (html !== lastHtml && screenKey === lastScreenKey && lastHtml !== null && !gameView.querySelector('#pad, #scribble-pad')) {
    morph(gameView, html);
    lastHtml = html;
  } else if (html !== lastHtml) {
    document.body.classList.remove('sending');
    lastScreenKey = screenKey;
    cleanups.forEach((fn) => fn());
    cleanups = [];
    gameView.innerHTML = html;
    gameView.classList.remove('enter'); void gameView.offsetWidth; gameView.classList.add('enter');
    const needsInput = gameView.querySelector('form, [data-send], #pad');
    // Buzz when it's your turn — only after the player has touched the page (browsers block it otherwise).
    const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (needsInput && lastHtml !== null && navigator.vibrate && active) navigator.vibrate(60);
    lastHtml = html;
    bind(g);
    const first = gameView.querySelector('form input');
    if (first && !('ontouchstart' in window)) /** @type {HTMLInputElement} */ (first).focus();
  }
  countdown(g.endsAt, '#phone-timer', (/** @type {number} */ left) => { if (left <= 0) renderStatus(); });
  if (state.phase !== 'lobby') lobbyMaker.hidden = true;
  renderPace();
  renderStatus();
}

// One line under the header that always says what's going on (and that nothing is stuck).
const statusLine = /** @type {HTMLElement} */ (document.getElementById('status-line'));
/** @type {number | null} */
let statusTimer = null;
function renderStatus() {
  if (!state || !me || ended) { statusLine.hidden = true; return; }
  const g = state.gameState || {};
  const ph = String(state.phase || '');
  const myTurn = !!gameView.querySelector('form, [data-send]:not(:disabled), [data-herd], #pad, canvas[data-touch], .pad-zone');
  const now = window.Rumpus.time.now();
  const late = g.endsAt && g.endsAt < now - 600;
  let text = '';
  let spin = false;
  if (ph === 'lobby') {
    const n = state.players.length;
    text = state.hostConnected === false ? 'TV is offline — waiting for it…' : n < 2 ? 'Waiting for more players to join…' : 'Waiting for the host to pick a game…';
    spin = true;
  } else if (ph === 'gameover') { text = state.night ? 'Next game of the lineup coming up…' : 'Game over — waiting for the host to pick the next game'; spin = true; }
  else if (late && !myTurn) { text = 'Time\'s up — waiting for the TV…'; spin = true; }
  else if (myTurn) text = '👉 Your turn';
  else if (/intro|roles|title/.test(ph)) { text = 'Get ready — the game is starting'; spin = true; }
  else if (/reveal|result|final|score|show/.test(ph)) text = '📺 Watch the TV';
  else { text = 'Waiting for the others…'; spin = true; }
  const html = (spin ? '<span class="spinner small" aria-hidden="true"></span>' : '') + esc(text);
  if (statusLine.innerHTML !== html) statusLine.innerHTML = html;
  statusLine.dataset.kind = myTurn ? 'turn' : 'wait';
  statusLine.hidden = false;
  // Re-check once the timer runs out (no update may come while the TV finishes up).
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = g.endsAt && g.endsAt > now ? window.setTimeout(renderStatus, g.endsAt - now + 700) : null;
}

// Majority-vote pace buttons: skip question / hurry up / next.
const paceBar = /** @type {HTMLElement} */ (document.getElementById('pace-bar'));
/** @type {Record<string, { label: string, done: string }>} */
const PACE = {
  skipq: { label: '🔄 Skip this question', done: 'Voted to skip' },
  hurry: { label: '⏩ Hurry them up', done: 'Voted to hurry' },
  wrap: { label: '⏭ End this round', done: 'Voted to end it' },
  ready: { label: '▶ Next', done: 'Ready' },
};
function renderPace() {
  const pc = state && state.pace;
  if (!pc || !pc.allowed || !pc.allowed.length || ended) { paceBar.hidden = true; return; }
  const answering = !!gameView.querySelector('form, [data-send]:not(.like-btn), #pad');
  const show = pc.allowed.filter((/** @type {any} */ k) => (k === 'skipq' ? answering : k === 'hurry' ? !answering : true));
  if (!show.length) { paceBar.hidden = true; return; }
  const mine = (state.you && state.you.paceVotes) || [];
  const html = show.map((/** @type {any} */ k) => `<button class="pace-btn ${mine.includes(k) ? 'on' : ''}" data-pace="${k}" ${mine.includes(k) ? 'disabled' : ''}>
      ${mine.includes(k) ? '✓ ' + PACE[k].done : PACE[k].label} <small>${pc.counts[k] || 0}/${pc.need}</small></button>`).join('');
  paceBar.hidden = false;
  morph(paceBar, html);
}
paceBar.addEventListener('click', (e) => {
  const b = hit(e.target, '[data-pace]');
  if (!b || b.disabled) return;
  socket.emit('player:vote', { kind: b.dataset.pace });
  window.Rumpus.haptic(20);
});

function bind(/** @type {any} */ g) {
  const impl = games[g.gameId];
  // rerender(): a renderer changed local UI state (e.g. picked a spell, now picks a target).
  const rerender = () => { lastHtml = null; render(); };
  if (impl && impl.bind) impl.bind(gameView, { send, sendFast, state, rerender, onCleanup: (/** @type {() => void} */ fn) => cleanups.push(fn) });
}
