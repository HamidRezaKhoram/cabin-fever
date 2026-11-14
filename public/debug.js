/* Rumpus debug mode — verbose stats + event log for development and tests.
 * AGPLv3, see LICENSE.
 *
 * Turn on:  add ?debug=1 to /host or /play (remembered), or press Ctrl+Shift+D.
 * Turn off: ?debug=0 or Ctrl+Shift+D again.
 *
 * Shows a panel with fps / frame timing, socket status + latency, room, phase,
 * round, timer, pace votes, players, and a scrolling log of every socket event
 * in (◀) and out (▶), phase changes, page errors and console errors.
 * window.Rumpus.debug exposes the log for automated tests.
 * The panel is click-through (pointer-events: none) so it never blocks the game.
 * Must load BEFORE socket.io is used (right after /socket.io/socket.io.js).
 */
'use strict';

(function () {
  const MAX_LOG = 400;
  /** @type {{ t: string, kind: string, msg: string }[]} */
  const log = [];
  /** @type {string[]} */
  const errors = [];
  const t0 = performance.now();
  let enabled = false;
  try {
    const q = new URLSearchParams(location.search).get('debug');
    if (q === '1') localStorage.setItem('rumpus.debug', '1');
    if (q === '0') localStorage.removeItem('rumpus.debug');
    enabled = localStorage.getItem('rumpus.debug') === '1';
  } catch (e) { enabled = /[?&]debug=1/.test(location.search); }

  const stamp = () => ((performance.now() - t0) / 1000).toFixed(2).padStart(7);
  /** @param {unknown} v */
  function short(v) {
    let s;
    try { s = JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 80 ? x.slice(0, 77) + '…' : x)); } catch (e) { s = String(v); }
    s = s == null ? String(v) : s;
    return s.length > 300 ? s.slice(0, 297) + '…' : s;
  }
  /** @param {string} kind @param {unknown} msg */
  function add(kind, msg) {
    const text = msg == null ? '' : String(msg);
    log.push({ t: stamp(), kind: String(kind), msg: text });
    if (log.length > MAX_LOG) log.shift();
    if (enabled) {
       
      console.debug(`[rumpus ${kind}] ${text}`);
      dirty = true;
    }
  }

  // ---- errors
  window.addEventListener('error', (e) => { errors.push(e.message); add('ERROR', `${e.message} @ ${e.filename}:${e.lineno}`); });
  window.addEventListener('unhandledrejection', (e) => { errors.push(String(e.reason)); add('ERROR', 'unhandled rejection: ' + e.reason); });
  const origErr = console.error.bind(console);
  console.error = (...a) => { add('console.error', a.map(String).join(' ')); origErr(...a); };

  // ---- socket.io hooks (wrap the io() factory)
  /** @type {{ status: string, latency: number | null, inCount: number, outCount: number, lastState: any, phase: string | null }} */
  const sock = { status: 'init', latency: null, inCount: 0, outCount: 0, lastState: null, phase: null };
  const origIo = window.io;
  if (origIo) {
    window.io = function (...args) {
      const s = origIo(...args);
      s.on('connect', () => { sock.status = 'connected ' + s.id; add('socket', 'connected ' + s.id); });
      s.on('disconnect', (/** @type {string} */ r) => { sock.status = 'DISCONNECTED (' + r + ')'; add('socket', 'disconnect: ' + r); });
      s.on('connect_error', (/** @type {Error} */ e) => { sock.status = 'connect_error'; add('socket', 'connect_error ' + e.message); });
      // Every socket event is counted. The log keeps its name (and phase changes) always, so a failed
      // test can print the tail; payloads are JSON-stringified only while the panel is on. The 30 Hz
      // Lantern frames and the phones' keep-warm are only counted (they'd flush the log in seconds).
      s.onAny((/** @type {string} */ ev, /** @type {any} */ payload) => { // any socket event: JSON from the server
        sock.inCount++;
        if (ev === 'room:frame') return;
        if (ev === 'room:stateUpdate') {
          sock.lastState = payload;
          const g = payload.gameState || {};
          const key = [payload.phase, g.round, g.matchIndex, g.chainIndex].join('/');
          if (key !== sock.phase) { add('PHASE', `${sock.phase || '-'} → ${key}`); sock.phase = key; }
          if (enabled) add('◀ state', `phase=${payload.phase} players=${(payload.players || []).length} pace=${short(payload.pace && payload.pace.counts)} g=${short(g).slice(0, 160)}`);
        } else add('◀ ' + ev, enabled ? short(payload) : '');
      });
      s.onAnyOutgoing((/** @type {string} */ ev, /** @type {unknown} */ payload) => {
        sock.outCount++;
        if (ev === 'k' || ev === 'debug:ping') return;
        add('▶ ' + ev, enabled ? short(payload) : '');
      });
      // latency probe: only while the panel shows it
      setInterval(() => {
        if (!enabled || !s.connected) return;
        const start = performance.now();
        s.timeout(2000).emit('debug:ping', () => { sock.latency = Math.round(performance.now() - start); });
      }, 3000);
      window.Rumpus.debugSocket = s;
      return s;
    };
    Object.assign(window.io, origIo);
  }

  // ---- panel
  /** @type {HTMLElement | null} */
  let panel = null;
  let dirty = true;
  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.innerHTML = '<div class="dbg-stats"></div><pre class="dbg-log"></pre>';
    const css = document.createElement('style');
    css.textContent = `#debug-panel{position:fixed;top:4px;right:4px;z-index:99;width:min(460px,96vw);max-height:60vh;display:flex;flex-direction:column;
      background:rgba(0,0,0,.72);color:#9f9;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;border:1px solid #3f3;pointer-events:none}
      @media (max-width:600px){#debug-panel{max-height:32vh;font-size:9px;opacity:.85}}
      #debug-panel .dbg-stats{padding:6px;border-bottom:1px solid #363;white-space:pre-wrap}
      #debug-panel .dbg-log{margin:0;padding:6px;overflow:auto;flex:1;white-space:pre-wrap;word-break:break-all;color:#cfc}
      #debug-panel .err{color:#f66}#debug-panel .ph{color:#ff6}`;
    document.head.appendChild(css);
    document.body.appendChild(panel);
    return panel;
  }
  function render() {
    if (!enabled) { if (panel) panel.style.display = 'none'; return; }
    ensurePanel().style.display = 'flex';
    const st = sock.lastState || {};
    const g = st.gameState || {};
    const clk = window.Rumpus.clock ? window.Rumpus.clock.stats() : { fps: 0, avgMs: 0, maxMs: 0, medianFps: 0, samples: 0 };
    const left = g.endsAt ? Math.max(0, (g.endsAt - Date.now()) / 1000).toFixed(1) + 's' : '-';
    const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' MB' : 'n/a';
    const pn = /** @type {HTMLElement} */ (panel);
    /** @type {ChildNode} */ (pn.firstChild).textContent =
      `DEBUG ${location.pathname}  up ${stamp().trim()}s  heap ${mem}\n` +
      `fps ${clk.fps ? clk.fps.toFixed(1) : '-'}  avg ${clk.avgMs ? clk.avgMs.toFixed(1) : '-'}ms  worst ${clk.maxMs ? clk.maxMs.toFixed(0) : '-'}ms  frames ${window.Rumpus.clock ? window.Rumpus.clock.frame() : '-'}\n` +
      `socket ${sock.status}  rtt ${sock.latency == null ? '-' : sock.latency + 'ms'}  in ${sock.inCount} out ${sock.outCount}\n` +
      `room ${st.code || '-'}  phase ${st.phase || '-'}  game ${g.gameId || '-'}  round ${g.round || '-'}/${g.totalRounds || '-'}  ×${g.multiplier || 1}\n` +
      `timer ${left}  pace ${short(st.pace || {})}\n` +
      `you ${short(st.you || {})}\n` +
      `players ${(st.players || []).map((/** @type {any} */ p) => `${p.nickname}:${p.score}${p.connected ? '' : '(off)'}`).join(' ')}\n` +
      `music ${window.Rumpus.music && window.Rumpus.music.isEnabled ? (window.Rumpus.music.isEnabled() ? 'on' : 'off') : '-'}  errors ${errors.length}`;
    if (dirty) {
      const pre = /** @type {HTMLElement} */ (pn.lastChild);
      pre.innerHTML = log.slice(-150).map((l) => {
        const cls = /ERROR|error/.test(l.kind) ? 'err' : l.kind === 'PHASE' ? 'ph' : '';
        return `<span class="${cls}">${l.t} ${l.kind.padEnd(10)} ${l.msg.replace(/[<&]/g, (/** @type {string} */ c) => (c === '<' ? '&lt;' : '&amp;'))}</span>`;
      }).join('\n');
      pre.scrollTop = pre.scrollHeight;
      dirty = false;
    }
  }
  setInterval(render, 500);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      enabled = !enabled;
      try { if (enabled) localStorage.setItem('rumpus.debug', '1'); else localStorage.removeItem('rumpus.debug'); } catch (er) { /* ignore */ }
      add('debug', enabled ? 'enabled' : 'disabled');
      render();
    }
  });

  window.Rumpus = window.Rumpus || /** @type {RumpusNS} */ ({});
  window.Rumpus.debug = {
    isEnabled: () => enabled,
    log: () => log.slice(),
    errors: () => errors.slice(),
    tail: (n = 40) => log.slice(-n).map((l) => `${l.t} ${l.kind} ${l.msg}`).join('\n'),
    add,
  };
  add('debug', `loaded on ${location.pathname}${enabled ? ' (panel ON)' : ''}`);
})();
