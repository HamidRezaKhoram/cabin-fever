'use strict';
/* The built question pools: size, shape, flags, and the "no boring" filters. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../games/data/pools');
const load = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n + '.json'), 'utf8'));
const POOLS = ['punchline', 'trivia', 'fibbage', 'closest', 'majority', 'mostlikely', 'imposter', 'telephone', 'cah-black', 'cah-white'];
const text = (x) => x.text || x.q || x.word || '';

test('every pool: 1000+ items, unique ids, boolean 18+ flag, some adult content', () => {
  for (const n of POOLS) {
    const items = load(n);
    assert.ok(items.length >= 1000, `${n}: ${items.length}`);
    assert.strictEqual(new Set(items.map((i) => i.id)).size, items.length, `${n}: duplicate ids`);
    assert.ok(items.every((i) => typeof i.a === 'boolean'), `${n}: missing adult flag`);
    assert.ok(items.every((i) => text(i).trim().length > 1), `${n}: empty item`);
    assert.ok(items.some((i) => i.a), `${n}: no 18+ items`);
  }
});

test('item shapes are valid for each game', () => {
  for (const q of load('trivia')) {
    assert.ok(Array.isArray(q.choices) && q.choices.length >= 3, 'trivia choices: ' + q.q);
    assert.ok(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.choices.length, 'trivia correct: ' + q.q);
    assert.ok(typeof q.cat === 'string' && q.cat.length, 'trivia needs a category: ' + q.q);
  }
  for (const q of load('fibbage')) assert.ok(q.answer && q.answer.length <= 40, 'fib answer: ' + q.q);
  for (const q of load('closest')) assert.ok(Number.isFinite(q.answer), 'closest answer: ' + q.q);
  for (const q of load('imposter')) assert.ok(q.words.length >= 4 && q.words.includes(q.word), 'imposter: ' + q.word);
  for (const q of load('cah-black')) assert.ok(q.text.includes('____') || /\?$/.test(q.text), 'black card blank: ' + q.text);
});

test('boring/generic items were filtered out', () => {
  const trivia = load('trivia').filter((q) => q.cat !== 'After Dark').map((q) => q.q);
  assert.ok(!load('trivia').some((q) => q.choices.length === 2), 'no True/False trivia');
  assert.ok(!trivia.some((q) => /stand for|networking|What is the capital of/i.test(q)));
  assert.ok(!load('closest').some((q) => /atomic number|legs does a spider|days are in a leap/i.test(q.q)));
  assert.ok(!load('majority').some((q) => /^Name (a|an) (fruit|colou?r|planet)( that| of|$)/i.test(q.text)));
  assert.ok(!load('mostlikely').some((q) => /most likely to have (eaten sushi|gone rollerblading)/i.test(q.text)));
  assert.ok(!load('imposter').some((q) => ['Shapes', 'Colours'].includes(q.category)));
});

test('templated prompts use correct grammar (a/an)', () => {
  for (const n of ['majority', 'mostlikely']) {
    // "a uniform", "a UFO", "a one-night stand" are correct English.
    const bad = load(n).filter((q) => /\ba (?:[aei]|o(?!ne|nce)|u(?!ni|se|su|ku|ro|ti|fo))/i.test(q.text));
    assert.deepStrictEqual(bad.map((q) => q.text).slice(0, 5), [], `${n} has "a" before a vowel`);
  }
});

test('trivia has enough categories for category rounds (each 10+ questions)', () => {
  const counts = {};
  for (const q of load('trivia')) counts[q.cat] = (counts[q.cat] || 0) + 1;
  const big = Object.values(counts).filter((n) => n >= 10).length;
  assert.ok(big >= 8, `only ${big} categories with 10+ questions`);
});

test('every bundled music file is credited and sits in a known scenario folder', () => {
  const MUSIC = path.join(__dirname, '../../music');
  const credits = fs.readFileSync(path.join(MUSIC, 'CREDITS.md'), 'utf8');
  const known = ['title', 'menu', 'intro', 'game', 'category', 'vote', 'reveal', 'round2', 'final', 'victory', 'scoreboard'];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const audio = walk(MUSIC).filter((f) => /\.(mp3|ogg|m4a|wav|opus)$/i.test(f));
  assert.ok(audio.length >= 40, `only ${audio.length} music files`);
  for (const f of audio) {
    const rel = path.relative(MUSIC, f);
    assert.ok(credits.includes('`' + rel + '`'), `${rel} is not in music/CREDITS.md`);
    assert.ok(known.includes(rel.split(path.sep)[0]), `${rel} is not in a known scenario folder`);
  }
  assert.ok(/CC0/.test(credits));
});
