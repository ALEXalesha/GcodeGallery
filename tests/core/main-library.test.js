// Библиотека главного процесса без Electron: открыть папку, превью, кэш, слежение, работники;
// окно не может попросить файл не из открытой папки. Плюс место окна (window-state).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');
const { opts } = require('../support/seed');
const { Library, Pool } = require('../../electron/library');
const WS = require('../../electron/window-state');

const FIX = path.join(__dirname, '..', 'fixtures');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'gg-' + p + '-'));
const folder = () => { const d = tmp('lib'); for (const n of ['orca.gcode', 'cube.stl', 'broken.bgcode']) fs.copyFileSync(path.join(FIX, n), path.join(d, n)); return d; };

for (const inline of [true, false]) {
  test(`library (${inline ? 'inline' : 'worker threads'}): open, preview, cache, shot, marks; second preview from the cache`, async () => {
    const data = tmp('data');
    const lib = new Library({ dataDir: data, inline, pollMs: 0 });
    try {
      const dir = folder();
      const r = await lib.open(dir);
      assert.strictEqual(r.items.length, 3);
      assert.ok(r.items.every((it) => it.info === null));
      const orca = path.join(dir, 'orca.gcode');
      const [a, b] = await Promise.all([lib.preview(orca), lib.preview(orca)]);
      assert.deepStrictEqual(a.info, b.info, 'two requests - one parse');
      assert.strictEqual(a.info.slicer, 'OrcaSlicer');
      assert.ok(a.view && a.view.data.length);
      assert.ok(a.thumb.startsWith('data:image/png'));
      assert.strictEqual(a.shot, null);
      assert.ok(lib.saveShot(orca, 'data:image/webp;base64,AAAA'));
      const c = await lib.preview(orca);
      assert.strictEqual(c.shot, 'data:image/webp;base64,AAAA');
      assert.strictEqual(c.view, null, 'with a shot no view is sent');
      assert.ok((await lib.view(orca)).data.length);
      const bad = await lib.preview(path.join(dir, 'broken.bgcode'));
      assert.strictEqual(bad.info.error, 'bad-bgcode');
      const d = await lib.detail(orca);
      assert.ok(d.info.settings && d.info.settings.printer_model);
      assert.ok(lib.mark(orca, { favorite: true }).favorite);
      assert.ok(lib.items().find((x) => x.path === orca).info, 'items carry cached info');
      lib.close();
      const again = new Library({ dataDir: data, inline: true, pollMs: 0 });
      const r2 = await again.open(dir);
      assert.ok(r2.items.find((x) => x.path === orca).info, 'cache survives a restart');
      assert.strictEqual(r2.marks[orca].favorite, true);
      again.dispose();
    } finally { lib.dispose(); }
  });
}

test('law: the window can only get files of the open folder', async () => {
  const lib = new Library({ dataDir: tmp('data'), inline: true, pollMs: 0 });
  try {
    await lib.open(folder());
    const outside = path.join(FIX, 'orca.gcode');
    await fc.assert(fc.asyncProperty(fc.oneof(fc.constant(outside), fc.constant('/etc/passwd'), fc.constant('../orca.gcode'), fc.string(), fc.constant(null), fc.constant(5)), async (p) => {
      await assert.rejects(lib.preview(p), (e) => e.code === 'unknown-file');
      await assert.rejects(lib.detail(p), (e) => e.code === 'unknown-file');
      assert.throws(() => lib.mark(p, { favorite: true }), (e) => e.code === 'unknown-file');
      assert.throws(() => lib.saveShot(p, 'data:image/png;base64,AA'), (e) => e.code === 'unknown-file');
      assert.strictEqual(lib.has(p), false);
    }), opts(50));
  } finally { lib.dispose(); }
});

