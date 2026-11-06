// Законы библиотеки: обход папки, слежение, кэш, отметки, настройки и главный - файлы печати
// не меняются никогда (ни одной записи, ни одного нового файла в папке пользователя).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fc = require('fast-check');
const { opts } = require('../support/seed');
const { scanFolder, diffScans, watchFolder } = require('../../src/core/scan');
const { Cache, keyOf } = require('../../src/core/cache');
const { Marks, cleanMark, cleanTags } = require('../../src/core/marks');
const Settings = require('../../src/core/settings');
const { processFile, VERSION } = require('../../src/core/item');
const { compactPath, compactMesh, serialize, deserialize, cluster } = require('../../src/core/toolpath');
const { parseGcodePreview } = require('../../src/shared/gcode-preview');
const { makeGcode, cube } = require('../support/gen');

const FIX = path.join(__dirname, '..', 'fixtures');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'gg-' + p + '-'));

function copyFixtures(dir) {
  fs.mkdirSync(path.join(dir, 'sub', 'deeper'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.hidden'), { recursive: true });
  const names = fs.readdirSync(FIX).filter((n) => n !== 'expected.json');
  names.forEach((n, i) => fs.copyFileSync(path.join(FIX, n), path.join(dir, i % 3 === 0 ? 'sub' : i % 3 === 1 ? path.join('sub', 'deeper') : '', n)));
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'not a print file');
  fs.copyFileSync(path.join(FIX, 'orca.gcode'), path.join(dir, '.hidden', 'secret.gcode'));
  return names.length;
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { out[f] = 'dir'; walk(f); continue; }
      const st = fs.statSync(f);
      out[f] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') + ' ' + st.size + ' ' + st.mtimeMs;
    }
  };
  walk(dir);
  return out;
}

test('scan: all print files with subfolders, none from hidden folders, no other files; without subfolders - only the top', async () => {
  const dir = tmp('scan');
  const n = copyFixtures(dir);
  const all = await scanFolder(dir);
  assert.strictEqual(all.length, n);
  assert.ok(all.every((f) => !f.rel.includes('.hidden') && f.kind && f.size >= 0 && Number.isInteger(f.mtimeMs)));
  assert.ok(all.some((f) => f.dir === path.join('sub', 'deeper')));
  const top = await scanFolder(dir, { recursive: false });
  assert.ok(top.length > 0 && top.length < n && top.every((f) => f.dir === ''));
  assert.deepStrictEqual(await scanFolder(path.join(dir, 'missing')), []);
  assert.strictEqual((await scanFolder(dir, { limit: 3 })).length, 3);
});

test('scan: a symlink loop does not hang the walk', async (t) => {
  const dir = tmp('loop');
  fs.writeFileSync(path.join(dir, 'a.gcode'), 'G1 X1');
  try { fs.symlinkSync(dir, path.join(dir, 'loop'), 'dir'); } catch { t.skip('no symlinks here'); return; }
  const list = await scanFolder(dir);
  assert.strictEqual(list.length, 1);
});

test('law: diffScans finds exactly what was added, removed and changed', () => {
  const file = fc.record({ path: fc.constantFrom(...'abcdefghij'.split('').map((c) => '/x/' + c)), size: fc.integer({ min: 0, max: 3 }), mtimeMs: fc.integer({ min: 0, max: 3 }) });
  const uniq = (l) => [...new Map(l.map((f) => [f.path, f])).values()];
  fc.assert(fc.property(fc.array(file, { maxLength: 10 }).map(uniq), fc.array(file, { maxLength: 10 }).map(uniq), (a, b) => {
    const d = diffScans(a, b);
    const A = new Map(a.map((f) => [f.path, f])), B = new Map(b.map((f) => [f.path, f]));
    assert.deepStrictEqual(d.added.map((f) => f.path).sort(), b.filter((f) => !A.has(f.path)).map((f) => f.path).sort());
    assert.deepStrictEqual(d.removed.map((f) => f.path).sort(), a.filter((f) => !B.has(f.path)).map((f) => f.path).sort());
    assert.deepStrictEqual(d.changed.map((f) => f.path).sort(), b.filter((f) => A.has(f.path) && (A.get(f.path).size !== f.size || A.get(f.path).mtimeMs !== f.mtimeMs)).map((f) => f.path).sort());
    assert.strictEqual(d.same, !d.added.length && !d.removed.length && !d.changed.length);
    assert.ok(diffScans(b, b).same);
  }), opts(300));
});

