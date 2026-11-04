// Настоящее окно Electron (невидимое, без фокуса и захвата мыши): лента, поиск, крупный
// просмотр, слежение за папкой, печать на поддельном принтере.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { launch, sampleFolder, openFolder } = require('./helpers');
const { startFakePrinter } = require('../support/fake-printer');

const GOOD = 15;        // 17 образцов, два не читаются (broken.bgcode, notzip.3mf) - у них картинки нет

async function errorsOf(win) {
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test('a folder becomes tiles: every file has info, readable ones have a 3D picture, broken ones say so', async () => {
  const { app, win } = await launch();
  const errors = await errorsOf(win);
  try {
    const dir = sampleFolder();
    await openFolder(win, dir);
    const st = await win.evaluate(() => window.galleryApp.state());
    expect(st.items).toBe(17);
    expect(st.ready).toBe(17);
    expect(st.pics).toBe(GOOD);
    expect(st.webgl).toBe(true);
    await expect(win.locator('.gg-card')).toHaveCount(17);
    await expect(win.locator('.gg-card.gg-error')).toHaveCount(2);
    const orca = win.locator(`.gg-card[data-path="${path.join(dir, 'orca.gcode')}"]`);
    await expect(orca.locator('.gg-line[data-key="time"] dd')).toHaveText('1 ч 2 мин');
    await expect(orca.locator('.gg-line[data-key="filament"] dd')).toContainText('PLA');
    await expect(orca.locator('.gg-line[data-key="dims"] dd')).toContainText('влезает на стол');
    await expect(orca.locator('.gg-img')).toHaveAttribute('src', /^data:image\/webp/);
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('law B1: reopening the folder while previews are running keeps every picture', async () => {
  const { app, win } = await launch();
  try {
    const dir = sampleFolder();
    await win.evaluate((d) => { const g = window.galleryApp.gallery(); g.openFolder(d); return g.openFolder(d); }, dir);
    await win.evaluate((d) => window.galleryApp.gallery().openFolder(d), dir);
    await openFolder(win, dir);
    const st = await win.evaluate(() => window.galleryApp.state());
    expect(st.pics).toBe(GOOD);
    const missing = await win.evaluate(() => [...document.querySelectorAll('.gg-card:not(.gg-error) .gg-img')].filter((i) => !i.getAttribute('src')).length);
    expect(missing).toBe(0);
  } finally { await app.close(); }
});

test('second start reads everything from the cache: no parsing, pictures at once', async () => {
  const { app, win, dataDir } = await launch();
  const dir = sampleFolder();
  await openFolder(win, dir);
  await app.close();
  const again = await launch({ dataDir });
  try {
    const known = await again.win.evaluate(async (d) => (await window.galleryHost.openFolder(d)).items.filter((it) => it.info).length, dir);
    expect(known).toBe(17);            // сведения всех файлов - из кэша, до разбора
    await openFolder(again.win, dir);
    const st = await again.win.evaluate(() => window.galleryApp.state());
    expect(st.pics).toBe(GOOD);
    expect(st.shots).toBe(0);          // ни одного нового снимка - все из кэша
  } finally { await again.app.close(); }
});

test('new files show up by themselves, removed ones go away, files are never written', async () => {
  const { app, win } = await launch();
  try {
    const dir = sampleFolder();
    const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const before = Object.fromEntries(fs.readdirSync(dir).map((n) => [n, hash(path.join(dir, n))]));
    await openFolder(win, dir);
    fs.mkdirSync(path.join(dir, 'new'));
    fs.copyFileSync(path.join(dir, 'orca.gcode'), path.join(dir, 'new', 'fresh.gcode'));
    await expect(win.locator('.gg-card[data-path$="fresh.gcode"]')).toHaveCount(1, { timeout: 15000 });
    await win.waitForFunction(() => window.galleryApp.state().queue === 0);
    fs.unlinkSync(path.join(dir, 'cube.stl'));
    await expect(win.locator('.gg-card[data-path$="cube.stl"]')).toHaveCount(0, { timeout: 15000 });
    await win.locator('.gg-card[data-path$="orca.gcode"] .gg-fav').click();
    await win.evaluate((p) => window.galleryApp.gallery().open(p), path.join(dir, 'orca.gcode'));
    await win.locator('.gg-viewer input[type="text"]').fill('мои, детали');
    await win.locator('.gg-viewer input[type="text"]').press('Tab');
    await win.keyboard.press('Escape');
    for (const [n, h] of Object.entries(before)) if (n !== 'cube.stl') expect(hash(path.join(dir, n))).toBe(h);
    expect(fs.readdirSync(dir).sort()).toEqual(Object.keys(before).filter((n) => n !== 'cube.stl').concat('new').sort());
  } finally { await app.close(); }
});

test('search, sort and filters in the window', async () => {
  const { app, win } = await launch();
  try {
    const dir = sampleFolder();
    await openFolder(win, dir);
    await win.fill('.gg-search', 'petg');
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().shown.map((p) => p.split(/[\\/]/).pop()).sort())).toEqual(['bambu.gcode', 'bambu.gcode.3mf', 'elegoo.gcode', 'prusa.bgcode', 'prusa.gcode']);
    await win.fill('.gg-search', '');
    await win.selectOption('.gg-bar select', 'time');
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().shown[0].split(/[\\/]/).pop())).toBe('elegoo.gcode');
    await win.click('.gg-bar .gg-icon');
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().shown[0].split(/[\\/]/).pop())).toBe('plates2.gcode.3mf');
    await win.click('text=Фильтры');
    await win.click('.gg-filters .gg-chip:has-text("STL")');
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().shown.length)).toBe(2);
    await win.click('text=Сбросить');
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().shown.length)).toBe(17);
  } finally { await app.close(); }
});

