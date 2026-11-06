// Путь сопла для плитки и большого окна. Из parseGcodePreview (src/shared) берём только
// выдавленное (перемещения в превью не нужны) и ужимаем до бюджета отрезков:
//   1) соседние отрезки одной линии, почти лежащие на одной прямой, сливаются (допуск растёт,
//      пока не влезем в бюджет, до MAX_TOL мм);
//   2) не влезли - оставляем каждый n-й слой (модель видна целиком, чуть реже по высоте).
// Порядок отрезков внутри типа - по слоям, layerEnd[k][l] - конец слоя l: показать слои 1..L
// это drawRange без пересборки (так же, как в слайсере).
// Тот же вид для сетки модели без нарезки (.stl/.3mf): треугольники, ужатые сеткой вокселей.
'use strict';
const { KINDS } = require('../shared/gcode-preview');

const MAX_TOL = 1.6;
const FORMAT = 'GGTP1';

function simplifyRun(src, from, to, tol, out) {
  // Отрезки [from, to) идут цепочкой: конец i == начало i+1. Сливаем, пока средняя точка
  // ближе tol к прямой «якорь - новый конец».
  let ax = src[from], ay = src[from + 1], az = src[from + 2];
  let mx = src[from + 3], my = src[from + 4], mz = src[from + 5];
  for (let i = from + 6; i < to; i += 6) {
    const ex = src[i + 3], ey = src[i + 4], ez = src[i + 5];
    if (tol > 0 && Math.abs(mz - az) < 1e-6 && Math.abs(ez - az) < 1e-6 && dist2d(mx, my, ax, ay, ex, ey) <= tol) {
      mx = ex; my = ey; mz = ez;
      continue;
    }
    out.push(ax, ay, az, mx, my, mz);
    ax = mx; ay = my; az = mz;
    mx = ex; my = ey; mz = ez;
  }
  out.push(ax, ay, az, mx, my, mz);
}

