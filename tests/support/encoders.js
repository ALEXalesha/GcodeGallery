// Кодировщики для образцов и законов «туда-обратно»: heatshrink, MeatPack, QOI, .bgcode.
// Пишутся по спецификации libbgcode / heatshrink / QOI; распаковщики продукта (src/core)
// сверены с настоящими файлами PrusaSlicer (tools/check-bgcode-ref.js).
'use strict';
const zlib = require('zlib');

/** Жадное LZSS heatshrink: литерал 1+8 бит, ссылка 0+W+L бит (расстояние-1, длина-1). */
function heatshrinkEncode(src, W, L) {
  const maxDist = 1 << W, maxLen = 1 << L;
  const bytes = [];
  let acc = 0, nbits = 0;
  const put = (v, n) => {
    for (let i = n - 1; i >= 0; i--) {
      acc = (acc << 1) | ((v >> i) & 1);
      if (++nbits === 8) { bytes.push(acc); acc = 0; nbits = 0; }
    }
  };
  const chains = new Map();
  const key = (i) => (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
  const remember = (i) => {
    if (i + 2 >= src.length) return;
    const k = key(i);
    let c = chains.get(k);
    if (!c) { c = []; chains.set(k, c); }
    c.push(i);
    if (c.length > 48) c.shift();
  };
  let i = 0;
  while (i < src.length) {
    let bestLen = 0, bestDist = 0;
    if (i + 2 < src.length) {
      const c = chains.get(key(i)) || [];
      for (let j = c.length - 1; j >= 0; j--) {
        const p = c[j];
        const d = i - p;
        if (d > maxDist) break;
        let l = 0;
        while (l < maxLen && i + l < src.length && src[p + l] === src[i + l]) l++;
        if (l > bestLen) { bestLen = l; bestDist = d; if (l === maxLen) break; }
      }
    }
    if (bestLen >= 2) {
      put(0, 1); put(bestDist - 1, W); put(bestLen - 1, L);
      for (let k = 0; k < bestLen; k++) remember(i + k);
      i += bestLen;
    } else {
      put(1, 1); put(src[i], 8);
      remember(i);
      i++;
    }
  }
  if (nbits) bytes.push(acc << (8 - nbits));
  return Buffer.from(bytes);
}

const MP_TABLE = '0123456789. \nGX';

/** MeatPack как в libbgcode: комментарии как есть (с выключенной упаковкой), команды без комментариев, G-строки без пробелов. */
function meatpackEncode(text, { comments = true, nospace = true } = {}) {
  const out = [];
  const cmd = (c) => out.push(0xff, 0xff, c);
  const value = new Map([...MP_TABLE].map((ch, i) => [ch, i]));
  if (nospace) { value.delete(' '); value.set('E', 11); }
  cmd(251);
  if (nospace) cmd(247);
  let packing = true;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.replace(/^[ \t]+/, '');
    if (comments && trimmed.startsWith(';')) {
      if (packing) { cmd(250); packing = false; }
      out.push(...Buffer.from(line + '\n', 'utf8'));
      continue;
    }
    if (!trimmed || trimmed.startsWith(';') || line.length < 2) continue;
    let s = line.split(';')[0].trim();
    if (!s) continue;
    const g = s.indexOf('G');
    if (g >= 0 && /[0-9]/.test(s[g + 1] || '')) {
      if (nospace) s = s.replace(/e/g, 'E');
      s = s.replace(/x/g, 'X').replace(/g/g, 'G').replace(/ /g, '');
    }
    s += '\n';
    const bytes = [];
    for (let i = 0; i < s.length; i += 2) {
      const c1 = s[i], c2 = i + 1 < s.length ? s[i + 1] : '\n';
      const p1 = value.has(c1), p2 = value.has(c2);
      if (p1 && p2) bytes.push((value.get(c2) << 4) | value.get(c1));
      else if (p1) bytes.push(0xf0 | value.get(c1), c2.charCodeAt(0));
      else if (p2) bytes.push((value.get(c2) << 4) | 0x0f, c1.charCodeAt(0));
      else bytes.push(0xff, c1.charCodeAt(0), c2.charCodeAt(0));
    }
    if (!packing) { cmd(251); packing = true; }
    out.push(...bytes);
  }
  return Buffer.from(out);
}