test('watch: a new file shows up by itself, a removed one goes away', async () => {
  const dir = tmp('watch');
  fs.writeFileSync(path.join(dir, 'one.gcode'), 'G1 X1\n');
  const initial = await scanFolder(dir);
  const events = [];
  const w = watchFolder(dir, { debounceMs: 50, pollMs: 300, initial, onChange: (d) => events.push(d) });
  try {
    fs.copyFileSync(path.join(FIX, 'orca.gcode'), path.join(dir, 'two.gcode'));
    const until = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50)); };
    await until(() => events.some((e) => e.added.some((f) => f.name === 'two.gcode')));
    assert.ok(events.some((e) => e.added.some((f) => f.name === 'two.gcode')), 'new file seen');
    fs.unlinkSync(path.join(dir, 'one.gcode'));
    await until(() => events.some((e) => e.removed.some((f) => f.name === 'one.gcode')));
    assert.ok(events.some((e) => e.removed.some((f) => f.name === 'one.gcode')), 'removed file seen');
    assert.deepStrictEqual(w.files.map((f) => f.name), ['two.gcode']);
    const before = events.length;
    await w.rescan();
    assert.strictEqual(events.length, before, 'no event when nothing changed');
  } finally { w.close(); }
});

test('law: the gallery never changes print files - scan, parse, cache, marks, settings leave the folder byte for byte', async () => {
  const dir = tmp('ro');
  copyFixtures(dir);
  const before = snapshot(dir);
  const data = tmp('data');
  const cache = new Cache({ dir: path.join(data, 'cache'), version: VERSION });
  const marks = new Marks(path.join(data, 'marks.json'));
  for (const f of await scanFolder(dir)) {
    const r = processFile(f.path);
    cache.put(f.path, f.size, f.mtimeMs, r);
    cache.putShot(f.path, f.size, f.mtimeMs, 'data:image/png;base64,AAAA');
    marks.set(f.path, { favorite: true, tags: ['test'], note: 'x', printed: 'yes' });
    processFile(f.path, { detail: true });
  }
  cache.save();
  Settings.save(path.join(data, 'settings.json'), { folder: dir });
  assert.deepStrictEqual(snapshot(dir), before);
});

test('law: cache answers only for the same path + size + date; survives a restart; junk index = empty cache', () => {
  const dir = tmp('cache');
  const c = new Cache({ dir, version: 1 });
  const r = processFile(path.join(FIX, 'orca.gcode'));
  c.put('/a/b.gcode', 100, 5000, r);
  assert.deepStrictEqual(c.get('/a/b.gcode', 100, 5000), r.info);
  assert.strictEqual(c.get('/a/b.gcode', 101, 5000), null);
  assert.strictEqual(c.get('/a/b.gcode', 100, 5001), null);
  assert.strictEqual(c.get('/a/c.gcode', 100, 5000), null);
  assert.ok(c.thumb('/a/b.gcode', 100, 5000).startsWith('data:image'));
  const v = c.view('/a/b.gcode', 100, 5000);
  assert.strictEqual(v.segments, r.view.segments);
  assert.ok(c.save());
  assert.strictEqual(c.save(), false, 'nothing new - nothing written');
  const again = new Cache({ dir, version: 1 });
  assert.deepStrictEqual(again.get('/a/b.gcode', 100, 5000), r.info);
  assert.strictEqual(new Cache({ dir, version: 2 }).size, 0, 'new parser version - old cache is not used');
  fs.writeFileSync(path.join(dir, 'index.json'), '{"format": 2, "version": 1, "entries": {"x": {"path": 5}}, ');
  assert.strictEqual(new Cache({ dir, version: 1 }).size, 0);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ format: 2, version: 1, entries: { k: { path: '/p', size: 1, mtimeMs: 1, info: {} }, bad: { path: '/q' } } }));
  assert.strictEqual(new Cache({ dir, version: 1 }).size, 1);
  assert.strictEqual(c.view('/none', 1, 1), null);
  fs.writeFileSync(path.join(dir, c.key('/a/b.gcode', 100, 5000) + '.view.bin'), 'garbage');
  assert.strictEqual(c.view('/a/b.gcode', 100, 5000), null);
});

