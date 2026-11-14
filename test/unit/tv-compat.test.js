// The TV page must run on a mid-range Samsung TV's browser: 2022 models ship Chromium 85 (Tizen 6.5,
// developer.samsung.com web engine specifications; docs/future-features/feel-plan.md). We can't run
// Chromium 85 here, so the TV's scripts and CSS are checked against it statically: syntax up to
// ES2021 (all in Chromium 85), and no API or CSS feature that arrived later (unless guarded).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const PUB = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(PUB, 'host.html'), 'utf8');
const SCRIPTS = [...html.matchAll(/src="\/([a-z0-9-]+\.js)"/g)].map((m) => m[1]).filter((f) => fs.existsSync(path.join(PUB, f)));
const CSS = [...html.matchAll(/href="\/([a-z0-9-]+\.css)"/g)].map((m) => m[1]);

// [what, pattern, first Chromium with it].
const JS_LATER = [
  ['structuredClone', /\bstructuredClone\(/, 98],
  ['Array/String .at()', /[\w\])]\.at\(-?\d/, 92],
  ['Object.hasOwn', /\bObject\.hasOwn\(/, 93],
  ['crypto.randomUUID', /\.randomUUID\(/, 92],
  ['Array findLast', /\.findLast(Index)?\(/, 97],
  ['toSorted/toReversed/with', /\.(toSorted|toReversed|toSpliced)\(/, 110],
  ['AbortSignal.timeout', /AbortSignal\.timeout\(/, 103],
  ['replaceChildren', /\.replaceChildren\(/, 86],
  ['Intl.Segmenter', /Intl\.Segmenter/, 87],
  ['Array.prototype.group', /\.groupBy\(/, 117],
  ['class static block', /^\s*static\s*\{/m, 94],
];
const CSS_LATER = [
  [':has()', /:has\(/, 105],
  ['container queries', /@container|container-type/, 105],
  ['aspect-ratio', /(^|[;{\s])aspect-ratio\s*:/, 88],
  [':is() / :where()', /:(is|where)\(/, 88],
  ['dvh/svh/lvh units', /\d(dvh|svh|lvh|dvw|svw|lvw)\b/, 108],
  ['color-mix()', /color-mix\(/, 111],
  ['@layer', /@layer\b/, 99],
  ['accent-color', /accent-color\s*:/, 93],
  ['text-wrap', /text-wrap\s*:/, 114],
  ['CSS nesting (&)', /^\s*&[\s:.[]/m, 112],
  ['inset shorthand', /(^|[;{\s])inset\s*:/, 87],
  ['overflow: clip', /overflow(-[xy])?\s*:\s*clip/, 90],
];
// A line is fine when it feature-checks (`typeof`, `in`, `CSS.supports`, `?.(`, `@supports`) or says how old TVs
// cope (`/* old TVs: … */`), or is phone-only (`/* phone only */`: phones run current browsers).
const GUARD = /typeof |' in |" in |CSS\.supports|\?\.\(|@supports|old TVs:|phone only/;

/** @param {string} src @param {any[]} rules @param {string} file */
function later(src, rules, file) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    for (const [what, re, v] of rules) if (re.test(line) && !GUARD.test(line)) out.push(`${file}:${i + 1} ${what} (Chromium ${v}+): ${line.trim().slice(0, 100)}`);
  });
  return out;
}

test('TV scripts parse as ES2021 (Chromium 85: 2022 Samsung TVs)', () => {
  assert.ok(SCRIPTS.length >= 8, `found the TV page scripts (${SCRIPTS.join(', ')})`);
  for (const f of SCRIPTS) {
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    assert.doesNotThrow(() => acorn.parse(src, { ecmaVersion: 2021, sourceType: 'script', allowHashBang: true }), `${f} uses syntax newer than ES2021`);
  }
});

test('TV scripts and CSS use nothing newer than Chromium 85 without a fallback', () => {
  const found = [];
  for (const f of SCRIPTS) found.push(...later(fs.readFileSync(path.join(PUB, f), 'utf8'), JS_LATER, f));
  for (const f of CSS) found.push(...later(fs.readFileSync(path.join(PUB, f), 'utf8'), CSS_LATER, f));
  assert.deepStrictEqual(found, []);
});

// A selector Chromium 85 doesn't know drops the WHOLE rule it's listed in (`a:focus, a:focus-visible {…}` styles
// nothing there), so selectors newer than Chromium 85 must stand alone in their own rule.
const SELECTOR_LATER = [[':focus-visible', /:focus-visible/, 86]];
/** Top-level selector lists of every rule (comments and @-rule preludes left out). @param {string} css */
function selectorLists(css) {
  const out = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  for (const m of src.matchAll(/(^|[{};])([^{};@]+)\{/g)) {
    const sel = m[2].trim();
    if (!sel || /^(from|to|\d+%)/.test(sel)) continue; // keyframe steps
    out.push({ sel, line: src.slice(0, m.index + m[1].length).split('\n').length + (m[2].match(/^\s*/)[0].match(/\n/g) || []).length });
  }
  return out;
}
test('TV CSS: a selector newer than Chromium 85 (:focus-visible) never shares a rule with others', () => {
  const found = [];
  for (const f of CSS) {
    for (const { sel, line } of selectorLists(fs.readFileSync(path.join(PUB, f), 'utf8'))) {
      const top = sel.replace(/\([^()]*\)/g, '()'); // commas inside :not(a, b) don't make a list
      for (const [what, re, v] of SELECTOR_LATER) if (re.test(sel) && top.includes(',')) found.push(`${f}:${line} ${what} (Chromium ${v}+) in a selector list: ${sel.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }
  assert.deepStrictEqual(found, []);
});
test('the selector-list check finds :focus-visible in a list (and not alone)', () => {
  const lists = selectorLists('a:focus { x: 1 }\n/* b, c:focus-visible { } */\nb:focus,\nb:focus-visible { y: 2 }\n:focus-visible { z: 3 }\n@media (max-width: 9px) { d, e:focus-visible { w: 4 } }');
  const bad = lists.filter((l) => /:focus-visible/.test(l.sel) && l.sel.includes(','));
  assert.deepStrictEqual(bad.map((l) => l.line), [3, 6]);
});
