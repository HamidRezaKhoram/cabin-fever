/*
 * Server-side narrator voice (Docker). Loads Kokoro in a worker thread at start-up (if the model
 * and the native ONNX runtime are there) and makes one short part of a line at a time, in order.
 * The TV asks for a line's parts one request each and starts playing the first as soon as it
 * arrives; a part whose request was dropped (the TV moved on to a newer line) is skipped.
 * Recently made parts are kept (by size) so repeated lines are instant. AGPLv3 — see LICENSE.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Voices the TV offers (must match tools/fetch-kokoro.js and public/host-character.js). */
const VOICES = ['af_heart', 'am_michael', 'bf_emma', 'bm_george'];
const CACHE_BYTES = 48 * 1024 * 1024;

/** @typedef {{ id: number, text: string, voice: string, done: (r: { rate?: number, samples?: Float32Array, error?: string }) => void, gone: () => boolean }} Job */

/** @type {any} */
let worker = null;
let state = /** @type {'off' | 'loading' | 'ready' | 'failed'} */ ('off');
/** @type {Job[]} */
const queue = [];
/** @type {Job | null} */
let busy = null;
let seq = 0;
/** @type {Map<string, Buffer>} WAV by voice + text */
const cache = new Map();
let cacheBytes = 0;

/** Which precision a voice folder holds (tools/fetch-kokoro.js writes voice.json). @param {string} dir */
function dtypeOf(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'model', 'voice.json'), 'utf8')).dtype || 'q8'; } catch (e) { /* older folder */ }
  return fs.existsSync(path.join(dir, 'model', 'onnx', 'model_quantized.onnx')) ? 'q8' : 'fp32';
}

/** Start loading the voice (once). Set RUMPUS_SERVER_VOICE=0 to leave it to the TV. @param {string} dir */
function start(dir) {
  if (state !== 'off') return;
  if (process.env.RUMPUS_SERVER_VOICE === '0' || !fs.existsSync(path.join(dir, 'model', 'config.json'))) { state = 'failed'; return; }
  state = 'loading';
  try {
    const { Worker } = require('worker_threads');
    // RUMPUS_VOICE_DTYPE picks another precision in the same folder (if its file is there).
    worker = new Worker(path.join(__dirname, 'voice-worker.mjs'), { workerData: { dir: path.join(dir, 'model'), dtype: process.env.RUMPUS_VOICE_DTYPE || dtypeOf(dir) } });
  } catch (e) { state = 'failed'; return; }
  worker.unref();
  worker.on('message', (/** @type {any} */ m) => {
    if (m.ready) { state = 'ready'; console.log(`  narrator: natural voice ready (server, ${process.env.RUMPUS_VOICE_DTYPE || dtypeOf(dir)})`); return pump(); }
    if (m.failed) { state = 'failed'; console.log(`  narrator: server voice not available (${m.failed.split('\n')[0]}); the TV makes its own`); return; }
    if (busy && m.id === busy.id) { const j = busy; busy = null; j.done(m); pump(); }
  });
  worker.on('error', (/** @type {Error} */ e) => { state = 'failed'; console.warn('[voice] worker error:', e.message); flushFailed(); });
  worker.on('exit', () => { if (state !== 'failed') state = 'failed'; flushFailed(); });
}

function flushFailed() {
  const all = [...(busy ? [busy] : []), ...queue.splice(0)];
  busy = null;
  for (const j of all) j.done({ error: 'voice stopped' });
}

function pump() {
  if (state !== 'ready' || busy) return;
  while (queue.length && queue[0].gone()) queue.shift(); // the TV moved on: skip
  const j = queue.shift();
  if (!j) return;
  busy = j;
  worker.postMessage({ id: j.id, text: j.text, voice: j.voice });
}

/** Float samples → 16-bit mono WAV. @param {Float32Array} samples @param {number} rate */
function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 0x7fff), 44 + i * 2);
  return buf;
}

/** @param {string} key @param {Buffer} w */
function remember(key, w) {
  const had = cache.get(key);
  if (had) cacheBytes -= had.length;
  cache.set(key, w);
  cacheBytes += w.length;
  while (cacheBytes > CACHE_BYTES && cache.size > 1) {
    const [k, v] = /** @type {[string, Buffer]} */ (cache.entries().next().value);
    cache.delete(k);
    cacheBytes -= v.length;
  }
}

/**
 * One part of a line as WAV. `gone()` says the asker left (skip it if not started).
 * @param {string} text @param {string} voice @param {() => boolean} gone @returns {Promise<Buffer | null>}
 */
function speak(text, voice, gone) {
  const v = VOICES.includes(voice) ? voice : VOICES[0];
  const key = v + '|' + text;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  if (state !== 'ready' && state !== 'loading') return Promise.resolve(null);
  return new Promise((resolve) => {
    queue.push({
      id: ++seq, text, voice: v, gone,
      done: (r) => {
        if (!r.samples || !r.rate) return resolve(null);
        const w = wav(r.samples, r.rate);
        remember(key, w);
        resolve(w);
      },
    });
    pump();
  });
}

const status = () => state;

module.exports = { start, speak, status, VOICES, dtypeOf };
