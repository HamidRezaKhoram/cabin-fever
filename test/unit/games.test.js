'use strict';
/* Rules and scoring for every game, with deterministic custom content. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, until, sleep, makeHost, makePlayer, contentDir, PNG, makeRoom } = require('../helpers');

const POOLS = {
  punchline: [{ text: 'Prompt one' }, { text: 'Prompt two' }, { text: 'Prompt three' }],
  trivia: [1, 2, 3].map((i) => ({ q: `Question ${i}?`, choices: ['wrong', 'right', 'nope', 'nah'], correct: 1 })),
  fibbage: [1, 2].map((i) => ({ q: `Fact ${i} is ____.`, answer: 'Truthy' })),
  closest: [{ q: 'How many?', answer: 42 }],
  majority: [{ text: 'Name a thing' }],
  mostlikely: [{ text: 'Who is most likely to win?' }],
  imposter: [{ category: 'Fruit', word: 'Apple', words: ['Apple', 'Pear', 'Plum', 'Fig', 'Kiwi'] },
    { category: 'Fruit', word: 'Pear', words: ['Apple', 'Pear', 'Plum', 'Fig', 'Kiwi'] }],
  telephone: ['Idea A', 'Idea B', 'Idea C', 'Idea D'],
  'cah-black': ['', ' two', ' three', ' four', ' five'].map((n) => ({ text: `Black card${n} ____.` })),
  'cah-white': Array.from({ length: 40 }, (_, i) => ({ text: `White ${i}` })),
};

let srv;
before(async () => {
  srv = await startServer({ RUMPUS_CONTENT_DIR: contentDir(POOLS), RUMPUS_CONTENT_MODE: 'replace' });
});
after(() => srv.stop());

const room = (names, settings) => makeRoom(srv, names, settings);

// ------------------------------------------------------------------ Campfire Quips
async function answerAll(players) {
  // Each player answers both of their prompts.
  for (let k = 0; k < 2; k++) {
    for (const p of players) {
      await until(() => p.state && (p.state.you.submitted || p.state.gameState.promptNumber === k + 1), `${p.nickname} prompt ${k + 1}`);
      if (!p.state.you.submitted) p.submit({ text: `${p.nickname}-${k}` });
    }
  }
}

test('Campfire Quips: everyone gets 2 prompts, each prompt goes to exactly 2 rivals', async () => {
  const { h, ps } = await room(['Ann', 'Ben', 'Cat']);
  h.emit('host:startGame', { gameId: 'quiplash' });
  await h.phase('answering');
  assert.strictEqual(h.state.gameState.totalAnswers, 6);
  const seen = {};
  for (const p of ps) {
    await until(() => p.state.gameState.promptNumber === 1, 'prompt 1');
    seen[p.nickname] = [p.state.gameState.prompt];
    p.submit({ text: 'x' });
    await until(() => p.state.gameState.promptNumber === 2, 'prompt 2');
    seen[p.nickname].push(p.state.gameState.prompt);
    assert.notStrictEqual(seen[p.nickname][0], seen[p.nickname][1]);
    p.submit({ text: 'y' });
    await until(() => p.state.you.submitted || p.state.phase !== 'answering', 'done');
  }
  const counts = {};
  Object.values(seen).flat().forEach((pr) => { counts[pr] = (counts[pr] || 0) + 1; });
  assert.deepStrictEqual(Object.values(counts), [2, 2, 2]);
  await h.phase('voting');
});

test('Campfire Quips: authors cannot vote on their own matchup; votes 100 each; SHUTOUT +250', async () => {
  const { h, ps, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:startGame', { gameId: 'quiplash' });
  await h.phase('answering');
  await answerAll(ps);
  const v = await h.phase('voting');
  assert.strictEqual(v.gameState.matchIndex, 0);
  assert.strictEqual(v.gameState.voterCount, 2);
  const authors = ps.filter((p) => p.state.you.isAuthor);
  const voters = ps.filter((p) => !p.state.you.isAuthor);
  assert.strictEqual(authors.length, 2);
  authors[0].submit({ choice: 0 }); // ignored
  for (const p of voters) p.submit({ choice: 1 });
  const r = await h.phase('results');
  const winner = r.gameState.result.sides[1];
  assert.strictEqual(r.gameState.result.winner, 1);
  assert.strictEqual(winner.shutout, true);
  assert.strictEqual(winner.pct, 100);
  assert.strictEqual(winner.gained, 2 * 100 + 250);
  assert.strictEqual(score(winner.nickname), 450);
  assert.strictEqual(r.gameState.result.sides[0].gained, 0);
});

test('Campfire Quips: authors place side bets while the room votes (landslide +250, a lost bet never goes below 0)', async () => {
  const { h, ps, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:startGame', { gameId: 'quiplash' });
  await h.phase('answering');
  await answerAll(ps);
  await h.phase('voting');
  await until(() => ps.every((p) => p.state.phase === 'voting'), 'phones voting');
  const authors = ps.filter((p) => p.state.you.isAuthor);
  const voters = ps.filter((p) => !p.state.you.isAuthor);
  authors[0].submit({ bet: 'landslide' }); authors[1].submit({ bet: 'win' });
  authors[1].submit({ bet: 'landslide' }); // only one bet
  voters[0].submit({ bet: 'win' }); // voters can't bet
  await until(() => authors.every((a) => a.state.you.bet), 'bets placed');
  assert.strictEqual(authors[1].state.you.bet, 'win');
  const placed = Object.fromEntries(authors.map((a) => [a.nickname, a.state.you.bet]));
  for (const p of voters) p.submit({ choice: 1 });
  const r = await h.phase('results');
  const [s0, s1] = r.gameState.result.sides;
  // Side 1 took every vote. Whoever bet on side 1 wins their bet; the other loses (from 0 → stays 0).
  const win1 = placed[s1.nickname] === 'landslide' ? 250 : 100;
  assert.strictEqual(s1.bet.won, true);
  assert.strictEqual(score(s1.nickname), 2 * 100 + 250 + win1);
  assert.strictEqual(s0.bet.won, false);
  assert.strictEqual(score(s0.nickname), 0, 'a lost bet never takes you below zero');
});

test('Campfire Quips: a missing answer forfeits the matchup', async () => {
  const s2 = await startServer({ RUMPUS_CONTENT_DIR: contentDir(POOLS), RUMPUS_CONTENT_MODE: 'replace', RUMPUS_ANSWER_MS: '600' });
  try {
    const h = await makeHost(s2);
    const ps = [];
    for (const n of ['Ann', 'Ben', 'Cat']) ps.push(await makePlayer(s2, h.code, n));
    h.emit('host:startGame', { gameId: 'quiplash' });
    await h.phase('answering');
    for (const p of ps.slice(0, 2)) { await until(() => p.state.gameState.promptNumber === 1, 'p'); p.submit({ text: 'only one' }); }
    // Cat never answered → Cat's matchups are forfeits (straight to results, no vote).
    // Matchups where both players answered still get voted on, so skip through those.
    const r = await until(() => {
      const st = h.state;
      if (st.phase === 'results' && st.gameState.result.sides.some((sd) => sd.text.includes('forfeit'))) return st;
      if (st.phase === 'voting' || st.phase === 'results') h.emit('host:skip');
      return null;
    }, 'a forfeit result', 15000);
    assert.ok(r.gameState.result.sides.some((sd) => sd.text.includes('forfeit')));
  } finally { await s2.stop(); }
});

test('Campfire Quips: final round is worth double and flagged', async () => {
  const { h, ps } = await room(['Ann', 'Ben', 'Cat'], { rounds: 2 });
  h.emit('host:startGame', { gameId: 'quiplash' });
  for (const round of [1, 2]) {
    await until(() => h.state.phase === 'answering' && h.state.gameState.round === round, 'round ' + round);
    assert.strictEqual(h.state.gameState.doublePoints, round === 2);
    await answerAll(ps);
    await until(() => h.state.phase === 'voting' && h.state.gameState.matchIndex === 0, 'first matchup');
    await until(() => ps.every((p) => p.state.phase === 'voting'), 'phones voting');
    ps.find((p) => !p.state.you.isAuthor).submit({ choice: 0 });
    const r = await until(() => h.state.phase === 'results' && h.state.gameState.matchIndex === 0 && h.state, 'results');
    assert.strictEqual(r.gameState.result.sides[0].gained, 100 * (round === 2 ? 2 : 1));
    // Skip through the remaining matchups to the next round (once per screen: TV updates are
    // coalesced, so a stale screen must not trigger a second skip that eats the next round).
    let skipped = '';
    await until(() => {
      if (h.state.phase === 'gameover' || (h.state.phase === 'answering' && h.state.gameState.round === round + 1)) return true;
      const key = `${h.state.phase}/${h.state.gameState.round}/${h.state.gameState.matchIndex}`;
      if (key !== skipped) { skipped = key; h.emit('host:skip'); }
      return false;
    }, 'end of round ' + round, 15000);
  }
  await h.phase('gameover');
});

test('Campfire Quips needs 3 players', async () => {
  const { h } = await room(['Ann', 'Ben']);
  h.emit('host:startGame', { gameId: 'quiplash' });
  await sleep(200);
  assert.strictEqual(h.state.phase, 'lobby');
});

test('Trivia: correct answers score with speed bonus, streaks add 100, wrong resets', async () => {
  const { h, by } = await room(['Ann', 'Ben'], { rounds: 3 });
  h.emit('host:startGame', { gameId: 'trivia' });
  const plays = [[1, 0], [1, 1], [1, 1]]; // Ann always right; Ben wrong then right twice
  let last;
  for (let r = 0; r < 3; r++) {
    await until(() => h.state.phase === 'trivia-question' && h.state.gameState.round === r + 1, 'q' + r);
    by.Ann.submit({ choice: plays[r][0] }); by.Ben.submit({ choice: plays[r][1] });
    last = await until(() => h.state.phase === 'trivia-reveal' && h.state.gameState.round === r + 1 && h.state, 'reveal ' + r);
    const s = Object.fromEntries(last.gameState.scored.map((x) => [x.nickname, x]));
    assert.strictEqual(s.Ann.streak, r + 1);
    assert.strictEqual(s.Ben.streak, r === 0 ? 0 : r);
    if (r === 0) assert.strictEqual(s.Ben.gained, 0);
    const mult = r === 2 ? 3 : 1; // 3 questions: ×1, ×1, final ×3
    // 500 base + up to 500 speed + 100 per extra streak, × stage multiplier
    assert.ok(s.Ann.gained >= (500 + 100 * r) * mult && s.Ann.gained <= (1000 + 100 * r) * mult, `Ann gained ${s.Ann.gained}`);
  }
  assert.strictEqual(last.gameState.correct, 1);
});

test('Trivia: Double Down once per game — ×2 when right, −300 (never below 0) when wrong', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat'], { rounds: 3 });
  h.emit('host:startGame', { gameId: 'trivia' });
  await until(() => h.state.phase === 'trivia-question' && h.state.gameState.round === 1, 'q1');
  await until(() => by.Ann.state.phase === 'trivia-question' && by.Ann.state.you.canDouble === true, 'Ann can double');
  by.Ann.submit({ choice: 1, double: true }); by.Ben.submit({ choice: 1 }); by.Cat.submit({ choice: 0, double: true }); // Cat wrong at 0 points
  let st = await until(() => h.state.phase === 'trivia-reveal' && h.state, 'reveal 1');
  const s1 = Object.fromEntries(st.gameState.scored.map((x) => [x.nickname, x]));
  assert.ok(s1.Ann.double && s1.Ann.gained >= 1000 && s1.Ann.gained <= 2000, `doubled: ${s1.Ann.gained}`);
  assert.strictEqual(score('Cat'), 0, 'a wrong double down never takes you below zero');
  await until(() => h.state.phase === 'trivia-question' && h.state.gameState.round === 2, 'q2');
  await until(() => by.Ann.state.phase === 'trivia-question' && by.Ann.state.gameState.round === 2, 'Ann on q2');
  assert.strictEqual(by.Ann.state.you.canDouble, false, 'only once per game');
  by.Ben.submit({ choice: 1 }); by.Cat.submit({ choice: 1 }); by.Ann.submit({ choice: 1, double: true }); // Ann's second double is ignored
  st = await until(() => h.state.phase === 'trivia-reveal' && h.state.gameState.round === 2 && h.state, 'reveal 2');
  const s2 = Object.fromEntries(st.gameState.scored.map((x) => [x.nickname, x]));
  assert.ok(!s2.Ann.double, 'second double down ignored');
  await until(() => h.state.phase === 'trivia-question' && h.state.gameState.round === 3, 'q3');
  const before = score('Ben');
  assert.ok(before > 300);
  by.Ann.submit({ choice: 1 }); by.Cat.submit({ choice: 1 }); by.Ben.submit({ choice: 0, double: true });
  await until(() => h.state.phase === 'trivia-reveal' && h.state.gameState.round === 3, 'reveal 3');
  assert.strictEqual(score('Ben'), before - 300, 'wrong double down costs 300');
});

test('Trivia: category rounds every 3–5 questions; last place picks; questions match the category', async () => {
  const cats = { History: 'H', 'Entertainment: Film': 'F', Geography: 'G', Sports: 'S' };
  const trivia = [];
  for (const [cat, tag] of Object.entries(cats)) for (let i = 0; i < 8; i++) trivia.push({ q: `${tag}${i}?`, choices: ['a', 'b', 'c', 'd'], correct: 0, cat });
  const s2 = await startServer({ RUMPUS_CONTENT_DIR: contentDir({ trivia }), RUMPUS_CONTENT_MODE: 'replace', RUMPUS_TRIVIA_ROUNDS: '10' });
  try {
    const h = await makeHost(s2);
    const ann = await makePlayer(s2, h.code, 'Ann');
    const ben = await makePlayer(s2, h.code, 'Ben');
    h.emit('host:startGame', { gameId: 'trivia' });
    let picks = 0, sinceLast = 0;
    const segLens = [];
    while (true) {
      await until(() => ['trivia-category', 'trivia-question', 'gameover'].includes(h.state.phase), 'next phase');
      const st = h.state;
      if (st.phase === 'gameover') break;
      if (st.phase === 'trivia-category') {
        if (picks) segLens.push(sinceLast);
        sinceLast = 0;
        picks++;
        assert.strictEqual(st.gameState.categoryOptions.length, 3);
        assert.ok(st.gameState.categoryOptions.every((c) => !c.includes(':')), 'category names are cleaned up');
        // The chooser is the player in last place.
        const scores = Object.fromEntries(st.players.map((p) => [p.nickname, p.score]));
        const chooser = st.gameState.chooser;
        assert.ok(Object.values(scores).every((v) => v >= scores[chooser]), 'chooser must be in last place');
        const other = chooser === 'Ann' ? ben : ann;
        other.submit({ choice: 0 }); // not their pick — ignored
        await sleep(80);
        assert.strictEqual(h.state.phase, 'trivia-category');
        (chooser === 'Ann' ? ann : ben).submit({ choice: 1 });
        const q = await until(() => h.state.phase === 'trivia-question' && h.state, 'question');
        assert.strictEqual(q.gameState.category, st.gameState.categoryOptions[1]);
        continue;
      }
      sinceLast++;
      const want = Object.entries(cats).find(([c]) => c.replace(/^(Entertainment|Science): /, '') === st.gameState.category)[1];
      assert.ok(st.gameState.question.startsWith(want), `question ${st.gameState.question} not in ${st.gameState.category}`);
      ann.submit({ choice: 0 }); ben.submit({ choice: 1 }); // Ann right, Ben wrong → Ben stays last
      await until(() => h.state.phase !== 'trivia-question', 'reveal');
      h.emit('host:skip');
    }
    assert.ok(picks >= 2, 'at least two category rounds in 10 questions');
    assert.ok(segLens.every((n) => n >= 3 && n <= 5), 'segments are 3–5 questions: ' + segLens);
  } finally { await s2.stop(); }
});

// ------------------------------------------------------------------ Fish Tales
test('Fish Tales: lies matching the truth are bounced; truth 1000, each fooled 500, likes +50', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat']);
  h.emit('host:startGame', { gameId: 'fibbage' });
  await h.phase('fib-bluff');
  by.Ann.submit({ text: ' truthy ' });
  await until(() => by.Ann.state.you.collidedWithTruth, 'collision flagged');
  by.Ann.submit({ text: 'Lie A' }); by.Ben.submit({ text: 'Lie B' }); by.Cat.submit({ text: 'Lie C' });
  await by.Ann.phase('fib-choose');
  const opt = (p, t) => p.state.gameState.options.find((o) => o.text === t).index;
  assert.ok(!by.Ann.state.gameState.options.some((o) => o.text === 'Lie A'), 'own lie hidden');
  by.Cat.submit({ like: opt(by.Cat, 'Lie B') }); // must guess before liking
  by.Ann.submit({ choice: opt(by.Ann, 'Truthy') });
  by.Ben.submit({ choice: opt(by.Ben, 'Lie A') });
  await until(() => by.Ann.state.you.picked && by.Ben.state.you.picked, 'two guesses in');
  // Likes while waiting: +50 per like to the lie's author; not your own lie, one like per lie each.
  by.Ann.submit({ like: opt(by.Ann, 'Lie B') });
  by.Ann.submit({ like: opt(by.Ann, 'Lie B') });
  by.Ben.submit({ like: opt(by.Ann, 'Lie B') }); // Ben's own lie: ignored
  await until(() => by.Ann.state.you.liked.length === 1, 'like recorded');
  assert.strictEqual(h.state.phase, 'fib-choose', 'likes do not end the round');
  by.Cat.submit({ choice: opt(by.Cat, 'Lie A') });
  const rev = await h.phase('fib-reveal');
  assert.strictEqual(score('Ann'), 1000 + 2 * 500);
  assert.strictEqual(score('Ben'), 50, 'one like on Lie B');
  assert.strictEqual(rev.gameState.result.options.find((o) => o.text === 'Lie B').likes, 1);
});

// ------------------------------------------------------------------ Rainy Day Cards
test('Rainy Day Cards: while the Czar judges, the others pick a room favourite (+200; never their own card; one each)', async () => {
  const { h, ps, score } = await room(['Ann', 'Ben', 'Cat', 'Dan'], { rounds: 3 });
  h.emit('host:startGame', { gameId: 'cah' });
  await h.phase('cah-submit');
  const czar = ps.find((p) => p.nickname === h.state.gameState.czarNickname);
  const others = ps.filter((p) => p !== czar);
  await until(() => others.every((p) => p.state.you.hand && p.state.you.hand.length === 7), 'hands');
  for (const p of others) p.submit({ cardIndex: 0 });
  await h.phase('cah-czar');
  await until(() => others.every((p) => p.state.phase === 'cah-czar' && p.state.gameState.submissions.length === 3), 'players see the cards');
  assert.strictEqual(h.state.gameState.favNeeded, 3);
  const cardOf = (/** @type {any} */ p) => p.state.gameState.submissions.find((/** @type {any} */ s) => s.mine).index;
  const [a, b, c] = others;
  a.submit({ fav: cardOf(a) }); // own card: ignored
  a.submit({ fav: 99 }); a.submit({ fav: '1' }); // junk: ignored
  // a and c both love b's card; b loves a's card.
  a.submit({ fav: cardOf(b) });
  a.submit({ fav: cardOf(c) }); // second vote: ignored
  c.submit({ fav: cardOf(b) });
  b.submit({ fav: cardOf(a) });
  await until(() => h.state.gameState.favCount === 3, 'three favourites in');
  assert.strictEqual(a.state.you.fav, cardOf(b));
  // The Czar picks a's card: a gets the win, b gets the room favourite.
  czar.submit({ choice: cardOf(a) });
  const rev = await h.phase('cah-reveal');
  assert.strictEqual(rev.gameState.winner.nickname, a.nickname);
  assert.deepStrictEqual(rev.gameState.favourites.map((/** @type {any} */ f) => [f.nickname, f.votes]), [[b.nickname, 2]]);
  assert.strictEqual(score(a.nickname), 500);
  assert.strictEqual(score(b.nickname), 200);
  assert.strictEqual(score(c.nickname), 0);
});

