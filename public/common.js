/* Rumpus shared client helpers. AGPLv3, see LICENSE. */
'use strict';

window.Rumpus = Object.assign(window.Rumpus || {}, (function () {
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
    return val;
  }

  // Tiny WebAudio synth — no audio files, works offline.
  let ctx = null;
  let muted = !!store('rumpus.muted');
  function tone(freq, dur, type = 'sine', vol = 0.15, delay = 0) {
    if (muted) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* audio unavailable */ }
  }
  const fallbackSfx = {
    join: () => { tone(660, 0.12, 'triangle'); tone(990, 0.15, 'triangle', 0.12, 0.1); },
    phase: () => { tone(523, 0.15, 'triangle'); tone(784, 0.25, 'triangle', 0.12, 0.12); },
    tick: () => tone(1200, 0.05, 'square', 0.05),
    reveal: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.09)); },
    win: () => { [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'square', 0.07, i * 0.12)); },
  };
  // Prefer the music engine's sfx bus (volume slider) when it's loaded (TV).
  const sfx = new Proxy({}, {
    get: (_, k) => () => {
      const m = window.Rumpus.music;
      if (m && m.isEnabled()) return m.sfx[k] && m.sfx[k]();
      return fallbackSfx[k] && fallbackSfx[k]();
    },
  });
  function setMuted(m) { muted = m; store('rumpus.muted', m); }
  function isMuted() { return muted; }

  // Countdown helper: updates every element matching selector with seconds left.
  let cdTimer = null;
  function countdown(endsAt, selector, onTick) {
    if (cdTimer) clearInterval(cdTimer);
    cdTimer = null;
    const els = () => document.querySelectorAll(selector);
    if (!endsAt) { els().forEach((e) => { e.textContent = ''; }); return; }
    let last = null;
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      els().forEach((e) => { e.textContent = left + 's'; e.classList.toggle('urgent', left <= 5); });
      if (left !== last && onTick) onTick(left);
      last = left;
      if (left <= 0) { clearInterval(cdTimer); cdTimer = null; }
    };
    tick();
    cdTimer = setInterval(tick, 250);
  }

  // Avatar <img> for a nickname, looked up in the latest room state.
  let lastState = null;
  function setState(s) { lastState = s; }
  // A player's picture: their own drawing if they made one, else their pixel animal.
  function playerUrl(p) {
    if (p && p.drawn && lastState) return `/avatar/${lastState.code}/${encodeURIComponent(p.id)}?v=${p.drawn}`;
    return window.Rumpus.sprites ? window.Rumpus.sprites.avatarUrl(p ? p.avatar : 0) : '';
  }
  function playerImg(p, cls = 'avatar') {
    if (!p) return '';
    return `<img class="${cls}${p.drawn ? ' drawn' : ''}" src="${playerUrl(p)}" alt="">`;
  }
  function av(nickname, cls = 'avatar tiny') {
    if (!lastState) return '';
    const p = (lastState.players || []).find((x) => x.nickname === nickname);
    return p ? playerImg(p, cls) : '';
  }

  function scoredList(list) {
    if (!list || !list.length) return '';
    return '<ul class="scored-list">' +
      list.map((s) => `<li class="correct">${av(s.nickname)} ${esc(s.nickname)} +${s.gained}</li>`).join('') + '</ul>';
  }

  // Update `target`'s children to match `html` in place: unchanged nodes are
  // kept, so running CSS animations don't restart (no stutter/flicker) and
  // focused inputs keep what the user typed.
  function morph(target, html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    morphChildren(target, tpl.content);
  }
  function morphChildren(a, b) {
    const an = [...a.childNodes], bn = [...b.childNodes];
    const n = Math.max(an.length, bn.length);
    for (let i = 0; i < n; i++) {
      const x = an[i], y = bn[i];
      if (!x) a.appendChild(y);
      else if (!y) x.remove();
      else morphNode(x, y);
    }
  }
  function morphNode(x, y) {
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { x.replaceWith(y); return; }
    if (x.nodeType === 3 || x.nodeType === 8) {
      if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
      return;
    }
    if (x.nodeType !== 1) return;
    for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
    for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
    if (x.nodeName === 'CANVAS' || x.nodeName === 'TEXTAREA') return;
    morphChildren(x, y);
  }

  // Per-game renderers: { host(state) -> html, player(state) -> html, bind(root, api) }
  const games = {};
  function register(id, impl) { games[id] = impl; }

  return { esc, store, sfx, setMuted, isMuted, countdown, scoredList, games, register, av, setState, morph, playerImg, playerUrl };
})());
