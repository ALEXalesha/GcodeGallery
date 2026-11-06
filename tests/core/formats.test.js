// Законы разбора файлов: сведения каждого образца сходятся с эталоном (tests/fixtures/expected.json),
// разбор не падает на мусоре, форматы распаковываются туда-обратно.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const fc = require('fast-check');
const { opts } = require('../support/seed');
const { processFile, processBuffer } = require('../../src/core/item');
const { readItem, kindOf, isSupported, parseSliceInfo, EXTENSIONS } = require('../../src/core/formats');
const { parseBgcode, isBgcode, parseIni } = require('../../src/core/bgcode');
const Heatshrink = require('../../src/core/heatshrink');
const MeatPack = require('../../src/core/meatpack');
const Thumbs = require('../../src/core/thumbs');
const { parseGcodePreview } = require('../../src/shared/gcode-preview');
const { heatshrinkEncode, meatpackEncode, qoiEncode, bgcodeWrite } = require('../support/encoders');
const { makeGcode, picture } = require('../support/gen');
const { writeZip } = require('../../src/shared/zip');

const FIX = path.join(__dirname, '..', 'fixtures');
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));

test('law: every slicer sample gives exactly the reference info (Orca, Elegoo, Slicer CC, Prusa, Bambu, Cura, .bgcode, .gcode.3mf, .stl, .3mf)', () => {
  assert.ok(Object.keys(EXPECTED).length >= 17);
  for (const [name, want] of Object.entries(EXPECTED)) {
    const { info } = processFile(path.join(FIX, name));
    for (const [k, v] of Object.entries(want)) {
      const got = k === 'bed' && info.bed ? { x: info.bed.x, y: info.bed.y, z: info.bed.z } : info[k];
      assert.deepStrictEqual(got, v, `${name}: ${k}`);
    }
  }
});

test('law: every sample of a sliced file has a 3D path within its own dims, and the layers of the file', () => {
  for (const [name, want] of Object.entries(EXPECTED)) {
    if (want.error || want.dims === null) continue;
    const { info, view } = processFile(path.join(FIX, name));
    assert.ok(view, name);
    const b = view.bounds;
    const size = [0, 1, 2].map((k) => Math.round((b.max[k] - (view.type === 'path' && k === 2 ? 0 : b.min[k])) * 100) / 100);
    assert.deepStrictEqual(size, info.dims, name);
    if (view.type === 'path') assert.strictEqual(view.layers.length, info.layersFound, name);
  }
});

test('law: every sliced sample with line types has outer walls and infill (types of Orca, Prusa, Cura and Bambu are understood)', () => {
  for (const name of ['orca.gcode', 'elegoo.gcode', 'slicercc.gcode', 'prusa.gcode', 'bambu.gcode', 'cura.gcode', 'cura-griffin.gcode', 'prusa.bgcode', 'bambu.gcode.3mf']) {
    const { view } = processFile(path.join(FIX, name));
    const ids = view.kinds.map((k) => k.id);
    for (const k of ['outer', 'inner', 'skirt']) assert.ok(ids.includes(k), `${name}: ${k} in ${ids}`);
    assert.ok(ids.includes('sparse') || ids.includes('solid'), name);
    const custom = view.kinds.findIndex((k) => k.id === 'custom');
    const segs = (i) => view.data[i].positions.length / 6;
    assert.ok(custom < 0 || segs(custom) <= 6, `${name}: only the start code (purge) is "other", got ${custom >= 0 && segs(custom)}`);
  }
});

test('the same bytes give the same info as the file (processBuffer = processFile), and a sample never throws', () => {
  for (const name of Object.keys(EXPECTED)) {
    const file = path.join(FIX, name);
    const a = processFile(file).info;
    const b = processBuffer(fs.readFileSync(file), file, { size: a.size, mtimeMs: a.mtimeMs }).info;
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), name);
  }
});

test('kinds by name: double extension .gcode.3mf, case, unknown', () => {
  assert.strictEqual(kindOf('A.GCODE'), 'gcode');
  assert.strictEqual(kindOf('a.gco'), 'gcode');
  assert.strictEqual(kindOf('part.g'), 'gcode');
  assert.strictEqual(kindOf('Plate.Gcode.3MF'), 'gcode3mf');
  assert.strictEqual(kindOf('x.bgcode'), 'bgcode');
  assert.strictEqual(kindOf('x.3mf'), '3mf');
  assert.strictEqual(kindOf('x.STL'), 'stl');
  assert.strictEqual(kindOf('x.obj'), null);
  assert.strictEqual(kindOf(''), null);
  assert.strictEqual(kindOf(null), null);
  assert.ok(EXTENSIONS.every((e) => isSupported('a' + e)));
  assert.strictEqual(isSupported('readme.txt'), false);
});