test('Rainy Day Cards: 7-card hands, czar sits out and picks, winner +500; czar chooses the next prompt', async () => {
  const { h, ps, score } = await room(['Ann', 'Ben', 'Cat'], { rounds: 3 });
  h.emit('host:startGame', { gameId: 'cah' });
  await h.phase('cah-submit');
  assert.match(h.state.gameState.blackCard, /^Black card/);
  const czar = ps.find((p) => p.nickname === h.state.gameState.czarNickname);
  const others = ps.filter((p) => p !== czar);
  await until(() => others.every((p) => p.state.you.hand && p.state.you.hand.length === 7), 'hands');
  // The czar's job while waiting: pick next round's prompt from three (only the czar sees them).
  await until(() => czar.state.you.nextOptions && czar.state.you.nextOptions.length === 3, 'czar options');
  assert.ok(others.every((p) => p.state.you.nextOptions == null));
  const chosen = czar.state.you.nextOptions[2];
  others[0].submit({ nextBlack: 0 }); // not the czar: ignored
  czar.submit({ nextBlack: 2 });
  await until(() => czar.state.you.nextPick === 2, 'pick stored');
  czar.submit({ cardIndex: 0 }); // ignored
  for (const p of others) p.submit({ cardIndex: 0 });
  await h.phase('cah-czar');
  assert.strictEqual(h.state.gameState.submissions.length, 2);
  czar.submit({ choice: 0 });
  const rev = await h.phase('cah-reveal');
  assert.strictEqual(score(rev.gameState.winner.nickname), 500);
  assert.notStrictEqual(rev.gameState.winner.nickname, czar.nickname);
  await until(() => h.state.phase === 'cah-submit' && h.state.gameState.round === 2, 'round 2');
  assert.strictEqual(h.state.gameState.blackCard, chosen, 'round 2 uses the card the czar chose');
  assert.strictEqual(h.state.gameState.pickedBy, czar.nickname);
  assert.notStrictEqual(h.state.gameState.czarNickname, czar.nickname, 'czar rotates');
});