function dist2d(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function simplifyKind(positions, layerEnd, tol, keepLayer) {
  const out = [];
  const ends = new Uint32Array(layerEnd.length);
  let start = 0;
  for (let l = 0; l < layerEnd.length; l++) {
    const end = layerEnd[l] * 6;
    if (keepLayer(l) && end > start) {
      let runStart = start;
      for (let i = start + 6; i <= end; i += 6) {
        const broken = i === end || positions[i] !== positions[i - 3] || positions[i + 1] !== positions[i - 2] || positions[i + 2] !== positions[i - 1];
        if (broken) { simplifyRun(positions, runStart, i, tol, out); runStart = i; }
      }
    }
    ends[l] = out.length / 6;
    start = end;
  }
  return { positions: Float32Array.from(out), layerEnd: ends };
}

/**
 * @param {object} preview результат parseGcodePreview
 * @param {{budget?: number}} opts сколько отрезков всего можно оставить
 * @returns {{type: 'path', kinds, layers: number[], data: Array<{positions, layerEnd}>, segments, sourceSegments, tolerance, layerStep, bounds}}
 */
function compactPath(preview, { budget = 150000 } = {}) {
  const layersZ = preview.layers.map((l) => l.z);
  const keep = KINDS.map((k, i) => (k.id === 'travel' ? -1 : i)).filter((i) => i >= 0 && preview.data[i].positions.length);
  const sourceSegments = keep.reduce((s, i) => s + preview.data[i].positions.length / 6, 0);
  let tol = 0, step = 1, data = null, total = 0;
  for (;;) {
    const keepLayer = step === 1 ? () => true : (l) => l % step === step - 1 || l === layersZ.length - 1;
    data = keep.map((i) => (tol === 0 && step === 1 ? { positions: preview.data[i].positions, layerEnd: preview.data[i].layerEnd } : simplifyKind(preview.data[i].positions, preview.data[i].layerEnd, tol, keepLayer)));
    total = data.reduce((s, d) => s + d.positions.length / 6, 0);
    if (total <= budget) break;
    if (tol < MAX_TOL) tol = tol === 0 ? 0.05 : tol * 2;
    else step *= 2;
    if (step > layersZ.length + 1) {
      // Даже по одному слою не влезли: обрезаем с конца каждого типа (крайний случай).
      data = data.map((d) => { const cut = Math.floor(budget / keep.length) * 6; return { positions: d.positions.slice(0, cut), layerEnd: d.layerEnd.map((e) => Math.min(e, cut / 6)) }; });
      total = data.reduce((s, d) => s + d.positions.length / 6, 0);
      break;
    }
  }
  return {
    type: 'path',
    kinds: keep.map((i) => ({ id: KINDS[i].id, group: KINDS[i].group, color: KINDS[i].color })),
    layers: layersZ,
    data,
    segments: total,
    sourceSegments,
    tolerance: Math.min(tol, MAX_TOL),
    layerStep: step,
    // Кадр камеры - по модели, без стартового кода и полоски прочистки (R2), если есть что-то кроме них.
    bounds: boundsOf(data.filter((d, j) => KINDS[keep[j]].id !== 'custom' || keep.every((i) => KINDS[i].id === 'custom')).map((d) => d.positions)),
  };
}

function boundsOf(arrays) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const a of arrays) {
    for (let i = 0; i < a.length; i += 3) {
      for (let k = 0; k < 3; k++) { const v = a[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    }
  }
  return min[0] <= max[0] ? { min, max } : null;
}

/** Модель без нарезки: все объекты в одну сетку (с матрицей места), ужатую до budget треугольников. */
function compactMesh(objects, { budget = 120000 } = {}) {
  const parts = objects.map((o) => (o.matrix ? applyMatrix(o.positions, o.matrix) : o.positions));
  const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  // На стол: низ модели на z = 0 (как в слайсере), X/Y - как в файле.
  const b0 = boundsOf([all]);
  if (b0) for (let i = 2; i < all.length; i += 3) all[i] -= b0.min[2];
  const sourceTriangles = all.length / 9;
  let positions = all, cell = 0;
  if (sourceTriangles > budget && b0) {
    const size = Math.max(b0.max[0] - b0.min[0], b0.max[1] - b0.min[1], b0.max[2] - b0.min[2]) || 1;
    cell = size / 512;
    for (let i = 0; i < 24 && positions.length / 9 > budget; i++) { positions = cluster(all, cell); cell *= 1.5; }
  }
  return { type: 'mesh', positions, triangles: positions.length / 9, sourceTriangles, cell, bounds: boundsOf([positions]) };
}

function applyMatrix(pos, m) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

/** Ужатие сетки вокселями: вершины одной клетки сливаются в первую, вырожденные треугольники выпадают. */
function cluster(pos, cell) {
  const reps = new Map();
  const out = [];
  const q = (i) => {
    const key = Math.floor(pos[i] / cell) + ',' + Math.floor(pos[i + 1] / cell) + ',' + Math.floor(pos[i + 2] / cell);
    let r = reps.get(key);
    if (!r) { r = [pos[i], pos[i + 1], pos[i + 2], key]; reps.set(key, r); }
    return r;
  };
  for (let t = 0; t < pos.length; t += 9) {
    const a = q(t), b = q(t + 3), c = q(t + 6);
    if (a[3] === b[3] || b[3] === c[3] || a[3] === c[3]) continue;
    out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
  return Float32Array.from(out);
}

// ---------------------------------------------------------------- в файл кэша и обратно

/** Сжатый вид -> Buffer: строка JSON с длинами + массивы подряд (выравнены на 4 байта). */
function serialize(view) {
  const arrays = view.type === 'path' ? view.data.flatMap((d) => [d.positions, d.layerEnd]) : [view.positions];
  const head = Object.assign({}, view, { data: undefined, positions: undefined, arrays: arrays.map((a) => [a instanceof Float32Array ? 'f' : 'u', a.length]) });
  const json = Buffer.from(JSON.stringify(head), 'utf8');
  const pad = (4 - ((FORMAT.length + 4 + json.length) % 4)) % 4;
  const parts = [Buffer.from(FORMAT, 'latin1'), u32(json.length + pad), json, Buffer.alloc(pad, 0x20)];
  for (const a of arrays) parts.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  return Buffer.concat(parts);
}

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

function deserialize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < FORMAT.length + 4 || buf.toString('latin1', 0, FORMAT.length) !== FORMAT) throw new Error('bad toolpath file');
  const jl = buf.readUInt32LE(FORMAT.length);
  const head = JSON.parse(buf.toString('utf8', FORMAT.length + 4, FORMAT.length + 4 + jl));
  let p = FORMAT.length + 4 + jl;
  const arrays = head.arrays.map(([t, n]) => {
    const bytes = n * 4;
    if (p + bytes > buf.length) throw new Error('cut toolpath file');
    const copy = new ArrayBuffer(bytes);
    new Uint8Array(copy).set(buf.subarray(p, p + bytes));
    p += bytes;
    return t === 'f' ? new Float32Array(copy) : new Uint32Array(copy);
  });
  delete head.arrays;
  if (head.type === 'path') {
    head.data = [];
    for (let i = 0; i < arrays.length; i += 2) head.data.push({ positions: arrays[i], layerEnd: arrays[i + 1] });
  } else head.positions = arrays[0];
  return head;
}

module.exports = { compactPath, compactMesh, serialize, deserialize, boundsOf, cluster, MAX_TOL };
