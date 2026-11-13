/*
 * Test kit — golden files: compare a result with the copy saved in the repo.
 * No project knowledge: copy into any project.
 *   golden(path.join(__dirname, 'golden.json'), 'trivia', { phases, scores });
 * RECORD=1 saves the current results instead (after a change that is meant to change them —
 * say why in the commit). Store readable data, not just a hash, so the diff shows what changed.
 */
'use strict';
const fs = require('fs');
const assert = require('assert');

/** @param {string} file @param {string} key @param {unknown} actual */
function golden(file, key, actual) {
  /** @type {Record<string, unknown>} */ let all = {};
  try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* first recording */ }
  const plain = JSON.parse(JSON.stringify(actual));
  if (process.env.RECORD === '1') {
    all[key] = plain;
    fs.writeFileSync(file, JSON.stringify(all, null, 1) + '\n');
    return;
  }
  assert.ok(key in all, `no golden copy of "${key}" in ${file} yet — run with RECORD=1 to save one`);
  assert.deepStrictEqual(plain, all[key], `"${key}" no longer matches ${file}. If the change is on purpose, re-record with RECORD=1`);
}

module.exports = { golden };