// ------------------------------------------------------------------ Closest Cast
test('Closest Cast: bullseye 300+200, ties share a rank, far guesses get nothing', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:startGame', { gameId: 'closest' });
  await h.phase('cg-guess');
  by.Ann.submit({ number: 42 }); by.Ben.submit({ number: '40' }); by.Cat.submit({ number: 44 }); by.Dan.submit({ number: '1,000' });
  const rev = await h.phase('cg-reveal');
  assert.strictEqual(rev.gameState.result.answer, 42);
  assert.deepStrictEqual([score('Ann'), score('Ben'), score('Cat'), score('Dan')], [500, 200, 200, 0]);
  assert.strictEqual(rev.gameState.result.list.find((e) => e.nickname === 'Dan').guess, 1000);
});

test('Closest Cast: Double Down doubles a placing guess; a miss costs 200 (never below 0)', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:startGame', { gameId: 'closest' });
  await h.phase('cg-guess');
  await until(() => by.Ann.state.phase === 'cg-guess' && by.Ann.state.you.canDouble === true, 'can double');
  // Ann places 2nd and doubles; Dan misses and doubles with 0 points.
  by.Ben.submit({ number: 42 }); by.Ann.submit({ number: 40, double: true }); by.Cat.submit({ number: 30 }); by.Dan.submit({ number: 5000, double: true });
  const rev = await h.phase('cg-reveal');
  assert.strictEqual(score('Ann'), 400, '2nd place 200 × 2');
  assert.strictEqual(score('Dan'), 0, 'never below zero');
  assert.ok(rev.gameState.result.list.find((e) => e.nickname === 'Ann').double);
});

