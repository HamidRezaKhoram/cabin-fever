/* Rumpus player (phone) view — renderer of room:stateUpdate. AGPLv3, see LICENSE. */
'use strict';

const { esc, store, countdown, games, sprites } = window.Rumpus;
const socket = io();

const joinView = document.getElementById('join-view');
const gameView = document.getElementById('game-view');
const joinForm = document.getElementById('join-form');
const joinError = document.getElementById('join-error');
const meTag = document.getElementById('me-tag');
const codeInput = document.getElementById('code-input');
const nickInput = document.getElementById('nick-input');
const banner = document.getElementById('banner');
const leaveBtn = document.getElementById('leave-btn');
const reactBar = document.getElementById('react-bar');
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
avatarPick.addEventListener('click', (e) => {
  const b = e.target.closest('[data-avatar]');
  if (!b) return;
  myAvatar = +b.dataset.avatar;
  store('rumpus.avatar', myAvatar);
  avatarPick.innerHTML = avatarGrid(myAvatar);
});

// --- reactions ----------------------------------------------------------------
const REACTIONS = ['😂', '🔥', '💀', '👏', '😱', '🤮', '😍', '🍆', '🍑', '🍻', '🙄', '🤡'];
reactBar.innerHTML = REACTIONS.map((r) => `<button data-react="${r}">${r}</button>`).join('');
reactBar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-react]');
  if (!b) return;
  socket.emit('player:react', { emoji: b.dataset.react });
  if (navigator.vibrate) navigator.vibrate(15);
});

let me = null;
let state = null;
let lastHtml = null;
let cleanups = [];
let ended = false;

// Prefill from QR link (?code=ABCD) and from last time.
const params = new URLSearchParams(location.search);
if (params.get('code')) codeInput.value = params.get('code').toUpperCase().slice(0, 4);
nickInput.value = store('rumpus.nick') || '';
if (codeInput.value && !nickInput.value) setTimeout(() => nickInput.focus(), 50);

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinError.textContent = '';
  store('rumpus.nick', nickInput.value.trim());
  socket.emit('player:joinRoom', { code: codeInput.value, nickname: nickInput.value, avatar: myAvatar });
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
  return p ? sprites.avatarImg(p.avatar, cls) : '';
}

// The original four games' phone screens.
function legacyPlayer(phase, g, you) {
  switch (phase) {
    case 'answering':
      if (you.submitted) return waiting('Got it');
      return `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p><h2 class="prompt">${esc(g.prompt)}</h2>
        <form class="text-form"><input name="text" maxlength="120" autocomplete="off" placeholder="Your answer…" required>
        <button type="submit">Send it</button></form>`;
    case 'voting':
      if (you.voted) return waiting('Vote cast');
      return `<h2 class="prompt">${esc(g.prompt)}</h2><p>Pick your favorite:</p><div class="vote-list">` +
        g.answers.map((a) => `<button class="vote-btn" data-send='{"choice":${a.index}}'>${esc(a.text)}</button>`).join('') + '</div>';
    case 'results': {
      const w = (g.winners && g.winners[0]) || null;
      return '<h1>Results</h1>' + (w ? `<p class="prompt">"${esc(w.text)}" — ${esc(w.nickname)} wins the round!</p>`
        : '<p>No votes this round. Tough crowd.</p>');
    }
    case 'trivia-question':
      if (you.answered) return waiting('Locked in');
      return `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p><h2 class="prompt">${esc(g.question)}</h2><div class="vote-list">` +
        g.choices.map((c, i) => `<button class="vote-btn" data-send='{"choice":${i}}'>${esc(c)}</button>`).join('') + '</div>';
    case 'trivia-reveal':
      return `<h1>${you.wasCorrect ? 'Nice! ✓' : 'Nope ✗'}</h1><p class="prompt">${esc(g.choices[g.correct])}</p>`;
    case 'cah-submit':
      if (you.isCzar) return `<h1>You're the Card Czar</h1><p class="prompt">${esc(g.blackCard)}</p><p>Sit tight — everyone else is picking a card.</p>`;
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
      if (you.picked) return waiting('Guess locked in');
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
      <div class="avatar-pick lobby-pick">${avatarGrid(mine, taken)}</div>`;
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
  if (html !== lastHtml) {
    cleanups.forEach((fn) => fn());
    cleanups = [];
    gameView.innerHTML = html;
    gameView.classList.remove('enter'); void gameView.offsetWidth; gameView.classList.add('enter');
    const lp = gameView.querySelector('.lobby-pick');
    if (lp) lp.addEventListener('click', (e) => {
      const b = e.target.closest('[data-avatar]');
      if (!b || b.disabled) return;
      store('rumpus.avatar', +b.dataset.avatar);
      socket.emit('player:avatar', { avatar: +b.dataset.avatar });
    });
    const needsInput = gameView.querySelector('form, [data-send], #pad');
    if (needsInput && lastHtml !== null && navigator.vibrate) navigator.vibrate(60);
    lastHtml = html;
    bind(g);
    const first = gameView.querySelector('form input');
    if (first && !('ontouchstart' in window)) first.focus();
  }
  countdown(g.endsAt, '#phone-timer');
}

function bind(g) {
  for (const f of gameView.querySelectorAll('form.text-form')) {
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = f.querySelector('input').value;
      if (v.trim()) send({ text: v });
    });
  }
  for (const f of gameView.querySelectorAll('form.number-form')) {
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = parseFloat(f.querySelector('input').value.replace(/,/g, ''));
      if (Number.isFinite(n)) send({ number: n });
    });
  }
  for (const b of gameView.querySelectorAll('[data-send]')) {
    b.addEventListener('click', () => {
      for (const x of gameView.querySelectorAll('[data-send]')) x.disabled = true;
      send(JSON.parse(b.dataset.send));
    });
  }
  const impl = games[g.gameId];
  if (impl && impl.bind) impl.bind(gameView, { send, state, onCleanup: (fn) => cleanups.push(fn) });
}
