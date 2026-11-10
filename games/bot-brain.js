/*
 * Bot brain: given what a phone sees ({ phase, gameState, you }), decide what a
 * player would send. Shared by the in-room bots (games/bots.js — "Add bots" on
 * the TV), the command-line bots (tools/bots.js) and the playtest report
 * (test/playtest.js), so every new game mechanic only needs teaching once.
 * AGPLv3 — see LICENSE.
 *
 * decide(view, rnd) → null (nothing to do) or
 *   { payload, kind: 'tap' | 'write' | 'draw' | 'mash' }   — kind sets the think time.
 */
'use strict';

// A tiny valid PNG (1×1 px) — bots "draw" this.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Bot answers are silly but plausible, so a playtest screen looks like a real game.
const LINES = [
  'a suspiciously confident goose', 'my uncle\'s canoe', 'three raccoons in a trench coat', 'pickle juice',
  'an emotional support moose', 'the dock at 3 a.m.', 'whatever is in that cooler', 'a very loud loon',
  'grandma\'s secret recipe', 'forgetting the sunscreen', 'a haunted s\'more', 'the Wi-Fi password',
];
const WORDS = ['beer', 'pizza', 'dog', 'beach', 'campfire', 'canoe', 'moose', 'bacon'];

/** @param {any[]} a @param {() => number} rnd */
const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];

/**
 * @param {{ phase: string, gameState?: any, you?: any }} view
 * @param {() => number} [rnd]
 * @returns {{ payload: Record<string, any>, kind: 'tap' | 'write' | 'draw' | 'mash' } | null}
 */