test('hover: a live 3D view over the tile, gone when the mouse leaves', async () => {
  const { app, win } = await launch();
  try {
    await openFolder(win, sampleFolder());
    await win.hover('.gg-card[data-path$="elegoo.gcode"] .gg-pic');
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().live)).toBe(true);
    await expect(win.locator('.gg-card[data-path$="elegoo.gcode"] canvas.gg-live')).toHaveCount(1);
    await win.mouse.move(2, 2);
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().live)).toBe(false);
  } finally { await app.close(); }
});

test('open large: layers, color mode, legend, all settings, marks; Escape closes', async () => {
  const { app, win } = await launch();
  try {
    const dir = sampleFolder();
    await openFolder(win, dir);
    await win.dblclick('.gg-card[data-path$="prusa.gcode"]');
    const v = win.locator('.gg-viewer');
    await expect(v).toBeVisible();
    await expect(v.locator('.gg-vtitle')).toHaveText('prusa.gcode');
    await expect(v.locator('.gg-vloading')).toBeHidden({ timeout: 30000 });
    await expect(v.locator('.gg-vsettings summary')).toContainText('(25)');
    await expect(v.locator('.gg-vlayer-label')).toHaveText('Слой 20 из 20 · Z 3 мм');
    await v.locator('.gg-vlayer').fill('5');
    await expect(v.locator('.gg-vlayer-label')).toHaveText('Слой 5 из 20 · Z 0,75 мм');
    await expect(v.locator('.gg-lg-row')).toHaveCount(6);
    await v.locator('.gg-vtools select').selectOption('filament');
    await expect(v.locator('.gg-lg-row .gg-swatch').first()).toHaveCSS('background-color', 'rgb(255, 128, 0)');
    await v.locator('.gg-vmarks select').selectOption('yes');
    await v.locator('.gg-vmarks textarea').fill('печатал в субботу');
    await v.locator('.gg-vmarks textarea').press('Tab');
    await win.keyboard.press('ArrowRight');
    await expect(v.locator('.gg-vtitle')).not.toHaveText('prusa.gcode');
    await win.keyboard.press('ArrowLeft');
    await expect(v.locator('.gg-vtitle')).toHaveText('prusa.gcode');
    await expect(v.locator('.gg-vmarks textarea')).toHaveValue('печатал в субботу');
    await win.keyboard.press('Escape');
    await expect(v).toBeHidden();
    await expect(win.locator('.gg-card[data-path$="prusa.gcode"]')).toHaveClass(/gg-printed/);
    const marks = await win.evaluate(() => window.galleryHost.marks());
    expect(marks[path.join(dir, 'prusa.gcode')].note).toBe('печатал в субботу');
  } finally { await app.close(); }
});

test('strip: one large model on top, small ones below, arrows switch, Enter opens large', async () => {
  const { app, win } = await launch();
  try {
    await openFolder(win, sampleFolder());
    await win.click('.gg-seg >> nth=1');
    await expect(win.locator('.gg-mini')).toHaveCount(17);
    const first = await win.evaluate(() => window.galleryApp.state().selected);
    await win.locator('.gg-body').press('ArrowRight');
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().selected)).not.toBe(first);
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().stripModel)).toBe(true);
    await win.locator('.gg-body').press('ArrowLeft');
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().selected)).toBe(first);
    await win.locator('.gg-body').press('Enter');
    await expect(win.locator('.gg-viewer')).toBeVisible();
  } finally { await app.close(); }
});

