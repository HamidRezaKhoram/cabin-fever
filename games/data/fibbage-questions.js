/*
 * Fibbage-style question bank (the original v1 facts). Each entry is a weird-but-true fact with a
 * blank; players invent fake fill-ins to bluff each other, then hunt for the real answer hidden in
 * the pile of lies. Keep `answer` short (a word or a few words) so a real answer sits naturally
 * alongside the players' fakes and isn't obvious by length alone.
 *
 * The facts live in fibbage-questions.json so tools/build-content.py can read them without Node
 * (it used to shell out to `node`, and quietly left them out of the pool where Node wasn't installed).
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

/** @type {{ q: string, answer: string }[]} */
const QUESTIONS = require('./fibbage-questions.json');

module.exports = { QUESTIONS };
