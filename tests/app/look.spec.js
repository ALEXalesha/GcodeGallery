// Вид окна: узкое окно не ломается, все пять тем читаются, ничего не наезжает друг на друга,
// английский; 20 запусков и закрытий без роста памяти, крупный просмотр 20 раз без утечки.
const { test, expect } = require('@playwright/test');
const { launch, sampleFolder, openFolder, tmp } = require('./helpers');

const THEMES = ['dark', 'light', 'formal', 'night', 'warm'];

/** Контраст текста к его фону: прозрачные слои ложатся на --app-base (градиенты фона не считаем). */
function contrastReport() {
  const parse = (c) => {
    const s = /color\(srgb ([^)]+)\)/.exec(c);
    if (s) { const v = s[1].split(/[ /]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1]; }
    const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
  };
  const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const probe = document.createElement('div');
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--app-base');
  document.body.append(probe);
  const base = parse(getComputedStyle(probe).color);
  probe.remove();
  const bgOf = (el) => {
    const chain = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      // Кнопка с градиентом (gg-primary): её фон - первый цвет градиента.
      const g = /gradient\(.*?((?:rgba?|color)\([^)]+\))/.exec(cs.backgroundImage);
      if (g && e !== document.body && e !== document.documentElement) { chain.push(parse(g[1])); break; }
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) chain.push(c);
    }
    return chain.reverse().reduce((acc, c) => over(c, acc), base);
  };
  const out = [];
  const pick = { '.gg-primary': 4.5, '.gg-seg.gg-on': 4.5, '.gg-name': 4.5, '.gg-line dd': 4.5, '.gg-line dt': 3, '.gg-bar .gg-btn': 4.5, '.gg-folder': 3, '.gg-status': 3, '.gg-kind': 4.5, '.app-title': 4.5, '.gg-search': 4.5 };
  for (const [sel, need] of Object.entries(pick)) {
    const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent && (e.textContent.trim() || e.value !== undefined));
    if (!el) continue;
    const fg = parse(getComputedStyle(el).color);
    const bg = bgOf(el);
    const col = over(fg, bg);
    const [a, b] = [lum(col), lum(bg)].sort((x, y) => y - x);
    out.push({ sel, ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, need });
  }
  return out;
}

/** Нет горизонтальной прокрутки окна, кнопки панели не наезжают друг на друга и не вылезают за край. */
function layoutReport() {
  const W = window.innerWidth;
  const problems = [];
  if (document.documentElement.scrollWidth > W + 1) problems.push('page wider than the window: ' + document.documentElement.scrollWidth);
  const ctrls = [...document.querySelectorAll('.gg-bar > .gg-group > *, .app-head > *')].filter((e) => e.offsetParent && getComputedStyle(e).display !== 'none');
  const boxes = ctrls.map((e) => ({ e, r: e.getBoundingClientRect() }));
  for (const { e, r } of boxes) if (r.right > W + 1 || r.left < -1) problems.push('outside: ' + (e.className || e.tagName));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].r, b = boxes[j].r;
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 1 && oy > 1 && !boxes[i].e.contains(boxes[j].e) && !boxes[j].e.contains(boxes[i].e)) problems.push(`overlap: ${boxes[i].e.className || boxes[i].e.tagName} / ${boxes[j].e.className || boxes[j].e.tagName}`);
  }
  for (const c of document.querySelectorAll('.gg-card')) {
    const cr = c.getBoundingClientRect();
    if (cr.width > W) problems.push('card wider than the window');
    for (const d of c.querySelectorAll('.gg-line dd, .gg-name')) if (d.getBoundingClientRect().right > cr.right + 1) { problems.push('text out of the card: ' + d.textContent); break; }
  }
  return problems;
}

test('all five themes are readable: text contrast on cards, buttons and labels', async () => {
  const { app, win } = await launch();
  try {
    await openFolder(win, sampleFolder());
    for (const theme of THEMES) {
      await win.evaluate((th) => window.galleryApp.setTheme(th), theme);
      const rep = await win.evaluate(contrastReport);
      expect(rep.length).toBeGreaterThanOrEqual(8);
      for (const r of rep) expect(r.ratio, `${theme} ${r.sel} ${r.ratio}`).toBeGreaterThanOrEqual(r.need);
      expect(await win.evaluate(layoutReport), theme).toEqual([]);
    }
  } finally { await app.close(); }
});

