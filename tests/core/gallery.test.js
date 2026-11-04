// Законы ленты без окна: поиск, фильтры, сортировка, очередь превью, подписи, тексты на двух языках.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fc = require('fast-check');
const { opts } = require('../support/seed');
const { processFile } = require('../../src/core/item');

const load = () => Promise.all(['filter', 'queue', 'format', 'i18n'].map((m) => import(`../../src/gallery/${m}.js`)));

const arbItem = fc.record({
  name: fc.oneof(fc.constantFrom('a.gcode', 'B 10.gcode', 'b 9.gcode', 'Кронштейн.gcode', 'z.stl'), fc.string({ maxLength: 8 }).map((s) => s + '.gcode')),
  size: fc.integer({ min: 0, max: 1e7 }),
  mtimeMs: fc.integer({ min: 1, max: 2e12 }),
  kind: fc.constantFrom('gcode', 'bgcode', 'stl', 'gcode3mf'),
  info: fc.option(fc.record({
    timeSec: fc.option(fc.integer({ min: 0, max: 400000 })), filamentG: fc.option(fc.double({ min: 0, max: 2000, noNaN: true })),
    filamentType: fc.option(fc.constantFrom('PLA', 'PETG', 'pla', 'ABS')), printer: fc.option(fc.constantFrom('Elegoo Centauri Carbon', 'MK4')),
    slicedAt: fc.option(fc.constantFrom('2024-05-01T10:00:00', '2023-01-01T00:00:00Z', 'nonsense')),
  }, { requiredKeys: [] }), { nil: undefined }),
}).map((x, ) => x);

const withPaths = (items) => items.map((it, i) => Object.assign({}, it, { path: '/f/' + i + '/' + it.name, rel: it.name }));

test('law: sort is a permutation, ordered by the key, empty values last, stable for equal keys', async () => {
  const [F] = await load();
  fc.assert(fc.property(fc.array(arbItem, { maxLength: 40 }).map(withPaths), fc.constantFrom('name', 'date', 'sliced', 'time', 'weight', 'size', 'junk'), fc.constantFrom('asc', 'desc'), (items, sort, dir) => {
    const out = F.sortItems(items, sort, dir);
    assert.strictEqual(out.length, items.length);
    assert.deepStrictEqual(new Set(out.map((x) => x.path)), new Set(items.map((x) => x.path)));
    const key = { name: (x) => x.name, date: (x) => x.mtimeMs, sliced: F.dateOf, time: (x) => x.info && x.info.timeSec, weight: (x) => x.info && x.info.filamentG, size: (x) => x.size, junk: (x) => x.mtimeMs }[sort];
    const missing = (v) => v === null || v === undefined;
    let seenMissing = false;
    for (let i = 0; i < out.length; i++) {
      const v = key(out[i]);
      if (missing(v)) { seenMissing = true; continue; }
      assert.ok(!seenMissing, 'a value after an empty one');
      if (i > 0 && !missing(key(out[i - 1])) && typeof v === 'number') {
        const prev = key(out[i - 1]);
        assert.ok(dir === 'asc' ? prev <= v : prev >= v, `${sort} ${dir}: ${prev} then ${v}`);
      }
    }
    assert.deepStrictEqual(F.sortItems(out, sort, dir), out, 'sorting a sorted list changes nothing');
  }), opts(300));
});

test('names sort like a person sorts them: 9 before 10, case ignored', async () => {
  const [F] = await load();
  const items = withPaths([{ name: 'B 10.gcode' }, { name: 'b 9.gcode' }, { name: 'a.gcode' }]);
  assert.deepStrictEqual(F.sortItems(items, 'name', 'asc').map((x) => x.name), ['a.gcode', 'b 9.gcode', 'B 10.gcode']);
});

test('law: filters only remove, never add; each extra condition gives a subset; empty filter keeps all', async () => {
  const [F] = await load();
  const filt = fc.record({ query: fc.constantFrom('', 'pla', 'mk4', 'b', 'кронш', 'нет такого'), types: fc.subarray(['PLA', 'PETG', 'ABS']), kinds: fc.subarray(['gcode', 'stl']),
    favorite: fc.boolean(), printed: fc.constantFrom('', 'yes', 'no'), tag: fc.constantFrom('', 'work'), timeMin: fc.option(fc.integer({ min: 0, max: 200000 })),
    timeMax: fc.option(fc.integer({ min: 0, max: 400000 })), weightMin: fc.option(fc.integer({ min: 0, max: 100 })), weightMax: fc.option(fc.integer({ min: 0, max: 2000 })),
    dateFrom: fc.option(fc.integer({ min: 0, max: 2e12 })), dateTo: fc.option(fc.integer({ min: 0, max: 2e12 })) }, { requiredKeys: [] });
  fc.assert(fc.property(fc.array(arbItem, { maxLength: 30 }).map(withPaths), filt, filt, fc.array(fc.record({ favorite: fc.boolean(), tags: fc.constantFrom([], ['work']), printed: fc.constantFrom('', 'yes', 'no'), note: fc.constant('') })),
    (items, f1, f2, ms) => {
      const marks = Object.fromEntries(items.map((it, i) => [it.path, ms[i]]).filter(([, m]) => m));
      assert.strictEqual(F.filterItems(items, {}, marks).length, items.length);
      const a = F.filterItems(items, f1, marks);
      assert.ok(a.every((x) => items.includes(x)));
      const both = Object.assign({}, f1);
      for (const [k, v] of Object.entries(f2)) if (v !== null && v !== '' && v !== false && !(Array.isArray(v) && !v.length) && (both[k] === undefined || both[k] === null || both[k] === '' || both[k] === false || (Array.isArray(both[k]) && !both[k].length))) both[k] = v;
      const b = F.filterItems(items, both, marks);
      assert.ok(b.every((x) => a.includes(x)), 'more conditions - subset');
      assert.ok(F.activeCount(both) >= F.activeCount(f1));
    }), opts(300));
});

