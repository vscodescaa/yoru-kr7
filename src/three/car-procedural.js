import * as THREE from 'three';
import { buildWheel, WHEEL_R } from './wheels.js';

/*
 * YORU KR-7 — carrocería procedural.
 * La carrocería es un loft: 200 estaciones a lo largo del eje X, cada una con una
 * sección transversal generada por perfiles suaves (hombro, anchura, bajos, cabina).
 * El morro apunta a +X, Y es arriba y Z es el ancho.
 */

export const HALF = 2.23;
export const AXLE_F = 1.36;
export const AXLE_R = -1.34;
export const TRACK = 0.835;

// Interpolación de Hermite con tangentes de diferencias finitas (Catmull-Rom sobre x).
function profile(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const m = ys.map((_, i) => {
    if (i === 0) return (ys[1] - ys[0]) / (xs[1] - xs[0]);
    if (i === n - 1) return (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
    return (ys[i + 1] - ys[i - 1]) / (xs[i + 1] - xs[i - 1]);
  });
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

// Línea de hombro: altura donde el lateral se convierte en capó/maletero.
const shoulderP = profile([
  [-2.23, 0.78], [-2.08, 0.86], [-1.8, 0.905], [-1.34, 0.92], [-0.9, 0.89],
  [-0.2, 0.86], [0.6, 0.855], [1.0, 0.85], [1.36, 0.845], [1.72, 0.79],
  [2.0, 0.69], [2.23, 0.57],
]);
// Bombeo del capó respecto al hombro (negativo = capó hundido entre aletas).
const crownP = profile([
  [-2.23, 0.0], [-2.0, 0.03], [-1.6, 0.025], [-1.0, 0.03], [0, 0.05],
  [0.85, 0.045], [1.36, -0.012], [1.85, 0.0], [2.23, 0.0],
]);
// Semiancho en planta: aletas traseras más anchas que las delanteras.
const widthP = profile([
  [-2.23, 0.9], [-1.9, 0.99], [-1.34, 1.02], [-0.8, 0.97], [0, 0.94],
  [0.85, 0.952], [1.36, 0.982], [1.9, 0.94], [2.23, 0.88],
]);
// Altura de los bajos (sin pasos de rueda).
const bottomP = profile([
  [-2.23, 0.3], [-2.1, 0.22], [-1.9, 0.17], [-1.0, 0.13], [1.0, 0.13],
  [1.9, 0.14], [2.1, 0.17], [2.23, 0.27],
]);
// Altura del habitáculo sobre el capó: parabrisas, techo y caída fastback.
const cabinP = profile([
  [-2.0, 0], [-1.86, 0.0], [-1.6, 0.075], [-1.25, 0.185], [-0.85, 0.265],
  [-0.45, 0.3], [-0.05, 0.296], [0.25, 0.235], [0.55, 0.13], [0.85, 0.018], [0.97, 0],
]);

function endRound(x) {
  const r = x > 0 ? 0.3 : 0.15;
  const d = Math.abs(x) - (HALF - r);
  if (d <= 0) return 1;
  const u = Math.min(1, d / r);
  return Math.pow(1 - Math.pow(u, 2.4), 1 / 2.4);
}

export const width = (x) => widthP(x) * endRound(x);
export const shoulder = (x) => shoulderP(x);
export const deckCenter = (x) => shoulderP(x) + crownP(x);
export const roofHeight = (x) => deckCenter(x) + Math.max(0, cabinP(x));

function archBottom(x, base) {
  let y = base;
  for (const [xa, ra] of [[AXLE_F, 0.405], [AXLE_R, 0.415]]) {
    const d = Math.abs(x - xa);
    if (d < ra) y = Math.max(y, WHEEL_R + Math.sqrt(ra * ra - d * d));
    else if (d < ra + 0.05) y = Math.max(y, WHEEL_R + (base - WHEEL_R) * ((d - ra) / 0.05));
  }
  return y;
}

const HN = 31; // puntos por media sección
const RING = HN * 2 - 2;

// Media sección (z >= 0), desde el centro de los bajos hasta el centro del techo.
function halfSection(x, out) {
  const w = Math.max(width(x), 1e-4);
  const ysh = shoulderP(x);
  const yb = Math.min(archBottom(x, bottomP(x)), ysh - 0.02);
  const avail = ysh - yb;
  const rb = Math.min(0.06, avail * 0.3, w * 0.45);
  const rs = Math.min(0.075, avail * 0.35, w * 0.45);
  const tuck = Math.min(0.035, w * 0.2) * Math.min(1, avail / 0.35);
  const cr = crownP(x);
  const H = Math.max(0, cabinP(x));
  const dz = w - rs;
  const wc = Math.min(w * 0.8, dz * 0.98);
  const wr = Math.min(w * 0.58, wc * 0.92);
  const yd = (z) => ysh + cr * (1 - (z / dz) ** 2);
  const g = (z) =>
    z <= wr
      ? 1 - 0.05 * (z / wr) ** 2
      : Math.pow(Math.max(0, Math.cos(((z - wr) / (wc - wr)) * Math.PI * 0.5)), 0.7) * 0.95;
  const top = (z) => yd(z) + H * g(z);

  let k = 0;
  const cx0 = w - tuck - rb;
  for (let i = 0; i < 4; i++) out[k++] = [(cx0 * i) / 3, yb];
  for (let i = 1; i <= 3; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 3);
    out[k++] = [cx0 + rb * Math.cos(a), yb + rb + rb * Math.sin(a)];
  }
  const y0 = yb + rb;
  const y1 = ysh - rs;
  for (let i = 1; i <= 4; i++) {
    const s = i / 4;
    out[k++] = [w - tuck + tuck * Math.sin(s * Math.PI * 0.5), y0 + (y1 - y0) * s];
  }
  for (let i = 1; i <= 4; i++) {
    const a = (Math.PI / 2) * (i / 4);
    out[k++] = [w - rs + rs * Math.cos(a), y1 + rs * Math.sin(a)];
  }
  for (let i = 1; i <= 4; i++) {
    const z = dz + (wc - dz) * (i / 4);
    out[k++] = [z, top(z)];
  }
  for (let i = 1; i <= 6; i++) {
    const z = wc + (wr - wc) * (i / 6);
    out[k++] = [z, top(z)];
  }
  for (let i = 1; i <= 6; i++) {
    const z = wr * (1 - i / 6);
    out[k++] = [z, top(z)];
  }
  return out;
}

// z de la superficie lateral a una altura dada (para colocar detalles sobre la piel).
const sideBuf = new Array(HN);
export function sideZ(x, y) {
  const h = halfSection(x, sideBuf);
  for (let i = 4; i < 15; i++) {
    const [z0, y0] = h[i];
    const [z1, y1] = h[i + 1];
    if ((y - y0) * (y - y1) <= 0 && y1 !== y0) return z0 + ((z1 - z0) * (y - y0)) / (y1 - y0);
  }
  return h[10][0];
}

function buildBodyGeometry(stations) {
  const N = stations;
  const pos = new Float32Array(N * RING * 3);
  const half = new Array(HN);
  const xs = [];
  for (let i = 0; i < N; i++) {
    const x = -HALF + (2 * HALF * i) / (N - 1);
    xs.push(x);
    halfSection(x, half);
    for (let j = 0; j < RING; j++) {
      const hi = j < HN ? j : 2 * HN - 2 - j;
      const s = j < HN ? 1 : -1;
      const o = (i * RING + j) * 3;
      pos[o] = x;
      pos[o + 1] = half[hi][1];
      pos[o + 2] = half[hi][0] * s;
    }
  }

  const buckets = [[], [], []]; // pintura, cristal, negro
  const hiOf = (j) => (j < HN ? j : 2 * HN - 2 - j);
  for (let i = 0; i < N - 1; i++) {
    const xm = (xs[i] + xs[i + 1]) * 0.5;
    const H = Math.max(0, cabinP(xm));
    for (let j = 0; j < RING; j++) {
      const jn = (j + 1) % RING;
      const a = i * RING + j;
      const b = i * RING + jn;
      const c = (i + 1) * RING + jn;
      const d = (i + 1) * RING + j;
      const row = Math.min(hiOf(j), hiOf(jn));
      const cy = (pos[a * 3 + 1] + pos[c * 3 + 1]) * 0.5;
      const cz = Math.abs(pos[a * 3 + 2] + pos[c * 3 + 2]) * 0.5;

      let cat = 0;
      if (row <= 4) cat = 2;
      else if (row >= 18 && H > 0.012) {
        cat = row >= 24 && xm > -0.85 && xm < -0.02 ? 0 : 1;
      }
      // Toma de aire delantera y difusor trasero.
      if (xm > 2.0 && cy < 0.4 && cz < 0.74) cat = 2;
      if (xm < -2.08 && cy < 0.42) cat = 2;

      buckets[cat].push(a, c, b, a, d, c);
    }
  }

  const index = [];
  const geo = new THREE.BufferGeometry();
  let start = 0;
  buckets.forEach((list, m) => {
    index.push(...list);
    geo.addGroup(start, list.length, m);
    start += list.length;
  });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// Busca la x del contorno en planta donde el semiancho vale |z| (morro o cola).
function outlineX(z, front) {
  let lo = front ? 1.4 : -HALF;
  let hi = front ? HALF : -1.4;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) * 0.5;
    const inside = width(mid) > Math.abs(z);
    if (front) inside ? (lo = mid) : (hi = mid);
    else inside ? (hi = mid) : (lo = mid);
  }
  return (lo + hi) * 0.5;
}

