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
  const { esc, register, scoredList, av, signed } = window.Rumpus;
  const T = '<span class="timer"></span>';

  /** @param {{ round?: number, totalRounds?: number }} g @param {string} [label] */
  const roundTag = (g, label = 'Round') =>
    g.round ? `<p class="round-tag">${label} ${g.round} of ${g.totalRounds}</p>` : '';
  /** @param {string} title @param {string} [sub] */
  const waiting = (title, sub = 'Waiting for the other players…') => `<h1>${title} ✓</h1><p>${sub}</p>`;
  /** A button that sends `payload` when tapped (wired by play.js). @param {Record<string, unknown>} payload @param {string} label @param {string} [cls] */
  const sendBtn = (payload, label, cls = 'vote-btn') =>
    `<button class="${cls}" data-send="${esc(JSON.stringify(payload))}">${label}</button>`;
  /** @param {string} placeholder @param {number} [max] @param {string} [button] */
  const textForm = (placeholder, max = 60, button = 'Send it') => `
    <form class="text-form">
      <input name="text" maxlength="${max}" autocomplete="off" placeholder="${esc(placeholder)}" required>
      <button type="submit">${button}</button>
    </form>`;
  /** @param {number} a @param {number} b @param {string} what */
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
        <div class="versus">${r.sides.map((/** @type {any} */ sd, /** @type {any} */ i) => `
          ${i === 1 ? '<div class="vs-badge">VS</div>' : ''}
          <div class="vs-card ${i ? 'b' : 'a'} ${r.winner === i ? 'won' : r.winner === -1 ? '' : 'lost'}">
            ${esc(sd.text)}
            <div class="vs-meta">${av(sd.nickname, 'avatar')} ${esc(sd.nickname)}</div>
            <div class="vs-bar"><i style="width:${sd.pct}%"></i></div>
            <div class="vs-meta"><b>${sd.pct}%</b> · ${sd.votes} vote${sd.votes === 1 ? '' : 's'} · ${signed(sd.gained)}
              <span class="voters">${sd.voters.map((/** @type {any} */ n) => av(n)).join('')}</span></div>
            ${sd.shutout ? `<span class="sweep">SHUTOUT! +${sd.shutoutPts || 250}</span>` : ''}
            ${sd.bet ? `<div class="vs-meta">🎲 ${esc(sd.bet.label)}: ${sd.bet.won ? `won +${Math.abs(sd.bet.pts)}` : `lost ${Math.abs(sd.bet.pts)}`}</div>` : ''}
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
            ${sendBtn({ bet: 'win' }, `🤞 I'll win · +${100 * (g.multiplier || 1)} / −${50 * (g.multiplier || 1)}`)}${sendBtn({ bet: 'landslide' }, `🔥 Landslide (75%+) · +${250 * (g.multiplier || 1)} / −${100 * (g.multiplier || 1)}`)}</div>`;
        }
        if (you.voted) return waiting('Vote cast');
        return `<h2 class="prompt">${esc(g.prompt)}</h2><p>Which is funnier?</p><div class="vote-list">` +
          g.answers.map((/** @type {any} */ a, /** @type {any} */ i) => sendBtn({ choice: i }, esc(a.text))).join('') + '</div>';
      }
      const r = g.result;
      if (you.side >= 0) {
        const me = r.sides[you.side];
        return `<h1>${r.winner === you.side ? 'You won the matchup! 🏆' : r.winner === -1 ? 'Dead heat!' : 'Ouch. 💀'}</h1>
          <p class="prompt">${me.pct}% of the votes · ${signed(me.gained)}</p>${me.shutout ? '<p class="sweep">SHUTOUT!</p>' : ''}`;
      }
      return watchTv();
    },
  });

  // ---------------------------------------------------------------- Cottage Olympics
  const teamName = (/** @type {string | null | undefined} */ t) => (t === 'red' ? '🔴 RED' : t === 'blue' ? '🔵 BLUE' : '');
  /** Campfire Sequence colours (stones by the fire). */
  const MG_COLOURS = ['#ff5e5e', '#ffd23f', '#4fc3f7', '#7ed957'];
  const MG_COLOUR_NAMES = ['RED', 'YELLOW', 'BLUE', 'GREEN'];
  /** Skip Stones: where the arrow is (0–1) at a time (same maths as the server). @param {number} t @param {number} period */
  const mgSwing = (t, period) => { const x = (((t % period) + period) % period) / period; return x < 0.5 ? x * 2 : 2 - x * 2; };
  /** A canvas sized to its box (pixel-crisp), drawn on the shared 30 fps clock. @param {HTMLCanvasElement} cv @param {(g: CanvasRenderingContext2D, w: number, h: number) => void} draw */
  function mgCanvas(cv, draw) {
    const g = cv.getContext('2d');
    return window.Rumpus.clock.add(() => {
      if (!g || !cv.isConnected) return;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      g.imageSmoothingEnabled = false;
      draw(g, w, h);
    });
  }
  register('minigames', {
    host(s) {
      const g = s.gameState;
      const tag = `<p class="round-tag">Minigame ${g.round} of ${g.totalRounds}</p>`;
      const secs = (/** @type {number} */ ms) => (ms / 1000).toFixed(1) + ' s';
      if (s.phase === 'mg-intro') {
        return `${tag}<h1 class="prompt mg-title">${esc(g.miniName)}</h1><p class="big-sub mg-rule">${esc(g.rule)}</p>${g.mini === 'roast' ? `<p class="big-answer">Target: ${secs(g.target)}</p>` : ''}`;
      }
      if (s.phase === 'mg-result') {
        const r = g.result;
        const head = r.winnerTeam ? (r.winnerTeam === 'tie' ? 'TIE!' : `${teamName(r.winnerTeam)} WINS!`) : r.rows[0] && r.rows[0].gained ? `${esc(r.rows[0].nickname)} WINS!` : 'NOBODY!';
        return `${tag}<h1 class="prompt">${esc(g.miniName)}: ${head}</h1>
          ${r.answer != null ? `<p class="big-answer">${g.mini === 'fireflies' ? r.answer + ' fireflies' : 'Target: ' + secs(r.answer)}</p>` : ''}
          <ol class="answers results">${r.rows.map((/** @type {any} */ row) => `<li class="${row.gained ? 'winner' : ''} ${row.team ? 'team-' + row.team : ''}">
            ${av(row.nickname)} ${esc(row.nickname)} — ${esc(row.burnt ? 'BURNT 🔥' : row.value)}${typeof row.value === 'number' && row.unit ? ' ' + row.unit : ''}
            ${row.gained ? `<span class="votes">+${row.gained}</span>` : ''}</li>`).join('')}</ol>`;
      }
      const bars = (/** @type {{ nickname: string, n: number }[]} */ list, /** @type {string} */ unit) => {
        const max = Math.max(1, ...list.map((t) => t.n));
        return `<div class="bars">${list.map((t) => `<div class="bar-row"><span class="bar-label">${av(t.nickname, 'avatar')} ${esc(t.nickname)}</span>
          <span class="bar" style="width:${(t.n / max) * 100}%;animation:none"></span><span class="bar-n">${t.n}${unit}</span></div>`).join('')}</div>`;
      };
      // mg-play
      switch (g.mini) {
        case 'tug': case 'paddle': {
          if (g.tug) {
            const diff = g.tug.red - g.tug.blue;
            const pos = Math.max(-1, Math.min(1, diff / g.tug.goal)); // -1..1 (red pulls left)
            return `${tag}<h1 class="prompt">TAP! TAP! TAP!</h1>
              <div class="tug"><div class="tug-team red">🔴 ${g.tug.red}</div>
                <div class="tug-lake"><div class="tug-rope"><div class="tug-flag" style="left:${50 - pos * 45}%"></div></div></div>
                <div class="tug-team blue">${g.tug.blue} 🔵</div></div>`;
          }
          return `${tag}<h1 class="prompt">${g.mini === 'paddle' ? '🛶 PADDLE! LEFT · RIGHT' : 'TAP RACE!'}</h1>${bars(g.taps.map((/** @type {any} */ t) => ({ nickname: t.nickname, n: t.taps })), '')}`;
        }
        case 'quickdraw': return g.sub === 'go' ? `<div class="qd go">GO!</div>` : `<div class="qd wait">WAIT…</div>`;
        case 'fireflies':
          if (g.sub === 'show') return `<div class="fly-field">${g.flies.map((/** @type {any} */ f) => `<i style="left:${f.x}%;top:${f.y}%;animation-delay:${f.d / 10}s"></i>`).join('')}</div>`;
          return `${tag}<h1 class="prompt">How many fireflies?</h1><p class="big-sub">Guess on your phones! ${T}</p>${count(g.doneCount, g.totalPlayers, 'guesses in')}`;
        case 'roast': // no clock on screen: feel the seconds
          return `${tag}<h1 class="prompt">🔥 ROAST! 🍡</h1><p class="big-answer">Let go at ${secs(g.target)}</p><p class="big-sub">No clock to help you — count it in your head…</p>${count(g.doneCount, g.totalPlayers, 'done')}`;
        case 'skip': return `${tag}<h1 class="prompt">🪨 Skip those stones!</h1><p class="big-sub">Tap when the arrow is in the green · 3 throws ${T}</p>${bars(g.board, ' skips')}`;
        case 'spot': {
          const u = window.Rumpus.sprites && window.Rumpus.sprites.iconUrl('looncall');
          const DUCKS = ['🦆', '🦆', '🦢'];
          return `${tag}<h1 class="prompt">Where's the loon? 🔎</h1><div class="spot-grid">${Array.from({ length: 12 }, (_, i) =>
            `<div class="spot-cell"><b>${i + 1}</b>${i === g.loon && u ? `<img src="${u}" alt="">` : `<span>${DUCKS[(g.ducks || [])[i] || 0]}</span>`}</div>`).join('')}</div>
            ${count(g.doneCount, g.totalPlayers, 'spotters')}`;
        }
        case 'swat': return `${tag}<h1 class="prompt">🦟 SWAT!</h1><p class="big-sub">Squash the mosquitoes on your phone ${T}</p>${bars(g.board, '')}`;
        case 'balance': return `${tag}<h1 class="prompt">⚓ Dock Balance</h1><p class="big-sub">Keep your finger inside the drifting ring ${T}</p>${count(g.doneCount, g.totalPlayers, 'done')}`;
        case 'simon':
          if (g.sub === 'show') {
            return `${tag}<h1 class="prompt">Watch the sparks!</h1><div class="simon-stage">${(g.seq || []).map((/** @type {number} */ c, /** @type {number} */ i) =>
              `<i class="simon-spark" style="--c:${MG_COLOURS[c]};animation-delay:${(i * (g.showMs || 600)) / 1000}s"><span>${MG_COLOUR_NAMES[c]}</span></i>`).join('')}</div>`;
          }
          return `${tag}<h1 class="prompt">Repeat it on your phone!</h1><p class="big-sub">${g.length} sparks · right and fast wins ${T}</p>${count(g.doneCount, g.totalPlayers, 'done')}`;
        case 'stack': return `${tag}<h1 class="prompt">🪵 Stack the woodpile!</h1><p class="big-sub">Tap to drop each log on the pile ${T}</p>${count(g.doneCount, g.totalPlayers, 'piles done')}`;
        default: return tag;
      }
    },
    player(s) {
      const g = s.gameState, you = s.you;
      const badge = you.team ? `<p class="team-badge team-${you.team}">${teamName(you.team)}</p>` : '';
      if (s.phase === 'mg-intro') return `${badge}<h1>${esc(g.miniName)}</h1><p class="prompt">${esc(g.rule)}</p>${g.mini === 'roast' ? `<p class="big-answer">Let go at ${(g.target / 1000).toFixed(1)} s</p>` : ''}<p>Get ready…</p>`;
      if (s.phase === 'mg-result') return `<h1>${you.gained ? `+${you.gained}! 🎉` : 'Next one! 💪'}</h1>`;
      if (you.early) return g.mini === 'quickdraw' ? '<h1>SPLASH! 💦</h1><p>Too early!</p>' : g.mini === 'spot' ? '<h1>Wrong bird! 🦆</h1><p>That was a duck.</p>' : '<h1>Oops! ✗</h1><p>Not quite the right order.</p>';
      switch (g.mini) {
        case 'tug': return `${badge}<button class="mg-big tap" data-mg="tap">TAP!</button><p class="mg-count">0</p>`;
        case 'quickdraw':
          if (you.done) return waiting('Tapped');
          return `<button class="mg-big ${g.sub === 'go' ? 'go' : 'wait'}" data-mg="draw">${g.sub === 'go' ? 'GO!' : 'WAIT…'}</button>`;
        case 'fireflies':
          if (you.done) return waiting('Guess locked');
          return `<h2>${g.sub === 'show' ? 'Count the fireflies on the TV!' : 'How many fireflies?'}</h2><form class="number-form"><input name="number" inputmode="numeric" autocomplete="off" required><button type="submit">Lock it in</button></form>`;
        case 'roast':
          if (you.done) return waiting('Roasted');
          return `<p class="mg-count">Let go at ${(g.target / 1000).toFixed(1)} s</p><button class="mg-big roast" data-mg="roast">HOLD TO ROAST</button>`;
        case 'skip':
          if (you.done) return waiting(`${you.skips} skips`, 'Nice throwing!');
          return `<p class="mg-count">${you.lastSkips != null ? `Last throw: ${you.lastSkips} skip${you.lastSkips === 1 ? '' : 's'} · ` : ''}Total ${you.skips || 0}</p>
            <canvas class="mg-canvas mg-meter" data-mg-skip></canvas>
            <button class="mg-big go" data-mg="skip">THROW! <small>(${3 - you.throws} left)</small></button>`;
        case 'spot':
          if (you.done) return waiting('Spotted!');
          return `<h2>Which spot is the loon in? (look at the TV)</h2><div class="spot-pad">${Array.from({ length: g.cells || 12 }, (_, i) => sendBtn({ cell: i }, String(i + 1), 'vote-btn spot-btn')).join('')}</div>`;
        case 'swat': return `<p class="mg-count" data-mg-swats>0 swatted</p><canvas class="mg-canvas mg-field" data-mg-swat></canvas>`;
        case 'balance':
          if (you.done) return waiting('Balanced');
          return `<p class="mg-count" data-mg-bal>Put your finger in the ring</p><canvas class="mg-canvas mg-field" data-mg-balance></canvas>`;
        case 'paddle': return `${badge}<p class="mg-count" data-mg-strokes>0 strokes</p><div class="paddle-pad"><button class="mg-big paddle" data-mg-side="L">⬅ LEFT</button><button class="mg-big paddle" data-mg-side="R">RIGHT ➡</button></div>`;
        case 'simon':
          if (you.done) return waiting('Sequence in');
          if (g.sub !== 'go') return watchTv('<p>Remember the colours of the sparks…</p>');
          return `<p class="mg-count" data-mg-seq>${'○ '.repeat(g.length || 0)}</p><div class="simon-pad">${MG_COLOURS.map((c, i) => `<button class="mg-big simon" style="--c:${c}" data-mg-colour="${i}">${MG_COLOUR_NAMES[i]}</button>`).join('')}</div>`;
        case 'stack':
          if (you.done) return waiting('Pile done');
          return `<p class="mg-count" data-mg-height>0 logs</p><canvas class="mg-canvas mg-field" data-mg-stack></canvas><p class="hint">Tap anywhere on the pile to drop the log</p>`;
        default: return watchTv();
      }
    },
    bind(root, api) {
      const g = api.state.gameState || {};
      const now = () => window.Rumpus.time.now();
      const btn = /** @type {HTMLElement | null} */ (root.querySelector('[data-mg]'));
      const kind = btn ? btn.dataset.mg : '';
      if (btn && kind === 'tap') {
        let pending = 0, total = 0;
        const label = /** @type {HTMLElement} */ (root.querySelector('.mg-count'));
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); pending++; total++; label.textContent = String(total); window.Rumpus.haptic(8); });
        const t = setInterval(() => { if (pending) { api.send({ tap: pending }); pending = 0; } }, 150);
        api.onCleanup(() => clearInterval(t));
      } else if (btn && kind === 'draw') {
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); window.Rumpus.haptic(20); api.send({ tap: 1 }); });
      } else if (btn && kind === 'roast') {
        // No live readout while holding — that would be the clock the game takes away.
        let t0 = 0;
        const label = /** @type {HTMLElement} */ (root.querySelector('.mg-count'));
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); t0 = performance.now(); btn.classList.add('holding'); btn.textContent = 'ROASTING…'; window.Rumpus.haptic(15); });
        const release = () => {
          if (!t0) return;
          const ms = Math.round(performance.now() - t0);
          t0 = 0;
          btn.classList.remove('holding');
          label.textContent = `You held ${(ms / 1000).toFixed(2)} s`;
          window.Rumpus.haptic(25);
          api.send({ hold: ms });
        };
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
      } else if (btn && kind === 'skip') {
        const cv = /** @type {HTMLCanvasElement} */ (root.querySelector('[data-mg-skip]'));
        api.onCleanup(mgCanvas(cv, (c, w, h) => {
          c.fillStyle = '#123d4f'; c.fillRect(0, 0, w, h);
          const z0 = (g.sweet - g.zone) * w, z1 = (g.sweet + g.zone) * w;
          c.fillStyle = '#2e7d32'; c.fillRect(z0, 0, z1 - z0, h);
          c.fillStyle = '#7ed957'; c.fillRect((g.sweet - g.zone / 3) * w, 0, (g.zone * 2 / 3) * w, h);
          const x = mgSwing(now() - g.playStart, g.period) * w;
          c.fillStyle = '#fff'; c.fillRect(Math.round(x) - 3, 0, 6, h);
        }));
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); window.Rumpus.haptic(20); api.send({ throw: now() }); });
      }
      // Mosquito Swat: bugs appear on a schedule (server time); tap them while they're there.
      const swat = /** @type {HTMLCanvasElement | null} */ (root.querySelector('[data-mg-swat]'));
      if (swat) {
        const hit = new Set(/** @type {number[]} */ ((api.state.you || {}).swats || []));
        const label = /** @type {HTMLElement} */ (root.querySelector('[data-mg-swats]'));
        /** @type {{ x: number, y: number, t: number }[]} */
        const splats = [];
        const live = () => { const t = now() - g.playStart; return (g.bugs || []).map((/** @type {any} */ b, /** @type {number} */ i) => ({ ...b, i })).filter((/** @type {any} */ b) => !hit.has(b.i) && t >= b.at && t <= b.at + b.life); };
        api.onCleanup(mgCanvas(swat, (c, w, h) => {
          c.fillStyle = '#1b3c2a'; c.fillRect(0, 0, w, h);
          for (const sp of splats) { c.fillStyle = '#5a1e1e'; c.fillRect(sp.x - 6, sp.y - 6, 12, 12); }
          const f = window.Rumpus.clock.frame();
          for (const b of live()) {
            const x = (b.x / 100) * w, y = (b.y / 100) * h, k = 4;
            c.fillStyle = '#222'; c.fillRect(x - k, y - k, k * 2, k * 2);
            c.fillStyle = f % 4 < 2 ? '#cfd8dc' : '#90a4ae'; c.fillRect(x - k * 3, y - k * 2, k * 2, k); c.fillRect(x + k, y - k * 2, k * 2, k);
          }
        }));
        swat.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const r = swat.getBoundingClientRect();
          const px = e.clientX - r.left, py = e.clientY - r.top;
          const best = live().find((/** @type {any} */ b) => Math.hypot((b.x / 100) * r.width - px, (b.y / 100) * r.height - py) < 44);
          if (!best) { window.Rumpus.haptic(5); return; }
          hit.add(best.i);
          splats.push({ x: px, y: py, t: 0 });
          label.textContent = `${hit.size} swatted`;
          window.Rumpus.haptic(25);
          api.send({ swat: best.i });
        });
      }
      // Dock Balance: the ring drifts on a fixed path; count the time the finger is inside it.
      const bal = /** @type {HTMLCanvasElement | null} */ (root.querySelector('[data-mg-balance]'));
      if (bal) {
        let inside = 0, frames = 0, sent = false;
        /** @type {{ x: number, y: number } | null} */
        let finger = null;
        const label = /** @type {HTMLElement} */ (root.querySelector('[data-mg-bal]'));
        const ring = (/** @type {number} */ t) => ({ x: 0.5 + 0.32 * Math.sin((t / 1000) * g.ax + g.px), y: 0.5 + 0.32 * Math.sin((t / 1000) * g.ay + g.py) });
        const send = () => { if (sent) return; sent = true; api.send({ balance: frames ? Math.round((100 * inside) / frames) : 0 }); };
        api.onCleanup(mgCanvas(bal, (c, w, h) => {
          const t = now() - g.playStart;
          const p = ring(t);
          const R = g.radius * Math.min(w, h);
          c.fillStyle = '#13284a'; c.fillRect(0, 0, w, h);
          const cx = p.x * w, cy = p.y * h;
          const isIn = !!finger && Math.hypot(finger.x - cx, finger.y - cy) <= R;
          if (t >= 0 && !sent) { frames++; if (isIn) inside++; }
          c.strokeStyle = isIn ? '#7ed957' : '#ffd23f'; c.lineWidth = 8; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
          if (finger) { c.fillStyle = '#fff'; c.fillRect(finger.x - 5, finger.y - 5, 10, 10); }
          if (frames % 10 === 0) label.textContent = `${frames ? Math.round((100 * inside) / frames) : 0}% inside`;
          // Tell the server how it's going about once a second: if the round is ended early, this counts.
          if (!sent && frames && frames % 60 === 0) api.send({ balance: Math.round((100 * inside) / frames), partial: true });
          if (g.endsAt && now() > g.endsAt - 400) send();
        }));
        const move = (/** @type {PointerEvent} */ e) => { const r = bal.getBoundingClientRect(); finger = { x: e.clientX - r.left, y: e.clientY - r.top }; };
        bal.addEventListener('pointerdown', (e) => { e.preventDefault(); bal.setPointerCapture(e.pointerId); move(e); });
        bal.addEventListener('pointermove', move);
        bal.addEventListener('pointerup', () => { finger = null; });
      }
      // Canoe Sprint: only LEFT/RIGHT alternation counts.
      const sides = root.querySelectorAll('[data-mg-side]');
      if (sides.length) {
        let last = '', pending = 0, total = 0;
        const label = /** @type {HTMLElement} */ (root.querySelector('[data-mg-strokes]'));
        sides.forEach((b) => b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const side = /** @type {HTMLElement} */ (b).dataset.mgSide || '';
          if (side === last) { window.Rumpus.haptic([5, 30, 5]); return; } // same side twice: no stroke
          last = side; pending++; total++;
          label.textContent = `${total} strokes`;
          window.Rumpus.haptic(10);
        }));
        const t = setInterval(() => { if (pending) { api.send({ strokes: pending }); pending = 0; } }, 150);
        api.onCleanup(() => clearInterval(t));
      }
      // Campfire Sequence: tap the colours in order.
      // The pad only appears when the round moves from "watch" to "go" — the same screen, patched in
      // place without a new bind() — so listen on the screen itself and read the state at tap time.
      if (g.mini === 'simon') {
        /** @type {number[]} */
        const seq = [];
        const onTap = (/** @type {Event} */ e) => {
          const b = window.Rumpus.hit(e.target, '[data-mg-colour]');
          if (!b) return;
          e.preventDefault();
          const len = Number(api.state.gameState.length) || 0;
          if (seq.length >= len) return;
          seq.push(Number(b.dataset.mgColour));
          const label = /** @type {HTMLElement | null} */ (root.querySelector('[data-mg-seq]'));
          if (label) label.textContent = '● '.repeat(seq.length) + '○ '.repeat(Math.max(0, len - seq.length));
          window.Rumpus.haptic(12);
          if (seq.length === len) api.send({ seq });
        };
        root.addEventListener('pointerdown', onTap);
        api.onCleanup(() => root.removeEventListener('pointerdown', onTap));
      }
      // Woodpile Stack: a log slides back and forth; tap to drop it; the overhang is cut off.
      const st = /** @type {HTMLCanvasElement | null} */ (root.querySelector('[data-mg-stack]'));
      if (st) {
        const label = /** @type {HTMLElement} */ (root.querySelector('[data-mg-height]'));
        /** @type {{ x: number, w: number }[]} pile, in fractions of the width */
        const pile = [{ x: 0.2, w: 0.6 }];
        let pos = 0, dir = 1, speed = g.speed || 1, over = false;
        let lastT = performance.now();
        const finish = () => { if (over) return; over = true; api.send({ stack: pile.length - 1 }); };
        api.onCleanup(mgCanvas(st, (c, w, h) => {
          const t = performance.now(), dt = Math.min(0.1, (t - lastT) / 1000);
          lastT = t;
          const top = pile[pile.length - 1];
          if (!over) { pos += dir * speed * dt * 0.6; if (pos + top.w > 1) { pos = 1 - top.w; dir = -1; } if (pos < 0) { pos = 0; dir = 1; } }
          c.fillStyle = '#0f2a3d'; c.fillRect(0, 0, w, h);
          const lh = Math.max(14, Math.round(h / 18));
          const base = h - lh, shift = Math.max(0, pile.length - 12) * lh;
          pile.forEach((p, i) => { c.fillStyle = i % 2 ? '#8a5a3b' : '#a86f45'; c.fillRect(p.x * w, base - i * lh + shift, p.w * w, lh - 2); });
          if (!over) { c.fillStyle = '#ffd23f'; c.fillRect(pos * w, base - pile.length * lh + shift, top.w * w, lh - 2); }
          if (g.endsAt && now() > g.endsAt - 400) finish();
        }));
        st.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          if (over) return;
          const top = pile[pile.length - 1];
          const l = Math.max(pos, top.x), r = Math.min(pos + top.w, top.x + top.w);
          if (r - l < 0.02) { window.Rumpus.haptic([10, 50, 10]); finish(); return; }
          pile.push({ x: l, w: r - l });
          speed *= g.speedUp || 1.08;
          pos = 0; dir = 1;
          label.textContent = `${pile.length - 1} logs`;
          window.Rumpus.haptic(Math.abs(r - l - top.w) < 0.01 ? 30 : 15);
          if (pile.length > 40) finish();
          else api.send({ stack: pile.length - 1, partial: true }); // counts if the round is ended early
        });
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
        <div class="bars">${r.tally.map((/** @type {any} */ t, /** @type {any} */ i) => `
          <div class="bar-row ${(r.topIds || []).includes(t.id) ? 'winner' : ''}" style="animation-delay:${(r.tally.length - 1 - i) * 0.6}s">
            <span class="bar-label">${av(t.nickname, 'avatar')} ${esc(t.nickname)}</span>
            <span class="bar" style="width:${(t.votes / max) * 100}%"></span>
            <span class="bar-n">${t.votes}</span>
          </div>`).join('')}</div>
        ${r.winners.length ? `<p class="big-sub winner-line">The group has spoken: ${r.winners.map((/** @type {any} */ n) => av(n, 'avatar big bob') + ' ' + esc(n)).join(' & ')}!</p>` : '<p>No votes. Cowards.</p>'}
        ${scoredList(r.gained)}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'ml-vote') {
        if (you.voted) return waiting('Vote cast');
        return `${roundTag(g)}<h2 class="prompt">${esc(g.prompt)}</h2><div class="vote-list">` +
          g.targets.map((/** @type {any} */ t) => sendBtn({ target: t.id }, av(t.nickname) + ' ' + esc(t.nickname) + (t.id === you.playerId ? ' (you)' : ''))).join('') +
          '</div>';
      }
      return `<h1>${you.withCrowd ? `With the crowd! +${you.gained || 100}` : you.picked ? 'Against the grain ✗' : 'No vote'}</h1>
        <p class="prompt">${g.result.winners.map(esc).join(' & ') || '—'}</p>`;
    },
  });

  // ---------------------------------------------------------------- Campfire Consensus
  register('majority', {
    // Herd call: tap answers on/off locally, then lock the set in.
    bind(root, api) {
      const onClick = (/** @type {Event} */ e) => {
        const b = window.Rumpus.hit(e.target, '[data-herd]');
        if (!b) return;
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('on', on);
        window.Rumpus.haptic(10);
        const picked = [...root.querySelectorAll('[data-herd][aria-pressed="true"]')].map((x) => Number(/** @type {HTMLElement} */ (x).dataset.herd));
        const lock = /** @type {HTMLButtonElement | null} */ (root.querySelector('.herd-lock'));
        if (lock) { lock.dataset.send = JSON.stringify({ herd: picked }); lock.disabled = !picked.length; }
      };
      root.addEventListener('click', onClick);
      api.onCleanup(() => root.removeEventListener('click', onClick));
    },
    host(s) {
      const g = s.gameState;
      if (s.phase === 'mr-answer') {
        return `${roundTag(g)}<h1 class="prompt">${esc(g.prompt)}</h1>
          <p class="big-sub">Type what <em>everyone else</em> will say — then bet how many will match you! ${T}</p>
          ${count(g.submittedCount, g.totalPlayers, 'answers in')}${count(g.betCount, g.totalPlayers, 'bets placed')}`;
      }
      if (s.phase === 'mr-herd') {
        return `${roundTag(g)}<h1 class="prompt">${esc(g.prompt)}</h1>
          <p class="big-sub">🐑 The herd call: on your phones, tap every answer that counts as <b>the same herd</b>. ${T}</p>
          <div class="herd-cards">${(g.answers || []).map((/** @type {string} */ a) => `<span class="herd-card">${esc(a)}</span>`).join('')}</div>
          ${count(g.judgedCount, g.totalPlayers, 'herd calls in')}${waitingRow(g.waitingOn, 'deciding')}`;
      }
      return `${roundTag(g)}<h1 class="prompt">${esc(g.prompt)}</h1>
        <ol class="answers results suspense">${g.result.groups.map((/** @type {any} */ gr, /** @type {any} */ i, /** @type {any} */ all) => `
          <li class="${gr.top ? 'winner' : ''}${gr.herd ? ' herd' : ''}" style="animation-delay:${(all.length - 1 - i) * 0.5}s">${gr.herd ? '🐑 ' : ''}${esc(gr.label)}
            <span class="votes">×${gr.count}</span>
            <span class="voters">${gr.names.map((/** @type {any} */ n) => av(n)).join('')}</span></li>`).join('')}</ol>
        ${(g.result.bets || []).some((/** @type {any} */ b) => b.gained) ? `<p class="big-sub">🎯 Called it: ${g.result.bets.filter((/** @type {any} */ b) => b.gained).map((/** @type {any} */ b) => `${av(b.nickname)} ${esc(b.nickname)} (${b.bet})`).join(', ')}</p>` : ''}
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
      if (s.phase === 'mr-herd') {
        if (you.herdVoted) return waiting('Herd call in', 'The room decides which answers count as the same…');
        const answers = /** @type {string[]} */ (g.answers || []);
        return `<h2 class="prompt">${esc(g.prompt)}</h2>
          <p>🐑 Which answers are <b>the herd</b>? Tap every one that means the same thing as the winning answer (a majority decides).</p>
          <div class="vote-list herd-pick">${answers.map((a, i) => `<button type="button" class="vote-btn herd-opt" data-herd="${i}" aria-pressed="false">${esc(a)}${i === you.mine ? ' <small>(yours)</small>' : ''}</button>`).join('')}</div>
          <button class="wide herd-lock" data-send='{"herd":[]}' disabled>Lock in my herd call</button>`;
      }
      return `<h1>${you.matched ? `Matched ${you.matched} other${you.matched === 1 ? '' : 's'}!` : 'All alone ✗'}</h1>
        <p class="prompt">${esc(you.answer || '(no answer)')}</p>
        ${you.bet != null ? `<p>${you.bet === you.matched ? '🎯 Your bet was spot on!' : `You bet ${you.bet}.`}</p>` : ''}`;
    },
  });

  // ---------------------------------------------------------------- Closest Cast
  const fmt = (/** @type {number} */ n) => (Math.abs(n) >= 10000 ? Number(n).toLocaleString() : String(n));
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
        <ol class="answers results suspense${r.list.length > 5 ? ' two-col' : ''}">${r.list.map((/** @type {any} */ e, /** @type {any} */ i) => `
          <li class="${e.rank === 0 ? 'winner' : ''}" style="animation-delay:${(r.list.length - 1 - i) * 0.6 + 0.8}s">${av(e.nickname)} ${esc(e.nickname)}: ${fmt(e.guess)}${e.exact ? ' <span class="sweep">BULLSEYE!</span>' : ''}${e.double ? ' <span class="streak">🎲</span>' : ''}
            <span class="byline">(off by ${fmt(+e.off.toFixed(3))})</span>
            ${e.gained ? `<span class="votes">${signed(e.gained)}</span>` : ''}</li>`).join('')}</ol>`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'cg-guess') {
        if (you.submitted) return waiting('Guess locked');
        return `${roundTag(g)}<h2 class="prompt">${esc(g.question)}</h2>
          ${you.canDouble ? '<button type="button" class="ghost-btn dd-toggle" data-dd aria-pressed="false">🎲 Double Down? ×2 if you finish in the top half · −200 if not (once per game)</button>' : ''}
          <form class="number-form">
            <input name="number" type="text" inputmode="decimal" pattern="-?[0-9.,]+" autocomplete="off"
              placeholder="Your guess${g.unit ? ' (' + esc(g.unit) + ')' : ''}" required>
            <button type="submit">Lock it in</button>
          </form>`;
      }
      const m = you.mine;
      return `<h1>${m ? (m.rank === 0 ? 'Closest! 🎯' : `#${m.rank + 1}`) : 'No guess'}</h1>
        <p class="prompt">Answer: ${fmt(g.result.answer)} ${esc(g.result.unit)}</p>
        ${m ? `<p>You said ${fmt(m.guess)}${m.gained ? ` — ${signed(m.gained)}` : ''}</p>` : ''}`;
    },
  });

  // ---------------------------------------------------------------- Porch Confessions
  /** Porch Confessions phone: this phone's truth/lie calls while judging (author id → true = real). @type {Map<string, boolean>} */
  const ttCalls = new Map();
  let ttKey = '';
  register('twotruths', {
    /** @param {any} s */
    narrate(s) {
      const g = s.gameState;
      if (s.phase === 'tt-write') return `Confess: ${g.prompt}. Some of you are telling the truth. Some of you… are not.`;
      if (s.phase === 'tt-judge') return 'Real, or made up? Call it.';
      if (s.phase === 'tt-reveal' && g.current) return g.current.lie ? `${g.current.author} made that up!` : `That really happened to ${g.current.author}!`;
      return null;
    },
    host(s) {
      const g = s.gameState;
      const head = `${roundTag(g)}<p class="big-sub tt-confess">Confess…</p><h1 class="prompt">${esc(g.prompt)}</h1>`;
      if (s.phase === 'tt-write') {
        return `${head}<p class="big-sub">Check your phone: it says <b>TRUTH</b> or <b>LIE</b>. Write your answer! ${T}</p>
          ${count(g.submittedCount, g.totalPlayers, 'confessions in')}${waitingRow(g.waitingOn, 'writing')}`;
      }
      if (s.phase === 'tt-judge') {
        return `${head}<ul class="tt-wall">${g.answers.map((/** @type {{ nickname: string, text: string }} */ x) => `<li>${av(x.nickname, 'avatar')} <b>${esc(x.nickname)}</b> ${esc(x.text)}</li>`).join('')}</ul>
          <p class="big-sub">Real or made up? Call each one on your phone ${T}</p>${count(g.judgedCount, g.totalPlayers, 'calls in')}${waitingRow(g.waitingOn, 'deciding')}`;
      }
      const c = g.current;
      if (g.empty) return `${head}<p class="big-sub">Not enough confessions came in — new prompt coming up!</p>`;
      if (!c || g.done) {
        return `${head}<ol class="answers results tt-done">${(g.revealed || []).map((/** @type {any} */ x) => `<li class="${x.lie ? 'lie' : 'winner'}">${av(x.author)} ${esc(x.author)}: ${esc(x.text)} <span class="votes">${x.lie ? '🤥 LIE' : '✅ TRUE'}</span></li>`).join('')}</ol>
          ${scoredList(g.gained)}`;
      }
      const voters = (/** @type {string[]} */ list) => list.map((n) => av(n)).join('') || '<small>nobody</small>';
      return `${head}<div class="tt-card">
          <p class="tt-by">${av(c.author, 'avatar big bob')} ${esc(c.author)} confessed:</p>
          <p class="big-answer">“${esc(c.text)}”</p>
          <p class="tt-stamp ${c.lie ? 'lie' : 'true'}">${c.lie ? '🤥 MADE IT UP!' : '✅ IT\'S TRUE!'}</p>
          <p class="tt-calls">Believed it: ${voters(c.believed)} · Doubted it: ${voters(c.doubted)}${c.gained ? ` · ${esc(c.author)} fooled them: +${c.gained}` : ''}</p>
        </div><p class="count">${g.revealed.length} / ${g.total}</p>`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      const key = `${g.round}|${s.phase}`;
      if (key !== ttKey) { ttKey = key; ttCalls.clear(); }
      if (s.phase === 'tt-write') {
        if (you.submitted) return waiting('Confession in', 'Poker face on 😐');
        return `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p><p class="tt-confess">Confess…</p><h2 class="prompt">${esc(g.prompt)}</h2>
          <p class="tt-role ${you.lie ? 'lie' : 'true'}">${you.lie ? '🤥 MAKE IT UP — a believable lie' : '✅ TELL THE TRUTH — the wilder the better'}</p>
          ${textForm(you.lie ? 'Your best lie…' : 'What really happened…', 110, 'Confess')}
          ${you.canSwitch ? `<button type="button" class="ghost-btn" data-send='{"switchToLie":true}'>Nothing true comes to mind → lie instead</button>` : ''}`;
      }
      if (s.phase === 'tt-judge') {
        if (you.judged) return waiting('Calls in', 'Let\'s see who was honest…');
        const list = /** @type {{ id: string, nickname: string, text: string }[]} */ (g.answers || []);
        return `<h2>Real or made up?</h2><p class="hint">+100 for every right call</p><ul class="tt-judge">${list.map((a) => {
          const v = ttCalls.get(a.id);
          return `<li><p>${av(a.nickname, 'avatar')} <b>${esc(a.nickname)}</b>: ${esc(a.text)}</p>
            <div class="tt-pick"><button type="button" class="vote-btn ${v === true ? 'on' : ''}" data-tt="${esc(a.id)}" data-v="1">✅ Real</button>
            <button type="button" class="vote-btn bad ${v === false ? 'on' : ''}" data-tt="${esc(a.id)}" data-v="0">🤥 Made up</button></div></li>`;
        }).join('')}</ul><button class="wide" data-tt-lock ${ttCalls.size ? '' : 'disabled'}>Lock in ${ttCalls.size}/${list.length}</button>`;
      }
      const c = g.current;
      if (g.empty) return '<h1>Too quiet! 🤫</h1><p class="prompt">Not enough confessions — new prompt coming up.</p>';
      if (!c || g.done) return `<h1>Round over</h1><p class="prompt">${signed(you.gained)} this round</p>`;
      if (you.isAuthor) return `<h1>${c.lie ? 'Your lie' : 'Your truth'} is up!</h1><p class="prompt">${c.gained ? `You fooled them: +${c.gained}` : 'Nobody fooled 😅'}</p>`;
      return `<h1>${you.right === true ? `Called it! +${100 * (g.multiplier || 1)}` : you.right === false ? 'Fooled ✗' : '📺 Watch the TV'}</h1><p>${esc(c.author)}: ${c.lie ? 'made it up' : 'it really happened'}</p>`;
    },
    bind(root, api) {
      root.querySelectorAll('[data-tt]').forEach((b) => b.addEventListener('click', () => {
        const el = /** @type {HTMLElement} */ (b);
        ttCalls.set(el.dataset.tt || '', el.dataset.v === '1');
        window.Rumpus.haptic(10);
        api.rerender();
      }));
      const lock = root.querySelector('[data-tt-lock]');
      if (lock) lock.addEventListener('click', () => { if (ttCalls.size) api.send({ calls: Object.fromEntries(ttCalls) }); });
    },
  });

  // ---------------------------------------------------------------- Odd Duck Out
  const outcomeText = (/** @type {{ outcome: string, imposter: string, impGained?: number }} */ r) => (/** @type {Record<string, string>} */ ({
    escaped: `${esc(r.imposter)} got away with it! +${r.impGained || 300}`,
    stole: `${esc(r.imposter)} was caught but guessed the word! +${r.impGained || 200}`,
    caught: `Caught! ${esc(r.imposter)} was the imposter.`,
  }))[r.outcome];
  // meter: show each suspect's suspicion bar (vote phase); clues pop in one by one.
  /** @param {any[]} clues clue rows from the server @param {boolean} [meter] @param {number} [total] */
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
          <ol class="answers">${g.options.map((/** @type {any} */ o) => `<li>${esc(o)}</li>`).join('')}</ol>`;
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
          g.clues.map((/** @type {any} */ c) => sendBtn({ target: c.id }, `${esc(c.nickname)} <span class="byline">“${esc(c.clue)}”</span>`)).join('') + '</div>';
      }
      if (s.phase === 'imp-guess') {
        if (!you.isImposter) return role + `<h1>${esc(g.imposter)} is guessing…</h1>`;
        return `${role}<h2>You were caught! Guess the word to steal points:</h2><div class="vote-list">` +
          g.options.map((/** @type {any} */ o, /** @type {any} */ i) => sendBtn({ choice: i }, esc(o))).join('') + '</div>';
      }
      return `<h1>${outcomeText(g.result)}</h1><p class="prompt">Word: ${esc(g.result.word)}</p>`;
    },
  });

  // ---------------------------------------------------------------- Cottage Crush
  /** @param {{ nickname: string, agenda: string }[]} list */
  const exposedHtml = (list) => (list && list.length
    ? `<p class="crush-exposed">🕵️ Exposed: ${list.map((x) => `${av(x.nickname)} ${esc(x.nickname)} is the <b>${esc(x.agenda)}</b>`).join(' · ')}</p>` : '');
  /** Cottage Crush phone: who the next note goes to (picked on a tile first, then the line). @type {string | null} */
  let crTo = null;
  let crKey = '';
  /** The night's three steps, with the current one lit. @param {number} at 0 notes, 1 replies, 2 dates, 3 reveal */
  const crSteps = (at) => `<ol class="crush-steps">${['💌 Notes', '✍️ Replies', '🌙 Dates'].map((t, i) => `<li class="${i === at ? 'on' : i < at ? 'done' : ''}">${t}</li>`).join('')}</ol>`;
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
      // Extras fold away (roomy screens): a wink for whoever is waiting, the inbox, the agenda.
      const wink = you.winked ? '<p class="hint">😉 Wink sent</p>'
        : `<details class="crush-fold"><summary>😉 Wink at someone <small>(free, anonymous)</small></summary><div class="crush-people small">${g.targets.map((/** @type {Target} */ t) => sendBtn({ wink: t.id }, `${av(t.nickname, 'avatar')}<span>${esc(t.nickname)}</span>`, 'crush-person')).join('')}</div></details>`;
      const winksIn = you.winksIn ? `<p class="crush-exposed">😉 Someone winked at you${you.winksIn > 1 ? ` (${you.winksIn}×)` : ''}!</p>` : '';
      const role = (you.agenda ? `<details class="crush-agenda"><summary>🎭 Secret agenda: <b>${esc(you.agenda.name)}</b></summary><p>${esc(you.agenda.desc)}</p>${s.phase === 'cr-reveal' ? '' : side}</details>` : '');
      /** @param {any[]} list @param {boolean} mine */
      const notes = (list, mine) => list.map((n) => `<li class="crush-note"><b>${mine ? '→ ' + esc(n.to) : esc(n.from)}:</b> ${esc(n.text)}${n.reply ? `<br><span class="byline">↩ ${esc(n.reply)}</span>` : ''}</li>`).join('');
      const key = `${g.evening}|${s.phase}`;
      if (key !== crKey) { crKey = key; crTo = null; }
      if (s.phase === 'cr-mingle') {
        const inbox = you.inbox.length ? `<details class="crush-fold" open><summary>💌 ${you.inbox.length} note${you.inbox.length === 1 ? '' : 's'} for you</summary><ul class="crush-list">${notes(you.inbox, false)}</ul></details>` : '';
        if (you.notesLeft <= 0) return crSteps(0) + role + waiting('Notes sent', 'Watch the TV for gossip…') + winksIn + inbox + wink;
        const to = crTo && g.targets.find((/** @type {Target} */ t) => t.id === crTo);
        if (!to) {
          return `${crSteps(0)}${role}<h2>💌 Who gets a note?</h2><p class="hint">${you.notesLeft} note${you.notesLeft === 1 ? '' : 's'} left · ${you.agenda && you.agenda.id === 'wallflower' ? "you're the Wallflower: they won't see your name" : 'they’ll see it’s from you'}</p>
            <div class="crush-people">${g.targets.map((/** @type {Target} */ t) => `<button type="button" class="crush-person" data-cr-to="${esc(t.id)}">${av(t.nickname, 'avatar big')}<span>${esc(t.nickname)}</span></button>`).join('')}</div>${winksIn}${inbox}`;
        }
        return `${crSteps(0)}<p class="crush-to-line">To ${av(to.nickname, 'avatar')} <b>${esc(to.nickname)}</b> <button type="button" class="ghost-btn" data-cr-to="">change</button></p>
          <h2>Pick a line</h2>
          <div class="vote-list">${you.cards.map((/** @type {string} */ c) => `<button type="button" class="vote-btn crush-card" data-text="${esc(c)}">${esc(c)}</button>`).join('')}</div>
          <form class="crush-form"><input name="text" maxlength="80" autocomplete="off" placeholder="…or write your own"><button type="submit">Send</button></form>`;
      }
      if (s.phase === 'cr-reply') {
        const open = you.inbox.filter((/** @type {any} */ n) => !n.reply);
        if (!open.length) return crSteps(1) + role + waiting(you.inbox.length ? 'All replied' : 'No notes tonight 😢', 'Waiting for the others…') + winksIn + (you.outbox.length ? `<details class="crush-fold"><summary>📤 Your sent notes</summary><ul class="crush-list">${notes(you.outbox, true)}</ul></details>` : '') + wink;
        const n = open[0];
        return `${crSteps(1)}<p class="hint">${open.length > 1 ? `${open.length} notes to answer` : 'Last one!'}</p><h2>${av(n.from, 'avatar')} ${esc(n.from)} wrote:</h2><p class="prompt">“${esc(n.text)}”</p><p>Reply:</p>
          <div class="vote-list crush-replies">${you.replyCards.map((/** @type {string} */ r) => sendBtn({ reply: n.id, text: r }, esc(r))).join('')}</div>`;
      }
      if (s.phase === 'cr-pick') {
        if (you.picked) return crSteps(2) + role + waiting('Date picked 🌙', 'If they picked you too, it\'s a date!');
        return `${crSteps(2)}${role}${winksIn}<h2>Who will you ask out tonight?</h2><p class="hint">It's a date only if they pick you too.</p><div class="crush-people">` +
          g.targets.map((/** @type {{ id: string, nickname: string }} */ t) => sendBtn({ pick: t.id }, `${av(t.nickname, 'avatar big')}<span>${esc(t.nickname)}</span>`, 'crush-person')).join('') +
          '</div><div class="vote-list">' + sendBtn({ pick: null }, '🛋 Stay in tonight') + '</div>';
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
      // Pick who the note is for (a tile), then the line.
      root.querySelectorAll('[data-cr-to]').forEach((b) => b.addEventListener('click', () => {
        crTo = /** @type {HTMLElement} */ (b).dataset.crTo || null;
        window.Rumpus.haptic(10);
        api.rerender();
      }));
      const sendNote = (/** @type {string} */ text) => { if (crTo) { api.send({ to: crTo, text }); crTo = null; } };
      root.querySelectorAll('.crush-card').forEach((b) => b.addEventListener('click', () => sendNote(/** @type {HTMLElement} */ (b).dataset.text || '')));
      const f = /** @type {HTMLFormElement | null} */ (root.querySelector('.crush-form'));
      if (f) f.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = /** @type {HTMLInputElement} */ (f.querySelector('input'));
        if (input.value.trim()) sendNote(input.value);
      });
    },
  });

  // ---------------------------------------------------------------- Loon Call (rhythm)
  /** @typedef {{ steps: number[], by: string | null, callAt: number, echoAt: number }} LcPhrase */
  /** @typedef {{ kind: string, name: string, bpm: number, root: number, startAt: number, barMs: number, countIn: number, endAt: number, clicks: number[], phrases: LcPhrase[], caller: string | null, steps: number, beats?: number, feel?: string }} LcSched */
  /** @type {LcSched | null} the schedule on screen (TV or phone) */
  let lcSched = null;
  let lcScheduledAt = 0;
  // A little melody for the lead loon: the pitch follows the step in the bar.
  const LC_PITCH = [1, 1.125, 1.25, 1.333, 1.5, 1.333, 1.25, 1.125];

  /** TV: cut off a booked song now. */
  function lcStopAudio() {
    const m = window.Rumpus.music;
    if (lcScheduledAt && m && m.rhythm) m.rhythm.stop();
    lcScheduledAt = 0;
  }
  /** TV: schedule every sound of a schedule on the Web Audio clock (sample-accurate). @param {LcSched} s */
  function lcScheduleAudio(s) {
    const m = window.Rumpus.music;
    if (!m || !m.rhythm || !m.rhythm.ready() || lcScheduledAt === s.startAt) return;
    lcScheduledAt = s.startAt;
    const r = m.rhythm;
    r.stop(); // a new schedule replaces whatever was still booked (a song cut short by Skip)
    const ctxNow = r.now(), srvNow = window.Rumpus.time.now();
    const at = (/** @type {number} */ ms) => ctxNow + (ms - srvNow) / 1000;
    const future = (/** @type {number} */ ms) => ms > srvNow + 20;
    const beats = s.beats || 4;
    s.clicks.forEach((c, i) => { if (future(c)) r.click(at(c), i % beats === 0); });
    if (!s.phrases.length) return;
    const step = s.barMs / s.steps;
    const perBeat = s.steps / beats; // 2 = 8ths, 3 = triplets (swing), 4 = 16ths
    s.phrases.forEach((p) => {
      for (const [bar, isCall] of /** @type {[number, boolean][]} */ ([[p.callAt, true], [p.echoAt, false]])) {
        for (let k = 0; k < s.steps; k++) {
          const t = bar + k * step;
          if (!future(t)) continue;
          const onBeat = k % perBeat === 0, beat = k / perBeat;
          // Kick on 1 (and 3 in 4/4), hats on every beat plus the grid's off-beats (swing: the third triplet).
          if (onBeat && (beat === 0 || (beats === 4 && beat === 2))) r.kick(at(t));
          if (onBeat || (perBeat === 3 ? k % 3 === 2 : perBeat === 4 ? k % 2 === 0 : true)) r.hat(at(t));
          if (k === 0) r.bass(at(t), s.root / 4);
          if (onBeat && beat === 2) r.bass(at(t), (s.root / 4) * 1.5);
        }
        if (isCall) for (const st of p.steps) { const t = bar + st * step; if (future(t)) r.call(at(t), s.root * LC_PITCH[Math.floor((st * 8) / s.steps) % 8]); }
      }
    });
  }

  /** Where are we in the schedule right now? @param {LcSched} s @param {number} t */
  function lcWhere(s, t) {
    const beats = s.beats || 4;
    const beatMs = s.barMs / beats;
    const first = s.startAt + s.countIn * s.barMs;
    if (!s.phrases.length) { // tune-up / caller's metronome: just the clicks
      const i = Math.floor((t - s.startAt) / beatMs);
      // A caller's metronome: the first bar counts in, the second is theirs to fill.
      const mode = t < s.startAt ? 'ready' : t >= s.endAt ? 'done' : s.kind === 'call' && i < beats ? 'count' : 'clicks';
      return { mode, beat: i, bar: Math.floor(i / beats), callNote: false, step: -1, phrase: -1 };
    }
    if (t < first) return { mode: 'count', beat: Math.floor((t - s.startAt) / beatMs), bar: -1, callNote: false, step: -1, phrase: -1 };
    const k = Math.floor((t - first) / s.barMs);
    if (k >= s.phrases.length * 2) return { mode: 'done', beat: 0, bar: k, callNote: false, step: -1, phrase: -1 };
    const p = s.phrases[Math.floor(k / 2)];
    const inBar = (t - first) % s.barMs;
    const callNote = k % 2 === 0 && p.steps.some((st) => { const d = inBar - (st * s.barMs) / s.steps; return d >= 0 && d < 140; });
    return { mode: k % 2 === 0 ? 'call' : 'echo', beat: Math.floor(inBar / beatMs), bar: k, callNote, step: Math.floor((inBar * s.steps) / s.barMs), phrase: Math.floor(k / 2) };
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
    const nb = s.beats || 4;
    const dots = (/** @type {number} */ b) => Array.from({ length: nb }, (_, i) => (i === ((b % nb) + nb) % nb ? '●' : '○')).join(' ');
    const label = w.mode === 'call' ? `🐦 ${s.caller ? esc(s.caller) : 'CALL'}` : w.mode === 'echo' ? '🎵 ECHO!' : w.mode === 'count' ? `${nb - (((w.beat % nb) + nb) % nb)}…` : w.mode === 'clicks' ? '🥁 TAP!' : w.mode === 'ready' ? 'GET READY' : '';
    // The rhythm lane: the bar's grid; the call's notes light up as the loon sings them, so a tricky
    // rhythm (swing, 16ths) can be seen as well as heard. During the echo only the playhead moves.
    const p = w.phrase >= 0 ? s.phrases[w.phrase] : null;
    const lane = p && (w.mode === 'call' || w.mode === 'echo') ? `<span class="lc-lane" style="--n:${s.steps}">${Array.from({ length: s.steps }, (_, k) => {
      const note = p.steps.includes(k);
      const cls = [k === w.step ? 'now' : '', note && w.mode === 'call' && k <= w.step ? 'note' : '', k % (s.steps / nb) === 0 ? 'beat' : ''].filter(Boolean).join(' ');
      return `<i class="${cls}"></i>`;
    }).join('')}</span>` : '';
    meters.forEach((el) => {
      const modeCls = w.mode === 'echo' ? 'lc-echo' : w.mode === 'clicks' ? 'lc-clicks' : '';
      const html = `<span class="lc-mode ${modeCls}">${label}</span><span class="lc-dots">${w.mode === 'done' || w.mode === 'ready' ? '' : dots(w.beat)}</span>${lane}`;
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
  const lcStageTag = (g) => `<p class="round-tag">${g.sched ? esc(g.sched.name) : 'Loon Call'}${g.sched && g.sched.feel ? ` · <i>${esc(g.sched.feel)}</i>` : ''} · Song ${Math.max(1, g.round)} of ${g.totalRounds}${g.multiplier > 1 ? `<span class="double-badge">${g.multiplier}× POINTS</span>` : ''}</p>`;
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
      // Off the song screens (result, game over, Skip/"end the round" mid-song): silence the song.
      if (!['lc-tune', 'lc-song', 'lc-compose'].includes(s.phase)) lcStopAudio();
      else if (lcSched) lcScheduleAudio(lcSched);
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
      return `<p class="hint">${sub}</p><button class="mg-big lc-tap" data-live data-lc-label="" aria-label="Tap on the beat">TAP!</button><p class="lc-fb" aria-live="off"></p>`;
    },
    bind(root, api) {
      const btn = /** @type {HTMLElement | null} */ (root.querySelector('.lc-tap'));
      if (!btn) return;
      const calib = Number((api.state.you || {}).calib) || 0;
      const fb = /** @type {HTMLElement | null} */ (root.querySelector('.lc-fb'));
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const t = window.Rumpus.time.now();
        api.send({ tap: t });
        // Instant feedback on the phone itself (no round trip): judge against the nearest note of
        // the echo bar we're in, with this phone's measured delay — and a buzz you can feel.
        const s = lcSched;
        let kind = 'tap', label = '';
        if (s && s.phrases.length) {
          const ct = t - calib;
          const notes = s.phrases.flatMap((p) => p.steps.map((st) => p.echoAt + (st * s.barMs) / s.steps));
          const near = notes.reduce((a, b) => (Math.abs(b - ct) < Math.abs(a - ct) ? b : a), Infinity);
          const d = ct - near;
          kind = Math.abs(d) <= 70 ? 'perfect' : Math.abs(d) <= 140 ? 'good' : Math.abs(d) <= 220 ? 'miss' : 'extra';
          label = kind === 'perfect' ? 'PERFECT!' : kind === 'good' ? (d > 0 ? 'A bit late' : 'A bit early') : kind === 'miss' ? (d > 0 ? 'Too late' : 'Too early') : 'Oops — no note';
        }
        window.Rumpus.haptic(kind === 'perfect' ? 30 : kind === 'good' ? 18 : kind === 'tap' ? 12 : [10, 50, 10]);
        window.Rumpus.sfx.tick();
        btn.dataset.hit = kind;
        btn.classList.remove('hit'); void btn.offsetWidth; btn.classList.add('hit');
        if (fb) { fb.textContent = label; fb.dataset.hit = kind; fb.classList.remove('pop'); void fb.offsetWidth; fb.classList.add('pop'); }
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
    // Shrinking Pad: a giant lily pad with a notch.
    if (f.pad) {
      const [px, py, pr] = f.pad;
      for (let k = -pr; k <= pr; k += 1) {
        const w = Math.sqrt(Math.max(0, pr * pr - k * k)) * 2;
        R(px - w / 2, py + k, w, 1, (Math.round(k / 3) % 2) ? '#3f7d3a' : '#4a8f43');
      }
      R(px, py - pr, pr * 0.2, pr, '#17325a'); // the notch
    }
    // Duckling Herding: the nest in the middle, ducklings paddling.
    if (f.nest) {
      const [nx, ny, nr] = f.nest;
      for (let k = -nr; k <= nr; k += 2) { const w = Math.sqrt(Math.max(0, nr * nr - k * k)) * 2; R(nx - w / 2, ny + k, w, 2, k % 4 ? '#8a6a3b' : '#a07c46'); }
      R(nx - nr / 2, ny - 1, nr, 2, '#c9a15e');
    }
    for (const d of f.ducks || []) {
      const [x, y] = d; const bob = Math.round(Math.sin((tick + x) / 6));
      R(x - 3, y - 1 + bob, 6, 4, '#ffd23f'); R(x + 1, y - 4 + bob, 3, 3, '#ffd23f'); R(x + 4, y - 3 + bob, 2, 1, '#ff8a3d'); R(x + 2, y - 3 + bob, 1, 1, '#1a1423');
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
      if (f.out && f.out[i]) { const [x, y] = b; R(x - 6, y, 12, 1, 'rgba(200,230,255,0.4)'); return; } // splashed off the pad
      const [x, y] = b; const c = LL_COLOURS[i % LL_COLOURS.length]; const bob = Math.round(Math.sin((tick + i * 9) / 7));
      if (f.it === i) { const p = 13 + (tick % 10 < 5 ? 1 : 0); for (let k = 0; k < 16; k++) R(x + Math.cos(k * 0.39) * p, y + Math.sin(k * 0.39) * p, 2, 2, '#ff5e5e'); }
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
  /** @type {{ mode: 'touch' | 'tilt', zero: number[] | null, vec: number[], sentAt: number, sent: string, https: string[] | null, trail: number, n: number }} */
  const llCtl = { mode: 'touch', zero: null, vec: [0, 0], sentAt: 0, sent: '', https: null, trail: 0, n: 0 };
  /** Send the current vector: at most 15×/s while it changes, and again every 200 ms while it
   * doesn't. Steering goes on the fast channel, where a packet may be lost — the repeat means a lost
   * one (even the last "stop") is put right within 200 ms. `n` rises with every send so the server
   * can ignore one that arrives late, out of order. @param {(p: any) => void} send */
  function llSend(send) {
    const now = Date.now();
    const key = llCtl.vec.map((v) => v.toFixed(2)).join();
    if (key === llCtl.sent && now - llCtl.sentAt < 200) return;
    // Throttled to 15/s; a trailing send makes sure the last position goes out.
    if (now - llCtl.sentAt < 66) { clearTimeout(llCtl.trail); llCtl.trail = window.setTimeout(() => llSend(send), 70); return; }
    llCtl.sent = key; llCtl.sentAt = now;
    llCtl.n = Math.max(llCtl.n + 1, now);
    send({ tilt: llCtl.vec, n: llCtl.n });
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
      if (s.phase === 'll-result' && g.result && g.result.rows[0]) {
        const top = g.result.top || [g.result.rows[0].nickname];
        return g.result.haul !== null ? `The raft caught ${g.result.haul} lanterns!` : top.length ? `${top.join(' and ')} ${top.length > 1 ? 'glide' : 'glides'} to the top!` : null;
      }
      return null;
    },
    host(s) {
      const g = s.gameState;
      llNames = (g.boats || []).map((/** @type {{ nickname: string }} */ b) => b.nickname);
      const tag = `<p class="round-tag">Scene ${g.round} of ${g.totalRounds}${g.multiplier > 1 ? `<span class="double-badge">${g.multiplier}× POINTS</span>` : ''}</p>`;
      if (s.phase === 'll-result') {
        const r = g.result;
        return `${tag}<h1>${esc(r.name)}</h1>${r.haul !== null ? `<p class="big-sub">🏮 The raft caught ${r.haul} lantern${r.haul === 1 ? '' : 's'}!</p>` : ''}
          <ol class="answers">${r.rows.map((/** @type {any} */ x, /** @type {number} */ i) => `<li class="${(r.top || []).includes(x.nickname) ? 'winner' : ''}">${av(x.nickname)} ${esc(x.nickname)} <span class="votes">+${x.gained}</span></li>`).join('')}</ol>`;
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
      const status = you.out ? '<p class="ll-status out">💦 SPLASH! You fell off the pad — cheer the others on</p>'
        : you.it ? '<p class="ll-status it">🔴 You\'re IT! Bump someone to pass it on</p>' : '';
      return `<p class="round-tag">${esc(g.sceneName)}</p>${status}
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
      const steer = api.sendFast || api.send;
      const again = setInterval(() => llSend(steer), 100); // the 200 ms repeat (see llSend)
      api.onCleanup(() => clearInterval(again));
      /** @param {PointerEvent} e */
      const fromPointer = (e) => {
        const r = pad.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
        const m = Math.hypot(x, y);
        llCtl.mode = 'touch';
        llCtl.vec = m > 1 ? [x / m, y / m] : [x, y];
        show(); llSend(steer);
      };
      pad.addEventListener('pointerdown', (e) => { e.preventDefault(); pad.setPointerCapture(e.pointerId); fromPointer(e); });
      pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') fromPointer(e); });
      const stop = () => { if (llCtl.mode === 'touch') { llCtl.vec = [0, 0]; show(); llCtl.sentAt = 0; llSend(steer); } };
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
        show(); llSend(steer);
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
          <div class="storm-cards">${r.cards.map((/** @type {string} */ c, /** @type {number} */ i) => `<div class="storm-card ${c === 'help' ? 'good' : 'bad'}" style="animation-delay:${(i * g.cardMs) / 1000}s">${c === 'double' ? '🦝🦝 DOUBLE TROUBLE' : c === 'sabotage' ? '🦝 SABOTAGE' : '🔨 HELP'}</div>`).join('')}</div>
          <p class="big-sub storm-result" style="animation-delay:${(r.cards.length * g.cardMs) / 1000}s">${r.ok ? '✔ Done!' : '✘ Ruined!'}${r.fixed ? ' (the Handyman fixed one sabotage)' : ''}${r.needed > 1 ? ' — a Big Chore needs two sabotages' : ''}</p>
          ${g.winReason ? `<p class="prompt storm-result" style="animation-delay:${(r.cards.length * g.cardMs) / 1000}s">${esc(g.winReason)}</p>` : ''}`;
      } else if (s.phase === 'st-accuse') mid = `<h1>${g.winner === 'cottage' ? '🏡 The cottagers win… for now!' : '🦝 The raccoons win!'}</h1><p class="big-sub">${esc(g.winReason || '')}${g.hunt ? ' — but the raccoons get one last chance: unmask the Lookout and they steal it!' : ''}</p>
          <p class="prompt">Before the roles flip: who was a raccoon? Accuse on your phone. ${T}</p>${count(g.accusedCount, g.totalPlayers, 'accused')}`;
      else if (s.phase === 'st-final') mid = `<h1>${g.winner === 'cottage' ? '🏡 The cottagers win!' : '🦝 The raccoons win!'}</h1>
          <div class="storm-roles">${(g.roles || []).map((/** @type {any} */ x, /** @type {number} */ i) => `<div class="storm-role ${x.side}" style="animation-delay:${i * 0.4}s">${av(x.nickname, 'avatar big')}<b>${esc(x.nickname)}</b><span>${esc(x.role)}</span><span class="votes">+${x.gained}</span>${x.hunch ? `<small class="storm-hunch">🤔 ${esc(x.hunch)} ${x.hunchRight ? '✔' : '✘'}</small>` : ''}</div>`).join('')}</div>`;
      return `${rain}<div class="storm-board">${board}<div class="storm-mid">${mid}</div></div>`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      const allies = you.allies && you.allies.length ? `<p>🦝 Your fellow raccoons: <b>${you.allies.map(esc).join(', ')}</b></p>` : '';
      const spotted = (you.sighting || []).length ? `<p>👀 You saw <b>${you.sighting.map(esc).join('</b> and <b>')}</b> sneaking around the bins — one of them is a raccoon.</p>` : '';
      const card = `<button type="button" class="storm-rolecard ${you.role.side}" data-hold>
          <span class="storm-cover">🃏 Press and hold to see your role</span>
          <span class="storm-secret"><b>${esc(you.role.name)}</b>${you.role.side === 'raccoon' ? ' 🦝' : ' 🏡'}<small>${esc(you.role.desc)}</small>${allies}${spotted}</span></button>`;
      const peek = you.peek ? `<p class="storm-peek">${esc(you.peek)}</p>` : '';
      const snoop = you.canSnoop && you.canSnoop.length ? `<div class="crush-side"><b>🔍 Snoop on one crew card (once per game)</b><div class="crush-pair">${you.canSnoop.map((/** @type {{ id: string, nickname: string }} */ t) => sendBtn({ snoop: t.id }, esc(t.nickname))).join('')}</div></div>` : '';
      if (s.phase === 'st-roles') return card + (you.ready ? waiting('Ready') : `<div class="vote-list">${sendBtn({ ready: true }, "I've seen my role")}</div>`);
      if (s.phase === 'st-talk') {
        // Private hunch (shown to nobody until the end): something to do while the leader decides.
        const hunch = (you.hunchTargets || []).length ? `<div class="crush-side"><b>🤔 Your secret hunch: who's a raccoon?</b><div class="crush-pair">${you.hunchTargets.map((/** @type {{ id: string, nickname: string }} */ t) => `<button type="button" class="vote-btn" data-send='${esc(JSON.stringify({ hunch: t.id }))}' aria-pressed="${you.hunch === t.id}">${esc(t.nickname)}</button>`).join('')}</div></div>` : '';
        if (!you.isLeader) return `<h2>🏮 ${esc(g.leader)} is picking ${g.crewSize} for the crew</h2><p>Talk it over!</p>${hunch}${peek}${snoop}${card}`;
        const key = `${g.choreIndex}|${g.leader}|${g.crewSize}`;
        if (key !== stPickKey) { stPick.clear(); stPickKey = key; }
        // Someone picked may have left (or can't go, Bear Sighting): drop them, or Send could never work.
        for (const id of [...stPick]) if (!you.candidates.some((/** @type {{ id: string }} */ c) => c.id === id)) stPick.delete(id);
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
        const dbl = you.canDouble ? '<label class="toggle"><input type="checkbox" id="st-double"> 🦝🦝 Double Trouble (once per game: your sabotage counts twice and can\'t be fixed)</label>' : '';
        return `<h2>You're on the crew</h2>${fix}${dbl}<div class="vote-list storm-yesno">
            <button type="button" class="vote-btn" data-st-card="help">🔨 Help</button>
            ${you.canSabotage ? '<button type="button" class="vote-btn bad" data-st-card="sabotage">🦝 Sabotage</button>' : ''}</div>${card}`;
      }
      // The result only arrives once the TV's cards have all flipped (no spoilers on the phone).
      if (s.phase === 'st-reveal') return watchTv(`<p>${g.reveal ? (g.reveal.ok ? '✔ The chore is done!' : '✘ The chore was ruined!') : 'Watch the cards flip…'}</p>`) + peek + snoop;
      if (s.phase === 'st-accuse' && you.hunting) return you.accused ? waiting('Guess in', 'Did you find the Lookout?') : `<h2>🦝 Last chance!</h2><p>The cottage won — but if you raccoons can name the <b>Lookout</b>, you steal the win.</p><div class="vote-list">${you.accuseTargets.map((/** @type {{ id: string, nickname: string }} */ t) => sendBtn({ accuse: t.id }, `${av(t.nickname)} ${esc(t.nickname)}`)).join('')}</div>`;
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
        const dbl = /** @type {HTMLInputElement | null} */ (root.querySelector('#st-double'));
        api.send({ card: /** @type {HTMLElement} */ (b).dataset.stCard, fix: !!(fix && fix.checked), double: !!(dbl && dbl.checked) });
      }));
    },
    /** @param {any} s */
    moment(s) {
      const g = s.gameState;
      if (s.phase === 'st-reveal' && g.reveal) return g.reveal.ok ? null : { shakeAt: g.reveal.cards.length * g.cardMs };
      if (s.phase === 'st-final' && g.winner === 'cottage') return { confettiAt: 500 };
      return null;
    },
    /** The narrator tells the story of the storm. @param {any} s */
    narrate(s) {
      const g = s.gameState;
      if (s.phase === 'st-roles') return 'A storm is rolling in over the lake. Check your secret role — and trust no one.';
      if (s.phase === 'st-talk') return `${g.choreNames[g.choreIndex]}. ${g.event.name}: ${g.event.desc} ${g.leader}, choose ${g.crewSize} for your crew.`;
      if (s.phase === 'st-votes') return g.votes && g.votes.approved ? 'The crew heads out into the wind.' : g.storm >= 3 ? 'Too much arguing. The storm is here.' : 'Voted down! The storm creeps closer.';
      // Said as the cards start to flip, so it mustn't give the result away (the TV shows it at the end).
      if (s.phase === 'st-reveal') return g.reveal ? 'The crew is back. Let\'s see the cards…' : null;
      if (s.phase === 'st-accuse') return g.winner === 'cottage' ? 'The cottage is ready. But the raccoons are hunting for the Lookout…' : 'The raccoons win! Now — who were they?';
      if (s.phase === 'st-final') return 'The masks come off.';
      return null;
    },
  });

  // ---------------------------------------------------------------- Game night
  /** @typedef {{ total: number, played: number, standings: { nickname: string, points: number }[] }} NightView */
  /** Running game-night leaderboard. @param {NightView} night @param {boolean} [between] */
  const nightTable = (night, between = false) => `<div class="night-table">
      <p class="round-tag">🎞 Lineup · ${night.played} of ${night.total} played${between && night.played < night.total ? ' · next game coming up…' : ''}</p>
      <ol class="answers standings">${night.standings.map((/** @type {{ nickname: string, points: number }} */ s) => `<li>${av(s.nickname)} ${esc(s.nickname)} <span class="votes">${s.points} pts</span></li>`).join('')}</ol>
    </div>`;
  window.Rumpus.nightTable = nightTable;
  /** The lineup as a row of small cartridges: played ✓, the next one lit, then the rest. @param {any} night */
  const lineupRow = (night) => `<div class="lineup-row">${(night.list || []).map((/** @type {{ id: string, name: string }} */ x, /** @type {number} */ i) =>
    window.Rumpus.cartHtml(x.id, x.name, `mini ${i < night.played ? 'done' : i === night.played ? 'now' : ''}`)).join('')}</div>`;
  register('night', {
    host(s) {
      const g = s.gameState, night = s.night || { played: 0, total: 0, standings: [], list: [] };
      if (s.phase === 'night-final') {
        const top = night.standings[0];
        return `<h1>🏆 Champion of the lineup</h1>
          ${top ? `<p class="big-answer">${av(top.nickname, 'avatar big bob')} ${esc(top.nickname)} — ${top.points} pts</p>` : ''}
          ${nightTable(night)}<p class="big-sub">Press End to go back to the menu.</p>`;
      }
      // Between games: the next cartridge comes to the middle of the screen.
      const top3 = night.standings.slice(0, 3).filter((/** @type {{ points: number }} */ x) => x.points > 0);
      return `<div class="next-screen">
        <p class="round-tag lineup-tag">🎞 Lineup · game ${night.played + 1} of ${night.total}</p>
        <div class="next-up"><p class="next-label">▶ NEXT GAME</p>${g.next ? window.Rumpus.cartHtml(g.next.id, g.next.name, 'big') : ''}
          <p class="next-name">${esc(g.next ? g.next.name : '')}</p></div>
        ${lineupRow(night)}
        ${top3.length ? `<p class="big-sub lineup-leaders">🏆 ${top3.map((/** @type {{ nickname: string, points: number }} */ x) => `${esc(x.nickname)} ${x.points}`).join(' · ')}</p>` : ''}
      </div>`;
    },
    player(s) {
      const g = s.gameState, you = s.you, night = s.night || { standings: [] };
      if (s.phase === 'night-final') {
        const rank = night.standings.findIndex((/** @type {{ nickname: string }} */ x) => x.nickname === you.nickname);
        return `<h1>${rank === 0 ? '🏆 You are the champion!' : `You finished #${rank + 1}`}</h1><p>${(night.standings[rank] || {}).points || 0} lineup points</p>`;
      }
      return watchTv(`<p>Next game: <strong>${esc(g.next ? g.next.name : '')}</strong></p>`);
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
          <div class="chain">${g.chain.entries.map((/** @type {any} */ e, /** @type {any} */ i) => entryHtml(e, i, g.entryMs)).join('')}</div>
          ${g.favOpen ? `<p class="big-sub">Tap your favourite step on your phone! ❤ +50 ${T}</p>${count(g.favCount, g.favNeeded, 'picked')}` : ''}`;
      }
      if (s.phase === 'tel-vote') {
        return `<h1>Vote for the best doodle!</h1><p class="big-sub">${T}</p>
          <div class="doodle-grid">${g.drawings.map((/** @type {any} */ d, /** @type {any} */ i) =>
            `<figure><img src="${d.image}" alt=""><figcaption>${i + 1}</figcaption></figure>`).join('')}</div>
          ${count(g.votedCount, g.totalPlayers, 'votes in')}`;
      }
      const msg = /** @type {Record<string, string>} */ ({
        write: 'Write a silly phrase for someone else to draw!',
        draw: 'Draw what your phone says!',
        describe: 'Describe the drawing on your phone!',
      })[g.stepType];
      const verb = /** @type {Record<string, string>} */ ({ write: 'writing', draw: 'drawing', describe: 'guessing' })[g.stepType];
      // Doodles from people who are done float across the screen (keyed, so morph keeps them moving).
      const sea = (g.scribbles || []).length ? `<div class="scribble-sea" aria-hidden="true">${g.scribbles.map((/** @type {any} */ d) =>
        `<figure class="scribble" data-key="${d.key}" style="top:${8 + (d.key * 37) % 70}%"><img src="${d.image}" alt=""><figcaption>${esc(d.by)}</figcaption></figure>`).join('')}</div>` : '';
      return `${roundTag(g, 'Step')}<h1>${msg}</h1><p class="big-sub">${T}</p>
        ${count(g.submittedCount, g.totalPlayers, 'done')}
        ${waitingRow(g.waitingOn, verb)}${sea}`;
    },
    player(s) {
      const g = s.gameState, you = s.you;
      if (s.phase === 'tel-reveal') {
        if (!g.favOpen) return watchTv('<p>The chains are being revealed…</p>');
        if (you.fav != null) return waiting('Favourite picked ❤');
        if (!you.canFav) return watchTv('<p>Everyone else is picking a favourite step…</p>');
        return `<h2>Favourite step? ❤</h2><div class="fav-pick">` + g.entries.map((/** @type {any} */ e, /** @type {any} */ i) => e.ok
          ? sendBtn({ fav: i }, e.type === 'drawing' ? `<img src="${e.content}" alt="drawing by ${esc(e.by)}">` : `“${esc(e.content)}”`, 'vote-btn fav-btn')
          : '').join('') + '</div>';
      }
      if (s.phase === 'tel-vote') {
        if (you.voted) return waiting('Vote cast');
        if (!g.drawings.length) return '<h1>Nothing to vote on</h1>';
        return `<h2>Best doodle?</h2><div class="doodle-pick">` +
          g.drawings.map((/** @type {any} */ d) => sendBtn({ key: d.key }, `<img src="${d.image}" alt="">`, 'doodle-btn')).join('') + '</div>';
      }
      if (you.submitted) {
        // Scribble pad while the others finish: up to 3 doodles a step float across the TV.
        if (!you.scribblesLeft || g.stepType === 'spectate') return waiting('Passed it on');
        return `${waiting('Passed it on')}<p class="hint">While you wait: doodle something and float it across the TV 🍾 (${you.scribblesLeft} left)</p>
          <div id="scribble-pad"></div><button id="scribble-send" class="wide">Float it 🍾</button>`;
      }
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
      const scribbleEl = root.querySelector('#scribble-pad');
      if (scribbleEl) {
        const sp = window.Rumpus.drawPad(scribbleEl);
        const sendBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#scribble-send'));
        sendBtn.addEventListener('click', () => { if (sp.isEmpty() || sendBtn.disabled) return; sendBtn.disabled = true; api.send({ scribble: sp.toDataURL() }); });
      }
      const padEl = root.querySelector('#pad');
      const endsAt = api.state.gameState.endsAt;
      let autoFn = null;
      if (padEl) {
        const pad = window.Rumpus.drawPad(padEl);
        const submit = () => api.send({ image: pad.toDataURL() });
        /** @type {HTMLElement} */ (root.querySelector('#draw-done')).addEventListener('click', () => {
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
        const t = setTimeout(autoFn, Math.max(0, endsAt - window.Rumpus.time.now() - 300));
        api.onCleanup(() => clearTimeout(t));
      }
    },
  });
})();
