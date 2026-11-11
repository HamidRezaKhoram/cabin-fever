/* Rumpus shared client helpers. AGPLv3, see LICENSE. */
'use strict';

window.Rumpus = /** @type {RumpusNS} */ (/** @type {unknown} */ (Object.assign(window.Rumpus || {}, (function () {
  /** @param {unknown} s */
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  /** Read (one argument) or write (two) a JSON value in localStorage. @param {string} key @param {any} [val] */
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
    return val;
  }

  // Tiny WebAudio synth — no audio files, works offline.
  /** @type {AudioContext | null} */
  let ctx = null;
  let muted = !!store('rumpus.muted');
  /** @param {number} freq @param {number} dur @param {OscillatorType} [type] @param {number} [vol] @param {number} [delay] */
  function tone(freq, dur, type = 'sine', vol = 0.15, delay = 0) {
    if (muted) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') void ctx.resume();
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
  /** @type {Record<string, () => void>} */
  const fallbackSfx = {
    join: () => { tone(660, 0.12, 'triangle'); tone(990, 0.15, 'triangle', 0.12, 0.1); },
    phase: () => { tone(523, 0.15, 'triangle'); tone(784, 0.25, 'triangle', 0.12, 0.12); },
    tick: () => tone(1200, 0.05, 'square', 0.05),
    reveal: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.09)); },
    win: () => { [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'square', 0.07, i * 0.12)); },
    thunder: () => { tone(55, 1.2, 'sawtooth', 0.12); tone(40, 1.6, 'sine', 0.15, 0.05); },
  };
  // Prefer the music engine's sfx bus (volume slider) when it's loaded (TV).
  const sfx = new Proxy({}, {
    get: (_, k) => () => {
      const m = window.Rumpus.music;
      if (m && m.isEnabled()) return m.sfx[k] && m.sfx[k]();
      const f = fallbackSfx[String(k)];
      return f && f();
    },
  });
  /** @param {boolean} m */
  function setMuted(m) { muted = m; store('rumpus.muted', m); }
  function isMuted() { return muted; }

  // Countdown helper: updates every element matching selector with seconds left.
  /** @type {number | null} */
  let cdTimer = null;
  /** @param {number | null | undefined} endsAt @param {string} selector @param {(left: number) => void} [onTick] */
  function countdown(endsAt, selector, onTick) {
    if (cdTimer) clearInterval(cdTimer);
    cdTimer = null;
    const els = () => document.querySelectorAll(selector);
    if (!endsAt) { els().forEach((e) => { e.textContent = ''; }); return; }
    /** @type {number | null} */
    let last = null;
    const tick = () => {
      // Server time (a phone whose clock is a few seconds off still shows the right countdown).
      const left = Math.max(0, Math.ceil((endsAt - time.now()) / 1000));
      els().forEach((e) => { e.textContent = left + 's'; e.classList.toggle('urgent', left <= 5); });
      if (left !== last && onTick) onTick(left);
      last = left;
      if (left <= 0) { if (cdTimer) clearInterval(cdTimer); cdTimer = null; }
    };
    tick();
    cdTimer = setInterval(tick, 250);
  }

  // Avatar <img> for a nickname, looked up in the latest room state.
  /** @type {{ players?: any[] } | null} latest room state (avatars by nickname) */
  let lastState = null;
  /** @param {any} s */
  function setState(s) { lastState = s; }
  // A player's picture: their own drawing if they made one, else their pixel animal.
  /** @param {{ look?: any, avatar?: number } | null | undefined} p */
  function playerUrl(p) {
    if (p && p.look && window.Rumpus.avatarMaker) return window.Rumpus.avatarMaker.url(p.look);
    return window.Rumpus.sprites ? window.Rumpus.sprites.avatarUrl(p ? p.avatar : 0) : '';
  }
  /** @param {{ look?: any, avatar?: number } | null | undefined} p @param {string} [cls] */
  function playerImg(p, cls = 'avatar') {
    if (!p) return '';
    return `<img class="${cls}" src="${playerUrl(p)}" alt="">`;
  }
  /** @param {string | null | undefined} nickname @param {string} [cls] */
  function av(nickname, cls = 'avatar tiny') {
    if (!lastState) return '';
    const p = (lastState.players || []).find((x) => x.nickname === nickname);
    return p ? playerImg(p, cls) : '';
  }

  /** Picture URL for a player by nickname (canvas games draw avatars themselves). @param {string} nickname */
  function avUrl(nickname) {
    const p = lastState && (lastState.players || []).find((/** @type {any} */ x) => x.nickname === nickname);
    return p ? playerUrl(p) : '';
  }

  /** @param {{ nickname: string, gained: number }[] | null | undefined} list */
  function scoredList(list) {
    if (!list || !list.length) return '';
    return '<ul class="scored-list">' +
      list.map((s) => `<li class="correct">${av(s.nickname)} ${esc(s.nickname)} +${s.gained}</li>`).join('') + '</ul>';
  }

  // Update `target`'s children to match `html` in place: unchanged nodes are
  // kept, so running CSS animations don't restart (no stutter/flicker) and
  // focused inputs keep what the user typed.
  /** @param {Element} target @param {string} html */
  function morph(target, html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    morphChildren(target, tpl.content);
  }
  /** @param {Node} a @param {Node} b */
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
  /** @param {any} x @param {any} y nodes of the same position (checked by type below) */
  function morphNode(x, y) {
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { x.replaceWith(y); return; }
    if (x.nodeType === 3 || x.nodeType === 8) {
      if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
      return;
    }
    if (x.nodeType !== 1) return;
    for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
    for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
    // Once the user has touched a control, its attributes no longer drive its live state:
    // keep checkboxes and dropdown choices in step with what the server says.
    if (x.nodeName === 'INPUT' && x.checked !== y.hasAttribute('checked') && (x.type === 'checkbox' || x.type === 'radio')) x.checked = y.hasAttribute('checked');
    if (x.nodeName === 'OPTION' && x.selected !== y.hasAttribute('selected') && y.parentNode && y.parentNode.querySelector('option[selected]')) x.selected = y.hasAttribute('selected');
    // data-live: the element's contents are driven by the 30 fps clock (beat meters) — leave them alone.
    if (x.nodeName === 'CANVAS' || x.nodeName === 'TEXTAREA' || /** @type {Element} */ (x).hasAttribute('data-live')) return;
    morphChildren(x, y);
  }

  // Fit-to-fill: grow text until it fills its box (up to maxLines / max size),
  // so short prompts become big and long ones still fit. TV "10-foot" rule:
  // size relative to screen height, never below ~28px at 1080p.
  /** @param {HTMLElement} el @param {{ max?: number, min?: number, maxLines?: number }} [opts] */
  function fit(el, { max = 0.14, min = 0.032, maxLines = 4 } = {}) {
    if (!el || !el.isConnected) return;
    const vh = window.innerHeight;
    let lo = Math.round(vh * min), hi = Math.round(vh * max), best = lo;
    const width = el.clientWidth || (el.parentElement ? el.parentElement.clientWidth : 0);
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      el.style.fontSize = mid + 'px';
      // Measure with the element's real line height (not a guess).
      const lh = parseFloat(getComputedStyle(el).lineHeight) || mid * 1.25;
      const lines = Math.round(el.scrollHeight / lh);
      if (el.scrollWidth <= width + 1 && lines <= maxLines) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    el.style.fontSize = best + 'px';
  }
  /** @param {Element | null} root */
  function fitAll(root) {
    if (!root) return;
    root.querySelectorAll('[data-fit]').forEach((node) => {
      const el = /** @type {HTMLElement} */ (node);
      const [max, lines] = (el.dataset.fit || '').split(',').map(Number);
      fit(el, { max: max || 0.14, maxLines: lines || 4 });
    });
  }

  /**
   * Typed event delegation: the closest element matching `sel` from an event target.
   * @param {EventTarget | null} target @param {string} sel
   * @returns {HTMLButtonElement | null} (buttons, links, inputs — anything with dataset/disabled)
   */
  /** Image URL of a QR code: the server draws it (/qr.svg), the browser build draws it in the page.
   * @param {string} text */
  function qrSrc(text) {
    const C = /** @type {any} */ (window).CABIN;
    return C && C.qrDataUrl ? C.qrDataUrl(text) : '/qr.svg?data=' + encodeURIComponent(text);
  }

  /** @param {EventTarget | null} target @param {string} sel */
  function hit(target, sel) {
    const el = target instanceof Element ? target.closest(sel) : null;
    return /** @type {HTMLButtonElement | null} */ (el);
  }

  // Per-game renderers: { host(state) -> html, player(state) -> html, bind(root, api) }
  /** @type {Record<string, any>} */
  const games = {};
  /** @param {string} id @param {any} impl */
  function register(id, impl) { games[id] = impl; }

  // Server clock (NTP-style): the ping with the shortest round trip gives the best offset.
  // Rhythm games timestamp taps with time.now() so Wi-Fi jitter never affects judging.
  const time = (() => {
    let offset = 0;
    /** @type {{ rtt: number, off: number }[]} */
    let samples = [];
    let started = false;
    /** @param {{ emit(ev: string, ack: (srv: unknown) => void): void }} sock */
    function ping(sock) {
      const t0 = Date.now();
      sock.emit('time:ping', (/** @type {unknown} */ srv) => {
        const t1 = Date.now();
        if (typeof srv !== 'number') return;
        samples.push({ rtt: t1 - t0, off: srv - (t0 + t1) / 2 });
        samples = samples.slice(-10);
        offset = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off;
      });
    }
    return {
      /** @param {{ emit(ev: string, ack: (srv: unknown) => void): void, on(ev: string, fn: () => void): void }} sock */
      sync(sock) {
        if (started) return;
        started = true;
        const burst = () => { for (let i = 0; i < 6; i++) setTimeout(() => ping(sock), i * 120); };
        burst();
        sock.on('connect', () => { samples = []; burst(); });
        const again = () => { ping(sock); setTimeout(again, 15000); };
        setTimeout(again, 15000);
      },
      now: () => Date.now() + offset,
      offset: () => offset,
      rtt: () => (samples.length ? Math.min(...samples.map((x) => x.rtt)) : null),
    };
  })();

  // Haptics: a buzz you can feel on every tap. Android vibrates; iPhones (no vibrate API) get the
  // system "tick" by flipping a hidden switch control (Safari 17.4+ plays a haptic for it).
  /** @type {HTMLLabelElement | null} */
  let iosSwitch = null;
  /** @param {number | number[]} pattern ms (or on/off pattern) */
  function haptic(pattern) {
    try {
      if (navigator.vibrate) { navigator.vibrate(pattern); return; }
      if (!/iP(hone|ad|od)/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))) return;
      if (!iosSwitch) {
        iosSwitch = document.createElement('label');
        iosSwitch.className = 'haptic-switch';
        iosSwitch.setAttribute('aria-hidden', 'true');
        iosSwitch.innerHTML = '<input type="checkbox" switch tabindex="-1">';
        document.body.appendChild(iosSwitch);
      }
      iosSwitch.click();
      // A "double" buzz for a miss.
      if (Array.isArray(pattern) && pattern.length > 2) setTimeout(() => { if (iosSwitch) iosSwitch.click(); }, (pattern[0] || 0) + (pattern[1] || 0));
    } catch (e) { /* no haptics here */ }
  }

  return { haptic, qrSrc, avUrl, time, esc, store, sfx, setMuted, isMuted, countdown, scoredList, games, register, av, setState, morph, playerImg, playerUrl, fit, fitAll, hit };
})())));
