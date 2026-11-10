'use strict';
/* Rules and scoring for every game, with deterministic custom content. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, until, sleep, makeHost, makePlayer, contentDir, PNG } = require('../helpers');

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
  'cah-black': [{ text: 'Black card ____.' }],
  'cah-white': Array.from({ length: 40 }, (_, i) => ({ text: `White ${i}` })),
};

let srv;
before(async () => {
  srv = await startServer({ RUMPUS_CONTENT_DIR: contentDir(POOLS), RUMPUS_CONTENT_MODE: 'replace' });
});
after(() => srv.stop());

async function room(names, settings) {
  const h = await makeHost(srv);
  const ps = [];
  for (const n of names) ps.push(await makePlayer(srv, h.code, n));
  await until(() => h.state.players.length === names.length, 'all joined');
  if (settings) {
    h.emit('host:settings', settings);
    await until(() => Object.entries(settings).every(([k, v]) => h.state.settings[k] === v), 'settings');
  }
  const by = Object.fromEntries(ps.map((p) => [p.nickname, p]));
  const score = (n) => h.state.players.find((p) => p.nickname === n).score;
  return { h, ps, by, score };
}

// ------------------------------------------------------------------ Punchline
async function answerAll(players) {
  // Each player answers both of their prompts.
  for (let k = 0; k < 2; k++) {
    for (const p of players) {
      await until(() => p.state && (p.state.you.submitted || p.state.gameState.promptNumber === k + 1), `${p.nickname} prompt ${k + 1}`);
      if (!p.state.you.submitted) p.submit({ text: `${p.nickname}-${k}` });
    }
  }
}

test('Punchline: everyone gets 2 prompts, each prompt goes to exactly 2 rivals', async () => {
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

test('Punchline: authors cannot vote on their own matchup; votes 100 each; SHUTOUT +250', async () => {
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

test('Punchline: a missing answer forfeits the matchup', async () => {
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

test('Punchline: final round is worth double and flagged', async () => {
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
    // Skip through the remaining matchups to the next round.
    await until(() => {
      if (h.state.phase === 'gameover' || (h.state.phase === 'answering' && h.state.gameState.round === round + 1)) return true;
      h.emit('host:skip');
      return false;
    }, 'end of round ' + round, 15000);
  }
  await h.phase('gameover');
});

test('Punchline needs 3 players', async () => {
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

// ------------------------------------------------------------------ Fib Finder
test('Fib Finder: lies matching the truth are bounced; truth 1000, each fooled 500', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat']);
  h.emit('host:startGame', { gameId: 'fibbage' });
  await h.phase('fib-bluff');
  by.Ann.submit({ text: ' truthy ' });
  await until(() => by.Ann.state.you.collidedWithTruth, 'collision flagged');
  by.Ann.submit({ text: 'Lie A' }); by.Ben.submit({ text: 'Lie B' }); by.Cat.submit({ text: 'Lie C' });
  await by.Ann.phase('fib-choose');
  const opt = (p, t) => p.state.gameState.options.find((o) => o.text === t).index;
  assert.ok(!by.Ann.state.gameState.options.some((o) => o.text === 'Lie A'), 'own lie hidden');
  by.Ann.submit({ choice: opt(by.Ann, 'Truthy') });
  by.Ben.submit({ choice: opt(by.Ben, 'Lie A') });
  by.Cat.submit({ choice: opt(by.Cat, 'Lie A') });
  await h.phase('fib-reveal');
  assert.strictEqual(score('Ann'), 1000 + 2 * 500);
  assert.strictEqual(score('Ben'), 0);
});

// ------------------------------------------------------------------ Card Chaos
test('Card Chaos: 7-card hands, czar sits out and picks, winner +500', async () => {
  const { h, ps, score } = await room(['Ann', 'Ben', 'Cat']);
  h.emit('host:startGame', { gameId: 'cah' });
  await h.phase('cah-submit');
  assert.strictEqual(h.state.gameState.blackCard, 'Black card ____.');
  const czar = ps.find((p) => p.nickname === h.state.gameState.czarNickname);
  const others = ps.filter((p) => p !== czar);
  await until(() => others.every((p) => p.state.you.hand && p.state.you.hand.length === 7), 'hands');
  czar.submit({ cardIndex: 0 }); // ignored
  for (const p of others) p.submit({ cardIndex: 0 });
  await h.phase('cah-czar');
  assert.strictEqual(h.state.gameState.submissions.length, 2);
  czar.submit({ choice: 0 });
  const rev = await h.phase('cah-reveal');
  assert.strictEqual(score(rev.gameState.winner.nickname), 500);
  assert.notStrictEqual(rev.gameState.winner.nickname, czar.nickname);
});

// ------------------------------------------------------------------ Closest Guess
test('Closest Guess: bullseye 300+200, ties share a rank, far guesses get nothing', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:startGame', { gameId: 'closest' });
  await h.phase('cg-guess');
  by.Ann.submit({ number: 42 }); by.Ben.submit({ number: '40' }); by.Cat.submit({ number: 44 }); by.Dan.submit({ number: '1,000' });
  const rev = await h.phase('cg-reveal');
  assert.strictEqual(rev.gameState.result.answer, 42);
  assert.deepStrictEqual([score('Ann'), score('Ben'), score('Cat'), score('Dan')], [500, 200, 200, 0]);
  assert.strictEqual(rev.gameState.result.list.find((e) => e.nickname === 'Dan').guess, 1000);
});

test('Closest Guess: junk numbers are rejected and the timer still ends the round', async () => {
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

// ------------------------------------------------------------------ Majority Rules
test('Majority Rules: matching answers group up; 3 of a kind score 300 each, loners 0', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:startGame', { gameId: 'majority' });
  await h.phase('mr-answer');
  by.Ann.submit({ text: 'The Boxes' }); by.Ben.submit({ text: 'box' }); by.Cat.submit({ text: 'BOXES!!' }); by.Dan.submit({ text: 'lamp' });
  const rev = await h.phase('mr-reveal');
  assert.strictEqual(rev.gameState.result.groups[0].count, 3);
  assert.deepStrictEqual([score('Ann'), score('Ben'), score('Cat'), score('Dan')], [300, 300, 300, 0]);
});

// ------------------------------------------------------------------ Most Likely To
test('Most Likely To: voting with the crowd scores 100; self-votes allowed', async () => {
  const { h, by, score } = await room(['Ann', 'Ben', 'Cat', 'Dan']);
  h.emit('host:startGame', { gameId: 'mostlikely' });
  await h.phase('ml-vote');
  assert.strictEqual(h.state.gameState.prompt, 'Who is most likely to win?');
  by.Ann.submit({ target: by.Cat.id }); by.Ben.submit({ target: by.Cat.id }); by.Cat.submit({ target: by.Cat.id }); by.Dan.submit({ target: by.Ann.id });
  const rev = await h.phase('ml-reveal');
  assert.deepStrictEqual(rev.gameState.result.winners, ['Cat']);
  assert.deepStrictEqual([score('Ann'), score('Ben'), score('Cat'), score('Dan')], [100, 100, 100, 0]);
});

// ------------------------------------------------------------------ Odd One Out
async function imposterRound(names) {
  const r = await room(names);
  r.h.emit('host:startGame', { gameId: 'imposter' });
  await r.h.phase('imp-clue');
  await until(() => r.ps.every((p) => p.state.phase === 'imp-clue'), 'all in clue');
  const imp = r.ps.find((p) => p.state.you.isImposter);
  return { ...r, imp, civs: r.ps.filter((p) => p !== imp) };
}

test('Odd One Out: one imposter who never sees the word; catch + wrong guess = caught', async () => {
  const { h, ps, imp, civs, score } = await imposterRound(['Ann', 'Ben', 'Cat', 'Dan']);
  assert.strictEqual(ps.filter((p) => p.state.you.isImposter).length, 1);
  assert.strictEqual(imp.state.you.word, null);
  const word = civs[0].state.you.word;
  assert.ok(civs.every((c) => c.state.you.word === word));
  assert.ok(!JSON.stringify(h.state).includes(`"${word}"`) || h.state.gameState.category, 'TV does not leak the word in clue phase');
  for (const p of ps) p.submit({ text: 'clue' });
  await h.phase('imp-vote');
  imp.submit({ target: imp.id }); // can't vote yourself → ignored
  for (const c of civs) c.submit({ target: imp.id });
  imp.submit({ target: civs[0].id });
  await imp.phase('imp-guess');
  const wrong = imp.state.gameState.options.findIndex((o) => o !== word);
  imp.submit({ choice: wrong });
  const rev = await h.phase('imp-reveal');
  assert.strictEqual(rev.gameState.result.outcome, 'caught');
  for (const c of civs) assert.strictEqual(score(c.nickname), 100);
  assert.strictEqual(score(imp.nickname), 0);
});

test('Odd One Out: a tied vote lets the imposter escape (+300)', async () => {
  const { h, ps, imp, civs, score } = await imposterRound(['Ann', 'Ben', 'Cat', 'Dan']);
  for (const p of ps) p.submit({ text: 'clue' });
  await h.phase('imp-vote');
  civs[0].submit({ target: imp.id }); civs[1].submit({ target: imp.id });
  civs[2].submit({ target: civs[0].id }); imp.submit({ target: civs[0].id });
  const rev = await h.phase('imp-reveal');
  assert.strictEqual(rev.gameState.result.outcome, 'escaped');
  assert.strictEqual(score(imp.nickname), 300);
});

test('Odd One Out: if the imposter leaves mid-round, a fresh round starts', async () => {
  const { h, imp } = await imposterRound(['Ann', 'Ben', 'Cat', 'Dan']);
  imp.sock.emit('player:leave');
  await until(() => h.state.players.length === 3 && h.state.phase === 'imp-clue', 'restarted');
  assert.strictEqual(h.state.gameState.round, 1);
});

// ------------------------------------------------------------------ Two Truths & a Lie
test('Two Truths: incomplete sets rejected; subject cannot guess; 75 per person fooled', async () => {
  const { h, ps, score } = await room(['Ann', 'Ben', 'Cat']);
  h.emit('host:startGame', { gameId: 'twotruths' });
  await h.phase('tt-write');
  ps[0].submit({ truths: ['only one'], lie: 'x' });
  await sleep(100);
  assert.strictEqual(ps[0].state.you.submitted, false);
  for (const p of ps) p.submit({ truths: [`${p.nickname} t1`, `${p.nickname} t2`], lie: `${p.nickname} LIE` });
  const first = await h.phase('tt-guess');
  const subject = ps.find((p) => p.nickname === first.gameState.subject);
  const others = ps.filter((p) => p !== subject);
  const lie = first.gameState.statements.findIndex((s) => s.endsWith('LIE'));
  subject.submit({ choice: lie }); // ignored
  others[0].submit({ choice: lie });
  others[1].submit({ choice: (lie + 1) % 3 });
  const rev = await h.phase('tt-reveal');
  assert.strictEqual(rev.gameState.result.lieIndex, lie);
  assert.strictEqual(score(others[0].nickname), 100);
  assert.strictEqual(score(subject.nickname), 75);
});

// ------------------------------------------------------------------ Doodle Telephone
test('Doodle Telephone: chains pass to the right people, bad images rejected, no self-votes', async () => {
  const { h, ps, by, score } = await room(['Ann', 'Ben', 'Cat']);
  h.emit('host:startGame', { gameId: 'telephone' });
  await h.phase('tel-write');
  await until(() => ps.every((p) => p.state && p.state.phase === 'tel-write'), 'phones writing');
  assert.ok(ps.every((p) => POOLS.telephone.includes(p.state.you.suggestion)));
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
  await h.phase('tel-vote', 10000);
  await until(() => ps.every((p) => p.state.phase === 'tel-vote'), 'phones in vote phase');
  for (const p of ps) assert.strictEqual(p.state.gameState.drawings.length, 2, 'own drawing excluded');
  for (const p of ps) p.submit({ key: p.state.gameState.drawings[0].key });
  await h.phase('gameover');
  assert.strictEqual(ps.reduce((n, p) => n + score(p.nickname), 0), 600);
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
