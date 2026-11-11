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
/** Messages a socket holds while its link is down. */
const MAX_QUEUE = 64;
/** Acks waiting for a reply (a reply that never comes would otherwise stay forever). */
const MAX_ACKS = 256;

/** @typedef {{ t: 'e', ev: string, args: unknown[], ack?: number } | { t: 'a', id: number, args: unknown[] } | { t: 'p' }} Msg */
/** A link to one peer: send a message, hear messages and the close. `sendFast` (WebRTC only) sends
 * on the unordered, no-retransmit channel: newest-wins traffic that must never wait behind a lost packet.
 * @typedef {{ send(m: Msg): void, sendFast?: (m: Msg) => void, onMessage(fn: (m: Msg) => void): void, onClose(fn: () => void): void, close(): void }} Wire */

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
    /** @type {WeakSet<Wire>} wires this socket already listens to */
    this.wired = new WeakSet();
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
  /** socket.io's volatile: sent now or dropped, never queued, no ack (tilt, keep-warm pings, 30 fps
   * frames). Over WebRTC it travels on the fast channel (see fastChannel below). */
  get volatile() {
    return {
      emit: (/** @type {string} */ ev, /** @type {any[]} */ ...args) => {
        if (!this.connected || !this.wire) return this;
        if (typeof args[args.length - 1] === 'function') args.pop();
        for (const f of this.anyOut) f(ev, ...args);
        const m = /** @type {Msg} */ ({ t: 'e', ev, args });
        if (this.wire.sendFast) this.wire.sendFast(m); else this.wire.send(m);
        return this;
      },
    };
  }
  /** socket.io's `socket.timeout(ms).emit(ev, ..., cb)`: cb(err) if no reply in time. @param {number} ms */
  timeout(ms) {
    return {
      emit: (/** @type {string} */ ev, /** @type {any[]} */ ...args) => {
        const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        if (!cb) return this.emit(ev, ...args);
        let done = false;
        this.emit(ev, ...args, (/** @type {any[]} */ ...r) => { if (!done) { done = true; clearTimeout(t); cb(null, ...r); } });
        const id = this.seq;
        // No reply in time: report it and forget the callback (a lost reply must not linger forever).
        const t = setTimeout(() => { this.acks.delete(id); if (!done) { done = true; cb(new Error('timeout')); } }, ms);
        return this;
      },
    };
  }

  /** Send an event to the other side (a trailing function is an ack callback). @param {string} ev @param {any[]} args */
  emit(ev, ...args) {
    /** @type {number | undefined} */
    let ack;
    if (typeof args[args.length - 1] === 'function') {
      ack = ++this.seq;
      this.acks.set(ack, args.pop());
      if (this.acks.size > MAX_ACKS) this.acks.delete(/** @type {number} */ (this.acks.keys().next().value));
    }
    for (const f of this.anyOut) f(ev, ...args);
    const m = /** @type {Msg} */ ({ t: 'e', ev, args, ack });
    if (this.wire && this.connected) this.wire.send(m);
    else {
      this.queue.push(m);
      // Offline for a long time: keep only the latest messages (older taps are stale anyway).
      if (this.queue.length > MAX_QUEUE) for (const old of this.queue.splice(0, this.queue.length - MAX_QUEUE)) if (old.t === 'e' && old.ack !== undefined) this.acks.delete(old.ack);
    }
    return this;
  }

  /** Fire local listeners (connect/disconnect and incoming events). @param {string} ev @param {any[]} args */
  fire(ev, ...args) { for (const f of this.listeners(ev)) { try { f(...args); } catch (e) { console.error(e); } } }

  /** @param {Msg} m */
  receive(m) {
    if (m.t === 'p') return; // heartbeat (handled by the wire)
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
    if (!this.wired.has(wire)) { // a revived link is attached again: listen only once
      this.wired.add(wire);
      wire.onMessage((m) => { if (this.wire === wire) this.receive(m); });
      wire.onClose(() => { if (this.wire !== wire) return; this.connected = false; this.wire = null; this.fire('disconnect', 'transport close'); });
    }
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

/** How often each side of a network link says "still here", and how long silence means it's dead.
 * A phone that goes to sleep stops sending; without this the TV would wait ~30 s for WebRTC to
 * notice, and a woken phone would sit on a dead link. */
const BEAT_MS = 2000;
const DEAD_MS = 7000;
/** The TV keeps a silent phone's direct link open this long: a phone waking from a short nap picks
 * up the same Wi-Fi link (no trip to the internet broker). */
const REVIVE_MS = 45000;
/** @typedef {Wire & { check(): void, onRevive(fn: () => void): void }} LiveWire */
/**
 * Wrap a network wire with a heartbeat. After DEAD_MS of silence it reports "closed" (the player
 * shows as asleep); with `revive` (the TV side) the link itself stays open for REVIVE_MS, and if the
 * phone speaks again `onRevive` fires instead of a costly reconnect. A side that was itself frozen
 * (a sleeping phone's timers stop) gives the link a moment to answer before judging it.
 * @param {Wire} raw @param {{ revive?: boolean }} [opts] @returns {LiveWire}
 */
function heartbeat(raw, opts = {}) {
  let last = Date.now();
  let tick = Date.now();
  /** @type {'live' | 'stale' | 'closed'} */
  let state = 'live';
  /** @type {(() => void)[]} */
  const onClose = [];
  /** @type {(() => void)[]} */
  const onRevive = [];
  /** @type {((m: Msg) => void)[]} */
  const onMsg = [];
  const hardClose = () => {
    if (state === 'closed') return;
    const wasLive = state === 'live';
    state = 'closed';
    clearInterval(timer);
    try { raw.close(); } catch (e) { /* already closed */ }
    if (wasLive) onClose.forEach((f) => f());
  };
  const goStale = () => {
    if (!opts.revive) return hardClose();
    state = 'stale';
    onClose.forEach((f) => f());
  };
  /** We were frozen (asleep): don't judge the link on old news, give it a moment to answer. */
  const grace = () => { last = Math.max(last, Date.now() - DEAD_MS + 2500); raw.send({ t: 'p' }); };
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - tick > BEAT_MS * 2.5) grace();
    tick = now;
    const quiet = now - last;
    if (state === 'live' && quiet > DEAD_MS) goStale();
    else if (state === 'stale' && quiet > REVIVE_MS) hardClose();
    if (state !== 'closed') raw.send({ t: 'p' });
  }, BEAT_MS);
  raw.onMessage((m) => {
    last = Date.now();
    if (state === 'stale') { state = 'live'; onRevive.forEach((f) => f()); }
    if (state === 'live' && m.t !== 'p') onMsg.forEach((f) => f(m));
  });
  raw.onClose(hardClose);
  return {
    send: (m) => { if (state !== 'closed') raw.send(m); },
    sendFast: (m) => { if (state !== 'closed') (raw.sendFast || raw.send)(m); },
    onMessage: (f) => { onMsg.push(f); },
    onClose: (f) => { onClose.push(f); },
    onRevive: (f) => { onRevive.push(f); },
    close: hardClose,
    /** Waking up: ping and give the link a couple of seconds before deciding it's gone. */
    check: () => { if (state === 'live') grace(); },
  };
}

