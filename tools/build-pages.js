#!/usr/bin/env node
/*
 * Build the GitHub Pages version into dist/ (no server: the TV's browser hosts the room).
 *   node tools/build-pages.js [outDir]
 * - bundles web/host-entry.js (TV, /admin, /highlights) and web/client-entry.js (phones) with the
 *   whole game server, using browser stand-ins for fs/path/crypto (web/shims);
 * - copies public/ with absolute paths made relative (Pages serves under /<repo>/);
 * - packs the content pools into content/pools.json, copies music/ + static api/music lists;
 * - writes sw.js: every file is cached in the browser by content hash, so after a new deploy
 *   only the files that changed are downloaded again (music is cached the first time it plays).
 * The Docker version is untouched. AGPLv3 — see LICENSE.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const PUB = path.join(ROOT, 'public');

/** @param {string} p */
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });
/** @param {string} p */
const mkdirp = (p) => fs.mkdirSync(p, { recursive: true });
/** @param {string} file @param {string | Buffer} data */
const write = (file, data) => { mkdirp(path.dirname(file)); fs.writeFileSync(file, data); };
/** @param {Buffer | string} data */
const hash = (data) => crypto.createHash('sha1').update(data).digest('hex').slice(0, 12);
/** All files under dir (relative paths, '/' separators). @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) for (const f of walk(p)) out.push(e.name + '/' + f);
    else out.push(e.name);
  }
  return out;
}

async function main() {
  // Empty the folder (it may be a mount point, so keep the folder itself).
  mkdirp(OUT);
  for (const e of fs.readdirSync(OUT)) rmrf(path.join(OUT, e));

  // 1. Bundles (the game server runs in the TV's page).
  const shims = path.join(ROOT, 'web', 'shims');
  /** @type {import('esbuild').BuildOptions} */
  const common = {
    bundle: true, platform: 'browser', format: 'iife', target: 'es2020', minify: true, sourcemap: false, logLevel: 'warning',
    alias: { fs: path.join(shims, 'fs.js'), path: path.join(shims, 'path.js'), crypto: path.join(shims, 'crypto.js') },
    define: { 'process.env': '{}', __dirname: '"/games"' },
  };
  await esbuild.build({ ...common, entryPoints: [path.join(ROOT, 'web', 'host-entry.js')], outfile: path.join(OUT, 'cf-host.js') });
  await esbuild.build({ ...common, entryPoints: [path.join(ROOT, 'web', 'client-entry.js')], outfile: path.join(OUT, 'cf-client.js') });
  write(path.join(OUT, 'vendor', 'peerjs.min.js'), fs.readFileSync(require.resolve('peerjs/dist/peerjs.min.js')));

  // 2. The pages and their files, with absolute paths made relative.
  const top = fs.readdirSync(PUB).concat(['play', 'host', 'admin', 'highlights', 'api', 'music', 'qr.svg', 'socket.io', 'content']);
  const names = [...new Set(top)].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|');
  const ABS = new RegExp(`(['"\`(=])\\/(?=(?:${names})(?:[/?#'"\`)\\s.]|$))`, 'g');
  for (const rel of walk(PUB)) {
    if (rel === 'sw.js') continue; // replaced below
    const src = path.join(PUB, rel);
    if (!/\.(html|js|css|webmanifest)$/.test(rel)) { write(path.join(OUT, rel), fs.readFileSync(src)); continue; }
    let s = fs.readFileSync(src, 'utf8').replace(ABS, '$1');
    if (rel.endsWith('.html')) {
      const phone = rel === 'play.html';
      const tags = (phone ? '<script src="vendor/peerjs.min.js"></script><script src="cf-client.js"></script>'
        : rel === 'host.html' ? '<script src="vendor/peerjs.min.js"></script><script src="cf-host.js"></script>'
          : '<script src="cf-host.js"></script>')
        + (phone ? '' : '<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});</script>');
      s = s.includes('<script src="socket.io/socket.io.js"></script>')
        ? s.replace('<script src="socket.io/socket.io.js"></script>', tags)
        : s.replace(/<script /, tags + '<script ');
    }
    write(path.join(OUT, rel), s);
  }
  // Extensionless page URLs (/play?code=ABCD) work on GitHub Pages; keep folder fallbacks too.
  for (const page of ['play', 'host', 'admin', 'highlights']) write(path.join(OUT, page, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=../${page}.html"><script>location.replace('../${page}.html' + location.search)</script>`);
  write(path.join(OUT, 'index.html'), fs.readFileSync(path.join(ROOT, 'web', 'index.html')));
  write(path.join(OUT, '.nojekyll'), '');
  // The narrator's natural voice, if fetched (tools/fetch-kokoro.js). Not precached: the TV loads
  // it on first use and transformers.js keeps it in the browser's cache; phones never download it.
  const voice = path.join(ROOT, 'vendor', 'kokoro');
  const hasVoice = fs.existsSync(path.join(voice, 'model', 'config.json'));
  if (hasVoice) fs.cpSync(voice, path.join(OUT, 'tts'), { recursive: true });
  else console.warn('narrator voice not fetched (node tools/fetch-kokoro.js): the browser voice will be used');
  write(path.join(OUT, 'api', 'voice'), JSON.stringify({ available: hasVoice }));

  // 3. Content pools in one file (preloaded into the browser stand-in for fs).
  /** @type {Record<string, string>} */
  const pools = {};
  const poolDir = path.join(ROOT, 'games', 'data', 'pools');
  for (const f of fs.readdirSync(poolDir).filter((x) => x.endsWith('.json'))) pools['/games/data/pools/' + f] = fs.readFileSync(path.join(poolDir, f), 'utf8');
  write(path.join(OUT, 'content', 'pools.json'), JSON.stringify(pools));

  // 4. Music + the lists the TV asks for (/api/music, /api/music-info) as static files.
  const MUSIC = path.join(ROOT, 'music');
  /** @type {Record<string, string[]>} */
  const cats = {};
  /** @type {Record<string, string>} media file → content hash (cached by the worker when first played) */
  const media = {};
  for (const rel of walk(MUSIC).filter((f) => /\.(mp3|ogg|m4a|wav|opus)$/i.test(f)).sort()) {
    const data = fs.readFileSync(path.join(MUSIC, rel));
    write(path.join(OUT, 'music', rel), data);
    const parts = rel.split('/');
    const cat = parts.length > 1 ? parts.slice(0, -1).join('/') : 'any';
    const url = 'music/' + parts.map(encodeURIComponent).join('/');
    (cats[cat] = cats[cat] || []).push(url);
    media[url] = hash(data);
  }
  /** @type {Record<string, unknown>} */
  const info = {};
  try {
    const man = JSON.parse(fs.readFileSync(path.join(MUSIC, 'manifest.json'), 'utf8'));
    for (const [rel, v] of Object.entries(man)) info['music/' + rel.split('/').map(encodeURIComponent).join('/')] = v;
  } catch (e) { /* no manifest */ }
  write(path.join(OUT, 'api', 'music'), JSON.stringify(cats));
  write(path.join(OUT, 'api', 'music-info'), JSON.stringify(info));

  // 5. The service worker: content-hashed cache, so a new deploy only downloads what changed.
  /** @type {Record<string, string>} */
  const files = {};
  for (const rel of walk(OUT)) {
    if (rel.startsWith('music/') || rel.startsWith('tts/') || rel === 'sw.js' || rel === '.nojekyll') continue;
    files[rel] = hash(fs.readFileSync(path.join(OUT, rel)));
  }
  const version = hash(JSON.stringify(files) + JSON.stringify(media));
  const sw = fs.readFileSync(path.join(ROOT, 'web', 'sw-template.js'), 'utf8')
    .replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files)).replace('__MEDIA__', JSON.stringify(media));
  write(path.join(OUT, 'sw.js'), sw);
  console.log(`built ${OUT}: ${Object.keys(files).length} files + ${Object.keys(media).length} music tracks (version ${version})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