test('law: random sequences of put/get keep the cache equal to a plain map of (path,size,mtime) -> info, within the size limit', () => {
  const op = fc.record({ p: fc.constantFrom('/a', '/b', '/c', '/d'), s: fc.integer({ min: 0, max: 2 }), m: fc.integer({ min: 0, max: 2 }), put: fc.boolean(), v: fc.integer() });
  fc.assert(fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
    const c = new Cache({ dir: tmp('cprop'), version: 0, maxEntries: 1000 });
    const model = new Map();
    for (const o of ops) {
      const k = `${o.p}|${o.s}|${o.m}`;
      if (o.put) { c.put(o.p, o.s, o.m, { info: { v: o.v } }); model.set(k, { v: o.v }); }
      else assert.deepStrictEqual(c.get(o.p, o.s, o.m), model.get(k) || null);
    }
    c.save();
    const r = new Cache({ dir: c.dir, version: 0, maxEntries: 1000 });
    for (const [k, v] of model) { const [p, s, m] = k.split('|'); assert.deepStrictEqual(r.get(p, Number(s), Number(m)), v); }
  }), opts(60));
});

test('cache: least recently used entries go first when over the limit; shots only for known files', () => {
  const c = new Cache({ dir: tmp('lru'), maxEntries: 3 });
  for (const n of ['a', 'b', 'c']) c.put('/' + n, 1, 1, { info: { n }, thumb: 'data:image/png;base64,AA' });
  c.get('/a', 1, 1);
  c.put('/d', 1, 1, { info: { n: 'd' } });
  assert.strictEqual(c.size, 3);
  assert.strictEqual(c.get('/b', 1, 1), null, 'b was the oldest');
  assert.ok(c.get('/a', 1, 1));
  assert.strictEqual(c.thumb('/b', 1, 1), null, 'its files are gone too');
  assert.strictEqual(c.putShot('/zzz', 1, 1, 'data:image/png;base64,AA'), false);
  assert.strictEqual(c.putShot('/a', 1, 1, 'javascript:alert(1)'), false);
  assert.ok(c.putShot('/a', 1, 1, 'data:image/png;base64,AA'));
  assert.strictEqual(c.shot('/a', 1, 1), 'data:image/png;base64,AA');
  assert.strictEqual(keyOf('/x', 1, 1, 0), keyOf('/x', 1, 1.2, 0));
});

