'use strict';
/* Client effects with a fake 30 fps clock: the screen wipe must always call
 * its swap callback exactly once, even when phases change mid-wipe. */
const { test } = require('node:test');
const assert = require('node:assert');

function setup({ calm = false } = {}) {
  const subs = new Set();
  const canvas = () => ({ getContext: () => ({ clearRect() {}, fillRect() {} }), style: {}, className: '' });
  global.matchMedia = () => ({ matches: false });
  global.document = { createElement: canvas, body: { appendChild() {}, classList: { contains: (c) => calm && c === 'calm' } } };
  global.window = { Rumpus: { clock: { add: (fn) => { subs.add(fn); return () => subs.delete(fn); } } } };
  delete require.cache[require.resolve('../../public/fx.js')];
  require('../../public/fx.js');
  const tick = (n = 1) => { for (let i = 0; i < n; i++) for (const fn of [...subs]) fn(); };
  return { fx: window.Rumpus.fx, tick, subs };
}

test('wipe swaps the screen at the midpoint and cleans up', () => {
  const { fx, tick, subs } = setup();
  let calls = 0;
  fx.wipe(() => calls++);
  assert.strictEqual(fx.isWiping(), true);
  tick(8); assert.strictEqual(calls, 0);
  tick(1); assert.strictEqual(calls, 1);
  tick(20);
  assert.strictEqual(calls, 1);
  assert.strictEqual(fx.isWiping(), false);
  assert.strictEqual(subs.size, 0, 'unsubscribed from the clock');
});

test('a second wipe before the midpoint replaces the pending screen', () => {
  const { fx, tick } = setup();
  const seen = [];
  fx.wipe(() => seen.push('a'));
  tick(3);
  fx.wipe(() => seen.push('b'));
  tick(30);
  assert.deepStrictEqual(seen, ['b']);
});

test('a second wipe after the midpoint is applied immediately (regression: frozen TV)', () => {
  const { fx, tick } = setup();
  const seen = [];
  fx.wipe(() => seen.push('a'));
  tick(12); // past the midpoint, still wiping out
  fx.wipe(() => seen.push('b'));
  assert.deepStrictEqual(seen, ['a', 'b']);
  tick(30);
  assert.deepStrictEqual(seen, ['a', 'b']);
  // and a later wipe still works
  fx.wipe(() => seen.push('c'));
  tick(30);
  assert.deepStrictEqual(seen, ['a', 'b', 'c']);
});

test('🕊 Calm (TV setting): a wipe swaps the screen at once, with no animation and no clock use', () => {
  const { fx, subs } = setup({ calm: true });
  let calls = 0;
  fx.wipe(() => calls++);
  assert.strictEqual(calls, 1);
  assert.strictEqual(fx.isWiping(), false);
  assert.strictEqual(subs.size, 0);
});
