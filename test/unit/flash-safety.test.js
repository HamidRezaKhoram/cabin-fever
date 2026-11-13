// Flash safety (WCAG 2.3.1, docs/future-features/feel-plan.md M12): nothing on screen may flash more
// than 3 times in any one second. Checked statically for every CSS animation that swings opacity from
// dark to bright (≤ 0.3 → ≥ 0.7): its flashes per second, counting repeats. Canvas effects are drawn
// on the 30 fps clock and covered by the Cottage Lab, not here.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'style.css'), 'utf8');

/** How many times a keyframes block goes bright after being dark. @param {string} body */
function flashes(body) {
  const ops = [...body.matchAll(/(from|to|[\d.]+%)\s*\{[^}]*?opacity:\s*([\d.]+)/g)].map((m) => Number(m[2]));
  let n = 0, dark = ops.length ? ops[0] <= 0.3 : false;
  for (const o of ops.slice(1)) {
    if (dark && o >= 0.7) { n++; dark = false; } else if (!dark && o <= 0.3) dark = true;
  }
  return n;
}

test('no CSS animation flashes more than 3 times in a second', () => {
  /** @type {Record<string, number>} */ const perCycle = {};
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^}]*\})*)[^}]*\}/g)) perCycle[m[1]] = flashes(m[2]);
  const bad = [];
  for (const m of css.matchAll(/animation:\s*([^;}]+)/g)) {
    for (const part of m[1].split(',')) {
      const name = Object.keys(perCycle).find((k) => new RegExp(`(^|\\s)${k}(\\s|$)`).test(part.trim()));
      if (!name || !perCycle[name]) continue;
      const dur = /([\d.]+)(m?s)/.exec(part);
      const sec = dur ? Number(dur[1]) / (dur[2] === 'ms' ? 1000 : 1) : 0;
      const infinite = /infinite/.test(part);
      const reps = infinite ? Infinity : Number((/\s(\d+)(\s|$)/.exec(part.replace(/[\d.]+m?s/g, '')) || [0, 1])[1]);
      // Flashes in the busiest second: all of them if the whole run fits in a second, else the rate.
      const worst = sec * Math.min(reps, 1e9) <= 1 ? perCycle[name] * Math.min(reps, 1e9) : perCycle[name] / sec;
      if (worst > 3) bad.push(`${name} (${part.trim()}): ${worst.toFixed(1)} flashes in a second`);
    }
  }
  assert.ok(Object.values(perCycle).some((n) => n > 0), 'the check sees flashing animations at all (Storm Watch lightning)');
  assert.deepStrictEqual(bad, []);
});