// ------------------------------------------------------------------ transports
/** @typedef {{ listen(code: string, onConn: (w: LiveWire, path?: () => Promise<{ type: string, rtt: number | null } | null>) => void, onError: (e: string) => void): () => void, connect(code: string, onOpen: (w: Wire) => void, onFail: (why: string) => void): void }} Transport */

/** The fast channel's fixed id (both ends create it themselves; PeerJS's own channel gets 0 or 1). */
const FAST_ID = 77;
/** Don't pile up behind a slow link: past this much unsent data, fast messages are dropped. */
const FAST_BUFFER = 16 * 1024;
/**
 * A second data channel on an open WebRTC link: unordered and never retransmitted (like UDP), so a
 * lost packet is simply gone instead of holding up everything behind it. For newest-wins traffic
 * (tilt 15×/s). "Negotiated": both ends create it with the same id — announcing it the normal way
 * would be picked up by PeerJS as its own channel.
 * @param {RTCPeerConnection} pc @param {(m: Msg) => void} onMessage
 * @returns {{ send(m: Msg): boolean, ready(): boolean, props(): { ordered: boolean, maxRetransmits: number | null }, close(): void } | null}
 */
function fastChannel(pc, onMessage) {
  try {
    const ch = pc.createDataChannel('cf-fast', { negotiated: true, id: FAST_ID, ordered: false, maxRetransmits: 0 });
    ch.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch (err) { /* not ours */ } };
    return {
      /** True if it went out (or was deliberately dropped); false if this channel can't carry it. */
      send: (m) => {
        if (ch.readyState !== 'open') return false;
        if (ch.bufferedAmount > FAST_BUFFER) return true; // congested: drop — a newer one is coming
        try { ch.send(JSON.stringify(m)); return true; } catch (e) { return false; }
      },
      ready: () => ch.readyState === 'open',
      props: () => ({ ordered: ch.ordered, maxRetransmits: ch.maxRetransmits }),
      close: () => { try { ch.close(); } catch (e) { /* closed */ } },
    };
  } catch (e) { return null; } // an old browser: everything stays on the reliable channel
}

