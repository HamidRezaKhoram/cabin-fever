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

  // ---------------------------------------------------------------- Campfire Quips (head-to-head)
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

  // ---------------------------------------------------------------- Cottage Olympics
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
        if (you.done) return waiting('Guess locked');
        return `<h2>${g.sub === 'show' ? 'Count the fireflies on the TV!' : 'How many fireflies?'}</h2><form class="number-form"><input name="number" inputmode="numeric" autocomplete="off" required><button type="submit">Lock it in</button></form>`;
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

  // ---------------------------------------------------------------- Cabin Superlatives
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

  // ---------------------------------------------------------------- Campfire Consensus
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

  // ---------------------------------------------------------------- Closest Cast
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

  // ---------------------------------------------------------------- Porch Confessions
  register('twotruths', {
    host(s) {
      const g = s.gameState;
      if (s.phase === 'tt-write') {
        return `<h1>Porch Confessions &amp; a Lie</h1>
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

  // ---------------------------------------------------------------- Odd Duck Out
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
    /** @param {any} s */
    narrate(s) {
      const g = s.gameState;
      if (s.phase === 'cr-mingle') return g.evening === 1 ? 'Welcome to the singles weekend. Slip a note to someone special.' : `Evening ${g.evening}. The dock lights are on.`;
      if (s.phase === 'cr-pick') return 'Who will you ask out tonight?';
      if (s.phase === 'cr-reveal') { const p = (g.pairs || []).find((/** @type {{ mutual: boolean }} */ x) => x.mutual); return p ? `It's a date: ${p.a} and ${p.b}!` : 'Nobody matched tonight. Ouch.'; }
      return null;
    },
    host(s) {
      const g = s.gameState;
      const tag = `<p class="round-tag">Evening ${g.evening} of ${g.totalRounds}${g.multiplier > 1 ? `<span class="double-badge">${g.multiplier}× POINTS</span>` : ''}</p>`;
      if (s.phase === 'cr-mingle') {
        return `${tag}<h1>💌 Mingle!</h1><p class="big-sub">Slip notes to your crushes on your phones. ${T}</p>
          <ul class="crush-admirers">${g.admirers.map((/** @type {{ nickname: string, count: number }} */ x) => `<li>${av(x.nickname)} ${esc(x.nickname)} has ${x.count} admirer${x.count === 1 ? '' : 's'} 👀</li>`).join('')}</ul>
          <p class="count">${g.notesSent} notes sent${g.winks ? ` · 😉 ${g.winks} wink${g.winks === 1 ? '' : 's'}` : ''}</p>${exposedHtml(g.exposed)}`;
      }
      if (s.phase === 'cr-reply') return `${tag}<h1>✍️ Replies</h1><p class="big-sub">Answer your admirers… ${T}</p><p class="count">${g.repliesSent} / ${g.notesSent} replied</p>${exposedHtml(g.exposed)}`;
      if (s.phase === 'cr-pick') return `${tag}<h1>🌙 Who will you ask out?</h1><p class="big-sub">Pick a date on your phone — or stay in. ${T}</p>${count(g.pickedCount, g.totalPlayers, 'picked')}`;
      return `${tag}<h1>The dock reveal</h1><ol class="answers crush-pairs">${g.pairs.map((/** @type {any} */ p, /** @type {number} */ i) => `<li style="animation-delay:${(i * g.stepMs) / 1000}s" class="${p.mutual ? 'winner' : ''}">
          ${p.b === null ? `${av(p.a)} ${esc(p.a)} stayed in 🛋` : p.mutual ? `${av(p.a)} ${esc(p.a)} ❤️ ${av(p.b)} ${esc(p.b)} — it's a date!` : `${av(p.a)} ${esc(p.a)} asked ${av(p.b)} ${esc(p.b)}… 💔`}</li>`).join('')}</ol>
          ${(g.bonuses || []).map((/** @type {any} */ x, /** @type {number} */ i) => `<p class="crush-bonus" style="animation-delay:${((g.pairs.length + i) * g.stepMs) / 1000}s">${x.kind === 'matchmaker'
            ? `💘 ${av(x.by)} ${esc(x.by)} was the <b>Matchmaker</b> — set up ${esc(x.a)} &amp; ${esc(x.b)}! +${x.gained}`
            : `👂 ${av(x.by)} ${esc(x.by)} the <b>Gossip</b> called ${esc(x.a)} &amp; ${esc(x.b)}! +${x.gained}`}</p>`).join('')}${exposedHtml(g.exposed)}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      /** @typedef {{ id: string, nickname: string }} Target */
      /** Two-name picker for the Matchmaker's setup / the Gossip's bet. @param {string} kind @param {string} label @param {Target[]} list */
      const pairForm = (kind, label, list) => `<form class="crush-pair" data-kind="${kind}">
          <select name="a">${list.map((/** @type {Target} */ t) => `<option value="${esc(t.id)}">${esc(t.nickname)}</option>`).join('')}</select> &amp;
          <select name="b">${list.map((/** @type {Target} */ t, /** @type {number} */ i) => `<option value="${esc(t.id)}" ${i === 1 ? 'selected' : ''}>${esc(t.nickname)}</option>`).join('')}</select>
          <button type="submit">${label}</button></form>`;
      // Gossip includes their own name in the bet list (they might date someone themselves).
      const gossipTargets = [{ id: you.playerId, nickname: you.nickname }, ...g.targets];
      let side = '';
      if (you.agenda && you.agenda.id === 'matchmaker') {
        side = you.canSetup && g.targets.length >= 2 ? `<div class="crush-side"><b>💘 Set two people up (once per game)</b>${pairForm('setup', 'Set them up', g.targets)}</div>`
          : you.setup ? `<p class="crush-side">💘 Your setup: ${esc(you.setup.pair[0])} &amp; ${esc(you.setup.pair[1])}${you.setup.paid ? ' — it worked! ✓' : ''}</p>` : '';
      } else if (you.agenda && you.agenda.id === 'gossip') {
        const heard = (you.heard || []).map((/** @type {{ from: string, to: string }} */ h) => `<li>${esc(h.from)} → ${esc(h.to)}</li>`).join('');
        side = `<div class="crush-side"><b>👂 You heard tonight</b>${heard ? `<ul class="crush-heard">${heard}</ul>` : '<p class="hint">No whispers yet…</p>'}
          ${you.canPredict ? `<b>Bet on a couple (+200 if they date)</b>${pairForm('predict', 'Bet', gossipTargets)}` : you.prediction ? `<p>Your bet: ${esc(you.prediction[0])} &amp; ${esc(you.prediction[1])}</p>` : ''}</div>`;
      }
      // One free anonymous wink a night (+50 if it turns into a date) — for whoever is waiting.
      const wink = you.winked ? '<p class="hint">😉 Wink sent</p>'
        : `<div class="crush-side"><b>😉 Wink at someone (free, anonymous)</b><div class="crush-pair">${g.targets.map((/** @type {Target} */ t) => sendBtn({ wink: t.id }, esc(t.nickname))).join('')}</div></div>`;
      const winksIn = you.winksIn ? `<p class="crush-exposed">😉 Someone winked at you${you.winksIn > 1 ? ` (${you.winksIn}×)` : ''}!</p>` : '';
      const role = (you.agenda ? `<div class="role">Your secret agenda: <strong>${esc(you.agenda.name)}</strong><br><small>${esc(you.agenda.desc)}</small></div>` : '') + (s.phase === 'cr-reveal' ? '' : side);
      /** @param {any[]} list @param {boolean} mine */
      const notes = (list, mine) => list.map((n) => `<li class="crush-note"><b>${mine ? '→ ' + esc(n.to) : esc(n.from)}:</b> ${esc(n.text)}${n.reply ? `<br><span class="byline">↩ ${esc(n.reply)}</span>` : ''}</li>`).join('');
      if (s.phase === 'cr-mingle') {
        const inbox = you.inbox.length ? `<h3>💌 Your notes</h3><ul class="crush-list">${notes(you.inbox, false)}</ul>` : '';
        if (you.notesLeft <= 0) return role + waiting('Notes sent', 'Watch the TV for gossip…') + wink + winksIn + inbox;
        return `${role}<h2>💌 ${you.notesLeft} note${you.notesLeft === 1 ? '' : 's'} left</h2>
          <label>To <select class="crush-to">${g.targets.map((/** @type {{ id: string, nickname: string }} */ t) => `<option value="${esc(t.id)}">${esc(t.nickname)}</option>`).join('')}</select></label>
          <div class="vote-list">${you.cards.map((/** @type {string} */ c) => `<button type="button" class="vote-btn crush-card" data-text="${esc(c)}">${esc(c)}</button>`).join('')}</div>
          <form class="crush-form"><input name="text" maxlength="80" autocomplete="off" placeholder="…or write your own"><button type="submit">Send</button></form>${inbox}`;
      }
      if (s.phase === 'cr-reply') {
        const open = you.inbox.filter((/** @type {any} */ n) => !n.reply);
        if (!open.length) return role + waiting(you.inbox.length ? 'All replied' : 'No notes tonight 😢', 'Waiting for the others…') + wink + winksIn + (you.outbox.length ? `<h3>Your sent notes</h3><ul class="crush-list">${notes(you.outbox, true)}</ul>` : '');
        const n = open[0];
        return `<h2>${esc(n.from)} wrote:</h2><p class="prompt">“${esc(n.text)}”</p><p>Reply:</p>
          <div class="vote-list crush-replies">${you.replyCards.map((/** @type {string} */ r) => sendBtn({ reply: n.id, text: r }, esc(r))).join('')}</div>`;
      }
      if (s.phase === 'cr-pick') {
        if (you.picked) return role + waiting('Date picked 🌙');
        return `${role}${winksIn}<h2>Who will you ask out tonight?</h2><div class="vote-list">` +
          g.targets.map((/** @type {{ id: string, nickname: string }} */ t) => sendBtn({ pick: t.id }, `${av(t.nickname)} ${esc(t.nickname)}`)).join('') +
          sendBtn({ pick: null }, '🛋 Stay in tonight') + '</div>';
      }
      const d = you.date;
      return `<h1>${!d ? 'Watch the dock 📺' : d.mutual ? `❤️ A date with ${esc(d.with)}!` : d.with === null ? '🛋 A quiet night in' : d.askedBy ? `💘 ${esc(d.with)} asked you out!` : `💔 ${esc(d.with)} had other plans`}</h1>
        ${d ? `<p>${d.gained >= 0 ? '+' : ''}${d.gained} points</p>` : ''}`;
    },
    bind(root, api) {
      root.querySelectorAll('.crush-pair').forEach((f) => f.addEventListener('submit', (e) => {
        e.preventDefault();
        const form = /** @type {HTMLFormElement} */ (f);
        const pair = [/** @type {HTMLSelectElement} */ (form.elements.namedItem('a')).value, /** @type {HTMLSelectElement} */ (form.elements.namedItem('b')).value];
        if (pair[0] !== pair[1]) api.send({ [form.dataset.kind || 'setup']: pair });
      }));
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

  // ---------------------------------------------------------------- Loon Call (rhythm)
  /** @typedef {{ steps: number[], by: string | null, callAt: number, echoAt: number }} LcPhrase */
  /** @typedef {{ kind: string, name: string, bpm: number, root: number, startAt: number, barMs: number, countIn: number, endAt: number, clicks: number[], phrases: LcPhrase[], caller: string | null, steps: number }} LcSched */
  /** @type {LcSched | null} the schedule on screen (TV or phone) */
  let lcSched = null;
  let lcScheduledAt = 0;
  // A little melody for the lead loon: the pitch follows the step in the bar.
  const LC_PITCH = [1, 1.125, 1.25, 1.333, 1.5, 1.333, 1.25, 1.125];

  /** TV: schedule every sound of a schedule on the Web Audio clock (sample-accurate). @param {LcSched} s */
  function lcScheduleAudio(s) {
    const m = window.Rumpus.music;
    if (!m || !m.rhythm || !m.rhythm.ready() || lcScheduledAt === s.startAt) return;
    lcScheduledAt = s.startAt;
    const r = m.rhythm;
    const ctxNow = r.now(), srvNow = window.Rumpus.time.now();
    const at = (/** @type {number} */ ms) => ctxNow + (ms - srvNow) / 1000;
    const future = (/** @type {number} */ ms) => ms > srvNow + 20;
    s.clicks.forEach((c, i) => { if (future(c)) r.click(at(c), i % 4 === 0); });
    if (!s.phrases.length) return;
    const step = s.barMs / s.steps;
    s.phrases.forEach((p) => {
      for (const [bar, isCall] of /** @type {[number, boolean][]} */ ([[p.callAt, true], [p.echoAt, false]])) {
        for (let k = 0; k < s.steps; k++) {
          const t = bar + k * step;
          if (!future(t)) continue;
          if (k % 4 === 0) r.kick(at(t));
          r.hat(at(t));
          if (k === 0) r.bass(at(t), s.root / 4);
          if (k === 4) r.bass(at(t), (s.root / 4) * 1.5);
        }
        if (isCall) for (const st of p.steps) { const t = bar + st * step; if (future(t)) r.call(at(t), s.root * LC_PITCH[st % 8]); }
      }
    });
  }

  /** Where are we in the schedule right now? @param {LcSched} s @param {number} t */
  function lcWhere(s, t) {
    const beatMs = s.barMs / 4;
    const first = s.startAt + s.countIn * s.barMs;
    if (!s.phrases.length) { // tune-up / caller's metronome: just the clicks
      const i = Math.floor((t - s.startAt) / beatMs);
      // A caller's metronome: the first bar counts in, the second is theirs to fill.
      const mode = t < s.startAt ? 'ready' : t >= s.endAt ? 'done' : s.kind === 'call' && i < 4 ? 'count' : 'clicks';
      return { mode, beat: i, bar: Math.floor(i / 4), callNote: false };
    }
    if (t < first) return { mode: 'count', beat: Math.floor((t - s.startAt) / beatMs), bar: -1, callNote: false };
    const k = Math.floor((t - first) / s.barMs);
    if (k >= s.phrases.length * 2) return { mode: 'done', beat: 0, bar: k, callNote: false };
    const p = s.phrases[Math.floor(k / 2)];
    const inBar = (t - first) % s.barMs;
    const callNote = k % 2 === 0 && p.steps.some((st) => { const d = inBar - (st * s.barMs) / s.steps; return d >= 0 && d < 140; });
    return { mode: k % 2 === 0 ? 'call' : 'echo', beat: Math.floor(inBar / beatMs), bar: k, callNote };
  }

  // One 30 fps clock hook drives every live beat meter (TV and phone); it does nothing when none is on screen.
  window.Rumpus.clock.add(() => {
    const s = lcSched;
    if (!s) return;
    const meters = document.querySelectorAll('[data-lc-meter]');
    const leads = document.querySelectorAll('[data-lc-lead]');
    const taps = document.querySelectorAll('[data-lc-label]');
    if (!meters.length && !leads.length && !taps.length) return;
    const w = lcWhere(s, window.Rumpus.time.now());
    const dots = (/** @type {number} */ b) => [0, 1, 2, 3].map((i) => (i === ((b % 4) + 4) % 4 ? '●' : '○')).join(' ');
    const label = w.mode === 'call' ? `🐦 ${s.caller ? esc(s.caller) : 'CALL'}` : w.mode === 'echo' ? '🎵 ECHO!' : w.mode === 'count' ? `${4 - (((w.beat % 4) + 4) % 4)}…` : w.mode === 'clicks' ? '🥁 TAP!' : w.mode === 'ready' ? 'GET READY' : '';
    meters.forEach((el) => {
      const modeCls = w.mode === 'echo' ? 'lc-echo' : w.mode === 'clicks' ? 'lc-clicks' : '';
      const html = `<span class="lc-mode ${modeCls}">${label}</span><span class="lc-dots">${w.mode === 'done' || w.mode === 'ready' ? '' : dots(w.beat)}</span>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    });
    leads.forEach((el) => el.classList.toggle('singing', w.callNote));
    taps.forEach((el) => {
      const own = /** @type {HTMLElement} */ (el).dataset.lcLabel || '';
      const txt = own || (w.mode === 'echo' || w.mode === 'clicks' ? 'TAP!' : w.mode === 'call' ? 'LISTEN…' : w.mode === 'count' ? 'GET READY' : '…');
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('go', w.mode === 'echo' || w.mode === 'clicks');
    });
  });

  /** @param {any} g */
  const lcStageTag = (g) => `<p class="round-tag">${g.sched ? esc(g.sched.name) : 'Loon Call'} · Song ${Math.max(1, g.round)} of ${g.totalRounds}${g.multiplier > 1 ? `<span class="double-badge">${g.multiplier}× POINTS</span>` : ''}</p>`;
  const LC_HIT = /** @type {Record<string, string>} */ ({ perfect: 'hit-perfect', good: 'hit-good', miss: 'hit-miss', extra: 'hit-extra' });
  /** The choir: every player's loon, ringed by their last tap. @param {any[]} choir */
  const lcChoir = (choir) => `<ul class="lc-choir">${choir.map((c) => `<li class="lc-loon ${c.hit ? LC_HIT[c.hit] : ''} ${c.seq % 2 ? 'bob-a' : c.seq ? 'bob-b' : ''}">
      ${av(c.nickname, 'avatar big')}<span class="lc-name">${esc(c.nickname)}</span>
      <span class="lc-tag">${c.hit === 'perfect' ? 'PERFECT' : c.hit === 'good' ? (c.d > 0 ? 'LATE' : c.d < 0 ? 'EARLY' : 'GOOD') : c.hit === 'miss' ? (c.d > 0 ? 'TOO LATE' : 'TOO EARLY') : c.hit === 'extra' ? 'OOPS' : ''}</span></li>`).join('')}</ul>`;
  const lcLead = () => {
    const u = window.Rumpus.sprites && window.Rumpus.sprites.iconUrl('looncall');
    return u ? `<img class="lc-lead" data-lc-lead src="${u}" alt="the lead loon">` : '';
  };

  register('looncall', {
    /** @param {any} s */
    narrate(s) {
      const r = s.gameState.result;
      if (s.phase !== 'lc-result' || !r) return null;
      const top = r.rows.find((/** @type {{ grade: string | null }} */ x) => x.grade === 'Nailed it!');
      return r.sync ? `In sync ${r.sync} times! Beautiful choir.` : top ? `${top.nickname} nailed it!` : 'The loons are… still learning.';
    },
    host(s) {
      const g = s.gameState;
      lcSched = g.sched || null;
      if (lcSched) lcScheduleAudio(lcSched);
      if (s.phase === 'lc-result') {
        const r = g.result;
        return `${lcStageTag(g)}<h1>${esc(r.name)}</h1>
          ${r.kind !== 'call' && r.sync ? `<p class="big-sub lc-sync">🎶 IN SYNC! ×${r.sync}</p>` : ''}
          <ol class="answers lc-results">${r.rows.map((/** @type {any} */ x) => `<li class="${x.grade === 'Nailed it!' ? 'winner' : ''}">${av(x.nickname)} ${esc(x.nickname)}
            <span class="lc-grade">${x.caller ? '🎤 caller' : x.grade ? `${esc(x.grade)} · ${x.pct}%${x.lean ? ` · a bit ${x.lean}` : ''}` : '—'}</span>
            <span class="votes">+${x.gained}</span></li>`).join('')}</ol>`;
      }
      const head = s.phase === 'lc-tune'
        ? '<h1>🎵 Tune up the choir</h1><p class="big-sub">Tap along with the clicks on your phone — this sets each phone\'s timing.</p>'
        : s.phase === 'lc-compose'
          ? `<h1>🎤 ${av(g.composer)} ${esc(g.composer)} writes a call</h1><p class="big-sub">Listen to the count-in… then they tap a rhythm. Everyone echoes it next!</p>`
          : `<p class="big-sub">Listen to the call 🐦 — then echo it 🎵</p>`;
      const syncFlash = (g.syncs || []).length ? `<p class="lc-sync" data-n="${g.syncs.length}">🎶 IN SYNC ×${g.syncs.length}</p>` : '';
      return `${lcStageTag(g)}${head}
        <div class="lc-stage">${lcLead()}<div class="lc-meter" data-live data-lc-meter></div></div>
        ${lcChoir(g.choir)}${syncFlash}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      lcSched = g.sched || null;
      if (s.phase === 'lc-result') {
        const r = you.result;
        if (!r) return watchTv();
        return `<h1>${r.caller ? '🎤 Your call!' : esc(r.grade || 'Done')}</h1>${r.pct !== null ? `<p class="prompt">${r.pct}% on the beat${r.lean ? ` — you were a bit ${r.lean}` : ''}</p>` : ''}<p>+${r.gained} points</p>`;
      }
      if (s.phase === 'lc-compose' && !you.isCaller) return watchTv(`<p>${esc(g.composer)} is writing a call — get ready to echo it!</p>`);
      const sub = s.phase === 'lc-tune' ? 'Tap along with the clicks' : s.phase === 'lc-compose' ? 'Count-in, then tap your own rhythm for one bar!' : you.isCaller ? 'Your call! Echo it with everyone — you also score for every note they get right 🎤' : 'Listen to the call on the TV, then tap it back';
      return `<p class="hint">${sub}</p><button class="mg-big lc-tap" data-live data-lc-label="" aria-label="Tap on the beat">TAP!</button>`;
    },
    bind(root, api) {
      const btn = /** @type {HTMLElement | null} */ (root.querySelector('.lc-tap'));
      if (!btn) return;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        api.send({ tap: window.Rumpus.time.now() });
        window.Rumpus.sfx.tick();
        if (navigator.vibrate) navigator.vibrate(12);
        btn.classList.remove('hit'); void btn.offsetWidth; btn.classList.add('hit');
      });
    },
  });

  // ---------------------------------------------------------------- Lantern Lake (tilt)
  // Boat colours: warm paper-lantern hues, distinct at a glance (and okay for colour-blind eyes).
  const LL_COLOURS = ['#ff8a3d', '#4fc3f7', '#ffd23f', '#e57399', '#7ed957', '#b39ddb', '#f4f1e8', '#ff5e5e', '#5ed6c3', '#c9a27a', '#9fa8da', '#ffb74d'];
  /** @type {Map<string, HTMLImageElement>} */
  const llImgs = new Map();
  /** @param {string} nick */
  const llImg = (nick) => {
    let im = llImgs.get(nick);
    const url = window.Rumpus.avUrl(nick);
    if (!im || im.dataset.src !== url) { im = new Image(); im.src = url; im.dataset.src = url; llImgs.set(nick, im); }
    return im;
  };
  /** Effects that outlive a frame: bump rings and catch sparkles. @type {{ x: number, y: number, t: number, kind: string, who: number }[]} */
  let llFx = [];
  /** Wake trails per boat. @type {number[][][]} */
  let llTrails = [];
  let llLastFrame = -1;
  /** @type {string[]} */
  let llNames = [];
  let llSfxAt = 0;

  /** Draw one frame of the lake. Pixel art: everything is whole-pixel rects at S× scale. */
  function llDraw(/** @type {HTMLCanvasElement} */ cv, /** @type {number} */ tick) {
    const f = window.Rumpus.frame;
    const g = cv.getContext('2d');
    if (!g) return;
    const S = 3, W = 320, H = 180;
    const R = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {string} */ c) => { g.fillStyle = c; g.fillRect(Math.round(x) * S, Math.round(y) * S, Math.max(1, Math.round(w)) * S, Math.max(1, Math.round(h)) * S); };
    // Water: deep dusk bands with drifting glints.
    const bands = ['#13284a', '#152d52', '#17325a', '#193762', '#1b3c6a'];
    bands.forEach((c, i) => R(0, (i * H) / bands.length, W, H / bands.length + 1, c));
    for (let i = 0; i < 40; i++) {
      const x = (i * 53 + tick * (0.3 + (i % 3) * 0.1)) % W, y = (i * 37) % H;
      if ((tick + i * 7) % 60 < 40) R(x, y, 3 + (i % 3), 1, 'rgba(160,200,255,0.18)');
    }
    if (!f) return;
    // A new server frame: remember wakes and new effects.
    if (f.n !== llLastFrame) {
      llLastFrame = f.n;
      (f.boats || []).forEach((/** @type {number[] | null} */ b, /** @type {number} */ i) => {
        if (!b) return;
        const tr = llTrails[i] = llTrails[i] || [];
        if (Math.hypot(b[2], b[3]) > 0.4 && f.n % 3 === 0) tr.push([b[0] - b[2] * 2, b[1] - b[3] * 2, tick]);
        while (tr.length > 14) tr.shift();
      });
      for (const b of f.bumps || []) llFx.push({ x: b[0], y: b[1], t: tick, kind: 'bump', who: -1 });
      for (const c of f.caught || []) llFx.push({ x: c[0], y: c[1], t: tick, kind: c[3] ? 'gold' : 'fly', who: c[2] });
      const now = Date.now();
      if (now - llSfxAt > 120) {
        if ((f.caught || []).length) { window.Rumpus.sfx.coin(); llSfxAt = now; } else if ((f.bumps || []).length) { window.Rumpus.sfx.pop(); llSfxAt = now; }
      }
    }
    // Moonbeam: a shimmering column of light on the water.
    if (f.moon) {
      const [mx, my, mr] = f.moon;
      for (let y = -mr; y <= mr; y += 2) {
        const w = Math.sqrt(Math.max(0, mr * mr - y * y)) * 2;
        const sh = Math.sin((tick + y) / 4) * 2;
        R(mx - w / 2 + sh, my + y, w, 1, (y / 2) % 2 ? 'rgba(244,241,232,0.30)' : 'rgba(255,240,190,0.20)');
      }
    }
    for (const r of f.rocks || []) { const [x, y, rr] = r; for (let k = -rr; k <= rr; k++) { const w = Math.sqrt(rr * rr - k * k) * 2; R(x - w / 2, y + k, w, 1, k < 0 ? '#7d8597' : '#5c6373'); } R(x - rr / 2, y - rr / 2, rr / 3, 1, '#a9b0bf'); }
    // Wakes
    llTrails.forEach((tr) => tr.forEach((p) => { const age = (tick - p[2]) / 30; if (age < 1.2) { const w = 4 + age * 8; R(p[0] - w / 2, p[1], w, 1, `rgba(200,230,255,${0.35 * (1 - age / 1.2)})`); } }));
    // Fireflies blink and glow.
    for (const fl of f.flies || []) {
      const [x, y, gold] = fl;
      const on = (tick + Math.round(x * 7)) % 24 < 18;
      R(x - 3, y - 3, 6, 6, gold ? 'rgba(255,210,63,0.22)' : 'rgba(200,255,140,0.16)');
      R(x - 1, y - 1, 2, 2, on ? (gold ? '#ffd23f' : '#d7ff8a') : '#8aa05a');
    }
    for (const l of f.lanterns || []) {
      const [x, y] = l; const bob = Math.round(Math.sin((tick + x) / 8));
      R(x - 5, y - 5 + bob, 10, 10, 'rgba(255,140,60,0.20)'); R(x - 2, y - 3 + bob, 4, 5, '#ff7043'); R(x - 1, y - 4 + bob, 2, 1, '#3e2723'); R(x - 1, y - 1 + bob, 2, 1, '#ffd23f');
    }
    // Boats: a little paper boat in the player's colour, a lantern glow, their face on board.
    (f.boats || []).forEach((/** @type {number[] | null} */ b, /** @type {number} */ i) => {
      if (!b) return;
      const [x, y] = b; const c = LL_COLOURS[i % LL_COLOURS.length]; const bob = Math.round(Math.sin((tick + i * 9) / 7));
      R(x - 9, y - 8 + bob, 18, 18, 'rgba(255,200,120,0.10)');
      R(x - 7, y + 2 + bob, 14, 2, c); R(x - 6, y + 4 + bob, 12, 1, c); R(x - 5, y + 5 + bob, 10, 1, '#1a1423');
      const im = llImg(llNames[i] || '');
      if (im.complete && im.naturalWidth) { g.imageSmoothingEnabled = false; g.drawImage(im, Math.round(x - 5) * S, Math.round(y - 9 + bob) * S, 10 * S, 10 * S); }
      R(x + 6, y - 2 + bob, 2, 2, (tick + i) % 30 < 26 ? '#ffd23f' : '#ffb02e');
    });
    if (f.raft) {
      const [x, y, vx, vy] = f.raft;
      for (let k = 0; k < 4; k++) R(x - 14, y - 10 + k * 5, 28, 4, k % 2 ? '#8a5a3b' : '#9c6b47');
      R(x - 14, y - 10, 2, 20, '#5d3a22'); R(x + 12, y - 10, 2, 20, '#5d3a22');
      llNames.forEach((n, i) => { const im = llImg(n); if (im.complete && im.naturalWidth) g.drawImage(im, Math.round(x - 12 + (i % 4) * 6) * S, Math.round(y - 9 + Math.floor(i / 4) * 7) * S, 7 * S, 7 * S); });
      // Where the crew is pulling (the average of every phone's tilt).
      const sp = Math.hypot(vx, vy);
      if (sp > 0.2) for (let k = 1; k <= 3; k++) R(x + (vx / sp) * (16 + k * 4), y + (vy / sp) * (16 + k * 4), 2, 2, '#ffd23f');
    }
    // Effects
    llFx = llFx.filter((e) => tick - e.t < 24);
    for (const e of llFx) {
      const a = (tick - e.t) / 24;
      if (e.kind === 'bump') { const r = 4 + a * 12; for (let k = 0; k < 8; k++) R(e.x + Math.cos(k * 0.785) * r, e.y + Math.sin(k * 0.785) * r, 1, 1, `rgba(255,255,255,${1 - a})`); }
      else { for (let k = 0; k < 6; k++) R(e.x + Math.cos(k * 1.05 + a * 3) * a * 10, e.y + Math.sin(k * 1.05 + a * 3) * a * 10 - a * 6, 1, 1, e.kind === 'gold' ? '#ffd23f' : '#d7ff8a'); }
    }
  }

  // The 30 fps clock draws the lake whenever its canvas is on screen.
  window.Rumpus.clock.add((tick) => {
    const cv = /** @type {HTMLCanvasElement | null} */ (document.querySelector('canvas.ll-lake'));
    if (cv) llDraw(cv, tick);
  });

  // ---- phone controller: tilt (secure pages) or touch steering (always works)
  /** @type {{ mode: 'touch' | 'tilt', zero: number[] | null, vec: number[], sentAt: number, sent: string, https: string[] | null, trail: number }} */
  const llCtl = { mode: 'touch', zero: null, vec: [0, 0], sentAt: 0, sent: '', https: null, trail: 0 };
  /** Send the current vector at most 15×/s, and only when it changed. @param {(p: any) => void} send */
  function llSend(send) {
    const now = Date.now();
    const key = llCtl.vec.map((v) => v.toFixed(2)).join();
    if (key === llCtl.sent) return;
    // Throttled to 15/s; a trailing send makes sure the last position always arrives (the server keeps it).
    if (now - llCtl.sentAt < 66) { clearTimeout(llCtl.trail); llCtl.trail = window.setTimeout(() => llSend(send), 70); return; }
    llCtl.sent = key; llCtl.sentAt = now;
    send({ tilt: llCtl.vec });
  }
  const llSecureLink = () => {
    const seat = window.Rumpus.store('rumpus.seat');
    const list = llCtl.https || [];
    const base = list.find((u) => u.includes('//' + location.hostname + ':')) || list[0];
    return base && seat ? `${base}/play?seat=${encodeURIComponent(seat.code)}.${encodeURIComponent(seat.token)}` : '';
  };

  register('lantern', {
    /** @param {any} s */
    narrate(s) {
      const g = s.gameState;
      if (s.phase === 'll-intro') return `${g.sceneName}! ${g.rule}`;
      if (s.phase === 'll-result' && g.result && g.result.rows[0]) return g.result.haul !== null ? `The raft caught ${g.result.haul} lanterns!` : `${g.result.rows[0].nickname} glides to the top!`;
      return null;
    },
    host(s) {
      const g = s.gameState;
      llNames = (g.boats || []).map((/** @type {{ nickname: string }} */ b) => b.nickname);
      const tag = `<p class="round-tag">Scene ${g.round} of ${g.totalRounds}${g.multiplier > 1 ? `<span class="double-badge">${g.multiplier}× POINTS</span>` : ''}</p>`;
      if (s.phase === 'll-result') {
        const r = g.result;
        return `${tag}<h1>${esc(r.name)}</h1>${r.haul !== null ? `<p class="big-sub">🏮 The raft caught ${r.haul} lantern${r.haul === 1 ? '' : 's'}!</p>` : ''}
          <ol class="answers">${r.rows.map((/** @type {any} */ x, /** @type {number} */ i) => `<li class="${i === 0 ? 'winner' : ''}">${av(x.nickname)} ${esc(x.nickname)} <span class="votes">+${x.gained}</span></li>`).join('')}</ol>`;
      }
      if (s.phase === 'll-intro') { llTrails = []; llFx = []; window.Rumpus.frame = null; }
      const strip = (g.boats || []).map((/** @type {{ nickname: string, gained: number }} */ b, /** @type {number} */ i) => `<span class="ll-chip" style="--c:${LL_COLOURS[i % LL_COLOURS.length]}">${av(b.nickname)} ${esc(b.nickname)} <b>${b.gained}</b></span>`).join('');
      return `${tag}<h1 class="ll-title">${esc(g.sceneName)}</h1><p class="big-sub">${esc(g.rule)} ${s.phase === 'll-play' ? T : ''}</p>
        <canvas class="ll-lake" width="960" height="540"></canvas>
        <div class="ll-strip">${strip}</div>`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'll-result') return `<h1>${esc(g.result.name)}</h1><p class="prompt">+${you.result ? you.result.gained : 0} points</p>`;
      const colour = LL_COLOURS[(you.colour >= 0 ? you.colour : 0) % LL_COLOURS.length];
      const tiltAvail = window.isSecureContext && 'DeviceOrientationEvent' in window;
      const link = !tiltAvail ? llSecureLink() : '';
      let arrow = '';
      if (you.pos && you.target) {
        const ang = Math.atan2(you.target[1] - you.pos[1], you.target[0] - you.pos[0]) * 180 / Math.PI;
        arrow = `<span class="ll-arrow" style="transform:rotate(${Math.round(ang / 15) * 15}deg)">➤</span>`;
      }
      return `<p class="round-tag">${esc(g.sceneName)}</p>
        <p class="ll-you" style="--c:${colour}">⛵ Your boat · <b>${you.gained}</b> pts ${arrow}</p>
        <div class="ll-pad" data-live style="--c:${colour}"><div class="ll-knob"></div></div>
        <div class="ll-modes">
          ${tiltAvail ? `<button class="ghost-btn" data-ll="tilt">${llCtl.mode === 'tilt' ? '📱 Tilt on — tap to re-centre' : '📱 Use tilt instead'}</button>`
            : link ? `<a class="ghost-btn" href="${esc(link)}">📱 Use tilt (opens the secure link)</a>` : ''}
          <p class="hint">${llCtl.mode === 'tilt' ? 'Tilt your phone to glide. Hold it flat to stop.' : 'Drag on the circle to steer.'}</p>
        </div>`;
    },
    bind(root, api) {
      if (llCtl.https === null) {
        llCtl.https = [];
        fetch('/api/info').then((r) => r.json()).then((d) => { llCtl.https = d.https || []; }).catch(() => {});
      }
      const pad = /** @type {HTMLElement | null} */ (root.querySelector('.ll-pad'));
      if (!pad) return;
      const knob = /** @type {HTMLElement} */ (pad.querySelector('.ll-knob'));
      const show = () => { knob.style.transform = `translate(${Math.round(llCtl.vec[0] * 40)}%, ${Math.round(llCtl.vec[1] * 40)}%)`; };
      /** @param {PointerEvent} e */
      const fromPointer = (e) => {
        const r = pad.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
        const m = Math.hypot(x, y);
        llCtl.mode = 'touch';
        llCtl.vec = m > 1 ? [x / m, y / m] : [x, y];
        show(); llSend(api.send);
      };
      pad.addEventListener('pointerdown', (e) => { e.preventDefault(); pad.setPointerCapture(e.pointerId); fromPointer(e); });
      pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') fromPointer(e); });
      const stop = () => { if (llCtl.mode === 'touch') { llCtl.vec = [0, 0]; show(); llCtl.sentAt = 0; llSend(api.send); } };
      pad.addEventListener('pointerup', stop); pad.addEventListener('pointercancel', stop);
      // Tilt: beta (front/back) and gamma (left/right), relative to how you held it when you turned it on.
      /** @param {DeviceOrientationEvent} e */
      const onTilt = (e) => {
        if (llCtl.mode !== 'tilt' || e.beta === null || e.gamma === null) return;
        const turn = (screen.orientation && screen.orientation.angle) || 0;
        let gx = e.gamma, by = e.beta;
        if (turn === 90) [gx, by] = [e.beta, -e.gamma]; else if (turn === 270 || turn === -90) [gx, by] = [-e.beta, e.gamma];
        if (!llCtl.zero) llCtl.zero = [gx, by];
        const x = (gx - llCtl.zero[0]) / 25, y = (by - llCtl.zero[1]) / 25;
        const m = Math.hypot(x, y);
        llCtl.vec = m > 1 ? [x / m, y / m] : [x, y];
        show(); llSend(api.send);
      };
      window.addEventListener('deviceorientation', onTilt);
      api.onCleanup(() => window.removeEventListener('deviceorientation', onTilt));
      const btn = root.querySelector('[data-ll="tilt"]');
      if (btn) btn.addEventListener('click', async () => {
        const DOE = /** @type {any} */ (window.DeviceOrientationEvent);
        if (DOE && typeof DOE.requestPermission === 'function') {
          try { if ((await DOE.requestPermission()) !== 'granted') return; } catch (err) { return; }
        }
        llCtl.mode = 'tilt'; llCtl.zero = null; // re-centre on the next reading
        btn.textContent = '📱 Tilt on — tap to re-centre';
      });
      show();
    },
  });

  // ---------------------------------------------------------------- Storm Watch (strategy)
  /** Rain + lightning on the 30 fps clock, behind the Storm Watch board and in its transition. */
  let stFlashAt = -999;
  window.Rumpus.clock.add((tick) => {
    document.querySelectorAll('canvas.storm-rain').forEach((el) => {
      const cv = /** @type {HTMLCanvasElement} */ (el);
      const g = cv.getContext('2d');
      if (!g) return;
      const W = cv.width, H = cv.height;
      if (tick % 240 === 0 && Math.random() < 0.6) stFlashAt = tick; // a lightning strike every ~8 s or so
      const flash = tick - stFlashAt < 4 ? (tick - stFlashAt) % 2 === 0 : false;
      g.fillStyle = flash ? 'rgba(220,230,255,0.55)' : 'rgba(10,14,28,0.35)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(150,180,230,0.55)';
      for (let i = 0; i < 90; i++) {
        const x = (i * 97 + tick * 3) % (W + 40) - 20, y = (i * 53 + tick * 11) % H;
        g.fillRect(x, y, 1, 6);
      }
    });
  });
  /** The way into Storm Watch: the screen darkens, rain sweeps in, lightning, thunder. */
  window.Rumpus.stormTransition = () => {
    const el = document.createElement('div');
    el.className = 'storm-transition';
    el.innerHTML = '<canvas class="storm-rain" width="480" height="270"></canvas><div class="storm-bolt"></div><div class="storm-title">STORM WATCH</div>';
    document.body.appendChild(el);
    setTimeout(() => { stFlashAt = window.Rumpus.clock.frame(); window.Rumpus.sfx.thunder(); }, 900);
    setTimeout(() => el.classList.add('out'), 3300);
    setTimeout(() => el.remove(), 3900);
  };
  /** @param {any} g */
  const stBoard = (g) => `<div class="storm-head">
      <ol class="storm-chores">${g.choreNames.map((/** @type {string} */ n, /** @type {number} */ i) => `<li class="${g.chores[i] === true ? 'done' : g.chores[i] === false ? 'ruined' : i === g.choreIndex ? 'now' : ''}">
        <span class="storm-mark">${g.chores[i] === true ? '✔' : g.chores[i] === false ? '✘' : i + 1}</span><span class="storm-chore">${esc(n)}</span></li>`).join('')}</ol>
      <div class="storm-meter" title="Crews voted down in a row">${[0, 1, 2].map((i) => `<span class="${i < g.storm ? 'on' : ''}">🌩</span>`).join('')}</div>
      <p class="storm-hidden">🦝 ×${g.raccoons} hiding among you</p>
    </div>`;
  /** @param {{ id: string, name: string, desc: string }} e */
  const stEvent = (e) => `<div class="storm-event"><b>${esc(e.name)}</b><span>${esc(e.desc)}</span></div>`;
  /** @param {string[]} names */
  const stCrew = (names) => `<div class="storm-crew">${names.map((n) => `<figure>${av(n, 'avatar big bob')}<figcaption>${esc(n)}</figcaption></figure>`).join('')}</div>`;

  /** Phone: the crew the leader is building (kept across re-renders). @type {Set<string>} */
  const stPick = new Set();
  let stPickKey = '';

  register('storm', {
    host(s) {
      const g = s.gameState;
      const board = stBoard(g);
      const rain = '<canvas class="storm-rain storm-bg" width="480" height="270"></canvas>';
      let mid = '';
      if (s.phase === 'st-roles') mid = `<h1>Check your secret role</h1><p class="big-sub">Press and hold the card on your phone — don't let anyone see! ${T}</p>${count(g.readyCount, g.totalPlayers, 'ready')}`;
      else if (s.phase === 'st-talk') mid = `<p class="round-tag">Chore ${g.choreIndex + 1}: ${esc(g.choreNames[g.choreIndex])}</p>
          <h1>🏮 ${av(g.leader)} ${esc(g.leader)} picks a crew of ${g.crewSize}</h1>${stEvent(g.event)}<p class="big-sub">Talk it over — who do you trust? ${T}</p>`;
      else if (s.phase === 'st-vote') mid = `<h1>Send this crew?</h1>${stCrew(g.crew)}${stEvent(g.event)}<p class="big-sub">Vote ✔ or ✘ on your phones ${T}</p>${count(g.votedCount, g.totalPlayers, 'voted')}`;
      else if (s.phase === 'st-votes') {
        const v = g.votes;
        mid = `<h1 class="${v.approved ? 'storm-yes' : 'storm-no'}">${v.approved ? '✔ The crew heads out' : '✘ Voted down'}</h1>
          ${v.list ? `<div class="storm-votes">${v.list.map((/** @type {{ nickname: string, yes: boolean }} */ x) => `<span class="${x.yes ? 'yes' : 'no'}">${av(x.nickname)} ${x.yes ? '✔' : '✘'}</span>`).join('')}</div>` : `<p class="big-sub">In the dark: ${v.yes} ✔ · ${v.no} ✘</p>`}
          ${!v.approved ? `<p class="big-sub">The storm creeps closer… (${g.storm}/3)</p>` : ''}${g.winReason ? `<p class="prompt">${esc(g.winReason)}</p>` : ''}`;
      } else if (s.phase === 'st-crew') mid = `<h1>The crew is at work…</h1>${stCrew(g.crew)}<p class="big-sub">Crew: help or sabotage, secretly ${T}</p>${count(g.playedCount, g.crew.length, 'done')}`;
      else if (s.phase === 'st-reveal') {
        const r = g.reveal;
        mid = `<h1>${esc(g.choreNames[r.index] || 'The chore')}</h1>
          <div class="storm-cards">${r.cards.map((/** @type {string} */ c, /** @type {number} */ i) => `<div class="storm-card ${c === 'sabotage' ? 'bad' : 'good'}" style="animation-delay:${(i * g.cardMs) / 1000}s">${c === 'sabotage' ? '🦝 SABOTAGE' : '🔨 HELP'}</div>`).join('')}</div>
          <p class="big-sub storm-result" style="animation-delay:${(r.cards.length * g.cardMs) / 1000}s">${r.ok ? '✔ Done!' : '✘ Ruined!'}${r.fixed ? ' (the Handyman fixed one sabotage)' : ''}${r.needed > 1 ? ' — a Big Chore needs two sabotages' : ''}</p>
          ${g.winReason ? `<p class="prompt storm-result" style="animation-delay:${(r.cards.length * g.cardMs) / 1000}s">${esc(g.winReason)}</p>` : ''}`;
      } else if (s.phase === 'st-accuse') mid = `<h1>${g.winner === 'cottage' ? '🏡 The cottagers win!' : '🦝 The raccoons win!'}</h1><p class="big-sub">${esc(g.winReason || '')}</p>
          <p class="prompt">Before the roles flip: who was a raccoon? Accuse on your phone. ${T}</p>${count(g.accusedCount, g.totalPlayers, 'accused')}`;
      else if (s.phase === 'st-final') mid = `<h1>${g.winner === 'cottage' ? '🏡 The cottagers win!' : '🦝 The raccoons win!'}</h1>
          <div class="storm-roles">${(g.roles || []).map((/** @type {any} */ x, /** @type {number} */ i) => `<div class="storm-role ${x.side}" style="animation-delay:${i * 0.4}s">${av(x.nickname, 'avatar big')}<b>${esc(x.nickname)}</b><span>${esc(x.role)}</span><span class="votes">+${x.gained}</span></div>`).join('')}</div>`;
      return `${rain}<div class="storm-board">${board}<div class="storm-mid">${mid}</div></div>`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      const allies = you.allies && you.allies.length ? `<p>🦝 Your fellow raccoons: <b>${you.allies.map(esc).join(', ')}</b></p>` : '';
      const spotted = you.spotted ? `<p>👀 You saw <b>${esc(you.spotted)}</b> sneaking around — a raccoon.</p>` : '';
      const card = `<button type="button" class="storm-rolecard ${you.role.side}" data-hold>
          <span class="storm-cover">🃏 Press and hold to see your role</span>
          <span class="storm-secret"><b>${esc(you.role.name)}</b>${you.role.side === 'raccoon' ? ' 🦝' : ' 🏡'}<small>${esc(you.role.desc)}</small>${allies}${spotted}</span></button>`;
      const peek = you.peek ? `<p class="storm-peek">${esc(you.peek)}</p>` : '';
      const snoop = you.canSnoop && you.canSnoop.length ? `<div class="crush-side"><b>🔍 Snoop on one crew card (once per game)</b><div class="crush-pair">${you.canSnoop.map((/** @type {{ id: string, nickname: string }} */ t) => sendBtn({ snoop: t.id }, esc(t.nickname))).join('')}</div></div>` : '';
      if (s.phase === 'st-roles') return card + (you.ready ? waiting('Ready') : `<div class="vote-list">${sendBtn({ ready: true }, "I've seen my role")}</div>`);
      if (s.phase === 'st-talk') {
        if (!you.isLeader) return `<h2>🏮 ${esc(g.leader)} is picking ${g.crewSize} for the crew</h2><p>Talk it over!</p>${peek}${snoop}${card}`;
        const key = `${g.choreIndex}|${g.leader}|${g.crewSize}`;
        if (key !== stPickKey) { stPick.clear(); stPickKey = key; }
        return `<h2>🏮 You lead! Pick ${g.crewSize} for “${esc(g.choreNames[g.choreIndex])}”</h2>
          <p class="hint">${esc(g.event.name)}: ${esc(g.event.desc)}</p>
          <div class="vote-list storm-pick">${you.candidates.map((/** @type {{ id: string, nickname: string }} */ c) => `<button type="button" class="vote-btn" data-st-pick="${esc(c.id)}" aria-pressed="${stPick.has(c.id)}">${av(c.nickname)} ${esc(c.nickname)}</button>`).join('')}</div>
          <button type="button" class="wide" data-st-send ${stPick.size === g.crewSize ? '' : 'disabled'}>Send this crew (${stPick.size}/${g.crewSize})</button>${peek}${snoop}${card}`;
      }
      if (s.phase === 'st-vote') return you.voted ? waiting('Vote in') + card : `<h2>Send this crew?</h2><p>${g.crew.map(esc).join(', ')}</p>
          <div class="vote-list storm-yesno">${sendBtn({ vote: true }, '✔ Yes')}${sendBtn({ vote: false }, '✘ No')}</div>${card}`;
      if (s.phase === 'st-votes') return watchTv(`<p>${g.votes.approved ? 'The crew heads out.' : 'Voted down!'}</p>`) + peek;
      if (s.phase === 'st-crew') {
        if (!you.onCrew) return `<h2>The crew is at work…</h2><p>${g.crew.map(esc).join(', ')}</p>${peek}${card}`;
        if (you.played) return waiting('Card played');
        const fix = you.canFix ? '<label class="toggle"><input type="checkbox" id="st-fix"> 🔧 Fix It (cancel one sabotage, once per game)</label>' : '';
        return `<h2>You're on the crew</h2>${fix}<div class="vote-list storm-yesno">
            <button type="button" class="vote-btn" data-st-card="help">🔨 Help</button>
            ${you.canSabotage ? '<button type="button" class="vote-btn bad" data-st-card="sabotage">🦝 Sabotage</button>' : ''}</div>${card}`;
      }
      if (s.phase === 'st-reveal') return watchTv(`<p>${g.reveal && g.reveal.ok ? 'Chore done?' : 'Chore ruined?'} Watch the cards flip…</p>`) + peek + snoop;
      if (s.phase === 'st-accuse') return you.accused ? waiting('Accused') : `<h2>Who was a raccoon?</h2><div class="vote-list">${you.accuseTargets.map((/** @type {{ id: string, nickname: string }} */ t) => sendBtn({ accuse: t.id }, `${av(t.nickname)} ${esc(t.nickname)}`)).join('')}</div>`;
      if (s.phase === 'st-final') return `<h1>${you.won ? 'Your side won! 🎉' : 'Your side lost'}</h1><p class="prompt">+${you.gained} points</p>${card}`;
      return watchTv();
    },
    bind(root, api) {
      // Hold-to-peek role card.
      root.querySelectorAll('[data-hold]').forEach((b) => {
        const on = (/** @type {Event} */ e) => { e.preventDefault(); b.classList.add('peek'); };
        const off = () => b.classList.remove('peek');
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
      });
      const sendBtnEl = /** @type {HTMLButtonElement | null} */ (root.querySelector('[data-st-send]'));
      const crewSize = () => (api.state.gameState && api.state.gameState.crewSize) || 0;
      const refresh = () => {
        root.querySelectorAll('[data-st-pick]').forEach((b) => b.setAttribute('aria-pressed', String(stPick.has(/** @type {HTMLElement} */ (b).dataset.stPick || ''))));
        if (sendBtnEl) { sendBtnEl.disabled = stPick.size !== crewSize(); sendBtnEl.textContent = `Send this crew (${stPick.size}/${crewSize()})`; }
      };
      root.querySelectorAll('[data-st-pick]').forEach((b) => b.addEventListener('click', () => {
        const id = /** @type {HTMLElement} */ (b).dataset.stPick || '';
        if (stPick.has(id)) stPick.delete(id); else if (stPick.size < crewSize()) stPick.add(id);
        refresh();
      }));
      if (sendBtnEl) sendBtnEl.addEventListener('click', () => api.send({ crew: [...stPick] }));
      root.querySelectorAll('[data-st-card]').forEach((b) => b.addEventListener('click', () => {
        const fix = /** @type {HTMLInputElement | null} */ (root.querySelector('#st-fix'));
        api.send({ card: /** @type {HTMLElement} */ (b).dataset.stCard, fix: !!(fix && fix.checked) });
      }));
    },
    /** The narrator tells the story of the storm. @param {any} s */
    narrate(s) {
      const g = s.gameState;
      if (s.phase === 'st-roles') return 'A storm is rolling in over the lake. Check your secret role — and trust no one.';
      if (s.phase === 'st-talk') return `${g.choreNames[g.choreIndex]}. ${g.event.name}: ${g.event.desc} ${g.leader}, choose ${g.crewSize} for your crew.`;
      if (s.phase === 'st-votes') return g.votes && g.votes.approved ? 'The crew heads out into the wind.' : g.storm >= 3 ? 'Too much arguing. The storm is here.' : 'Voted down! The storm creeps closer.';
      if (s.phase === 'st-reveal') return g.reveal ? (g.reveal.ok ? 'The chore is done!' : 'Sabotage! Someone ruined it.') : null;
      if (s.phase === 'st-accuse') return g.winner === 'cottage' ? 'The cottage is ready. But who were the raccoons?' : 'The raccoons win! Now — who were they?';
      if (s.phase === 'st-final') return 'The masks come off.';
      return null;
    },
  });

  // ---------------------------------------------------------------- Campfire Wizards (spell duel)
  /** @typedef {{ nickname: string, hearts: number, sparks: number, ghost: boolean, frosted: boolean, bounty: boolean, picked: boolean }} WzWizard */
  /** @typedef {{ kind: string, from: string | null, to: string | null, amount: number }} WzBeat */
  /** @type {{ wizards: WzWizard[], beats: WzBeat[], start: number, key: string, stepMs: number }} */
  const wzView = { wizards: [], beats: [], start: 0, key: '', stepMs: 1200 };
  const WZ_COL = /** @type {Record<string, string>} */ ({ bolt: '#ff8a3d', frost: '#7fd8ff', meteor: '#ff5e3a', shield: '#6fa8ff', mirror: '#e8eeff', mend: '#7ed957', charge: '#ffd23f', haunt: '#b39ddb', bless: '#ff9ecb', ember: '#ff6b3d', reflect: '#ffffff', blocked: '#6fa8ff', ko: '#8e8fa3' });
  /** Seat positions around the fire (world 320×180). @param {number} i @param {number} n */
  const wzSeat = (i, n) => { const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2; return [160 + Math.cos(a) * 118, 92 + Math.sin(a) * 62]; };

  function wzDraw(/** @type {HTMLCanvasElement} */ cv, /** @type {number} */ tick) {
    const g = cv.getContext('2d');
    if (!g) return;
    const S = 3;
    const R = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {string} */ c) => { g.fillStyle = c; g.fillRect(Math.round(x) * S, Math.round(y) * S, Math.max(1, Math.round(w)) * S, Math.max(1, Math.round(h)) * S); };
    // Night clearing + the campfire, flickering on the 30 fps clock.
    R(0, 0, 320, 180, '#120d1c'); R(0, 120, 320, 60, '#1b2416');
    for (let r = 60; r > 0; r -= 6) R(160 - r, 92 - r / 2, r * 2, r, `rgba(255,140,60,${(0.05 * (60 - r) / 60).toFixed(3)})`);
    R(146, 100, 28, 4, '#5d3a22'); R(150, 96, 20, 4, '#4a2d1a');
    for (let k = 0; k < 7; k++) {
      const h = 10 + ((tick * 3 + k * 7) % 9), x = 151 + k * 3;
      R(x, 98 - h, 3, h, k % 2 ? '#ff8a3d' : '#ffd23f');
    }
    for (let k = 0; k < 5; k++) { const y = 80 - ((tick * 1.5 + k * 17) % 50); R(156 + Math.sin(tick / 6 + k) * 6, y, 1, 1, '#ffd23f'); }
    const n = wzView.wizards.length;
    /** @type {Record<string, number[]>} */
    const pos = {};
    wzView.wizards.forEach((w, i) => { pos[w.nickname] = wzSeat(i, n); });
    // Which beat is playing?
    const t = Date.now() - wzView.start;
    const step = wzView.stepMs;
    const bi = wzView.beats.length ? Math.floor(t / step) : -1;
    const frac = (t % step) / step;
    // Wizards
    wzView.wizards.forEach((w, i) => {
      const [x, y] = wzSeat(i, n);
      const bob = Math.round(Math.sin((tick + i * 11) / 8) * (w.ghost ? 2 : 1));
      g.globalAlpha = w.ghost ? 0.45 : 1;
      const im = llImg(w.nickname);
      if (im.complete && im.naturalWidth) { g.imageSmoothingEnabled = false; g.drawImage(im, Math.round(x - 8) * S, Math.round(y - 14 + bob) * S, 16 * S, 16 * S); }
      R(x - 6, y + 3 + bob, 12, 2, w.ghost ? '#b39ddb' : '#6b4c8a'); // robe hem
      g.globalAlpha = 1;
      for (let h = 0; h < 5; h++) R(x - 9 + h * 4, y + 7, 3, 2, h < w.hearts ? '#ff5e6b' : '#3a2a3a');
      for (let s = 0; s < w.sparks; s++) R(x - 9 + s * 4, y + 10, 2, 2, '#ffd23f');
      if (w.bounty) { R(x - 2, y - 20 + bob, 4, 3, '#ffd23f'); R(x - 3, y - 21 + bob, 1, 2, '#ffd23f'); R(x + 2, y - 21 + bob, 1, 2, '#ffd23f'); }
      if (w.frosted) R(x - 8, y - 14 + bob, 16, 1, '#7fd8ff');
    });
    // The current beat's effect.
    const b = bi >= 0 && bi < wzView.beats.length ? wzView.beats[bi] : null;
    if (b) {
      const c = WZ_COL[b.kind] || '#fff';
      const A = b.from ? pos[b.from] : null, B = b.to ? pos[b.to] : null;
      if ((b.kind === 'bolt' || b.kind === 'frost' || b.kind === 'haunt' || b.kind === 'bless' || b.kind === 'mend' || b.kind === 'reflect') && A && B) {
        const p = Math.min(1, frac * 1.6);
        const x = A[0] + (B[0] - A[0]) * p, y = A[1] - 6 + (B[1] - A[1]) * p - Math.sin(p * Math.PI) * 14;
        for (let k = 0; k < 5; k++) R(x - (B[0] - A[0]) * 0.03 * k, y - (B[1] - A[1]) * 0.03 * k, 3 - k * 0.5, 3 - k * 0.5, c);
        if (p >= 1) for (let k = 0; k < 8; k++) R(B[0] + Math.cos(k + tick) * frac * 12, B[1] - 6 + Math.sin(k + tick) * frac * 8, 1, 1, c);
      } else if (b.kind === 'meteor' && A) {
        for (const w of wzView.wizards) { if (w.nickname === b.from || w.ghost) continue; const P = pos[w.nickname]; const y = P[1] - 60 + frac * 60; R(P[0] - 2 + (1 - frac) * 20, y - 6, 5, 5, c); R(P[0] + (1 - frac) * 24, y - 10, 2, 2, '#ffd23f'); }
      } else if ((b.kind === 'shield' || b.kind === 'blocked') && (b.kind === 'shield' ? A : B)) {
        const P = /** @type {number[]} */ (b.kind === 'shield' ? A : B); const r = 12 + Math.sin(tick / 2) * 1;
        for (let k = 0; k < 24; k++) R(P[0] + Math.cos(k * 0.26) * r, P[1] - 6 + Math.sin(k * 0.26) * r, 1, 1, c);
      } else if (b.kind === 'mirror' && A) {
        R(A[0] - 10, A[1] - 16, 2, 14, c); if (tick % 4 < 2) R(A[0] - 9, A[1] - 15, 1, 3, '#fff');
      } else if (b.kind === 'charge' && A) {
        for (let k = 0; k < 6; k++) R(A[0] + Math.cos(k * 1.05 + tick / 3) * 10, A[1] - 6 + Math.sin(k * 1.05 + tick / 3) * 10, 2, 2, c);
      } else if (b.kind === 'ember' && B) {
        for (let k = 0; k < 4; k++) R(B[0] - 6 + k * 4, B[1] - 30 + ((frac * 30 + k * 7) % 30), 1, 2, c);
      } else if (b.kind === 'ko' && B) {
        for (let k = 0; k < 10; k++) R(B[0] + Math.cos(k) * frac * 18, B[1] - 6 + Math.sin(k) * frac * 10, 2, 2, c);
      }
    }
  }
  window.Rumpus.clock.add((tick) => {
    const cv = /** @type {HTMLCanvasElement | null} */ (document.querySelector('canvas.wz-fire'));
    if (cv) wzDraw(cv, tick);
  });
  /** A beat in words (TV log + narrator). @param {WzBeat} b */
  const wzLine = (b) => ({
    bolt: `🔥 ${b.from}'s firebolt hits ${b.to} (−${b.amount})`, frost: `❄️ ${b.from} freezes ${b.to} (−${b.amount})`, meteor: `☄️ ${b.from}'s meteor hits ${b.to}`,
    shield: `🛡 ${b.from} raises a shield`, blocked: `🛡 ${b.to}'s shield holds!`, mirror: `🪞 ${b.from} holds up a mirror to ${b.to}`, reflect: `🪞 ${b.from}'s mirror bounces it back at ${b.to}!`,
    mend: `💚 ${b.from} mends ${b.to} (+${b.amount})`, charge: `✨ ${b.from} charges up`, haunt: `👻 ${b.from} haunts ${b.to}`, bless: `👻 ${b.from} blesses ${b.to}`,
    ember: `🌋 Embers singe ${b.to}`, ko: `💥 ${b.to} is knocked out — and rises as a ghost!`,
  }[b.kind] || '');
  /** Phone: the spell you tapped, waiting for a target. */
  let wzSpell = '';
  let wzSpellKey = '';

  register('wizards', {
    host(s) {
      const g = s.gameState;
      const key = `${g.round}|${s.phase}`;
      if (key !== wzView.key) { wzView.key = key; wzView.start = Date.now(); }
      wzView.wizards = g.wizards || []; wzView.beats = g.beats || []; wzView.stepMs = g.stepMs || 1200;
      const tag = `<p class="round-tag">Round ${g.round} of ${g.totalRounds}${g.multiplier > 1 ? `<span class="double-badge">${g.multiplier}× POINTS</span>` : ''}</p>`;
      const ev = `<p class="wz-event"><b>${esc(g.event.name)}</b> — ${esc(g.event.desc)}</p>`;
      if (s.phase === 'wz-final') {
        return `<h1>🏆 The tournament is over</h1><ol class="answers">${(g.finalRows || []).map((/** @type {{ nickname: string, place: number, gained: number, ghost: boolean }} */ r) => `<li class="${r.place === 1 ? 'winner' : ''}">${av(r.nickname)} ${esc(r.nickname)}${r.ghost ? ' 👻' : ' 🧙'} <span class="votes">+${r.gained}</span></li>`).join('')}</ol>`;
      }
      const sub = s.phase === 'wz-pick' ? `<p class="big-sub">Choose your spell on your phone ${T} · ${g.pickedCount}/${g.totalPlayers}</p>` : '';
      const log = s.phase === 'wz-reveal' ? `<ol class="wz-log">${wzView.beats.map((b, i) => `<li style="animation-delay:${(i * wzView.stepMs) / 1000}s">${esc(wzLine(b))}</li>`).join('')}</ol>` : '';
      return `${tag}${ev}<canvas class="wz-fire" width="960" height="540"></canvas>${sub}${log}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'wz-final') { const r = (g.finalRows || []).find((/** @type {{ nickname: string }} */ x) => x.nickname === you.nickname); return `<h1>${r && r.place === 1 ? '🏆 Champion wizard!' : `You placed #${r ? r.place : '?'}`}</h1><p>+${r ? r.gained : 0} points</p>`; }
      const stats = `<p class="wz-stats">${you.ghost ? '👻 Ghost' : `❤️ ${you.hearts} · ✨ ${you.sparks}${you.frosted ? ' · ❄️ frosted (+1 cost)' : ''}`}${you.bounty ? ' · 👑 bounty on you!' : ''}</p>`;
      if (s.phase === 'wz-reveal') return `${stats}${watchTv('<p>The spells go off…</p>')}`;
      if (you.picked) return `${stats}${waiting('Spell ready', 'Everyone casts together…')}`;
      const key = `${g.round}`;
      if (key !== wzSpellKey) { wzSpell = ''; wzSpellKey = key; }
      const chosen = (you.spells || []).find((/** @type {{ id: string }} */ x) => x.id === wzSpell);
      if (chosen && chosen.target !== 'none') {
        const list = chosen.target === 'any' ? you.any : you.others;
        return `${stats}<h2>${esc(chosen.name)} — on whom?</h2><div class="vote-list">${list.map((/** @type {{ id: string, nickname: string }} */ t) => sendBtn({ spell: chosen.id, target: t.id }, `${av(t.nickname)} ${esc(t.nickname)}${t.id === you.playerId ? ' (you)' : ''}`)).join('')}</div>
          <button type="button" class="ghost-btn" data-wz-spell="">← another spell</button>`;
      }
      return `${stats}<p class="hint">${esc(g.event.name)}: ${esc(g.event.desc)}</p><div class="vote-list wz-spells">${(you.spells || []).map((/** @type {{ id: string, name: string, cost: number, desc: string, ok: boolean, target: string }} */ sp) =>
        sp.target === 'none'
          ? `<button class="vote-btn" data-send="${esc(JSON.stringify({ spell: sp.id }))}" ${sp.ok ? '' : 'disabled'}><b>${esc(sp.name)}</b> ✨${sp.cost}<br><small>${esc(sp.desc)}</small></button>`
          : `<button type="button" class="vote-btn" data-wz-spell="${esc(sp.id)}" ${sp.ok ? '' : 'disabled'}><b>${esc(sp.name)}</b> ✨${sp.cost}<br><small>${esc(sp.desc)}</small></button>`).join('')}</div>`;
    },
    bind(root, api) {
      root.querySelectorAll('[data-wz-spell]').forEach((b) => b.addEventListener('click', () => {
        wzSpell = /** @type {HTMLElement} */ (b).dataset.wzSpell || '';
        api.rerender();
      }));
    },
    /** Rocco calls the big moments. @param {any} s */
    narrate(s) {
      const g = s.gameState;
      if (s.phase === 'wz-pick') return g.round === 1 ? 'Wizards, to the fire! Choose your spells.' : `${g.event.name}! ${g.event.desc}`;
      if (s.phase === 'wz-reveal') {
        const big = (g.beats || []).filter((/** @type {WzBeat} */ b) => ['ko', 'reflect', 'meteor', 'blocked'].includes(b.kind)).slice(0, 2);
        return big.length ? big.map((/** @type {WzBeat} */ b) => wzLine(b).replace(/^\S+\s/, '').replace(/\(.*?\)/g, '')).join('. ') : 'The spells fly!';
      }
      if (s.phase === 'wz-final') { const w = (g.finalRows || [])[0]; return w ? `${w.nickname} is the champion wizard!` : null; }
      return null;
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

  // ---------------------------------------------------------------- Message in a Bottle
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
