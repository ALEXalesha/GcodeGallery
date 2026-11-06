// Библиотека главного процесса: открытая папка, список файлов, слежение, кэш, отметки и
// очередь разбора в потоках-работниках. Без Electron - проверяется обычными тестами.
// Окно получает: список (сразу, со сведениями из кэша), превью по запросу (видимые плитки
// первыми - очередь в окне), полный разбор для большого окна.
'use strict';
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { scanFolder, watchFolder } = require('../src/core/scan');
const { Cache } = require('../src/core/cache');
const { Marks } = require('../src/core/marks');
const { processFile, VERSION } = require('../src/core/item');

/** Пул потоков-работников; inline: true - разбор в этом же потоке (тесты, запасной путь). */
class Pool {
  constructor({ size = Math.max(1, Math.min(4, os.cpus().length - 1)), inline = false } = {}) {
    this.inline = inline;
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.waiting = new Map();
    this.seq = 0;
  }

  _spawn() {
    const w = new Worker(path.join(__dirname, 'worker.js'));
    w.busy = null;
    w.on('message', (m) => {
      const job = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      w.busy = null;
      w.unref();                      // без заданий работник не держит процесс
      if (job) { if (m.error) job.reject(Object.assign(new Error(m.error.message), { code: m.error.code })); else job.resolve(m.result); }
      this._pump();
    });
    w.on('error', (e) => {
      if (w.busy) { const job = this.waiting.get(w.busy); this.waiting.delete(w.busy); if (job) job.reject(e); }
      this.workers = this.workers.filter((x) => x !== w);
      this._pump();
    });
    w.unref();
    this.workers.push(w);
    return w;
  }

  run(file, opts = {}) {
    if (this.inline) return new Promise((resolve, reject) => setImmediate(() => { try { resolve(processFile(file, opts)); } catch (e) { reject(e); } }));
    return new Promise((resolve, reject) => { this.queue.push({ id: ++this.seq, file, opts, resolve, reject }); this._pump(); });
  }

  _pump() {
    while (this.queue.length) {
      let w = this.workers.find((x) => !x.busy);
      if (!w && this.workers.length < this.size) w = this._spawn();
      if (!w) return;
      const job = this.queue.shift();
      w.busy = job.id;
      w.ref();
      this.waiting.set(job.id, job);
      w.postMessage({ id: job.id, file: job.file, opts: job.opts });
    }
  }

  close() { for (const w of this.workers) w.terminate(); this.workers = []; }
}

class Library {
  /**
   * @param {{dataDir: string, inline?: boolean, onItems?: (change) => void, pollMs?: number, debounceMs?: number}} o
   */
  constructor({ dataDir, inline = false, onItems = () => {}, pollMs = 30000, debounceMs = 400, workers, caseInsensitive }) {
    this.cache = new Cache({ dir: path.join(dataDir, 'cache'), version: VERSION });
    this.marks = new Marks(path.join(dataDir, 'marks.json'), caseInsensitive === undefined ? {} : { caseInsensitive });
    this.pool = new Pool({ inline, size: workers });
    this.onItems = onItems;
    this.pollMs = pollMs;
    this.debounceMs = debounceMs;
    this.folder = '';
    this.openSeq = 0;
    this.recursive = true;
    this.files = new Map();
    this.watcher = null;
    this.inflight = new Map();
    this.saveTimer = null;
  }

  _item(f) {
    const info = this.cache.get(f.path, f.size, f.mtimeMs);
    return { path: f.path, name: f.name, rel: f.rel, dir: f.dir, kind: f.kind, size: f.size, mtimeMs: f.mtimeMs, info: info || null };
  }

