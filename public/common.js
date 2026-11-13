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
    cdTimer = setInterval(tick, 250);
    tick();
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

  /** Points with their sign: +300, −200 (never "+-200"). @param {number} n */
  function signed(n) {
    return n < 0 ? '−' + Math.abs(n) : '+' + n;
  }

  /** @param {{ nickname: string, gained: number }[] | null | undefined} list */
  function scoredList(list) {
    if (!list || !list.length) return '';
    return '<ul class="scored-list">' +
      list.map((s) => `<li class="correct">${av(s.nickname)} ${esc(s.nickname)} ${signed(s.gained)}</li>`).join('') + '</ul>';
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
  /** Children are matched by position, except elements with a `data-key`: those are matched by key
   * (moved, not rebuilt), so a list that drops its first item keeps the rest animating.
   * @param {Node} a @param {Node} b */
  function morphChildren(a, b) {
    const bn = [...b.childNodes];
    // Keyed children that are gone go first, so the survivors don't all have to move past them
    // (moving a node restarts its CSS animation).
    const wanted = new Set(bn.filter((n) => n.nodeType === 1 && /** @type {Element} */ (n).hasAttribute('data-key')).map((n) => /** @type {Element} */ (n).getAttribute('data-key')));
    for (const c of [...(/** @type {Element} */ (a).children || [])]) if (c.hasAttribute('data-key') && !wanted.has(c.getAttribute('data-key'))) c.remove();
    /** old keyed nodes already matched (two children with the same key each get their own node) */
    const used = new Set();
    for (let i = 0; i < bn.length; i++) {
      const y = bn[i], x = a.childNodes[i];
      const key = y.nodeType === 1 ? /** @type {Element} */ (y).getAttribute('data-key') : null;
      if (key != null) {
        const m = [...(/** @type {Element} */ (a).children || [])].find((c) => c.getAttribute('data-key') === key && !used.has(c));
        if (m) { used.add(m); if (m !== x) a.insertBefore(m, x || null); morphNode(m, y); } else { used.add(y); a.insertBefore(y, x || null); }
        continue;
      }
      if (!x) a.appendChild(y);
      // An unkeyed node never takes over a keyed one (that would drop its key and rebuild it later).
      else if (x.nodeType === 1 && /** @type {Element} */ (x).hasAttribute('data-key')) a.insertBefore(y, x);
      else morphNode(x, y);
    }
    while (a.childNodes.length > bn.length) /** @type {ChildNode} */ (a.lastChild).remove();
  }
  /** @param {any} x @param {any} y nodes of the same position (checked by type below) */
  function morphNode(x, y) {
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { x.replaceWith(y); return; }
    if (x.nodeType === 3 || x.nodeType === 8) {
      if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
      return;
    }
    if (x.nodeType !== 1) return;
    // Text sized by fit() (data-fit + its inline font size) keeps that size: the layout code owns it,
    // not the HTML. Dropping it made every small update re-fit the whole TV screen (feel-plan.md).
    const fitted = x.hasAttribute('data-fit') ? x.style.fontSize : '';
    for (const at of [...x.attributes]) if (!y.hasAttribute(at.name) && !(fitted && (at.name === 'data-fit' || at.name === 'style'))) x.removeAttribute(at.name);
    for (const at of [...y.attributes]) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
    if (fitted && !x.style.fontSize) x.style.fontSize = fitted;
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
  /** A hidden box that only lays out itself (CSS containment): fit() measures a copy of the text in it,
   * so each step of the search costs one tiny layout instead of a layout of the whole TV screen
   * (the TV's biggest cost on a slow CPU: Cottage Lab profile, docs/future-features/feel-plan.md). */
  /** @type {HTMLDivElement | null} */
  let measureBox = null;
  function box() {
    if (!measureBox || !measureBox.isConnected) {
      measureBox = document.createElement('div');
      measureBox.setAttribute('aria-hidden', 'true');
      // Fixed size + overflow clip + contain:strict = a layout root: changing the copy re-lays out only this box.
      measureBox.style.cssText = 'position:fixed;left:-20000px;top:0;width:4000px;height:4000px;overflow:hidden;visibility:hidden;contain:strict;pointer-events:none;';
      document.body.appendChild(measureBox);
    }
    return measureBox;
  }
  const COPY = ['fontFamily', 'fontWeight', 'fontStyle', 'letterSpacing', 'wordSpacing', 'textTransform', 'whiteSpace', 'wordBreak', 'overflowWrap', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'borderLeftWidth', 'borderRightWidth', 'borderLeftStyle', 'borderRightStyle', 'textIndent'];
  /** The font size that fills `el`'s box (searched on the hidden copy; `el` itself isn't touched).
   * @param {HTMLElement} el @param {{ max?: number, min?: number, maxLines?: number }} [opts] @returns {number} */
  function fitSize(el, { max = 0.14, min = 0.032, maxLines = 4 } = {}) {
    const vh = window.innerHeight;
    let lo = Math.round(vh * min), hi = Math.round(vh * max), best = lo;
    const width = el.clientWidth || (el.parentElement ? el.parentElement.clientWidth : 0);
    const cs = getComputedStyle(el);
    // The copy: same text, same font settings, same width; line height kept as a ratio of the size.
    const lhRatio = (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25) / (parseFloat(cs.fontSize) || 16);
    const m = box();
    const c = /** @type {HTMLElement} */ (el.cloneNode(true));
    c.removeAttribute('id');
    for (const k of COPY) /** @type {any} */ (c.style)[k] = /** @type {any} */ (cs)[k];
    // Spacing given in em grows with the font: computed values are px at today's size, so pass them on
    // as a ratio (as px they'd stay small while the search tries big sizes, and the fit would overshoot).
    const fs0 = parseFloat(cs.fontSize) || 16;
    for (const k of /** @type {const} */ (['letterSpacing', 'wordSpacing'])) {
      const v = parseFloat(/** @type {any} */ (cs)[k]);
      /** @type {any} */ (c.style)[k] = Number.isFinite(v) ? `${v / fs0}em` : 'normal';
    }
    c.style.display = 'block'; c.style.margin = '0'; c.style.lineHeight = String(lhRatio);
    // Same box as the real one: border-box at its full width, so clientWidth/scrollWidth mean the same.
    c.style.boxSizing = 'border-box'; c.style.width = (el.offsetWidth || width) + 'px'; c.style.height = 'auto'; c.style.maxHeight = 'none'; c.style.overflow = 'visible';
    m.textContent = ''; m.appendChild(c);
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      c.style.fontSize = mid + 'px';
      const lines = Math.round(c.scrollHeight / (mid * lhRatio));
      if (c.scrollWidth <= c.clientWidth + 1 && lines <= maxLines) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    m.textContent = '';
    return best;
  }
  /** @param {HTMLElement} el @param {{ max?: number, min?: number, maxLines?: number }} [opts] */
  function fit(el, opts) {
    if (el && el.isConnected) el.style.fontSize = fitSize(el, opts) + 'px';
  }
  /** @param {Element | null} root */
  function fitAll(root) {
    if (!root) return;
    // All sizes first, then all writes: a write between two reads would force a whole-page layout each.
    const els = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-fit]')]).filter((el) => el.isConnected);
    const sizes = els.map((el) => {
      const [max, lines] = (el.dataset.fit || '').split(',').map(Number);
      return fitSize(el, { max: max || 0.14, maxLines: lines || 4 });
    });
    els.forEach((el, i) => { el.style.fontSize = sizes[i] + 'px'; });
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

  return { haptic, qrSrc, avUrl, time, esc, store, sfx, setMuted, isMuted, countdown, scoredList, signed, games, register, av, setState, morph, playerImg, playerUrl, fit, fitAll, hit };
})())));
