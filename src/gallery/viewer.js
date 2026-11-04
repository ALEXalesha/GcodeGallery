// «Открыть крупно»: большое 3D (мышь крутит, колесо приближает), ползунок слоёв, цвет по типу
// линий или цветом пластика, легенда типов с галочками, все сведения и настройки файла,
// отметки (избранное, метки, заметка, напечатано) и отправка на принтер.
import { t } from './i18n.js';
import { h, applyTexts } from './dom.js';
import { cardLines, num } from './format.js';
import { Stage } from './render3d.js';

const GROUPS = ['walls', 'infill', 'support', 'adhesion', 'other'];

export class Viewer {
  constructor(root, { host, getSettings, setSetting, getMarks = () => ({}), onMark, step, print }) {
    Object.assign(this, { root, host, getSettings, setSetting, getMarks, onMark, stepFn: step, printFn: print });
    this.item = null;
    this.model = null;
    this.stage = null;
    this.hiddenKinds = new Set();
    this.seq = 0;
    const el = this.el = {};
    el.title = h('h2', { class: 'gg-vtitle' });
    el.canvas = h('div', { class: 'gg-vcanvas' });
    el.loading = h('div', { class: 'gg-vloading', 'data-i18n': 'v.loading', hidden: true });
    el.layer = h('input', { type: 'range', min: 1, max: 1, value: 1, class: 'gg-vlayer', oninput: () => this.applyLayers() });
    el.layerLabel = h('span', { class: 'gg-vlayer-label' });
    el.only = h('input', { type: 'checkbox', onchange: () => this.applyLayers() });
    el.color = h('select', { class: 'gg-select', onchange: () => { this.setSetting({ colorMode: el.color.value }); this.applyColors(); } },
      h('option', { value: 'type', 'data-i18n': 'v.color.type' }), h('option', { value: 'filament', 'data-i18n': 'v.color.filament' }));
    el.legend = h('div', { class: 'gg-legend' });
    el.info = h('dl', { class: 'gg-lines gg-vinfo' });
    el.fav = h('input', { type: 'checkbox', onchange: () => this.mark({ favorite: el.fav.checked }) });
    el.printed = h('select', { class: 'gg-select', onchange: () => this.mark({ printed: el.printed.value, printedAt: el.printed.value === 'yes' ? Date.now() : undefined }) },
      h('option', { value: '', 'data-i18n': 'f.printed.any' }), h('option', { value: 'yes', 'data-i18n': 'card.printedYes' }), h('option', { value: 'no', 'data-i18n': 'card.printedNo' }));
    el.tags = h('input', { type: 'text', class: 'gg-input', 'data-i18n-placeholder': 'v.tags', onchange: () => this.mark({ tags: el.tags.value.split(',') }) });
    el.note = h('textarea', { class: 'gg-input gg-note', rows: 3, 'data-i18n-placeholder': 'v.note', onchange: () => this.mark({ note: el.note.value }) });
    el.settingsHead = h('summary', {});
    el.settingsFilter = h('input', { type: 'search', class: 'gg-input', oninput: () => this.renderSettings() });
    el.settings = h('table', { class: 'gg-settings' });
    el.printBtn = h('button', { class: 'gg-btn gg-primary', 'data-i18n': 'p.send', onclick: () => this.item && this.printFn(this.item) });
    el.panel = h('aside', { class: 'gg-vpanel' },
      h('section', {}, h('h3', { 'data-i18n': 'v.info' }), el.info),
      h('section', { class: 'gg-vmarks' }, h('h3', { 'data-i18n': 'v.marks' }),
        h('label', { class: 'gg-check' }, el.fav, h('span', { 'data-i18n': 'card.fav' })),
        h('label', { class: 'gg-field' }, h('span', { 'data-i18n': 'v.printed' }), el.printed), el.tags, el.note),
      h('section', { class: 'gg-row' }, el.printBtn, h('button', { class: 'gg-btn', 'data-i18n': 'v.folder', onclick: () => this.item && this.host.reveal(this.item.path) })),
      h('details', { class: 'gg-vsettings' }, el.settingsHead, el.settingsFilter, el.settings));
    el.box = h('div', { class: 'gg-viewer', role: 'dialog', 'aria-modal': 'true', hidden: true, tabindex: -1, onkeydown: (e) => this.key(e) },
      h('header', { class: 'gg-vhead' },
        h('button', { class: 'gg-btn gg-icon', 'data-i18n-title': 'v.prev', onclick: () => this.step(-1) }, '◀'),
        el.title,
        h('button', { class: 'gg-btn gg-icon', 'data-i18n-title': 'v.next', onclick: () => this.step(1) }, '▶'),
        h('button', { class: 'gg-btn', 'data-i18n': 'v.reset', onclick: () => this.stage && this.stage.resetView() }),
        h('button', { class: 'gg-btn gg-close', 'data-i18n-title': 'v.close', 'data-i18n-aria': 'v.close', onclick: () => this.close() }, '✕')),
      h('div', { class: 'gg-vbody' },
        h('div', { class: 'gg-vmain' }, el.canvas, el.loading,
          h('div', { class: 'gg-vtools' }, el.layer, el.layerLabel, h('label', { class: 'gg-check' }, el.only, h('span', { 'data-i18n': 'v.only' })),
            h('label', { class: 'gg-field' }, h('span', { 'data-i18n': 'v.color' }), el.color)),
          el.legend),
        el.panel));
    root.append(el.box);
    applyTexts(el.box);
  }

