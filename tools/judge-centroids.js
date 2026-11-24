#!/usr/bin/env node
/*
 * The Deep End's answer judge, build step: the centre of each category's answers in gte-small's
 * meaning space, so the TV can tell whether an answer the chart doesn't know fits the category
 * (public/judge-core.js has the maths, public/judge-worker.js runs the model on the TV).
 *
 * For every category in games/data/pools/deepend.json: embed every chart answer, average, normalise,
 * store as int8 (384 numbers, base64) keyed by the category's question. Then a check on held-out
 * answers (a fifth of each chart left out of its centre; answers of other categories and junk as the
 * wrong ones): fails if fewer than 97% of the answers it would accept really fit.
 *
 * Needs the model (node tools/fetch-kokoro.js) and the native ONNX runtime (glibc: node:20-slim):
 *   podman run --rm -v "$PWD":/app:z -w /app docker.io/library/node:20-slim node tools/judge-centroids.js
 * Writes public/judge-centroids.json. Rerun after the Deep End charts change. AGPLv3 — see LICENSE.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../public/judge-core.js');

const ROOT = path.join(__dirname, '..');
const MODEL_DIR = process.env.JUDGE_MODEL_DIR || path.join(ROOT, 'vendor', 'kokoro');
const OUT = path.join(ROOT, 'public', 'judge-centroids.json');
const JUNK = ['asdf', 'banana phone', 'my mom', 'yes', 'idk', 'pass', 'something', 'Tuesday', 'qwerty', 'lol',
  'nothing', 'your face', 'the moon', 'pizza', 'blue', 'seven', 'Bob', 'potato', 'skibidi', 'xyz'];

/** Seeded shuffle (mulberry32) so the check gives the same numbers every run. @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function main() {
  /** @type {any} */
  const hf = await import(/** @type {string} */ ('@huggingface/transformers'));
  const { pipeline, env } = hf;
  env.localModelPath = MODEL_DIR + '/';
  env.allowRemoteModels = false;
  const embed = await pipeline('feature-extraction', 'judge/model', { dtype: 'q8' });
  /** @param {string[]} texts @returns {Promise<number[][]>} */
  const vecs = async (texts) => /** @type {number[][]} */ ((await embed(texts, { pooling: 'mean', normalize: true })).tolist());

  const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'games', 'data', 'pools', 'deepend.json'), 'utf8'));
  /** @type {{ q: string, names: string[], v: number[][] }[]} */
  const cats = [];
  for (const it of items) {
    const names = it.answers.map((/** @type {any[]} */ r) => String(r[1]));
    cats.push({ q: it.q, names, v: await vecs(names) });
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const c of cats) out[c.q] = core.pack(core.centre(c.v));
  fs.writeFileSync(OUT, JSON.stringify({ model: 'Xenova/gte-small (q8)', dims: 384, accept: core.ACCEPT, doubt: core.DOUBT, cats: out }) + '\n');
  console.log(`wrote ${OUT} (${cats.length} categories)`);

  // The check: held-out answers should land in their own category, other categories' answers and junk shouldn't.
  const junk = await vecs(JUNK);
  const rand = rng(7);
  const all = cats.map((c) => core.unpack(out[c.q]));
  let tp = 0, fp = 0, pos = 0, neg = 0, junkIn = 0, doubtNeg = 0, doubtPos = 0;
  cats.forEach((c, i) => {
    const idx = c.names.map((_, j) => j).sort(() => rand() - 0.5);
    const hold = new Set(idx.slice(0, Math.max(1, Math.floor(c.names.length / 5))));
    const own = core.unpack(core.pack(core.centre(c.v.filter((_, j) => !hold.has(j)))));
    const others = all.filter((_, k) => k !== i);
    const mine = new Set(c.names.map((n) => n.toLowerCase()));
    for (const j of hold) { pos++; const s = core.score(c.v[j], own, others); if (s >= core.ACCEPT) tp++; if (s <= core.DOUBT) doubtPos++; }
    for (let n = 0; n < 20; n++) {
      const k = Math.floor(rand() * cats.length), o = cats[k], j = Math.floor(rand() * o.names.length);
      if (k === i || mine.has(o.names[j].toLowerCase())) continue;
      neg++; const s = core.score(o.v[j], own, others); if (s >= core.ACCEPT) fp++; if (s <= core.DOUBT) doubtNeg++;
    }
    for (const v of junk) { neg++; const s = core.score(v, own, others); if (s >= core.ACCEPT) { fp++; junkIn++; } if (s <= core.DOUBT) doubtNeg++; }
  });
  const precision = tp / Math.max(1, tp + fp);
  console.log(`check: accepts ${(100 * tp / pos).toFixed(0)}% of real off-chart answers, ${(100 * precision).toFixed(1)}% of what it accepts fits; ` +
    `junk accepted ${junkIn}/${JUNK.length * cats.length}; "doubts it" on ${(100 * doubtNeg / neg).toFixed(0)}% of wrong answers and ${(100 * doubtPos / pos).toFixed(0)}% of right ones`);
  if (precision < 0.97) { console.error('precision below 97%: thresholds in public/judge-core.js need another look'); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