test('law: parsing never throws on junk - random bytes under every supported name give info with kind or error', () => {
  fc.assert(fc.property(fc.uint8Array({ maxLength: 3000 }), fc.constantFrom('a.gcode', 'a.bgcode', 'a.3mf', 'a.gcode.3mf', 'a.stl'), (bytes, name) => {
    const r = processBuffer(Buffer.from(bytes), name);
    assert.ok(r.info.kind || r.info.error, JSON.stringify(r.info));
    assert.strictEqual(r.info.name, name);
  }), opts(400));
});

test('law: random G-code text (commands, comments, junk lines) never breaks the parser and the path stays finite', () => {
  const line = fc.oneof(
    fc.tuple(fc.constantFrom('G0', 'G1', 'G2', 'G3', 'G1', 'G91', 'G90', 'G92', 'M82', 'M83'), fc.array(fc.tuple(fc.constantFrom('X', 'Y', 'Z', 'E', 'F', 'I', 'J'), fc.double({ min: -500, max: 500, noNaN: true })), { maxLength: 5 }))
      .map(([c, args]) => c + ' ' + args.map(([k, v]) => k + v.toFixed(3)).join(' ')),
    fc.constantFrom(';LAYER_CHANGE', ';Z:0.2', ';TYPE:Outer wall', ';TYPE:WALL-INNER', '; FEATURE: Sparse infill', ';LAYER:3', '; CHANGE_LAYER', '; Z_HEIGHT: 1.2',
      '; filament used [g] = 3.5', '; estimated printing time (normal mode) = 1h', ';TIME:99', '; thumbnail begin 2x2 4', '; thumbnail end', ';', ''),
    fc.string({ maxLength: 40 }),
  );
  fc.assert(fc.property(fc.array(line, { maxLength: 120 }), (lines) => {
    const text = lines.join('\n');
    const r = processBuffer(Buffer.from(text), 'x.gcode');
    assert.strictEqual(r.info.kind, 'gcode');
    for (const d of r.view.data) for (const v of d.positions) assert.ok(Number.isFinite(v));
    if (r.info.dims) for (const v of r.info.dims) assert.ok(Number.isFinite(v));
    assert.ok(r.info.timeSec === null || r.info.timeSec >= 0);
  }), opts(300));
});

test('law: heatshrink decodes what it encodes, for both window sizes', () => {
  fc.assert(fc.property(fc.oneof(fc.uint8Array({ maxLength: 4000 }), fc.string({ maxLength: 3000 }).map((s) => new Uint8Array(Buffer.from(s.repeat(3))))), fc.constantFrom(11, 12), (data, w) => {
    const buf = Buffer.from(data);
    assert.deepStrictEqual(Heatshrink.decode(heatshrinkEncode(buf, w, 4), w, 4, buf.length), buf);
  }), opts(200));
});

test('heatshrink refuses bad streams instead of reading garbage', () => {
  assert.throws(() => Heatshrink.decode(Buffer.from([0x00, 0x00, 0x00]), 12, 4, 5), /reference before the start|got/);
  assert.throws(() => Heatshrink.decode(Buffer.from([]), 12, 4, 3), /got 0 bytes/);
  assert.throws(() => Heatshrink.decode(Buffer.from([1]), 3, 4, 1), /bad parameters/);
});

