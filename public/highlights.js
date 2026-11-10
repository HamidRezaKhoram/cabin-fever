/* Highlights page: tonight's best lines and doodles, all-time gallery, hall of fame
 * with achievements. Data from /api/highlights (games/stats.js). AGPLv3, see LICENSE. */
'use strict';

(function () {
  const { esc } = window.Rumpus;
  const body = /** @type {HTMLElement} */ (document.getElementById('hl-body'));
  const room = new URLSearchParams(location.search).get('room') || '';
  let tab = room ? 'tonight' : 'alltime';
  /** @type {{ tonight: any[], allTime: any[], players: any[] } | null} */
  let data = null;

  /** @param {any} h */
  const card = (h) => `<article class="hl-card">
      <p class="round-tag">${esc(h.game)}${h.note ? ' · ' + esc(h.note) : ''}</p>
      ${h.prompt ? `<p class="hl-prompt">${esc(h.prompt)}</p>` : ''}
      ${h.image ? `<img class="hl-img" src="${h.image}" alt="drawing by ${esc(h.by)}">` : ''}
      ${h.text ? `<p class="hl-text">“${esc(h.text)}”</p>` : ''}
      <p class="byline">— ${esc(h.by)}</p>
    </article>`;
  /** @param {any} p */
  const fame = (p, /** @type {number} */ i) => `<article class="hl-card fame">
      <h2>${i + 1}. ${esc(p.name)}</h2>
      <p>${p.wins} win${p.wins === 1 ? '' : 's'} · ${p.games} games · ${p.points.toLocaleString()} points${p.nightWins ? ` · 👑 ${p.nightWins} game night${p.nightWins === 1 ? '' : 's'}` : ''}</p>
      <p class="hl-badges">${p.achievements.map((/** @type {any} */ a) => `<span class="badge" title="${esc(a.desc)}">${a.icon} ${esc(a.title)}</span>`).join('') || '<span class="hint">No achievements yet</span>'}</p>
    </article>`;

  function render() {
    document.querySelectorAll('.hl-tabs button').forEach((b) => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.tab === tab));
    if (!data) return;
    const list = tab === 'tonight' ? data.tonight : tab === 'alltime' ? data.allTime : null;
    if (list) body.innerHTML = list.length ? list.map(card).join('') : '<p class="hint">Nothing yet — play a few rounds!</p>';
    else body.innerHTML = data.players.length ? data.players.map(fame).join('') : '<p class="hint">No games recorded yet.</p>';
  }
  /** @type {HTMLElement} */ (document.querySelector('.hl-tabs')).addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('[data-tab]') : null);
    if (b && b.dataset.tab) { tab = b.dataset.tab; render(); }
  });
  fetch('/api/highlights?room=' + encodeURIComponent(room)).then((r) => r.json()).then((d) => { data = d; render(); })
    .catch(() => { body.innerHTML = '<p class="error">Could not load highlights.</p>'; });
})();
