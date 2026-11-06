// Лента G-code - отдельный модуль без привязки к своему окну: createGallery(root, host) рисует всё
// внутри root, данные берёт только через host (тот же набор, что window.galleryHost в preload).
// Так её можно встроить вкладкой в Slicer CC: дать свой root и host.
//
// Плитка = картинка (снимок 3D из общего невидимого WebGL, пока он считается - картинка из файла)
// + подпись (src/gallery/format.js). Под мышью поверх картинки - живое 3D. Очередь превью -
// по видимым плиткам (src/gallery/queue.js).
import { t, plural, setLang } from './i18n.js';
import { h, applyTexts } from './dom.js';
import { filterItems, sortItems, facets, activeCount, EMPTY } from './filter.js';
import { cardLines } from './format.js';
import { PreviewQueue } from './queue.js';
import { Snapshotter, LiveTile, Stage } from './render3d.js';
import { Viewer } from './viewer.js';
import { PrintDialog } from './print-dialog.js';

const SORTS = ['date', 'sliced', 'name', 'time', 'weight', 'size'];
/** Две последние части пути - полный путь в подсказке. */
const shortPath = (p) => { const parts = String(p).split(/[\\/]+/).filter(Boolean); return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : String(p); };
const VIEW_CACHE = 24;

export function createGallery(root, host, { settings: initial = {}, onSettings = () => {} } = {}) {
  const S = {
    settings: Object.assign({ view: 'grid', tileSize: 220, sort: 'date', sortDir: 'desc', recursive: true, spoolPrice: 1500, spoolGrams: 1000, currency: '₽', colorMode: 'type' }, initial),
    folder: '', items: [], byPath: new Map(), marks: {}, shown: [], filters: Object.assign({}, EMPTY), selected: '', scanning: false,
    views: new Map(), shots: 0, errors: 0,
  };
  let snap = null, live = null, stripStage = null;
  const gl = () => {
    if (snap === null) { try { snap = new Snapshotter(360); live = new LiveTile(); } catch { snap = false; } }
    return snap || null;
  };

  // ------------------------------------------------------------ разметка
  root.classList.add('gg');
  root.textContent = '';
  const el = {};
  el.folderBtn = h('button', { class: 'gg-btn gg-primary', 'data-i18n': 'top.folder', 'data-i18n-title': 'top.folderTitle', onclick: () => chooseFolder() });
  el.folderName = h('span', { class: 'gg-folder', 'data-i18n': 'top.noFolder' });
  el.sub = h('input', { type: 'checkbox', checked: S.settings.recursive, onchange: () => { setSetting({ recursive: el.sub.checked }); if (S.folder) openFolder(S.folder); } });
  el.search = h('input', { type: 'search', class: 'gg-search', 'data-i18n-placeholder': 'top.search', oninput: () => { S.filters.query = el.search.value; relayout(); } });
  el.sort = h('select', { class: 'gg-select', 'data-i18n-title': 'top.sort', onchange: () => { setSetting({ sort: el.sort.value }); relayout(); } },
    SORTS.map((s) => h('option', { value: s, 'data-i18n': 'sort.' + s })));
  el.dir = h('button', { class: 'gg-btn gg-icon', onclick: () => { setSetting({ sortDir: S.settings.sortDir === 'asc' ? 'desc' : 'asc' }); relayout(); } });
  el.filtersBtn = h('button', { class: 'gg-btn', onclick: () => { el.filters.hidden = !el.filters.hidden; } }, h('span', { 'data-i18n': 'top.filters' }), h('b', { class: 'gg-count' }));
  el.gridBtn = h('button', { class: 'gg-btn gg-seg', 'data-i18n': 'top.grid', onclick: () => setView('grid') });
  el.stripBtn = h('button', { class: 'gg-btn gg-seg', 'data-i18n': 'top.strip', onclick: () => setView('strip') });
  el.size = h('input', { type: 'range', min: 140, max: 420, step: 10, class: 'gg-size', 'data-i18n-title': 'top.size', oninput: () => { setSetting({ tileSize: Number(el.size.value) }); applySize(); } });
  el.status = h('span', { class: 'gg-status', role: 'status' });
  el.bar = h('div', { class: 'gg-bar' },
    h('div', { class: 'gg-group' }, el.folderBtn, el.folderName, h('label', { class: 'gg-check' }, el.sub, h('span', { 'data-i18n': 'top.sub' }))),
    h('div', { class: 'gg-group gg-grow' }, el.search),
    h('div', { class: 'gg-group' }, el.sort, el.dir, el.filtersBtn),
    h('div', { class: 'gg-group' }, h('div', { class: 'gg-segs' }, el.gridBtn, el.stripBtn), el.size),
  );
  el.filters = h('div', { class: 'gg-filters', hidden: true });
  el.grid = h('div', { class: 'gg-grid', role: 'list' });
  el.stage = h('div', { class: 'gg-strip-stage' });
  el.stageInfo = h('div', { class: 'gg-strip-info' });
  el.strip = h('div', { class: 'gg-strip-row', role: 'list' });
  el.stripView = h('div', { class: 'gg-stripview' }, h('div', { class: 'gg-strip-top' }, el.stage, el.stageInfo),
    h('div', { class: 'gg-strip-nav' }, h('button', { class: 'gg-btn gg-icon', 'data-i18n-title': 'v.prev', onclick: () => step(-1) }, '◀'), el.strip, h('button', { class: 'gg-btn gg-icon', 'data-i18n-title': 'v.next', onclick: () => step(1) }, '▶')));
  el.empty = h('div', { class: 'gg-empty' });
  el.body = h('div', { class: 'gg-body' }, el.grid, el.stripView, el.empty);
  root.append(el.bar, el.filters, el.body, h('div', { class: 'gg-foot' }, el.status));
  const viewer = new Viewer(root, { host, getSettings: () => S.settings, setSetting, getMarks: () => S.marks, onMark: (p, m) => markChanged(p, m), step: (d) => step(d, true), print: (it) => printer.open(it) });
  const printer = new PrintDialog(root, { host, getSettings: () => S.settings, setSetting });

  // ------------------------------------------------------------ очередь превью
  const queue = new PreviewQueue({ limit: 2, run: (p) => loadPreview(p), onDone: () => status() });

  async function loadPreview(p) {
    if (!S.byPath.has(p)) return;
    let r, err = null;
    try { r = await host.preview(p, { view: true }); } catch (e) { err = e; }
    // Пока ждали, папку могли открыть заново или файл поменялся: плитка - та, что сейчас в ленте (B1).
    const it = S.byPath.get(p);
    if (!it) return;
    if (err) { it.info = { error: err.code || 'error' }; S.errors++; updateCard(it); return; }
    it.info = r.info;
    it.thumb = r.thumb || it.thumb;
    if (r.view) rememberView(p, r.view);
    if (r.shot) it.pic = r.shot;
    else if (r.view && gl()) {
      try { it.pic = snap.shot(r.view, { bed: null }); S.shots++; host.saveShot(p, it.pic).catch(() => {}); } catch { it.pic = null; }
    }
    updateCard(it);
    infoArrived();
  }

  function rememberView(p, v) {
    S.views.delete(p);
    S.views.set(p, v);
    while (S.views.size > VIEW_CACHE) S.views.delete(S.views.keys().next().value);
  }

  async function viewOf(p) {
    if (S.views.has(p)) return S.views.get(p);
    const v = await host.view(p);
    if (v) rememberView(p, v);
    return v;
  }

  let infoTimer = 0;
  function infoArrived() {
    const needs = ['time', 'weight', 'sliced'].includes(S.settings.sort) || activeCount(S.filters) > 0;
    renderFilters();
    if (!needs) return;
    clearTimeout(infoTimer);
    infoTimer = setTimeout(relayout, 600);
  }

  // ------------------------------------------------------------ плитки
  function card(it) {
    if (it.card) return it.card;
    const img = h('img', { class: 'gg-img', alt: '', draggable: false });
    const pic = h('div', { class: 'gg-pic' }, img,
      h('span', { class: 'gg-kind' }),
      h('button', { class: 'gg-fav', 'data-i18n-title': 'card.fav', onclick: (e) => { e.stopPropagation(); toggleFav(it); } }, '★'),
      h('span', { class: 'gg-done' }, '✓'),
      h('div', { class: 'gg-wait', 'data-i18n': 'card.loading' }));
    pic.addEventListener('mouseenter', () => hover(it, pic));
    pic.addEventListener('mouseleave', () => { if (live && live.host === pic) live.detach(); });
    const cap = h('div', { class: 'gg-cap' }, h('div', { class: 'gg-name' }), h('dl', { class: 'gg-lines' }));
    it.card = h('article', { class: 'gg-card', role: 'listitem', tabindex: 0, dataset: { path: it.path },
      onclick: () => select(it.path), ondblclick: () => viewer.open(it, S.shown),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); viewer.open(it, S.shown); } } }, pic, cap);
    applyTexts(it.card);
    updateCard(it);
    return it.card;
  }

  function updateCard(it) {
    const c = it.card;
    if (!c) return;
    const i = it.info || {};
    const img = c.querySelector('.gg-img');
    const src = it.pic || it.thumb || '';
    if (src && img.getAttribute('src') !== src) img.src = src;
    img.classList.toggle('gg-from-file', !it.pic && !!it.thumb);
    c.classList.toggle('gg-ready', !!it.info);
    c.classList.toggle('gg-has-pic', !!src);
    c.classList.toggle('gg-error', !!i.error);
    c.querySelector('.gg-kind').textContent = t('kind.' + it.kind);
    const name = c.querySelector('.gg-name');
    name.textContent = it.name;
    name.title = it.rel || it.name;
    const m = S.marks[it.path];
    c.classList.toggle('gg-faved', !!(m && m.favorite));
    c.classList.toggle('gg-printed', !!(m && m.printed === 'yes'));
    const dl = c.querySelector('.gg-lines');
    dl.textContent = '';
    if (it.info) {
      for (const l of cardLines(it, S.settings)) {
        const dd = h('dd', { class: l.warn ? 'gg-warn' : '' }, l.color ? h('i', { class: 'gg-swatch', style: { background: l.color } }) : null, l.value);
        dd.title = l.value;
        dl.append(h('div', { class: 'gg-line', dataset: { key: l.key } }, h('dt', {}, l.label), dd));
      }
    }
    if (it.strip) { const si = it.strip.querySelector('img'); if (src && si.getAttribute('src') !== src) si.src = src; }
    if (S.selected === it.path) showStrip();
  }

  async function hover(it, pic) {
    if (!gl() || !it.info || it.info.error) return;
    let v;
    try { v = await viewOf(it.path); } catch { return; }
    if (!v || !pic.matches(':hover')) return;
    live.attach(pic, v, { bed: it.info.bed });
  }

  async function toggleFav(it) {
    const cur = S.marks[it.path];
    const m = await host.mark(it.path, { favorite: !(cur && cur.favorite) });
    markChanged(it.path, m);
  }

  function markChanged(p, m) {
    if (m) S.marks[p] = m; else delete S.marks[p];
    const it = S.byPath.get(p);
    if (it) updateCard(it);
    renderFilters();
    if (S.filters.favorite || S.filters.printed || S.filters.tag) relayout();
  }

  // ------------------------------------------------------------ раскладка
  const io = new IntersectionObserver(() => visibilityChanged(), { root: el.body, rootMargin: '300px' });
  let visTimer = 0;
  function visibilityChanged() {
    clearTimeout(visTimer);
    visTimer = setTimeout(() => {
      const box = el.body.getBoundingClientRect();
      const list = S.settings.view === 'grid' ? S.shown : S.shown;
      const vis = [];
      for (const it of list) {
        const c = S.settings.view === 'grid' ? it.card : it.strip;
        if (!c) continue;
        const r = c.getBoundingClientRect();
        if (r.bottom >= box.top - 300 && r.top <= box.bottom + 300 && r.right >= box.left - 300 && r.left <= box.right + 300) vis.push(it.path);
      }
      queue.setVisible(vis);
    }, 60);
  }

  function relayout() {
    S.shown = sortItems(filterItems(S.items, S.filters, S.marks), S.settings.sort, S.settings.sortDir);
    el.sort.value = S.settings.sort;
    el.dir.textContent = S.settings.sortDir === 'asc' ? '↑' : '↓';
    el.dir.title = t('top.dir.' + S.settings.sortDir);
    const n = activeCount(S.filters);
    el.filtersBtn.querySelector('.gg-count').textContent = n ? String(n) : '';
    if (S.settings.view === 'grid') {
      const want = S.shown.map((it) => card(it));
      syncChildren(el.grid, want);
    } else {
      syncChildren(el.strip, S.shown.map((it) => stripCard(it)));
      if (!S.shown.some((it) => it.path === S.selected)) S.selected = S.shown[0] ? S.shown[0].path : '';
      showStrip();
    }
    for (const it of S.shown) io.observe(S.settings.view === 'grid' ? it.card : it.strip);
    queue.add(S.shown.map((it) => it.path));
    el.empty.hidden = S.shown.length > 0 && !!S.folder;
    el.empty.textContent = !S.folder ? t('empty.noFolder') : !S.items.length ? (S.scanning ? t('status.scanning') : t('empty.none')) : t('empty.filtered');
    el.grid.hidden = S.settings.view !== 'grid' || !S.shown.length;
    el.stripView.hidden = S.settings.view !== 'strip' || !S.shown.length;
    status();
    visibilityChanged();
  }

  function syncChildren(parent, want) {
    const set = new Set(want);
    for (const c of [...parent.children]) if (!set.has(c)) c.remove();
    let prev = null;
    for (const c of want) {
      const next = prev ? prev.nextSibling : parent.firstChild;
      if (next !== c) parent.insertBefore(c, next);
      prev = c;
    }
  }

  function applySize() {
    const s = S.settings.tileSize;
    root.style.setProperty('--gg-tile', s + 'px');
    root.classList.toggle('gg-small', s < 200);
    el.size.value = String(s);
  }

  function setView(v) {
    if (live) live.detach();
    setSetting({ view: v });
    el.gridBtn.classList.toggle('gg-on', v === 'grid');
    el.stripBtn.classList.toggle('gg-on', v === 'strip');
    el.size.hidden = v !== 'grid';
    if (v === 'strip' && !stripStage && gl()) stripStage = new Stage(el.stage, { autoRotate: true });
    relayout();
  }

  // ------------------------------------------------------------ лента: крупная модель сверху, маленькие снизу
  function stripCard(it) {
    if (it.strip) return it.strip;
    it.strip = h('button', { class: 'gg-mini', role: 'listitem', dataset: { path: it.path }, onclick: () => select(it.path), ondblclick: () => viewer.open(it, S.shown) },
      h('img', { alt: '', draggable: false, src: it.pic || it.thumb || undefined }), h('span', {}, it.name));
    return it.strip;
  }

  let stripShown = '';
  async function showStrip() {
    if (S.settings.view !== 'strip') return;
    for (const it of S.shown) if (it.strip) it.strip.classList.toggle('gg-on', it.path === S.selected);
    const it = S.byPath.get(S.selected);
    el.stageInfo.textContent = '';
    if (!it) { if (stripStage) stripStage.clear(); stripShown = ''; return; }
    el.stageInfo.append(h('h3', { class: 'gg-title' }, it.name), h('dl', { class: 'gg-lines' }, (it.info ? cardLines(it, S.settings) : []).map((l) =>
      h('div', { class: 'gg-line', dataset: { key: l.key } }, h('dt', {}, l.label), h('dd', { class: l.warn ? 'gg-warn' : '' }, l.value)))),
    h('div', { class: 'gg-row' }, h('button', { class: 'gg-btn gg-primary', onclick: () => viewer.open(it, S.shown) }, t('card.open'))));
    if (!it.info) { queue.setVisible([it.path]); return; }
    if (stripShown === it.path || !stripStage || it.info.error) return;
    stripShown = it.path;
    try {
      const v = await viewOf(it.path);
      if (v && S.selected === it.path) stripStage.show(v, { bed: it.info.bed, colorMode: S.settings.colorMode, filamentColor: it.info.filamentColor });
    } catch (e) { stripShown = ''; console.warn('strip', e); }
  }

  function select(p) {
    S.selected = p;
    for (const it of S.shown) if (it.card) it.card.classList.toggle('gg-sel', it.path === p);
    const it = S.byPath.get(p);
    if (S.settings.view === 'strip' && it && it.strip) { it.strip.scrollIntoView({ block: 'nearest', inline: 'center' }); showStrip(); }
  }

  function step(d, open = false) {
    if (!S.shown.length) return null;
    let i = S.shown.findIndex((it) => it.path === S.selected);
    i = i < 0 ? 0 : (i + d + S.shown.length) % S.shown.length;
    select(S.shown[i].path);
    if (S.settings.view === 'grid' && S.shown[i].card) S.shown[i].card.scrollIntoView({ block: 'nearest' });
    return open ? S.shown[i] : null;
  }

  root.addEventListener('keydown', onKey);
  function onKey(e) {
    if (viewer.isOpen() || printer.isOpen() || e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowRight' || (S.settings.view === 'strip' && e.key === 'ArrowDown')) { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || (S.settings.view === 'strip' && e.key === 'ArrowUp')) { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter' && S.selected && S.settings.view === 'strip') { const it = S.byPath.get(S.selected); if (it) viewer.open(it, S.shown); }
  }

  // ------------------------------------------------------------ фильтры
  function renderFilters() {
    const f = S.filters;
    const fc = facets(S.items);
    const tags = [...new Set(Object.values(S.marks).flatMap((m) => m.tags))].sort((a, b) => a.localeCompare(b));
    const chip = (label, on, toggle) => h('button', { class: 'gg-chip' + (on ? ' gg-on' : ''), onclick: toggle }, label);
    const toggleIn = (key, v) => () => { const s = new Set(f[key]); if (s.has(v)) s.delete(v); else s.add(v); f[key] = [...s]; relayout(); renderFilters(); };
    const numIn = (key, scale = 1) => h('input', { type: 'number', min: 0, step: 'any', class: 'gg-num', value: f[key] === null || f[key] === undefined ? '' : String(f[key] / scale),
      onchange: (e) => { const v = e.target.value === '' ? null : Number(e.target.value) * scale; f[key] = Number.isFinite(v) ? v : null; relayout(); } });
    const dateIn = (key, end) => h('input', { type: 'date', class: 'gg-date', value: f[key] ? new Date(f[key]).toISOString().slice(0, 10) : '',
      onchange: (e) => { const v = e.target.value ? Date.parse(e.target.value + (end ? 'T23:59:59' : 'T00:00:00')) : null; f[key] = Number.isFinite(v) ? v : null; relayout(); } });
    el.filters.textContent = '';
    el.filters.append(
      h('div', { class: 'gg-fgroup' }, h('span', { class: 'gg-flabel' }, t('f.types')), fc.types.map((x) => chip(x, f.types.includes(x), toggleIn('types', x)))),
      h('div', { class: 'gg-fgroup' }, h('span', { class: 'gg-flabel' }, t('f.kinds')), fc.kinds.map((x) => chip(t('kind.' + x), f.kinds.includes(x), toggleIn('kinds', x)))),
      h('div', { class: 'gg-fgroup' },
        h('label', { class: 'gg-check' }, h('input', { type: 'checkbox', checked: f.favorite, onchange: (e) => { f.favorite = e.target.checked; relayout(); } }), h('span', {}, t('f.favorite'))),
        h('span', { class: 'gg-flabel' }, t('f.printed')),
        h('select', { class: 'gg-select', onchange: (e) => { f.printed = e.target.value; relayout(); } }, ['', 'yes', 'no'].map((v) => h('option', { value: v, selected: f.printed === v }, t('f.printed.' + (v || 'any'))))),
        tags.length ? [h('span', { class: 'gg-flabel' }, t('f.tag')), h('select', { class: 'gg-select', onchange: (e) => { f.tag = e.target.value; relayout(); } },
          [h('option', { value: '' }, t('f.tag.any')), ...tags.map((x) => h('option', { value: x, selected: f.tag === x }, x))])] : null),
      h('div', { class: 'gg-fgroup' }, h('span', { class: 'gg-flabel' }, t('f.time')), t('f.from'), numIn('timeMin', 3600), t('f.to'), numIn('timeMax', 3600),
        h('span', { class: 'gg-flabel' }, t('f.weight')), t('f.from'), numIn('weightMin'), t('f.to'), numIn('weightMax')),
      h('div', { class: 'gg-fgroup' }, h('span', { class: 'gg-flabel' }, t('f.date')), t('f.from'), dateIn('dateFrom'), t('f.to'), dateIn('dateTo', true),
        h('button', { class: 'gg-btn', onclick: () => { const q = f.query; S.filters = Object.assign({}, EMPTY, { query: q }); renderFilters(); relayout(); } }, t('f.reset')),
        h('span', { class: 'gg-flabel' }, t('f.count', { n: S.shown.length, m: S.items.length }))),
    );
  }

  // ------------------------------------------------------------ папка и данные
  function setItems(list) {
    const old = S.byPath;
    S.byPath = new Map();
    S.items = list.map((x) => {
      const prev = old.get(x.path);
      const it = prev && prev.size === x.size && prev.mtimeMs === x.mtimeMs ? prev : Object.assign({ card: prev && prev.card, strip: prev && prev.strip }, x);
      if (it !== prev && prev) { it.pic = null; it.thumb = null; queue.invalidate(x.path); }
      S.byPath.set(it.path, it);
      return it;
    });
    for (const p of old.keys()) if (!S.byPath.has(p)) queue.remove(p);
  }

  // Ответ на устаревший запрос (пока читали папку, открыли другую) не показываем (R4).
  let openSeq = 0;
  async function openFolder(folder) {
    const my = ++openSeq;
    S.scanning = true;
    status();
    try {
      const r = await host.openFolder(folder, S.settings.recursive);
      if (my === openSeq && r && !r.stale) applyOpen(r);
    } finally { if (my === openSeq) { S.scanning = false; status(); } }
  }

  async function chooseFolder() {
    const my = ++openSeq;
    const r = await host.chooseFolder();
    if (r && !r.stale && my === openSeq) applyOpen(r);
  }

  function applyOpen(r) {
    queue.clear();
    S.views.clear();
    S.folder = r.folder;
    S.marks = r.marks || {};
    S.byPath = new Map();
    setItems(r.items);
    if (r.settings) Object.assign(S.settings, r.settings);
    el.folderName.textContent = shortPath(r.folder);
    el.folderName.title = r.folder;
    el.folderName.removeAttribute('data-i18n');
    renderFilters();
    relayout();
  }

  const offItems = host.onItems((d) => {
    if (d.folder !== S.folder) return;
    const map = new Map(S.items.map((it) => [it.path, it]));
    for (const p of d.removed) map.delete(p);
    for (const x of [...d.added, ...d.changed]) map.set(x.path, x);
    setItems([...map.values()]);
    renderFilters();
    relayout();
  });

  function status() {
    const left = queue.pending.size + queue.active.size;
    const parts = [];
    if (S.scanning) parts.push(t('status.scanning'));
    else if (S.folder) parts.push(t('status.files', { n: S.items.length, files: plural(S.items.length, 'files') }));
    if (left) parts.push(t('status.queue', { n: left }));
    el.status.textContent = parts.join(' · ');
  }

  function setSetting(patch) {
    Object.assign(S.settings, patch);
    onSettings(patch);
  }

  function texts() {
    applyTexts(root);
    if (S.folder) el.folderName.textContent = shortPath(S.folder);
    for (const it of S.items) if (it.card) updateCard(it);
    renderFilters();
    relayout();
    viewer.texts();
    printer.texts();
  }

  // ------------------------------------------------------------ старт
  setLang(S.settings.lang || 'ru');
  applyTexts(root);
  applySize();
  setView(S.settings.view === 'strip' ? 'strip' : 'grid');
  renderFilters();

  return {
    openFolder,
    chooseFolder,
    texts,
    setSettings(patch) { Object.assign(S.settings, patch); if (patch.lang) setLang(patch.lang); texts(); },
    /** Для тестов окна: что сейчас показано. */
    state: () => ({ folder: S.folder, items: S.items.length, shown: S.shown.map((it) => it.path), ready: S.items.filter((it) => it.info).length,
      pics: S.items.filter((it) => it.pic).length, shots: S.shots, queue: queue.pending.size + queue.active.size, view: S.settings.view, selected: S.selected,
      viewer: viewer.isOpen(), live: !!(live && live.active), webgl: !!snap, stripModel: !!(stripStage && stripStage.model) }),
    select,
    open: (p) => { const it = S.byPath.get(p); if (it) viewer.open(it, S.shown); },
    // Как вкладка: всё, что лента завела, уходит вместе с ней - WebGL, подписки, таймеры, очередь (R6).
    destroy() {
      offItems(); io.disconnect();
      queue.paused = true; queue.clear();
      clearTimeout(infoTimer); clearTimeout(visTimer);
      root.removeEventListener('keydown', onKey);
      if (live) live.dispose(); if (snap) snap.dispose(); if (stripStage) stripStage.dispose();
      snap = false; live = null; stripStage = null;
      viewer.dispose(); printer.dispose();
      root.classList.remove('gg', 'gg-small'); root.textContent = '';
    },
  };
}
