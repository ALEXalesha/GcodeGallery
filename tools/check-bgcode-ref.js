// Сверка распаковки .bgcode с настоящими файлами PrusaSlicer из тестов libbgcode (AGPL - в репозиторий
// не кладём, берём из клона):
//   git clone --depth 1 https://github.com/prusa3d/libbgcode <папка>
//   node tools/check-bgcode-ref.js <папка>/tests/data
// Для каждого X.bgcode с X_ref.gcode сравниваются все команды (строки без комментариев) по порядку.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseBgcode } = require('../src/core/bgcode');
const { toDataUrl } = require('../src/core/thumbs');
const { processFile } = require('../src/core/item');

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error('usage: node tools/check-bgcode-ref.js <libbgcode>/tests/data'); process.exit(2); }
let bad = 0, checked = 0;
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.bgcode'))) {
  const ref = path.join(dir, f.replace(/\.bgcode$/, '_ref.gcode'));
  if (!fs.existsSync(ref)) continue;
  const res = parseBgcode(fs.readFileSync(path.join(dir, f)));
  const cmds = (t) => t.split('\n').filter((l) => l && !l.startsWith(';'));
  const a = cmds(res.gcode), b = cmds(fs.readFileSync(ref, 'utf8'));
  let diff = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff++;
  const pics = res.thumbnails.map((t) => `${t.format} ${t.width}x${t.height} ${toDataUrl(t) ? 'ok' : 'BAD'}`).join(', ');
  // Закон R2 на настоящем файле: полоска прочистки за краем стола не делает модель «не влезающей».
  const info = processFile(path.join(dir, f)).info;
  const fitsOk = info.fits !== false;
  console.log(`${diff || !fitsOk ? 'BAD' : 'ok '} ${f}: ${a.length} commands, ${diff} differ; pictures: ${pics}; size ${info.dims && info.dims.join('x')} mm, fits ${info.fits} (${info.printer})`);
  checked++;
  if (diff || pics.includes('BAD') || !fitsOk) bad++;
}
console.log(`${checked - bad}/${checked} files match`);
process.exit(bad || !checked ? 1 : 0);
