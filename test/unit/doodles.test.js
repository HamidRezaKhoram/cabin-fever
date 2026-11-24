'use strict';
/* Message in a Bottle's idle doodles: a player who has passed their step on can float up to 3 doodles
 * a step across the TV. They travel like the drawings (named in the view, the picture once in
 * `images`), which is what the website build (WebRTC) needs. */
const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, until, makeHost, makePlayer } = require('../helpers');

const doodle = (c) => 'data:image/png;base64,' + c.repeat(2000);

test('idle doodles: only after passing it on, 3 a step, the picture reaches the TV, junk is ignored', { timeout: 60000 }, async () => {
  const srv = await startServer();
  try {
    const h = await makeHost(srv);
    /** @type {Record<string, string>} every picture the TV was sent */
    const tvImages = {};
    h.sock.on('room:stateUpdate', (/** @type {any} */ s) => Object.assign(tvImages, (s.gameState && s.gameState.images) || {}));
    const ps = [];
    for (const n of ['Ann', 'Ben', 'Cat']) ps.push(await makePlayer(srv, h.code, n));
    await until(() => h.state.players.length === 3, 'joined');
    h.emit('host:startGame', { gameId: 'telephone' });
    await until(() => ps.every((p) => p.state && p.state.phase === 'tel-write'), 'writing');
    const [ann, ben] = ps;
    // Still writing: no doodle pad, and a doodle sent anyway is ignored.
    assert.strictEqual(ben.state.you.scribblesLeft, 0, 'no doodles before passing it on');
    ben.submit({ scribble: doodle('B') });
    ann.submit({ text: 'a moose on a dock' });
    await until(() => ann.state.you.submitted && ann.state.you.scribblesLeft === 3, 'Ann has 3 doodles to float');
    ann.submit({ scribble: 'javascript:alert(1)' }); // not a picture
    for (const c of ['A', 'B', 'C', 'D']) ann.submit({ scribble: doodle(c) }); // the 4th is one too many
    await until(() => (h.state.gameState.scribbles || []).length === 3 && ann.state.you.scribblesLeft === 0, 'three doodles float on the TV');
    const s = h.state.gameState.scribbles;
    assert.ok(s.every((/** @type {any} */ d) => d.by === 'Ann'), 'only Ann doodled (Ben was still writing)');
    for (const d of s) {
      assert.match(d.image, /^cfimg:/, 'named in the view');
      assert.ok(tvImages[d.image.slice(6)] && tvImages[d.image.slice(6)].startsWith('data:image/png'), 'the picture itself reached the TV');
    }
    assert.ok(!JSON.stringify(Object.values(tvImages)).includes('javascript'), 'junk never reaches the TV');
    // The next step starts with a fresh allowance (and last step's doodles don't replay).
    for (const p of ps.slice(1)) p.submit({ text: `${p.nickname} phrase` });
    await until(() => ps.every((p) => p.state.phase === 'tel-draw'), 'drawing');
    assert.deepStrictEqual(h.state.gameState.scribbles || [], [], 'a new step starts with no doodles on screen');
    ann.submit({ image: doodle('X') });
    await until(() => ann.state.you.submitted && ann.state.you.scribblesLeft === 3, 'a fresh 3 doodles for the drawing step');
  } finally { await srv.stop(); }
});
