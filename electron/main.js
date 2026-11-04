// Главный процесс: окно (запоминает размер и место) и связь окна с src/core.
//
// GG_TEST=1 - режим тестов: окно не показывается и не берёт фокус, стоит далеко за экраном,
// разрешения (захват мыши, камера) отклонены. Playwright управляет им без видимого окна.
'use strict';
const { app, BrowserWindow, Menu, screen, session } = require('electron');
const path = require('path');
const WindowState = require('./window-state');
const { registerIpc } = require('./ipc');

const TEST = process.env.GG_TEST === '1';
// Только для снимков README под xvfb (tools/screenshots.js): тестовое окно показывается без фокуса.
const SHOW_IN_TEST = TEST && process.env.GG_TEST_SHOW === '1';
const SIZE = { width: 1280, height: 820, minWidth: 360, minHeight: 420 };
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
let win = null;
let ipc = null;

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const areas = [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)].map((d) => d.workArea);
  const placed = WindowState.restore(WindowState.load(stateFile()), areas, SIZE);
  win = new BrowserWindow({
    ...(SHOW_IN_TEST ? { x: 0, y: 0 } : TEST ? { x: -20000, y: -20000 } : placed.x !== undefined ? { x: placed.x, y: placed.y } : {}),
    width: TEST ? Number(process.env.GG_TEST_WIDTH) || SIZE.width : placed.width,
    height: TEST ? Number(process.env.GG_TEST_HEIGHT) || SIZE.height : placed.height,
    minWidth: SIZE.minWidth,
    minHeight: SIZE.minHeight,
    title: 'GcodeGallery',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#12101f',
    show: false,
    focusable: !TEST,
    skipTaskbar: TEST,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  if (SHOW_IN_TEST) win.once('ready-to-show', () => win.showInactive());
  if (!TEST) {
    if (placed.maximized) win.maximize();
    win.once('ready-to-show', () => win.show());
  }
  const remember = () => { if (win && !win.isDestroyed() && !win.isMinimized() && !TEST) WindowState.save(stateFile(), WindowState.capture(win)); };
  for (const event of ['resized', 'moved', 'maximize', 'unmaximize']) win.on(event, remember);
  win.on('close', remember);
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  Menu.setApplicationMenu(null);
  app.on('second-instance', () => {
    if (!win || TEST) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    ipc = registerIpc({ getWindow: () => win, userData: app.getPath('userData'), test: TEST });
    createWindow();
  });
  // Кэш дописывается на диск при любом выходе (и когда окно закрыли, и когда программу закрыли целиком).
  const dispose = () => { if (ipc) { ipc.dispose(); ipc = null; } };
  app.on('before-quit', dispose);
  app.on('window-all-closed', () => { dispose(); app.quit(); });
}
