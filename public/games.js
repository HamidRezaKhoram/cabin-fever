/* Rumpus client renderers for the newer game modules. AGPLv3, see LICENSE.
 *
 * Each game registers { host(state) -> html, player(state) -> html, bind?(root, api) }.
 * play.js wires these generic hooks automatically:
 *   <form class="text-form">   -> send { text }
 *   <form class="number-form"> -> send { number }
 *   <button data-send='{"k":v}'> -> send that JSON payload
 */
'use strict';

(function () {
  const { esc, register, scoredList, av } = window.Rumpus;
  const T = '<span class="timer"></span>';

  const roundTag = (g, label = 'Round') =>
    g.round ? `<p class="round-tag">${label} ${g.round} of ${g.totalRounds}</p>` : '';
  const waiting = (title, sub = 'Waiting for the other players…') => `<h1>${title} ✓</h1><p>${sub}</p>`;
  const sendBtn = (payload, label, cls = 'vote-btn') =>
    `<button class="${cls}" data-send="${esc(JSON.stringify(payload))}">${label}</button>`;
  const textForm = (placeholder, max = 60, button = 'Send it') => `
    <form class="text-form">
      <input name="text" maxlength="${max}" autocomplete="off" placeholder="${esc(placeholder)}" required>
      <button type="submit">${button}</button>
    </form>`;
  const count = (a, b, what) => `<p class="count">${a} / ${b} ${what}</p>`;
  const watchTv = (extra = '') => `<h1>Eyes on the TV 📺</h1>${extra}`;

  // ---------------------------------------------------------------- Most Likely To
  register('mostlikely', {
    host(s) {
      const g = s.gameState;
      if (s.phase === 'ml-vote') {
        return `${roundTag(g)}<h1 class="prompt">${esc(g.prompt)}</h1>
          <p class="big-sub">Vote on your phones! ${T}</p>${count(g.votedCount, g.totalPlayers, 'votes in')}`;
      }
      const r = g.result;
      const max = r.tally.length ? r.tally[0].votes : 1;
      return `${roundTag(g)}<h1 class="prompt">${esc(g.prompt)}</h1>
        <div class="bars">${r.tally.map((t) => `
          <div class="bar-row ${r.winners.includes(t.nickname) ? 'winner' : ''}">
            <span class="bar-label">${av(t.nickname, 'avatar')} ${esc(t.nickname)}</span>
            <span class="bar" style="width:${(t.votes / max) * 100}%"></span>
            <span class="bar-n">${t.votes}</span>
          </div>`).join('')}</div>
        ${r.winners.length ? `<p class="big-sub winner-line">The group has spoken: ${r.winners.map((n) => av(n, 'avatar big bob') + ' ' + esc(n)).join(' & ')}!</p>` : '<p>No votes. Cowards.</p>'}
        ${scoredList(r.gained)}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'ml-vote') {
        if (you.voted) return waiting('Vote cast');
        return `${roundTag(g)}<h2 class="prompt">${esc(g.prompt)}</h2><div class="vote-list">` +
          g.targets.map((t) => sendBtn({ target: t.id }, av(t.nickname) + ' ' + esc(t.nickname) + (t.id === you.playerId ? ' (you)' : ''))).join('') +
          '</div>';
      }
      return `<h1>${you.withCrowd ? 'With the crowd! +100' : you.picked ? 'Against the grain ✗' : 'No vote'}</h1>
        <p class="prompt">${g.result.winners.map(esc).join(' & ') || '—'}</p>`;
    },
  });

  // ---------------------------------------------------------------- Majority Rules
  register('majority', {
    host(s) {
      const g = s.gameState;
      if (s.phase === 'mr-answer') {
        return `${roundTag(g)}<h1 class="prompt">${esc(g.prompt)}</h1>
          <p class="big-sub">Type what <em>everyone else</em> will say! ${T}</p>${count(g.submittedCount, g.totalPlayers, 'answers in')}`;
      }
      return `${roundTag(g)}<h1 class="prompt">${esc(g.prompt)}</h1>
        <ol class="answers results">${g.result.groups.map((gr) => `
          <li class="${gr.top ? 'winner' : ''}">${esc(gr.label)}
            <span class="votes">×${gr.count}</span>
            <span class="voters">${gr.names.map((n) => av(n)).join('')}</span></li>`).join('')}</ol>
        ${scoredList(g.result.gained)}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'mr-answer') {
        if (you.submitted) return waiting('Answer locked');
        return `${roundTag(g)}<h2 class="prompt">${esc(g.prompt)}</h2>
          <p>Say what you think most people will say.</p>${textForm('Your answer…', 40)}`;
      }
      return `<h1>${you.matched ? `Matched ${you.matched} other${you.matched === 1 ? '' : 's'}!` : 'All alone ✗'}</h1>
        <p class="prompt">${esc(you.answer || '(no answer)')}</p>`;
    },
  });

  // ---------------------------------------------------------------- Closest Guess
  const fmt = (n) => (Math.abs(n) >= 10000 ? Number(n).toLocaleString() : String(n));
  register('closest', {
    host(s) {
      const g = s.gameState;
      if (s.phase === 'cg-guess') {
        return `${roundTag(g)}<h1 class="prompt">${esc(g.question)}</h1>
          <p class="big-sub">Enter a number on your phones! ${T}</p>${count(g.submittedCount, g.totalPlayers, 'guesses in')}`;
      }
      const r = g.result;
      return `${roundTag(g)}<h1 class="prompt">${esc(g.question)}</h1>
        <p class="big-answer">${fmt(r.answer)} ${esc(r.unit)}</p>
        <ol class="answers results">${r.list.map((e) => `
          <li class="${e.rank === 0 ? 'winner' : ''}">${av(e.nickname)} ${esc(e.nickname)}: ${fmt(e.guess)}${e.exact ? ' <span class="sweep">BULLSEYE!</span>' : ''}
            <span class="byline">(off by ${fmt(+e.off.toFixed(3))})</span>
            ${e.gained ? `<span class="votes">+${e.gained}</span>` : ''}</li>`).join('')}</ol>`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'cg-guess') {
        if (you.submitted) return waiting('Guess locked');
        return `${roundTag(g)}<h2 class="prompt">${esc(g.question)}</h2>
          <form class="number-form">
            <input name="number" type="text" inputmode="decimal" pattern="-?[0-9.,]+" autocomplete="off"
              placeholder="Your guess${g.unit ? ' (' + esc(g.unit) + ')' : ''}" required>
            <button type="submit">Lock it in</button>
          </form>`;
      }
      const m = you.mine;
      return `<h1>${m ? (m.rank === 0 ? 'Closest! 🎯' : `#${m.rank + 1}`) : 'No guess'}</h1>
        <p class="prompt">Answer: ${fmt(g.result.answer)} ${esc(g.result.unit)}</p>
        ${m ? `<p>You said ${fmt(m.guess)}${m.gained ? ` — +${m.gained}` : ''}</p>` : ''}`;
    },
  });

  // ---------------------------------------------------------------- Two Truths & a Lie
  register('twotruths', {
    host(s) {
      const g = s.gameState;
      if (s.phase === 'tt-write') {
        return `<h1>Two Truths &amp; a Lie</h1>
          <p class="big-sub">On your phone: write two true things about yourself and one convincing lie. ${T}</p>
          ${count(g.submittedCount, g.totalPlayers, 'ready')}`;
      }
      const r = g.result;
      return `${roundTag(g, 'Player')}<h1 class="prompt">${av(g.subject, 'avatar big bob')} ${esc(g.subject)}</h1>
        <p class="big-sub">${r ? 'The lie was…' : `Which one is the lie? ${T}`}</p>
        <ol class="answers ${r ? 'results' : ''}">${g.statements.map((st, i) => `
          <li class="${r && r.lieIndex === i ? 'lie' : ''}">${esc(st)}
            ${r && r.picks[i].length ? `<span class="voters">${r.picks[i].map((n) => av(n)).join('')}</span>` : ''}</li>`).join('')}</ol>
        ${r ? `<p>${r.subjectGained ? `${esc(g.subject)} fooled ${r.fooled.length} and gets +${r.subjectGained}!` : `Nobody was fooled by ${esc(g.subject)}.`}</p>`
            : count(g.guessedCount, g.needed, 'guesses in')}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'tt-write') {
        if (you.submitted) return waiting('Ready');
        return `<h2>About you</h2>
          <form id="tt-form">
            <label>True thing #1</label><input name="t1" maxlength="100" autocomplete="off" required>
            <label>True thing #2</label><input name="t2" maxlength="100" autocomplete="off" required>
            <label class="lie-label">Your lie 🤥</label><input name="lie" maxlength="100" autocomplete="off" required>
            <button type="submit">Submit</button>
          </form>`;
      }
      if (s.phase === 'tt-guess') {
        if (you.isSubject) return `<h1>It's about you!</h1><p>Keep a straight face 😐</p>`;
        if (you.guessed) return waiting('Guess locked');
        return `<h2 class="prompt">Which is ${esc(g.subject)}'s lie?</h2><div class="vote-list">` +
          g.statements.map((st, i) => sendBtn({ choice: i }, esc(st))).join('') + '</div>';
      }
      if (you.isSubject) return `<h1>You fooled ${g.result.fooled.length}</h1>`;
      return `<h1>${you.correct ? 'Spotted it! +100' : you.guessed ? 'Fooled ✗' : 'No guess'}</h1>
        <p class="prompt">${esc(g.statements[g.result.lieIndex])}</p>`;
    },
    bind(root, api) {
      const f = root.querySelector('#tt-form');
      if (!f) return;
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        api.send({ truths: [f.t1.value, f.t2.value], lie: f.lie.value });
      });
    },
  });

  // ---------------------------------------------------------------- Odd One Out
  const outcomeText = (r) => ({
    escaped: `${esc(r.imposter)} got away with it! +300`,
    stole: `${esc(r.imposter)} was caught but guessed the word! +200`,
    caught: `Caught! ${esc(r.imposter)} was the imposter.`,
  }[r.outcome]);
  const clueList = (clues) => `<ul class="clue-list">${clues.map((c) =>
    `<li>${av(c.nickname, 'avatar')}<div><span class="pname">${esc(c.nickname)}</span><span class="clue">${esc(c.clue)}</span></div></li>`).join('')}</ul>`;
  register('imposter', {
    host(s) {
      const g = s.gameState;
      const head = `${roundTag(g)}<p class="round-tag">Category: ${esc(g.category)}</p>`;
      if (s.phase === 'imp-clue') {
        return `${head}<h1>Check your phone 🤫</h1>
          <p class="big-sub">Everyone has the secret word — except the imposter. Give a one-word clue! ${T}</p>
          ${count(g.submittedCount, g.totalPlayers, 'clues in')}`;
      }
      if (s.phase === 'imp-vote') {
        return `${head}<h1>Who's the imposter?</h1>${clueList(g.clues)}
          <p class="big-sub">Vote on your phones! ${T}</p>${count(g.votedCount, g.totalPlayers, 'votes in')}`;
      }
      if (s.phase === 'imp-guess') {
        return `${head}<h1>${av(g.imposter, 'avatar big bob')} ${esc(g.imposter)} was caught!</h1>
          <p class="big-sub">…but can they guess the secret word? ${T}</p>
          <ol class="answers">${g.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>`;
      }
      const r = g.result;
      return `${head}<h1 class="prompt">${outcomeText(r)}</h1>
        <p class="big-answer">The word was: ${esc(r.word)}</p>
        ${r.guess ? `<p>Imposter guessed: ${esc(r.guess)}</p>` : ''}
        ${clueList(g.clues)}${scoredList(r.gained)}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      const role = you.isImposter
        ? `<div class="role imposter">You are the IMPOSTER<br><small>Category: ${esc(g.category)}</small></div>`
        : `<div class="role">Secret word: <strong>${esc(you.word)}</strong><br><small>${esc(g.category)}</small></div>`;
      if (s.phase === 'imp-clue') {
        if (you.submitted) return role + waiting('Clue sent');
        return `${role}<p>${you.isImposter ? 'Blend in! Give a clue that fits the category.' : 'Give a one-word clue — not too obvious, the imposter is listening!'}</p>
          ${textForm('One-word clue', 30)}`;
      }
      if (s.phase === 'imp-vote') {
        if (you.voted) return role + waiting('Vote cast');
        return `${role}<h2>Who's the imposter?</h2><div class="vote-list">` +
          g.clues.map((c) => sendBtn({ target: c.id }, `${esc(c.nickname)} <span class="byline">“${esc(c.clue)}”</span>`)).join('') + '</div>';
      }
      if (s.phase === 'imp-guess') {
        if (!you.isImposter) return role + `<h1>${esc(g.imposter)} is guessing…</h1>`;
        return `${role}<h2>You were caught! Guess the word to steal points:</h2><div class="vote-list">` +
          g.options.map((o, i) => sendBtn({ choice: i }, esc(o))).join('') + '</div>';
      }
      return `<h1>${outcomeText(g.result)}</h1><p class="prompt">Word: ${esc(g.result.word)}</p>`;
    },
  });

  // ---------------------------------------------------------------- Doodle Telephone
  const entryHtml = (e, i, ms) => `
    <div class="chain-entry" style="animation-delay:${(i * ms) / 1000}s">
      ${e.type === 'drawing'
        ? (e.content ? `<img src="${e.content}" alt="drawing">` : '<div class="blank-drawing">(blank)</div>')
        : `<p class="chain-text">${esc(e.content)}</p>`}
      <span class="byline">${i === 0 ? 'started by' : e.type === 'drawing' ? 'drawn by' : 'guessed by'} ${av(e.by)} ${esc(e.by)}</span>
    </div>`;
  register('telephone', {
    host(s) {
      const g = s.gameState;
      if (s.phase === 'tel-reveal') {
        return `<p class="round-tag">Chain ${g.chainIndex + 1} of ${g.chainCount} — ${av(g.chain.owner)} ${esc(g.chain.owner)}'s</p>
          <div class="chain">${g.chain.entries.map((e, i) => entryHtml(e, i, g.entryMs)).join('')}</div>`;
      }
      if (s.phase === 'tel-vote') {
        return `<h1>Vote for the best doodle!</h1><p class="big-sub">${T}</p>
          <div class="doodle-grid">${g.drawings.map((d, i) =>
            `<figure><img src="${d.image}" alt=""><figcaption>${i + 1}</figcaption></figure>`).join('')}</div>
          ${count(g.votedCount, g.totalPlayers, 'votes in')}`;
      }
      const msg = {
        write: 'Write a silly phrase for someone else to draw!',
        draw: 'Draw what your phone says!',
        describe: 'Describe the drawing on your phone!',
      }[g.stepType];
      return `${roundTag(g, 'Step')}<h1>${msg}</h1><p class="big-sub">${T}</p>
        ${count(g.submittedCount, g.totalPlayers, 'done')}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'tel-reveal') return watchTv('<p>The chains are being revealed…</p>');
      if (s.phase === 'tel-vote') {
        if (you.voted) return waiting('Vote cast');
        if (!g.drawings.length) return '<h1>Nothing to vote on</h1>';
        return `<h2>Best doodle?</h2><div class="doodle-pick">` +
          g.drawings.map((d) => sendBtn({ key: d.key }, `<img src="${d.image}" alt="">`, 'doodle-btn')).join('') + '</div>';
      }
      if (you.submitted) return waiting('Passed it on');
      if (g.stepType === 'write') {
        return `${roundTag(g, 'Step')}<h2>Write something to draw</h2>
          ${textForm('e.g. ' + you.suggestion, 80)}
          <button class="ghost-btn" data-fill="${esc(you.suggestion)}">Use “${esc(you.suggestion)}”</button>`;
      }
      if (g.stepType === 'draw') {
        return `${roundTag(g, 'Step')}<p class="draw-prompt">Draw: <strong>${esc(g.prev && g.prev.content)}</strong> <span class="timer"></span></p>
          <div id="pad"></div><button id="draw-done" class="wide">Done</button>`;
      }
      return `${roundTag(g, 'Step')}<h2>What is this?</h2>
        ${g.prev && g.prev.content ? `<img class="describe-img" src="${g.prev.content}" alt="">` : '<div class="blank-drawing">(they drew nothing!)</div>'}
        ${textForm('Describe it…', 80)}`;
    },
    bind(root, api) {
      const fill = root.querySelector('[data-fill]');
      if (fill) fill.addEventListener('click', () => api.send({ text: fill.dataset.fill }));
      const padEl = root.querySelector('#pad');
      const endsAt = api.state.gameState.endsAt;
      let autoFn = null;
      if (padEl) {
        const pad = window.Rumpus.drawPad(padEl);
        const submit = () => api.send({ image: pad.toDataURL() });
        root.querySelector('#draw-done').addEventListener('click', () => {
          if (pad.isEmpty() && !confirm('Submit a blank drawing?')) return;
          submit();
        });
        autoFn = () => { if (!pad.isEmpty()) submit(); };
      } else {
        const input = root.querySelector('.text-form input');
        if (input) autoFn = () => { if (input.value.trim()) api.send({ text: input.value }); };
      }
      // Time's up: send whatever they have so it isn't lost.
      if (autoFn && endsAt) {
        const t = setTimeout(autoFn, Math.max(0, endsAt - Date.now() - 300));
        api.onCleanup(() => clearTimeout(t));
      }
    },
  });
})();
