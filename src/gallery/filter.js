// Поиск, фильтры и сортировка ленты. Чистые функции без окна (проверяются в node).
// item: {path, name, rel, size, mtimeMs, kind, info?}; info - сведения из src/core/item.js.
// marks: {путь: {favorite, tags, note, printed}}.

export const EMPTY = Object.freeze({ query: '', types: [], kinds: [], favorite: false, printed: '', tag: '', timeMin: null, timeMax: null, weightMin: null, weightMax: null, dateFrom: null, dateTo: null });

const lower = (s) => String(s || '').toLowerCase();
const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/** Дата для фильтра и сортировки: когда нарезано, иначе когда изменён файл. */
export function dateOf(item) {
  const s = item.info && item.info.slicedAt ? Date.parse(item.info.slicedAt) : NaN;
  return Number.isFinite(s) ? s : item.mtimeMs || 0;
}

/** Совпадает ли с поиском: каждое слово запроса - в имени, папке, пластике, принтере, слайсере, метках или заметке. */
export function matchesQuery(item, query, mark) {
  const words = lower(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const i = item.info || {};
  const hay = [item.name, item.rel, i.filamentType, i.filamentName, i.printer, i.slicer, mark && mark.tags && mark.tags.join(' '), mark && mark.note].map(lower).join('\n');
  return words.every((w) => hay.includes(w));
}

export function matches(item, f, mark) {
  const i = item.info || {};
  if (!matchesQuery(item, f.query, mark)) return false;
  if (f.types && f.types.length && !f.types.some((t) => lower(t) === lower(i.filamentType))) return false;
  if (f.kinds && f.kinds.length && !f.kinds.includes(item.kind)) return false;
  if (f.favorite && !(mark && mark.favorite)) return false;
  if (f.printed === 'yes' && !(mark && mark.printed === 'yes')) return false;
  if (f.printed === 'no' && mark && mark.printed === 'yes') return false;
  if (f.tag && !(mark && mark.tags.some((t) => lower(t) === lower(f.tag)))) return false;
  const range = (v, lo, hi) => (!has(lo) || (has(v) && v >= Number(lo))) && (!has(hi) || (has(v) && v <= Number(hi)));
  if (!range(i.timeSec, f.timeMin, f.timeMax)) return false;
  if (!range(i.filamentG, f.weightMin, f.weightMax)) return false;
  if (!range(dateOf(item), f.dateFrom, f.dateTo)) return false;
  return true;
}

export function filterItems(items, f = EMPTY, marks = {}) {
  const ff = Object.assign({}, EMPTY, f || {});
  return items.filter((it) => matches(it, ff, marks[it.path] || null));
}

const collator = new Intl.Collator(['ru', 'en'], { numeric: true, sensitivity: 'base' });

const KEYS = {
  name: (it) => it.name,
  date: (it) => it.mtimeMs,
  sliced: (it) => dateOf(it),
  time: (it) => (it.info ? it.info.timeSec : null),
  weight: (it) => (it.info ? it.info.filamentG : null),
  size: (it) => it.size,
};

/** Новый массив по ключу; у кого значения нет - в конце при любом направлении; равные - по имени. */
export function sortItems(items, sort = 'date', dir = 'desc') {
  const key = KEYS[sort] || KEYS.date;
  const sign = dir === 'asc' ? 1 : -1;
  const decorated = items.map((it, i) => ({ it, i, k: key(it) }));
  decorated.sort((a, b) => {
    const am = a.k === null || a.k === undefined || (typeof a.k === 'number' && !Number.isFinite(a.k));
    const bm = b.k === null || b.k === undefined || (typeof b.k === 'number' && !Number.isFinite(b.k));
    if (am !== bm) return am ? 1 : -1;
    let c = 0;
    if (!am) c = typeof a.k === 'string' ? collator.compare(a.k, b.k) : a.k - b.k;
    if (c) return c * sign;
    return collator.compare(a.it.name, b.it.name) || (a.it.path < b.it.path ? -1 : a.it.path > b.it.path ? 1 : 0) || a.i - b.i;
  });
  return decorated.map((d) => d.it);
}

/** Что есть в папке - для списков фильтра: типы пластика, виды файлов. */
export function facets(items) {
  const types = new Map();
  const kinds = new Set();
  for (const it of items) {
    if (it.kind) kinds.add(it.kind);
    const t = it.info && it.info.filamentType;
    if (t && !types.has(lower(t))) types.set(lower(t), t);
  }
  return { types: [...types.values()].sort(collator.compare), kinds: [...kinds].sort() };
}

/** Сколько фильтров включено (для значка на кнопке). */
export function activeCount(f) {
  const ff = Object.assign({}, EMPTY, f || {});
  return [ff.types.length > 0, ff.kinds.length > 0, ff.favorite, !!ff.printed, !!ff.tag, has(ff.timeMin) || has(ff.timeMax), has(ff.weightMin) || has(ff.weightMax), has(ff.dateFrom) || has(ff.dateTo)].filter(Boolean).length;
}

/** Поле «дата» -> миллисекунды: начало дня (from) или конец (to) по местному времени (R10). */
export function inputToDate(value, end) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

/** Миллисекунды -> поле «дата» (YYYY-MM-DD по местному времени, не UTC - иначе день съезжает). */
export function dateToInput(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
