// Размеры столов известных принтеров - когда в файле нет printable_area / bed_shape (Cura,
// старые файлы). Ищем по имени принтера из файла; не нашли - null (тогда «влезает» не пишем).
'use strict';

const BEDS = [
  { match: /centauri\s*carbon/i, name: 'Elegoo Centauri Carbon', x: 256, y: 256, z: 256 },
  { match: /neptune\s*4\s*max/i, name: 'Elegoo Neptune 4 Max', x: 420, y: 420, z: 480 },
  { match: /neptune\s*4\s*plus/i, name: 'Elegoo Neptune 4 Plus', x: 320, y: 320, z: 385 },
  { match: /neptune\s*4/i, name: 'Elegoo Neptune 4', x: 225, y: 225, z: 265 },
  { match: /\bmk4s?\b|mk3\.9/i, name: 'Prusa MK4', x: 250, y: 210, z: 220 },
  { match: /\bmk3s?\+?\b/i, name: 'Prusa MK3', x: 250, y: 210, z: 210 },
  { match: /prusa\s*mini|\bmini\+?\b/i, name: 'Prusa MINI', x: 180, y: 180, z: 180 },
  { match: /\bcore\s*one\b/i, name: 'Prusa CORE One', x: 250, y: 220, z: 270 },
  { match: /\bxl\b/i, name: 'Prusa XL', x: 360, y: 360, z: 360 },
  { match: /a1\s*mini/i, name: 'Bambu Lab A1 mini', x: 180, y: 180, z: 180 },
  { match: /bambu.*\ba1\b|^a1\b/i, name: 'Bambu Lab A1', x: 256, y: 256, z: 256 },
  { match: /\bh2d\b/i, name: 'Bambu Lab H2D', x: 350, y: 320, z: 325 },
  { match: /\b(x1|p1)[cps]?\b|x1\s*carbon|x1e/i, name: 'Bambu Lab X1/P1', x: 256, y: 256, z: 256 },
  { match: /ender[\s-]*3\s*v3/i, name: 'Creality Ender-3 V3', x: 220, y: 220, z: 250 },
  { match: /ender[\s-]*3/i, name: 'Creality Ender-3', x: 220, y: 220, z: 250 },
  { match: /\bk1\s*max\b/i, name: 'Creality K1 Max', x: 300, y: 300, z: 300 },
  { match: /\bk1c?\b/i, name: 'Creality K1', x: 220, y: 220, z: 250 },
  { match: /voron\s*2\.4.*350|350.*voron/i, name: 'Voron 2.4 350', x: 350, y: 350, z: 340 },
];

/** Стол по имени принтера: {x, y, z, x0: 0, y0: 0, name} или null. */
function forPrinter(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const b = BEDS.find((p) => p.match.test(name));
  return b ? { x: b.x, y: b.y, z: b.z, x0: 0, y0: 0, name: b.name } : null;
}

module.exports = { forPrinter, BEDS };
