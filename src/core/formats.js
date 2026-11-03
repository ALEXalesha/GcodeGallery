// Какие файлы показывает галерея и как из каждого достать G-code, картинки и метаданные.
//   .gcode .gco .g     текст G-code
//   .gcode.3mf         Bambu Studio / OrcaSlicer: ZIP, Metadata/plate_N.gcode, plate_N.png, slice_info.config
//   .bgcode            PrusaSlicer, двоичный (src/core/bgcode.js)
//   .3mf .stl          модель без нарезки - показываем саму модель (src/shared/mesh.js)
// .3mf, внутри которого есть нарезанная пластина, считается .gcode.3mf.
'use strict';
const path = require('path');
const { readZip } = require('../shared/zip');
const { parseBgcode, isBgcode } = require('./bgcode');
const { gcodeThumbnails, formatOf } = require('./thumbs');
const { parse3mf, parseStl } = require('../shared/mesh');

const EXTENSIONS = ['.gcode', '.gco', '.g', '.bgcode', '.3mf', '.stl'];

class FormatError extends Error {
  constructor(code, detail) { super(code + (detail ? ': ' + detail : '')); this.code = code; this.detail = detail || ''; }
}

/** Вид файла по имени: gcode, gcode3mf, bgcode, 3mf, stl или null. */
function kindOf(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.gcode.3mf')) return 'gcode3mf';
  const ext = path.extname(n);
  if (ext === '.gcode' || ext === '.gco' || ext === '.g') return 'gcode';
  if (ext === '.bgcode') return 'bgcode';
  if (ext === '.3mf') return '3mf';
  if (ext === '.stl') return 'stl';
  return null;
}

const isSupported = (name) => kindOf(name) !== null;

function attr(tag, key) {
  const m = new RegExp('\\b' + key + '\\s*=\\s*"([^"]*)"').exec(tag);
  return m ? m[1] : null;
}

/** Metadata/slice_info.config Bambu/Orca: по пластинам - время, вес, пластик. */
function parseSliceInfo(xml) {
  const plates = [];
  const client = /key="X-BBL-Client-Version"\s+value="([^"]*)"/.exec(xml || '');
  const plateRe = /<plate>([\s\S]*?)<\/plate>/g;
  let m;
  while ((m = plateRe.exec(xml || ''))) {
    const body = m[1];
    const meta = {};
    const mr = /<metadata\s+key="([^"]+)"\s+value="([^"]*)"\s*\/>/g;
    let x;
    while ((x = mr.exec(body))) meta[x[1]] = x[2];
    const filaments = [];
    const fr = /<filament\b([^>]*)\/?>/g;
    while ((x = fr.exec(body))) {
      filaments.push({ type: attr(x[1], 'type') || '', color: attr(x[1], 'color') || '', usedM: Number(attr(x[1], 'used_m')) || 0, usedG: Number(attr(x[1], 'used_g')) || 0 });
    }
    plates.push({ index: Number(meta.index) || plates.length + 1, prediction: meta.prediction !== undefined ? Number(meta.prediction) : null,
      weight: meta.weight !== undefined ? Number(meta.weight) : null, printer: meta.printer_model_id || '', filaments });
  }
  return { client: client ? client[1] : '', plates };
}

function iniToKv(ini) {
  const out = {};
  for (const [k, v] of Object.entries(ini || {})) out[k] = v;
  return out;
}

/**
 * Прочитать файл в общий вид. Файл только читается: buf уже в памяти.
 * @returns {{kind, gcode: string|null, thumbnails: Array, extra: object, mesh: Array|null, plates: number, warnings: string[]}}
 */
function readItem(buf, name, { gcode = true } = {}) {
  let kind = kindOf(name);
  if (!kind) throw new FormatError('type', path.extname(String(name)));
  const res = { kind, gcode: null, thumbnails: [], extra: {}, mesh: null, plates: 0, warnings: [] };
  if (kind === 'gcode') {
    if (isBgcode(buf)) { res.kind = kind = 'bgcode'; }
    else {
      res.gcode = buf.toString('utf8');
      res.thumbnails = gcodeThumbnails(res.gcode);
      res.plates = 1;
      return res;
    }
  }
  if (kind === 'bgcode') {
    const b = parseBgcode(buf, { gcode });
    res.gcode = b.gcode;
    res.thumbnails = b.thumbnails;
    res.extra = { kv: Object.assign({}, iniToKv(b.slicerMeta), iniToKv(b.printerMeta), iniToKv(b.printMeta)), producer: b.fileMeta.Producer || '' };
    res.plates = 1;
    return res;
  }
  if (kind === 'stl') {
    res.mesh = [{ name: path.basename(name), positions: parseStl(buf), matrix: null }];
    return res;
  }
  // .3mf и .gcode.3mf - ZIP
  let files;
  try { files = readZip(buf); } catch (e) { throw new FormatError('bad-zip', e.message); }
  const plates = [...files.keys()].map((k) => /^Metadata\/plate_(\d+)\.gcode$/i.exec(k)).filter(Boolean)
    .map((m) => ({ n: Number(m[1]), key: m[0] })).sort((a, b) => a.n - b.n);
  if (plates.length) {
    res.kind = 'gcode3mf';
    res.plates = plates.length;
    const first = plates[0];
    res.gcode = gcode ? files.get(first.key).toString('utf8') : null;
    res.thumbnails = res.gcode ? gcodeThumbnails(res.gcode) : [];
    for (const pic of [`Metadata/plate_${first.n}.png`, `Metadata/plate_${first.n}_small.png`]) {
      const data = files.get(pic);
      if (data) res.thumbnails.push({ format: formatOf(data, 'png'), width: pngWidth(data), height: pngHeight(data), data });
    }
    const info = files.get('Metadata/slice_info.config');
    if (info) {
      const si = parseSliceInfo(info.toString('utf8'));
      const p = si.plates.find((x) => x.index === first.n) || si.plates[0];
      if (p) {
        if (p.prediction !== null) res.extra.timeSec = p.prediction;
        if (p.weight !== null) res.extra.filamentG = p.weight;
        const f = p.filaments[0];
        if (f) {
          res.extra.filamentType = f.type || undefined;
          res.extra.filamentColor = /^#[0-9a-f]{6}/i.test(f.color) ? f.color.slice(0, 7).toUpperCase() : undefined;
          const m = p.filaments.reduce((s, x) => s + x.usedM, 0);
          if (m > 0) res.extra.filamentMm = Math.round(m * 1000 * 100) / 100;
        }
      }
      if (si.client) res.extra.producer = 'BambuStudio ' + si.client;
    }
    if (plates.length > 1) res.warnings.push('plates');
    return res;
  }
  if (kind === 'gcode3mf') throw new FormatError('no-plate', 'no Metadata/plate_N.gcode');
  const model = parse3mf(buf, { fileName: path.basename(name) });
  res.mesh = model.objects.map((o) => ({ name: o.name, positions: o.positions, matrix: o.matrix }));
  res.warnings.push(...model.warnings);
  const thumb = files.get('Metadata/thumbnail.png') || files.get('Metadata/plate_1.png') || files.get('Thumbnails/thumbnail.png');
  if (thumb) res.thumbnails.push({ format: formatOf(thumb, 'png'), width: pngWidth(thumb), height: pngHeight(thumb), data: thumb });
  return res;
}

const pngWidth = (b) => (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? b.readUInt32BE(16) : 0);
const pngHeight = (b) => (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? b.readUInt32BE(20) : 0);

module.exports = { readItem, kindOf, isSupported, parseSliceInfo, EXTENSIONS, FormatError };
