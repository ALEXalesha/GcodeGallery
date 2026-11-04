// Стол принтера под моделью - пока простой, кодом: пластина размером со стол, сетка через
// 10 мм, рамка. Позже заменится моделью из Blender: снаружи нужен только makeTable(bed, footprint)
// -> THREE.Object3D в координатах G-code (X вправо, Y вглубь, Z вверх, стол на z = 0).
import * as THREE from '../renderer/vendor/three/build/three.module.min.js';

/**
 * @param {{x, y, x0?, y0?}|null} bed стол из файла или известного принтера
 * @param {{min: number[], max: number[]}|null} footprint габариты модели - если стола нет
 * @param {{plate?: string, line?: string}} colors
 */
export function makeTable(bed, footprint, colors = {}) {
  let x0, y0, w, d;
  if (bed && bed.x > 0 && bed.y > 0) { x0 = bed.x0 || 0; y0 = bed.y0 || 0; w = bed.x; d = bed.y; }
  else if (footprint) {
    const m = 15;
    x0 = footprint.min[0] - m; y0 = footprint.min[1] - m;
    w = footprint.max[0] - footprint.min[0] + 2 * m; d = footprint.max[1] - footprint.min[1] + 2 * m;
  } else return new THREE.Group();
  const g = new THREE.Group();
  g.name = 'table3d';
  const plate = new THREE.Mesh(new THREE.BoxGeometry(w, d, 2), new THREE.MeshStandardMaterial({ color: colors.plate || '#2b2f38', roughness: 0.9, metalness: 0.05 }));
  plate.position.set(x0 + w / 2, y0 + d / 2, -1.05);
  g.add(plate);
  const pts = [];
  const step = Math.max(10, Math.round(Math.max(w, d) / 30 / 10) * 10);
  for (let x = Math.ceil(x0 / step) * step; x <= x0 + w + 1e-6; x += step) pts.push(x, y0, 0, x, y0 + d, 0);
  for (let y = Math.ceil(y0 / step) * step; y <= y0 + d + 1e-6; y += step) pts.push(x0, y, 0, x0 + w, y, 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: colors.line || '#4a5160', transparent: true, opacity: 0.55 }));
  grid.position.z = -0.02;
  g.add(grid);
  return g;
}
