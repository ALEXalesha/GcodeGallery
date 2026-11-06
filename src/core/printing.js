// Отправка на принтер Elegoo (SDCP, тот же код, что в Slicer CC - src/shared/send.js).
// Закон Алексея «без кнопки не печатает»: печать стартует только с жетоном, а жетон выдаётся
// только после ответа «Печатать» в окне подтверждения главного процесса (confirm - системное
// окно, код окна программы его не нажмёт; R3) - одноразовый, на этот файл и ненадолго.
// Без жетона - только загрузка файла на принтер (start: false), старт не уходит.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendToPrinter } = require('../shared/send');
const { readZip } = require('../shared/zip');
const { kindOf } = require('./formats');
const { safeBase } = require('../shared/names');

class PrintError extends Error {
  constructor(code, detail) { super(code + (detail ? ': ' + detail : '')); this.code = code; this.detail = detail || ''; }
}

/** G-code для принтера: .gcode как есть, из .gcode.3mf - первая пластина; остальное не печатается. */
function gcodeFor(file, readFile = fs.readFileSync) {
  const kind = kindOf(file);
  if (kind === 'gcode') {
    const buf = readFile(file);
    if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'GCDE') throw new PrintError('format', 'bgcode');
    return buf;
  }
  if (kind === 'gcode3mf' || kind === '3mf') {
    let files;
    try { files = readZip(readFile(file)); } catch (e) { throw new PrintError('format', e.message); }
    const plate = [...files.keys()].filter((k) => /^Metadata\/plate_\d+\.gcode$/i.test(k)).sort((a, b) => parseInt(a.slice(15), 10) - parseInt(b.slice(15), 10))[0];
    if (!plate) throw new PrintError('format', 'no plate');
    return files.get(plate);
  }
  throw new PrintError('format', kind || path.extname(file));
}

function remoteNameFor(file) {
  const base = path.basename(file).replace(/\.gcode\.3mf$/i, '').replace(/\.(gcode|gco|g|3mf)$/i, '');
  return (safeBase(base, 50) || 'print') + '.gcode';
}

class Printing {
  constructor({ send = sendToPrinter, readFile = fs.readFileSync, now = Date.now, ttlMs = 120000, confirm = async () => false } = {}) {
    this.confirm = confirm;
    this.send = send;
    this.readFile = readFile;
    this.now = now;
    this.ttlMs = ttlMs;
    this.tokens = new Map();      // жетон -> {file, at}
    this.busy = false;
  }

  /** Жетон на одну печать этого файла: только если человек ответил «Печатать» (confirm). */
  async arm(file, info = {}) {
    if ((await this.confirm(path.resolve(file), info)) !== true) throw new PrintError('declined');
    const token = crypto.randomBytes(16).toString('hex');
    this.tokens.set(token, { file: path.resolve(file), at: this.now() });
    return token;
  }

  _consume(token, file) {
    if (typeof token !== 'string') return false;
    const t = this.tokens.get(token);
    this.tokens.delete(token);
    for (const [k, v] of this.tokens) if (this.now() - v.at > this.ttlMs) this.tokens.delete(k);
    return !!t && t.file === path.resolve(file) && this.now() - t.at <= this.ttlMs;
  }

  /**
   * @param {{file, host, start?: boolean, token?: string, onStep?, signal?}} o
   * start: true - нужен жетон; без жетона - ошибка 'no-button', на принтер не уходит ничего.
   */
  async run({ file, host, start = false, token = null, onStep = () => {}, signal = null }) {
    if (start === true && !this._consume(token, file)) throw new PrintError('no-button');
    if (!host) throw new PrintError('no-host');
    if (this.busy) throw new PrintError('busy-sending');
    const buffer = gcodeFor(file, this.readFile);
    this.busy = true;
    try {
      return await this.send({ host, buffer, remoteName: remoteNameFor(file), start: start === true, onStep, signal });
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Printing, PrintError, gcodeFor, remoteNameFor };