test('search looks at name, filament, printer, slicer, tags and note; every word must match', async () => {
  const [F] = await load();
  const it = { path: '/x/Bracket.gcode', name: 'Bracket.gcode', rel: 'parts/Bracket.gcode', info: { filamentType: 'PETG', printer: 'Elegoo Centauri Carbon', slicer: 'OrcaSlicer' } };
  const mark = { tags: ['Garage'], note: 'reprint in black' };
  for (const q of ['bracket', 'parts', 'petg', 'centauri', 'orca', 'garage', 'black', 'petg  carbon']) assert.ok(F.matchesQuery(it, q, mark), q);
  assert.ok(!F.matchesQuery(it, 'petg pla', mark));
  assert.ok(F.matchesQuery(it, '', null));
  assert.deepStrictEqual(F.facets([it, { kind: 'stl', info: { filamentType: 'petg' } }, { kind: 'gcode', info: { filamentType: 'ABS' } }]), { types: ['ABS', 'PETG'], kinds: ['gcode', 'stl'] });
  const p = { path: '/p', name: 'p', info: {} };
  assert.ok(F.matches(p, Object.assign({}, F.EMPTY, { printed: 'no' }), null));
  assert.ok(!F.matches(p, Object.assign({}, F.EMPTY, { printed: 'no' }), { printed: 'yes', tags: [] }));
  assert.ok(!F.matches(p, Object.assign({}, F.EMPTY, { tag: 'x' }), null));
  assert.ok(!F.matches(p, Object.assign({}, F.EMPTY, { timeMin: 1 }), null), 'unknown time does not pass a time range');
});

test('law: preview queue - visible first (top to bottom), each key once, never over the limit', async () => {
  const [, Q] = await load();
  await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 30 }), fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 8 }), fc.integer({ min: 1, max: 4 }), async (all, vis, limit) => {
    const started = [];
    let running = 0, maxRunning = 0;
    const q = new Q.PreviewQueue({ limit, run: async (k) => { started.push(k); running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 1)); running--; } });
    q.paused = true;
    q.add(all);
    const visible = [...new Set(vis)];
    q.setVisible(visible);
    q.paused = false;
    q.pump();
    for (let i = 0; i < 200 && !q.idle; i++) await new Promise((r) => setTimeout(r, 2));
    assert.ok(q.idle);
    assert.ok(maxRunning <= limit);
    assert.strictEqual(new Set(started).size, started.length, 'once each');
    assert.deepStrictEqual(new Set(started), new Set([...all, ...visible]));
    assert.deepStrictEqual(started.slice(0, visible.length), visible, 'visible first, in screen order');
  }), opts(100));
});

test('queue: invalidate runs again, remove drops, failures do not stop the queue', async () => {
  const [, Q] = await load();
  const runs = [], done = [];
  const q = new Q.PreviewQueue({ limit: 1, run: async (k) => { runs.push(k); if (k === 'bad') throw new Error('x'); return k; }, onDone: (k, r, e) => done.push([k, !!e]) });
  q.add(['a', 'bad', 'b', 'a']);
  for (let i = 0; i < 50 && !q.idle; i++) await new Promise((r) => setTimeout(r, 1));
  assert.deepStrictEqual(runs, ['a', 'bad', 'b']);
  assert.deepStrictEqual(done.find((d) => d[0] === 'bad'), ['bad', true]);
  q.invalidate('a');
  for (let i = 0; i < 50 && !q.idle; i++) await new Promise((r) => setTimeout(r, 1));
  assert.deepStrictEqual(runs, ['a', 'bad', 'b', 'a']);
  let release;
  const slow = new Q.PreviewQueue({ limit: 1, run: (k) => { runs.push('slow:' + k); return new Promise((r) => { release = r; }); } });
  slow.add(['x']);
  await new Promise((r) => setTimeout(r, 1));
  slow.invalidate('x');                          // файл поменялся, пока его разбирали
  release(); await new Promise((r) => setTimeout(r, 1));
  release(); await new Promise((r) => setTimeout(r, 1));
  assert.deepStrictEqual(runs.filter((x) => x.startsWith('slow:')), ['slow:x', 'slow:x'], 'changed while running - runs again');
  assert.ok(slow.idle);
  q.paused = true; q.add(['c']); q.remove('c'); q.paused = false; q.pump();
  assert.ok(q.idle);
  q.clear();
  q.add(['a']);
  assert.ok(!q.idle);
});

