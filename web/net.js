/*
 * The browser build's networking: a socket with the socket.io surface the game uses (on/emit/acks/
 * onAny/connected/disconnect/volatile/timeout), carried over one of two transports:
 *  - PeerJS (WebRTC data channels): the TV's browser is the server, phones connect to it directly;
 *    the free PeerJS broker only introduces them (game traffic never goes through it).
 *  - BroadcastChannel ("?net=local"): tabs of one browser talk to each other — used by the tests
 *    and handy for trying a game on one computer. No internet needed.
 * AGPLv3 — see LICENSE.
 */
'use strict';

const PREFIX = 'cabinfever-';

/** @typedef {{ t: 'e', ev: string, args: unknown[], ack?: number } | { t: 'a', id: number, args: unknown[] }} Msg */
/** A link to one peer: send a message, hear messages and the close. @typedef {{ send(m: Msg): void, onMessage(fn: (m: Msg) => void): void, onClose(fn: () => void): void, close(): void }} Wire */

class Sock {
  /** @param {string} id */
  constructor(id) {
    this.id = id;
    /** @type {Record<string, any>} */
    this.data = {};
    this.connected = false;
    /** @type {Map<string, ((...a: any[]) => void)[]>} */
    this.handlers = new Map();
    /** @type {((ev: string, ...a: any[]) => void)[]} */
    this.anyIn = [];
    /** @type {((ev: string, ...a: any[]) => void)[]} */
    this.anyOut = [];
    /** @type {Map<number, (...a: any[]) => void>} */
    this.acks = new Map();
    this.seq = 0;
    /** @type {Wire | null} */
    this.wire = null;
    /** @type {Msg[]} queued while not connected */
    this.queue = [];
  }

  /** @param {string} ev @param {(...a: any[]) => void} fn */
  on(ev, fn) { const l = this.handlers.get(ev) || []; l.push(fn); this.handlers.set(ev, l); return this; }
  /** @param {string} ev @param {(...a: any[]) => void} fn */
  once(ev, fn) { const w = (/** @type {any[]} */ ...a) => { this.off(ev, w); fn(...a); }; return this.on(ev, w); }
  /** @param {string} ev @param {(...a: any[]) => void} [fn] */
  off(ev, fn) { this.handlers.set(ev, fn ? (this.handlers.get(ev) || []).filter((x) => x !== fn) : []); return this; }
  /** @param {string} ev */
  listeners(ev) { return [...(this.handlers.get(ev) || [])]; }
  /** @param {(ev: string, ...a: any[]) => void} fn */
  onAny(fn) { this.anyIn.push(fn); return this; }
  /** @param {(ev: string, ...a: any[]) => void} fn */
  onAnyOutgoing(fn) { this.anyOut.push(fn); return this; }
  get volatile() { return this; }
  /** socket.io's `socket.timeout(ms).emit(ev, ..., cb)`: cb(err) if no reply in time. @param {number} ms */
  timeout(ms) {
    return {
      emit: (/** @type {string} */ ev, /** @type {any[]} */ ...args) => {
        const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        if (!cb) return this.emit(ev, ...args);
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; cb(new Error('timeout')); } }, ms);
        return this.emit(ev, ...args, (/** @type {any[]} */ ...r) => { if (!done) { done = true; clearTimeout(t); cb(null, ...r); } });
      },
    };
  }

  /** Send an event to the other side (a trailing function is an ack callback). @param {string} ev @param {any[]} args */
  emit(ev, ...args) {
    /** @type {number | undefined} */
    let ack;
    if (typeof args[args.length - 1] === 'function') { ack = ++this.seq; this.acks.set(ack, args.pop()); }
    for (const f of this.anyOut) f(ev, ...args);
    const m = /** @type {Msg} */ ({ t: 'e', ev, args, ack });
    if (this.wire && this.connected) this.wire.send(m); else this.queue.push(m);
    return this;
  }

  /** Fire local listeners (connect/disconnect and incoming events). @param {string} ev @param {any[]} args */
  fire(ev, ...args) { for (const f of this.listeners(ev)) { try { f(...args); } catch (e) { console.error(e); } } }

  /** @param {Msg} m */
  receive(m) {
    if (m.t === 'a') { const f = this.acks.get(m.id); this.acks.delete(m.id); if (f) f(...m.args); return; }
    const args = [...(m.args || [])];
    if (m.ack !== undefined) { const id = m.ack; args.push((/** @type {any[]} */ ...r) => { if (this.wire) this.wire.send({ t: 'a', id, args: r }); }); }
    for (const f of this.anyIn) f(m.ev, ...args);
    this.fire(m.ev, ...args);
  }

  /** Attach a live wire and flush anything queued. @param {Wire} wire */
  attach(wire) {
    this.wire = wire;
    this.connected = true;
    wire.onMessage((m) => this.receive(m));
    wire.onClose(() => { if (this.wire !== wire) return; this.connected = false; this.wire = null; this.fire('disconnect', 'transport close'); });
    const q = this.queue; this.queue = [];
    for (const m of q) wire.send(m);
  }

  disconnect() { const w = this.wire; this.connected = false; this.wire = null; if (w) w.close(); this.fire('disconnect', 'io client disconnect'); return this; }
}