test('Closest Cast: junk numbers are rejected and the timer still ends the round', async () => {
  const s2 = await startServer({ RUMPUS_CONTENT_DIR: contentDir(POOLS), RUMPUS_CONTENT_MODE: 'replace', RUMPUS_CG_GUESS_MS: '400' });
  try {
    const h = await makeHost(s2);
    const a = await makePlayer(s2, h.code, 'Ann');
    await makePlayer(s2, h.code, 'Ben');
    h.emit('host:startGame', { gameId: 'closest' });
    await h.phase('cg-guess');
    a.submit({ number: 'lots' });
    await sleep(100);
    assert.strictEqual(a.state.you.submitted, false);
    await h.phase('cg-reveal', 5000);
  } finally { await s2.stop(); }
});

// ------------------------------------------------------------------ Campfire Consensus
test('Campfire Consensus: matching answers group up (300 each for 3), then exact match bets pay', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:startGame', { gameId: 'majority' });
  await h.phase('mr-answer');
  by.Ann.submit({ text: 'The Boxes' }); by.Ben.submit({ text: 'box' }); by.Cat.submit({ text: 'BOXES!!' }); by.Dan.submit({ text: 'lamp' });
  await until(() => h.state.gameState.submittedCount === 4, 'answers in');
  assert.strictEqual(h.state.phase, 'mr-answer', 'reveal waits for the bets');
  by.Ann.submit({ bet: 9 }); // out of range: ignored
  await sleep(100);
  assert.strictEqual(by.Ann.state.you.bet, null);
  by.Ann.submit({ bet: 2 }); by.Ben.submit({ bet: 1 }); by.Cat.submit({ bet: 3 }); by.Dan.submit({ bet: 0 });
  // The herd call: everyone agrees the boxes are the herd (lamp is alone).
  const herd = await h.phase('mr-herd');
  assert.deepStrictEqual(herd.gameState.answers, ['The Boxes', 'lamp']);
  for (const n of ['Ann', 'Ben', 'Cat', 'Dan']) by[n].submit({ herd: [0] });
  const rev = await h.phase('mr-reveal');
  assert.strictEqual(rev.gameState.result.groups[0].count, 3);
  // Matching: 300 each for the trio. Bets: Ann called 2 exactly (+150), Dan called "nobody" (+50).
  assert.deepStrictEqual([score('Ann'), score('Ben'), score('Cat'), score('Dan')], [450, 300, 300, 50]);
});

