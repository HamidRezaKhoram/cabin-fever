'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Execute the actual send handler with controlled transport replies and screen changes.
function phone() {
  const source = fs.readFileSync('public/play.js', 'utf8');
  let reply;
  let slow;
  const classes = new Set();
  const button = { disabled: true, classList: { remove: () => {} } };
  const context = vm.createContext({
    lastScreenKey: 'question-1', ended: false,
    window: { setTimeout: (fn) => { slow = fn; return 1; } },
    clearTimeout: () => {}, setTimeout: () => {},
    document: { body: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } } },
    socket: { timeout: () => ({ emit: (ev, data, cb) => { reply = cb; } }) },
    gameView: { querySelectorAll: () => [button] }, banner: { hidden: true },
  });
  vm.runInContext(source.slice(source.indexOf('let sendSeq = 0;'), source.indexOf('/** Newest-wins input')), context);
  vm.runInContext('send({ answer: 1 })', context);
  return { context, classes, button, reply: (...args) => reply(...args), slow: () => slow() };
}

test('failed answer restores controls on the current question', () => {
  const p = phone();
  p.slow();
  assert.ok(p.classes.has('sending'));
  p.reply(new Error('timeout'));
  assert.equal(p.button.disabled, false);
  assert.equal(p.context.banner.hidden, false);
  assert.equal(p.classes.has('sending'), false);
});

test('late answer failure cannot unlock a later question or show a stale error', () => {
  const p = phone();
  p.context.lastScreenKey = 'question-2';
  p.slow();
  assert.equal(p.classes.has('sending'), false);
  p.reply(new Error('timeout'));
  assert.equal(p.button.disabled, true);
  assert.equal(p.context.banner.hidden, true);
});

test('successful answer leaves controls locked until the next server view', () => {
  const p = phone();
  p.reply(null, { ok: true });
  assert.equal(p.button.disabled, true);
  assert.equal(p.context.banner.hidden, true);
});

function joinPhone(connected) {
  const source = fs.readFileSync('public/play.js', 'utf8');
  let submit;
  let timeout;
  let emissions = 0;
  const button = { disabled: false, textContent: 'Join' };
  const form = {
    addEventListener: (ev, fn) => { submit = fn; },
    querySelector: () => button, setAttribute: () => {},
  };
  const context = vm.createContext({
    joinForm: form, joinError: { textContent: '', addEventListener() {} },
    codeInput: { value: 'ABCD' }, nickInput: { value: 'Sam' },
    socket: { connected, emit: () => { emissions++; } },
    store: () => {}, DEVICE: 'device', myAvatar: 0, avatarMode: 'pick',
    window: { setTimeout: (fn) => { timeout = fn; return 1; } },
    clearTimeout: () => {}, keepAwake: () => {},
  });
  vm.runInContext(source.slice(source.indexOf("function askToJoin("), source.indexOf("leaveBtn.addEventListener('click'")), context);
  return { context, button, submit: () => submit({ preventDefault() {} }), timeout: () => timeout(), emissions: () => emissions };
}

test('browser-hosted rooms can start connecting from the first join request', () => {
  const p = joinPhone(false);
  p.submit();
  assert.equal(p.emissions(), 1);
  assert.equal(p.button.disabled, true);
  p.timeout();
  assert.equal(p.button.disabled, false);
});

test('joining prevents duplicates and recovers when the TV never replies', () => {
  const p = joinPhone(true);
  p.submit();
  p.submit();
  assert.equal(p.emissions(), 1);
  assert.equal(p.button.disabled, true);
  p.timeout();
  assert.equal(p.button.disabled, false);
  assert.equal(p.button.textContent, 'Join');
  assert.match(p.context.joinError.textContent, /did not respond/);
});
