// Отметки к файлам: избранное, свои метки, заметка, «напечатано / не печаталось». Хранятся
// отдельно (userData/marks.json) по полному пути файла; сами файлы печати не трогаются никогда.
'use strict';
const fs = require('fs');
const path = require('path');

const PRINTED = ['', 'yes', 'no'];
const MAX_TAGS = 20, MAX_TAG = 40, MAX_NOTE = 2000;

/** Метки: строки без пробелов по краям, без повторов (без учёта регистра), не длиннее MAX_TAG. */
function cleanTags(tags) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(tags) ? tags : []) {
    if (typeof t !== 'string') continue;
    const v = t.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG);
    const low = v.toLowerCase();
    if (!v || seen.has(low)) continue;
    seen.add(low);
    out.push(v);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Отметка только из известных полей с проверкой; пустая - null. */
function cleanMark(m) {
  if (!m || typeof m !== 'object') return null;
  const out = {
    favorite: m.favorite === true,
    tags: cleanTags(m.tags),
    note: typeof m.note === 'string' ? m.note.slice(0, MAX_NOTE) : '',
    printed: PRINTED.includes(m.printed) ? m.printed : '',
  };
  if (Number.isFinite(m.printedAt) && out.printed === 'yes') out.printedAt = Math.round(m.printedAt);
  return out.favorite || out.tags.length || out.note.trim() || out.printed ? out : null;
}

const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

class Marks {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    let j = null;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { j = null; }
    if (j && j.marks && typeof j.marks === 'object') {
      for (const [p, m] of Object.entries(j.marks)) { const c = cleanMark(m); if (c) this.map.set(p, c); }
    }
  }

  get(p) { return this.map.get(norm(p)) || null; }

  /** Поменять поля отметки (patch), вернуть итог; пустая отметка удаляется. */
  set(p, patch) {
    const k = norm(p);
    const cur = this.map.get(k) || { favorite: false, tags: [], note: '', printed: '' };
    const next = cleanMark(Object.assign({}, cur, patch && typeof patch === 'object' ? patch : {}));
    if (next) this.map.set(k, next); else this.map.delete(k);
    this.save();
    return next;
  }

  all() { return Object.fromEntries(this.map); }

  /** Все метки по алфавиту - для фильтра. */
  tags() {
    const set = new Map();
    for (const m of this.map.values()) for (const t of m.tags) if (!set.has(t.toLowerCase())) set.set(t.toLowerCase(), t);
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ format: 1, marks: Object.fromEntries(this.map) }));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Marks, cleanMark, cleanTags, PRINTED };
