'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { Sock } = require('../../web/net');

function wire(send) { return { send, onMessage() {}, onClose() {}, close() {} }; }

test('expired offline requests are not replayed when the link returns', async () => {
  const socket = new Sock('offline');
  socket.emit('keep-this');
  const error = await new Promise((resolve) => socket.timeout(5).emit('player:submit', { payload: { choice: 1 } }, resolve));
  assert.ok(error instanceof Error);
  assert.equal(socket.acks.size, 0);
  const sent = [];
  socket.attach(wire((message) => sent.push(message)));
  assert.deepEqual(sent.map((message) => message.ev), ['keep-this']);
});

test('an immediate acknowledgement succeeds once without throwing', async () => {
  const socket = new Sock('immediate');
  socket.attach(wire((message) => socket.receive({ t: 'a', id: message.ack, args: [{ ok: true }] })));
  let calls = 0;
  await new Promise((resolve, reject) => {
    socket.timeout(5).emit('debug:ping', (error, result) => {
      calls++;
      if (error) reject(error); else { assert.deepEqual(result, { ok: true }); resolve(); }
    });
  });
  assert.equal(calls, 1);
  assert.equal(socket.acks.size, 0);
});

function countdownHarness() {
  const intervals = new Map();
  let next = 0;
  const element = { textContent: '', classList: { toggle() {} } };
  const context = vm.createContext({
    window: {}, Date,
    document: { querySelectorAll: () => [element] },
    setInterval: (fn) => { intervals.set(++next, fn); return next; },
    clearInterval: (id) => intervals.delete(id),
  });
  vm.runInContext(fs.readFileSync('public/common.js', 'utf8'), context);
  return { countdown: context.window.Rumpus.countdown, intervals, element };
}

test('an already-expired countdown renders zero without leaving an interval running', () => {
  const { countdown, intervals, element } = countdownHarness();
  const ticks = [];
  countdown(Date.now() - 1000, '#timer', (left) => ticks.push(left));
  assert.equal(element.textContent, '0s');
  assert.deepEqual(ticks, [0]);
  assert.equal(intervals.size, 0);
});

test('a live countdown updates immediately and releases its interval at zero', () => {
  const { countdown, intervals, element } = countdownHarness();
  countdown(Date.now() + 60000, '#timer');
  assert.equal(element.textContent, '60s');
  assert.equal(intervals.size, 1);
  countdown(Date.now() - 1000, '#timer');
  assert.equal(element.textContent, '0s');
  assert.equal(intervals.size, 0);
});
