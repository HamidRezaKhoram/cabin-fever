/*
 * The Deep End's answer judge — the maths, shared by the TV's worker (public/judge-worker.js), the
 * build step (tools/judge-centroids.js) and the tests. Answers and categories are points in
 * gte-small's meaning space (384 numbers, length 1). A category is the centre of its chart's answers.
 * An answer fits when it is closer to its category's centre than to the 5 nearest other categories
 * (on average): score = cos(answer, own) − mean of the top 5 cos(answer, other).
 * Calibrated on held-out chart answers (tools/judge-centroids.js prints the check):
 *   score ≥ ACCEPT → it fits (the room doesn't have to vote; ~99% right, ~1 in 4 good answers)
 *   score ≤ DOUBT  → "the judge doubts it" (a hint next to the vote; the room still decides)
 * AGPLv3 — see LICENSE.
 */
(function () {
  'use strict';
  const ACCEPT = 0.01;
  const DOUBT = -0.02;
  const NEAREST = 5;

  /** @param {ArrayLike<number>} a @param {ArrayLike<number>} b */
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  /** Length-1 copy. @param {ArrayLike<number>} v @returns {number[]} */
  function norm(v) { const n = Math.sqrt(dot(v, v)) || 1; return Array.from(v, (x) => x / n); }

  /** The centre of a set of vectors, length 1. @param {ArrayLike<number>[]} vs */
  function centre(vs) {
    const c = new Array(vs[0].length).fill(0);
    for (const v of vs) for (let i = 0; i < c.length; i++) c[i] += v[i];
    return norm(c);
  }

  /** int8 + base64 (a category in ~512 characters). @param {ArrayLike<number>} v */
  function pack(v) {
    let max = 0;
    for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
    let s = '';
    for (let i = 0; i < v.length; i++) s += String.fromCharCode((Math.round((v[i] / (max || 1)) * 127) + 256) % 256);
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'latin1').toString('base64');
  }

  /** @param {string} b64 @returns {number[]} */
  function unpack(b64) {
    const s = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('latin1');
    const v = [];
    for (let i = 0; i < s.length; i++) { const b = s.charCodeAt(i); v.push(b > 127 ? b - 256 : b); }
    return norm(v);
  }

  /** @param {ArrayLike<number>} v @param {ArrayLike<number>} own @param {ArrayLike<number>[]} others */
  function score(v, own, others) {
    const near = others.map((o) => dot(v, o)).sort((a, b) => b - a).slice(0, NEAREST);
    return dot(v, own) - near.reduce((a, b) => a + b, 0) / Math.max(1, near.length);
  }

  const api = { ACCEPT, DOUBT, dot, norm, centre, pack, unpack, score };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else /** @type {any} */ (globalThis).CfJudgeCore = api;
})();
