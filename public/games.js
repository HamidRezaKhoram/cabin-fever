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
  /** TV row naming who everyone is waiting on. @param {string[] | undefined} names @param {string} verb */
  const waitingRow = (names, verb) => (names && names.length
    ? `<p class="waiting-on">Still ${verb}: ${names.map((n) => `<span>${av(n)} ${esc(n)}</span>`).join('')}</p>` : '');
  const watchTv = (extra = '') => `<h1>Eyes on the TV 📺</h1>${extra}`;

  // ---------------------------------------------------------------- Punchline (head-to-head)
  register('quiplash', {
    host(s) {
      const g = s.gameState;
      if (s.phase === 'answering') {
        return `${roundTag(g)}<h1>Check your phones!</h1>
          <p class="big-sub">You each have <b>2 prompts</b>. Someone else got the same prompt — be funnier than them. ${T}</p>
          ${count(g.submittedCount, g.totalAnswers, 'answers in')}`;
      }
      const tag = `<p class="round-tag">Round ${g.round} · Matchup ${g.matchIndex + 1} of ${g.matchCount}${g.multiplier > 1 ? `<span class="double-badge">${g.multiplier}× POINTS</span>` : ''}</p>`;
      if (s.phase === 'voting') {
        return `${tag}<h1 class="prompt">${esc(g.prompt)}</h1>
          <div class="versus">
            <div class="vs-card a">${esc(g.answers[0].text)}</div>
            <div class="vs-badge">VS</div>
            <div class="vs-card b">${esc(g.answers[1].text)}</div>
          </div>
          <p class="big-sub">Vote on your phones! ${T}</p>${count(g.votedCount, g.voterCount, 'votes in')}`;
      }
      const r = g.result;
      return `${tag}<h1 class="prompt">${esc(r.prompt)}</h1>
        <div class="versus">${r.sides.map((sd, i) => `
          ${i === 1 ? '<div class="vs-badge">VS</div>' : ''}
          <div class="vs-card ${i ? 'b' : 'a'} ${r.winner === i ? 'won' : r.winner === -1 ? '' : 'lost'}">
            ${esc(sd.text)}
            <div class="vs-meta">${av(sd.nickname, 'avatar')} ${esc(sd.nickname)}</div>
            <div class="vs-bar"><i style="width:${sd.pct}%"></i></div>
            <div class="vs-meta"><b>${sd.pct}%</b> · ${sd.votes} vote${sd.votes === 1 ? '' : 's'} · +${sd.gained}
              <span class="voters">${sd.voters.map((n) => av(n)).join('')}</span></div>
            ${sd.shutout ? '<span class="sweep">SHUTOUT! +250</span>' : ''}
            ${sd.bet ? `<div class="vs-meta">🎲 ${esc(sd.bet.label)}: ${sd.bet.won ? `won +${sd.bet.pts}` : `lost ${sd.bet.pts}`}</div>` : ''}
          </div>`).join('')}
        </div>`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'answering') {
        if (you.submitted) return waiting('Both answers in');
        return `${roundTag(g)}<p class="round-tag">Prompt ${g.promptNumber} of ${g.promptTotal}</p>
          <h2 class="prompt">${esc(g.prompt)}</h2>
          <p>Someone else has this prompt too — beat them.</p>${textForm('Your funniest answer…', 100)}`;
      }
      if (s.phase === 'voting') {
        if (you.isAuthor) {
          if (you.bet) return `<h1>That's yours! 😬</h1><p>Side bet placed: <strong>${you.bet === 'landslide' ? 'Landslide' : "I'll win"}</strong>. Sweat it out…</p>`;
          return `<h1>That's yours! 😬</h1><p>Place a side bet while everyone votes:</p><div class="vote-list">
            ${sendBtn({ bet: 'win' }, "🤞 I'll win · +100 / −50")}${sendBtn({ bet: 'landslide' }, '🔥 Landslide (75%+) · +250 / −100')}</div>`;
        }
        if (you.voted) return waiting('Vote cast');
        return `<h2 class="prompt">${esc(g.prompt)}</h2><p>Which is funnier?</p><div class="vote-list">` +
          g.answers.map((a, i) => sendBtn({ choice: i }, esc(a.text))).join('') + '</div>';
      }
      const r = g.result;
      if (you.side >= 0) {
        const me = r.sides[you.side];
        return `<h1>${r.winner === you.side ? 'You won the matchup! 🏆' : r.winner === -1 ? 'Dead heat!' : 'Ouch. 💀'}</h1>
          <p class="prompt">${me.pct}% of the votes · +${me.gained}</p>${me.shutout ? '<p class="sweep">SHUTOUT!</p>' : ''}`;
      }
      return watchTv();
    },
  });

  // ---------------------------------------------------------------- Minigame Mayhem
  const teamName = (t) => (t === 'red' ? '🔴 RED' : t === 'blue' ? '🔵 BLUE' : '');
  register('minigames', {
    host(s) {
      const g = s.gameState;
      const tag = `<p class="round-tag">Minigame ${g.round} of ${g.totalRounds}</p>`;
      if (s.phase === 'mg-intro') {
        return `${tag}<h1 class="prompt mg-title">${esc(g.miniName)}</h1><p class="big-sub mg-rule">${esc(g.rule)}</p>`;
      }
      if (s.phase === 'mg-result') {
        const r = g.result;
        const head = r.winnerTeam ? (r.winnerTeam === 'tie' ? 'TIE!' : `${teamName(r.winnerTeam)} WINS!`) : `${esc((r.rows[0] || {}).nickname || '')} WINS!`;
        return `${tag}<h1 class="prompt">${esc(g.miniName)}: ${head}</h1>
          ${r.answer != null ? `<p class="big-answer">${g.mini === 'fireflies' ? r.answer + ' fireflies' : 'Target: 3.0 s'}</p>` : ''}
          <ol class="answers results">${r.rows.map((row) => `<li class="${row.gained ? 'winner' : ''} ${row.team ? 'team-' + row.team : ''}">
            ${av(row.nickname)} ${esc(row.nickname)} — ${esc(row.burnt ? 'BURNT 🔥' : row.value)}${typeof row.value === 'number' && row.unit ? ' ' + row.unit : ''}
            ${row.gained ? `<span class="votes">+${row.gained}</span>` : ''}</li>`).join('')}</ol>`;
      }
      // mg-play
      if (g.mini === 'tug') {
        if (g.tug) {
          const diff = g.tug.red - g.tug.blue;
          const pos = Math.max(-1, Math.min(1, diff / g.tug.goal)); // -1..1 (red pulls left)
          return `${tag}<h1 class="prompt">TAP! TAP! TAP!</h1>
            <div class="tug"><div class="tug-team red">🔴 ${g.tug.red}</div>
              <div class="tug-lake"><div class="tug-rope"><div class="tug-flag" style="left:${50 - pos * 45}%"></div></div></div>
              <div class="tug-team blue">${g.tug.blue} 🔵</div></div>`;
        }
        const max = Math.max(1, ...g.taps.map((t) => t.taps));
        return `${tag}<h1 class="prompt">TAP RACE!</h1><div class="bars">${g.taps.map((t) => `
          <div class="bar-row"><span class="bar-label">${av(t.nickname, 'avatar')} ${esc(t.nickname)}</span>
          <span class="bar" style="width:${(t.taps / max) * 100}%;animation:none"></span><span class="bar-n">${t.taps}</span></div>`).join('')}</div>`;
      }
      if (g.mini === 'quickdraw') {
        return g.sub === 'go' ? `<div class="qd go">GO!</div>` : `<div class="qd wait">WAIT…</div>`;
      }
      if (g.mini === 'fireflies') {
        if (g.sub === 'show') {
          return `<div class="fly-field">${g.flies.map((f) => `<i style="left:${f.x}%;top:${f.y}%;animation-delay:${f.d / 10}s"></i>`).join('')}</div>`;
        }
        return `${tag}<h1 class="prompt">How many fireflies?</h1><p class="big-sub">Guess on your phones! ${T}</p>${count(g.doneCount, g.totalPlayers, 'guesses in')}`;
      }
      return `${tag}<h1 class="prompt">🔥 ROAST! 🍡</h1><p class="big-sub">Hold the button and let go at exactly 3 seconds… ${T}</p>${count(g.doneCount, g.totalPlayers, 'done')}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      const badge = you.team ? `<p class="team-badge team-${you.team}">${teamName(you.team)}</p>` : '';
      if (s.phase === 'mg-intro') return `${badge}<h1>${esc(g.miniName)}</h1><p class="prompt">${esc(g.rule)}</p><p>Get ready…</p>`;
      if (s.phase === 'mg-result') return `<h1>${you.gained ? `+${you.gained}! 🎉` : 'Next one! 💪'}</h1>`;
      if (g.mini === 'tug') return `${badge}<button class="mg-big tap" data-mg="tap">TAP!</button><p class="mg-count">0</p>`;
      if (g.mini === 'quickdraw') {
        if (you.early) return `<h1>SPLASH! 💦</h1><p>Too early!</p>`;
        if (you.done) return waiting('Tapped');
        return `<button class="mg-big ${g.sub === 'go' ? 'go' : 'wait'}" data-mg="draw">${g.sub === 'go' ? 'GO!' : 'WAIT…'}</button>`;
      }
      if (g.mini === 'fireflies') {
        if (g.sub === 'show') return watchTv('<p>Count the fireflies!</p>');
        if (you.done) return waiting('Guess locked');
        return `<h2>How many fireflies?</h2><form class="number-form"><input name="number" inputmode="numeric" autocomplete="off" required><button type="submit">Lock it in</button></form>`;
      }
      if (you.done) return waiting('Roasted');
      return `<button class="mg-big roast" data-mg="roast">HOLD TO ROAST</button><p class="mg-count">Let go at 3.0 s</p>`;
    },
    bind(root, api) {
      const btn = /** @type {HTMLElement | null} */ (root.querySelector('[data-mg]'));
      if (!btn) return;
      const kind = btn.dataset.mg;
      if (kind === 'tap') {
        let pending = 0, total = 0;
        const label = /** @type {HTMLElement} */ (root.querySelector('.mg-count'));
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); pending++; total++; label.textContent = String(total); if (navigator.vibrate) navigator.vibrate(8); });
        const t = setInterval(() => { if (pending) { api.send({ tap: pending }); pending = 0; } }, 150);
        api.onCleanup(() => clearInterval(t));
      } else if (kind === 'draw') {
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); api.send({ tap: 1 }); });
      } else if (kind === 'roast') {
        let t0 = 0;
        const label = /** @type {HTMLElement} */ (root.querySelector('.mg-count'));
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); t0 = performance.now(); btn.classList.add('holding'); });
        const release = () => {
          if (!t0) return;
          const ms = Math.round(performance.now() - t0);
          t0 = 0;
          btn.classList.remove('holding');
          label.textContent = (ms / 1000).toFixed(2) + ' s';
          api.send({ hold: ms });
        };
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
      }
    },
  });

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
        <div class="bars">${r.tally.map((t, i) => `
          <div class="bar-row ${r.winners.includes(t.nickname) ? 'winner' : ''}" style="animation-delay:${(r.tally.length - 1 - i) * 0.6}s">
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
          <p class="big-sub">Type what <em>everyone else</em> will say — then bet how many will match you! ${T}</p>
          ${count(g.submittedCount, g.totalPlayers, 'answers in')}${count(g.betCount, g.totalPlayers, 'bets placed')}`;
      }
      return `${roundTag(g)}<h1 class="prompt">${esc(g.prompt)}</h1>
        <ol class="answers results suspense">${g.result.groups.map((gr, i, all) => `
          <li class="${gr.top ? 'winner' : ''}" style="animation-delay:${(all.length - 1 - i) * 0.5}s">${esc(gr.label)}
            <span class="votes">×${gr.count}</span>
            <span class="voters">${gr.names.map((n) => av(n)).join('')}</span></li>`).join('')}</ol>
        ${(g.result.bets || []).some((b) => b.gained) ? `<p class="big-sub">🎯 Called it: ${g.result.bets.filter((b) => b.gained).map((b) => `${av(b.nickname)} ${esc(b.nickname)} (${b.bet})`).join(', ')}</p>` : ''}
        ${scoredList(g.result.gained)}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'mr-answer') {
        if (you.submitted && you.bet == null) {
          return `<p class="prompt">“${esc(you.answer)}”</p><h2>How many others will say the same?</h2>
            <p>Call it exactly for bonus points (+${150} · “nobody” +50).</p><div class="bet-row">` +
            Array.from({ length: g.maxBet + 1 }, (_, n) => sendBtn({ bet: n }, String(n), 'vote-btn bet-btn')).join('') + '</div>';
        }
        if (you.submitted) return waiting('Answer + bet locked', `You bet ${you.bet} will match you. Waiting for the others…`);
        return `${roundTag(g)}<h2 class="prompt">${esc(g.prompt)}</h2>
          <p>Say what you think most people will say.</p>${textForm('Your answer…', 40)}`;
      }
      return `<h1>${you.matched ? `Matched ${you.matched} other${you.matched === 1 ? '' : 's'}!` : 'All alone ✗'}</h1>
        <p class="prompt">${esc(you.answer || '(no answer)')}</p>
        ${you.bet != null ? `<p>${you.bet === you.matched ? '🎯 Your bet was spot on!' : `You bet ${you.bet}.`}</p>` : ''}`;
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
        <ol class="answers results suspense">${r.list.map((e, i) => `
          <li class="${e.rank === 0 ? 'winner' : ''}" style="animation-delay:${(r.list.length - 1 - i) * 0.6 + 0.8}s">${av(e.nickname)} ${esc(e.nickname)}: ${fmt(e.guess)}${e.exact ? ' <span class="sweep">BULLSEYE!</span>' : ''}${e.double ? ' <span class="streak">🎲</span>' : ''}
            <span class="byline">(off by ${fmt(+e.off.toFixed(3))})</span>
            ${e.gained ? `<span class="votes">+${e.gained}</span>` : ''}</li>`).join('')}</ol>`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'cg-guess') {
        if (you.submitted) return waiting('Guess locked');
        return `${roundTag(g)}<h2 class="prompt">${esc(g.question)}</h2>
          ${you.canDouble ? '<button type="button" class="ghost-btn dd-toggle" data-dd aria-pressed="false">🎲 Double Down? ×2 if you place · −200 if not (once per game)</button>' : ''}
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
          ${count(g.submittedCount, g.totalPlayers, 'ready')}
          ${waitingRow(g.waitingOn, 'writing')}`;
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
        const val = (/** @type {string} */ name) => /** @type {HTMLInputElement} */ (/** @type {HTMLFormElement} */ (f).elements.namedItem(name)).value;
        api.send({ truths: [val('t1'), val('t2')], lie: val('lie') });
      });
    },
  });

  // ---------------------------------------------------------------- Odd One Out
  const outcomeText = (r) => ({
    escaped: `${esc(r.imposter)} got away with it! +300`,
    stole: `${esc(r.imposter)} was caught but guessed the word! +200`,
    caught: `Caught! ${esc(r.imposter)} was the imposter.`,
  }[r.outcome]);
  // meter: show each suspect's suspicion bar (vote phase); clues pop in one by one.
  const clueList = (clues, meter = false, total = 1) => `<ul class="clue-list">${clues.map((c, i) =>
    `<li style="animation-delay:${i * 0.6}s">${av(c.nickname, 'avatar')}<div><span class="pname">${esc(c.nickname)}</span><span class="clue">${esc(c.clue)}</span>
      ${meter ? `<span class="suspicion" title="votes"><i style="width:${Math.round(100 * (c.suspicion || 0) / Math.max(1, total))}%"></i></span>` : ''}</div></li>`).join('')}</ul>`;
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
        return `${head}<h1>Who's the imposter?</h1>${clueList(g.clues, true, g.totalPlayers)}
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

  // ---------------------------------------------------------------- Cottage Crush
  /** @param {{ nickname: string, agenda: string }[]} list */
  const exposedHtml = (list) => (list && list.length
    ? `<p class="crush-exposed">🕵️ Exposed: ${list.map((x) => `${av(x.nickname)} ${esc(x.nickname)} is the <b>${esc(x.agenda)}</b>`).join(' · ')}</p>` : '');
  register('crush', {
    host(s) {
      const g = s.gameState;
      const tag = `<p class="round-tag">Evening ${g.evening} of ${g.totalRounds}${g.multiplier > 1 ? `<span class="double-badge">${g.multiplier}× POINTS</span>` : ''}</p>`;
      if (s.phase === 'cr-mingle') {
        return `${tag}<h1>💌 Mingle!</h1><p class="big-sub">Slip notes to your crushes on your phones. ${T}</p>
          <ul class="crush-admirers">${g.admirers.map((/** @type {{ nickname: string, count: number }} */ x) => `<li>${av(x.nickname)} ${esc(x.nickname)} has ${x.count} admirer${x.count === 1 ? '' : 's'} 👀</li>`).join('')}</ul>
          <p class="count">${g.notesSent} notes sent</p>${exposedHtml(g.exposed)}`;
      }
      if (s.phase === 'cr-reply') return `${tag}<h1>✍️ Replies</h1><p class="big-sub">Answer your admirers… ${T}</p><p class="count">${g.repliesSent} / ${g.notesSent} replied</p>${exposedHtml(g.exposed)}`;
      if (s.phase === 'cr-pick') return `${tag}<h1>🌙 Who will you ask out?</h1><p class="big-sub">Pick a date on your phone — or stay in. ${T}</p>${count(g.pickedCount, g.totalPlayers, 'picked')}`;
      return `${tag}<h1>The dock reveal</h1><ol class="answers crush-pairs">${g.pairs.map((/** @type {any} */ p, /** @type {number} */ i) => `<li style="animation-delay:${(i * g.stepMs) / 1000}s" class="${p.mutual ? 'winner' : ''}">
          ${p.b === null ? `${av(p.a)} ${esc(p.a)} stayed in 🛋` : p.mutual ? `${av(p.a)} ${esc(p.a)} ❤️ ${av(p.b)} ${esc(p.b)} — it's a date!` : `${av(p.a)} ${esc(p.a)} asked ${av(p.b)} ${esc(p.b)}… 💔`}</li>`).join('')}</ol>${exposedHtml(g.exposed)}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      const role = you.agenda ? `<div class="role">Your secret agenda: <strong>${esc(you.agenda.name)}</strong><br><small>${esc(you.agenda.desc)}</small></div>` : '';
      /** @param {any[]} list @param {boolean} mine */
      const notes = (list, mine) => list.map((n) => `<li class="crush-note"><b>${mine ? '→ ' + esc(n.to) : esc(n.from)}:</b> ${esc(n.text)}${n.reply ? `<br><span class="byline">↩ ${esc(n.reply)}</span>` : ''}</li>`).join('');
      if (s.phase === 'cr-mingle') {
        const inbox = you.inbox.length ? `<h3>💌 Your notes</h3><ul class="crush-list">${notes(you.inbox, false)}</ul>` : '';
        if (you.notesLeft <= 0) return role + waiting('Notes sent', 'Watch the TV for gossip…') + inbox;
        return `${role}<h2>💌 ${you.notesLeft} note${you.notesLeft === 1 ? '' : 's'} left</h2>
          <label>To <select class="crush-to">${g.targets.map((/** @type {{ id: string, nickname: string }} */ t) => `<option value="${esc(t.id)}">${esc(t.nickname)}</option>`).join('')}</select></label>
          <div class="vote-list">${you.cards.map((/** @type {string} */ c) => `<button type="button" class="vote-btn crush-card" data-text="${esc(c)}">${esc(c)}</button>`).join('')}</div>
          <form class="crush-form"><input name="text" maxlength="80" autocomplete="off" placeholder="…or write your own"><button type="submit">Send</button></form>${inbox}`;
      }
      if (s.phase === 'cr-reply') {
        const open = you.inbox.filter((/** @type {any} */ n) => !n.reply);
        if (!open.length) return role + waiting(you.inbox.length ? 'All replied' : 'No notes tonight 😢', 'Waiting for the others…') + (you.outbox.length ? `<h3>Your sent notes</h3><ul class="crush-list">${notes(you.outbox, true)}</ul>` : '');
        const n = open[0];
        return `<h2>${esc(n.from)} wrote:</h2><p class="prompt">“${esc(n.text)}”</p><p>Reply:</p>
          <div class="vote-list crush-replies">${you.replyCards.map((/** @type {string} */ r) => sendBtn({ reply: n.id, text: r }, esc(r))).join('')}</div>`;
      }
      if (s.phase === 'cr-pick') {
        if (you.picked) return waiting('Date picked 🌙');
        return `${role}<h2>Who will you ask out tonight?</h2><div class="vote-list">` +
          g.targets.map((/** @type {{ id: string, nickname: string }} */ t) => sendBtn({ pick: t.id }, `${av(t.nickname)} ${esc(t.nickname)}`)).join('') +
          sendBtn({ pick: null }, '🛋 Stay in tonight') + '</div>';
      }
      const d = you.date;
      return `<h1>${!d ? 'Watch the dock 📺' : d.mutual ? `❤️ A date with ${esc(d.with)}!` : d.with === null ? '🛋 A quiet night in' : d.askedBy ? `💘 ${esc(d.with)} asked you out!` : `💔 ${esc(d.with)} had other plans`}</h1>
        ${d ? `<p>${d.gained >= 0 ? '+' : ''}${d.gained} points</p>` : ''}`;
    },
    bind(root, api) {
      const to = /** @type {HTMLSelectElement | null} */ (root.querySelector('.crush-to'));
      if (!to) return;
      root.querySelectorAll('.crush-card').forEach((b) => b.addEventListener('click', () => {
        api.send({ to: to.value, text: /** @type {HTMLElement} */ (b).dataset.text });
      }));
      const f = /** @type {HTMLFormElement | null} */ (root.querySelector('.crush-form'));
      if (f) f.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = /** @type {HTMLInputElement} */ (f.querySelector('input'));
        if (input.value.trim()) api.send({ to: to.value, text: input.value });
      });
    },
  });

  // ---------------------------------------------------------------- Game night
  /** @typedef {{ total: number, played: number, standings: { nickname: string, points: number }[] }} NightView */
  /** Running game-night leaderboard. @param {NightView} night @param {boolean} [between] */
  const nightTable = (night, between = false) => `<div class="night-table">
      <p class="round-tag">🎉 Game night · ${night.played} of ${night.total} played${between && night.played < night.total ? ' · next vote coming up…' : ''}</p>
      <ol class="answers standings">${night.standings.map((/** @type {{ nickname: string, points: number }} */ s) => `<li>${av(s.nickname)} ${esc(s.nickname)} <span class="votes">${s.points} pts</span></li>`).join('')}</ol>
    </div>`;
  window.Rumpus.nightTable = nightTable;
  register('night', {
    host(s) {
      const g = s.gameState, night = s.night || { played: 0, total: 0, standings: [] };
      if (s.phase === 'night-final') {
        const top = night.standings[0];
        return `<h1>🏆 Grand champion of the night</h1>
          ${top ? `<p class="big-answer">${av(top.nickname, 'avatar big bob')} ${esc(top.nickname)} — ${top.points} pts</p>` : ''}
          ${nightTable(night)}<p class="big-sub">Press End to go back to the menu.</p>`;
      }
      if (s.phase === 'night-pick') {
        return `<p class="round-tag">🎉 Game ${night.played + 1} of ${night.total}</p><h1>Next up:</h1>
          <p class="big-answer">${esc(g.options[g.chosen].name)}!</p>`;
      }
      return `<p class="round-tag">🎉 Game night · game ${night.played + 1} of ${night.total}</p>
        <h1>What do we play next?</h1><p class="big-sub">Vote on your phones! ${T}</p>
        <ol class="answers">${g.options.map((/** @type {{ name: string }} */ o, /** @type {number} */ i) => `<li>${esc(o.name)} <span class="votes">${'▮'.repeat(g.tally[i])}</span></li>`).join('')}</ol>
        ${count(g.votedCount, g.totalPlayers, 'votes in')}
        ${night.played ? nightTable(night) : ''}`;
    },
    player(s) {
      const g = s.gameState, you = s.you, night = s.night || { standings: [] };
      if (s.phase === 'night-final') {
        const rank = night.standings.findIndex((/** @type {{ nickname: string }} */ x) => x.nickname === you.nickname);
        return `<h1>${rank === 0 ? '🏆 You are the champion!' : `You finished #${rank + 1}`}</h1><p>${(night.standings[rank] || {}).points || 0} night points</p>`;
      }
      if (s.phase === 'night-pick') return watchTv(`<p>Next up: <strong>${esc(g.options[g.chosen].name)}</strong></p>`);
      if (you.voted) return waiting('Vote in');
      return '<h2>What do we play next?</h2><div class="vote-list">' + g.options.map((/** @type {{ name: string }} */ o, /** @type {number} */ i) => sendBtn({ choice: i }, esc(o.name))).join('') + '</div>';
    },
  });

  // ---------------------------------------------------------------- Doodle Telephone
  /** @param {{ type: string, content: string | null, by: string, favs?: number }} e @param {number} i @param {number} ms */
  const entryHtml = (e, i, ms) => `
    <div class="chain-entry" style="animation-delay:${(i * ms) / 1000}s">
      ${e.type === 'drawing'
        ? (e.content ? `<img src="${e.content}" alt="drawing">` : '<div class="blank-drawing">(blank)</div>')
        : `<p class="chain-text">${esc(e.content)}</p>`}
      <span class="byline">${i === 0 ? 'started by' : e.type === 'drawing' ? 'drawn by' : 'guessed by'} ${av(e.by)} ${esc(e.by)}</span>
      ${e.favs ? `<span class="favs">❤ ${e.favs}</span>` : ''}
    </div>`;
  register('telephone', {
    host(s) {
      const g = s.gameState;
      if (s.phase === 'tel-reveal') {
        return `<p class="round-tag">Chain ${g.chainIndex + 1} of ${g.chainCount} — ${av(g.chain.owner)} ${esc(g.chain.owner)}'s</p>
          <div class="chain">${g.chain.entries.map((e, i) => entryHtml(e, i, g.entryMs)).join('')}</div>
          ${g.favOpen ? `<p class="big-sub">Tap your favourite step on your phone! ❤ +50 ${T}</p>${count(g.favCount, g.favNeeded, 'picked')}` : ''}`;
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
      const verb = { write: 'writing', draw: 'drawing', describe: 'guessing' }[g.stepType];
      return `${roundTag(g, 'Step')}<h1>${msg}</h1><p class="big-sub">${T}</p>
        ${count(g.submittedCount, g.totalPlayers, 'done')}
        ${waitingRow(g.waitingOn, verb)}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'tel-reveal') {
        if (!g.favOpen) return watchTv('<p>The chains are being revealed…</p>');
        if (you.fav != null) return waiting('Favourite picked ❤');
        if (!you.canFav) return watchTv('<p>Everyone else is picking a favourite step…</p>');
        return `<h2>Favourite step? ❤</h2><div class="fav-pick">` + g.entries.map((e, i) => e.ok
          ? sendBtn({ fav: i }, e.type === 'drawing' ? `<img src="${e.content}" alt="drawing by ${esc(e.by)}">` : `“${esc(e.content)}”`, 'vote-btn fav-btn')
          : '').join('') + '</div>';
      }
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
      const fill = /** @type {HTMLElement | null} */ (root.querySelector('[data-fill]'));
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
        const input = /** @type {HTMLInputElement | null} */ (root.querySelector('.text-form input'));
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
