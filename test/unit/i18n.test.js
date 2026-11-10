// Français: room language setting, French content pack, UI dictionary coverage.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startServer, until, makeHost, makePlayer, tmpDir } = require('../helpers');

const ROOT = path.join(__dirname, '../..');
const pool = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'games/data/pools', n + '.json'), 'utf8'));

test('French content pack: prompt games have original French items (family + 18+)', () => {
  for (const n of ['punchline', 'mostlikely', 'majority', 'telephone']) {
    const fr = pool(n).filter((x) => x.lang === 'fr');
    assert.ok(fr.length >= 30, `${n}: ${fr.length} French items`);
    assert.ok(fr.some((x) => x.a) && fr.some((x) => !x.a), `${n}: French 18+ and family items`);
  }
  assert.ok(pool('mostlikely').filter((x) => x.lang === 'fr').every((x) => /^Qui est le plus susceptible/.test(x.text)));
});

test('a French room draws French prompts; an English room never does', async () => {
  const srv = await startServer({ RUMPUS_DATA_DIR: tmpDir() });
  try {
    for (const lang of ['fr', 'en']) {
      const h = await makeHost(srv);
      for (const n of ['Ann', 'Ben', 'Cat']) await makePlayer(srv, h.code, n);
      await until(() => h.state.players.length === 3, 'joined');
      h.emit('host:settings', { lang });
      await until(() => h.state.settings.lang === lang, 'lang set');
      h.emit('host:startGame', { gameId: 'mostlikely' });
      const v = await h.phase('ml-vote');
      assert.strictEqual(/^Qui est le plus susceptible/.test(v.gameState.prompt), lang === 'fr', `${lang}: ${v.gameState.prompt}`);
    }
  } finally { await srv.stop(); }
});

test('UI dictionary covers every game rule line and blurb, and its patterns translate counters', () => {
  global.window = global.window || {};
  window.Rumpus = window.Rumpus || {};
  global.MutationObserver = global.MutationObserver || class { observe() {} disconnect() {} };
  require('../../public/i18n.js');
  const { FR, tr } = window.Rumpus.i18n;
  const host = fs.readFileSync(path.join(ROOT, 'public/host.js'), 'utf8');
  const rules = host.slice(host.indexOf('const RULES = {'), host.indexOf('};', host.indexOf('const RULES = {')));
  for (const [, line] of rules.matchAll(/'((?:[^'\\]|\\.)+)'/g)) {
    const t = line.replace(/\\'/g, "'");
    if (/^[a-z]+$/.test(t)) continue;
    assert.ok(FR[t], `no French for rule "${t}"`);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'games')).filter((x) => x.endsWith('.js'))) {
    const m = fs.readFileSync(path.join(ROOT, 'games', f), 'utf8').match(/blurb: '((?:[^'\\]|\\.)+)'/);
    if (m && !f.startsWith('night')) assert.ok(FR[m[1].replace(/\\'/g, "'")], `no French blurb for ${f}`);
  }
  assert.strictEqual(tr('Round 2 of 5'), 'Manche 2 sur 5');
  assert.strictEqual(tr('  Vote cast '), '  Vote enregistré ');
  assert.strictEqual(tr('a player answer'), null, 'unknown text is left alone');
});
