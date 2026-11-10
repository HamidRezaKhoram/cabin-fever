/* Browser stand-in for Node's `path` (POSIX join/dirname/basename only). AGPLv3 — see LICENSE. */
'use strict';

/** @param {...string} parts */
function join(...parts) {
  const out = [];
  for (const seg of parts.join('/').split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return (parts[0] && parts[0].startsWith('/') ? '/' : '') + out.join('/');
}
/** @param {string} p */
const dirname = (p) => join(p, '..');
/** @param {string} p */
const basename = (p) => String(p).split('/').filter(Boolean).pop() || '';

module.exports = { join, dirname, basename, sep: '/' };
