// Проверка проверок: нарочно ломаем продукт в одном месте и ждём, что упадёт нужный закон.
// Мутант, после которого тесты зелёные, - дыра в законах. Файл всегда возвращается назад.
//   node tools/mutate.js              все мутанты
//   node tools/mutate.js print        только те, где в имени есть «print»
//   node tools/mutate.js --core       только законы без окна (быстро, для CI)
// Мутант с полем app проверяется тестом окна (Playwright, невидимое окно, GG_TEST=1) с отбором -g.
// Linux без экрана: xvfb-run -a node tools/mutate.js
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const T = (f) => 'tests/core/' + f + '.test.js';
const MUTANTS = [
  // разбор форматов
  { name: 'bgcode: CRC not checked', file: 'src/core/bgcode.js', from: "if ((zlib.crc32(buf.subarray(p, dataStart + stored)) >>> 0) !== want) throw", to: 'if (false) throw', test: T('formats') },
  { name: 'heatshrink: distance off by one', file: 'src/core/heatshrink.js', from: 'const dist = read(windowBits) + 1;', to: 'const dist = read(windowBits) + 2;', test: T('formats') },
  { name: 'meatpack: spaces not put back into G lines', file: 'src/core/meatpack.js', from: 'else if (addSpace && last !== 0x20 && PARAMS.has(String.fromCharCode(c))) push(0x20);', to: '', test: T('formats') },
  { name: 'meatpack: second full-width char of a pair lost', file: 'src/core/meatpack.js', from: 'pendingFull = hi === 0x0f ? 2 : 1;', to: 'pendingFull = 1;', test: T('formats') },
  { name: 'qoi: small difference decoded wrong', file: 'src/core/thumbs.js', from: 'r = (r + ((b1 >> 4) & 3) - 2) & 255;', to: 'r = (r + ((b1 >> 4) & 3) - 1) & 255;', test: T('formats') },
  { name: 'thumbs: broken picture trusted by its label', file: 'src/core/thumbs.js', from: "['png', 'jpg', 'qoi'].includes(formatOf(t.data)));", to: "['png', 'jpg', 'qoi'].includes(formatOf(t.data, t.format)));", test: T('formats') },
  { name: 'gcode.3mf: slice_info time ignored', file: 'src/core/formats.js', from: 'if (p.prediction !== null) res.extra.timeSec = p.prediction;', to: '', test: T('formats') },
  { name: 'preview: Bambu "; FEATURE:" types ignored', file: 'src/shared/gcode-preview.js', from: "else if (line.startsWith('; FEATURE:')) kind = kindOf(line.slice(10));", to: '', test: T('formats') },
  { name: 'preview: no layers by Z without markers', file: 'src/shared/gcode-preview.js', from: 'if (!marker && (layer < 0 || tz >= layers[layer].z + MIN_LAYER))', to: 'if (!marker && layer < 0)', test: T('formats') },
  { name: 'preview: Cura names not mapped', file: 'src/shared/gcode-preview.js', from: "engine: ['Outer wall', 'External perimeter', 'WALL-OUTER']", to: "engine: ['Outer wall', 'External perimeter']", test: T('formats') },
  // сведения
  { name: 'meta: Bambu model time instead of total', file: 'src/core/meta.js', from: 'timeSec = parseDuration(m ? m[1] : bambuTime);', to: 'timeSec = parseDuration(bambuTime);', test: T('formats') },
  { name: 'meta: bed temperature ignores the plate type', file: 'src/core/meta.js', from: 'if (BED_TEMP_BY_PLATE[plate]) bedTemp =', to: 'if (false) bedTemp =', test: T('formats') },
  { name: 'meta: Prusa "+win64" left in the version', file: 'src/core/meta.js', from: "version = m[2].replace(/\\+.*$/, '');", to: 'version = m[2];', test: T('formats') },
  { name: 'meta: grams not estimated from length', file: 'src/core/meta.js', from: 'if (gramsEstimated) filamentG = gramsFromLength(', to: 'if (false) filamentG = gramsFromLength(', test: T('formats') },
  { name: 'meta: fits checks only the start of the bed', file: 'src/core/meta.js', from: 'bounds.max[0] <= x0 + bed.x + tolerance', to: 'bounds.max[0] <= x0 + bed.x * 2 + tolerance', test: T('extra') },
  { name: 'meta: Slicer CC not recognized', file: 'src/core/meta.js', from: "if (cc) { engine = name; name = 'Slicer CC';", to: "if (false) { engine = name; name = 'Slicer CC';", test: T('formats') },
  { name: 'item: empty file gets 0 s print time', file: 'src/core/item.js', from: 'if (info.timeSec === null && moving > 0) {', to: 'if (info.timeSec === null) {', test: T('formats') },
  // 3D-вид, кэш, папка
  { name: 'toolpath: budget not kept', file: 'src/core/toolpath.js', from: 'if (total <= budget) break;', to: 'if (true) break;', test: T('library') },
  { name: 'cache: key ignores the size', file: 'src/core/cache.js', from: '`${path.resolve(file)}\\n${size}\\n', to: '`${path.resolve(file)}\\n\\n', test: T('library') },
  { name: 'cache: old parser version used', file: 'src/core/cache.js', from: 'j.version !== this.version ||', to: '', test: T('library') },
  { name: 'scan: hidden folders walked', file: 'src/core/scan.js', from: "if (e.name.startsWith('.')) continue;", to: '', test: T('library') },
  { name: 'scan: changed date not a change', file: 'src/core/scan.js', from: 'o.size !== f.size || o.mtimeMs !== f.mtimeMs', to: 'o.size !== f.size', test: T('library') },
  { name: 'marks: duplicate tags kept', file: 'src/core/marks.js', from: 'if (!v || seen.has(low)) continue;', to: 'if (!v) continue;', test: T('library') },
  { name: 'settings: any printer address accepted', file: 'src/core/settings.js', from: "return /^[A-Za-z0-9.-]{1,253}(:\\d{1,5})?$/.test(v) &&", to: 'return true ||', test: T('library') },
  { name: 'library: file outside the folder served', file: 'electron/library.js', from: "if (!f) throw Object.assign(new Error('not in the folder'), { code: 'unknown-file' });", to: 'if (!f) return { path: path.resolve(String(p || \'\')), size: 0, mtimeMs: 0, name: \'x\' };', test: T('main-library') },
  { name: 'library: new file not remembered', file: 'electron/library.js', from: 'for (const f of [...d.added, ...d.changed]) this.files.set(f.path, f);', to: '', test: T('main-library') },
  // «без кнопки не печатает»
  { name: 'print: start without a token', file: 'src/core/printing.js', from: "if (start === true && !this._consume(token, file)) throw new PrintError('no-button');", to: '', test: T('printing') },
  { name: 'print: token used twice', file: 'src/core/printing.js', from: '    this.tokens.delete(token);\n', to: '', test: T('printing') },
  { name: 'print: token of another file', file: 'src/core/printing.js', from: 't.file === path.resolve(file) && ', to: '', test: T('printing') },
  { name: 'print: old token still valid', file: 'src/core/printing.js', from: ' && this.now() - t.at <= this.ttlMs;', to: ';', test: T('printing') },
  { name: 'print: .bgcode sent to Elegoo', file: 'src/core/printing.js', from: "throw new PrintError('format', 'bgcode');", to: 'return buf;', test: T('printing') },
  // лента без окна
  { name: 'sort: empty values not last', file: 'src/gallery/filter.js', from: 'if (am !== bm) return am ? 1 : -1;', to: '', test: T('gallery') },
  { name: 'filter: filament type case matters', file: 'src/gallery/filter.js', from: '!f.types.some((t) => lower(t) === lower(i.filamentType))', to: '!f.types.includes(i.filamentType)', test: T('gallery') },
  { name: 'queue: visible not first', file: 'src/gallery/queue.js', from: '(p.visible && !bestP.visible) ||', to: '', test: T('gallery') },
  { name: 'queue: changed while running not redone', file: 'src/gallery/queue.js', from: 'if (this.again.delete(k)) this.pending.set(k, { order: this.seq++, visible: false });\n    else this.done.add(k);', to: 'this.done.add(k);', test: T('gallery') },
  { name: 'i18n: 11 layers as 1 layer', file: 'src/gallery/i18n.js', from: 'd === 1 && h !== 11 ? 1', to: 'd === 1 ? 1', test: T('gallery') },
  { name: 'format: cost ignores the spool weight', file: 'src/gallery/format.js', from: 'return Math.round(g * price / spoolGrams * 100) / 100;', to: 'return Math.round(g * price / 1000 * 100) / 100;', test: T('gallery') },
  { name: 'window state: off-screen window kept', file: 'electron/window-state.js', from: 'if (!best || bestArea < GRIP_WIDTH * GRIP_HEIGHT / 2) return { width, height, maximized };', to: '', test: T('main-library') },
  // окно
  { name: 'window B1: preview result goes to the old tile', app: 'tests/app/gallery.spec.js', grep: 'law B1', file: 'src/gallery/gallery.js',
    from: '    const it = S.byPath.get(p);\n    if (!it) return;\n    if (err)', to: '    const it = old;\n    if (!it) return;\n    if (err)', also: [['    if (!S.byPath.has(p)) return;', '    const old = S.byPath.get(p);\n    if (!old) return;']] },
  { name: 'window: scripted click prints', app: 'tests/app/gallery.spec.js', grep: 'no button - no print', file: 'src/gallery/print-dialog.js', from: 'if (!e || !e.isTrusted) return;', to: '' },
  { name: 'window: upload-only also starts', app: 'tests/app/gallery.spec.js', grep: 'no button - no print', file: 'electron/ipc.js', from: 'start: start === true, token,', to: 'start: true, token: token || printing.arm(file),' },
  { name: 'window: live 3D stays after the mouse left', app: 'tests/app/gallery.spec.js', grep: 'hover', file: 'src/gallery/gallery.js', from: "pic.addEventListener('mouseleave', () => { if (live && live.host === pic) live.detach(); });", to: '' },
  { name: 'window: layer label shows the last layer', app: 'tests/app/gallery.spec.js', grep: 'open large', file: 'src/gallery/viewer.js', from: "t('v.layer', { n: top, m: n,", to: "t('v.layer', { n, m: n," },
  { name: 'window: arrows do not move in the strip', app: 'tests/app/gallery.spec.js', grep: 'strip', file: 'src/gallery/gallery.js', from: "if (e.key === 'ArrowRight' || (S.settings.view === 'strip' && e.key === 'ArrowDown'))", to: "if (e.key === 'PageDown')" },
  { name: 'window: cache not saved on quit', app: 'tests/app/gallery.spec.js', grep: 'second start', file: 'electron/main.js', from: "app.on('before-quit', dispose);", to: '', also: [["app.on('window-all-closed', () => { dispose(); app.quit(); });", "app.on('window-all-closed', () => { app.quit(); });"]] },
  { name: 'window: STL filter does nothing', app: 'tests/app/gallery.spec.js', grep: 'search, sort', file: 'src/gallery/filter.js', from: 'if (f.kinds && f.kinds.length && !f.kinds.includes(item.kind)) return false;', to: '' },
  { name: 'look: white text on the plain accent', app: 'tests/app/look.spec.js', grep: 'five themes', file: 'src/gallery/gallery.css', from: '--gg-on-accent: color-mix(in srgb, var(--accent) 70%, #000);', to: '--gg-on-accent: var(--accent);' },
  { name: 'look: card caption runs out of a narrow card', app: 'tests/app/look.spec.js', grep: 'window 420x760', file: 'src/gallery/gallery.css', from: '.gg-line dd { margin: 0; min-width: 0; overflow: hidden;', to: '.gg-line dd { margin: 0; min-width: max-content; overflow: visible;' },
  { name: 'look: English toolbar keeps Russian', app: 'tests/app/look.spec.js', grep: 'English', file: 'src/gallery/i18n.js', from: "'top.folder': 'Folder…',", to: "'top.folder': 'Папка…'," },
];

