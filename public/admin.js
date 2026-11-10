/* /admin: house rules (timers per game, 18+ share, banned words) and a content
 * editor (search, disable, add your own prompts). AGPLv3, see LICENSE. */
'use strict';

(function () {
  const { esc } = window.Rumpus;
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const input = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
  /** @type {any} */
  let rules = null;
  let page = 0;

  /** @param {string} url @param {any} [body] @param {string} [method] */
  async function api(url, body, method) {
    const r = await fetch(url, body === undefined && !method ? undefined : { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  }

  // ---- house rules
  async function loadRules() {
    const d = await api('/api/admin/rules');
    rules = d.rules;
    $('timers').innerHTML = d.games.map((/** @type {{id: string, name: string}} */ g) => `<label>${esc(g.name)}
      <select data-timer="${g.id}">${[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((n) => `<option value="${n}" ${(rules.timers[g.id] || 1) === n ? 'selected' : ''}>${n}×</option>`).join('')}</select></label>`).join('');
    input('spicy').value = String(Math.round(rules.spicyShare * 100));
    $('spicy-val').textContent = input('spicy').value + '%';
    /** @type {HTMLTextAreaElement} */ ($('banned')).value = rules.banned.join(', ');
    /** @type {HTMLSelectElement} */ ($('pool')).innerHTML = d.pools.map((/** @type {string} */ p) => `<option>${esc(p)}</option>`).join('');
    renderForm();
    await loadItems(true);
  }
  input('spicy').addEventListener('input', () => { $('spicy-val').textContent = input('spicy').value + '%'; });
  $('save-rules').addEventListener('click', async () => {
    /** @type {Record<string, number>} */
    const timers = {};
    document.querySelectorAll('[data-timer]').forEach((el) => { timers[/** @type {HTMLElement} */ (el).dataset.timer || ''] = Number(/** @type {HTMLSelectElement} */ (el).value); });
    const banned = /** @type {HTMLTextAreaElement} */ ($('banned')).value.split(',').map((w) => w.trim()).filter(Boolean);
    try {
      rules = (await api('/api/admin/rules', { timers, spicyShare: Number(input('spicy').value) / 100, banned })).rules;
      $('rules-msg').textContent = 'Saved ✓ — applies to the next question.';
    } catch (e) { $('rules-msg').textContent = String(e); }
  });

  // ---- content
  const pool = () => /** @type {HTMLSelectElement} */ ($('pool')).value;
  /** @param {boolean} reset */
  async function loadItems(reset) {
    if (reset) { page = 0; $('items').innerHTML = ''; }
    const d = await api(`/api/admin/content/${encodeURIComponent(pool())}?q=${encodeURIComponent(input('search').value)}&page=${page}`);
    $('count').textContent = `${d.total} items`;
    $('items').insertAdjacentHTML('beforeend', d.items.map((/** @type {any} */ x) => `<li class="${x.disabled ? 'off' : ''}">
      <span>${x.a ? '🌶 ' : ''}${esc(x.text)}${x.custom ? ' <b>(yours)</b>' : ''}</span>
      ${x.custom ? `<button data-del="${x.id}">Delete</button>` : `<button data-off="${x.id}" data-now="${x.disabled ? 1 : 0}">${x.disabled ? 'Enable' : 'Disable'}</button>`}</li>`).join(''));
    $('more').hidden = (page + 1) * 50 >= d.total;
  }
  $('more').addEventListener('click', () => { page++; void loadItems(false); });
  let searchTimer = 0;
  input('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { void loadItems(true); }, 250); });
  $('pool').addEventListener('change', () => { renderForm(); void loadItems(true); });
  $('items').addEventListener('click', async (e) => {
    const b = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('button') : null);
    if (!b) return;
    if (b.dataset.off) {
      const off = b.dataset.now !== '1';
      await api(`/api/admin/content/${encodeURIComponent(pool())}/${b.dataset.off}/disabled`, { disabled: off });
      b.dataset.now = off ? '1' : '0'; b.textContent = off ? 'Enable' : 'Disable';
      b.closest('li')?.classList.toggle('off', off);
    } else if (b.dataset.del) {
      await api(`/api/admin/content/${encodeURIComponent(pool())}/${b.dataset.del}`, {}, 'DELETE');
      b.closest('li')?.remove();
    }
  });

  /** Form fields per pool type. */
  const FORMS = /** @type {Record<string, string>} */ ({
    trivia: '<input name="q" placeholder="Question" required><input name="answer" placeholder="Right answer" required><input name="w1" placeholder="Wrong answer 1" required><input name="w2" placeholder="Wrong answer 2" required><input name="w3" placeholder="Wrong answer 3" required><input name="cat" placeholder="Category (optional)">',
    fibbage: '<input name="q" placeholder="Fact with a blank: The tallest … is ____." required><input name="answer" placeholder="Real answer" required>',
    closest: '<input name="q" placeholder="How many …?" required><input name="answer" placeholder="Number" inputmode="decimal" required><input name="unit" placeholder="Unit (optional)">',
    imposter: '<input name="category" placeholder="Category" required><input name="words" placeholder="Words, comma-separated (4+)" required>',
  });
  function renderForm() {
    const p = pool();
    /** @type {HTMLFormElement} */ ($('add-form')).innerHTML = (FORMS[p] || `<input name="text" placeholder="${p === 'cah-black' ? 'Prompt card with ____' : 'Prompt text'}" required>`) +
      '<label class="toggle"><input type="checkbox" name="a"> 🌶 18+</label><button type="submit">Add</button>';
  }
  $('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(/** @type {HTMLFormElement} */ ($('add-form')));
    /** @type {Record<string, any>} */
    const body = Object.fromEntries(f.entries());
    body.a = f.has('a');
    if (pool() === 'trivia') body.wrong = [body.w1, body.w2, body.w3];
    try {
      await api(`/api/admin/content/${encodeURIComponent(pool())}`, body);
      $('add-msg').textContent = 'Added ✓';
      /** @type {HTMLFormElement} */ ($('add-form')).reset();
      await loadItems(true);
    } catch (err) { $('add-msg').textContent = String(err); }
  });

  loadRules().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<p class="error">${esc(String(e))}</p>`); });
})();
