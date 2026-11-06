// Связь окна с главным процессом. Всё, что приходит из окна, проверяется здесь: путь - только
// из открытой папки (Library._file), настройки - через clean, печать - только с жетоном кнопки.
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
  const printing = new Printing();
  let sendCtl = null;

  const setSettings = (patch) => {
    settings = Settings.save(settingsFile, Object.assign({}, settings, patch && typeof patch === 'object' ? patch : {}));
    return settings;
  };

  const open = async (folder, recursive) => {
    const r = await library.open(folder, { recursive: recursive !== undefined ? !!recursive : settings.recursive });
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
  handle('folder:open', (folder, recursive) => open(String(folder || ''), recursive));
  handle('items', () => library.items());
  handle('marks', () => library.folderMarks());
  handle('preview', (p, opts) => library.preview(p, opts || {}));
  handle('view', (p) => library.view(p));
  handle('detail', (p) => library.detail(p));
  handle('shot', (p, dataUrl) => library.saveShot(p, dataUrl));
  handle('mark', (p, patch) => library.mark(p, patch));
  handle('reveal', (p) => { if (library.has(p) && !test) shell.showItemInFolder(path.resolve(p)); return true; });
  handle('printer:discover', () => discover({ timeoutMs: 2000 }));
  // Жетон печати выдаётся только для файла открытой папки; окно просит его в обработчике
  // кнопки «Да, печатать» (src/gallery/print-dialog.js), иначе печать не стартует.
  handle('print:arm', (p) => { if (!library.has(p)) throw Object.assign(new Error('unknown file'), { code: 'unknown-file' }); return printing.arm(p); });
  handle('print:run', async ({ file, start, token } = {}) => {
    if (!library.has(file)) throw Object.assign(new Error('unknown file'), { code: 'unknown-file' });
    sendCtl = new AbortController();
    try {
      return await printing.run({ file, host: settings.printerHost, start: start === true, token, signal: sendCtl.signal, onStep: (s) => send('send:step', s) });
    } finally { sendCtl = null; }
  });
  handle('print:cancel', () => { if (sendCtl) sendCtl.abort(); return true; });

  return { library, dispose: () => library.dispose() };
}

module.exports = { registerIpc };
