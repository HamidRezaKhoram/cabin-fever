// The Pages build's PeerJS links, against a fake PeerJS that behaves like the real one where it hurt:
// its JSON channel refuses messages of 16,300 bytes or more ("message-too-big", which our wire took
// for a close), and a broker drop emits a 'network' error while the direct links stay open.
// AGPLv3 — see LICENSE.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chunker, peerTransport, guardPeer, Sock, CHUNK } = require('../../web/net');

const PEERJS_JSON_LIMIT = 16300; // PeerJS 1.5.4 util.chunkedMTU

class FakeConn {
  constructor() { /** @type {Record<string, Function[]>} */ this.h = {}; /** @type {FakeConn | null} */ this.other = null; this.open = false; this.sizes = []; }
  on(ev, f) { (this.h[ev] = this.h[ev] || []).push(f); return this; }
  emit(ev, ...a) { (this.h[ev] || []).forEach((f) => f(...a)); }
  send(m) {
    const bytes = Buffer.byteLength(JSON.stringify(m));
    this.sizes.push(bytes);
    if (bytes >= PEERJS_JSON_LIMIT) { this.emit('error', { type: 'message-too-big' }); return; }
    const copy = JSON.parse(JSON.stringify(m));
    setImmediate(() => { if (this.open && this.other) this.other.emit('data', copy); });
  }
  close() { if (!this.open) return; this.open = false; this.emit('close'); if (this.other) this.other.close(); }
}

class FakePeer {
  constructor(id) {
    this.id = typeof id === 'string' ? id : 'phone-' + FakePeer.all.length;
    /** @type {Record<string, Function[]>} */ this.h = {};
    this.open = true; this.destroyed = false; this.disconnected = false;
    /** @type {FakeConn[]} */ this.conns = [];
    FakePeer.byId.set(this.id, this); FakePeer.all.push(this);
  }
  on(ev, f) { (this.h[ev] = this.h[ev] || []).push(f); return this; }
  once(ev, f) { const w = (...a) => { this.h[ev] = this.h[ev].filter((x) => x !== w); f(...a); }; return this.on(ev, w); }
  emit(ev, ...a) { (this.h[ev] || []).forEach((f) => f(...a)); }
  connect(id) {
    const mine = new FakeConn(), theirs = new FakeConn();
    mine.other = theirs; theirs.other = mine;
    this.conns.push(mine);
    setImmediate(() => {
      const tv = FakePeer.byId.get(id);
      if (!tv) return this.emit('error', { type: 'peer-unavailable' });
      tv.conns.push(theirs);
      tv.emit('connection', theirs);
      mine.open = theirs.open = true;
      theirs.emit('open'); mine.emit('open');
    });
    return mine;
  }
  reconnect() { this.reconnects = (this.reconnects || 0) + 1; }
  destroy() { this.destroyed = true; this.conns.forEach((c) => c.close()); }
}
FakePeer.byId = new Map();
/** @type {FakePeer[]} */ FakePeer.all = [];

/** A TV and a phone linked through the fake PeerJS. */
async function link() {
  FakePeer.byId.clear(); FakePeer.all.length = 0;
  global.window = /** @type {any} */ ({ Peer: FakePeer });
  global.document = /** @type {any} */ ({ dispatchEvent() {} });
  const net = peerTransport();
  const tvWire = new Promise((res) => net.listen('ABCD', (w) => res(w), () => {}));
  const phone = await new Promise((res, rej) => net.connect('ABCD', res, rej));
  const tv = await tvWire;
  const closed = { tv: false, phone: false };
  tv.onClose(() => { closed.tv = true; }); phone.onClose(() => { closed.phone = true; });
  const done = () => { tv.close(); phone.close(); delete global.window; delete global.document; };
  return { tv, phone, closed, done, phonePeer: FakePeer.all[1] };
}

/** @param {any} wire */
const next = (wire) => new Promise((res) => wire.onMessage(res));

