/*
 * GitHub Pages build — the PHONE side. window.io() returns a socket that connects to the TV
 * hosting the room (PeerJS, or local tabs with ?net=local). The room code comes from the link
 * (?code=ABCD), the saved seat, or the first player:joinRoom / player:rejoin the page sends.
 * Reconnects by itself, like socket.io. AGPLv3 — see LICENSE.
 */
'use strict';

const { Sock, pickTransport } = require('./net');

const BASE = location.pathname.replace(/[^/]*$/, '');

function io() {
  const transport = pickTransport();
  const sock = new Sock('phone');
  /** @type {string | null} */
  let code = null;
  let connecting = false;
  /** @type {number | null} */
  let retry = null;

  const connect = () => {
    if (!code || connecting || sock.connected) return;
    connecting = true;
    const want = code;
    transport.connect(want, (wire) => {
      connecting = false;
      if (want !== code) { wire.close(); connect(); return; }
      wire.onClose(() => { if (retry === null) retry = window.setTimeout(() => { retry = null; connect(); }, 1500); });
      sock.attach(wire);
      sock.fire('connect');
    }, (why) => {
      connecting = false;
      if (why === 'no-room') {
        // Tell the page the same way the Docker server would.
        sock.fire('player:joinError', { reason: 'No room with that code — is the TV on?' });
        sock.fire('player:rejoinFailed');
      } else if (retry === null) retry = window.setTimeout(() => { retry = null; connect(); }, 2000);
    });
  };

  /** @param {unknown} c */
  const useCode = (c) => {
    const next = String(c || '').toUpperCase().slice(0, 4);
    if (!/^[A-Z]{4}$/.test(next)) return;
    if (next !== code) { code = next; if (sock.connected) sock.disconnect(); }
    connect();
  };

  // The joining screen sends the code in its first message: open the right room then.
  const emit = sock.emit.bind(sock);
  sock.emit = (/** @type {string} */ ev, /** @type {any[]} */ ...args) => {
    if ((ev === 'player:joinRoom' || ev === 'player:rejoin') && args[0] && typeof args[0] === 'object') useCode(/** @type {any} */ (args[0]).code);
    return emit(ev, ...args);
  };
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
