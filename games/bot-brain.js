/*
 * Bot brain: given what a phone sees ({ phase, gameState, you }), decide what a
 * player would send. Shared by the in-room bots (games/bots.js — "Add bots" on
 * the TV), the command-line bots (tools/bots.js) and the playtest report
 * (test/playtest.js), so every new game mechanic only needs teaching once.
 * AGPLv3 — see LICENSE.
 *
 * decide(view, rnd) → null (nothing to do) or
 *   { payload, kind: 'tap' | 'write' | 'draw' | 'mash' | 'react' | 'beat' | 'steer' }   — kind sets the think time.
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

/** @template T @param {T[]} list @param {() => number} rnd @returns {T[]} */
function shuffleCopy(list, rnd) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/**
 * @param {{ phase: string, gameState?: any, you?: any }} view
 * @param {() => number} [rnd]
 * @returns {{ payload: Record<string, any>, kind: 'tap' | 'write' | 'draw' | 'mash' | 'react' | 'beat' | 'steer' } | null}
 */
function decide(view, rnd = Math.random) {
  const g = view.gameState || {}, you = view.you || {};
  const tap = (/** @type {Record<string, any>} */ payload) => ({ payload, kind: /** @type {'tap'} */ ('tap') });
  const write = (/** @type {Record<string, any>} */ payload) => ({ payload, kind: /** @type {'write'} */ ('write') });
  switch (view.phase) {
    // Campfire Quips
    case 'answering': return !you.submitted && g.prompt ? write({ text: pick(LINES, rnd), ...(Number.isInteger(g.slot) ? { slot: g.slot } : {}) }) : null;
    case 'voting':
      if (you.isAuthor) return !you.bet && rnd() < 0.6 ? tap({ bet: rnd() < 0.7 ? 'win' : 'landslide' }) : null;
      return !you.voted ? tap({ choice: rnd() < 0.5 ? 0 : 1 }) : null;
    // Fish Tales: lie, guess, then like a lie
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
    // Campfire Consensus: answer, then bet
    case 'mr-answer':
      if (!you.submitted) return write({ text: pick(WORDS.slice(0, 4), rnd) });
      if (you.bet == null && g.maxBet != null) return tap({ bet: Math.floor(rnd() * (g.maxBet + 1)) });
      return null;
    // Herd call: the first (biggest) answer, sometimes plus their own
    case 'mr-herd': {
      if (you.herdVoted || !(g.answers || []).length) return null;
      const herd = [0];
      if (Number.isInteger(you.mine) && you.mine > 0 && rnd() < 0.3) herd.push(you.mine);
      return tap({ herd });
    }
    case 'ml-vote': return !you.voted && g.targets && g.targets.length ? tap({ target: pick(g.targets, rnd).id }) : null;
    // Odd Duck Out
    case 'imp-clue': return !you.submitted ? write({ text: pick(WORDS, rnd) }) : null;
    case 'imp-vote': return !you.voted && g.clues && g.clues.length ? tap({ target: pick(g.clues, rnd).id }) : null;
    case 'imp-guess': return you.isImposter && g.options && g.options.length ? tap({ choice: Math.floor(rnd() * g.options.length) }) : null;
    // Porch Confessions
    case 'tt-write': return !you.submitted ? write({ text: pick(LINES, rnd) }) : null;
    case 'tt-judge': return !you.judged && (g.answers || []).length ? tap({ calls: Object.fromEntries(g.answers.map((/** @type {{ id: string }} */ a) => [a.id, rnd() < 0.5])) }) : null;
    // Message in a Bottle
    case 'tel-write': case 'tel-describe': case 'tel-draw':
      if (!you.submitted) return view.phase === 'tel-draw' ? { payload: { image: PNG }, kind: 'draw' } : write({ text: pick(LINES, rnd) });
      // Done early: one doodle on the scribble pad, about half the time.
      return you.scribblesLeft === 3 && rnd() < 0.5 ? { payload: { scribble: PNG }, kind: 'draw' } : null;
    case 'tel-reveal': {
      if (!g.favOpen || you.fav != null || !you.canFav) return null;
      const ok = (g.entries || []).map((/** @type {{ ok: boolean }} */ e, /** @type {number} */ i) => (e.ok ? i : -1)).filter((/** @type {number} */ i) => i >= 0);
      return ok.length ? tap({ fav: pick(ok, rnd) }) : null;
    }
    case 'tel-vote': return !you.voted && g.drawings && g.drawings.length ? tap({ key: pick(g.drawings, rnd).key }) : null;
    // Rainy Day Cards (the czar also picks next round's prompt)
    case 'cah-submit':
      if (you.isCzar) return you.nextOptions && you.nextPick == null ? tap({ nextBlack: Math.floor(rnd() * you.nextOptions.length) }) : null;
      return !you.submitted && you.hand && you.hand.length ? tap({ cardIndex: Math.floor(rnd() * you.hand.length) }) : null;
    case 'cah-czar': {
      if (you.isCzar) return g.submissions && g.submissions.length ? tap({ choice: Math.floor(rnd() * g.submissions.length) }) : null;
      // Everyone else: a room-favourite tap on someone else's card.
      const others = (g.submissions || []).filter((/** @type {{ mine: boolean }} */ s) => !s.mine);
      return you.fav == null && others.length ? tap({ fav: pick(others, rnd).index }) : null;
    }
    // Cottage Crush: notes, replies, then a date
    case 'cr-mingle': {
      const t = g.targets || [];
      // Matchmaker / Gossip side actions (free, any time before the reveal).
      if (you.canSetup && t.length >= 2) { const [x, y] = shuffleCopy(t, rnd); return tap({ setup: [x.id, y.id] }); }
      if (you.canPredict && t.length >= 2) { const [x, y] = shuffleCopy(t, rnd); return tap({ predict: [x.id, y.id] }); }
      if (!(you.notesLeft > 0 && t.length)) return !you.winked && t.length ? tap({ wink: pick(t, rnd).id }) : null;
      // Mostly tap a ready-made opener card (a tap, not writing); sometimes write your own.
      const own = !(you.cards && you.cards.length) || rnd() < 0.25;
      const payload = { to: pick(t, rnd).id, text: own ? pick(LINES, rnd) : pick(you.cards, rnd) };
      return own ? write(payload) : tap(payload);
    }
    case 'cr-reply': {
      const open = (you.inbox || []).filter((/** @type {{ reply: string | null }} */ n) => !n.reply);
      if (open.length) return tap({ reply: open[0].id, text: pick(you.replyCards || ['😍'], rnd) });
      return !you.winked && (g.targets || []).length ? tap({ wink: pick(g.targets, rnd).id }) : null;
    }
    case 'cr-pick': {
      if (you.picked) return null;
      const fans = (you.inbox || []).map((/** @type {{ from: string }} */ n) => n.from);
      const t = g.targets || [];
      const fav = t.find((/** @type {{ nickname: string }} */ x) => fans.includes(x.nickname)); // date someone who wrote to you, usually
      return t.length ? tap({ pick: rnd() < 0.1 ? null : (fav && rnd() < 0.7 ? fav : pick(t, rnd)).id }) : null;
    }
    case 'st-roles': return you.ready ? null : tap({ ready: true });
    case 'st-talk': {
      // Not leading: a private hunch about who's a raccoon (once; people rarely change it).
      if (!you.isLeader) return you.hunch == null && (you.hunchTargets || []).length ? tap({ hunch: pick(you.hunchTargets, rnd).id }) : null;
      if (!(you.candidates || []).length) return null;
      const me = you.candidates.find((/** @type {{ id: string }} */ c) => c.id === you.playerId);
      const rest = shuffleCopy(you.candidates.filter((/** @type {{ id: string }} */ c) => c !== me), rnd);
      const crew = [...(me ? [me] : []), ...rest].slice(0, g.crewSize).map((/** @type {{ id: string }} */ c) => c.id);
      return { payload: { crew }, kind: 'tap' };
    }
    case 'st-vote': return you.voted ? null : tap({ vote: rnd() < 0.7 });
    case 'st-crew': return you.onCrew && !you.played ? tap({ card: you.canSabotage && rnd() < 0.7 ? 'sabotage' : 'help', fix: !!you.canFix && rnd() < 0.5, double: !!you.canDouble && rnd() < 0.3 }) : null;
    case 'st-accuse': return !you.accused && (you.accuseTargets || []).length ? tap({ accuse: pick(you.accuseTargets, rnd).id }) : null;
    // Lantern Lake: steer toward your target (a firefly, the moonbeam, the raft's next lantern).
    case 'll-intro': case 'll-play': {
      if (!you.pos || !you.target) return view.phase === 'll-play' ? { payload: { tilt: [rnd() * 2 - 1, rnd() * 2 - 1] }, kind: 'steer' } : null;
      const dx = you.target[0] - you.pos[0] + (rnd() - 0.5) * 30, dy = you.target[1] - you.pos[1] + (rnd() - 0.5) * 30;
      const m = Math.hypot(dx, dy) || 1;
      return { payload: { tilt: [Math.round((dx / m) * 100) / 100, Math.round((dy / m) * 100) / 100] }, kind: 'steer' };
    }
    // Loon Call: once a bar is over, send the taps a person would have made (±40 ms, the odd miss).
    case 'lc-tune': case 'lc-compose': case 'lc-song': {
      const s = g.sched, now = g.serverNow || 0;
      if (!s) return null;
      const human = (/** @type {number[]} */ ts) => ts.filter(() => rnd() > 0.08).map((t) => Math.round(t + (rnd() + rnd() + rnd() - 1.5) * 50));
      if (view.phase === 'lc-tune') return now >= s.endAt && !you.taps ? { payload: { taps: human(s.clicks) }, kind: 'beat' } : null;
      if (view.phase === 'lc-compose') {
        if (!you.isCaller || you.taps || now < s.endAt) return null;
        const bar = s.startAt + s.barMs, steps = [0, 2, 3, 4, 6].filter(() => rnd() > 0.3);
        return { payload: { taps: [0, ...steps].map((st) => bar + (st * s.barMs) / s.steps) }, kind: 'beat' };
      }
      const i = s.phrases.findIndex((/** @type {{ echoAt: number }} */ p, /** @type {number} */ k) => now >= p.echoAt + s.barMs && !(you.tapped || []).includes(k) && !(you.judged || []).includes(k));
      if (i < 0) return null;
      const p = s.phrases[i];
      const taps = human(p.steps.map((/** @type {number} */ st) => p.echoAt + (st * s.barMs) / s.steps));
      return { payload: { taps: taps.length ? taps : [p.echoAt + s.barMs * 0.97] }, kind: 'beat' }; // all missed: one stray tap
    }
    // Cottage Olympics
    case 'mg-play':
      if (g.mini === 'tug') return { payload: { tap: 3 + Math.floor(rnd() * 4) }, kind: 'mash' };
      if (g.mini === 'quickdraw') return !you.done && !you.early && g.sub === 'go' ? { payload: { tap: true }, kind: 'react' } : null;
      if (g.mini === 'fireflies') return !you.done ? tap({ number: 5 + Math.floor(rnd() * 30) }) : null;
      if (g.mini === 'roast') return !you.done ? tap({ hold: Math.round((g.target || 3000) * (0.7 + rnd() * 0.6)) }) : null;
      if (you.done || you.early) return null;
      if (g.mini === 'skip') return { payload: { throw: Date.now() }, kind: 'react' };
      if (g.mini === 'spot') return { payload: { cell: Math.floor(rnd() * (g.cells || 12)) }, kind: 'react' };
      if (g.mini === 'swat') {
        const t = Date.now() - g.playStart;
        const i = (g.bugs || []).findIndex((/** @type {{ at: number, life: number }} */ b, /** @type {number} */ k) => t >= b.at && t <= b.at + b.life && !(you.swats || []).includes(k));
        return i >= 0 && rnd() < 0.7 ? { payload: { swat: i }, kind: 'react' } : null;
      }
      if (g.mini === 'balance') return tap({ balance: Math.round(rnd() * 100) });
      if (g.mini === 'paddle') return { payload: { strokes: 2 + Math.floor(rnd() * 3) }, kind: 'mash' };
      if (g.mini === 'simon') return g.sub === 'go' ? tap({ seq: Array.from({ length: g.length || 5 }, () => Math.floor(rnd() * 4)) }) : null;
      if (g.mini === 'stack') return tap({ stack: 3 + Math.floor(rnd() * 12) });
      return null;
    default: return null;
  }
}

/** Human-ish think time in ms for a decision kind (divide by `speed` for fast bots). @param {string} kind @param {() => number} [rnd] */
function thinkMs(kind, rnd = Math.random) {
  if (kind === 'mash') return 250;
  if (kind === 'react') return 220 + rnd() * 300; // human reaction time
  if (kind === 'steer') return 250 + rnd() * 250; // a person adjusts a few times a second
  if (kind === 'beat') return 10; // rhythm taps carry their own timestamps
  if (kind === 'write') return 8000 + rnd() * 17000;
  if (kind === 'draw') return 20000 + rnd() * 30000;
  return 2000 + rnd() * 5000;
}

module.exports = { decide, thinkMs, PNG, LINES };