/** QOI по спецификации (все шесть операций). */
function qoiEncode(width, height, rgba) {
  const out = [];
  const head = Buffer.alloc(14);
  head.write('qoif', 0, 'latin1'); head.writeUInt32BE(width, 4); head.writeUInt32BE(height, 8); head[12] = 4; head[13] = 0;
  out.push(...head);
  const index = new Array(64).fill(null).map(() => [0, 0, 0, 0]);
  let pr = 0, pg = 0, pb = 0, pa = 255, run = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    if (r === pr && g === pg && b === pb && a === pa) {
      run++;
      if (run === 62 || i === n - 1) { out.push(0xc0 | (run - 1)); run = 0; }
      continue;
    }
    if (run > 0) { out.push(0xc0 | (run - 1)); run = 0; }
    const h = (r * 3 + g * 5 + b * 7 + a * 11) % 64;
    const e = index[h];
    if (e[0] === r && e[1] === g && e[2] === b && e[3] === a) out.push(h);
    else {
      index[h] = [r, g, b, a];
      if (a === pa) {
        const vr = ((r - pr + 384) % 256) - 128, vg = ((g - pg + 384) % 256) - 128, vb = ((b - pb + 384) % 256) - 128;
        const vgr = vr - vg, vgb = vb - vg;
        if (vr > -3 && vr < 2 && vg > -3 && vg < 2 && vb > -3 && vb < 2) out.push(0x40 | ((vr + 2) << 4) | ((vg + 2) << 2) | (vb + 2));
        else if (vgr > -9 && vgr < 8 && vg > -33 && vg < 32 && vgb > -9 && vgb < 8) out.push(0x80 | (vg + 32), ((vgr + 8) << 4) | (vgb + 8));
        else out.push(0xfe, r, g, b);
      } else out.push(0xff, r, g, b, a);
    }
    pr = r; pg = g; pb = b; pa = a;
  }
  out.push(0, 0, 0, 0, 0, 0, 0, 1);
  return Buffer.from(out);
}

const ini = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';

/**
 * .bgcode по спецификации. compression: 0..3 для всех блоков (метаданные - deflate или нет),
 * gcodeEncoding 0/1/2, checksum 0/1, gcodeChunk - размер куска G-code на блок.
 */
function bgcodeWrite({ fileMeta = {}, printerMeta = {}, printMeta = {}, slicerMeta = {}, thumbnails = [], gcode = '',
  compression = 3, metaCompression = 1, gcodeEncoding = 2, checksum = 1, gcodeChunk = 65536 }) {
  const parts = [];
  const head = Buffer.alloc(10);
  head.write('GCDE', 0, 'latin1'); head.writeUInt32LE(1, 4); head.writeUInt16LE(checksum, 8);
  parts.push(head);
  const block = (type, comp, params, data) => {
    let stored = data;
    if (comp === 1) stored = zlib.deflateSync(data);
    else if (comp === 2) stored = heatshrinkEncode(data, 11, 4);
    else if (comp === 3) stored = heatshrinkEncode(data, 12, 4);
    const h = Buffer.alloc(comp ? 12 : 8);
    h.writeUInt16LE(type, 0); h.writeUInt16LE(comp, 2); h.writeUInt32LE(data.length, 4);
    if (comp) h.writeUInt32LE(stored.length, 8);
    const body = Buffer.concat([h, params, stored]);
    parts.push(body);
    if (checksum) { const c = Buffer.alloc(4); c.writeUInt32LE(zlib.crc32(body) >>> 0); parts.push(c); }
  };
  const u16 = (...v) => { const b = Buffer.alloc(v.length * 2); v.forEach((x, i) => b.writeUInt16LE(x, i * 2)); return b; };
  if (Object.keys(fileMeta).length) block(0, metaCompression, u16(0), Buffer.from(ini(fileMeta)));
  block(3, metaCompression, u16(0), Buffer.from(ini(printerMeta)));
  for (const t of thumbnails) block(5, 0, u16({ png: 0, jpg: 1, qoi: 2 }[t.format], t.width, t.height), t.data);
  block(4, metaCompression, u16(0), Buffer.from(ini(printMeta)));
  block(2, metaCompression, u16(0), Buffer.from(ini(slicerMeta)));
  // G-code кусками по целым строкам, каждый кусок кодируется отдельно (как в PrusaSlicer).
  const lines = gcode.split('\n');
  let chunk = [];
  let size = 0;
  const flush = () => {
    if (!chunk.length) return;
    const text = chunk.join('\n') + '\n';
    const data = gcodeEncoding === 0 ? Buffer.from(text, 'utf8') : meatpackEncode(text, { comments: gcodeEncoding === 2 });
    block(1, compression, u16(gcodeEncoding), data);
    chunk = []; size = 0;
  };
  for (const l of lines) {
    if (l === '' && chunk.length === 0) continue;
    chunk.push(l); size += l.length + 1;
    if (size >= gcodeChunk) flush();
  }
  flush();
  return Buffer.concat(parts);
}

module.exports = { heatshrinkEncode, meatpackEncode, qoiEncode, bgcodeWrite };
