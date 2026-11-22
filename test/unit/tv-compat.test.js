// The TV page targets current Chrome (TV_CHROME below; it was Chromium 85 for 2022 Samsung TVs until
// Nov 2026). Its scripts and CSS are checked against that statically: syntax up to TV_ES, and no API or
// CSS feature newer than TV_CHROME unless the line is guarded. Raise TV_CHROME to allow newer features.
// (Scripts the TV shares with the phones must also work on phone browsers, iPhone Safari included:
// see "Browser support" in CLAUDE.md. Phones aren't checked here.)
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

/** The Chrome version the TV page may rely on without a feature check. */
const TV_CHROME = 144;
/** The JavaScript syntax the TV page may use. */
const TV_ES = 2024;

// [what, pattern, first Chromium with it]. Only entries newer than TV_CHROME are enforced; add new
// ones here as features newer than the target appear.
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
    for (const [what, re, v] of rules) if (v > TV_CHROME && re.test(line) && !GUARD.test(line)) out.push(`${file}:${i + 1} ${what} (Chromium ${v}+): ${line.trim().slice(0, 100)}`);
  });
  return out;
}

test(`TV scripts parse as ES${TV_ES} (Chrome ${TV_CHROME}+)`, () => {
  assert.ok(SCRIPTS.length >= 8, `found the TV page scripts (${SCRIPTS.join(', ')})`);
  for (const f of SCRIPTS) {
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    assert.doesNotThrow(() => acorn.parse(src, { ecmaVersion: TV_ES, sourceType: 'script', allowHashBang: true }), `${f} uses syntax newer than ES${TV_ES}`);
  }
});

test(`TV scripts and CSS use nothing newer than Chrome ${TV_CHROME} without a fallback`, () => {
  const found = [];
  for (const f of SCRIPTS) found.push(...later(fs.readFileSync(path.join(PUB, f), 'utf8'), JS_LATER, f));
  for (const f of CSS) found.push(...later(fs.readFileSync(path.join(PUB, f), 'utf8'), CSS_LATER, f));
  assert.deepStrictEqual(found, []);
});

// A selector the TV's Chrome doesn't know drops the WHOLE rule it's listed in (`a:focus, a:focus-visible {…}`
// styled nothing on Chromium 85), so selectors newer than TV_CHROME must stand alone in their own rule.
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
test(`TV CSS: a selector newer than Chrome ${TV_CHROME} never shares a rule with others`, () => {
  const found = [];
  for (const f of CSS) {
    for (const { sel, line } of selectorLists(fs.readFileSync(path.join(PUB, f), 'utf8'))) {
      const top = sel.replace(/\([^()]*\)/g, '()'); // commas inside :not(a, b) don't make a list
      for (const [what, re, v] of SELECTOR_LATER) if (v > TV_CHROME && re.test(sel) && top.includes(',')) found.push(`${f}:${line} ${what} (Chromium ${v}+) in a selector list: ${sel.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }
  assert.deepStrictEqual(found, []);
});
test('the selector-list check finds :focus-visible in a list (and not alone)', () => {
  const lists = selectorLists('a:focus { x: 1 }\n/* b, c:focus-visible { } */\nb:focus,\nb:focus-visible { y: 2 }\n:focus-visible { z: 3 }\n@media (max-width: 9px) { d, e:focus-visible { w: 4 } }');
  const bad = lists.filter((l) => /:focus-visible/.test(l.sel) && l.sel.includes(','));
  assert.deepStrictEqual(bad.map((l) => l.line), [3, 6]);
});
