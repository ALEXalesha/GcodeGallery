// Очередь превью: видимые плитки - первыми (сверху вниз), остальные - потом, в фоне. Видимость
// меняется при прокрутке - очередь переставляется. Одновременно не больше limit заданий.
// Каждый ключ выполняется один раз (пока его не сбросили через invalidate).

export class PreviewQueue {
  /** @param {{run: (key) => Promise<any>, limit?: number, onDone?: (key, result, error) => void}} o */
  constructor({ run, limit = 2, onDone = () => {} }) {
    this.run = run;
    this.limit = limit;
    this.onDone = onDone;
    this.pending = new Map();     // key -> {order, visible}
    this.active = new Set();
    this.done = new Set();
    this.again = new Set();     // поменялись во время разбора - разобрать ещё раз
    this.seq = 0;
    this.paused = false;
  }

  /** Поставить ключи в очередь (порядок - как в ленте). Уже сделанные и идущие не повторяются. */
  add(keys) {
    for (const k of keys) {
      if (this.done.has(k) || this.active.has(k)) continue;
      if (!this.pending.has(k)) this.pending.set(k, { order: this.seq++, visible: false });
    }
    this.pump();
  }

  /** Какие ключи сейчас на экране (по порядку сверху вниз). */
  setVisible(keys) {
    const rank = new Map(keys.map((k, i) => [k, i]));
    for (const [k, p] of this.pending) { p.visible = rank.has(k); p.rank = rank.has(k) ? rank.get(k) : Infinity; }
    for (const k of keys) if (!this.pending.has(k) && !this.done.has(k) && !this.active.has(k)) this.pending.set(k, { order: this.seq++, visible: true, rank: rank.get(k) });
    this.pump();
  }

  /** Файл изменился - сделать заново. */
  invalidate(key) { if (this.active.has(key)) this.again.add(key); this.done.delete(key); this.add([key]); }

  /** Файл пропал из папки. */
  remove(key) { this.pending.delete(key); this.done.delete(key); this.again.delete(key); }

  next() {
    let best = null, bestP = null;
    for (const [k, p] of this.pending) {
      if (!bestP || (p.visible && !bestP.visible) || (p.visible === bestP.visible && ((p.visible ? p.rank - bestP.rank : 0) || p.order - bestP.order) < 0)) { best = k; bestP = p; }
    }
    return best;
  }

  pump() {
    while (!this.paused && this.active.size < this.limit && this.pending.size) {
      const k = this.next();
      this.pending.delete(k);
      this.active.add(k);
      Promise.resolve().then(() => this.run(k)).then((r) => this._finish(k, r, null), (e) => this._finish(k, null, e));
    }
  }

  _finish(k, r, e) {
    this.active.delete(k);
    if (this.again.delete(k)) this.pending.set(k, { order: this.seq++, visible: false });
    else this.done.add(k);
    try { this.onDone(k, r, e); } finally { this.pump(); }
  }

  get idle() { return this.active.size === 0 && this.pending.size === 0; }
  clear() { this.pending.clear(); this.done.clear(); this.again.clear(); }
}
