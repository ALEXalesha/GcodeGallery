// Один файл галереи целиком: прочитать (только чтение), разобрать, собрать сведения для
// подписи под плиткой и ужатый 3D-вид. Работает в потоке-работнике главного процесса.
'use strict';
const fs = require('fs');
const path = require('path');
const { readItem } = require('./formats');
const { parseMeta, fitsBed } = require('./meta');
const { parseGcodePreview } = require('../shared/gcode-preview');
const { compactPath, compactMesh } = require('./toolpath');
const Thumbs = require('./thumbs');
const Beds = require('./beds');

const VERSION = 3;          // меняется - старый кэш пересчитывается

const round = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/**
 * @param {string} file путь
 * @param {{budget?: number, detail?: boolean, stat?: fs.Stats}} opts detail - для большого окна (больше отрезков)
 * @returns {{info: object, thumb: string|null, view: object|null}}
 */
function processFile(file, { budget = 150000, detail = false, maxSegments = 6e6 } = {}) {
  const stat = fs.statSync(file);
  const buf = fs.readFileSync(file);
  return processBuffer(buf, file, { budget, detail, maxSegments, size: stat.size, mtimeMs: stat.mtimeMs });
}

function processBuffer(buf, file, { budget = 150000, detail = false, maxSegments = 6e6, size = buf.length, mtimeMs = 0 } = {}) {
  const name = path.basename(file);
  const base = { path: file, name, size, mtimeMs, version: VERSION };
  let item;
  try {
    item = readItem(buf, name);
  } catch (e) {
    return { info: Object.assign(base, { kind: null, error: e.code || 'bad-file', errorDetail: String(e.message || '').slice(0, 200) }), thumb: null, view: null };
  }
  const thumbPick = Thumbs.pick(item.thumbnails);
  const thumb = thumbPick ? Thumbs.toDataUrl(thumbPick) : null;
  const info = Object.assign(base, { kind: item.kind, plates: item.plates, warnings: item.warnings, thumbs: item.thumbnails.length });
  let view = null;
  if (item.gcode !== null) {
    const preview = parseGcodePreview(item.gcode, { maxSegments });
    const meta = parseMeta(item.gcode, item.extra);
    const bounds = preview.bounds;
    const bed = meta.bed || Beds.forPrinter(meta.printer);
    Object.assign(info, meta, {
      settings: detail ? meta.settings : undefined,
      settingsCount: Object.keys(meta.settings).length,
      layers: meta.layers || preview.layers.length,
      layersFound: preview.layers.length,
      bounds: bounds ? { min: bounds.min.map((v) => round(v)), max: bounds.max.map((v) => round(v)) } : null,
      dims: bounds ? [0, 1, 2].map((k) => round(bounds.max[k] - (k === 2 ? 0 : bounds.min[k]))) : null,
      bed,
      bedFromFile: !!meta.bed,
      fits: fitsBed(bounds, bed),
      truncated: preview.truncated,
      timeByKind: Object.fromEntries(preview.kinds.filter((k) => k.seconds > 0 && k.id !== 'travel').map((k) => [k.id, k.seconds])),
    });
    if (info.timeSec === null && preview.kinds.length) {
      info.timeSec = preview.kinds.reduce((s, k) => s + k.seconds, 0);
      info.timeEstimated = true;
    }
    view = compactPath(preview, { budget });
  } else if (item.mesh) {
    view = compactMesh(item.mesh, { budget: Math.round(budget * 0.8) });
    const b = view.bounds;
    Object.assign(info, {
      triangles: view.sourceTriangles,
      bounds: b ? { min: b.min.map((v) => round(v)), max: b.max.map((v) => round(v)) } : null,
      dims: b ? [0, 1, 2].map((k) => round(b.max[k] - b.min[k])) : null,
      objects: item.mesh.length,
    });
  }
  if (!detail && view) view = Object.assign(view, { detail: false });
  return { info, thumb, view };
}

module.exports = { processFile, processBuffer, VERSION };