let glowTexture;
export function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

function glow(color, sx, sy, opacity = 1) {
  const m = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.set(sx, sy, 1);
  s.renderOrder = 4;
  s.userData.baseOpacity = opacity;
  return s;
}

function tubeAlong(points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 64, radius, 6, false), material);
}

export const PAINTS = [
  { id: 'violeta', name: 'Violeta medianoche', hex: '#4b2b8c', metal: 0.7, rough: 0.32 },
  { id: 'azul', name: 'Azul bahía', hex: '#1c4fa8', metal: 0.6, rough: 0.28 },
  { id: 'plata', name: 'Plata Wangan', hex: '#8f969f', metal: 0.85, rough: 0.3 },
  { id: 'blanco', name: 'Blanco circuito', hex: '#e4e2dc', metal: 0.15, rough: 0.32 },
  { id: 'rojo', name: 'Rojo Shibuya', hex: '#9e0d1f', metal: 0.5, rough: 0.3 },
  { id: 'sumi', name: 'Negro sumi', hex: '#0d0e12', metal: 0.4, rough: 0.26 },
];

export class Car {
  constructor({ quality = 'high' } = {}) {
    this.root = new THREE.Group(); // gira con el configurador
    this.body = new THREE.Group(); // sube y baja con la altura
    this.root.add(this.body);
    this.quality = quality;
    this.wheels = [];
    this.lightMeshes = { head: [], tail: [] };
    this.glows = { head: [], tail: [] };
    this.tailRings = [];
    this.tailV = 1;
    this.tailSeq = 1;
    this.state = { paint: 'violeta', wheel: 'kaze', finish: 'bronce', aero: 'ala', lights: 1, stance: 0 };

    const Physical = quality === 'low' ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;
    const p = PAINTS[0];
    this.paint = new Physical({ color: p.hex, metalness: p.metal, roughness: p.rough, envMapIntensity: 1.25 });
    if (quality !== 'low') {
      this.paint.clearcoat = 1;
      this.paint.clearcoatRoughness = 0.035;
    }
    this.glass = new THREE.MeshStandardMaterial({ color: '#030406', metalness: 0.2, roughness: 0.06, envMapIntensity: 1.8 });
    this.black = new THREE.MeshStandardMaterial({ color: '#060709', metalness: 0.25, roughness: 0.62, envMapIntensity: 0.6 });
    this.carbon = new THREE.MeshStandardMaterial({ color: '#0b0c0f', metalness: 0.45, roughness: 0.32, envMapIntensity: 1.1 });
    this.headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#dfe9ff').multiplyScalar(2.2), toneMapped: false });
    this.tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1530').multiplyScalar(2.2), toneMapped: false });
    this.titanium = new THREE.MeshStandardMaterial({ color: '#7d7aa8', metalness: 1, roughness: 0.28 });

    this.#buildBody();
    this.#buildDetails();
    this.#buildLights();
    this.#buildAero();
    this.setWheels('kaze', 'bronce');
  }

