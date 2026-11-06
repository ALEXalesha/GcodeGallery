// Предпросмотр по слоям (пункт 1 Алексея 17.10: «как в OrcaSlicer или Elegoo Slicer»):
// G-code -> отрезки по типам линий (;TYPE: движка) и слоям (;LAYER_CHANGE). Для окна -
// по каждому типу Float32Array отрезков (x0 y0 z0 x1 y1 z1) подряд по слоям и номер
// последнего отрезка каждого слоя: показать слои 1..N - это drawRange, без пересборки.
'use strict';

// Типы линий движка -> наши группы и цвета (цвета - как у Orca по умолчанию).
const KINDS = [
// Галерея (src/shared, SOURCE.md): добавлены имена PrusaSlicer, Cura и Bambu Studio.
  { id: 'outer', group: 'walls', color: '#ff7d38', engine: ['Outer wall', 'External perimeter', 'WALL-OUTER'] },
  { id: 'inner', group: 'walls', color: '#ffe64d', engine: ['Inner wall', 'Perimeter', 'WALL-INNER'] },
  { id: 'overhang', group: 'walls', color: '#1f1fff', engine: ['Overhang wall', 'Overhang perimeter'] },
  { id: 'sparse', group: 'infill', color: '#b03029', engine: ['Sparse infill', 'Internal infill', 'FILL'] },
  { id: 'solid', group: 'infill', color: '#9654cc', engine: ['Internal solid infill', 'Solid infill', 'SKIN'] },
  { id: 'top', group: 'infill', color: '#f04040', engine: ['Top surface', 'Top solid infill'] },
  { id: 'bottom', group: 'infill', color: '#665cc7', engine: ['Bottom surface'] },
  { id: 'bridge', group: 'infill', color: '#4d80ba', engine: ['Bridge', 'Internal Bridge', 'Bridge infill'] },
  { id: 'gap', group: 'infill', color: '#e8e8e8', engine: ['Gap infill', 'Gap fill'] },
  { id: 'ironing', group: 'infill', color: '#ff8c69', engine: ['Ironing'] },
  { id: 'support', group: 'support', color: '#00d84a', engine: ['Support', 'Support transition', 'Support material', 'SUPPORT', 'SUPPORT-INFILL'] },
  { id: 'supportIf', group: 'support', color: '#008000', engine: ['Support interface', 'Support material interface', 'SUPPORT-INTERFACE'] },
  { id: 'skirt', group: 'adhesion', color: '#00876e', engine: ['Skirt', 'Brim', 'Skirt/Brim', 'SKIRT'] },
  { id: 'tower', group: 'other', color: '#b3e3ab', engine: ['Prime tower', 'Wipe tower', 'PRIME-TOWER'] },
  { id: 'custom', group: 'other', color: '#5ed194', engine: ['Custom'] },
  { id: 'travel', group: 'travel', color: '#5875c8', engine: [] },
];
const BY_ENGINE = new Map();
KINDS.forEach((k, i) => k.engine.forEach((e) => BY_ENGINE.set(e, i)));
// Метки начала слоя: Orca/Elegoo/Prusa/Slicer CC, Bambu Studio, Cura. Порядок - приоритет.
const LAYER_MARKS = [';LAYER_CHANGE', '; CHANGE_LAYER', ';LAYER:'];
const MIN_LAYER = 0.05;      // слои по Z без меток: ниже этого роста - тот же слой
const CUSTOM = KINDS.findIndex((k) => k.id === 'custom');
const TRAVEL = KINDS.findIndex((k) => k.id === 'travel');

function kindOf(typeName) {
  const i = BY_ENGINE.get(typeName.trim());
  return i === undefined ? CUSTOM : i;
}

class Growable {
  constructor() { this.a = new Float32Array(6 * 4096); this.n = 0; }
  push6(a, b, c, d, e, f) {
    if (this.n + 6 > this.a.length) { const g = new Float32Array(this.a.length * 2); g.set(this.a); this.a = g; }
    const x = this.a; let n = this.n;
    x[n++] = a; x[n++] = b; x[n++] = c; x[n++] = d; x[n++] = e; x[n++] = f;
    this.n = n;
  }
  done() { return this.a.slice(0, this.n); }
}

