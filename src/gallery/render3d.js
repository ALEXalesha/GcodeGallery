// 3D для ленты. Один ракурс у всех плиток (спереди-справа-сверху), модель по центру кадра.
//   Snapshotter - один невидимый WebGL на все плитки: рисует и отдаёт картинку (плитки - <img>,
//                 поэтому тысячи плиток не держат тысячи WebGL);
//   LiveTile    - одно живое окошко поверх плитки под мышью: модель крутится, слои растут;
//   Stage       - большое окно: мышь крутит, колесо приближает, ползунок слоёв.
// Путь сопла - отрезки по типам линий (src/core/toolpath.js), подкрашены по высоте для объёма.
import * as THREE from '../renderer/vendor/three/build/three.module.min.js';
import { OrbitControls } from '../renderer/vendor/three/jsm/controls/OrbitControls.js';
import { makeTable } from './table3d.js';

const VIEW_DIR = new THREE.Vector3(0.9, 0.75, 1.25).normalize();
const A0 = Math.atan2(VIEW_DIR.x, VIEW_DIR.z), H = Math.hypot(VIEW_DIR.x, VIEW_DIR.z);

/** Цвет линии в режиме «цветом пластика»: тот же цвет, стенки светлее, заполнение темнее. */
const FILAMENT_SHADE = { outer: 1.0, inner: 0.85, overhang: 1.0, sparse: 0.6, solid: 0.7, top: 0.95, bottom: 0.7, bridge: 0.8, gap: 0.75, ironing: 0.9, support: 0.5, supportIf: 0.55, skirt: 0.65, tower: 0.6, custom: 0.7 };

function colorsFor(positions, base, zMin, zMax) {
  const n = positions.length / 3;
  const out = new Float32Array(n * 3);
  const span = zMax - zMin || 1;
  for (let i = 0; i < n; i++) {
    const f = 0.55 + 0.45 * ((positions[i * 3 + 2] - zMin) / span);
    out[i * 3] = base.r * f; out[i * 3 + 1] = base.g * f; out[i * 3 + 2] = base.b * f;
  }
  return out;
}

/**
 * Модель из ужатого вида. В координатах G-code внутри, наружу - Y вверх, центр стола модели в 0.
 * @returns {{root, size, center, layers, setLayers, setColors, setKinds, dispose}}
 */
export function buildModel(view, { colorMode = 'type', filamentColor = null, bed = null, table = true } = {}) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.x = -Math.PI / 2;
  root.add(inner);
  const b = view.bounds || { min: [0, 0, 0], max: [1, 1, 1] };
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  inner.position.set(-cx, 0, cy);
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - Math.min(0, b.min[2])];
  const parts = [];
  if (view.type === 'path') {
    view.data.forEach((d, k) => {
      if (!d.positions.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
      line.frustumCulled = false;
      line.userData.kind = view.kinds[k];
      line.userData.layerEnd = d.layerEnd;
      inner.add(line);
      parts.push(line);
    });
  } else {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(view.positions, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: filamentColor || '#9fb4d8', roughness: 0.6, metalness: 0.05, flatShading: true }));
    inner.add(mesh);
    parts.push(mesh);
  }
  if (table) inner.add(makeTable(bed, b));
  const api = {
    root,
    size,
    center: new THREE.Vector3(0, size[2] / 2, 0),
    layers: view.type === 'path' ? view.layers.length : 0,
    setColors(mode, color) {
      for (const p of parts) {
        if (p.isMesh) { p.material.color.set(mode === 'filament' && color ? color : '#9fb4d8'); continue; }
        const kind = p.userData.kind;
        const base = new THREE.Color(mode === 'filament' && color ? color : kind.color);
        if (mode === 'filament' && color) base.multiplyScalar(FILAMENT_SHADE[kind.id] || 0.8);
        p.geometry.setAttribute('color', new THREE.BufferAttribute(colorsFor(p.geometry.attributes.position.array, base, b.min[2], b.max[2]), 3));
      }
    },
    /** Показать слои lo..hi (с нуля, включительно). */
    setLayers(lo, hi) {
      for (const p of parts) {
        const ends = p.userData.layerEnd;
        if (!ends || !ends.length) continue;
        const h = Math.max(0, Math.min(ends.length - 1, hi));
        const l = Math.max(0, Math.min(h, lo));
        const start = l > 0 ? ends[l - 1] : 0;
        p.geometry.setDrawRange(start * 2, Math.max(0, ends[h] - start) * 2);
      }
    },
    setKinds(visible) { for (const p of parts) if (p.userData.kind) p.visible = visible.has(p.userData.kind.id); },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    },
  };
  api.setColors(colorMode, filamentColor);
  return api;
}

