// Оболочка окна: тема, язык, настройки и сама лента (src/gallery) в #gallery.
import { createGallery } from '../gallery/gallery.js';
import { t, setLang } from '../gallery/i18n.js';
import { applyTexts } from '../gallery/dom.js';

const $ = (s) => document.querySelector(s);
const host = window.galleryHost;
const THEMES = ['dark', 'light', 'formal', 'night', 'warm'];
let settings = {};
let gallery = null;
let ready = false;

function applyTheme(theme) {
  if (theme && theme !== 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function applyLang(lang) {
  setLang(lang);
  document.documentElement.lang = lang;
  document.title = t('app.title');
  applyTexts(document.querySelector('.app-head'));
  applyTexts($('#settings'));
  const sel = $('#s-theme');
  const v = sel.value || settings.theme;
  sel.textContent = '';
  for (const th of THEMES) sel.append(new Option(t('theme.' + th), th));
  sel.value = v;
}

async function save(patch) {
  try { settings = await host.setSettings(patch); } catch { Object.assign(settings, patch); }
  return settings;
}

function openSettings() {
  $('#s-theme').value = settings.theme;
  $('#s-lang').value = settings.lang;
  $('#s-price').value = String(settings.spoolPrice);
  $('#s-grams').value = String(settings.spoolGrams);
  $('#s-currency').value = settings.currency;
  $('#s-host').value = settings.printerHost;
  $('#settings').hidden = false;
  $('#s-theme').focus();
}

async function closeSettings() {
  const patch = {
    theme: $('#s-theme').value, lang: $('#s-lang').value, spoolPrice: Number($('#s-price').value), spoolGrams: Number($('#s-grams').value),
    currency: $('#s-currency').value, printerHost: $('#s-host').value,
  };
  await save(patch);
  $('#settings').hidden = true;
  applyTheme(settings.theme);
  applyLang(settings.lang);
  gallery.setSettings(settings);
}

async function main() {
  const st = await host.state();
  settings = st.settings;
  applyTheme(settings.theme);
  applyLang(settings.lang);
  gallery = createGallery($('#gallery'), host, { settings, onSettings: (patch) => { save(patch); } });
  $('#settings-btn').addEventListener('click', openSettings);
  $('#s-close').addEventListener('click', closeSettings);
  $('#s-theme').addEventListener('change', () => applyTheme($('#s-theme').value));
  $('#settings').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });
  if (settings.folder && !st.test) { try { await gallery.openFolder(settings.folder); } catch { /* папки больше нет */ } }
  ready = true;
}

// Для тестов окна (Playwright): готовность и состояние ленты.
window.galleryApp = {
  ready: () => ready,
  gallery: () => gallery,
  state: () => (gallery ? gallery.state() : null),
  settings: () => settings,
  setTheme: async (theme) => { await save({ theme }); applyTheme(theme); },
  setLang: async (lang) => { await save({ lang }); applyLang(lang); gallery.setSettings({ lang }); },
};

main().catch((e) => { document.body.dataset.error = String(e && e.message); console.error(e); });