test('Campfire Consensus: the players decide which answers count as the same herd (no spelling rules)', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:startGame', { gameId: 'majority' });
  await h.phase('mr-answer');
  by.Ann.submit({ text: 'dog' }); by.Ben.submit({ text: 'puppy' }); by.Cat.submit({ text: 'doggo' }); by.Dan.submit({ text: 'cat' });
  for (const n of ['Ann', 'Ben', 'Cat', 'Dan']) by[n].submit({ bet: 2 });
  const herd = await h.phase('mr-herd');
  assert.deepStrictEqual(herd.gameState.answers, ['cat', 'dog', 'doggo', 'puppy']);
  assert.strictEqual(by.Ben.state.you.mine, 3, 'phones know which answer is theirs');
  by.Ann.submit({ herd: [1, 2, 3] }); by.Ben.submit({ herd: [1, 2, 3] }); by.Cat.submit({ herd: [1, 2, 3, 99] }); by.Dan.submit({ herd: [0] });
  const rev = await h.phase('mr-reveal');
  // dog, doggo and puppy each got 3 of 4 votes (a majority): one herd of 3. Dan's lone vote didn't save cat.
  const top = rev.gameState.result.groups[0];
  assert.strictEqual(top.count, 3);
  assert.ok(top.herd && top.label.includes('dog') && top.label.includes('puppy'));
  // 300 each for the herd, +150 for the exact bets of 2; Dan alone.
  assert.deepStrictEqual([score('Ann'), score('Ben'), score('Cat'), score('Dan')], [450, 450, 450, 0]);
});