test('law: MeatPack keeps every command of G-code (as the parser sees it) and every whole-line comment', () => {
  const gline = fc.tuple(fc.constantFrom('G0', 'G1', 'G1', 'G92', 'M104', 'M140', 'M83', 'G28'),
    fc.array(fc.tuple(fc.constantFrom('X', 'Y', 'Z', 'E', 'F', 'S'), fc.integer({ min: -99999, max: 99999 })), { maxLength: 4 }))
    .map(([c, a]) => c + a.map(([k, v]) => ' ' + k + (v / 100).toFixed(2)).join(''));
  const comment = fc.constantFrom(';LAYER_CHANGE', ';Z:0.4', ';TYPE:Outer wall', '; some note with spaces', ';TYPE:Support material');
  fc.assert(fc.property(fc.array(fc.oneof(gline, gline, comment), { minLength: 1, maxLength: 80 }), fc.boolean(), (lines, nospace) => {
    const text = lines.join('\n') + '\n';
    const back = MeatPack.decode(meatpackEncode(text, { comments: true, nospace }));
    const norm = (t) => t.split('\n').filter(Boolean).map((l) => (l.startsWith(';') ? l : l.replace(/\s+/g, '')));
    assert.deepStrictEqual(norm(back), norm(text));
    const a = parseGcodePreview(text), b = parseGcodePreview(back);
    assert.deepStrictEqual(b.layers, a.layers);
    assert.deepStrictEqual(b.kinds.map((k) => k.segments), a.kinds.map((k) => k.segments));
  }), opts(200));
});

test('MeatPack: packing off copies bytes; a lone 0xFF is a byte, not a command', () => {
  assert.strictEqual(MeatPack.decode(Buffer.from('G1 X1\n')), 'G1 X1\n');
  assert.strictEqual(MeatPack.decode(Buffer.from([0x41, 0xff, 0x42])), 'AÿB'.replace('ÿ', Buffer.from([0xff]).toString('utf8')));
  assert.strictEqual(MeatPack.decode(Buffer.from([0xff, 0xff, 251, 0xff, 0xff, 250, 0x4d, 0x0a])), 'M\n');
});

test('law: .bgcode written with any compression, encoding and checksum reads back to the same metadata, pictures and commands', () => {
  const sample = makeGcode({ flavor: 'prusa', version: '2.8.1', date: '2024-01-01T00:00:00', printer: 'P', printerModel: 'MK4', bed: [250, 210, 220], filamentType: 'PLA',
    filamentName: 'F', color: '#FF0000', density: 1.24, nozzle: 0.4, lh: 0.2, nozzleTemp: 215, bedTemp: 60, time: '10m', mm: 100, g: 1, cm3: 1, box: { x0: 10, y0: 10, w: 8, d: 8, h: 1 } }).text;
  fc.assert(fc.property(fc.constantFrom(0, 1, 2, 3), fc.constantFrom(0, 1, 2), fc.constantFrom(0, 1), fc.constantFrom(0, 1), fc.integer({ min: 200, max: 20000 }),
    (compression, enc, checksum, metaCompression, chunk) => {
      const thumbs = [{ format: 'qoi', width: 8, height: 8, data: qoiEncode(8, 8, picture(8, 8)) }];
      const buf = bgcodeWrite({ fileMeta: { Producer: 'PrusaSlicer 2.8.1' }, printerMeta: { printer_model: 'MK4', 'filament used [g]': '1.5' }, printMeta: { a: '1' },
        slicerMeta: { layer_height: '0.2' }, thumbnails: thumbs, gcode: sample, compression, gcodeEncoding: enc, checksum, metaCompression, gcodeChunk: chunk });
      assert.ok(isBgcode(buf));
      const r = parseBgcode(buf);
      assert.strictEqual(r.fileMeta.Producer, 'PrusaSlicer 2.8.1');
      assert.strictEqual(r.printerMeta['filament used [g]'], '1.5');
      assert.strictEqual(r.slicerMeta.layer_height, '0.2');
      assert.deepStrictEqual(r.thumbnails.map((t) => [t.format, t.width, t.data.length]), [['qoi', 8, thumbs[0].data.length]]);
      const cmds = (t) => t.split('\n').map((l) => l.split(';')[0].replace(/\s+/g, '')).filter(Boolean);
      assert.deepStrictEqual(cmds(r.gcode), cmds(sample));
      if (enc !== 1) assert.deepStrictEqual(parseGcodePreview(r.gcode).layers, parseGcodePreview(sample).layers);
    }), opts(60));
});

