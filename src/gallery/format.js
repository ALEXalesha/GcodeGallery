// Подписи под плиткой: время, граммы, деньги, размеры. Чистые функции (проверяются в node).
import { t, plural } from './i18n.js';

const DASH = '-';

export function duration(sec, l) {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return DASH;
  let s = Math.round(sec);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d} ${t('u.d', {}, l)} ${h} ${t('u.h', {}, l)}`;
  if (h) return `${h} ${t('u.h', {}, l)} ${m} ${t('u.m', {}, l)}`;
  if (m) return `${m} ${t('u.m', {}, l)}`;
  return `${s} ${t('u.s', {}, l)}`;
}

export function num(v, digits = 1, l) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return v.toLocaleString(l === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function grams(g, l) {
  if (g === null || g === undefined || !Number.isFinite(g)) return DASH;
  return g >= 1000 ? `${num(g / 1000, 2, l)} ${t('u.kg', {}, l)}` : `${num(g, g < 10 ? 2 : 1, l)} ${t('u.g', {}, l)}`;
}

export function meters(mm, l) {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return DASH;
  return `${num(mm / 1000, 2, l)} ${t('u.m_', {}, l)}`;
}

export function money(v, currency, l) {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${num(v, 2, l)} ${currency || ''}`.trim();
}

export function bytes(n, l) {
  if (!Number.isFinite(n) || n < 0) return DASH;
  if (n < 1024) return `${n} ${t('u.b', {}, l)}`;
  if (n < 1024 * 1024) return `${num(n / 1024, 0, l)} ${t('u.kb', {}, l)}`;
  return `${num(n / 1024 / 1024, 1, l)} ${t('u.mb', {}, l)}`;
}

export function dims(d, l) {
  if (!Array.isArray(d) || d.length !== 3 || d.some((v) => !Number.isFinite(v))) return DASH;
  return `${d.map((v) => num(v, 1, l)).join(' × ')} ${t('u.mm', {}, l)}`;
}

export function date(ms, l) {
  if (!Number.isFinite(ms) || ms <= 0) return DASH;
  const dt = new Date(ms);
  return dt.toLocaleString(l === 'en' ? 'en-GB' : 'ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function temps(nozzle, bed, l) {
  const f = (v) => (Number.isFinite(v) ? `${num(v, 0, l)}°` : DASH);
  return `${f(nozzle)} / ${f(bed)}`;
}

/** Стоимость по цене катушки (та же формула, что src/core/meta.js cost). */
export function cost(g, price, spoolGrams = 1000) {
  if (!(g > 0) || !(price >= 0) || !(spoolGrams > 0)) return null;
  return Math.round(g * price / spoolGrams * 100) / 100;
}

/**
 * Строки подписи плитки: [{key, label, value, warn?}] - одинаковые для сетки, ленты и большого окна.
 * Пустых строк нет: чего не знаем - не показываем (кроме времени и пластика - там прочерк).
 */
export function cardLines(item, settings = {}, l) {
  const i = item.info || {};
  const out = [];
  if (i.error) return [{ key: 'error', label: t('card.error', {}, l), value: i.error, warn: true }];
  if (i.kind === 'stl' || i.kind === '3mf') {
    out.push({ key: 'model', label: t('card.model', {}, l), value: t('card.triangles', { n: num(i.triangles || 0, 0, l) }, l) });
    out.push({ key: 'dims', label: t('card.dims', {}, l), value: dims(i.dims, l) });
    out.push({ key: 'file', label: t('card.file', {}, l), value: `${bytes(item.size, l)} · ${date(item.mtimeMs, l)}` });
    return out;
  }
  out.push({ key: 'time', label: t('card.time', {}, l), value: duration(i.timeSec, l) + (i.timeEstimated ? ' ≈' : '') });
  const fil = [i.filamentType, i.filamentG !== null && i.filamentG !== undefined ? grams(i.filamentG, l) + (i.gramsEstimated ? ' ≈' : '') : null, Number.isFinite(i.filamentMm) ? meters(i.filamentMm, l) : null].filter(Boolean);
  out.push({ key: 'filament', label: t('card.filament', {}, l), value: fil.length ? fil.join(' · ') : DASH, color: i.filamentColor || null });
  const c = cost(i.filamentG, settings.spoolPrice, settings.spoolGrams);
  if (c !== null) out.push({ key: 'cost', label: t('card.cost', {}, l), value: money(c, settings.currency, l) });
  if (Number.isFinite(i.nozzleTemp) || Number.isFinite(i.bedTemp)) out.push({ key: 'temps', label: t('card.temps', {}, l), value: temps(i.nozzleTemp, i.bedTemp, l) });
  if (Number.isFinite(i.nozzle) || Number.isFinite(i.layerHeight)) out.push({ key: 'nozzle', label: t('card.nozzle', {}, l), value: `${Number.isFinite(i.nozzle) ? num(i.nozzle, 2, l) : DASH} / ${Number.isFinite(i.layerHeight) ? num(i.layerHeight, 2, l) : DASH} ${t('u.mm', {}, l)}` });
  if (i.printer) out.push({ key: 'printer', label: t('card.printer', {}, l), value: i.printer });
  if (i.dims) {
    const layers = Number.isFinite(i.layers) && i.layers > 0 ? `, ${i.layers} ${plural(i.layers, 'layers', l)}` : '';
    const fit = i.fits === true ? ` · ${t('card.fits', {}, l)}` : i.fits === false ? ` · ${t('card.nofit', {}, l)}` : '';
    out.push({ key: 'dims', label: t('card.dims', {}, l), value: dims(i.dims, l) + layers + fit, warn: i.fits === false });
  }
  const sl = [i.slicer && (i.slicer + (i.slicerVersion ? ' ' + i.slicerVersion : '')), i.slicedAt ? date(Date.parse(i.slicedAt), l) : null].filter(Boolean);
  if (sl.length) out.push({ key: 'slicer', label: t('card.slicer', {}, l), value: sl.join(' · ') });
  out.push({ key: 'file', label: t('card.file', {}, l), value: `${bytes(item.size, l)} · ${date(item.mtimeMs, l)}` + (i.plates > 1 ? ` · ${t('card.plates', { n: i.plates }, l)}` : '') });
  return out;
}