const args = process.argv.slice(2);
const coreOnly = args.includes('--core');
const filter = args.find((a) => !a.startsWith('--')) || '';
let caught = 0, total = 0;
const missed = [];
for (const m of MUTANTS) {
  if (filter && !m.name.includes(filter)) continue;
  if (coreOnly && m.app) continue;
  total += 1;
  const file = path.join(ROOT, m.file);
  const orig = fs.readFileSync(file, 'utf8');
  let text = orig;
  let bad = false;
  for (const [from, to] of [[m.from, m.to], ...(m.also || [])]) {
    const count = text.split(from).length - 1;
    if (count !== 1) { console.log(`?? ${m.name}: pattern found ${count} times - fix the mutant`); bad = true; break; }
    text = text.replace(from, () => to);
  }
  if (bad) { missed.push(m.name + ' (pattern)'); continue; }
  try {
    fs.writeFileSync(file, text);
    const cmd = m.app
      ? [path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config=playwright.app.config.js', '--workers=1', '--retries=0', m.app, '-g', m.grep]
      : ['--test', '--test-concurrency=1', m.test];
    const r = spawnSync(process.execPath, cmd, { cwd: ROOT, encoding: 'utf8', timeout: 900000, env: Object.assign({}, process.env, { GG_RUNS_SCALE: '1' }) });
    if (r.status !== 0) { caught += 1; console.log(`ok  ${m.name}`); }
    else { console.log(`!!  ${m.name}: tests stayed green`); missed.push(m.name); }
  } finally {
    fs.writeFileSync(file, orig);
  }
}
console.log(`${caught}/${total} mutants caught`);
if (missed.length) console.log('missed: ' + missed.join('; '));
process.exit(caught === total ? 0 : 1);