test('law: a damaged .bgcode is refused (bad magic, cut, wrong CRC, unknown block), never half-read', () => {
  const good = fs.readFileSync(path.join(FIX, 'prusa.bgcode'));
  assert.throws(() => parseBgcode(Buffer.from('GCDX' + 'x'.repeat(20))), /no GCDE/);
  fc.assert(fc.property(fc.integer({ min: 11, max: good.length - 1 }), (cut) => {
    assert.throws(() => parseBgcode(good.subarray(0, cut)), (e) => e.code === 'bad-bgcode' || e.code === 'bad-heatshrink');
  }), opts(80));
  fc.assert(fc.property(fc.integer({ min: 30, max: good.length - 1 }), fc.integer({ min: 1, max: 255 }), (at, x) => {
    const bad = Buffer.from(good);
    bad[at] ^= x;
    assert.throws(() => parseBgcode(bad));
  }), opts(80));
  const unknown = Buffer.from(good); unknown.writeUInt16LE(9, 10);
  assert.throws(() => parseBgcode(unknown), /unknown block|crc/);
  const badCheck = Buffer.from(good); badCheck.writeUInt16LE(7, 8);
  assert.throws(() => parseBgcode(badCheck), /unknown checksum/);
  assert.deepStrictEqual(parseIni('a=1\nno equals\n=x\n b = 2 \n'), { a: '1', b: '2' });
});

test('bgcode: metadata only (gcode: false) is fast and gives no G-code; unknown encodings are refused', () => {
  const r = parseBgcode(fs.readFileSync(path.join(FIX, 'prusa.bgcode')), { gcode: false });
  assert.strictEqual(r.gcode, null);
  assert.ok(r.thumbnails.length === 2);
  const bad = bgcodeWrite({ printerMeta: {}, gcode: 'G1 X1\n', compression: 0, metaCompression: 0, gcodeEncoding: 0, checksum: 0 });
  const i = bad.lastIndexOf(Buffer.from([1, 0, 0, 0]));
  const b2 = Buffer.from(bad); b2.writeUInt16LE(5, i + 8);
  assert.throws(() => parseBgcode(b2), /unknown gcode encoding/);
  const metaEnc = Buffer.from(bad); metaEnc.writeUInt16LE(3, 10 + 8);
  assert.throws(() => parseBgcode(metaEnc), /unknown metadata encoding/);
  const comp = Buffer.from(bad); comp.writeUInt16LE(7, 10 + 2);
  assert.throws(() => parseBgcode(comp));
});

test('law: QOI decodes what it encodes, and becomes a PNG data URL', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 24 }), fc.integer({ min: 1, max: 24 }), fc.uint8Array({ minLength: 24 * 24 * 4, maxLength: 24 * 24 * 4 }), fc.boolean(), (w, h, bytes, flat) => {
    const rgba = Buffer.from(bytes.subarray(0, w * h * 4));
    if (flat) for (let i = 0; i < rgba.length; i++) rgba[i] = (i % 4 === 3) ? 255 : (i >> 6) & 255;
    const q = Thumbs.qoiDecode(qoiEncode(w, h, rgba));
    assert.strictEqual(q.width, w); assert.strictEqual(q.height, h);
    assert.deepStrictEqual(q.rgba, rgba);
    const url = Thumbs.toDataUrl({ format: 'qoi', data: qoiEncode(w, h, rgba) });
    assert.ok(url.startsWith('data:image/png;base64,'));
    const png = Buffer.from(url.slice(22), 'base64');
    assert.strictEqual(png.readUInt32BE(16), w);
  }), opts(150));
  assert.throws(() => Thumbs.qoiDecode(Buffer.from('nope')), /no qoif/);
  const zero = qoiEncode(1, 1, Buffer.from([1, 2, 3, 255])); zero.writeUInt32BE(0, 4);
  assert.throws(() => Thumbs.qoiDecode(zero), /bad size/);
});

