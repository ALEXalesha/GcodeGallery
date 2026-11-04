// Значок программы assets/icon.png (256x256): тёмная плитка, на ней слои напечатанной детали.
// Рисуется кодом, без графических программ. Запуск: node tools/make-icon.js
'use strict';
const fs = require('fs');
const path = require('path');
const { pngEncode } = require('../src/core/thumbs');

const S = 256;
const rgba = Buffer.alloc(S * S * 4);
const set = (x, y, [r, g, b], a = 255) => { const o = (y * S + x) * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a; };
const R = 48;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const dx = Math.max(R - x, x - (S - 1 - R), 0), dy = Math.max(R - y, y - (S - 1 - R), 0);
    const d = Math.hypot(dx, dy);
    if (d > R) continue;
    const t = (x + y) / (2 * S);
    set(x, y, [Math.round(30 + 40 * t), Math.round(24 + 20 * t), Math.round(60 + 60 * t)], d > R - 1 ? 128 : 255);
  }
}
// Слои детали: каждый следующий уже и выше, оранжевая стенка, жёлтая внутренняя линия.
for (let l = 0; l < 9; l++) {
  const y0 = 196 - l * 14, w = 150 - l * 9, x0 = (S - w) / 2;
  for (let y = y0; y < y0 + 10; y++) for (let x = Math.round(x0); x < x0 + w; x++) {
    const edge = y === y0 || y === y0 + 9;
    set(x, y, edge ? [255, 230, 77] : [255, 125, 56]);
  }
}
// Сопло сверху.
for (let y = 40; y < 70; y++) for (let x = 112; x < 144; x++) set(x, y, [200, 205, 220]);
for (let y = 70; y < 82; y++) { const h = 16 - (y - 70); for (let x = 128 - h; x < 128 + h; x++) set(x, y, [170, 175, 190]); }
fs.mkdirSync(path.join(__dirname, '..', 'assets'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), pngEncode(S, S, rgba));
console.log('assets/icon.png');