test('i18n: Russian and English have the same keys; plural forms; unknown key shows itself', async () => {
  const [, , , I] = await load();
  assert.deepStrictEqual(Object.keys(I.DICT.ru).sort(), Object.keys(I.DICT.en).sort());
  assert.deepStrictEqual([1, 2, 5, 11, 21, 22, 25, 112].map((n) => I.plural(n, 'layers', 'ru')), ['слой', 'слоя', 'слоёв', 'слоёв', 'слой', 'слоя', 'слоёв', 'слоёв']);
  assert.deepStrictEqual([1, 2].map((n) => I.plural(n, 'layers', 'en')), ['layer', 'layers']);
  assert.strictEqual(I.t('no.such.key'), 'no.such.key');
  assert.strictEqual(I.t('f.count', { n: 3, m: 9 }, 'en'), '3 of 9');
  assert.strictEqual(I.t('f.count', { n: 3 }, 'en'), '3 of {m}');
  I.setLang('en'); assert.strictEqual(I.getLang(), 'en'); I.setLang('xx'); assert.strictEqual(I.getLang(), 'ru');
  for (const [k, v] of Object.entries(I.DICT.ru)) assert.ok(!/[—–]/.test(v) && !/[—–]/.test(I.DICT.en[k]), 'only plain hyphens: ' + k);
});

test('card lines for every sample: no empty values, cost from the spool price, warnings for a model that does not fit', async () => {
  const [, , Fm] = await load();
  const fs = require('fs');
  const FIX = path.join(__dirname, '..', 'fixtures');
  for (const name of fs.readdirSync(FIX).filter((n) => n !== 'expected.json')) {
    const { info } = processFile(path.join(FIX, name));
    for (const l of ['ru', 'en']) {
      const lines = Fm.cardLines({ name, size: info.size, mtimeMs: info.mtimeMs, info }, { spoolPrice: 2000, spoolGrams: 1000, currency: '₽' }, l);
      assert.ok(lines.length >= 1, name);
      for (const x of lines) { assert.ok(x.label && typeof x.value === 'string' && x.value.length, name + ' ' + x.key); assert.ok(!x.value.includes('undefined') && !x.value.includes('NaN'), name + ' ' + x.value); }
    }
  }
  const orca = processFile(path.join(FIX, 'orca.gcode')).info;
  const lines = Fm.cardLines({ name: 'o', size: 1, mtimeMs: 1, info: orca }, { spoolPrice: 2000, spoolGrams: 1000, currency: '₽' }, 'ru');
  assert.strictEqual(lines.find((x) => x.key === 'cost').value, '7,38 ₽');
  assert.strictEqual(lines.find((x) => x.key === 'filament').color, '#FF8000');
  const big = Object.assign({}, orca, { fits: false });
  assert.ok(Fm.cardLines({ name: 'o', size: 1, mtimeMs: 1, info: big }, {}, 'ru').find((x) => x.key === 'dims').warn);
  assert.strictEqual(Fm.cardLines({ name: 'o', size: 1, mtimeMs: 1, info: big }, {}, 'ru').find((x) => x.key === 'cost'), undefined, 'no price - no cost line');
});

test('law: formatting never prints NaN/undefined for any number', async () => {
  const [, , Fm] = await load();
  fc.assert(fc.property(fc.oneof(fc.double(), fc.constant(null), fc.constant(undefined), fc.integer()), fc.constantFrom('ru', 'en'), (v, l) => {
    for (const s of [Fm.duration(v, l), Fm.grams(v, l), Fm.meters(v, l), Fm.money(v, '$', l), Fm.bytes(v, l), Fm.date(v, l), Fm.temps(v, v, l), Fm.dims([v, v, v], l), Fm.num(v, 1, l)]) {
      assert.ok(typeof s === 'string' && s.length && !/NaN|undefined|Infinity/.test(s), String(s));
    }
  }), opts(500));
  assert.strictEqual(Fm.duration(90061, 'ru'), '1 д 1 ч');
  assert.strictEqual(Fm.duration(59, 'en'), '59 s');
  assert.strictEqual(Fm.duration(61, 'en'), '1 m');
  assert.strictEqual(Fm.grams(1500, 'en'), '1.5 kg');
  assert.strictEqual(Fm.bytes(500, 'en'), '500 B');
  assert.strictEqual(Fm.bytes(2048, 'en'), '2 KB');
  assert.strictEqual(Fm.bytes(3 * 1024 * 1024, 'en'), '3 MB');
  assert.strictEqual(Fm.cost(10, 1500, 1000), 15);
  assert.strictEqual(Fm.cost(0, 1500), null);
  assert.strictEqual(Fm.dims('x'), '-');
});