test('law: no button - no print. Upload only, a scripted click and a forged call start nothing; "Yes, print" starts exactly once', async () => {
  const fake = await startFakePrinter();
  const { app, win } = await launch();
  try {
    const dir = sampleFolder();
    await openFolder(win, dir);
    await win.evaluate(async (h) => { await window.galleryHost.setSettings({ printerHost: h }); window.galleryApp.gallery().setSettings({ printerHost: h }); }, fake.host);
    await win.evaluate((p) => window.galleryApp.gallery().open(p), path.join(dir, 'orca.gcode'));
    await win.click('.gg-viewer >> text=На принтер…');
    const dlg = win.locator('.gg-modal-card').first();
    await expect(dlg.locator('input.gg-input')).toHaveValue(fake.host);
    await dlg.locator('text=Только загрузить файл').click();
    await expect(dlg.locator('.gg-pstep')).toContainText('Печать не начиналась', { timeout: 60000 });
    expect(fake.commands(128).length).toBe(0);
    await dlg.locator('text=Загрузить и печатать…').click();
    await expect(dlg.locator('.gg-pconfirm')).toBeVisible();
    await win.evaluate(() => document.querySelector('.gg-pconfirm .gg-danger').click());          // не нажатие человека
    await win.evaluate((p) => window.galleryHost.print({ file: p, start: true }), path.join(dir, 'orca.gcode')).catch(() => {});
    await win.evaluate((p) => window.galleryHost.print({ file: p, start: true, token: 'f'.repeat(32) }), path.join(dir, 'orca.gcode')).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    expect(fake.commands(128).length).toBe(0);
    await dlg.locator('.gg-pconfirm .gg-danger').click();
    await expect(dlg.locator('.gg-pstep')).toContainText('Печать началась', { timeout: 90000 });
    expect(fake.commands(128).length).toBe(1);
  } finally { await app.close(); await fake.close(); }
});

test('big folder (300 files): the first screen gets its pictures before the rest, the window stays responsive', async () => {
  test.setTimeout(400000);
  const { app, win } = await launch();
  try {
    const dir = require('./helpers').tmp('gg-big-');
    const src = ['orca.gcode', 'prusa.gcode', 'bambu.gcode', 'cura.gcode', 'elegoo.gcode', 'cube.stl'];
    for (let i = 0; i < 300; i++) {
      const n = src[i % src.length];
      fs.mkdirSync(path.join(dir, 'p' + Math.floor(i / 50)), { recursive: true });
      fs.copyFileSync(path.join(require('./helpers').FIX, n), path.join(dir, 'p' + Math.floor(i / 50), `${String(i).padStart(3, '0')}-${n}`));
    }
    const t0 = Date.now();
    await win.evaluate((d) => window.galleryApp.gallery().openFolder(d), dir);
    const listed = Date.now() - t0;
    expect(listed).toBeLessThan(10000);
    await expect(win.locator('.gg-card')).toHaveCount(300);
    // Первый экран: все видимые плитки с картинкой, пока очередь ещё не пуста.
    await win.waitForFunction(() => {
      const box = document.querySelector('.gg-body').getBoundingClientRect();
      const vis = [...document.querySelectorAll('.gg-card')].filter((c) => { const r = c.getBoundingClientRect(); return r.top < box.bottom && r.bottom > box.top; });
      return vis.length > 0 && vis.every((c) => c.classList.contains('gg-has-pic'));
    }, null, { timeout: 120000 });
    const st = await win.evaluate(() => window.galleryApp.state());
    expect(st.queue, 'the first screen was done before the whole folder').toBeGreaterThan(0);
    // Окно отвечает, пока идёт разбор: поиск срабатывает сразу.
    const t1 = Date.now();
    await win.fill('.gg-search', '007-');
    await expect.poll(() => win.evaluate(() => window.galleryApp.state().shown.length)).toBe(1);
    expect(Date.now() - t1).toBeLessThan(3000);
    await win.fill('.gg-search', '');
    await win.waitForFunction(() => window.galleryApp.state().queue === 0 && window.galleryApp.state().ready === 300, null, { timeout: 300000 });
  } finally { await app.close(); }
});
