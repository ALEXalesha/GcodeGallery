// Настройки программы (userData/settings.json): папка, вид, тема, язык, цена катушки, принтер.
// Всё, что пришло из окна или файла, проходит clean: неизвестное и неверное - значение по умолчанию.
'use strict';
const fs = require('fs');
const path = require('path');

const THEMES = ['dark', 'light', 'formal', 'night', 'warm'];
const SORTS = ['name', 'date', 'time', 'weight', 'size', 'sliced'];
const DEFAULTS = Object.freeze({
  folder: '', recursive: true, theme: 'dark', lang: 'ru', view: 'grid', tileSize: 220, sort: 'date', sortDir: 'desc',
  spoolPrice: 1500, spoolGrams: 1000, currency: '₽', printerHost: '', colorMode: 'type', recent: [],
});

const pick = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, min, max, d) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : d);

/** Адрес принтера: IP или имя, порт по желанию; «http://» и хвост пути срезаются. Неверный - ''. */
function cleanHost(s) {
  if (typeof s !== 'string') return '';
  const v = s.trim().replace(/^(?:https?|wss?):\/\//i, '').replace(/\/.*$/, '');
  if (v === '') return '';
  return /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(v) && !/^[.-]|[.-]$/.test(v.split(':')[0]) ? v : '';
}

function clean(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    folder: typeof o.folder === 'string' && o.folder.length < 4096 ? o.folder : DEFAULTS.folder,
    recursive: typeof o.recursive === 'boolean' ? o.recursive : DEFAULTS.recursive,
    theme: pick(o.theme, THEMES, DEFAULTS.theme),
    lang: pick(o.lang, ['ru', 'en'], DEFAULTS.lang),
    view: pick(o.view, ['grid', 'strip'], DEFAULTS.view),
    tileSize: Math.round(num(o.tileSize, 140, 420, DEFAULTS.tileSize)),
    sort: pick(o.sort, SORTS, DEFAULTS.sort),
    sortDir: pick(o.sortDir, ['asc', 'desc'], DEFAULTS.sortDir),
    spoolPrice: num(o.spoolPrice, 0, 1e6, DEFAULTS.spoolPrice),
    spoolGrams: num(o.spoolGrams, 1, 1e5, DEFAULTS.spoolGrams),
    currency: typeof o.currency === 'string' && o.currency.trim().length <= 4 ? o.currency.trim() : DEFAULTS.currency,
    printerHost: cleanHost(o.printerHost),
    colorMode: pick(o.colorMode, ['type', 'filament'], DEFAULTS.colorMode),
    recent: Array.isArray(o.recent) ? [...new Set(o.recent.filter((x) => typeof x === 'string' && x && x.length < 4096))].slice(0, 8) : [],
  };
}

function load(file) {
  try { return clean(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return clean({}); }
}

function save(file, s) {
  const c = clean(s);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(c, null, 1));
  fs.renameSync(file + '.tmp', file);
  return c;
}

/**
 * Можно ли окну открыть папку без диалога выбора (R8): только ту, что человек уже выбирал
 * (последние папки), и те, что разрешил главный процесс (extra). Любой другой путь - нет.
 */
function canOpen(folder, s, { extra = [], caseInsensitive = process.platform === 'win32' } = {}) {
  if (typeof folder !== 'string' || !folder.trim()) return false;
  const norm = (p) => { const r = path.resolve(p); return caseInsensitive ? r.toLowerCase() : r; };
  const want = norm(folder);
  const allowed = [...((s && s.recent) || []), ...extra].filter((x) => typeof x === 'string' && x);
  return allowed.some((x) => norm(x) === want);
}

module.exports = { clean, cleanHost, canOpen, load, save, DEFAULTS, THEMES, SORTS };
