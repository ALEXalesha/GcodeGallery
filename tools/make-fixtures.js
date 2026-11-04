// Образцы файлов каждого слайсера для законов: tests/fixtures/*.  Запуск: npm run fixtures.
// Эталон (что разбор обязан найти) - tests/fixtures/expected.json, пишется из тех же spec.
'use strict';
const fs = require('fs');
const path = require('path');
const { makeGcode, picture, cube, stlBinary, stlAscii, model3mfXml, body } = require('../tests/support/gen');
const { bgcodeWrite, qoiEncode } = require('../tests/support/encoders');
const { pngEncode } = require('../src/core/thumbs');
const { writeZip } = require('../src/shared/zip');

const DIR = path.join(__dirname, '..', 'tests', 'fixtures');
const box = (x0, y0, w = 20, d = 20, h = 4) => ({ x0, y0, w, d, h });

const SPECS = {
  'orca.gcode': { flavor: 'orca', slicer: 'OrcaSlicer', version: '2.1.1', date: '2024-05-01T10:00:00', printer: 'Elegoo Centauri Carbon 0.4 nozzle',
    printerModel: 'Elegoo Centauri Carbon', process: '0.20mm Standard @Elegoo CC 0.4 nozzle', bed: [256, 256, 256], filamentType: 'PLA', filamentName: 'Elegoo PLA',
    color: '#FF8000', density: 1.24, nozzle: 0.4, lh: 0.2, nozzleTemp: 220, bedTemp: 55, plate: 'Textured PEI Plate', time: '1h 2m 3s', timeSec: 3723,
    mm: 1234.56, g: 3.69, cm3: 2.97, box: box(118, 118), thumb: 48 },
  'elegoo.gcode': { flavor: 'orca', slicer: 'ElegooSlicer', version: '1.1.6.0', date: '2025-03-14T18:30:00', printer: 'Elegoo Centauri Carbon 0.4 nozzle',
    printerModel: 'Elegoo Centauri Carbon', process: '0.20mm Standard @Elegoo CC 0.4 nozzle', bed: [256, 256, 256], filamentType: 'PETG', filamentName: 'Elegoo PETG',
    color: '#1E90FF', density: 1.27, nozzle: 0.4, lh: 0.2, nozzleTemp: 250, bedTemp: 80, plate: 'Textured PEI Plate', time: '2h 0m 5s', timeSec: 7205,
    mm: 4321.5, g: 13.1, cm3: 10.39, box: box(60, 70, 30, 24, 6), thumb: 64 },
  'slicercc.gcode': { flavor: 'orca', slicer: 'ElegooSlicer', version: '1.1.6.0', ccVersion: '0.2.0', date: '2026-10-20T12:00:00', printer: 'Elegoo Centauri Carbon 0.4 nozzle',
    printerModel: 'Elegoo Centauri Carbon', process: 'Slicer CC standard', bed: [256, 256, 256], filamentType: 'PLA', filamentName: 'Elegoo PLA',
    color: '#FFFFFF', density: 1.24, nozzle: 0.4, lh: 0.2, nozzleTemp: 215, bedTemp: 60, plate: 'Textured PEI Plate', time: '45m 0s', timeSec: 2700,
    mm: 900, g: 2.69, cm3: 2.16, box: box(110, 110, 16, 16, 3), thumb: 32 },
  'prusa.gcode': { flavor: 'prusa', slicer: 'PrusaSlicer', version: '2.8.1', date: '2024-10-21T06:38:01', printer: 'Original Prusa MK4 0.4 nozzle', printerModel: 'MK4',
    bed: [250, 210, 220], filamentType: 'PETG', filamentName: 'Prusament PETG', color: '#FF8000', density: 1.27, nozzle: 0.4, lh: 0.15, nozzleTemp: 240, bedTemp: 85,
    time: '25m 10s', timeSec: 1510, mm: 986.61, g: 3.01, cm3: 2.37, box: box(100, 90, 20, 20, 3), thumb: 64, qoi: 16 },
  'bambu.gcode': { flavor: 'orca', bambu: true },
  'cura.gcode': { flavor: 'cura', slicer: 'Cura', version: '5.6.0', printer: 'Creality Ender-3', filamentType: 'PLA', nozzleTemp: 200, bedTemp: 60, lh: 0.2,
    timeSec: 3723, mm: 1500, box: box(100, 100, 20, 20, 4), thumb: 32 },
  'cura-griffin.gcode': { flavor: 'cura', griffin: true, slicer: 'Cura', version: '5.6.0', printer: 'Ultimaker S5', filamentType: 'PLA', nozzleTemp: 215, bedTemp: 60,
    nozzle: 0.4, lh: 0.2, timeSec: 5000, volume: 2500, diameter: 2.85, box: box(150, 100, 20, 20, 2) },
};
SPECS['bambu.gcode'] = { flavor: 'bambu', slicer: 'BambuStudio', version: '01.09.00.70', printer: 'Bambu Lab X1 Carbon 0.4 nozzle', printerModel: 'Bambu Lab X1 Carbon',
  bed: [256, 256, 250], filamentType: 'PETG', filamentName: 'Bambu PETG HF', color: '#00AE42', density: 1.25, nozzle: 0.4, lh: 0.2, nozzleTemp: 250, bedTemp: 70,
  plate: 'Textured PEI Plate', time: '1h 9m 10s', timeSec: 4150, mm: 2222.22, g: 6.75, cm3: 5.4, box: box(110, 100, 24, 20, 4), thumb: 48 };

