/*
 * Shared pacing rules for every game. AGPLv3 — see LICENSE.
 *
 * Stakes escalate like a TV show:
 *   Round 1 (first half of the questions) ×1
 *   Round 2 (second half)                 ×2
 *   Final question                        ×3   (games with 3+ questions)
 *
 * Players also steer the pace with majority votes from their phones:
 *   hurry — after you've answered: cut everyone else's remaining time to 10 s
 *   ready — on reveal/results screens: move on now
 *   skipq — while answering: replace the question with a fresh one
 */
'use strict';

const HURRY_MS = parseInt(process.env.RUMPUS_HURRY_MS || '10000', 10);

/** @param {number} round @param {number} total @returns {1 | 2 | 3} */
function stage(round, total) {
  if (!total || total < 2 || !round) return 1;
  if (total >= 3 && round === total) return 3;
  return round > Math.ceil(total / 2) ? 2 : 1;
}

const STAGE_LABEL = {
  1: 'ROUND 1',
  2: 'ROUND 2 · DOUBLE POINTS',
  3: 'FINAL QUESTION · TRIPLE POINTS',
};

/** @param {string | undefined | null} phase */
function isReveal(phase) {
  return /reveal|results/.test(phase || '');
}

// Which pace votes make sense right now for this game.
/** @param {any} game a running game (BaseGame or a legacy game) */
function allowedVotes(game) {
  if (!game || game.phase === 'gameover') return [];
  const phase = game.phase;
  if (isReveal(phase)) return game.timerFn ? ['ready'] : [];
  if (game.noPaceVotes) return []; // real-time minigames: no skipping/hurrying mid-play
  const out = [];
  if (game.timerFn) out.push('hurry');
  if (typeof game.skipQuestion === 'function' && (game.skippablePhases || []).includes(phase)) out.push('skipq');
  return out;
}

// Cut the running timer down to HURRY_MS (if more time than that is left).
/** @param {any} game */
function hurry(game) {
  if (!game.timerFn || !game.endsAt || game.endsAt - Date.now() <= HURRY_MS) return false;
  const fn = game.timerFn;
  const scale = (game.room.settings && game.room.settings.timerScale) || 1;
  game.setTimer(HURRY_MS / scale, fn); // setTimer re-applies the scale
  return true;
}

module.exports = { stage, STAGE_LABEL, isReveal, allowedVotes, hurry, HURRY_MS };