for (const [w, h] of [[420, 760], [700, 600], [1280, 820]]) {
  test(`window ${w}x${h}: nothing sticks out or overlaps; viewer and strip fit`, async () => {
    const { app, win } = await launch({ width: w, height: h });
    try {
      await openFolder(win, sampleFolder());
      expect(await win.evaluate(layoutReport)).toEqual([]);
      await win.click('text=Фильтры');
      expect(await win.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await win.click('.gg-card >> nth=0', { position: { x: 30, y: 30 } });
      await win.evaluate(() => { const s = window.galleryApp.state(); window.galleryApp.gallery().open(s.shown[0]); });
      const v = await win.evaluate(() => { const r = document.querySelector('.gg-viewer').getBoundingClientRect(); const c = document.querySelector('.gg-vcanvas').getBoundingClientRect(); return { w: r.width, cw: c.width, ch: c.height, sw: document.documentElement.scrollWidth }; });
      expect(v.cw).toBeGreaterThan(100);
      expect(v.ch).toBeGreaterThan(100);
      expect(v.sw).toBeLessThanOrEqual(w + 1);
      await win.keyboard.press('Escape');
      await win.click('.gg-seg >> nth=1');
      expect(await win.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally { await app.close(); }
  });
}

test('English: the whole window switches, no Russian left in the toolbar and cards', async () => {
  const { app, win } = await launch();
  try {
    await openFolder(win, sampleFolder());
    await win.evaluate(() => window.galleryApp.setLang('en'));
    await expect(win.locator('.gg-bar')).toContainText('Folder');
    const text = await win.evaluate(() => document.querySelector('.app-head').innerText + document.querySelector('.gg-bar').innerText.replace(/\/.*$/m, '') + [...document.querySelectorAll('.gg-card dt')].map((d) => d.textContent).join(' '));
    expect(/[а-яё]/i.test(text), text).toBe(false);
    await expect(win.locator('.gg-card[data-path$="orca.gcode"] .gg-line[data-key="time"] dd')).toHaveText('1 h 2 m');
  } finally { await app.close(); }
});

test('20 launches and closes: the app starts every time and memory does not grow', async () => {
  test.setTimeout(600000);
  const dataDir = tmp('gg-mem-');
  const dir = sampleFolder();
  const rss = [], heap = [];
  for (let i = 0; i < 20; i++) {
    const { app, win } = await launch({ dataDir });
    await openFolder(win, dir);
    rss.push(await app.evaluate(() => process.memoryUsage().rss));
    heap.push(await win.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0)));
    await app.close();
  }
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const MB = 1024 * 1024;
  expect(avg(rss.slice(-5)), `main rss ${rss.map((x) => Math.round(x / MB)).join(',')}`).toBeLessThan(avg(rss.slice(0, 5)) * 1.25 + 10 * MB);
  if (heap[0]) expect(avg(heap.slice(-5)), `heap ${heap.map((x) => Math.round(x / MB)).join(',')}`).toBeLessThan(avg(heap.slice(0, 5)) * 1.25 + 5 * MB);
});

test('open large and close 20 times in one session: heap and WebGL canvases stay put', async () => {
  test.setTimeout(300000);
  const { app, win } = await launch({ extraArgs: ['--js-flags=--expose-gc'] });
  try {
    await openFolder(win, sampleFolder());
    const measure = () => win.evaluate(async () => { if (window.gc) { window.gc(); window.gc(); } await new Promise((r) => setTimeout(r, 100)); return { heap: performance.memory ? performance.memory.usedJSHeapSize : 0, canvases: document.querySelectorAll('canvas').length }; });
    const open = async (i) => {
      await win.evaluate((k) => { const s = window.galleryApp.state(); window.galleryApp.gallery().open(s.shown[k % s.shown.length]); }, i);
      await expect(win.locator('.gg-vloading')).toBeHidden({ timeout: 30000 });
      await win.keyboard.press('Escape');
    };
    for (let i = 0; i < 3; i++) await open(i);
    const before = await measure();
    for (let i = 0; i < 20; i++) await open(i);
    const after = await measure();
    expect(after.canvases).toBe(before.canvases);
    if (before.heap) expect(after.heap, `${before.heap} -> ${after.heap}`).toBeLessThan(before.heap * 1.3 + 8 * 1024 * 1024);
  } finally { await app.close(); }
});
