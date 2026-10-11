import * as THREE from 'three';

export const WHEEL_R = 0.345;
const RIM_R = 0.236;
const DEG = Math.PI / 180;

export const WHEELS = [
  { id: 'original', name: 'Original', note: 'Cinco radios, la de origen' },
  { id: 'kaze', name: 'Kaze', note: 'Cinco radios dobles' },
  { id: 'ami', name: 'Ami', note: 'Malla forjada' },
  { id: 'tetsu', name: 'Tetsu', note: 'Seis radios, plato profundo' },
];

export const FINISHES = [
  { id: 'bronce', name: 'Bronce', hex: '#a07a44', metal: 1, rough: 0.3 },
  { id: 'grafito', name: 'Grafito', hex: '#383b40', metal: 0.85, rough: 0.38 },
  { id: 'plata', name: 'Plata', hex: '#d2d5da', metal: 1, rough: 0.2 },
];

// Hueco anular entre dos radios: arco exterior de a0 a a1, interior de b1 a b0.
function sectorHole(a0, a1, rOut, b0, b1, rIn) {
  const p = new THREE.Path();
  const seg = 10;
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    const v = [Math.cos(a) * rOut, Math.sin(a) * rOut];
    i === 0 ? p.moveTo(...v) : p.lineTo(...v);
  }
  for (let i = seg; i >= 0; i--) {
    const a = b0 + ((b1 - b0) * i) / seg;
    p.lineTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
  }
  p.closePath();
  return p;
}

function faceShape(design) {
  const outer = design === 'tetsu' ? 0.178 : RIM_R - 0.004;
  const s = new THREE.Shape();
  s.absarc(0, 0, outer, 0, Math.PI * 2, false);
  if (design === 'kaze') {
    for (let k = 0; k < 5; k++) {
      const a = k * 72 * DEG;
      s.holes.push(sectorHole(a + 11 * DEG, a + 61 * DEG, 0.207, a + 21 * DEG, a + 51 * DEG, 0.088));
      s.holes.push(sectorHole(a - 2.6 * DEG, a + 2.6 * DEG, 0.2, a - 1 * DEG, a + 1 * DEG, 0.125));
    }
  } else if (design === 'ami') {
    for (let k = 0; k < 20; k++) {
      const a = k * 18 * DEG;
      s.holes.push(sectorHole(a + 3.2 * DEG, a + 14.8 * DEG, 0.21, a + 6 * DEG, a + 12 * DEG, 0.15));
    }
    for (let k = 0; k < 10; k++) {
      const a = (k * 36 + 9) * DEG;
      s.holes.push(sectorHole(a + 5 * DEG, a + 31 * DEG, 0.138, a + 11 * DEG, a + 25 * DEG, 0.078));
    }
  } else {
    for (let k = 0; k < 6; k++) {
      const a = k * 60 * DEG;
      s.holes.push(sectorHole(a + 12 * DEG, a + 48 * DEG, 0.166, a + 20 * DEG, a + 40 * DEG, 0.08));
    }
  }
  return s;
}

const geoCache = new Map();
function geometries(design, quality) {
  const key = design + quality;
  if (geoCache.has(key)) return geoCache.get(key);
  const radial = quality === 'low' ? 28 : 44;

  // Neumático: perfil girado sobre el eje.
  const prof = [
    [0.244, -0.128], [0.29, -0.136], [0.326, -0.134], [0.341, -0.12], [0.345, -0.09],
    [0.345, 0.09], [0.341, 0.12], [0.326, 0.134], [0.29, 0.136], [0.244, 0.128],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.LatheGeometry(prof, radial);
  tire.rotateX(Math.PI / 2);

  const barrel = new THREE.CylinderGeometry(RIM_R, RIM_R, 0.22, radial, 1, true);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(0, 0, -0.03);

  const deep = design === 'tetsu';
  const face = new THREE.ExtrudeGeometry(faceShape(design), {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.007,
    bevelSize: 0.005,
    bevelSegments: 2,
    curveSegments: quality === 'low' ? 24 : 40,
  });
  face.translate(0, 0, deep ? 0.035 : 0.078);

  let lip = null;
  if (deep) {
    lip = new THREE.LatheGeometry(
      [[0.172, 0.06], [0.19, 0.088], [0.226, 0.1], [RIM_R, 0.104], [RIM_R + 0.004, 0.096]].map(
        ([r, y]) => new THREE.Vector2(r, y)
      ),
      radial
    );
    lip.rotateX(Math.PI / 2);
  }

  const cap = new THREE.CylinderGeometry(0.046, 0.05, 0.03, 24);
  cap.rotateX(Math.PI / 2);
  cap.translate(0, 0, deep ? 0.07 : 0.112);

  const disc = new THREE.CylinderGeometry(0.188, 0.188, 0.026, radial);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, 0, -0.02);

  const cal = new THREE.Shape();
  cal.absarc(0, 0, 0.214, 108 * DEG, 156 * DEG, false);
  cal.absarc(0, 0, 0.13, 156 * DEG, 108 * DEG, true);
  const caliper = new THREE.ExtrudeGeometry(cal, {
    depth: 0.075,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
  });
  caliper.translate(0, 0, -0.058);

  const g = { tire, barrel, face, lip, cap, disc, caliper };
  geoCache.set(key, g);
  return g;
}

const mats = {
  tire: new THREE.MeshStandardMaterial({ color: '#0d0d0f', roughness: 0.86, metalness: 0 }),
  barrel: new THREE.MeshStandardMaterial({ color: '#1a1b1e', roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }),
  disc: new THREE.MeshStandardMaterial({ color: '#5d6066', roughness: 0.45, metalness: 0.9 }),
  caliper: new THREE.MeshStandardMaterial({ color: '#b8102a', roughness: 0.35, metalness: 0.2 }),
  lip: new THREE.MeshStandardMaterial({ color: '#e1e3e7', roughness: 0.14, metalness: 1 }),
  finish: new Map(),
};

export function finishMaterial(id) {
  if (!mats.finish.has(id)) {
    const f = FINISHES.find((x) => x.id === id) || FINISHES[0];
    mats.finish.set(id, new THREE.MeshStandardMaterial({ color: f.hex, metalness: f.metal, roughness: f.rough, envMapIntensity: 1.9 }));
  }
  return mats.finish.get(id);
}

export function buildWheel(design, finish, quality) {
  const g = geometries(design, quality);
  const group = new THREE.Group();
  const spin = new THREE.Group();
  const fm = finishMaterial(finish);
  spin.add(new THREE.Mesh(g.tire, mats.tire));
  spin.add(new THREE.Mesh(g.barrel, mats.barrel));
  spin.add(new THREE.Mesh(g.face, fm));
  spin.add(new THREE.Mesh(g.cap, fm));
  spin.add(new THREE.Mesh(g.disc, mats.disc));
  if (g.lip) spin.add(new THREE.Mesh(g.lip, mats.lip));
  group.add(spin);
  group.add(new THREE.Mesh(g.caliper, mats.caliper));
  return { group, spin };
}