function decide(view, rnd = Math.random) {
  const g = view.gameState || {}, you = view.you || {};
  const tap = (payload) => ({ payload, kind: /** @type {'tap'} */ ('tap') });
  const write = (payload) => ({ payload, kind: /** @type {'write'} */ ('write') });
  switch (view.phase) {
    // Punchline
    case 'answering': return !you.submitted && g.prompt ? write({ text: pick(LINES, rnd) }) : null;
    case 'voting': return !you.isAuthor && !you.voted ? tap({ choice: rnd() < 0.5 ? 0 : 1 }) : null;
    // Fib Finder: lie, guess, then like a lie
    case 'fib-bluff': return !you.submitted ? write({ text: pick(LINES, rnd) }) : null;
    case 'fib-choose':
      if (!you.picked && g.options && g.options.length) return tap({ choice: pick(g.options, rnd).index });
      if (you.picked && g.options && (you.liked || []).length === 0 && rnd() < 0.5) return tap({ like: pick(g.options, rnd).index });
      return null;
    // Trivia (sometimes doubles down)
    case 'trivia-category': return you.isChooser ? tap({ choice: Math.floor(rnd() * (g.categoryOptions || [1]).length) }) : null;
    case 'trivia-question':
      return !you.answered && g.choices ? tap({ choice: Math.floor(rnd() * g.choices.length), double: !!you.canDouble && rnd() < 0.15 }) : null;
    case 'cg-guess': return !you.submitted ? tap({ number: Math.round(rnd() * 2000), double: !!you.canDouble && rnd() < 0.15 }) : null;
    // Majority Rules: answer, then bet
    case 'mr-answer':
      if (!you.submitted) return write({ text: pick(WORDS.slice(0, 4), rnd) });
      if (you.bet == null && g.maxBet != null) return tap({ bet: Math.floor(rnd() * (g.maxBet + 1)) });
      return null;
    case 'ml-vote': return !you.voted && g.targets && g.targets.length ? tap({ target: pick(g.targets, rnd).id }) : null;
    // Odd One Out
    case 'imp-clue': return !you.submitted ? write({ text: pick(WORDS, rnd) }) : null;
    case 'imp-vote': return !you.voted && g.clues && g.clues.length ? tap({ target: pick(g.clues, rnd).id }) : null;
    case 'imp-guess': return you.isImposter && g.options && g.options.length ? tap({ choice: Math.floor(rnd() * g.options.length) }) : null;
    // Two Truths
    case 'tt-write': return !you.submitted ? write({ truths: ['I once ate a whole pie', 'I can juggle'], lie: 'I have met a moose' }) : null;
    case 'tt-guess': return !you.isSubject && !you.guessed ? tap({ choice: Math.floor(rnd() * 3) }) : null;
    // Doodle Telephone
    case 'tel-write': case 'tel-describe': return !you.submitted ? write({ text: pick(LINES, rnd) }) : null;
    case 'tel-draw': return !you.submitted ? { payload: { image: PNG }, kind: 'draw' } : null;
    case 'tel-reveal': {
      if (!g.favOpen || you.fav != null || !you.canFav) return null;
      const ok = (g.entries || []).map((e, i) => (e.ok ? i : -1)).filter((i) => i >= 0);
      return ok.length ? tap({ fav: pick(ok, rnd) }) : null;
    }
    case 'tel-vote': return !you.voted && g.drawings && g.drawings.length ? tap({ key: pick(g.drawings, rnd).key }) : null;
    // Card Chaos (the czar also picks next round's prompt)
    case 'cah-submit':
      if (you.isCzar) return you.nextOptions && you.nextPick == null ? tap({ nextBlack: Math.floor(rnd() * you.nextOptions.length) }) : null;
      return !you.submitted && you.hand && you.hand.length ? tap({ cardIndex: Math.floor(rnd() * you.hand.length) }) : null;
    case 'cah-czar': return you.isCzar && g.submissions && g.submissions.length ? tap({ choice: Math.floor(rnd() * g.submissions.length) }) : null;
    // Cottage Crush: notes, replies, then a date
    case 'cr-mingle': {
      const t = g.targets || [];
      return you.notesLeft > 0 && t.length ? write({ to: pick(t, rnd).id, text: pick(you.cards && you.cards.length ? you.cards : LINES, rnd) }) : null;
    }
    case 'cr-reply': {
      const open = (you.inbox || []).filter((/** @type {{ reply: string | null }} */ n) => !n.reply);
      return open.length ? tap({ reply: open[0].id, text: pick(you.replyCards || ['😍'], rnd) }) : null;
    }
    case 'cr-pick': {
      if (you.picked) return null;
      const fans = (you.inbox || []).map((/** @type {{ from: string }} */ n) => n.from);
      const t = g.targets || [];
      const fav = t.find((/** @type {{ nickname: string }} */ x) => fans.includes(x.nickname)); // date someone who wrote to you, usually
      return t.length ? tap({ pick: rnd() < 0.1 ? null : (fav && rnd() < 0.7 ? fav : pick(t, rnd)).id }) : null;
    }
    // Game night: vote on what's next
    case 'night-vote': return !you.voted && g.options && g.options.length ? tap({ choice: Math.floor(rnd() * g.options.length) }) : null;
    // Minigame Mayhem
    case 'mg-play':
      if (g.mini === 'tug') return { payload: { tap: 3 + Math.floor(rnd() * 4) }, kind: 'mash' };
      if (g.mini === 'quickdraw') return !you.done && !you.early && g.sub === 'go' ? tap({ tap: true }) : null;
      if (g.mini === 'fireflies') return !you.done && g.sub === 'guess' ? tap({ number: 5 + Math.floor(rnd() * 30) }) : null;
      if (g.mini === 'roast') return !you.done ? tap({ hold: 2000 + Math.floor(rnd() * 5000) }) : null;
      return null;
    default: return null;
  }
}

/** Human-ish think time in ms for a decision kind (divide by `speed` for fast bots). */
function thinkMs(kind, rnd = Math.random) {
  if (kind === 'mash') return 250;
  if (kind === 'write') return 8000 + rnd() * 17000;
  if (kind === 'draw') return 20000 + rnd() * 30000;
  return 2000 + rnd() * 5000;
}

module.exports = { decide, thinkMs, PNG, LINES };
