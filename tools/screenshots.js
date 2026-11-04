// Снимки окна для README: xvfb-run -a node tools/screenshots.js
// Окно тестовое (GG_TEST=1, своя папка данных), но показано без фокуса (GG_TEST_SHOW=1) - иначе
// скрытое окно почти не перерисовывает WebGL. Папка - образцы из tests/fixtures.
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, sampleFolder, openFolder, tmp } = require('../tests/app/helpers');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(app, name) {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64'));
  console.log('saved', name);
}

async function run(lang, { width = 1280, height = 820 } = {}) {
  const { app, win } = await launch({ env: { GG_TEST_SHOW: '1' }, width, height });
  const src = sampleFolder();
  const dir = path.join(tmp('gg-shots-'), lang === 'ru' ? 'Печать' : 'Prints');
  fs.mkdirSync(dir);
  for (const n of fs.readdirSync(src)) if (!['broken.bgcode', 'notzip.3mf', 'empty.gcode'].includes(n)) fs.copyFileSync(path.join(src, n), path.join(dir, n));
  await win.evaluate((l) => window.galleryApp.setLang(l), lang);
  await openFolder(win, dir);
  await win.evaluate(async (d) => {
    const host = window.galleryHost;
    await host.mark(d + '/orca.gcode', { favorite: true, tags: ['кронштейны'] });
    await host.mark(d + '/prusa.gcode', { printed: 'yes' });
  }, dir);
  await win.evaluate((d) => window.galleryApp.gallery().openFolder(d), dir);
  await openFolder(win, dir);
  return { app, win, dir };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  {
    const { app, win, dir } = await run('ru');
    await wait(800);
    await capture(app, 'grid-ru');
    await win.evaluate((p) => window.galleryApp.gallery().open(p), dir + '/elegoo.gcode');
    await wait(2500);
    await capture(app, 'viewer-ru');
    await win.keyboard.press('Escape');
    await win.click('.gg-seg >> nth=1');
    await wait(2500);
    await capture(app, 'strip-ru');
    await win.click('.gg-seg >> nth=0');
    await win.evaluate(() => window.galleryApp.setTheme('light'));
    await wait(800);
    await capture(app, 'grid-light-ru');
    await app.close();
  }
  {
    const { app, win } = await run('en');
    await wait(800);
    await capture(app, 'grid-en');
    await win.evaluate(() => window.galleryApp.setTheme('warm'));
    await wait(500);
    await capture(app, 'grid-warm-en');
    await app.close();
  }
  {
    const { app } = await run('ru', { width: 420, height: 820 });
    await wait(800);
    await capture(app, 'narrow-ru');
    await app.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
