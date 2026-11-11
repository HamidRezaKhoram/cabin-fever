/*
 * Rumpus — self-hosted Jackbox-style party game platform.
 * Copyright (C) 2026
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version. See LICENSE for details.
 */
'use strict';

const os = require('os');
const path = require('path');
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const fs = require('fs');
const QRCode = require('qrcode');
const library = require('./games/library');
const stats = require('./games/stats');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DEBUG = process.env.RUMPUS_DEBUG === '1';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const MUSIC_DIR = process.env.RUMPUS_MUSIC_DIR || path.join(__dirname, 'music');

const core = require('./core/rooms');
const { rooms, hostPayload, playerPayload, GAME_LIST } = core;

const app = express();
const server = http.createServer(app);
// Drawings travel as data URLs; allow up to 2 MB per message. Short pings: a phone that fell
// asleep is noticed in ~10 s and its seat waits for it (core/rooms.js).
const io = new Server(server, { maxHttpBufferSize: 2e6, pingInterval: 5000, pingTimeout: 5000 });

app.get('/', (req, res) => res.redirect('/play'));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
// Pretty URLs the TV links to (static would only serve /admin.html, /highlights.html).
app.get('/admin', (/** @type {any} */ req, /** @type {any} */ res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/highlights', (/** @type {any} */ req, /** @type {any} */ res) => res.sendFile(path.join(__dirname, 'public', 'highlights.html')));

// LAN addresses so the TV can show a scannable URL even when opened via localhost.
function lanAddresses() {
  const out = [];
  const skip = /^(lo|docker|br-|veth|virbr|podman|cni|flannel|tun|tap|wg|tailscale)/i;
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

// Debug only (RUMPUS_DEBUG=1): the exact payloads the TV and each phone (bots included) would get
// right now. The bots test records these as screen snapshots; the browser test renders them all.
if (DEBUG) {
  // How busy the server is: event-loop delay (how late timers and messages get handled) + memory.
  const loop = require('perf_hooks').monitorEventLoopDelay({ resolution: 5 });
  loop.enable();
  app.get('/api/debug/perf', (/** @type {any} */ req, /** @type {any} */ res) => {
    const ms = (/** @type {number} */ ns) => Math.round(ns / 1e4) / 100;
    const out = { loopP50: ms(loop.percentile(50)), loopP99: ms(loop.percentile(99)), loopMax: ms(loop.max), rssMb: Math.round(process.memoryUsage().rss / 1048576) };
    if (req.query.reset) loop.reset();
    res.json(out);
  });
  app.get('/api/debug/views', (/** @type {any} */ req, /** @type {any} */ res) => {
    const room = rooms.get(String(req.query.room || '').toUpperCase());
    if (!room) return res.status(404).json({ error: 'no room' });
    res.json({ host: hostPayload(room), players: [...room.players.values()].map((p) => playerPayload(room, p)) });
  });
}

app.get('/api/info', (req, res) => {
  res.json({ publicUrl: PUBLIC_URL || null, lan: lanAddresses().map((ip) => `http://${ip}:${PORT}`),
    // The secure twin (for phone tilt sensors, which browsers only allow on https).
    https: httpsPort ? lanAddresses().map((ip) => `https://${ip}:${httpsPort}`) : [], httpsPort: httpsPort || null });
});

app.get('/qr.svg', async (req, res) => {
  const data = String(req.query.data || '').slice(0, 300);
  if (!/^https?:\/\//.test(data)) { res.status(400).end(); return; }
  try {
    const svg = await QRCode.toString(data, { type: 'svg', margin: 1, color: { dark: '#14121f', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'max-age=3600').send(svg);
  } catch (e) {
    res.status(500).end();
  }
});

// Optional: your own background music (mp3/ogg/m4a) in ./music replaces the chiptunes.
// music/<scenario>/*.mp3 (e.g. music/final, music/game/quiplash); files in music/ itself = "any".
const AUDIO_RE = /\.(mp3|ogg|m4a|wav|opus)$/i;
function musicCategories() {
  /** @type {Record<string, string[]>} */
  const out = {};
  /** @param {string} dir @param {string} rel @param {number} depth */
  const walk = (dir, rel, depth) => {
    /** @type {import('fs').Dirent[]} */
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && depth < 2) walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1);
      else if (e.isFile() && AUDIO_RE.test(e.name)) {
        const cat = rel || 'any';
        (out[cat] = out[cat] || []).push('/music/' + (rel ? rel.split('/').map(encodeURIComponent).join('/') + '/' : '') + encodeURIComponent(e.name));
      }
    }
  };
  walk(MUSIC_DIR, '', 0);
  return out;
}
app.get('/api/music', (req, res) => res.json(musicCategories()));
// Measured per-track info (tools/music-manifest.py): loudness gain + bitrate, keyed by URL.
app.get('/api/music-info', (req, res) => {
  /** @type {Record<string, {gain: number, kbps: number}>} */
  const out = {};
  try {
    const m = JSON.parse(fs.readFileSync(path.join(MUSIC_DIR, 'manifest.json'), 'utf8'));
    for (const [rel, v] of Object.entries(m)) out['/music/' + rel.split('/').map(encodeURIComponent).join('/')] = v;
  } catch (e) { /* no manifest: the TV measures tracks itself */ }
  res.json(out);
});
app.use('/music', express.static(MUSIC_DIR, { maxAge: '1d' }));
// The narrator's natural voice (Kokoro model + runtime, fetched once by tools/fetch-kokoro.js;
// the Docker image has it in /app/tts). Absent → the TV falls back to espeak / the browser voice.
const TTS_DIR = process.env.RUMPUS_TTS_DIR || [path.join(__dirname, 'tts'), path.join(__dirname, 'vendor', 'kokoro')].find((d) => fs.existsSync(d)) || path.join(__dirname, 'tts');
app.get('/api/voice', (req, res) => res.json({ available: fs.existsSync(path.join(TTS_DIR, 'model', 'config.json')) }));
app.use('/tts', express.static(TTS_DIR, {
  maxAge: '30d',
  setHeaders: (/** @type {any} */ res, /** @type {string} */ file) => { if (file.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript'); },
}));
// --- /admin: house rules + content editor (local network, no auth by design) --------
app.use('/api/admin', express.json({ limit: '64kb' }));
const admin = require('./core/admin');
/** @param {any} res @param {{ status: number, body: Record<string, any> }} r */
const reply = (res, r) => res.status(r.status).json(r.body);
app.get('/api/admin/rules', (/** @type {any} */ req, /** @type {any} */ res) => reply(res, admin.getRules(GAME_LIST)));
app.post('/api/admin/rules', (/** @type {any} */ req, /** @type {any} */ res) => reply(res, admin.setRules(req.body)));
app.get('/api/admin/content/:pool', (/** @type {any} */ req, /** @type {any} */ res) => reply(res, admin.listContent(String(req.params.pool), String(req.query.q || ''), Number(req.query.page) || 0)));
app.post('/api/admin/content/:pool', (/** @type {any} */ req, /** @type {any} */ res) => reply(res, admin.addContent(String(req.params.pool), req.body)));
app.post('/api/admin/content/:pool/:id/disabled', (/** @type {any} */ req, /** @type {any} */ res) => reply(res, admin.setDisabled(String(req.params.pool), String(req.params.id), !!(req.body && req.body.disabled))));
app.delete('/api/admin/content/:pool/:id', (/** @type {any} */ req, /** @type {any} */ res) => reply(res, admin.removeContent(String(req.params.pool), String(req.params.id))));

// Narrator: text → WAV with espeak-ng (installed in the container; fully offline).
/** @type {Map<string, Buffer>} */
const ttsCache = new Map();
const TTS_CACHE_BYTES = 24 * 1024 * 1024;
let ttsBytes = 0;
let ttsBusy = 0;
app.get('/api/tts', (/** @type {any} */ req, /** @type {any} */ res) => {
  const text = String(req.query.text || '').replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '').trim().slice(0, 240);
  if (!text) { res.status(400).end(); return; }
  const cacheKey = (req.query.lang === 'fr' ? 'fr:' : 'en:') + text;
  if (ttsCache.has(cacheKey)) { res.type('audio/wav').send(ttsCache.get(cacheKey)); return; }
  // Only a few voices render at once (each is a process); the TV only ever wants the next line.
  if (ttsBusy >= 3) { res.status(503).end(); return; }
  ttsBusy++;
  let released = false;
  const release = () => { if (!released) { released = true; ttsBusy--; } };
  /** @type {Buffer[]} */
  const chunks = [];
  // A cheery game-show voice: US English, male variant 3, a bit fast and high.
  const voice = req.query.lang === 'fr' ? 'fr+m3' : 'en-us+m3';
  const p = require('child_process').spawn('espeak-ng', ['-v', voice, '-s', '165', '-p', '60', '--stdout', text]);
  p.on('error', () => { release(); if (!res.headersSent) res.status(501).json({ error: 'no narrator voice installed' }); });
  p.stdout.on('data', (/** @type {Buffer} */ d) => chunks.push(d));
  p.on('close', (/** @type {number} */ code) => {
    release();
    if (res.headersSent) return;
    if (code !== 0 || !chunks.length) { res.status(501).json({ error: 'narrator failed' }); return; }
    const wav = Buffer.concat(chunks);
    const had = ttsCache.get(cacheKey);
    if (had) ttsBytes -= had.length; // two requests for the same line raced
    ttsCache.set(cacheKey, wav);
    ttsBytes += wav.length;
    // Capped by size (a long line is ~0.5 MB of WAV): oldest out first.
    while (ttsBytes > TTS_CACHE_BYTES && ttsCache.size > 1) {
      const [k, v] = /** @type {[string, Buffer]} */ (ttsCache.entries().next().value);
      ttsCache.delete(k);
      ttsBytes -= v.length;
    }
    res.type('audio/wav').send(wav);
  });
});

// Highlights + hall of fame (tonight's room if ?room=CODE).
app.get('/api/highlights', (/** @type {any} */ req, /** @type {any} */ res) => { // express is untyped here
  const room = rooms.get(String(req.query.room || '').toUpperCase()) || null;
  res.json(stats.summary(room));
});
app.get('/api/content-stats', (req, res) => res.json(library.stats()));

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', core.connection);

// --- optional https twin -------------------------------------------------------------
// Phone motion sensors (Lantern Lake) only work on https. With RUMPUS_HTTPS_PORT set we make a
// self-signed certificate once (offline, openssl) and serve the same app + sockets on that port.
// Phones see a certificate warning the first time; everything else keeps using plain http.
const HTTPS_PORT = process.env.RUMPUS_HTTPS_PORT;
let httpsPort = 0;
function startHttps() {
  if (!HTTPS_PORT) return;
  const dir = path.join(process.env.RUMPUS_DATA_DIR || path.join(__dirname, 'data'), 'certs');
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  try {
    if (!fs.existsSync(key) || !fs.existsSync(cert)) {
      fs.mkdirSync(dir, { recursive: true });
      const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanAddresses().map((ip) => `IP:${ip}`)].join(',');
      require('child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
        '-subj', '/CN=Cottage party game (self-signed)', '-addext', `subjectAltName=${san}`, '-keyout', key, '-out', cert], { stdio: 'ignore' });
    }
    const secure = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, app);
    io.attach(secure);
    secure.listen(Number(HTTPS_PORT), () => {
      httpsPort = /** @type {import('net').AddressInfo} */ (secure.address()).port;
      console.log(`  https (tilt controls): port ${httpsPort}`);
    });
  } catch (e) {
    console.warn('[https] not available:', e instanceof Error ? e.message : e);
  }
}
startHttps();

server.listen(PORT, () => {
  const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
  console.log(`Rumpus listening on port ${port}`);
  console.log('TV screen:  /host   Phones:  /play');
  for (const ip of lanAddresses()) console.log(`  LAN: http://${ip}:${port}/host`);
});

// Exit promptly on `docker stop` (node as PID 1 ignores SIGTERM by default), saving what's pending.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    try { stats.flush(); library.flush(); } catch (e) { /* exiting anyway */ }
    process.exit(0);
  });
}
// Last line of defence: socket handlers and game timers are guarded already (core/rooms.js,
// games/base.js); anything else that slips through is logged instead of ending everyone's night.
process.on('uncaughtException', (e) => console.error('[server] uncaught error (kept running):', e));
process.on('unhandledRejection', (e) => console.error('[server] unhandled rejection (kept running):', e));
