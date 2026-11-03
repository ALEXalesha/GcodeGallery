// Распаковка MeatPack - кодировка G-code в блоках .bgcode (кодировка 1 и 2). Частые символы
// по 4 бита, два в байте: младшие 4 бита - первый символ. 0b1111 - символ идёт следующим
// целым байтом. 0xFF 0xFF <команда> - включить/выключить упаковку и режим «без пробелов».
// В режиме без пробелов код 11 - буква E, а пробелы в строках G вставляются обратно перед
// параметрами (так же делает libbgcode, иначе «G1X10Y5» не разобрать).
'use strict';

const SIGNAL = 0xff;
const CMD = Object.freeze({ ENABLE: 251, DISABLE: 250, RESET: 249, QUERY: 248, NOSPACE_ON: 247, NOSPACE_OFF: 246 });
const TABLE = '0123456789. \nGX';
const PARAMS = new Set('XYZEFIJRSGPWHCA');

function decode(src) {
  let packing = false, nospace = false;
  let signals = 0;
  let pendingFull = 0;
  let held = -1;                              // второй символ байта, ждущий первого целого
  const out = [];
  let addSpace = false;
  let last = -1;

  const emit = (c) => {
    if (c === 0x47 /* G */ && (last === -1 || last === 0x0a)) { addSpace = true; push(c); return; }
    if (c === 0x0a) addSpace = false;
    else if (addSpace && last !== 0x20 && PARAMS.has(String.fromCharCode(c))) push(0x20);
    if (c !== 0x0a || last !== 0x0a) push(c);
  };
  const push = (c) => { out.push(c); last = c; };
  const nibble = (v) => (v === 11 && nospace ? 0x45 : TABLE.charCodeAt(v));

  const take = (b) => {
    if (!packing) { emit(b); return; }
    if (pendingFull > 0) {
      emit(b);
      if (held >= 0) { emit(held); held = -1; }
      pendingFull--;
      return;
    }
    const lo = b & 0x0f, hi = (b >> 4) & 0x0f;
    if (lo === 0x0f) {
      pendingFull = hi === 0x0f ? 2 : 1;
      if (hi !== 0x0f) held = nibble(hi);
      return;
    }
    const first = nibble(lo);
    emit(first);
    if (first === 0x0a) return;               // после перевода строки вторая половина - заполнитель
    if (hi === 0x0f) pendingFull = 1;
    else emit(nibble(hi));
  };

  for (let i = 0; i < src.length; i++) {
    const b = src[i];
    if (b === SIGNAL) {
      if (signals > 0) { signals = 0; i++; if (i < src.length) command(src[i]); }
      else signals = 1;
      continue;
    }
    if (signals > 0) { take(SIGNAL); signals = 0; }
    take(b);
  }
  function command(c) {
    if (c === CMD.ENABLE) packing = true;
    else if (c === CMD.DISABLE || c === CMD.RESET) packing = false;
    else if (c === CMD.NOSPACE_ON) nospace = true;
    else if (c === CMD.NOSPACE_OFF) nospace = false;
  }
  return Buffer.from(out).toString('utf8');
}

module.exports = { decode, CMD, TABLE };
