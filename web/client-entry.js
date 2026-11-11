/*
 * GitHub Pages build — the PHONE side. window.io() returns a socket that connects to the TV
 * hosting the room (PeerJS, or local tabs with ?net=local). The room code comes from the link
 * (?code=ABCD), the saved seat, or the first player:joinRoom / player:rejoin the page sends.
 * Reconnects by itself, like socket.io. AGPLv3 — see LICENSE.
 */
'use strict';

const { Sock, pickTransport } = require('./net');
const { offline } = require('./offline');

offline('phone');

const BASE = location.pathname.replace(/[^/]*$/, '');

function io() {
  const transport = pickTransport();
  const sock = new Sock('phone');
  /** @type {string | null} */
  let code = null;
  let connecting = false;
  /** Stopped by the page (left the room, or the seat moved to another tab): don't reconnect. */
  let stopped = false;
  /** @type {number | null} */
  let retry = null;
  /** @type {(import('./net').Wire & { check?: () => void }) | null} */
  let live = null;
  let tries = 0;

  /** Try again soon: quickly at first, then every few seconds. */
  const again = () => {
    if (retry !== null || stopped) return;
    const wait = Math.min(4000, 400 + tries * 600);
    tries++;
    retry = window.setTimeout(() => { retry = null; connect(); }, wait);
  };
  const connect = () => {
    if (!code || connecting || sock.connected || stopped) return;
    connecting = true;
    const want = code;
    transport.connect(want, (wire) => {
      connecting = false;
      if (want !== code || stopped) { wire.close(); connect(); return; }
      tries = 0;
      live = wire;
      wire.onClose(() => { if (live === wire) live = null; again(); });
      sock.attach(wire);
      sock.fire('connect');
    }, (why) => {
      connecting = false;
      if (want !== code) { connect(); return; } // the player typed another code meanwhile: open that one
      // Many failures in a row that aren't "no such room": the phone can't reach the broker (no
      // internet on this Wi-Fi?). Say so once — the join button comes back — and keep trying.
      if (why !== 'no-room' && tries === 8 && !sock.data.everJoined) sock.fire('player:joinError', { reason: "Can't reach the TV — is this phone online? Still trying…" });
      // A room that vanished for good (the TV page was closed): give up after about a minute.
      if (why === 'no-room' && (!sock.data.everJoined || tries > 15)) {
        // Tell the page the same way the Docker server would.
        sock.fire('player:joinError', { reason: 'No room with that code — is the TV on?' });
        sock.fire('player:rejoinFailed');
      } else again();
    });
  };

  /** @param {unknown} c */
  const useCode = (c) => {
    const next = String(c || '').toUpperCase().slice(0, 4);
    if (!/^[A-Z]{4}$/.test(next)) return;
    stopped = false;
    if (next !== code) { code = next; if (sock.connected) Sock.prototype.disconnect.call(sock); }
    connect();
  };

  // The joining screen sends the code in its first message: open the right room then.
  const emit = sock.emit.bind(sock);
  sock.emit = (/** @type {string} */ ev, /** @type {any[]} */ ...args) => {
    if ((ev === 'player:joinRoom' || ev === 'player:rejoin') && args[0] && typeof args[0] === 'object') useCode(/** @type {any} */ (args[0]).code);
    return emit(ev, ...args);
  };
  sock.on('player:joined', () => { sock.data.everJoined = true; });
  // socket.io's disconnect() / connect(): the page stops (left, or replaced by another tab) and resumes.
  sock.disconnect = () => { stopped = true; if (retry !== null) { clearTimeout(retry); retry = null; } return Sock.prototype.disconnect.call(sock); };
  /** @type {any} */ (sock).connect = () => { stopped = false; connect(); return sock; };
  // A phone waking up: drop a link that went quiet while asleep and reconnect straight away.
  const wake = () => {
    if (document.visibilityState !== 'visible' || stopped) return;
    if (live && live.check) live.check(); // a quick "still there?" (it closes itself if not)
    if (!sock.connected) { if (retry !== null) { clearTimeout(retry); retry = null; } tries = 0; connect(); }
  };
  document.addEventListener('visibilitychange', wake);
  addEventListener('pageshow', wake);
  addEventListener('online', wake);
  addEventListener('focus', wake);
  try {
    const q = new URLSearchParams(location.search).get('code');
    const seat = JSON.parse(localStorage.getItem('rumpus.seat') || 'null');
    useCode(q || (seat && seat.code));
  } catch (e) { /* no saved seat */ }
  return sock;
}

// Phones only need /api/info (the tilt game asks for an https address; Pages already is https).
const realFetch = window.fetch.bind(window);
/** @param {RequestInfo | URL} input @param {RequestInit} [init] */
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname === BASE + 'api/info') return new Response(JSON.stringify({ publicUrl: location.origin + BASE, lan: [], https: [], httpsPort: null, p2p: true }), { headers: { 'Content-Type': 'application/json' } });
  return realFetch(input, init);
};

/** @type {any} */ (window).io = io;
/** @type {any} */ (window).CABIN = { p2p: true };
