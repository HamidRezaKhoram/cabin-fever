/*
 * Test kit — browser checks (Playwright). No project knowledge: copy into any project.
 *   const { suite } = require('../kit/browser');
 *   const t = suite({ name: 'UI', shots: process.env.SHOTS, diagnose: async (pages) => { … } });
 *   t.watch(page, 'tv');                    // records page errors + console errors, adds to the failure dump
 *   await t.check('title screen', async () => { … });
 *   t.done();                               // prints "UI: N checks passed"
 * Checks run in order and share state (later ones build on earlier ones), so the first failure stops
 * the run: it prints the error, saves a screenshot of every watched page, calls `diagnose`, exits 1.
 */
'use strict';

/** @param {{ name: string, shots?: string | null, warnings?: boolean, diagnose?: (pages: any[]) => Promise<void> }} opts
 * warnings: console warnings count as errors too (and are echoed as they happen) */
function suite({ name, shots = null, warnings = false, diagnose }) {
  let passed = 0;
  /** @type {any[]} */ const pages = [];
  /** @type {string[]} page errors and console errors seen so far (check it's empty at the end) */ const errors = [];
  return {
    pages, errors,
    get passed() { return passed; },
    /** @param {any} page @param {string} who */
    watch(page, who) {
      pages.push(page);
      page.on('pageerror', (/** @type {Error} */ e) => errors.push(`${who}: ${e.message}`));
      page.on('console', (/** @type {any} */ m) => {
        if (m.type() !== 'error' && !(warnings && m.type() === 'warning')) return;
        errors.push(`${who} console: ${m.text()}`);
        if (warnings) console.error(`    [${who} ${m.type()}] ${m.text().slice(0, 300)}`);
      });
      return page;
    },
    /** @param {string} label @param {() => Promise<void>} fn */
    async check(label, fn) {
      const t0 = Date.now();
      try { await fn(); passed++; console.log(`  ✔ ${label} (${Date.now() - t0} ms)`); } catch (e) {
        console.error(`  ✖ ${label}\n`, e);
        if (shots) for (const [i, pg] of pages.entries()) await pg.screenshot({ path: `${shots}/FAIL-${i}.png` }).catch(() => {});
        if (diagnose) await diagnose(pages).catch((er) => console.error('  (diagnose failed)', er));
        process.exit(1);
      }
    },
    done() { console.log(`\n${name}: ${passed} checks passed`); },
  };
}

module.exports = { suite };
