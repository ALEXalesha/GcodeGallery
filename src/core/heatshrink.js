// Распаковка heatshrink (LZSS) - так PrusaSlicer сжимает блоки .bgcode (сжатие 2: окно 2^11,
// сжатие 3: окно 2^12, просмотр вперёд 2^4). Поток битов старшим вперёд: 1 + 8 бит - байт как
// есть; 0 + W бит (расстояние - 1) + L бит (длина - 1) - повтор уже выданного.
'use strict';

class HeatshrinkError extends Error {
  constructor(msg) { super(msg); this.code = 'bad-heatshrink'; }
}

/**
 * @param {Uint8Array} src сжатые данные
 * @param {number} windowBits W
 * @param {number} lookaheadBits L
 * @param {number} expected сколько байт должно получиться (из заголовка блока); больше не выдаём
 * @returns {Buffer}
 */
function decode(src, windowBits, lookaheadBits, expected) {
  if (!(windowBits >= 4 && windowBits <= 15) || !(lookaheadBits >= 3 && lookaheadBits < windowBits)) throw new HeatshrinkError('bad parameters');
  const out = Buffer.alloc(expected);
  let n = 0;
  let pos = 0, bit = 0;
  const totalBits = src.length * 8;
  const read = (count) => {
    let v = 0;
    for (let i = 0; i < count; i++) {
      v = (v << 1) | ((src[pos] >> (7 - bit)) & 1);
      if (++bit === 8) { bit = 0; pos++; }
    }
    return v;
  };
  const left = () => totalBits - (pos * 8 + bit);
  while (n < expected && left() >= 1) {
    if (read(1)) {
      if (left() < 8) break;
      out[n++] = read(8);
    } else {
      if (left() < windowBits + lookaheadBits) break;
      const dist = read(windowBits) + 1;
      const len = read(lookaheadBits) + 1;
      if (dist > n) throw new HeatshrinkError('reference before the start');
      for (let i = 0; i < len && n < expected; i++, n++) out[n] = out[n - dist];
    }
  }
  if (n !== expected) throw new HeatshrinkError(`got ${n} bytes of ${expected}`);
  return out;
}

module.exports = { decode, HeatshrinkError };
