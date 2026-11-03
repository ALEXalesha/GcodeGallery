// Картинки, которые слайсер кладёт в файл: в G-code - комментарии base64 между
// «; thumbnail begin WxH LEN» и «; thumbnail end» (PNG; у Prusa ещё thumbnail_JPG и
// thumbnail_QOI), в .bgcode - блоки PNG/JPG/QOI, в .gcode.3mf - Metadata/plate_N.png.
// Окно показывает PNG и JPG; QOI переводим в PNG здесь (свой маленький кодировщик PNG).
'use strict';
const zlib = require('zlib');

const BEGIN = /^;\s*(thumbnail(?:_(PNG|JPG|QOI))?)\s+begin\s+(\d+)\s*x\s*(\d+)(?:\s+(\d+))?/i;

/** Картинки из текста G-code (ищем в первых headBytes символах - там они у всех слайсеров). */
function gcodeThumbnails(text, { headBytes = 4 * 1024 * 1024 } = {}) {
  const out = [];
  if (typeof text !== 'string') return out;
  const head = text.length > headBytes ? text.slice(0, headBytes) : text;
  let pos = 0;
  while (pos < head.length) {
    const i = head.indexOf('thumbnail', pos);
    if (i < 0) break;
    const ls = head.lastIndexOf('\n', i) + 1;
    let le = head.indexOf('\n', i);
    if (le < 0) le = head.length;
    const m = BEGIN.exec(head.slice(ls, le).trim());
    pos = le + 1;
    if (!m) continue;
    const endTag = new RegExp('^;\\s*' + m[1] + '\\s+end', 'i');
    const chunks = [];
    let q = pos, closed = false;
    while (q < head.length) {
      let e = head.indexOf('\n', q);
      if (e < 0) e = head.length;
      const line = head.slice(q, e).trim();
      q = e + 1;
      if (endTag.test(line)) { closed = true; break; }
      if (line.startsWith(';')) chunks.push(line.slice(1).trim());
    }
    pos = q;
    if (!closed) continue;
    const data = Buffer.from(chunks.join(''), 'base64');
    if (!data.length) continue;
    out.push({ format: formatOf(data, (m[2] || 'png').toLowerCase()), width: Number(m[3]), height: Number(m[4]), data });
  }
  return out;
}

/** Формат по первым байтам (подпись надёжнее метки в комментарии). */
function formatOf(data, fallback = 'unknown') {
  if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 14 && data.toString('latin1', 0, 4) === 'qoif') return 'qoi';
  return fallback;
}

class QoiError extends Error { constructor(m) { super(m); this.code = 'bad-qoi'; } }

/** QOI -> {width, height, rgba: Buffer}. */
function qoiDecode(buf) {
  if (buf.length < 22 || buf.toString('latin1', 0, 4) !== 'qoif') throw new QoiError('no qoif header');
  const width = buf.readUInt32BE(4), height = buf.readUInt32BE(8);
  if (!width || !height || width * height > 16e6) throw new QoiError('bad size');
  const px = width * height;
  const rgba = Buffer.alloc(px * 4);
  const index = new Uint8Array(64 * 4);
  let r = 0, g = 0, b = 0, a = 255;
  let p = 14, run = 0;
  const end = buf.length - 8;
  for (let o = 0; o < px * 4; o += 4) {
    if (run > 0) run--;
    else if (p < end) {
      const b1 = buf[p++];
      if (b1 === 0xfe) { r = buf[p++]; g = buf[p++]; b = buf[p++]; }
      else if (b1 === 0xff) { r = buf[p++]; g = buf[p++]; b = buf[p++]; a = buf[p++]; }
      else if ((b1 & 0xc0) === 0x00) { const k = b1 * 4; r = index[k]; g = index[k + 1]; b = index[k + 2]; a = index[k + 3]; }
      else if ((b1 & 0xc0) === 0x40) { r = (r + ((b1 >> 4) & 3) - 2) & 255; g = (g + ((b1 >> 2) & 3) - 2) & 255; b = (b + (b1 & 3) - 2) & 255; }
      else if ((b1 & 0xc0) === 0x80) {
        const b2 = buf[p++];
        const vg = (b1 & 0x3f) - 32;
        r = (r + vg - 8 + ((b2 >> 4) & 0x0f)) & 255; g = (g + vg) & 255; b = (b + vg - 8 + (b2 & 0x0f)) & 255;
      } else run = b1 & 0x3f;
      const k = ((r * 3 + g * 5 + b * 7 + a * 11) % 64) * 4;
      index[k] = r; index[k + 1] = g; index[k + 2] = b; index[k + 3] = a;
    }
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
  }
  return { width, height, rgba };
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** RGBA -> PNG (8 бит, без фильтров). */
function pngEncode(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Картинка для окна: data URL PNG или JPG; QOI переводится в PNG; испорченная - null. */
function toDataUrl(thumb) {
  if (!thumb || !thumb.data) return null;
  const f = formatOf(thumb.data, thumb.format);
  try {
    if (f === 'png') return 'data:image/png;base64,' + thumb.data.toString('base64');
    if (f === 'jpg') return 'data:image/jpeg;base64,' + thumb.data.toString('base64');
    if (f === 'qoi') { const q = qoiDecode(thumb.data); return 'data:image/png;base64,' + pngEncode(q.width, q.height, q.rgba).toString('base64'); }
  } catch { /* испорченная картинка - покажем 3D без неё */ }
  return null;
}

/** Самая подходящая для плитки: наименьшая не меньше want по ширине, иначе самая большая. */
function pick(list, want = 240) {
  const ok = (list || []).filter((t) => t && t.data && t.data.length && ['png', 'jpg', 'qoi'].includes(formatOf(t.data)));
  if (!ok.length) return null;
  const big = ok.filter((t) => t.width >= want).sort((a, b) => a.width - b.width);
  return big[0] || ok.sort((a, b) => b.width - a.width)[0];
}

module.exports = { gcodeThumbnails, formatOf, qoiDecode, pngEncode, toDataUrl, pick, QoiError };
