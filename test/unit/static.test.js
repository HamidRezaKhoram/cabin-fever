'use strict';
/* Static checks on the client code: sprites, registries in sync, 30 fps CSS. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
global.window = { Rumpus: {} };
global.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }), toDataURL: () => 'data:' }) };
require('../../public/sprites.js');
const sprites = window.Rumpus.sprites;
const server = read('server.js');
const GAME_IDS = server.match(/for \(const mod of \[([^\]]+)\]/)[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1));

test('server game list matches the game modules on disk', () => {
  const files = fs.readdirSync(path.join(ROOT, 'games')).filter((f) => f.endsWith('.js') && !['base.js', 'library.js', 'flow.js', 'avatar-schema.js'].includes(f)).map((f) => f.slice(0, -3));
  assert.deepStrictEqual([...GAME_IDS].sort(), files.sort());
  for (const id of GAME_IDS) {
    const meta = require(path.join(ROOT, 'games', id)).meta;
    assert.strictEqual(meta.id, id);
    assert.ok(meta.name && meta.blurb && meta.minPlayers >= 2);
  }
});

test('avatars: server count matches sprites, every sprite is a clean 16×16 grid', () => {
  assert.strictEqual(+server.match(/AVATAR_COUNT = (\d+)/)[1], sprites.count);
  const names = new Set();
  for (const a of sprites.AVATARS) {
    const rows = a.px.trim().split('\n');
    assert.strictEqual(rows.length, 16, `${a.name} rows`);
    rows.forEach((r, i) => assert.strictEqual(r.length, 16, `${a.name} row ${i}`));
    names.add(a.name);
  }
  assert.strictEqual(names.size, sprites.count, 'avatar names unique');
});

test('every game has its own unique illustration, sized to its design', () => {
  const sizes = new Set();
  const seen = new Set();
  for (const id of GAME_IDS) {
    const art = sprites.ICONS[id];
    assert.ok(art, `no icon for ${id}`);
    const rows = art.trim().split('\n');
    const w = Math.max(...rows.map((r) => r.length));
    assert.ok(w >= 20 && rows.length >= 20, `${id} icon should be detailed (≥20px), got ${w}×${rows.length}`);
    rows.forEach((r, i) => assert.strictEqual(r.length, w, `${id} row ${i} ragged`));
    assert.ok(!seen.has(art), `${id} icon duplicates another`);
    seen.add(art);
    sizes.add(`${w}x${rows.length}`);
    const colours = new Set(art.replace(/[.\n]/g, ''));
    assert.ok(colours.size >= 4, `${id} icon uses only ${colours.size} colours`);
  }
  assert.ok(sizes.size >= 4, 'icons should come in different sizes');
});

test('client registries cover every game', () => {
  const host = read('public/host.js');
  const gamesJs = read('public/games.js');
  const music = read('public/music.js');
  const legacy = ['quiplash', 'fibbage', 'trivia', 'cah'];
  for (const id of GAME_IDS) {
    assert.ok(new RegExp(`\\b${id}:\\s*\\[`).test(host), `host RULES missing ${id}`);
    assert.ok(new RegExp(`\\b${id}:\\s*\\{\\s*mode`).test(music), `music GAME_STYLE missing ${id}`);
    if (!legacy.includes(id)) assert.ok(gamesJs.includes(`register('${id}'`), `games.js missing renderer for ${id}`);
  }
});

test('phone reaction emojis match what the server accepts', () => {
  const list = (src) => JSON.parse(src.match(/REACTIONS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.deepStrictEqual(list(read('public/play.js')), list(server));
});

test('CSS animations and transitions all run at 30 fps (steps = seconds × 30)', () => {
  const css = read('public/style.css');
  const decls = [...css.matchAll(/(?:animation|transition):\s*([^;{}]+);/g)].map((m) => m[1]);
  assert.ok(decls.length > 20);
  for (const d of decls) {
    if (d.trim() === 'none') continue;
    for (const part of d.split(',')) {
      const t = /(\d*\.?\d+)(ms|s)\b/.exec(part);
      if (!t) continue;
      const secs = parseFloat(t[1]) / (t[2] === 'ms' ? 1000 : 1);
      const steps = /steps\((\d+)\)/.exec(part);
      assert.ok(steps, `no steps() in "${part.trim()}"`);
      assert.ok(Math.abs(+steps[1] - Math.max(1, Math.round(secs * 30))) <= 1, `"${part.trim()}" is not 30 fps`);
    }
  }
});

test('JS animation only runs through the shared 30 fps clock', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((x) => x.endsWith('.js') && x !== 'clock.js')) {
    assert.ok(!/requestAnimationFrame/.test(read('public/' + f)), `${f} uses requestAnimationFrame directly`);
  }
  assert.match(read('public/clock.js'), /FPS = 30/);
});

test('every page loads the shared clock after common.js', () => {
  for (const p of ['public/host.html', 'public/play.html']) {
    const html = read(p);
    assert.ok(html.indexOf('/clock.js') > html.indexOf('/common.js') && html.indexOf('/common.js') > 0, p);
  }
});

test('every game has its own background scene and colour scheme', () => {
  const bg = read('public/bg.js');
  const css = read('public/style.css');
  for (const id of GAME_IDS) {
    assert.ok(new RegExp(`\\b${id}:\\s*\\{ sky:`).test(bg), `bg.js THEMES missing ${id}`);
    assert.ok(css.includes(`body[data-theme="${id}"]`), `style.css colour scheme missing ${id}`);
  }
});

test('every game background has its own content scene (not just a palette)', () => {
  const bg = read('public/bg.js');
  const stat = bg.slice(bg.indexOf('const STATIC = {'), bg.indexOf('const ANIM = {'));
  for (const id of GAME_IDS) assert.ok(new RegExp(`\\n    ${id}\\(g\\)`).test(stat), `no scene motif for ${id}`);
});

// ---- accessibility ------------------------------------------------------------
const lum = (hex) => {
  const c = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('WCAG contrast: every theme\'s text colours are ≥ 4.5:1 on the dark question panel and buttons', () => {
  const css = read('public/style.css');
  const panelBg = '#0e0c17'; // rgba(8,6,16,0.84) over the darkest-to-brightest scenes ≈ this
  const root = { accent: '#ffb02e', accent2: '#5ee0a0', panel: '#241f3d', ink: '#f4f1e8' };
  const themes = { lobby: root };
  for (const m of css.matchAll(/body\[data-theme="(\w+)"\]\s*\{([^}]+)\}/g)) {
    const t = { ...root };
    for (const v of m[2].matchAll(/--(accent2?|panel):\s*(#[0-9a-f]{6})/gi)) t[v[1]] = v[2];
    themes[m[1]] = t;
  }
  assert.ok(Object.keys(themes).length >= 12);
  for (const [name, t] of Object.entries(themes)) {
    assert.ok(contrast(t.accent, panelBg) >= 4.5, `${name}: prompt colour ${t.accent} only ${contrast(t.accent, panelBg).toFixed(2)}:1`);
    assert.ok(contrast(t.ink, t.panel) >= 4.5, `${name}: button text on ${t.panel} only ${contrast(t.ink, t.panel).toFixed(2)}:1`);
  }
});

test('accessibility basics: focus ring, reduced motion, 48px targets, labelled reactions, live region', () => {
  const css = read('public/style.css');
  assert.match(css, /:focus-visible\s*\{[^}]*outline/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /body\.play button, body\.play input, body\.play select \{ min-height: 48px; \}/);
  assert.match(read('public/play.js'), /aria-label="React: /);
  assert.match(read('public/play.html'), /id="game-view"[^>]*aria-live="polite"/);
  assert.match(read('public/avatar-maker.js'), /aria-pressed=/);
  assert.match(read('public/avatar-maker.js'), /role="tablist"/);
});

test('character maker options match the server schema', () => {
  require('../../public/avatar-maker.js');
  const { LOOK_PARTS } = require('../../games/avatar-schema');
  assert.deepStrictEqual(window.Rumpus.avatarMaker.counts, LOOK_PARTS);
});
