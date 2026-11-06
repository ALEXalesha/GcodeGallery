// Отправка на принтер Elegoo. Две кнопки: «Только загрузить» (печать не начинается) и
// «Загрузить и печатать…». Вторая просит у главного процесса жетон печати, а тот спрашивает
// человека системным окном (кнопка по умолчанию - «Отмена»): без его «Печатать» жетона нет,
// печать не стартует - закон «без кнопки не печатает» (R3). Здесь своего подтверждения нет:
// его мог бы «нажать» код окна или второй Enter.
import { t } from './i18n.js';
import { h, applyTexts } from './dom.js';

export class PrintDialog {
  constructor(root, { host, getSettings, setSetting }) {
    Object.assign(this, { root, host, getSettings, setSetting });
    this.item = null;
    this.sending = false;
    const el = this.el = {};
    el.title = h('h2', { 'data-i18n': 'p.title' });
    el.file = h('p', { class: 'gg-pfile' });
    el.warn = h('p', { class: 'gg-warn', hidden: true });
    el.host = h('input', { type: 'text', class: 'gg-input', 'data-i18n-placeholder': 'p.host', onchange: () => this.setSetting({ printerHost: el.host.value.trim() }) });
    el.found = h('div', { class: 'gg-found' });
    el.upload = h('button', { class: 'gg-btn', 'data-i18n': 'p.upload', onclick: (e) => this.go(false, e) });
    el.print = h('button', { class: 'gg-btn gg-primary', 'data-i18n': 'p.print', onclick: (e) => this.go(true, e) });
    el.cancel = h('button', { class: 'gg-btn', 'data-i18n': 'p.cancel', hidden: true, onclick: () => this.host.cancelPrint() });
    el.step = h('p', { class: 'gg-pstep', role: 'status' });
    el.box = h('div', { class: 'gg-modal', role: 'dialog', 'aria-modal': 'true', hidden: true, onkeydown: (e) => { if (e.key === 'Escape' && !this.sending) this.close(); } },
      h('div', { class: 'gg-modal-card' }, el.title, el.file, el.warn,
        h('label', { class: 'gg-field' }, h('span', { 'data-i18n': 's.printer' }), el.host),
        h('div', { class: 'gg-row' }, h('button', { class: 'gg-btn', 'data-i18n': 'p.find', onclick: () => this.find() }), el.found),
        h('div', { class: 'gg-row' }, el.upload, el.print, el.cancel), h('p', { class: 'gg-hint', 'data-i18n': 'p.confirmHint' }), el.step,
        h('div', { class: 'gg-row gg-end' }, h('button', { class: 'gg-btn', 'data-i18n': 's.close', onclick: () => this.close() }))));
    root.append(el.box);
    applyTexts(el.box);
    this.off = host.onSendStep((s) => this.showStep(s));
  }

  isOpen() { return !this.el.box.hidden; }

  open(item) {
    this.item = item;
    const i = item.info || {};
    this.el.file.textContent = item.name;
    this.el.host.value = this.getSettings().printerHost || '';
    const foreign = i.printer && !/elegoo|centauri/i.test(i.printer);
    this.el.warn.hidden = !foreign;
    this.el.warn.textContent = foreign ? t('p.foreign', { printer: i.printer }) : '';
    this.el.step.textContent = '';
    this.el.box.hidden = false;
    this.el.upload.focus();
  }

  close() { this.el.box.hidden = true; this.item = null; }

  async go(start, e) {
    if (!this.item || this.sending) return;
    if (!e || !e.isTrusted) return;                 // только настоящее нажатие
    const host = this.el.host.value.trim();
    if (!host) { this.el.step.textContent = t('p.noHost'); return; }
    this.sending = true;
    this.setSetting({ printerHost: host });
    try { await this.host.setSettings({ printerHost: host }); } catch { /* адрес проверит главный процесс */ }
    this.el.cancel.hidden = false;
    this.el.upload.disabled = this.el.print.disabled = true;
    const file = this.item.path;
    try {
      const token = start ? await this.host.printArm(file) : null;
      const r = await this.host.print({ file, start, token });
      this.el.step.textContent = t(r.started ? 'p.ok.print' : 'p.ok.upload', { name: r.name });
    } catch (err) {
      this.el.step.textContent = err.code === 'declined' ? t('p.declined') : t('p.err', { code: err.code || err.message });
    } finally {
      this.sending = false;
      this.el.cancel.hidden = true;
      this.el.upload.disabled = this.el.print.disabled = false;
    }
  }

  showStep(s) {
    if (!this.sending || !s) return;
    const pct = s.total ? Math.round((s.sent / s.total) * 100) : 0;
    this.el.step.textContent = t('p.step.' + s.step, { pct, s: s.waitedSec || 0 });
  }

  async find() {
    this.el.found.textContent = '…';
    let list = [];
    try { list = await this.host.discover(); } catch { list = []; }
    this.el.found.textContent = t('p.found', { n: list.length });
    for (const p of list) {
      this.el.found.append(h('button', { class: 'gg-chip', onclick: () => { this.el.host.value = p.host; this.setSetting({ printerHost: p.host }); } }, `${p.name || p.model || 'Elegoo'} · ${p.host}`));
    }
  }

  texts() { applyTexts(this.el.box); }
}
