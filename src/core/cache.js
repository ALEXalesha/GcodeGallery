// Кэш разбора по пути + размеру + времени изменения: большая папка второй раз открывается
// сразу. Лежит в папке данных программы (userData/cache), рядом с файлами печати ничего не пишется.
//   index.json         ключ -> {path, size, mtimeMs, info, used}
//   <ключ>.thumb.txt   картинка из файла (data URL)
//   <ключ>.view.bin    ужатый 3D-вид (src/core/toolpath.js serialize)
//   <ключ>.shot.txt    снимок 3D-плитки из окна (data URL) - чтобы не рисовать заново
// Испорченный индекс - пустой кэш, не падение. Запись атомарная (временный файл + rename).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { serialize, deserialize } = require('./toolpath');

const FORMAT = 2;

function keyOf(file, size, mtimeMs, version = 0) {
  return crypto.createHash('sha1').update(`${path.resolve(file)}\n${size}\n${Math.round(mtimeMs)}\n${version}`).digest('hex').slice(0, 32);
}

function atomicWrite(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

class Cache {
  /** @param {{dir: string, version?: number, maxEntries?: number}} o */
  constructor({ dir, version = 0, maxEntries = 20000 }) {
    this.dir = dir;
    this.version = version;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.dirty = false;
    this.clock = 0;
    fs.mkdirSync(dir, { recursive: true });
    this.load();
  }

  load() {
    this.entries.clear();
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(this.dir, 'index.json'), 'utf8')); } catch { j = null; }
    if (!j || j.format !== FORMAT || j.version !== this.version || !j.entries || typeof j.entries !== 'object') return;
    for (const [k, e] of Object.entries(j.entries)) {
      if (e && typeof e.path === 'string' && Number.isFinite(e.size) && Number.isFinite(e.mtimeMs) && e.info && typeof e.info === 'object') {
        this.entries.set(k, e);
        this.clock = Math.max(this.clock, e.used || 0);
      }
    }
  }

  key(file, size, mtimeMs) { return keyOf(file, size, mtimeMs, this.version); }

  /** Сведения, если файл не менялся; иначе null. */
  get(file, size, mtimeMs) {
    const e = this.entries.get(this.key(file, size, mtimeMs));
    if (!e) return null;
    e.used = ++this.clock;
    this.dirty = true;
    return e.info;
  }

  has(file, size, mtimeMs) { return this.entries.has(this.key(file, size, mtimeMs)); }

  put(file, size, mtimeMs, { info, thumb = null, view = null }) {
    const k = this.key(file, size, mtimeMs);
    if (thumb) atomicWrite(path.join(this.dir, k + '.thumb.txt'), thumb);
    if (view) atomicWrite(path.join(this.dir, k + '.view.bin'), serialize(view));
    this.entries.set(k, { path: path.resolve(file), size, mtimeMs: Math.round(mtimeMs), info, thumb: !!thumb, view: !!view, used: ++this.clock });
    this.dirty = true;
    this.trim();
    return k;
  }

  thumb(file, size, mtimeMs) { return this._read(this.key(file, size, mtimeMs) + '.thumb.txt', 'utf8'); }

  view(file, size, mtimeMs) {
    const buf = this._read(this.key(file, size, mtimeMs) + '.view.bin');
    if (!buf) return null;
    try { return deserialize(buf); } catch { return null; }
  }

  shot(file, size, mtimeMs) { return this._read(this.key(file, size, mtimeMs) + '.shot.txt', 'utf8'); }

  putShot(file, size, mtimeMs, dataUrl) {
    const k = this.key(file, size, mtimeMs);
    if (!this.entries.has(k) || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || dataUrl.length > 4e6) return false;
    atomicWrite(path.join(this.dir, k + '.shot.txt'), dataUrl);
    return true;
  }

  _read(name, enc) {
    try { return fs.readFileSync(path.join(this.dir, name), enc); } catch { return null; }
  }

  /** Самые давние записи сверх maxEntries - вон вместе с файлами. */
  trim() {
    if (this.entries.size <= this.maxEntries) return 0;
    const old = [...this.entries.entries()].sort((a, b) => (a[1].used || 0) - (b[1].used || 0)).slice(0, this.entries.size - this.maxEntries);
    for (const [k] of old) this.drop(k);
    return old.length;
  }

  drop(k) {
    this.entries.delete(k);
    for (const ext of ['.thumb.txt', '.view.bin', '.shot.txt']) { try { fs.unlinkSync(path.join(this.dir, k + ext)); } catch { /* не было */ } }
    this.dirty = true;
  }

  save() {
    if (!this.dirty) return false;
    atomicWrite(path.join(this.dir, 'index.json'), JSON.stringify({ format: FORMAT, version: this.version, entries: Object.fromEntries(this.entries) }));
    this.dirty = false;
    return true;
  }

  get size() { return this.entries.size; }
}

module.exports = { Cache, keyOf };
