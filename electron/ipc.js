// Связь окна с главным процессом. Всё, что приходит из окна, проверяется здесь: путь - только
// из открытой папки (Library._file), папка - только выбранная человеком (R8), настройки - через
// clean, печать - только с жетоном, а жетон - только после «Печатать» в системном окне (R3).
//
// Режим тестов (GG_TEST=1): системного окна нет, вместо человека отвечает тест Playwright через
// global.__ggTest в главном процессе (answers), сюда же пишутся вопросы (asks) и разрешённые
// тестом папки (allow). Код окна программы до этого объекта не дотягивается.
'use strict';
const path = require('path');
const { ipcMain, dialog, shell } = require('electron');
const Settings = require('../src/core/settings');
const { Library } = require('./library');
const { Printing } = require('../src/core/printing');
const { discover } = require('../src/shared/discovery');

function registerIpc({ getWindow, userData, test }) {
  const settingsFile = path.join(userData, 'settings.json');
  let settings = Settings.load(settingsFile);
  const send = (ch, data) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
  const library = new Library({ dataDir: userData, onItems: (d) => send('items:changed', d), pollMs: test ? 1500 : 30000, debounceMs: test ? 150 : 400 });
  const T = test ? (global.__ggTest = { asks: [], answers: [], allow: [] }) : null;
  const confirmPrint = async (file) => {
    const name = path.basename(file);
    if (T) {
      T.asks.push(file);
      for (let i = 0; i < 1200 && !T.answers.length; i++) await new Promise((r) => setTimeout(r, 50));
      return T.answers.shift() === 'yes';
    }
    const ru = settings.lang !== 'en';
    const r = await dialog.showMessageBox(getWindow(), {
      type: 'warning',
      buttons: ru ? ['Отмена', 'Печатать'] : ['Cancel', 'Print'],
      defaultId: 0,                       // Enter - «Отмена»: печать только осознанным нажатием
      cancelId: 0,
      noLink: true,
      title: ru ? 'Печать' : 'Print',
      message: ru ? `Начать печать «${name}» на ${settings.printerHost}?` : `Start printing "${name}" on ${settings.printerHost}?`,
      detail: ru ? 'Печать начнётся сразу после загрузки. Проверьте, что стол чист и пластик заправлен.' : 'Printing starts right after the upload. Make sure the bed is clear and filament is loaded.',
    });
    return r.response === 1;
  };
  const printing = new Printing({ confirm: confirmPrint });
  let sendCtl = null;

  const setSettings = (patch) => {
    settings = Settings.save(settingsFile, Object.assign({}, settings, patch && typeof patch === 'object' ? patch : {}));
    return settings;
  };

  const open = async (folder, recursive) => {
    const r = await library.open(folder, { recursive: recursive !== undefined ? !!recursive : settings.recursive });
    if (r.stale) return r;
    setSettings({ folder: r.folder, recursive: library.recursive, recent: [r.folder, ...settings.recent.filter((x) => x !== r.folder)] });
    return Object.assign(r, { settings });
  };

  const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; } catch (e) { return { ok: false, code: e.code || 'error', message: String(e.message || e) }; }
  });

  handle('state', () => ({ settings, folder: library.folder, test: !!test, platform: process.platform }));
  handle('settings:set', (patch) => setSettings(patch));
  handle('folder:choose', async () => {
    let folder = test ? process.env.GG_TEST_CHOOSE || '' : '';
    if (!test) {
      const r = await dialog.showOpenDialog(getWindow(), { properties: ['openDirectory'], defaultPath: settings.folder || undefined });
      if (r.canceled || !r.filePaths.length) return null;
      folder = r.filePaths[0];
    }
    return folder ? open(folder) : null;
  });
  // Без диалога - только папка, которую человек уже выбирал (R8).
  handle('folder:open', (folder, recursive) => {
    if (!Settings.canOpen(folder, settings, { extra: T ? T.allow : [] })) throw Object.assign(new Error('folder not chosen'), { code: 'not-chosen' });
    return open(String(folder), recursive);
  });
  handle('items', () => library.items());
  handle('marks', () => library.folderMarks());
  handle('preview', (p, opts) => library.preview(p, opts || {}));
  handle('view', (p) => library.view(p));
  handle('detail', (p) => library.detail(p));
  handle('shot', (p, dataUrl) => library.saveShot(p, dataUrl));
  handle('mark', (p, patch) => library.mark(p, patch));
  handle('reveal', (p) => { if (library.has(p) && !test) shell.showItemInFolder(path.resolve(p)); return true; });
  handle('printer:discover', () => discover({ timeoutMs: 2000 }));
  // Жетон печати - только для файла открытой папки и только после «Печатать» в системном окне.
  handle('print:arm', (p) => { if (!library.has(p)) throw Object.assign(new Error('unknown file'), { code: 'unknown-file' }); return printing.arm(p); });
  handle('print:run', async ({ file, start, token } = {}) => {
    if (!library.has(file)) throw Object.assign(new Error('unknown file'), { code: 'unknown-file' });
    // Вторая отправка, пока идёт первая, не трогает её отмену (R9).
    if (printing.busy) throw Object.assign(new Error('busy'), { code: 'busy-sending' });
    const ctl = new AbortController();
    sendCtl = ctl;
    try {
      return await printing.run({ file, host: settings.printerHost, start: start === true, token, signal: ctl.signal, onStep: (s) => send('send:step', s) });
    } finally { if (sendCtl === ctl) sendCtl = null; }
  });
  handle('print:cancel', () => { if (sendCtl) sendCtl.abort(); return true; });

  return { library, dispose: () => library.dispose() };
}

module.exports = { registerIpc };