function num(line, letter) {
  const i = line.indexOf(letter);
  if (i < 0) return null;
  const m = /^-?\d*\.?\d+(?:e-?\d+)?/i.exec(line.slice(i + 1));
  return m ? Number(m[0]) : null;
}

/**
 * @returns {{kinds: Array<{id, group, color, segments, seconds}>, layers: Array<{z: number}>,
 *   data: Array<{positions: Float32Array, layerEnd: Uint32Array}>}}
 */
/**
 * Разбор кусками (галерея: G-code больше предела строки V8 в ~512 МБ, R11): push(текст) сколько
 * угодно раз (строки могут рваться между кусками), потом end(). marker - метка слоя этого файла
 * (LAYER_MARKS), её ищет вызывающий по всему файлу; '' - слои по росту Z.
 */
function createGcodePreviewParser({ maxSegments = 12e6, marker = '' } = {}) {
  const segs = KINDS.map(() => new Growable());
  const layerEnds = KINDS.map(() => []);
  const seconds = new Float64Array(KINDS.length);
  const layers = [];
  let x = 0, y = 0, z = 0, e = 0, f = 3000;
  let absXY = true, absE = false;
  let kind = CUSTOM;
  let layer = -1;
  let total = 0;
  // Галерея: метка слоя своего слайсера (первая найденная), без меток - слой по росту Z
  // выдавленной линии; высота слоя без ;Z: - по первой выдавленной линии слоя.
  let zKnown = false;
  // Габариты модели: выдавленное по типам линий; «Custom» (стартовый код, полоска прочистки за
  // краем стола) - нет (R2). Файл без типов - всё выдавленное.
  const box = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
  const model = box(), any = box();
  const grow = (b, px, py, pz) => {
    const { min, max } = b;
    if (px < min[0]) min[0] = px; if (px > max[0]) max[0] = px;
    if (py < min[1]) min[1] = py; if (py > max[1]) max[1] = py;
    if (pz < min[2]) min[2] = pz; if (pz > max[2]) max[2] = pz;
  };
  const closeLayer = () => { if (layer >= 0) for (let k = 0; k < KINDS.length; k++) layerEnds[k][layer] = segs[k].n / 6; };
  const add = (k, x0, y0, z0, x1, y1, z1) => {
    if (total >= maxSegments) return;
    segs[k].push6(x0, y0, z0, x1, y1, z1);
    total++;
    if (k !== TRAVEL) {
      grow(any, x0, y0, z0); grow(any, x1, y1, z1);
      if (k !== CUSTOM) { grow(model, x0, y0, z0); grow(model, x1, y1, z1); }
    }
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    if (f > 0) seconds[k] += len / (f / 60);
  };
  let rest = '';
  const push = (chunk) => {
    const text = rest + chunk;
    const L = text.lastIndexOf('\n') + 1;
    rest = text.slice(L);
    let pos = 0;
    while (pos < L) {
      const end = text.indexOf('\n', pos);
      let line = text.slice(pos, end);
      pos = end + 1;
      if (!line) continue;
      const c0 = line.charCodeAt(0);
      if (c0 === 59 /* ; */) {
        if (line.startsWith(';TYPE:')) kind = kindOf(line.slice(6));
        else if (line.startsWith('; FEATURE:')) kind = kindOf(line.slice(10));
        else if (marker && line.startsWith(marker) && (marker !== ';LAYER:' || /^;LAYER:-?\d/.test(line))) { closeLayer(); layer++; layers.push({ z }); zKnown = false; }   // всё до первого слоя (полоска прочистки) - в первый слой
        else if ((line.startsWith(';Z:') || line.startsWith('; Z_HEIGHT:')) && layer >= 0) {
          const v = Number(line.slice(line.indexOf(':') + 1));
          if (Number.isFinite(v)) { layers[layer].z = v; zKnown = true; }
        }
        continue;
      }
      const sc = line.indexOf(';');
      if (sc >= 0) line = line.slice(0, sc);
      line = line.trim();
      if (c0 === 71 /* G */) {
        const sp = line.indexOf(' ');
        const cmd = sp < 0 ? line : line.slice(0, sp);
        if (cmd === 'G1' || cmd === 'G0' || cmd === 'G2' || cmd === 'G3') {
          const nx = num(line, 'X'), ny = num(line, 'Y'), nz = num(line, 'Z'), ne = num(line, 'E'), nf = num(line, 'F');
          if (nf !== null) f = nf;
          const tx = nx === null ? x : absXY ? nx : x + nx;
          const ty = ny === null ? y : absXY ? ny : y + ny;
          const tz = nz === null ? z : absXY ? nz : z + nz;
          let de = 0;
          if (ne !== null) { de = absE ? ne - e : ne; e = absE ? ne : e + ne; }
          const moved = tx !== x || ty !== y;
          const k = de > 0 && moved ? kind : TRAVEL;
          if (k !== TRAVEL) {
            if (!marker && (layer < 0 || tz >= layers[layer].z + MIN_LAYER)) { closeLayer(); layer++; layers.push({ z: tz }); zKnown = true; }
            else if (layer >= 0 && !zKnown) { layers[layer].z = tz; zKnown = true; }
          }
          if (moved) {
            if (cmd === 'G2' || cmd === 'G3') {
              const ci = num(line, 'I') || 0, cj = num(line, 'J') || 0;
              const cx = x + ci, cy = y + cj;
              const r = Math.hypot(x - cx, y - cy);
              let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ty - cy, tx - cx);
              if (cmd === 'G3' && a1 <= a0) a1 += 2 * Math.PI;
              if (cmd === 'G2' && a1 >= a0) a1 -= 2 * Math.PI;
              const n = Math.max(2, Math.min(64, Math.ceil(Math.abs(a1 - a0) * r / 0.5)));
              let px = x, py = y, pz = z;
              for (let i = 1; i <= n; i++) {
                const a = a0 + ((a1 - a0) * i) / n;
                const qx = i === n ? tx : cx + r * Math.cos(a), qy = i === n ? ty : cy + r * Math.sin(a), qz = z + ((tz - z) * i) / n;
                add(k, px, py, pz, qx, qy, qz);
                px = qx; py = qy; pz = qz;
              }
            } else add(k, x, y, z, tx, ty, tz);
          }
          x = tx; y = ty; z = tz;
        } else if (cmd === 'G90') absXY = true;
        else if (cmd === 'G91') absXY = false;
        else if (cmd === 'G92') { const ne = num(line, 'E'); if (ne !== null) e = ne; }
      } else if (c0 === 77 /* M */) {
        if (line.startsWith('M82')) absE = true;
        else if (line.startsWith('M83')) absE = false;
      }
    }
  };
  const end = () => {
    if (rest) { const last = rest; rest = ''; push(last + '\n'); }
    if (layer < 0 && total) { layer = 0; layers.push({ z }); }
    closeLayer();
    const n = layers.length;
    const data = KINDS.map((k, i) => {
      const ends = new Uint32Array(n);
      let last = 0;
      for (let l = 0; l < n; l++) { if (layerEnds[i][l] !== undefined) last = layerEnds[i][l]; ends[l] = last; }
      return { positions: segs[i].done(), layerEnd: ends };
    });
    return {
      kinds: KINDS.map((k, i) => ({ id: k.id, group: k.group, color: k.color, segments: data[i].positions.length / 6, seconds: Math.round(seconds[i]) })),
      layers,
      data,
      truncated: total >= maxSegments,
      bounds: model.min[0] <= model.max[0] ? model : any.min[0] <= any.max[0] ? any : null,
    };
  };
  return { push, end };
}

/** Весь текст разом (как в слайсере). */
function parseGcodePreview(text, { maxSegments = 12e6 } = {}) {
  const p = createGcodePreviewParser({ maxSegments, marker: LAYER_MARKS.find((m) => text.indexOf(m) >= 0) || '' });
  p.push(text);
  return p.end();
}

module.exports = { parseGcodePreview, createGcodePreviewParser, KINDS, LAYER_MARKS };
