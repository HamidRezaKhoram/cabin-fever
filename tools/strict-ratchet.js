#!/usr/bin/env node
/*
 * Strict-types ratchet. The code is checked with most strict flags already; the two
 * big ones (noImplicitAny, strictNullChecks) still have a backlog of errors. This
 * counts them per tsconfig and fails if any count went UP versus types/strict-baseline.json,
 * so types only ever get stricter. When counts go down, it rewrites the baseline
 * (commit it). Run: node tools/strict-ratchet.js   (part of test-all + pre-commit)
 * AGPLv3 — see LICENSE.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'types', 'strict-baseline.json');
const CONFIGS = ['tsconfig.json', 'tsconfig.host.json', 'tsconfig.play.json', 'tsconfig.web.json'];
const FLAGS = ['noImplicitAny', 'strictNullChecks'];
const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc');

/** @param {string} config @param {string} flag @returns {number} */
function count(config, flag) {
  try {
    execFileSync(tsc, ['-p', config, `--${flag}`], { cwd: ROOT, stdio: 'pipe' });
    return 0;
  } catch (e) {
    const out = String(/** @type {{ stdout?: Buffer }} */ (e).stdout || '');
    return (out.match(/error TS\d+/g) || []).length;
  }
}

/** All strict errors as "file: TSxxxx message" (no line numbers) for diffing. @param {string} cwd */
function errorsIn(cwd) {
  /** @type {string[]} */
  const out = [];
  for (const c of CONFIGS) for (const f of FLAGS) {
    let text = '';
    try { execFileSync(tsc, ['-p', c, `--${f}`], { cwd, stdio: 'pipe' }); } catch (e) { text = String(/** @type {{ stdout?: Buffer }} */ (e).stdout || ''); }
    for (const line of text.split('\n')) {
      const m = line.match(/^(.+?)\((\d+),\d+\): error (TS\d+: .*)$/);
      if (m) out.push(`${m[1]}: ${m[3]}  [${c} --${f}, line ${m[2]}]`);
    }
  }
  return out;
}

// --explain: list the strict errors that are new compared with the last commit.
if (process.argv.includes('--explain')) {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-'));
  execFileSync('sh', ['-c', `git archive HEAD | tar -x -C "${tmp}" && ln -s "${path.join(ROOT, 'node_modules')}" "${tmp}/node_modules"`], { cwd: ROOT });
  const key = (/** @type {string} */ e) => e.replace(/\s+\[.*$/, '');
  const before = new Map();
  for (const e of errorsIn(tmp)) before.set(key(e), (before.get(key(e)) || 0) + 1);
  const fresh = errorsIn(ROOT).filter((e) => { const k = key(e); const n = before.get(k) || 0; if (n > 0) { before.set(k, n - 1); return false; } return true; });
  console.log(fresh.length ? `New strict errors since HEAD (${fresh.length}):\n  ` + fresh.join('\n  ') : 'No new strict errors since HEAD.');
  process.exit(0);
}

/** @type {Record<string, Record<string, number>>} */
const base = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
/** @type {Record<string, Record<string, number>>} */
const now = {};
let worse = false, better = false;
for (const c of CONFIGS) {
  now[c] = {};
  for (const f of FLAGS) {
    const n = count(c, f);
    now[c][f] = n;
    const was = base[c] && base[c][f];
    if (was == null) continue;
    if (n > was) { worse = true; console.error(`✖ ${c} --${f}: ${n} errors (baseline ${was}) — add types instead of new untyped code`); }
    else if (n < was) better = true;
    console.log(`  ${c.padEnd(20)} --${f.padEnd(17)} ${String(n).padStart(4)}  (baseline ${was})`);
  }
}
if (worse) process.exit(1);
if (better || !fs.existsSync(FILE)) {
  fs.writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n');
  console.log('strict baseline lowered → types/strict-baseline.json updated (commit it)');
}