  #buildBody() {
    const stations = this.quality === 'low' ? 140 : 200;
    const mesh = new THREE.Mesh(buildBodyGeometry(stations), [this.paint, this.glass, this.black]);
    this.body.add(mesh);
    this.bodyMesh = mesh;

    // Bloque de chasis: tapa la visión a través de los pasos de rueda.
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.55, 1.3), this.black);
    chassis.position.y = 0.42;
    chassis.userData.noMirror = true;
    this.body.add(chassis);
  }

  #buildDetails() {
    // Retrovisores.
    for (const s of [1, -1]) {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), this.paint);
      shell.scale.set(0.12, 0.055, 0.075);
      shell.position.set(0.66, shoulder(0.66) + 0.11, s * 1.0);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.12), this.carbon);
      stalk.position.set(0.68, shoulder(0.66) + 0.075, s * 0.93);
      this.body.add(shell, stalk);
    }

    // Juntas de puertas: líneas finas que siguen la piel.
    const gap = new THREE.MeshBasicMaterial({ color: '#010102' });
    for (const s of [1, -1]) {
      for (const [x0, lean] of [[0.9, -0.06], [-0.74, -0.1]]) {
        const pts = [];
        const yTop = shoulder(x0) - 0.045;
        for (let i = 0; i <= 10; i++) {
          const y = 0.22 + ((yTop - 0.22) * i) / 10;
          const x = x0 + lean * ((y - 0.22) / (yTop - 0.22));
          pts.push(new THREE.Vector3(x, y, s * (sideZ(x, y) + 0.0015)));
        }
        const line = tubeAlong(pts, 0.0032, gap);
        line.userData.noMirror = true;
        this.body.add(line);
      }
    }

    // Faldones laterales.
    for (const s of [1, -1]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.05, 0.07), this.carbon);
      skirt.position.set(0.0, 0.13, s * (width(0) - 0.03));
      this.body.add(skirt);
    }

    // Splitter delantero siguiendo la planta del morro.
    const shape = new THREE.Shape();
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const z = -0.86 + (1.72 * i) / 24;
      pts.push([outlineX(z, true) + 0.045, z]);
    }
    shape.moveTo(1.7, -0.86);
    pts.forEach(([x, z]) => shape.lineTo(x, z));
    shape.lineTo(1.7, 0.86);
    shape.closePath();
    const splitter = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false }), this.carbon);
    splitter.rotation.x = Math.PI / 2;
    splitter.position.y = 0.125;
    this.body.add(splitter);

    // Difusor con aletas.
    const diff = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 1.44), this.carbon);
    diff.position.set(-2.06, 0.17, 0);
    diff.rotation.z = -0.22;
    this.body.add(diff);
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.012), this.carbon);
      fin.position.set(-2.08, 0.2, i * 0.28);
      fin.rotation.z = -0.22;
      this.body.add(fin);
    }

    // Escapes de titanio azulado.
    for (const s of [1, -1]) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.16, 28, 1, true), this.titanium);
      tip.rotation.z = Math.PI / 2;
      tip.position.set(-2.2, 0.27, s * 0.36);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), new THREE.MeshBasicMaterial({ color: '#020203' }));
      inner.rotation.y = -Math.PI / 2;
      inner.position.set(-2.24, 0.27, s * 0.36);
      this.body.add(tip, inner);
    }
  }

  #buildLights() {
    // Firma delantera: una sola línea LED que abraza el morro.
    const front = [];
    for (let i = 0; i <= 28; i++) {
      const z = -0.8 + (1.6 * i) / 28;
      const x = outlineX(z, true);
      const y = shoulder(x) - 0.075 + 0.01 * Math.cos((z / 0.8) * Math.PI * 0.5);
      front.push(new THREE.Vector3(x + 0.006, y, z));
    }
    const headBar = tubeAlong(front, 0.0105, this.headMat);
    headBar.userData.noMirror = true;
    this.body.add(headBar);
    this.lightMeshes.head.push(headBar);
    // Ojos: dos segmentos cortos más gruesos en las esquinas.
    for (const s of [1, -1]) {
      const eye = [];
      for (let i = 0; i <= 8; i++) {
        const z = s * (0.5 + (0.3 * i) / 8);
        const x = outlineX(z, true);
        eye.push(new THREE.Vector3(x + 0.008, shoulder(x) - 0.11 - 0.012 * (i / 8), z));
      }
      const m = tubeAlong(eye, 0.016, this.headMat);
      m.userData.noMirror = true;
      this.body.add(m);
      this.lightMeshes.head.push(m);
      const g = glow('#cfe0ff', 1.3, 0.55, 0.9);
      g.position.set(outlineX(s * 0.66, true) + 0.12, shoulder(2.0) - 0.1, s * 0.66);
      this.body.add(g);
      this.glows.head.push(g);
    }

    // Firma trasera: barra fina + cuatro círculos.
    const rear = [];
    for (let i = 0; i <= 28; i++) {
      const z = -0.84 + (1.68 * i) / 28;
      const x = outlineX(z, false);
      rear.push(new THREE.Vector3(x - 0.006, shoulder(x) - 0.06, z));
    }
    const tailBar = tubeAlong(rear, 0.008, this.tailMat);
    this.body.add(tailBar);
    this.lightMeshes.tail.push(tailBar);

    for (const zc of [-0.7, -0.44, 0.44, 0.7]) {
      const x = outlineX(zc, false) - 0.01;
      const ringMat = this.tailMat.clone();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.014, 10, 36), ringMat);
      ring.position.set(x, 0.66, zc);
      ring.rotation.y = Math.PI / 2 + (zc > 0 ? 1 : -1) * Math.min(0.5, Math.abs(zc) * 0.35);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.052, 28),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#5a0610'), toneMapped: false })
      );
      disc.position.copy(ring.position).add(new THREE.Vector3(0.004, 0, 0));
      disc.rotation.copy(ring.rotation);
      disc.rotateY(Math.PI);
      this.body.add(ring, disc);
      this.lightMeshes.tail.push(ring);
      const g = glow('#ff2038', 0.75, 0.75, 0.85);
      g.position.set(x - 0.08, 0.66, zc);
      this.body.add(g);
      this.tailRings.push({ mat: ringMat, glow: g });
    }
    const wide = glow('#ff1a30', 3.4, 0.5, 0.35);
    wide.position.set(-2.32, 0.78, 0);
    this.body.add(wide);
    this.glows.tail.push(wide);
  }

  #buildAero() {
    // Ala GT con cuello de cisne.
    const wing = new THREE.Group();
    const foil = new THREE.Shape();
    const chord = 0.36;
    foil.moveTo(0, 0);
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      foil.lineTo(-chord * t, 0.012 * Math.sin(Math.PI * t) + 0.004 * t);
    }
    for (let i = 15; i >= 1; i--) {
      const t = i / 16;
      foil.lineTo(-chord * t, -0.05 * Math.sqrt(t) * (1 - t) * 1.6);
    }
    foil.closePath();
    const blade = new THREE.Mesh(
      new THREE.ExtrudeGeometry(foil, { depth: 1.74, bevelEnabled: false, curveSegments: 4 }),
      this.carbon
    );
    blade.geometry.translate(0, 0, -0.87);
    blade.rotation.z = -0.12;
    blade.position.set(-1.8, 1.13, 0);
    wing.add(blade);
    for (const s of [1, -1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.15, 0.012), this.carbon);
      plate.position.set(-1.98, 1.11, s * 0.875);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.25, 0.016), this.carbon);
      neck.position.set(-1.96, deckCenter(-1.96) + 0.11, s * 0.42);
      neck.rotation.z = 0.32;
      wing.add(plate, neck);
    }
    this.body.add(wing);
    this.wing = wing;

    // Ducktail: un labio corto integrado en la tapa.
    const lip = new THREE.Shape();
    lip.moveTo(0.06, -0.02);
    lip.lineTo(-0.1, 0.045);
    lip.lineTo(-0.115, 0.032);
    lip.lineTo(-0.06, -0.03);
    lip.closePath();
    const duck = new THREE.Mesh(
      new THREE.ExtrudeGeometry(lip, { depth: 1.34, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.006, bevelSegments: 2 }),
      this.paint
    );
    duck.geometry.translate(0, 0, -0.67);
    duck.position.set(-2.03, deckCenter(-2.03), 0);
    duck.visible = false;
    this.body.add(duck);
    this.duck = duck;
  }

  setWheels(design, finish) {
    this.wheels.forEach((w) => w.group.removeFromParent());
    this.wheels = [];
    const spots = [
      [AXLE_F, 1], [AXLE_F, -1], [AXLE_R, 1], [AXLE_R, -1],
    ];
    for (const [x, s] of spots) {
      const w = buildWheel(design, finish, this.quality);
      w.group.position.set(x, WHEEL_R, s * (TRACK + (x < 0 ? 0.03 : 0)));
      if (s < 0) w.group.rotation.y = Math.PI;
      w.side = s;
      this.root.add(w.group);
      this.wheels.push(w);
    }
    this.state.wheel = design;
    this.state.finish = finish;
  }

  setAero(kind) {
    this.wing.visible = kind === 'ala';
    this.duck.visible = kind === 'ducktail';
    this.state.aero = kind;
  }

  setLights(v) {
    this.state.lights = v;
    this.headMat.color.set('#dfe9ff').multiplyScalar(0.08 + 2.1 * v);
    this.glows.head.forEach((g) => (g.material.opacity = g.userData.baseOpacity * v));
  }

  setTail(v) {
    this.tailV = v;
    this.tailMat.color.set('#ff1530').multiplyScalar(0.25 + 2.0 * v);
    this.glows.tail.forEach((g) => (g.material.opacity = g.userData.baseOpacity * v));
    this.#updateRings();
  }

  /** Enciende los cuatro círculos uno tras otro (seq de 0 a 1). */
  setTailSequence(seq) {
    this.tailSeq = seq;
    this.#updateRings();
  }

  #updateRings() {
    // Orden de encendido: de dentro hacia fuera.
    const order = [1, 2, 0, 3];
    this.tailRings.forEach((r, i) => {
      const k = Math.min(1, Math.max(0, this.tailSeq * 4 - order.indexOf(i)));
      const v = this.tailV * k;
      r.mat.color.set('#ff1530').multiplyScalar(0.12 + 2.3 * v);
      r.glow.material.opacity = r.glow.userData.baseOpacity * v;
    });
  }

  setStance(v) {
    this.state.stance = v;
    this.body.position.y = v;
  }

  spin(dist) {
    const a = dist / WHEEL_R;
    for (const w of this.wheels) w.spin.rotation.z -= a * w.side;
  }
}