test('law: marks are kept apart from files, cleaned, and survive a restart; empty marks vanish', () => {
  const file = path.join(tmp('marks'), 'marks.json');
  const tag = fc.string({ maxLength: 50 });
  fc.assert(fc.property(fc.array(fc.record({ p: fc.constantFrom('/x/a.gcode', '/x/b.gcode'), fav: fc.boolean(), tags: fc.array(tag, { maxLength: 25 }), note: fc.string({ maxLength: 30 }), printed: fc.constantFrom('', 'yes', 'no', 'maybe', 3) }), { maxLength: 10 }), (ops) => {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const m = new Marks(file);
    const model = new Map();
    for (const o of ops) model.set(path.resolve(o.p), m.set(o.p, { favorite: o.fav, tags: o.tags, note: o.note, printed: o.printed }));
    const back = new Marks(file);
    for (const [p, v] of model) assert.deepStrictEqual(back.get(p), v);
    for (const v of Object.values(back.all())) {
      assert.ok(v.tags.length <= 20 && v.tags.every((x) => x === x.trim() && x.length > 0 && x.length <= 40));
      assert.strictEqual(new Set(v.tags.map((x) => x.toLowerCase())).size, v.tags.length);
      assert.ok(['', 'yes', 'no'].includes(v.printed));
    }
  }), opts(100));
  assert.strictEqual(cleanMark(null), null);
  assert.strictEqual(cleanMark({ favorite: false, tags: [], note: ' ', printed: '' }), null);
  assert.deepStrictEqual(cleanTags(['A', 'a', ' b ', 5, '']), ['A', 'b']);
  assert.deepStrictEqual(cleanMark({ printed: 'yes', printedAt: 5.4 }), { favorite: false, tags: [], note: '', printed: 'yes', printedAt: 5 });
  fs.unlinkSync(file);
  const m = new Marks(file);
  m.set('/t/1.gcode', { tags: ['Zeta', 'alpha'] });
  m.set('/t/2.gcode', { tags: ['ALPHA', 'beta'] });
  assert.deepStrictEqual(m.tags(), ['alpha', 'beta', 'Zeta']);
  fs.writeFileSync(file, 'not json');
  assert.deepStrictEqual(new Marks(file).all(), {});
});

test('law: settings from anywhere become valid settings (theme, view, sizes, host)', () => {
  fc.assert(fc.property(fc.anything(), (x) => {
    const s = Settings.clean(x);
    assert.ok(Settings.THEMES.includes(s.theme));
    assert.ok(['grid', 'strip'].includes(s.view));
    assert.ok(s.tileSize >= 140 && s.tileSize <= 420);
    assert.ok(Settings.SORTS.includes(s.sort));
    assert.ok(s.printerHost === '' || /^[A-Za-z0-9.:-]+$/.test(s.printerHost));
    assert.deepStrictEqual(Settings.clean(s), s, 'clean is idempotent');
  }), opts(400));
  assert.strictEqual(Settings.cleanHost('http://10.0.0.5:3030/x'), '10.0.0.5:3030');
  assert.strictEqual(Settings.cleanHost('printer.local'), 'printer.local');
  assert.strictEqual(Settings.cleanHost('bad host'), '');
  assert.strictEqual(Settings.cleanHost('-x'), '');
  assert.strictEqual(Settings.cleanHost(5), '');
  const f = path.join(tmp('set'), 'settings.json');
  assert.deepStrictEqual(Settings.load(f), Settings.clean({}));
  Settings.save(f, { theme: 'night', tileSize: 300, recent: ['a', 'a', 'b'] });
  assert.strictEqual(Settings.load(f).theme, 'night');
  assert.deepStrictEqual(Settings.load(f).recent, ['a', 'b']);
});

test('law: the compact toolpath fits the budget, keeps the layers and stays inside the real path', () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 30 }), fc.integer({ min: 2, max: 30 }), fc.integer({ min: 1, max: 6 }), fc.integer({ min: 40, max: 3000 }), (w, d, h, budget) => {
    const g = makeGcode({ flavor: 'orca', slicer: 'OrcaSlicer', version: '1', date: '2024-01-01T00:00:00', printer: 'p', printerModel: 'p', process: 'p', bed: [256, 256, 256],
      filamentType: 'PLA', filamentName: 'f', color: '#FFFFFF', density: 1.24, nozzle: 0.4, lh: 0.2, nozzleTemp: 200, bedTemp: 60, plate: 'x', time: '1m', mm: 1, g: 1, cm3: 1,
      box: { x0: 50, y0: 50, w, d, h } });
    const p = parseGcodePreview(g.text);
    const c = compactPath(p, { budget });
    assert.ok(c.segments <= budget, `${c.segments} <= ${budget}`);
    assert.strictEqual(c.layers.length, p.layers.length);
    for (const dd of c.data) {
      assert.strictEqual(dd.layerEnd.length, p.layers.length);
      for (let i = 1; i < dd.layerEnd.length; i++) assert.ok(dd.layerEnd[i] >= dd.layerEnd[i - 1]);
      assert.strictEqual(dd.layerEnd[dd.layerEnd.length - 1], dd.positions.length / 6);
    }
    if (c.bounds) for (let k = 0; k < 3; k++) {
      assert.ok(c.bounds.min[k] >= p.bounds.min[k] - 1e-3 && c.bounds.max[k] <= p.bounds.max[k] + 1e-3);
    }
    const back = deserialize(serialize(c));
    assert.deepStrictEqual(back.data.map((x) => [...x.positions]), c.data.map((x) => [...x.positions]));
    assert.deepStrictEqual(back.layers, c.layers);
  }), opts(60));
});