test('thumbnails: from G-code comments (PNG, QOI, JPG), the right one for a tile, broken ones dropped', () => {
  const png = Thumbs.pngEncode(4, 4, picture(4, 4));
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const b = (tag, w, d) => [`; ${tag} begin ${w}x${w} ${d.toString('base64').length}`, '; ' + d.toString('base64'), `; ${tag} end`];
  const text = ['; header', ...b('thumbnail', 4, png), ...b('thumbnail_JPG', 300, jpg), ...b('thumbnail_QOI', 2, qoiEncode(2, 2, Buffer.alloc(16, 200))),
    '; thumbnail begin 9x9 10', '; never closed', 'G1 X1'].join('\n');
  const list = Thumbs.gcodeThumbnails(text);
  assert.deepStrictEqual(list.map((t) => [t.format, t.width]), [['png', 4], ['jpg', 300], ['qoi', 2]]);
  assert.strictEqual(Thumbs.pick(list, 240).format, 'jpg');
  assert.strictEqual(Thumbs.pick(list.slice(0, 1), 240).width, 4);
  assert.strictEqual(Thumbs.pick([], 240), null);
  assert.strictEqual(Thumbs.pick([{ format: 'png', width: 5, data: Buffer.from('xx') }]), null);
  assert.ok(Thumbs.toDataUrl(list[1]).startsWith('data:image/jpeg'));
  assert.strictEqual(Thumbs.toDataUrl({ format: 'qoi', data: Buffer.from('qoif' + 'x'.repeat(30)) }), null);
  assert.strictEqual(Thumbs.toDataUrl(null), null);
  assert.strictEqual(Thumbs.toDataUrl({ format: 'bmp', data: Buffer.from('BM') }), null);
  assert.deepStrictEqual(Thumbs.gcodeThumbnails(null), []);
  assert.deepStrictEqual(Thumbs.gcodeThumbnails('; thumbnail begin 2x2 4\n; \n; thumbnail end\n'), []);
});

test('law: thumbnails of every sample turn into PNG/JPG for the window', () => {
  for (const [name, want] of Object.entries(EXPECTED)) {
    if (!want.thumbs) continue;
    const r = processFile(path.join(FIX, name));
    assert.ok(/^data:image\/(png|jpeg);base64,/.test(r.thumb), name);
  }
});

test('.gcode.3mf: slice_info parsing; a .3mf with a plate is a sliced file; a .gcode.3mf without a plate is an error', () => {
  const si = parseSliceInfo('<config><header><header_item key="X-BBL-Client-Version" value="02.00.01.50"/></header><plate><metadata key="index" value="2"/>' +
    '<metadata key="prediction" value="99"/><filament id="1" type="ABS" color="#000000" used_m="1.5" used_g="4"/></plate></config>');
  assert.deepStrictEqual(si, { client: '02.00.01.50', plates: [{ index: 2, prediction: 99, weight: null, printer: '', filaments: [{ type: 'ABS', color: '#000000', usedM: 1.5, usedG: 4 }] }] });
  assert.deepStrictEqual(parseSliceInfo(''), { client: '', plates: [] });
  const zip = fs.readFileSync(path.join(FIX, 'bambu.gcode.3mf'));
  assert.strictEqual(readItem(zip, 'project.3mf').kind, 'gcode3mf');
  const noPlate = writeZip([{ name: '3D/3dmodel.model', data: '<model/>' }]);
  assert.throws(() => readItem(noPlate, 'x.gcode.3mf'), (e) => e.code === 'no-plate');
  assert.throws(() => readItem(Buffer.from('x'), 'x.txt'), (e) => e.code === 'type');
  assert.strictEqual(readItem(zip, 'a.gcode.3mf', { gcode: false }).gcode, null);
});

test('a .gcode file that is really binary G-code is read as .bgcode', () => {
  const buf = fs.readFileSync(path.join(FIX, 'prusa.bgcode'));
  assert.strictEqual(readItem(buf, 'renamed.gcode').kind, 'bgcode');
});

test('3mf model with a picture inside: the picture is used for the tile', () => {
  const { model3mfXml, cube } = require('../support/gen');
  const zip = writeZip([{ name: '3D/3dmodel.model', data: model3mfXml(cube(5)) }, { name: 'Metadata/thumbnail.png', data: Thumbs.pngEncode(8, 8, picture(8, 8)) }]);
  const r = processBuffer(zip, 'm.3mf');
  assert.strictEqual(r.info.kind, '3mf');
  assert.ok(r.thumb.startsWith('data:image/png'));
  assert.deepStrictEqual(r.info.dims, [5, 5, 5]);
});

test('deflate bomb guard: metadata block bigger than declared is refused', () => {
  const big = zlib.deflateSync(Buffer.alloc(100000, 0x41));
  const h = Buffer.alloc(12); h.writeUInt16LE(3, 0); h.writeUInt16LE(1, 2); h.writeUInt32LE(10, 4); h.writeUInt32LE(big.length, 8);
  const file = Buffer.concat([Buffer.from('GCDE'), Buffer.from([1, 0, 0, 0, 0, 0]), h, Buffer.from([0, 0]), big]);
  assert.throws(() => parseBgcode(file));
});