function lights(scene) {
  scene.add(new THREE.HemisphereLight('#ffffff', '#445566', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4);
  sun.position.set(80, 160, 120);
  scene.add(sun);
}

/** Камера смотрит на модель с одного и того же направления, модель целиком в кадре. */
export function frame(camera, model, dir = VIEW_DIR, margin = 1.08) {
  const r = Math.max(1, 0.5 * Math.hypot(...model.size));
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (r / Math.sin(fov / 2)) * margin;
  camera.position.copy(model.center).addScaledVector(dir, dist);
  camera.near = Math.max(0.1, dist / 100);
  camera.far = dist * 20;
  camera.lookAt(model.center);
  camera.updateProjectionMatrix();
  return dist;
}

export class Snapshotter {
  constructor(size = 360) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.scene = new THREE.Scene();
    lights(this.scene);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
  }

  /** Картинка модели (data URL) или null, если WebGL недоступен. */
  shot(view, opts = {}) {
    const m = buildModel(view, opts);
    try {
      this.scene.add(m.root);
      frame(this.camera, m);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.render(this.scene, this.camera);
      return this.canvas.toDataURL('image/webp', 0.9);
    } finally {
      this.scene.remove(m.root);
      m.dispose();
    }
  }

  dispose() { this.renderer.dispose(); }
}

/** Живая плитка: одно окошко WebGL, которое ставится поверх плитки под мышью. */
export class LiveTile {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gg-live';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    lights(this.scene);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
    this.model = null;
    this.raf = 0;
    this.host = null;
  }

  attach(host, view, opts = {}) {
    this.detach();
    this.host = host;
    const w = host.clientWidth || 200, h = host.clientHeight || 200;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.model = buildModel(view, opts);
    this.scene.add(this.model.root);
    this.dist = frame(this.camera, this.model);
    host.appendChild(this.canvas);
    const t0 = performance.now();
    const n = this.model.layers;
    const loop = (now) => {
      const t = (now - t0) / 1000;
      const a = A0 + t * 0.9;
      const dir = new THREE.Vector3(Math.sin(a) * H, VIEW_DIR.y, Math.cos(a) * H);
      frame(this.camera, this.model, dir);
      if (n > 1) {
        const cycle = 4.5, p = (t % cycle) / (cycle - 1);
        this.model.setLayers(0, Math.min(n - 1, Math.floor(p * n)));
      }
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  get active() { return !!this.host; }

  detach() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); this.model = null; }
    this.host = null;
  }

  dispose() { this.detach(); this.renderer.dispose(); }
}

/** Большое окно: управление мышью, ползунок слоёв снаружи. */
export class Stage {
  constructor(container, { autoRotate = false } = {}) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gg-stage-canvas';
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    lights(this.scene);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.autoRotate = autoRotate;
    this.controls.autoRotateSpeed = 1.2;
    this.model = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  show(view, opts = {}) {
    this.clear();
    this.model = buildModel(view, opts);
    this.scene.add(this.model.root);
    this.resetView();
    return this.model;
  }

  resetView() {
    if (!this.model) return;
    frame(this.camera, this.model, VIEW_DIR, 1.15);
    this.controls.target.copy(this.model.center);
    this.controls.update();
  }

  clear() { if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); this.model = null; } }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
