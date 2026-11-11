/*
 * GitHub Pages build — the HOST side (TV page, plus /admin and /highlights on the same browser).
 * The game server (core/rooms.js and every game) runs right here in the page:
 *  - window.io() returns a socket wired to the in-page server (no network for the TV itself);
 *  - once the room has a code, phones can reach it through the transport (PeerJS or local tabs);
 *  - fetch('/api/...') is answered locally (house rules, content editor, highlights, info);
 *  - saved data (history, stats, house rules) lives in this browser's localStorage.
 * AGPLv3 — see LICENSE.
 */
'use strict';

const fsShim = require('./shims/fs');
const { Sock, pairWires, pickTransport, fastChannel, PREFIX } = require('./net');
const { qrDataUrl } = require('./qr');
const { offline } = require('./offline');

offline('tv');

/** The page's folder ("/cabin-fever/" on GitHub Pages, "/" elsewhere). */
const BASE = location.pathname.replace(/[^/]*$/, '');

/** @type {Promise<void> | null} */
let ready = null;
/** Content pools come with the build (one JSON file); everything waits for them. */
function boot() {
  if (!ready) {
    ready = fetch(BASE + 'content/pools.json').then((r) => r.json()).then((/** @type {Record<string, string>} */ map) => fsShim.preload(map));
  }
  return ready;
}
// The game modules are required lazily so they read the pools only after boot().
const core = () => /** @type {typeof import('../core/rooms')} */ (require('../core/rooms'));
const admin = () => /** @type {typeof import('../core/admin')} */ (require('../core/admin'));
const stats = () => /** @type {typeof import('../games/stats')} */ (require('../games/stats'));
const house = () => /** @type {typeof import('../games/house')} */ (require('../games/house'));

// ---- the TV's own socket + listening for phones
const transport = pickTransport();
/** @type {(() => void) | null} */
let stopListening = null;
let peerSeq = 0;

/** Phones can join room `code` from now on. @param {string} code */
function listen(code) {
  if (stopListening) stopListening();
  stopListening = transport.listen(code, (wire, path) => {
    const s = new Sock('phone-' + (++peerSeq));
    core().connection(/** @type {any} */ (s));
    s.attach(wire);
    s.fire('connect');
    // The phone went quiet (asleep) and is back on the same direct link: no new connection needed,
    // just ask it to take its seat again.
    wire.onRevive(() => { s.attach(wire); s.emit('net:resync'); });
    // Note how this phone is linked (straight over the Wi-Fi, or through an internet relay): the TV
    // marks relayed phones, since that path is the slow one.
    if (path) {
      setTimeout(() => {
        path().then((p) => {
          if (!p) return;
          s.data.net = p.type;
          if (p.type === 'relay') console.warn('[cabin fever] a phone is connected through an internet relay (slower): is it on the same Wi-Fi?');
        }).catch(() => {});
      }, 2000);
    }
  }, (err) => {
    console.warn('[cabin fever] could not open the room for phones:', err);
    if (err === 'unavailable-id') document.dispatchEvent(new CustomEvent('cf:room-taken', { detail: code }));
  });
}

/** socket.io's io() for the TV page: a socket to the server running in this page. */
function io() {
  const tv = new Sock('tv');
  void boot().then(() => {
    const server = new Sock('server-tv');
    const [a, b] = pairWires();
    core().connection(/** @type {any} */ (server));
    server.attach(a);
    tv.attach(b);
    tv.on('host:roomCreated', (/** @type {{ code: string }} */ m) => listen(m.code));
    server.fire('connect');
    tv.fire('connect');
  });
  return tv;
}

// ---- /api/* answered in the page
/** @param {number} status @param {unknown} body */
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** @param {string} rel path after the base, e.g. "api/admin/rules" @param {URLSearchParams} q @param {RequestInit | undefined} init */
function api(rel, q, init) {
  const method = (init && init.method) || 'GET';
  /** @type {Record<string, any>} */
  let body = {};
  try { body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }
  if (rel === 'api/info') return json(200, { publicUrl: location.origin + BASE, lan: [], https: [], httpsPort: null, p2p: true });
  if (rel === 'api/highlights') {
    const code = String(q.get('room') || '').toUpperCase();
    /** @type {any} */
    let tonight = null;
    try { tonight = code ? JSON.parse(localStorage.getItem('cf.tonight.' + code) || 'null') : null; } catch (e) { tonight = null; }
    return json(200, tonight || stats().summary(null));
  }
  if (rel === 'api/content-stats') return json(200, /** @type {any} */ (require('../games/library')).stats());
  if (rel === 'api/admin/rules') {
    const r = method === 'POST' ? admin().setRules(body) : admin().getRules(core().GAME_LIST);
    return json(r.status, r.body);
  }
  const m = /^api\/admin\/content\/([\w-]+)(?:\/([\w-]+)(\/disabled)?)?$/.exec(rel);
  if (m) {
    const [, pool, id, dis] = m;
    const r = id && dis ? admin().setDisabled(pool, id, !!body.disabled)
      : id && method === 'DELETE' ? admin().removeContent(pool, id)
        : method === 'POST' ? admin().addContent(pool, body)
          : admin().listContent(pool, String(q.get('q') || ''), Number(q.get('page')) || 0);
    return json(r.status, r.body);
  }
  return json(404, { error: 'not available in the browser version' });
}

const realFetch = window.fetch.bind(window);
/** @param {RequestInfo | URL} input @param {RequestInit} [init] */
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  const rel = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname.replace(/^\//, '');
  // Music lists and the voice flag are static files in the build; every other /api call is answered here.
  if (rel.startsWith('api/') && !rel.startsWith('api/music') && rel !== 'api/voice') { await boot(); return api(rel, url.searchParams, init); }
  return realFetch(input, init);
};

// ---- keep tonight's highlights readable from the /highlights tab; follow /admin edits
setInterval(() => {
  if (!ready) return;
  for (const room of /** @type {Map<string, any>} */ (core().rooms).values()) {
    try { localStorage.setItem('cf.tonight.' + room.code, JSON.stringify(stats().summary(room))); } catch (e) { /* full */ }
  }
}, 5000);
addEventListener('storage', (e) => {
  if (e.key && e.key.endsWith('/house-rules.json') && ready) house().reload();
});

/** @type {any} */ (window).io = io;
/** @type {any} */ (window).CABIN = { p2p: true, prefix: PREFIX, qrDataUrl, boot, fastChannel };