  isOpen() { return !this.el.box.hidden; }

  async open(item, list) {
    this.item = item;
    this.list = list || [];
    this.el.box.hidden = false;
    if (!this.stage) { try { this.stage = new Stage(this.el.canvas); } catch { this.stage = null; } }
    this.el.box.focus();
    this.el.color.value = this.getSettings().colorMode || 'type';
    this.detail = null;
    this.render();
    const seq = ++this.seq;
    if (item.info && item.info.error) return;
    this.el.loading.hidden = false;
    try {
      const quick = await this.host.view(item.path);
      if (seq === this.seq && quick && !this.detail) this.show(quick);
      const d = await this.host.detail(item.path);
      if (seq !== this.seq) return;
      this.detail = d;
      if (d.view) this.show(d.view);
      this.render();
    } catch { /* файл пропал или не читается - сведения уже показаны */ } finally { if (seq === this.seq) this.el.loading.hidden = true; }
  }

  info() { return (this.detail && this.detail.info) || (this.item && this.item.info) || {}; }

  show(view) {
    if (!this.stage) return;
    const i = this.info();
    this.view = view;
    this.model = this.stage.show(view, { bed: i.bed, colorMode: this.el.color.value, filamentColor: i.filamentColor });
    const n = Math.max(1, this.model.layers);
    this.el.layer.max = String(n);
    this.el.layer.value = String(n);
    this.el.layer.disabled = this.model.layers < 2;
    this.model.setKinds(new Set(view.kinds ? view.kinds.map((k) => k.id).filter((k) => !this.hiddenKinds.has(k)) : []));
    this.applyLayers();
    this.renderLegend();
  }

  applyLayers() {
    if (!this.model) { this.el.layerLabel.textContent = ''; return; }
    const n = this.model.layers;
    const top = Math.max(1, Math.min(n, Number(this.el.layer.value) || n));
    if (n) this.model.setLayers(this.el.only.checked ? top - 1 : 0, top - 1);
    const z = this.view && this.view.layers ? this.view.layers[top - 1] : null;
    this.el.layerLabel.textContent = n ? t('v.layer', { n: top, m: n, z: num(z, 2) }) : '';
  }

  applyColors() {
    if (!this.model) return;
    this.model.setColors(this.el.color.value, this.info().filamentColor);
    this.renderLegend();
  }