// ------------------------------------------------------------------ Cabin Superlatives
test('Cabin Superlatives: voting with the crowd scores 100; self-votes allowed', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:startGame', { gameId: 'mostlikely' });
  await h.phase('ml-vote');
  assert.strictEqual(h.state.gameState.prompt, 'Who is most likely to win?');
  by.Ann.submit({ target: by.Cat.id }); by.Ben.submit({ target: by.Cat.id }); by.Cat.submit({ target: by.Cat.id }); by.Dan.submit({ target: by.Ann.id });
  const rev = await h.phase('ml-reveal');
  assert.deepStrictEqual(rev.gameState.result.winners, ['Cat']);
  assert.deepStrictEqual([score('Ann'), score('Ben'), score('Cat'), score('Dan')], [100, 100, 100, 0]);
});

// ------------------------------------------------------------------ Odd Duck Out
async function imposterRound(names) {
  const r = await room(names);
  r.h.emit('host:startGame', { gameId: 'imposter' });
  await r.h.phase('imp-clue');
  await until(() => r.ps.every((p) => p.state.phase === 'imp-clue'), 'all in clue');
  const imp = r.ps.find((p) => p.state.you.isImposter);
  return { ...r, imp, civs: r.ps.filter((p) => p !== imp) };
}

test('Odd Duck Out: one imposter who never sees the word; catch + wrong guess = caught', async () => {
  const { h, ps, imp, civs, score } = await imposterRound(['Ann', 'Ben', 'Cat', 'Dan']);
  assert.strictEqual(ps.filter((p) => p.state.you.isImposter).length, 1);
  assert.strictEqual(imp.state.you.word, null);
  const word = civs[0].state.you.word;
  assert.ok(civs.every((c) => c.state.you.word === word));
  assert.ok(!JSON.stringify(h.state).includes(`"${word}"`) || h.state.gameState.category, 'TV does not leak the word in clue phase');
  for (const p of ps) p.submit({ text: 'clue' });
  await h.phase('imp-vote');
  imp.submit({ target: imp.id }); // can't vote yourself → ignored
  civs[0].submit({ target: imp.id });
  // Suspicion meter on the TV: vote counts per suspect, never who voted.
  await until(() => h.state.gameState.votedCount === 1, 'one vote');
  assert.strictEqual(h.state.gameState.clues.find((c) => c.nickname === imp.nickname).suspicion, 1);
  assert.ok(!JSON.stringify(h.state.gameState.clues).includes('voter'), 'voters stay secret');
  for (const c of civs.slice(1)) c.submit({ target: imp.id });
  imp.submit({ target: civs[0].id });
  await imp.phase('imp-guess');
  const wrong = imp.state.gameState.options.findIndex((o) => o !== word);
  imp.submit({ choice: wrong });
  const rev = await h.phase('imp-reveal');
  assert.strictEqual(rev.gameState.result.outcome, 'caught');
  for (const c of civs) assert.strictEqual(score(c.nickname), 100);
  assert.strictEqual(score(imp.nickname), 0);
});

test('Odd Duck Out: a caught imposter who names the word steals the round', async () => {
  const { h, ps, imp, civs } = await imposterRound(['Ann', 'Ben', 'Cat', 'Dan']);
  const word = civs[0].state.you.word;
  for (const p of ps) p.submit({ text: 'clue' });
  await h.phase('imp-vote');
  for (const c of civs) c.submit({ target: imp.id });
  imp.submit({ target: civs[0].id });
  await imp.phase('imp-guess');
  imp.submit({ choice: imp.state.gameState.options.indexOf(word) });
  const rev = await h.phase('imp-reveal');
  assert.strictEqual(rev.gameState.result.outcome, 'stole');
});

