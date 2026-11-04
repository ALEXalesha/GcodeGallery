// Запуск настоящего окна для тестов: GG_TEST=1 (окно невидимо, за экраном, без фокуса), своя
// папка данных, захват мыши заглушён до загрузки страницы.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

/** Папка с образцами (без эталона) - копия, чтобы тесты могли добавлять и удалять файлы. */
function sampleFolder() {
  const dir = tmp('gg-folder-');
  for (const n of fs.readdirSync(FIX)) if (n !== 'expected.json') fs.copyFileSync(path.join(FIX, n), path.join(dir, n));
  return dir;
}

async function launch({ dataDir = tmp('gg-app-'), env = {}, width, height, extraArgs = [] } = {}) {
  // WebGL на программном swiftshader: одинаково на любой машине и в CI без видеокарты.
  const args = [...extraArgs, ROOT, '--user-data-dir=' + dataDir, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  if (process.getuid && process.getuid() === 0) args.unshift('--no-sandbox');
  const app = await electron.launch({
    executablePath: require('electron'),
    args,
    env: Object.assign({}, process.env, { GG_TEST: '1' }, width ? { GG_TEST_WIDTH: String(width) } : {}, height ? { GG_TEST_HEIGHT: String(height) } : {}, env),
    cwd: ROOT,
  });
  const win = await app.firstWindow();
  const stub = () => {
    Element.prototype.requestPointerLock = function () { window.__pl = (window.__pl || 0) + 1; };
    document.exitPointerLock = function () {};
  };
  await win.addInitScript(stub);
  await win.evaluate(stub);
  await win.waitForFunction(() => window.galleryApp && window.galleryApp.ready(), null, { timeout: 60000 });
  return { app, win, dataDir };
}

/** Открыть папку и дождаться, пока все плитки получат сведения и картинки. */
async function openFolder(win, folder, { pics = true } = {}) {
  await win.evaluate((f) => window.galleryApp.gallery().openFolder(f), folder);
  await win.waitForFunction((p) => { const s = window.galleryApp.state(); return s.items > 0 && s.queue === 0 && s.ready === s.items && (!p || s.pics > 0); }, pics, { timeout: 90000 });
}

module.exports = { launch, tmp, sampleFolder, openFolder, ROOT, FIX };