  renderLegend() {
    const box = this.el.legend;
    box.textContent = '';
    const v = this.view;
    if (!v || !v.kinds) return;
    const times = this.info().timeByKind || {};
    const total = Object.values(times).reduce((a, b) => a + b, 0) || 1;
    for (const g of GROUPS) {
      const kinds = v.kinds.filter((k) => k.group === g);
      if (!kinds.length) continue;
      box.append(h('div', { class: 'gg-lg-group' }, t('g.' + g)));
      for (const k of kinds) {
        const cb = h('input', { type: 'checkbox', checked: !this.hiddenKinds.has(k.id), onchange: () => {
          if (cb.checked) this.hiddenKinds.delete(k.id); else this.hiddenKinds.add(k.id);
          this.model.setKinds(new Set(v.kinds.map((x) => x.id).filter((x) => !this.hiddenKinds.has(x))));
        } });
        const color = this.el.color.value === 'filament' && this.info().filamentColor ? this.info().filamentColor : k.color;
        box.append(h('label', { class: 'gg-lg-row', dataset: { kind: k.id } }, cb, h('i', { class: 'gg-swatch', style: { background: color } }), h('span', {}, t('k.' + k.id)),
          times[k.id] ? h('small', {}, Math.round((times[k.id] / total) * 100) + ' %') : null));
      }
    }
  }

  render() {
    const it = this.item;
    if (!it) return;
    this.el.title.textContent = it.name;
    this.el.title.title = it.rel || it.name;
    const merged = Object.assign({}, it, { info: this.info() });
    this.el.info.textContent = '';
    for (const l of it.info ? cardLines(merged, this.getSettings()) : []) {
      this.el.info.append(h('div', { class: 'gg-line', dataset: { key: l.key } }, h('dt', {}, l.label), h('dd', { class: l.warn ? 'gg-warn' : '' }, l.color ? h('i', { class: 'gg-swatch', style: { background: l.color } }) : null, l.value)));
    }
    const m = this.markOf();
    this.el.fav.checked = !!(m && m.favorite);
    this.el.printed.value = (m && m.printed) || '';
    this.el.tags.value = m ? m.tags.join(', ') : '';
    this.el.note.value = m ? m.note : '';
    const printable = ['gcode', 'gcode3mf'].includes(it.kind);
    this.el.printBtn.disabled = !printable;
    this.el.printBtn.title = printable ? '' : t('p.notGcode');
    this.renderSettings();
    if (!this.view) this.renderLegend();
  }

  markOf() { return this.getMarks()[this.item.path] || null; }

  async mark(patch) {
    if (!this.item) return;
    const m = await this.host.mark(this.item.path, patch);
    this.onMark(this.item.path, m);
  }

  renderSettings() {
    const all = (this.detail && this.detail.info && this.detail.info.settings) || {};
    const keys = Object.keys(all).sort();
    this.el.settingsHead.textContent = t('v.settings', { n: keys.length });
    const q = this.el.settingsFilter.value.trim().toLowerCase();
    this.el.settings.textContent = '';
    if (!keys.length) { this.el.settings.append(h('tr', {}, h('td', {}, t('v.noSettings')))); return; }
    for (const k of keys.filter((x) => !q || x.toLowerCase().includes(q) || String(all[x]).toLowerCase().includes(q)).slice(0, 2000)) {
      this.el.settings.append(h('tr', {}, h('th', {}, k), h('td', {}, String(all[k]))));
    }
  }

  step(d) {
    const next = this.stepFn(d);
    if (next) { this.view = null; this.model = null; this.open(next, this.list); }
  }

  key(e) {
    if (e.target.matches('input[type=text], input[type=search], textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'ArrowRight' && !e.target.matches('input[type=range]')) { e.preventDefault(); this.step(1); }
    else if (e.key === 'ArrowLeft' && !e.target.matches('input[type=range]')) { e.preventDefault(); this.step(-1); }
  }

  close() {
    this.seq++;
    this.el.box.hidden = true;
    if (this.stage) this.stage.clear();
    this.model = null;
    this.view = null;
    this.item = null;
  }

  texts() { applyTexts(this.el.box); if (this.item) { this.render(); this.applyLayers(); this.renderLegend(); } }
}
