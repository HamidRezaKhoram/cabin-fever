/* QR codes made in the browser (the Docker server serves /qr.svg; the Pages build has no server).
 * Same look as server.js: dark modules on white, 1-module margin. AGPLv3 — see LICENSE. */
'use strict';

const QRCode = require('qrcode');

/** @param {string} text @returns {string} an SVG data: URL */
function qrDataUrl(text) {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = q.modules.size, m = 1, size = n + 2 * m;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.get(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path fill="#14121f" d="${d}"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

module.exports = { qrDataUrl };