/** PeerJS (WebRTC). @returns {Transport} */
function peerTransport() {
  const PeerCtor = /** @type {any} */ (window).Peer;
  /** @param {any} conn @returns {Wire} */
  const wrap = (conn) => {
    /** @type {((m: Msg) => void)[]} */
    const hear = [];
    const send = (/** @type {Msg} */ m) => { try { conn.send(m); } catch (e) { /* closing */ } };
    const fast = conn.peerConnection ? fastChannel(conn.peerConnection, (m) => hear.forEach((f) => f(m))) : null;
    return {
      send,
      // Not open (yet) or not supported: the reliable channel carries it instead.
      sendFast: (m) => { if (!fast || !fast.send(m)) send(m); },
      onMessage: (f) => { hear.push(f); conn.on('data', f); },
      onClose: (f) => { conn.on('close', f); conn.on('error', f); },
      close: () => { if (fast) fast.close(); try { conn.close(); } catch (e) { /* closed */ } },
    };
  };
  /** The phone's one Peer (re-made only if the broker drops it for good). @type {any} */
  let mine = null;
  /** Connection attempts waiting on the phone's Peer. @type {Set<(why: string) => void>} */
  const pending = new Set();
  return {
    listen(code, onConn, onError) {
      const peer = new PeerCtor(PREFIX + code);
      peer.on('connection', (/** @type {any} */ conn) => conn.on('open', () => onConn(heartbeat(wrap(conn), { revive: true }), () => linkType(conn.peerConnection))));
      peer.on('error', (/** @type {any} */ e) => onError(String(e && e.type || e)));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* destroyed */ } }); // broker blip: stay reachable
      return () => peer.destroy();
    },
    connect(code, onOpen, onFail) {
      let settled = false;
      /** @param {string} why */
      const fail = (why) => { if (settled) return; settled = true; clearTimeout(deadline); pending.delete(fail); onFail(why); };
      if (mine && (mine.destroyed || mine.disconnected)) { try { mine.destroy(); } catch (e) { /* gone */ } mine = null; }
      if (!mine) {
        mine = new PeerCtor();
        mine.on('error', (/** @type {any} */ e) => {
          const type = e && e.type;
          if (type === 'peer-unavailable') { [...pending].forEach((f) => f('no-room')); return; }
          // Broker trouble: start over with a new Peer next time.
          try { mine.destroy(); } catch (x) { /* gone */ }
          mine = null;
          [...pending].forEach((f) => f(String(type || e)));
        });
      }
      pending.add(fail);
      // A deadline for the whole attempt: a broker that never opens (and never errors) must not
      // leave the phone "connecting" forever.
      const deadline = setTimeout(() => fail('timeout'), 15000);
      const peer = mine;
      const go = () => {
        if (settled) return;
        // JSON is several times faster than PeerJS's default binary packing for our state objects.
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        const t = setTimeout(() => { try { conn.close(); } catch (e) { /* closed */ } fail('timeout'); }, 10000);
        conn.on('open', () => {
          clearTimeout(t);
          if (settled) { conn.close(); return; }
          settled = true; clearTimeout(deadline); pending.delete(fail);
          onOpen(heartbeat(wrap(conn)));
        });
      };
      if (peer.open) go(); else peer.once('open', go);
    },
  };
}

/** Which way a WebRTC link actually goes: 'lan' (straight over the Wi-Fi), 'nat' (through the
 * router's public address) or 'relay' (through an internet TURN server — slow; happens when the
 * phone and TV can't see each other on the network). @param {RTCPeerConnection | undefined} pc
 * @returns {Promise<{ type: 'lan' | 'nat' | 'relay', rtt: number | null } | null>} */
async function linkType(pc) {
  if (!pc || !pc.getStats) return null;
  const stats = await pc.getStats();
  /** @type {any} */
  let pair = null;
  stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
  if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
  if (!pair) return null;
  const types = [stats.get(pair.localCandidateId), stats.get(pair.remoteCandidateId)].map((c) => c && c.candidateType);
  const type = types.includes('relay') ? 'relay' : types.every((t) => t === 'host') ? 'lan' : 'nat';
  return { type, rtt: typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : null };
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
          onConn(heartbeat({ send: (m) => bc.postMessage({ to: from, kind: 'msg', data: m }), onMessage: (f) => { h.msg.push(f); }, onClose: (f) => { h.close.push(f); }, close: () => { bc.postMessage({ to: from, kind: 'bye' }); h.close.forEach((f) => f()); peers.delete(from); } }, { revive: true }));
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
      const t = setTimeout(() => { if (!open) { bc.close(); close.forEach((f) => f()); onFail('no-room'); } }, 1500);
      bc.onmessage = (e) => {
        const { to, kind, data } = e.data || {};
        if (to !== me) return;
        if (kind === 'welcome' && !open) {
          open = true; clearTimeout(t);
          onOpen(heartbeat({ send: (m) => bc.postMessage({ from: me, kind: 'msg', data: m }), onMessage: (f) => { msg.push(f); }, onClose: (f) => { close.push(f); }, close: () => { bc.postMessage({ from: me, kind: 'bye' }); bc.close(); close.forEach((f) => f()); } }));
        } else if (kind === 'msg') msg.forEach((f) => f(data));
        else if (kind === 'bye') close.forEach((f) => f());
      };
      const bye = () => { try { bc.postMessage({ from: me, kind: 'bye' }); } catch (e) { /* closed */ } };
      addEventListener('pagehide', bye, { once: true });
      close.push(() => removeEventListener('pagehide', bye));
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

module.exports = { Sock, pairWires, pickTransport, heartbeat, fastChannel, PREFIX, BEAT_MS, DEAD_MS, REVIVE_MS };