test('a drawing (~60 KB) gets through the PeerJS link in pieces, and the link stays up', { timeout: 5000 }, async () => {
  const { tv, phone, closed, done } = await link();
  try {
    const drawing = 'data:image/jpeg;base64,' + 'A'.repeat(60000);
    const heard = next(tv);
    phone.send({ t: 'e', ev: 'player:submit', args: [{ payload: { drawing } }], ack: 1 });
    const m = await heard;
    assert.equal(m.args[0].payload.drawing, drawing);
    // And the TV sending a phone someone's drawing (Telephone) the other way.
    const back = next(phone);
    tv.send({ t: 'e', ev: 'state', args: [{ img: drawing, nick: 'Zoë "the 🦝"' }] });
    assert.equal((await back).args[0].img, drawing);
    assert.equal(closed.tv || closed.phone, false, 'the link must not close');
  } finally { done(); }
});

test('when the phone loses the broker (sleep, internet blip), its live game link to the TV stays open', { timeout: 5000 }, async () => {
  const { tv, phone, closed, done, phonePeer } = await link();
  try {
    phonePeer.disconnected = true;
    phonePeer.emit('error', { type: 'network' });
    phonePeer.emit('disconnected');
    await new Promise((r) => setImmediate(r));
    assert.equal(phonePeer.destroyed, false, 'the Peer holding the live link must not be destroyed');
    const heard = next(tv);
    phone.send({ t: 'e', ev: 'player:submit', args: [{ payload: { choice: 1 } }] });
    assert.equal((await heard).ev, 'player:submit');
    assert.equal(closed.tv || closed.phone, false);
  } finally { done(); }
});

test('chunker: every piece fits PeerJS, whatever the text (emoji, quotes, backslashes); small messages go whole', () => {
  /** @type {any[]} */ const out = [];
  const c = chunker((m) => out.push(m));
  const nasty = '🦝"\\é\u2028'.repeat(20000);
  c.send({ t: 'e', ev: 'x', args: [nasty] });
  assert.ok(out.length > 1);
  for (const piece of out) assert.ok(Buffer.byteLength(JSON.stringify(piece)) < PEERJS_JSON_LIMIT, 'piece too big for PeerJS');
  /** @type {any[]} */ const got = [];
  for (const piece of out) c.receive(piece, (m) => got.push(m));
  assert.equal(got.length, 1);
  assert.equal(got[0].args[0], nasty);
  out.length = 0;
  c.send({ t: 'p' });
  assert.deepEqual(out, [{ t: 'p' }]);
  assert.ok(CHUNK * 3 + 100 < PEERJS_JSON_LIMIT);
});

test('chunker: junk pieces from a peer are ignored, not crashes', () => {
  const c = chunker(() => {});
  /** @type {any[]} */ const got = [];
  for (const bad of [{ t: 'c' }, { t: 'c', id: 1, i: 5, n: 2, d: 'x' }, { t: 'c', id: 1, i: 0, n: 1e9, d: 'x' }, { t: 'c', id: 2, i: 0, n: 1, d: '{not json' }, { t: 'c', id: 3, i: 0, n: 1, d: 7 }]) {
    c.receive(bad, (m) => got.push(m));
  }
  assert.equal(got.length, 0);
});

test('the TV retries the broker with a growing wait, not in a tight loop while the internet is down', { timeout: 5000 }, async () => {
  const { tv, phone, done } = await link();
  try {
    const tvPeer = FakePeer.all[0];
    for (let k = 0; k < 50; k++) tvPeer.emit('disconnected'); // each failed reconnect fires it again
    await new Promise((r) => setTimeout(r, 1100));
    assert.ok((tvPeer.reconnects || 0) <= 1, `one reconnect after a wait (got ${tvPeer.reconnects})`);
    void tv; void phone;
  } finally { done(); }
});

test('a phone can\'t send the TV its commands or fake link events (anyone online can reach a room code)', () => {
  const s = guardPeer(new Sock('phone-1'));
  /** @type {string[]} */ const heard = [];
  for (const ev of ['host:endGame', 'host:kickPlayer', 'disconnect', 'connect', 'net:resync', 'player:submit']) s.on(ev, () => heard.push(ev));
  for (const ev of ['host:endGame', 'host:kickPlayer', 'disconnect', 'connect', 'net:resync', 'player:submit']) s.receive({ t: 'e', ev, args: [] });
  s.receive(/** @type {any} */ ({ t: 'e', ev: { toString: () => 'x' }, args: [] }));
  assert.deepStrictEqual(heard, ['player:submit'], 'only player messages get through');
  // The TV's own code can still fire them (its link really dropping).
  s.fire('disconnect');
  assert.deepStrictEqual(heard, ['player:submit', 'disconnect']);
});