function expectedFor(name, spec, made) {
  const dims = [spec.box.w + 10, spec.box.d + 10, spec.box.h];
  const e = { slicer: spec.ccVersion ? 'Slicer CC' : spec.slicer, slicerVersion: spec.ccVersion || spec.version, timeSec: spec.timeSec,
    filamentType: spec.filamentType, nozzleTemp: spec.nozzleTemp, bedTemp: spec.bedTemp, layerHeight: spec.lh, layers: made.layers, printer: spec.printer, dims };
  if (spec.date) e.slicedAt = spec.date + (spec.flavor === 'prusa' ? 'Z' : '');
  if (spec.ccVersion) e.engine = spec.slicer;
  if (spec.flavor !== 'cura') Object.assign(e, { filamentMm: spec.mm, filamentG: spec.g, filamentColor: spec.color, nozzle: spec.nozzle, bed: { x: spec.bed[0], y: spec.bed[1], z: spec.bed[2] }, fits: true });
  if (spec.flavor === 'bambu') e.slicedAt = null;
  if (name === 'cura.gcode') Object.assign(e, { filamentMm: spec.mm, filamentG: Math.round(spec.mm * Math.PI * 0.875 * 0.875 * 1.24 / 1000 * 100) / 100, gramsEstimated: true, bed: { x: 220, y: 220, z: 250 }, fits: true, slicedAt: null });
  if (name === 'cura-griffin.gcode') Object.assign(e, { filamentMm: Math.round(spec.volume / (Math.PI * 1.425 * 1.425) * 100) / 100, nozzle: 0.4, bed: null, fits: null, slicedAt: null, layerHeight: 0.2 });
  e.thumbs = (spec.thumb ? 1 : 0) + (spec.qoi ? 1 : 0);
  return e;
}

function write(name, data) { fs.writeFileSync(path.join(DIR, name), data); }

