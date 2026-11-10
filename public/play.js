/* Rumpus player (phone) view — renderer of room:stateUpdate. AGPLv3, see LICENSE. */
'use strict';


const { esc, store, countdown, games, sprites, morph, playerImg , hit } = window.Rumpus;
const socket = io();

const joinView = document.getElementById('join-view');
const gameView = document.getElementById('game-view');
const joinForm = document.getElementById('join-form');
const joinError = document.getElementById('join-error');
const meTag = document.getElementById('me-tag');
const codeInput = /** @type {HTMLInputElement} */ (document.getElementById('code-input'));
const nickInput = /** @type {HTMLInputElement} */ (document.getElementById('nick-input'));
const banner = document.getElementById('banner');
const leaveBtn = document.getElementById('leave-btn');
const reactBar = document.getElementById('react-bar');

// Text size (accessibility): 100% → 120% → 140%, remembered on this phone.
const SIZES = [1, 1.2, 1.4];
let sizeIx = Math.max(0, SIZES.indexOf(Number(store('rumpus.textSize')) || 1));
const applySize = () => document.body.style.setProperty('--phone-scale', String(SIZES[sizeIx]));
applySize();
document.getElementById('text-size').addEventListener('click', () => {
  sizeIx = (sizeIx + 1) % SIZES.length;
  store('rumpus.textSize', SIZES[sizeIx]);
  applySize();
});
const avatarPick = document.getElementById('avatar-pick');

window.Rumpus.background(document.getElementById('bg'), { fps: 4 });

// --- avatar picker (join form) ---------------------------------------------
let myAvatar = store('rumpus.avatar');
if (!Number.isInteger(myAvatar)) myAvatar = Math.floor(Math.random() * sprites.count);
function avatarGrid(selected, taken = new Set()) {
  return sprites.AVATARS.map((a, i) =>
    `<button type="button" class="${i === selected ? 'on' : ''}" data-avatar="${i}" title="${a.name}" ${taken.has(i) && i !== selected ? 'disabled' : ''}>
      <img src="${sprites.avatarUrl(i)}" alt="${a.name}"></button>`).join('');
}
avatarPick.innerHTML = avatarGrid(myAvatar);

// --- make your character (default) or pick an animal ----------------------
const maker = window.Rumpus.avatarMaker;
let myLook = store('rumpus.look') ? maker.norm(store('rumpus.look')) : maker.random(); // migrates older saved looks
let avatarMode = store('rumpus.avatarMode') === 'pick' ? 'pick' : 'make';
const avatarMake = document.getElementById('avatar-make');
maker.editor(avatarMake, myLook, (l) => { myLook = l; store('rumpus.look', l); });
function setAvatarMode(mode) {
  avatarMode = mode;
  store('rumpus.avatarMode', mode);
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.avatar-mode [data-mode]')).forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === mode);
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });
  avatarMake.hidden = mode !== 'make';
  avatarPick.hidden = mode !== 'pick';
}
document.querySelector('.avatar-mode').addEventListener('click', (e) => {
  const b = hit(e.target, '[data-mode]');
  if (b) setAvatarMode(b.dataset.mode);
});
setAvatarMode(avatarMode);

