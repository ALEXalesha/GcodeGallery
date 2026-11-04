// Порог покрытия по ВЕТВЯМ (c8): ядро (разбор, сведения, кэш, фильтры, форматы) >= 90 %,
// весь код без окон >= 80 %. Пишет отчёт docs/coverage.md. Запуск после `npm run coverage`.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORE = ['src/core/bgcode.js', 'src/core/heatshrink.js', 'src/core/meatpack.js', 'src/core/thumbs.js', 'src/core/meta.js', 'src/core/formats.js',
  'src/core/toolpath.js', 'src/core/item.js', 'src/core/cache.js', 'src/core/scan.js', 'src/core/beds.js', 'src/gallery/filter.js', 'src/shared/gcode-preview.js'];
const LIMIT = { core: 90, all: 80 };

const sum = JSON.parse(fs.readFileSync(path.join(ROOT, 'coverage', 'coverage-summary.json'), 'utf8'));
const rows = Object.entries(sum).filter(([k]) => k !== 'total').map(([file, v]) => ({ file: path.relative(ROOT, file).replace(/\\/g, '/'), b: v.branches, l: v.lines }));
const group = (list) => {
  const t = list.reduce((a, r) => ({ covered: a.covered + r.b.covered, total: a.total + r.b.total }), { covered: 0, total: 0 });
  return { covered: t.covered, total: t.total, pct: t.total ? Math.round((t.covered / t.total) * 1000) / 10 : 100 };
};
const core = group(rows.filter((r) => CORE.includes(r.file)));
const all = group(rows);
const missing = CORE.filter((f) => !rows.some((r) => r.file === f));
const lines = ['# Покрытие тестами по ветвям', '', `Обновлено: ${new Date().toISOString().slice(0, 10)}. Команда: \`npm run coverage\` (c8, ветви).`, '',
  '| группа | ветви | порог |', '| --- | --- | --- |',
  `| ядро: разбор, сведения, кэш, фильтры, форматы | **${core.pct} %** (${core.covered}/${core.total}) | ${LIMIT.core} % |`,
  `| весь код без окон | **${all.pct} %** (${all.covered}/${all.total}) | ${LIMIT.all} % |`, '',
  '| файл | ветви | строки | ядро |', '| --- | --- | --- | --- |',
  ...rows.sort((a, b) => a.file.localeCompare(b.file)).map((r) => `| ${r.file} | ${r.b.pct} % | ${r.l.pct} % | ${CORE.includes(r.file) ? 'да' : ''} |`), '',
  'Окно (src/gallery/gallery.js, viewer.js, render3d.js, src/renderer, electron/main.js, ipc.js, preload.js) проверяется тестами Playwright (tests/app), в этот счёт не входит.', ''];
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'coverage.md'), lines.join('\n'));
console.log(`core branches ${core.pct} % (limit ${LIMIT.core}), all without windows ${all.pct} % (limit ${LIMIT.all})`);
if (missing.length) { console.error('no coverage for: ' + missing.join(', ')); process.exit(1); }
if (core.pct < LIMIT.core || all.pct < LIMIT.all) { console.error('coverage below the limit'); process.exit(1); }