test('mesh: big models are clustered under the budget, the bed is z = 0, serialization round-trips', () => {
  const big = [];
  for (let i = 0; i < 400; i++) big.push(...cube(1 + i * 0.05).map((v, k) => v + (k % 3 === 0 ? i * 0.3 : 0)));
  const m = compactMesh([{ positions: Float32Array.from(big), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 5, 1] }], { budget: 1000 });
  assert.ok(m.triangles <= 1000 && m.triangles > 0);
  assert.strictEqual(m.sourceTriangles, 4800);
  assert.strictEqual(m.bounds.min[2], 0);
  const back = deserialize(serialize(m));
  assert.deepStrictEqual([...back.positions], [...m.positions]);
  assert.strictEqual(cluster(Float32Array.from(cube(1)), 10).length, 0, 'everything in one cell - nothing left');
  assert.throws(() => deserialize(Buffer.from('nope')));
  const cut = serialize(m).subarray(0, 100);
  assert.throws(() => deserialize(cut));
});

test('item: file errors are reported, not thrown; detail mode carries all settings', () => {
  const dir = tmp('item');
  assert.throws(() => processFile(path.join(dir, 'nope.gcode')));
  const d = processFile(path.join(FIX, 'prusa.gcode'), { detail: true });
  assert.strictEqual(d.info.settings.printer_model, 'MK4');
  assert.ok(d.info.settingsCount >= 10);
  assert.strictEqual(processFile(path.join(FIX, 'prusa.gcode')).info.settings, undefined);
  const est = processFile(path.join(FIX, 'plates2.gcode.3mf'));
  assert.strictEqual(est.info.warnings[0], 'plates');
  fs.writeFileSync(path.join(dir, 'bare.gcode'), 'G90\nM83\nG1 Z0.2 F600\nG1 X10 Y0 E1 F600\nG1 X10 Y10 E1\n');
  const bare = processFile(path.join(dir, 'bare.gcode'));
  assert.strictEqual(bare.info.timeEstimated, true);
  assert.ok(bare.info.timeSec > 0);
  assert.strictEqual(bare.info.layers, 1);
});

test('law R8: the window may reopen only a folder the person chose before (recent list), not any path', () => {
  const s = Settings.clean({ folder: '/home/a/Prints', recent: ['/home/a/Prints', '/home/a/Old'] });
  assert.strictEqual(Settings.canOpen('/home/a/Prints', s), true);
  assert.strictEqual(Settings.canOpen('/home/a/Old/', s), true);
  assert.strictEqual(Settings.canOpen('/home/a/Prints/../Old', s), true);
  for (const p of ['/', '/home', '/home/a', '/etc', '', null, 5, '/home/a/Prints/sub']) assert.strictEqual(Settings.canOpen(p, s), false, String(p));
  assert.strictEqual(Settings.canOpen('C:\\PRINTS', Settings.clean({ recent: ['C:\\Prints'] }), { caseInsensitive: true }), true);
  assert.strictEqual(Settings.canOpen('/x', s, { extra: ['/x'] }), true);
});