// Edit your character from the lobby.
const lobbyMaker = document.getElementById('lobby-maker');
let lobbyMakerReady = false;
document.getElementById('lobby-maker-save').addEventListener('click', () => {
  socket.emit('player:look', { look: myLook });
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
const REACT_NAMES = { '😂': 'laughing', '🔥': 'fire', '💀': 'dead', '👏': 'applause', '😱': 'shocked', '🤮': 'gross', '😍': 'love it', '🍆': 'eggplant', '🍑': 'peach', '🍻': 'cheers', '🙄': 'eye roll', '🤡': 'clown' };
reactBar.innerHTML = REACTIONS.map((r) => `<button data-react="${r}" aria-label="React: ${REACT_NAMES[r] || r}">${r}</button>`).join('');
reactBar.addEventListener('click', (e) => {
  const b = hit(e.target, '[data-react]');
  if (!b) return;
  socket.emit('player:react', { emoji: b.dataset.react });
  if (navigator.vibrate) navigator.vibrate(15);
});

let me = null;
let state = null;
let lastHtml = null;
let cleanups = [];
let ended = false;
let lastScreenKey = null;

// Delegated input handling: works for nodes added later by morph().
gameView.addEventListener('submit', (e) => {
  const f = /** @type {HTMLFormElement} */ (e.target);
  const input = /** @type {HTMLInputElement | null} */ (f.querySelector('input'));
  if (!input) return;
  if (f.matches('form.text-form')) {
    e.preventDefault();
    const v = input.value;
    if (v.trim()) send({ text: v });
  } else if (f.matches('form.number-form')) {
    e.preventDefault();
    const n = parseFloat(input.value.replace(/,/g, ''));
    if (Number.isFinite(n)) send({ number: n });
  }
});
gameView.addEventListener('click', (e) => {
  const av = hit(e.target, '.lobby-pick [data-avatar]');
  if (av && !av.disabled) {
    store('rumpus.avatar', +av.dataset.avatar);
    socket.emit('player:look', { look: null }); // back to the pixel animal
    socket.emit('player:avatar', { avatar: +av.dataset.avatar });
    return;
  }
  const tb = hit(e.target, '[data-team]');
  if (tb) { socket.emit('player:team', { team: tb.dataset.team }); return; }
  if (hit(e.target, '[data-lobby-maker]')) {
    lobbyMaker.hidden = false;
    if (!lobbyMakerReady) { maker.editor(document.getElementById('lobby-maker-box'), myLook, (l) => { myLook = l; store('rumpus.look', l); }); lobbyMakerReady = true; }
    lobbyMaker.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const dd = hit(e.target, '[data-dd]');
  if (dd) { const on = dd.getAttribute('aria-pressed') !== 'true'; dd.setAttribute('aria-pressed', String(on)); dd.classList.toggle('on', on); return; }
  const b = hit(e.target, '[data-send]');
  if (!b || b.disabled) return;
  for (const x of /** @type {NodeListOf<HTMLButtonElement>} */ (gameView.querySelectorAll('[data-send]'))) x.disabled = true;
  const payload = JSON.parse(b.dataset.send);
  const ddOn = gameView.querySelector('[data-dd][aria-pressed="true"]');
  if (ddOn) payload.double = true;
  send(payload);
});

// Prefill from QR link (?code=ABCD) and from last time.
const params = new URLSearchParams(location.search);
if (params.get('code')) codeInput.value = params.get('code').toUpperCase().slice(0, 4);
nickInput.value = store('rumpus.nick') || '';
if (codeInput.value && !nickInput.value) setTimeout(() => nickInput.focus(), 50);

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinError.textContent = '';
  store('rumpus.nick', nickInput.value.trim());
  socket.emit('player:joinRoom', {
    code: codeInput.value, nickname: nickInput.value, avatar: myAvatar,
    look: avatarMode === 'make' ? myLook : undefined,
  });
});

leaveBtn.addEventListener('click', () => {
  if (!confirm('Leave this room?')) return;
  socket.emit('player:leave');
  store('rumpus.seat', null);
  location.href = '/play';
});

socket.on('connect', () => {
  banner.hidden = true;
  const seat = store('rumpus.seat');
  if (seat && seat.code && seat.token && !ended) socket.emit('player:rejoin', seat);
});
socket.on('player:rejoinFailed', () => {
  store('rumpus.seat', null);
  showJoin();
});
socket.on('player:joinError', (msg) => { joinError.textContent = msg.reason || 'Could not join.'; });
socket.on('player:joined', (msg) => {
  me = { playerId: msg.playerId };
  store('rumpus.seat', { code: msg.roomState.code, token: msg.token });
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
socket.on('room:stateUpdate', (msg) => { state = msg; render(); });
socket.on('disconnect', () => {
  if (ended) return;
  banner.textContent = 'Connection lost — reconnecting…';
  banner.hidden = false;
});

function showJoin() {
  reactBar.hidden = true;
  joinView.hidden = false;
  gameView.hidden = true;
  leaveBtn.hidden = true;
}

function showMessage(html) {
  gameView.innerHTML = html;
  gameView.hidden = false;
  joinView.hidden = true;
  leaveBtn.hidden = true;
  reactBar.hidden = true;
  lastHtml = null;
}

function myScore() {
  if (!state || !me) return 0;
  const p = state.players.find((x) => x.id === me.playerId);
  return p ? p.score : 0;
}

const waiting = (t) => `<h1>${t} ✓</h1><div class="waiting-art">${meAvatar('avatar huge bob')}</div><p>Waiting for the slowpokes… send some taunts below 👇</p>`;
function meAvatar(cls) {
  const p = state && me && state.players.find((x) => x.id === me.playerId);
  return p ? playerImg(p, cls) : '';
}

// The original four games' phone screens.
function legacyPlayer(phase, g, you) {
  switch (phase) {
    case 'trivia-category':
      if (!you.isChooser) return `<h1>Category round!</h1><p>${esc(g.chooser)} is picking the next category… 🤔</p>`;
      return `<h1>You're in last place 😅</h1><p>So YOU pick the next category:</p><div class="vote-list">` +
        g.categoryOptions.map((c, i) => `<button class="vote-btn" data-send='{"choice":${i}}'>${esc(c)}</button>`).join('') + '</div>';
    case 'trivia-question':
      if (you.answered) return waiting('Locked in');
      return `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p><h2 class="prompt">${esc(g.question)}</h2>
        ${you.canDouble ? `<button type="button" class="ghost-btn dd-toggle" data-dd aria-pressed="false">🎲 Double Down? ×2 if right · −300 if wrong (once per game)</button>` : ''}
        <div class="vote-list">` +
        g.choices.map((c, i) => `<button class="vote-btn" data-send='{"choice":${i}}'>${esc(c)}</button>`).join('') + '</div>';
    case 'trivia-reveal':
      return `<h1>${you.wasCorrect ? 'Nice! ✓' : 'Nope ✗'}</h1><p class="prompt">${esc(g.choices[g.correct])}</p>${you.streak > 1 ? `<p class="streak">🔥 ${you.streak} in a row!</p>` : ''}`;
    case 'cah-submit':
      if (you.isCzar) {
        if (!you.nextOptions) return `<h1>You're the Card Czar</h1><p class="prompt">${esc(g.blackCard)}</p><p>Sit tight — everyone else is picking a card.</p>`;
        if (you.nextPick != null) return `<h1>You're the Card Czar</h1><p class="prompt">${esc(g.blackCard)}</p><p>Next round's prompt is locked in ✓ — now wait for the cards.</p>`;
        return `<h1>You're the Card Czar</h1><p>While everyone plays a card, choose <strong>next round's</strong> prompt:</p><div class="vote-list">` +
          you.nextOptions.map((t, i) => `<button class="vote-btn" data-send='{"nextBlack":${i}}'>${esc(t)}</button>`).join('') + '</div>';
      }
      if (you.submitted) return waiting('Card played');
      return `<p class="round-tag">Card Czar: ${esc(g.czarNickname)}</p><h2 class="prompt">${esc(g.blackCard)}</h2><p>Pick a card:</p><div class="vote-list">` +
        (you.hand || []).map((text, i) => `<button class="hand-btn" data-send='{"cardIndex":${i}}'>${esc(text)}</button>`).join('') + '</div>';
    case 'cah-czar':
      if (!you.isCzar) return `<h1>Card played ✓</h1><p>${esc(g.czarNickname)} is judging…</p>`;
      return `<h2 class="prompt">${esc(g.blackCard)}</h2><p>Pick the winner:</p><div class="vote-list">` +
        g.submissions.map((s) => `<button class="vote-btn" data-send='{"choice":${s.index}}'>${esc(s.text)}</button>`).join('') + '</div>';
    case 'cah-reveal':
      return `<h1>Round winner</h1><p class="prompt">"${esc(g.winner.text)}" — ${esc(g.winner.nickname)}</p>`;
    case 'fib-bluff': {
      if (you.submitted) return waiting('Lie submitted');
      const oops = you.collidedWithTruth
        ? '<p class="error">That\'s the real answer! Write a convincing fake instead.</p>' : '';
      return `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p><h2 class="prompt">${esc(g.prompt)}</h2>
        <p>Make up a fake answer to fool everyone:</p>${oops}
        <form class="text-form"><input name="text" maxlength="120" autocomplete="off" placeholder="Your convincing lie…" required>
        <button type="submit">Send it</button></form>`;
    }
    case 'fib-choose':
      if (you.picked) {
        return `<h1>Guess locked in ✓</h1><p>While you wait: 👍 the answers that made you laugh (+50 each to whoever wrote them).</p><div class="vote-list">` +
          g.options.map((o) => ((you.liked || []).includes(o.index)
            ? `<button class="vote-btn like-btn on" disabled>👍 ${esc(o.text)}</button>`
            : `<button class="vote-btn like-btn" data-send='{"like":${o.index}}'>${esc(o.text)}</button>`)).join('') + '</div>';
      }
      return `<h2 class="prompt">${esc(g.prompt)}</h2><p>Which one is the truth?</p><div class="vote-list">` +
        g.options.map((o) => `<button class="vote-btn" data-send='{"choice":${o.index}}'>${esc(o.text)}</button>`).join('') + '</div>';
    case 'fib-reveal':
      return `<h1>${you.foundTruth ? 'You found it! ✓' : 'Fooled ✗'}</h1><p class="prompt">The truth: ${esc(g.answer)}</p>`;
    default:
      return null;
  }
}

function send(payload) {
  socket.emit('player:submit', { payload });
}

function render() {
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
  if (state.phase === 'lobby') {
    const taken = new Set(state.players.filter((p) => p.id !== me.playerId).map((p) => p.avatar));
    const mine = (state.players.find((p) => p.id === me.playerId) || {}).avatar;
    html = `<h1>You're in!</h1><div class="waiting-art">${meAvatar('avatar huge bob')}</div>
      <p>Watch the TV — the host is picking a game.</p>
      <p class="hint">${state.players.length} player${state.players.length === 1 ? '' : 's'} here · tap to change your animal:</p>
      <div class="avatar-pick lobby-pick">${avatarGrid(mine, taken)}</div>
      <button class="ghost-btn" data-lobby-maker>🧑 Edit my character</button>
      ${state.settings && state.settings.teams ? (() => {
        const mineTeam = (state.players.find((p) => p.id === me.playerId) || {}).team;
        const other = mineTeam === 'red' ? 'blue' : 'red';
        return `<p class="team-badge team-${mineTeam}">You're on ${mineTeam === 'red' ? '🔴 RED' : '🔵 BLUE'}</p>
          <button class="ghost-btn" data-team="${other}">Switch to ${other === 'red' ? '🔴 Red' : '🔵 Blue'}</button>`;
      })() : ''}`;
  } else if (state.phase === 'gameover') {
    const top = g.standings && g.standings[0];
    const rank = (g.standings || []).findIndex((s) => s.nickname === you.nickname);
    html = '<h1>Game over</h1>' +
      (top ? `<p class="prompt">${esc(top.nickname)} wins with ${top.score}!</p>` : '') +
      `<p>You finished #${rank + 1} with <strong>${myScore()}</strong> points.</p><p>Watch the TV for the next game.</p>`;
  } else if (games[g.gameId]) {
    html = games[g.gameId].player(state);
  } else {
    html = legacyPlayer(state.phase, g, you) || `<h1>${esc(state.phase)}</h1>`;
  }

  // Only touch the DOM if this phone's screen actually changed — otherwise
  // another player's submit would wipe what you're typing/drawing.
  // Same screen (phase/round/step unchanged): patch in place, no re-animation.
  const screenKey = [state.phase, g.round, g.step, g.chainIndex, g.subject].join('|');
  if (html !== lastHtml && screenKey === lastScreenKey && lastHtml !== null && !gameView.querySelector('#pad')) {
    morph(gameView, html);
    lastHtml = html;
  } else if (html !== lastHtml) {
    lastScreenKey = screenKey;
    cleanups.forEach((fn) => fn());
    cleanups = [];
    gameView.innerHTML = html;
    gameView.classList.remove('enter'); void gameView.offsetWidth; gameView.classList.add('enter');
    const needsInput = gameView.querySelector('form, [data-send], #pad');
    if (needsInput && lastHtml !== null && navigator.vibrate) navigator.vibrate(60);
    lastHtml = html;
    bind(g);
    const first = gameView.querySelector('form input');
    if (first && !('ontouchstart' in window)) /** @type {HTMLInputElement} */ (first).focus();
  }
  countdown(g.endsAt, '#phone-timer');
  if (state.phase !== 'lobby') lobbyMaker.hidden = true;
  renderPace();
}

// Majority-vote pace buttons: skip question / hurry up / next.
const paceBar = document.getElementById('pace-bar');
const PACE = {
  skipq: { label: '🔄 Skip this question', done: 'Voted to skip' },
  hurry: { label: '⏩ Hurry them up', done: 'Voted to hurry' },
  ready: { label: '▶ Next', done: 'Ready' },
};
function renderPace() {
  const pc = state && state.pace;
  if (!pc || !pc.allowed || !pc.allowed.length || ended) { paceBar.hidden = true; return; }
  const answering = !!gameView.querySelector('form, [data-send]:not(.like-btn), #pad');
  const show = pc.allowed.filter((k) => (k === 'skipq' ? answering : k === 'hurry' ? !answering : true));
  if (!show.length) { paceBar.hidden = true; return; }
  const mine = (state.you && state.you.paceVotes) || [];
  const html = show.map((k) => `<button class="pace-btn ${mine.includes(k) ? 'on' : ''}" data-pace="${k}" ${mine.includes(k) ? 'disabled' : ''}>
      ${mine.includes(k) ? '✓ ' + PACE[k].done : PACE[k].label} <small>${pc.counts[k] || 0}/${pc.need}</small></button>`).join('');
  paceBar.hidden = false;
  morph(paceBar, html);
}
paceBar.addEventListener('click', (e) => {
  const b = hit(e.target, '[data-pace]');
  if (!b || b.disabled) return;
  socket.emit('player:vote', { kind: b.dataset.pace });
  if (navigator.vibrate) navigator.vibrate(20);
});

function bind(g) {
  const impl = games[g.gameId];
  if (impl && impl.bind) impl.bind(gameView, { send, state, onCleanup: (fn) => cleanups.push(fn) });
}
