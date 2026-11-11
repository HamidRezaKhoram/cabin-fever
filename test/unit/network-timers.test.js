'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
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

