// Двоичный G-code PrusaSlicer (.bgcode, спецификация libbgcode): заголовок «GCDE», версия,
// тип контрольной суммы; дальше блоки: метаданные (INI «ключ=значение»), картинки, G-code.
// Блок: тип u16, сжатие u16, размер u32 [, сжатый размер u32], параметры, данные [, CRC32].
// Сжатие: 0 нет, 1 deflate, 2 heatshrink 11/4, 3 heatshrink 12/4. G-code: 0 текст,
// 1 MeatPack, 2 MeatPack с комментариями.
'use strict';
const zlib = require('zlib');
const Heatshrink = require('./heatshrink');
const MeatPack = require('./meatpack');

const MAGIC = 0x45444347;     // 'GCDE' в порядке little-endian
const BLOCK = Object.freeze({ FILE: 0, GCODE: 1, SLICER: 2, PRINTER: 3, PRINT: 4, THUMBNAIL: 5 });
const THUMB_FORMAT = ['png', 'jpg', 'qoi'];

class BgcodeError extends Error {
  constructor(msg) { super(msg); this.code = 'bad-bgcode'; }
}

function isBgcode(buf) {
  return !!buf && buf.length >= 10 && buf.readUInt32LE(0) === MAGIC;
}

function inflate(data, compression, size) {
  if (compression === 0) return Buffer.from(data);
  if (compression === 1) return zlib.inflateSync(data, { maxOutputLength: Math.max(1, size) });
  if (compression === 2) return Heatshrink.decode(data, 11, 4, size);
  if (compression === 3) return Heatshrink.decode(data, 12, 4, size);
  throw new BgcodeError('unknown compression ' + compression);
}

function parseIni(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * @param {Buffer} buf
 * @param {{gcode?: boolean}} opts gcode: false - только метаданные и картинки (быстро)
 * @returns {{version, fileMeta, printerMeta, printMeta, slicerMeta, thumbnails: Array<{format, width, height, data}>, gcode: string|null, blocks: number}}
 */
function parseBgcode(buf, { gcode = true } = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (!isBgcode(buf)) throw new BgcodeError('no GCDE header');
  const version = buf.readUInt32LE(4);
  const checksum = buf.readUInt16LE(8);
  if (checksum > 1) throw new BgcodeError('unknown checksum ' + checksum);
  const res = { version, fileMeta: {}, printerMeta: {}, printMeta: {}, slicerMeta: {}, thumbnails: [], gcode: null, blocks: 0 };
  const parts = [];
  let p = 10;
  while (p < buf.length) {
    if (p + 8 > buf.length) throw new BgcodeError('cut block header');
    const type = buf.readUInt16LE(p), compression = buf.readUInt16LE(p + 2), size = buf.readUInt32LE(p + 4);
    const headLen = compression === 0 ? 8 : 12;
    if (p + headLen > buf.length) throw new BgcodeError('cut block header');
    const stored = compression === 0 ? size : buf.readUInt32LE(p + 8);
    const paramLen = type === BLOCK.THUMBNAIL ? 6 : 2;
    if (type > BLOCK.THUMBNAIL) throw new BgcodeError('unknown block ' + type);
    const dataStart = p + headLen + paramLen;
    const end = dataStart + stored + (checksum ? 4 : 0);
    if (end > buf.length) throw new BgcodeError('cut block');
    if (checksum) {
      const want = buf.readUInt32LE(dataStart + stored);
      if ((zlib.crc32(buf.subarray(p, dataStart + stored)) >>> 0) !== want) throw new BgcodeError('crc mismatch in block ' + res.blocks);
    }
    const param = buf.readUInt16LE(p + headLen);
    const raw = buf.subarray(dataStart, dataStart + stored);
    res.blocks++;
    if (type === BLOCK.THUMBNAIL) {
      const width = buf.readUInt16LE(p + headLen + 2), height = buf.readUInt16LE(p + headLen + 4);
      res.thumbnails.push({ format: THUMB_FORMAT[param] || 'unknown', width, height, data: inflate(raw, compression, size) });
    } else if (type === BLOCK.GCODE) {
      if (gcode) {
        const data = inflate(raw, compression, size);
        if (param === 0) parts.push(data.toString('utf8'));
        else if (param === 1 || param === 2) parts.push(MeatPack.decode(data));
        else throw new BgcodeError('unknown gcode encoding ' + param);
      }
    } else {
      if (param !== 0) throw new BgcodeError('unknown metadata encoding ' + param);
      const ini = parseIni(inflate(raw, compression, size).toString('utf8'));
      const key = { [BLOCK.FILE]: 'fileMeta', [BLOCK.SLICER]: 'slicerMeta', [BLOCK.PRINTER]: 'printerMeta', [BLOCK.PRINT]: 'printMeta' }[type];
      Object.assign(res[key], ini);
    }
    p = end;
  }
  if (gcode) res.gcode = parts.join('');
  return res;
}

module.exports = { parseBgcode, isBgcode, parseIni, BgcodeError, BLOCK, MAGIC };
