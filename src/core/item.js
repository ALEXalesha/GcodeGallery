// Один файл галереи целиком: прочитать (только чтение), разобрать, собрать сведения для
// подписи под плиткой и ужатый 3D-вид. Работает в потоке-работнике главного процесса.
'use strict';
const fs = require('fs');
const path = require('path');
const { readItem, kindOf } = require('./formats');
const { isBgcode } = require('./bgcode');
const { parseMeta, fitsBed } = require('./meta');
const { parseGcodePreview, createGcodePreviewParser, LAYER_MARKS } = require('../shared/gcode-preview');
const { compactPath, compactMesh } = require('./toolpath');
const Thumbs = require('./thumbs');
const Beds = require('./beds');

const VERSION = 4;          // меняется - старый кэш пересчитывается (4: габариты без полоски прочистки, R2)

// G-code больше этого разбирается кусками: в строку V8 целиком не влезет файл больше ~512 МБ (R11).
const BIG = 256 * 1024 * 1024;
const HEAD = 128 * 1024, TAIL = 512 * 1024;

/** Огромный G-code: слои кусками по строкам, сведения - из начала и конца, картинки - из начала. */
function readBig(buf, { maxSegments, chunkBytes }) {
  const marker = LAYER_MARKS.find((m) => buf.indexOf(m) >= 0) || '';
  const parser = createGcodePreviewParser({ maxSegments, marker });
  for (let a = 0; a < buf.length;) {
    let b = Math.min(buf.length, a + chunkBytes);
    if (b < buf.length) { const nl = buf.indexOf(0x0a, b); b = nl < 0 ? buf.length : nl + 1; }
    parser.push(buf.toString('utf8', a, b));
    a = b;
  }
  const head = buf.toString('utf8', 0, Math.min(buf.length, HEAD));
  const tail = buf.length > HEAD ? buf.toString('utf8', Math.max(HEAD, buf.length - TAIL)) : '';
  return { kind: 'gcode', gcode: null, big: { preview: parser.end(), metaText: head + '\n' + tail },
    thumbnails: Thumbs.gcodeThumbnails(buf.toString('utf8', 0, Math.min(buf.length, 4 * 1024 * 1024))), extra: {}, mesh: null, plates: 1, warnings: [] };
}

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

function processBuffer(buf, file, { budget = 150000, detail = false, maxSegments = 6e6, size = buf.length, mtimeMs = 0, bigBytes = BIG, chunkBytes = 64 * 1024 * 1024 } = {}) {
  const name = path.basename(file);
  const base = { path: file, name, size, mtimeMs, version: VERSION };
  let item;
  try {
    item = kindOf(name) === 'gcode' && buf.length > bigBytes && !isBgcode(buf) ? readBig(buf, { maxSegments, chunkBytes }) : readItem(buf, name);
  } catch (e) {
    return { info: Object.assign(base, { kind: null, error: e.code || 'bad-file', errorDetail: String(e.message || '').slice(0, 200) }), thumb: null, view: null };
  }
  const thumbPick = Thumbs.pick(item.thumbnails);
  const thumb = thumbPick ? Thumbs.toDataUrl(thumbPick) : null;
  const info = Object.assign(base, { kind: item.kind, plates: item.plates, warnings: item.warnings, thumbs: item.thumbnails.length });
  let view = null;
  if (item.gcode !== null || item.big) {
    const preview = item.big ? item.big.preview : parseGcodePreview(item.gcode, { maxSegments });
    const meta = parseMeta(item.big ? item.big.metaText : item.gcode, item.extra);
    if (item.big) info.big = true;
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
    if (!detail) delete info.settings;
    const moving = preview.kinds.reduce((s, k) => s + k.seconds, 0);
    if (info.timeSec === null && moving > 0) {
      info.timeSec = moving;
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
