// Поток-работник: разбор одного файла (src/core/item.js) вне главного потока, чтобы окно не
// замирало на больших G-code. Ответ с типизированными массивами уходит передачей, без копии.
'use strict';
const { parentPort } = require('worker_threads');
const { processFile } = require('../src/core/item');

function transferables(view) {
  if (!view) return [];
  const arrays = view.type === 'path' ? view.data.flatMap((d) => [d.positions, d.layerEnd]) : [view.positions];
  return [...new Set(arrays.map((a) => a.buffer))];
}

parentPort.on('message', ({ id, file, opts }) => {
  try {
    const r = processFile(file, opts);
    // Ужатый вид может делить буфер с полным разбором - копируем, чтобы передать только нужное.
    if (r.view && r.view.type === 'path') r.view.data = r.view.data.map((d) => ({ positions: d.positions.slice(), layerEnd: d.layerEnd.slice() }));
    parentPort.postMessage({ id, result: r }, transferables(r.view));
  } catch (e) {
    parentPort.postMessage({ id, error: { code: e.code || 'error', message: String(e.message || e) } });
  }
});