  /** Открыть папку: список сразу (сведения - из кэша, у новых - null), дальше слежение. */
  async open(folder, { recursive = true } = {}) {
    // Открыли другую папку, пока обходили эту: эта уже не нужна - ответ помечен stale, ни списка,
    // ни слежения от неё не остаётся (R4).
    const seq = ++this.openSeq;
    const dir = path.resolve(folder);
    const list = await scanFolder(dir, { recursive });
    if (seq !== this.openSeq) return { folder: dir, stale: true, items: [], marks: {} };
    this.close();
    this.folder = dir;
    this.recursive = recursive;
    this.files = new Map(list.map((f) => [f.path, f]));
    this.watcher = watchFolder(this.folder, { recursive, initial: list, pollMs: this.pollMs, debounceMs: this.debounceMs, onChange: (d) => this._changed(d) });
    return { folder: this.folder, items: list.map((f) => this._item(f)), marks: this.folderMarks() };
  }

  _changed(d) {
    for (const f of d.removed) this.files.delete(f.path);
    for (const f of [...d.added, ...d.changed]) this.files.set(f.path, f);
    this.onItems({ folder: this.folder, added: d.added.map((f) => this._item(f)), changed: d.changed.map((f) => this._item(f)), removed: d.removed.map((f) => f.path) });
  }

  items() { return [...this.files.values()].map((f) => this._item(f)); }

  /** Только файлы открытой папки: окно не может попросить прочитать что-то другое. */
  _file(p) {
    const f = this.files.get(path.resolve(String(p || '')));
    if (!f) throw Object.assign(new Error('not in the folder'), { code: 'unknown-file' });
    return f;
  }

  /**
   * Превью плитки: сведения, картинка из файла, снимок 3D (если уже рисовали) и - по запросу - ужатый вид.
   * Не менялся файл - всё из кэша, без чтения файла.
   */
  async preview(p, { view = true } = {}) {
    const f = this._file(p);
    let info = this.cache.get(f.path, f.size, f.mtimeMs);
    if (!info) {
      const key = f.path + '|' + f.size + '|' + f.mtimeMs;
      if (!this.inflight.has(key)) {
        this.inflight.set(key, this.pool.run(f.path, { budget: 150000 }).then((r) => {
          this.cache.put(f.path, f.size, f.mtimeMs, r);
          this._saveSoon();
          return r;
        }).finally(() => this.inflight.delete(key)));
      }
      const r = await this.inflight.get(key);
      return { path: f.path, info: r.info, thumb: r.thumb, shot: this.cache.shot(f.path, f.size, f.mtimeMs), view: view ? r.view : null };
    }
    const shot = this.cache.shot(f.path, f.size, f.mtimeMs);
    return { path: f.path, info, thumb: this.cache.thumb(f.path, f.size, f.mtimeMs), shot, view: view && (!shot || view === 'always') ? this.cache.view(f.path, f.size, f.mtimeMs) : null };
  }

  /** Ужатый вид для живой плитки (наведение). */
  async view(p) {
    const f = this._file(p);
    const v = this.cache.view(f.path, f.size, f.mtimeMs);
    if (v) return v;
    return (await this.preview(p, { view: 'always' })).view;
  }

  /** Полный разбор для большого окна: все настройки и больше отрезков. Не кэшируется. */
  async detail(p) {
    const f = this._file(p);
    const r = await this.pool.run(f.path, { budget: 2000000, detail: true });
    return { path: f.path, info: r.info, thumb: r.thumb, view: r.view };
  }

  saveShot(p, dataUrl) {
    const f = this._file(p);
    return this.cache.putShot(f.path, f.size, f.mtimeMs, dataUrl);
  }

  /** Отметки файлов открытой папки по их настоящему пути (как их видит окно). */
  folderMarks() {
    const out = {};
    for (const p of this.files.keys()) { const m = this.marks.get(p); if (m) out[p] = m; }
    return out;
  }

  mark(p, patch) { return this.marks.set(this._file(p).path, patch); }

  has(p) { return this.files.has(path.resolve(String(p || ''))); }

  _saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.cache.save(), 1500);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }

  close() {
    if (this.watcher) this.watcher.close();
    this.watcher = null;
    clearTimeout(this.saveTimer);
    this.cache.save();
  }

  dispose() { this.close(); this.pool.close(); }
}

module.exports = { Library, Pool };