/** Two in-memory wires joined back to back (the TV talking to the server in its own page). */
function pairWires() {
  /** @type {((m: Msg) => void)[]} */ const toA = [];
  /** @type {((m: Msg) => void)[]} */ const toB = [];
  /** @type {(() => void)[]} */ const closeA = [];
  /** @type {(() => void)[]} */ const closeB = [];
  // JSON round trip + a macrotask: behaves like a network (no shared objects, no re-entrancy).
  const deliver = (/** @type {((m: Msg) => void)[]} */ to, /** @type {Msg} */ m) => { const copy = JSON.parse(JSON.stringify(m)); setTimeout(() => to.forEach((f) => f(copy)), 0); };
  /** @type {Wire} */
  const a = { send: (m) => deliver(toB, m), onMessage: (f) => { toA.push(f); }, onClose: (f) => { closeA.push(f); }, close: () => { closeA.concat(closeB).forEach((f) => f()); } };
  /** @type {Wire} */
  const b = { send: (m) => deliver(toA, m), onMessage: (f) => { toB.push(f); }, onClose: (f) => { closeB.push(f); }, close: () => { closeA.concat(closeB).forEach((f) => f()); } };
  return [a, b];
}

// ------------------------------------------------------------------ transports
/** @typedef {{ listen(code: string, onConn: (w: Wire) => void, onError: (e: string) => void): () => void, connect(code: string, onOpen: (w: Wire) => void, onFail: (why: string) => void): void }} Transport */

/** PeerJS (WebRTC). @returns {Transport} */
function peerTransport() {
  const PeerCtor = /** @type {any} */ (window).Peer;
  /** @param {any} conn @returns {Wire} */
  const wrap = (conn) => ({
    send: (m) => { try { conn.send(m); } catch (e) { /* closing */ } },
    onMessage: (f) => conn.on('data', f),
    onClose: (f) => { conn.on('close', f); conn.on('error', f); },
    close: () => conn.close(),
  });
  return {
    listen(code, onConn, onError) {
      const peer = new PeerCtor(PREFIX + code);
      peer.on('connection', (/** @type {any} */ conn) => conn.on('open', () => onConn(wrap(conn))));
      peer.on('error', (/** @type {any} */ e) => onError(String(e && e.type || e)));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* destroyed */ } }); // broker blip: stay reachable
      return () => peer.destroy();
    },
    connect(code, onOpen, onFail) {
      const peer = new PeerCtor();
      peer.on('error', (/** @type {any} */ e) => onFail(e && e.type === 'peer-unavailable' ? 'no-room' : String(e && e.type || e)));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        conn.on('open', () => onOpen(wrap(conn)));
      });
    },
  };
}

/** BroadcastChannel between tabs of one browser. @returns {Transport} */
function localTransport() {
  return {
    listen(code, onConn) {
      const bc = new BroadcastChannel(PREFIX + code);
      /** @type {Map<string, { msg: ((m: Msg) => void)[], close: (() => void)[] }>} */
      const peers = new Map();
      bc.onmessage = (e) => {
        const { from, kind, data } = e.data || {};
        if (kind === 'hello') {
          const h = { msg: /** @type {((m: Msg) => void)[]} */ ([]), close: /** @type {(() => void)[]} */ ([]) };
          peers.set(from, h);
          bc.postMessage({ to: from, kind: 'welcome' });
          onConn({ send: (m) => bc.postMessage({ to: from, kind: 'msg', data: m }), onMessage: (f) => { h.msg.push(f); }, onClose: (f) => { h.close.push(f); }, close: () => { bc.postMessage({ to: from, kind: 'bye' }); h.close.forEach((f) => f()); peers.delete(from); } });
        } else if (kind === 'msg' && peers.has(from)) /** @type {any} */ (peers.get(from)).msg.forEach((/** @type {(m: Msg) => void} */ f) => f(data));
        else if (kind === 'bye' && peers.has(from)) { /** @type {any} */ (peers.get(from)).close.forEach((/** @type {() => void} */ f) => f()); peers.delete(from); }
      };
      return () => bc.close();
    },
    connect(code, onOpen, onFail) {
      const bc = new BroadcastChannel(PREFIX + code);
      const me = Math.random().toString(36).slice(2);
      /** @type {((m: Msg) => void)[]} */ const msg = [];
      /** @type {(() => void)[]} */ const close = [];
      let open = false;
      const t = setTimeout(() => { if (!open) { bc.close(); onFail('no-room'); } }, 1500);
      bc.onmessage = (e) => {
        const { to, kind, data } = e.data || {};
        if (to !== me) return;
        if (kind === 'welcome' && !open) {
          open = true; clearTimeout(t);
          onOpen({ send: (m) => bc.postMessage({ from: me, kind: 'msg', data: m }), onMessage: (f) => { msg.push(f); }, onClose: (f) => { close.push(f); }, close: () => { bc.postMessage({ from: me, kind: 'bye' }); bc.close(); close.forEach((f) => f()); } });
        } else if (kind === 'msg') msg.forEach((f) => f(data));
        else if (kind === 'bye') close.forEach((f) => f());
      };
      addEventListener('pagehide', () => bc.postMessage({ from: me, kind: 'bye' }));
      bc.postMessage({ from: me, kind: 'hello' });
    },
  };
}

/** `?net=local` (remembered for this tab) picks the tab-to-tab transport; otherwise PeerJS. */
function pickTransport() {
  let local = false;
  try {
    const q = new URLSearchParams(location.search).get('net');
    if (q) sessionStorage.setItem('cf.net', q);
    local = (q || sessionStorage.getItem('cf.net')) === 'local';
  } catch (e) { /* storage blocked: PeerJS */ }
  return local || !(/** @type {any} */ (window).Peer) ? localTransport() : peerTransport();
}

module.exports = { Sock, pairWires, pickTransport, PREFIX };