function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const expected = {};
  for (const [name, spec] of Object.entries(SPECS)) {
    const made = makeGcode(spec);
    write(name, made.text);
    expected[name] = expectedFor(name, spec, made);
  }

  // .bgcode: те же сведения, что у prusa.gcode, сжатие heatshrink 12/4 + MeatPack с комментариями + CRC32.
  const p = SPECS['prusa.gcode'];
  const prusa = makeGcode(Object.assign({}, p, { thumb: 0, qoi: 0 }));
  const gcodeOnly = prusa.text.split('\n').filter((l) => !/^; (filament used|total filament|estimated|filament cost|prusaslicer_config|generated by)/.test(l) && !/^; [a-z_]+ = /.test(l)).join('\n');
  const config = { bed_shape: `0x0,${p.bed[0]}x0,${p.bed[0]}x${p.bed[1]},0x${p.bed[1]}`, bed_temperature: p.bedTemp, filament_colour: p.color, filament_density: p.density,
    filament_diameter: 1.75, filament_settings_id: `"${p.filamentName}"`, filament_type: p.filamentType, layer_height: p.lh, max_print_height: p.bed[2],
    nozzle_diameter: p.nozzle, printer_model: p.printerModel, printer_settings_id: p.printer, temperature: p.nozzleTemp };
  const meta = { 'filament used [mm]': p.mm, 'filament used [g]': p.g, 'filament used [cm3]': p.cm3, 'estimated printing time (normal mode)': p.time };
  const thumbs = [
    { format: 'qoi', width: 16, height: 16, data: qoiEncode(16, 16, picture(16, 16, 30)) },
    { format: 'png', width: 64, height: 64, data: pngEncode(64, 64, picture(64, 64)) },
  ];
  write('prusa.bgcode', bgcodeWrite({ fileMeta: { Producer: `PrusaSlicer ${p.version}` }, printerMeta: { printer_model: p.printerModel, filament_type: p.filamentType,
    nozzle_diameter: p.nozzle, bed_temperature: p.bedTemp, temperature: p.nozzleTemp, layer_height: p.lh, ...meta }, printMeta: meta,
  slicerMeta: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, ' ' + v])), thumbnails: thumbs, gcode: gcodeOnly, compression: 3, gcodeEncoding: 2, checksum: 1, gcodeChunk: 16384 }));
  expected['prusa.bgcode'] = Object.assign({}, expected['prusa.gcode'], { slicedAt: null, thumbs: 2 });
  // Второй .bgcode: heatshrink 11/4, MeatPack без комментариев (нет меток слоёв - слои по Z), без CRC.
  write('prusa-plain.bgcode', bgcodeWrite({ fileMeta: { Producer: 'PrusaSlicer 2.7.4' }, printerMeta: { printer_model: 'MINI', filament_type: 'PLA', ...meta },
    printMeta: meta, slicerMeta: { layer_height: '0.15', printer_settings_id: 'Original Prusa MINI', bed_shape: '0x0,180x0,180x180,0x180', max_print_height: '180' },
    gcode: gcodeOnly, compression: 2, metaCompression: 0, gcodeEncoding: 1, checksum: 0, gcodeChunk: 4096 }));
  expected['prusa-plain.bgcode'] = { slicer: 'PrusaSlicer', slicerVersion: '2.7.4', timeSec: p.timeSec, filamentType: 'PLA', filamentMm: p.mm, filamentG: p.g,
    printer: 'Original Prusa MINI', layers: prusa.layers, layerHeight: 0.15, bed: { x: 180, y: 180, z: 180 }, fits: true, dims: expected['prusa.gcode'].dims, thumbs: 0 };

  // .gcode.3mf Bambu: пластина 1 - bambu.gcode, картинка пластины, slice_info.
  const bambu = fs.readFileSync(path.join(DIR, 'bambu.gcode'));
  const sliceInfo = (plates) => '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n' +
    '    <header_item key="X-BBL-Client-Version" value="01.09.00.70"/>\n  </header>\n' + plates.map((pl) => `  <plate>\n    <metadata key="index" value="${pl.index}"/>\n` +
    `    <metadata key="printer_model_id" value="BL-P001"/>\n    <metadata key="prediction" value="${pl.prediction}"/>\n    <metadata key="weight" value="${pl.weight}"/>\n` +
    `    <filament id="1" tray_info_idx="GFA00" type="${pl.type}" color="${pl.color}" used_m="${pl.m}" used_g="${pl.weight}" />\n  </plate>\n`).join('') + '</config>\n';
  const cube20 = cube(20);
  write('bambu.gcode.3mf', writeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '3D/3dmodel.model', data: model3mfXml(cube20, { x: 118, y: 118 }) },
    { name: 'Metadata/plate_1.gcode', data: bambu },
    { name: 'Metadata/plate_1.png', data: pngEncode(96, 96, picture(96, 96, 120)) },
    { name: 'Metadata/slice_info.config', data: sliceInfo([{ index: 1, prediction: 4150, weight: 6.75, type: 'PETG', color: '#00AE42', m: 2.22222 }]) },
  ]));
  expected['bambu.gcode.3mf'] = Object.assign({}, expected['bambu.gcode'], { thumbs: 2, plates: 1 });
  // Две пластины без шапки в G-code: сведения - из slice_info.config.
  const bare = body('orca', { box: box(100, 100, 10, 10, 1), lh: 0.2 }).lines.join('\n') + '\n';
  write('plates2.gcode.3mf', writeZip([
    { name: 'Metadata/plate_1.gcode', data: bare },
    { name: 'Metadata/plate_2.gcode', data: bare },
    { name: 'Metadata/slice_info.config', data: sliceInfo([{ index: 1, prediction: 600, weight: 1.5, type: 'PLA', color: '#FFFFFF', m: 0.5 }, { index: 2, prediction: 700, weight: 2, type: 'PLA', color: '#FFFFFF', m: 0.7 }]) },
  ]));
  expected['plates2.gcode.3mf'] = { slicer: 'BambuStudio', timeSec: 600, filamentG: 1.5, filamentMm: 500, filamentType: 'PLA', filamentColor: '#FFFFFF', plates: 2, layers: 5, dims: [20, 20, 1], thumbs: 0 };

  // Модели без нарезки.
  write('cube.stl', stlBinary(cube20));
  write('cube-ascii.stl', stlAscii(cube(10, 30)));
  write('model.3mf', writeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: model3mfXml(cube(15, 5), { x: 50, y: 60 }) },
  ]));
  expected['cube.stl'] = { kind: 'stl', triangles: 12, dims: [20, 20, 20] };
  expected['cube-ascii.stl'] = { kind: 'stl', triangles: 12, dims: [10, 10, 30] };
  expected['model.3mf'] = { kind: '3mf', triangles: 12, dims: [15, 15, 5] };

  // Испорченные: разбор не падает, файл помечается ошибкой.
  write('broken.bgcode', fs.readFileSync(path.join(DIR, 'prusa.bgcode')).subarray(0, 700));
  write('notzip.3mf', Buffer.from('this is not a zip archive at all'));
  write('empty.gcode', Buffer.alloc(0));
  expected['broken.bgcode'] = { error: 'bad-bgcode' };
  expected['notzip.3mf'] = { error: 'bad-zip' };
  expected['empty.gcode'] = { kind: 'gcode', layers: 0, dims: null, timeSec: null };

  fs.writeFileSync(path.join(DIR, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
  console.log(Object.keys(expected).length + ' fixtures in ' + DIR);
}

main();