test('library: a new file in the folder is reported by itself', async () => {
  const changes = [];
  const lib = new Library({ dataDir: tmp('data'), inline: true, pollMs: 200, debounceMs: 50, onItems: (d) => changes.push(d) });
  try {
    const dir = folder();
    await lib.open(dir, { recursive: false });
    fs.copyFileSync(path.join(FIX, 'prusa.gcode'), path.join(dir, 'new.gcode'));
    for (let i = 0; i < 100 && !changes.some((c) => c.added.length); i++) await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(changes.find((c) => c.added.length).added[0].name, 'new.gcode');
    assert.ok(lib.has(path.join(dir, 'new.gcode')));
    fs.unlinkSync(path.join(dir, 'cube.stl'));
    for (let i = 0; i < 100 && !changes.some((c) => c.removed.length); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(!lib.has(path.join(dir, 'cube.stl')));
  } finally { lib.dispose(); }
});

test('worker pool: errors come back as errors, many jobs finish with a small pool', async () => {
  const pool = new Pool({ size: 2 });
  try {
    await assert.rejects(pool.run(path.join(FIX, 'no-such-file.gcode')));
    const all = await Promise.all(['orca.gcode', 'prusa.gcode', 'cube.stl', 'bambu.gcode', 'cura.gcode'].map((n) => pool.run(path.join(FIX, n))));
    assert.deepStrictEqual(all.map((r) => r.info.name), ['orca.gcode', 'prusa.gcode', 'cube.stl', 'bambu.gcode', 'cura.gcode']);
    assert.ok(pool.workers.length <= 2);
  } finally { pool.close(); }
  const inline = new Pool({ inline: true });
  await assert.rejects(inline.run('/no/such/file.gcode'));
});

// ---------------------------------------------------------------- место окна (взято из слайсера)

const OPTS = { width: 1280, height: 820, minWidth: 360, minHeight: 420 };
const SCREEN = { x: 0, y: 0, width: 1920, height: 1040 };

test('law: whatever is in the file, the window opens visible, grabbable and not smaller than the minimum', () => {
  const area = fc.record({ x: fc.integer({ min: -3000, max: 3000 }), y: fc.integer({ min: -2000, max: 2000 }), width: fc.integer({ min: 640, max: 4000 }), height: fc.integer({ min: 480, max: 2500 }) });
  fc.assert(fc.property(fc.anything(), fc.array(area, { minLength: 1, maxLength: 3 }), fc.option(fc.record({ x: fc.integer({ min: -5000, max: 5000 }), y: fc.integer({ min: -5000, max: 5000 }), width: fc.integer({ min: -100, max: 6000 }), height: fc.integer({ min: -100, max: 4000 }), maximized: fc.boolean() })), (junk, areas, saved) => {
    for (const s of [junk, saved]) {
      const r = WS.restore(s, areas, OPTS);
      assert.ok(r.width >= OPTS.minWidth && r.height >= OPTS.minHeight);
      if (r.x !== undefined) {
        const onScreen = areas.some((a) => Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x) >= WS.GRIP_WIDTH / 2 && r.y >= a.y && r.y + WS.GRIP_HEIGHT <= a.y + a.height + 1);
        assert.ok(onScreen, JSON.stringify({ r, areas }));
      }
    }
  }), opts(500));
  assert.deepStrictEqual(WS.restore({ x: 100, y: 50, width: 900, height: 600, maximized: true }, [SCREEN], OPTS), { x: 100, y: 50, width: 900, height: 600, maximized: true });
  assert.deepStrictEqual(WS.restore({ x: 5000, y: 50, width: 900, height: 600 }, [SCREEN], OPTS), { width: 900, height: 600, maximized: false });
});

test('window state file: save and load, junk gives null, capture uses the normal bounds', () => {
  const f = path.join(tmp('ws'), 'deep', 'window-state.json');
  assert.strictEqual(WS.load(f), null);
  assert.ok(WS.save(f, { x: 1, y: 2, width: 800, height: 600, maximized: false }));
  assert.deepStrictEqual(WS.load(f), { x: 1, y: 2, width: 800, height: 600, maximized: false });
  fs.writeFileSync(f, '{oops');
  assert.strictEqual(WS.load(f), null);
  assert.strictEqual(WS.save(path.join(f, 'under-a-file', 'x.json'), {}), false);
  const win = { getNormalBounds: () => ({ x: 3, y: 4, width: 500, height: 400 }), isMaximized: () => true };
  assert.deepStrictEqual(WS.capture(win), { x: 3, y: 4, width: 500, height: 400, maximized: true });
  assert.deepStrictEqual(WS.capture({ getBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }), isMaximized: () => false }), { x: 0, y: 0, width: 1, height: 1, maximized: false });
});