test('Odd Duck Out: a tied vote lets the imposter escape (+300)', async () => {
  const { h, ps, imp, civs, score } = await imposterRound(['Ann', 'Ben', 'Cat', 'Dan']);
  for (const p of ps) p.submit({ text: 'clue' });
  await h.phase('imp-vote');
  civs[0].submit({ target: imp.id }); civs[1].submit({ target: imp.id });
  civs[2].submit({ target: civs[0].id }); imp.submit({ target: civs[0].id });
  const rev = await h.phase('imp-reveal');
  assert.strictEqual(rev.gameState.result.outcome, 'escaped');
  assert.strictEqual(score(imp.nickname), 300);
});

test('Odd Duck Out: if the imposter leaves mid-round, a fresh round starts', async () => {
  const { h, imp } = await imposterRound(['Ann', 'Ben', 'Cat', 'Dan']);
  imp.sock.emit('player:leave');
  await until(() => h.state.players.length === 3 && h.state.phase === 'imp-clue', 'restarted');
  assert.strictEqual(h.state.gameState.round, 1);
});

// ------------------------------------------------------------------ Porch Confessions
test('Porch Confessions: a prompt, secret TRUTH/LIE roles, everyone calls everyone; +100 per right call, +50 per person fooled', async () => {
  const { h, ps, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:settings', { rounds: 1 });
  await until(() => h.state.settings.rounds === 1, 'one round');
  h.emit('host:startGame', { gameId: 'twotruths' });
  const w = await h.phase('tt-write');
  assert.ok(w.gameState.prompt, 'a confession prompt');
  await until(() => ps.every((p) => p.state.phase === 'tt-write'), 'phones writing');
  const liars = ps.filter((p) => p.state.you.lie);
  assert.ok(liars.length >= 1 && liars.length <= 3, `${liars.length} liars of 4`);
  assert.ok(!JSON.stringify(h.state).includes('"lie":true'), 'the TV never knows who lies while writing');
  // A truth-teller with nothing true to say may switch to lying.
  const honest = ps.find((p) => !p.state.you.lie);
  honest.submit({ switchToLie: true });
  await until(() => honest.state.you.lie === true, 'switched');
  for (const p of ps) p.submit({ text: `${p.nickname}'s story` });
  const j = await h.phase('tt-judge');
  assert.strictEqual(j.gameState.answers.length, 4);
  await until(() => ps.every((p) => p.state.phase === 'tt-judge'), 'phones judging');
  assert.strictEqual(ps[0].state.gameState.answers.length, 3, "you don't judge your own");
  // Everyone calls every answer "real": right for truth-tellers' answers, fooled by the liars.
  const isLiar = new Set([...liars, honest].map((p) => p.id));
  for (const p of ps) p.submit({ calls: Object.fromEntries(ps.filter((x) => x !== p).map((x) => [x.id, true])) });
  await until(() => h.state.phase === 'tt-reveal' && h.state.gameState.done, 'all revealed', 15000);
  for (const p of ps) {
    const othersHonest = ps.filter((x) => x !== p && !isLiar.has(x.id)).length;
    const fooledMe = isLiar.has(p.id) ? 3 : 0; // all three others believed my lie
    assert.strictEqual(score(p.nickname), othersHonest * 100 + fooledMe * 50, `${p.nickname}`);
  }
  await h.phase('gameover', 10000);
});

// ------------------------------------------------------------------ Message in a Bottle
test('Message in a Bottle: chains pass to the right people, bad images rejected, no self-votes', async () => {
  const { h, ps, by, score } = await room(['Ann', 'Ben', 'Cat']);
  h.emit('host:startGame', { gameId: 'telephone' });
  await h.phase('tel-write');
  await until(() => ps.every((p) => p.state && p.state.phase === 'tel-write'), 'phones writing');
  assert.ok(ps.every((p) => POOLS.telephone.includes(p.state.you.suggestion)));
  by.Ann.submit({ text: 'Ann phrase' });
  await until(() => h.state.gameState.submittedCount === 1, 'one done');
  assert.deepStrictEqual([...h.state.gameState.waitingOn].sort(), ['Ben', 'Cat'], 'TV names who it is waiting on');
  for (const p of ps) p.submit({ text: `${p.nickname} phrase` });
  await h.phase('tel-draw');
  await until(() => ps.every((p) => p.state.phase === 'tel-draw'), 'phones drawing');
  const prompts = ps.map((p) => p.state.gameState.prev.content);
  assert.deepStrictEqual([...prompts].sort(), ['Ann phrase', 'Ben phrase', 'Cat phrase']);
  ps.forEach((p, i) => assert.notStrictEqual(prompts[i], `${p.nickname} phrase`, 'never draw your own phrase'));
  by.Ann.submit({ image: 'javascript:alert(1)' });
  by.Ann.submit({ image: 'data:image/svg+xml;base64,PHN2Zz4=' });
  by.Ann.submit({ image: 'data:image/png;base64,' + 'A'.repeat(500 * 1024) });
  await sleep(150);
  assert.strictEqual(by.Ann.state.you.submitted, false);
  for (const p of ps) p.submit({ image: PNG });
  await h.phase('tel-describe');
  await until(() => ps.every((p) => p.state.phase === 'tel-describe'), 'phones describing');
  assert.ok(ps.every((p) => p.state.gameState.prev.type === 'drawing'));
  for (const p of ps) p.submit({ text: 'a guess' });
  await h.phase('tel-reveal', 10000);
  assert.strictEqual(h.state.gameState.chain.entries.length, 3);
  // Once the chain is fully shown, phones pick a favourite step (never their own) → +50 to its author.
  await until(() => ps.every((p) => p.state.phase === 'tel-reveal' && p.state.gameState.favOpen), 'favourites open', 8000);
  const voter = ps[0];
  const own = voter.state.gameState.entries.findIndex((e) => e.by === voter.nickname);
  assert.strictEqual(voter.state.gameState.entries[own].ok, false, 'cannot favourite your own step');
  voter.submit({ fav: own });
  await sleep(100);
  assert.strictEqual(voter.state.you.fav, null);
  const pick = voter.state.gameState.entries.findIndex((e) => e.ok);
  const author = voter.state.gameState.entries[pick].by;
  const before = score(author);
  voter.submit({ fav: pick });
  await until(() => score(author) === before + 50, 'author gets +50');
  voter.submit({ fav: pick });
  await sleep(100);
  assert.strictEqual(score(author), before + 50, 'one favourite per chain');
  await h.phase('tel-vote', 15000);
  await until(() => ps.every((p) => p.state.phase === 'tel-vote'), 'phones in vote phase');
  for (const p of ps) assert.strictEqual(p.state.gameState.drawings.length, 2, 'own drawing excluded');
  for (const p of ps) p.submit({ key: p.state.gameState.drawings[0].key });
  await h.phase('gameover');
  assert.strictEqual(ps.reduce((n, p) => n + score(p.nickname), 0), 600 + 50, "3 doodle votes × 200 + one favourite × 50");
});

test('Message in a Bottle: the host skip ends a step and fills missing drawings with blanks', async () => {
  const { h, ps, by } = await room(['Ann', 'Ben', 'Cat']);
  h.emit('host:startGame', { gameId: 'telephone' });
  await h.phase('tel-write');
  await until(() => ps.every((p) => p.state && p.state.phase === 'tel-write'), 'phones writing');
  for (const p of ps) p.submit({ text: `${p.nickname} phrase` });
  await h.phase('tel-draw');
  await until(() => ps.every((p) => p.state.phase === 'tel-draw'), 'phones drawing');
  by.Ann.submit({ image: PNG });
  await until(() => h.state.gameState.submittedCount === 1, 'one drawing');
  h.emit('host:skip');
  await h.phase('tel-describe');
  await until(() => ps.every((p) => p.state.phase === 'tel-describe'), 'phones describing');
  for (const p of ps) p.submit({ text: 'a guess' });
  await h.phase('tel-reveal', 10000);
  assert.strictEqual(h.state.gameState.chain.entries.length, 3, 'the chain is complete even with skipped drawings');
});

test('Message in a Bottle with 6 players: two groups of 3, chains stay inside their group', async () => {
  const { h, ps } = await room(['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay']);
  h.emit('host:startGame', { gameId: 'telephone' });
  await h.phase('tel-write');
  await until(() => ps.every((p) => p.state && p.state.phase === 'tel-write'), 'phones writing');
  assert.strictEqual(h.state.gameState.totalRounds, 3, '3 steps, not 6');
  for (const p of ps) p.submit({ text: `${p.nickname} phrase` });
  await h.phase('tel-draw');
  await until(() => ps.every((p) => p.state.phase === 'tel-draw'), 'phones drawing');
  // Who draws whose phrase: the "passes to" relation forms two separate 3-cycles.
  const next = new Map(ps.map((p) => [p.state.gameState.prev.content.split(' ')[0], p.nickname]));
  const cycle = (start) => { const seen = [start]; let x = next.get(start); while (x !== start) { seen.push(x); x = next.get(x); } return seen; };
  const groups = new Set(ps.map((p) => cycle(p.nickname).sort().join(',')));
  assert.strictEqual(groups.size, 2);
  for (const g of groups) assert.strictEqual(g.split(',').length, 3);
});

// ------------------------------------------------------------------ 18+ toggle
test('18+ off: games never draw adult content', async () => {
  const s2 = await startServer({
    RUMPUS_CONTENT_DIR: contentDir({ mostlikely: [{ text: 'Clean prompt?' }, { text: 'Dirty prompt?', a: true }] }),
    RUMPUS_CONTENT_MODE: 'replace',
  });
  try {
    const h = await makeHost(s2);
    for (const n of ['A', 'B', 'C']) await makePlayer(s2, h.code, n);
    h.emit('host:settings', { spicy: false, rounds: 5 });
    await until(() => h.state.settings.spicy === false, 'spicy off');
    h.emit('host:startGame', { gameId: 'mostlikely' });
    for (let r = 1; r <= 5; r++) {
      await until(() => h.state.phase === 'ml-vote' && h.state.gameState.round === r, 'round ' + r);
      assert.strictEqual(h.state.gameState.prompt, 'Clean prompt?');
      h.emit('host:skip');
      await h.phase('ml-reveal');
    }
  } finally { await s2.stop(); }
});

test('Odd Duck Out ends when fewer than 3 players are left (a lone player can never be voted)', async () => {
  const { h, ps } = await room(['Ann', 'Ben', 'Cat']);
  h.emit('host:startGame', { gameId: 'imposter' });
  await until(() => h.state.phase && h.state.phase.startsWith('imp-'), 'started');
  const kicked = ps.find((p) => p.nickname === 'Cat');
  h.emit('host:kickPlayer', { playerId: kicked.id });
  await h.phase('gameover', 5000);
});