test('law R1: marks come back after a restart under the real path, also where paths ignore case (Windows)', async () => {
  for (const caseInsensitive of [false, true]) {
    const data = tmp('marks-case');
    const dir = tmp('MixedCase');
    fs.copyFileSync(path.join(FIX, 'orca.gcode'), path.join(dir, 'Benchy Part.GCODE'));
    const lib = new Library({ dataDir: data, inline: true, pollMs: 0, caseInsensitive });
    const file = (await lib.open(dir)).items[0].path;
    lib.mark(file, { favorite: true, tags: ['x'] });
    lib.dispose();
    const again = new Library({ dataDir: data, inline: true, pollMs: 0, caseInsensitive });
    try {
      const r = await again.open(dir);
      assert.strictEqual(r.items[0].path, file);
      assert.deepStrictEqual(r.marks[file] && r.marks[file].tags, ['x'], `caseInsensitive=${caseInsensitive}: ${Object.keys(r.marks)}`);
      assert.deepStrictEqual(Object.keys(again.folderMarks()), [file]);
    } finally { again.dispose(); }
  }
});

test('law R4: two folders opened at once - the last one wins, the earlier answer is marked stale, no watcher left on the first', async () => {
  const changes = [];
  const lib = new Library({ dataDir: tmp('data'), inline: true, pollMs: 200, debounceMs: 30, onItems: (d) => changes.push(d) });
  try {
    const a = tmp('A'), b = tmp('B');
    for (let i = 0; i < 300; i++) fs.copyFileSync(path.join(FIX, 'cube.stl'), path.join(a, `a${i}.stl`));
    fs.copyFileSync(path.join(FIX, 'orca.gcode'), path.join(b, 'b.gcode'));
    const [ra, rb] = await Promise.all([lib.open(a), lib.open(b)]);
    assert.strictEqual(ra.stale, true);
    assert.strictEqual(rb.stale, undefined);
    assert.strictEqual(rb.folder, path.resolve(b));
    assert.deepStrictEqual(rb.items.map((x) => x.name), ['b.gcode']);
    assert.strictEqual(lib.folder, path.resolve(b));
    assert.ok(lib.has(path.join(b, 'b.gcode')));
    assert.ok(!lib.has(path.join(a, 'a0.stl')));
    fs.copyFileSync(path.join(FIX, 'cube.stl'), path.join(a, 'late.stl'));
    await new Promise((r) => setTimeout(r, 700));
    assert.deepStrictEqual(changes.filter((c) => c.folder !== path.resolve(b)), [], 'nothing from the first folder');
    assert.deepStrictEqual(changes.filter((c) => c.removed.length || c.added.length), [], 'no fake removed/added');
  } finally { lib.dispose(); }
});

test('law R11: files whose names are not valid UTF-8 are counted and reported, not dropped silently; the large view parse is reused', async (t) => {
  const dir = tmp('names');
  fs.copyFileSync(path.join(FIX, 'orca.gcode'), path.join(dir, 'ok.gcode'));
  try { fs.writeFileSync(Buffer.concat([Buffer.from(dir + '/bad-'), Buffer.from([0xff, 0xfe]), Buffer.from('.gcode')]), 'G1 X1\n'); } catch { t.skip('this file system refuses such names'); return; }
  const lib = new Library({ dataDir: tmp('data'), inline: true, pollMs: 0 });
  try {
    const r = await lib.open(dir);
    assert.deepStrictEqual(r.items.map((x) => x.name), ['ok.gcode']);
    assert.strictEqual(r.skipped, 1);
    let runs = 0;
    const run = lib.pool.run.bind(lib.pool);
    lib.pool.run = (...a) => { runs++; return run(...a); };
    const file = path.join(dir, 'ok.gcode');
    const a = await lib.detail(file), b = await lib.detail(file);
    assert.strictEqual(runs, 1, 'the second opening of the large view does not parse again');
    assert.deepStrictEqual(b.info, a.info);
  } finally { lib.dispose(); }
});
