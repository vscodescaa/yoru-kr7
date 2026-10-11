import * as THREE from 'three';
import { buildWheel, finishMaterial, FINISHES } from './wheels.js';

/*
 * YORU KR-7 sobre base Nissan Skyline R34.
 * Modelo: "Nissan GTR R34 Skyline | GT-R Skyline" de Pooya_dh (Sketchfab), CC BY 4.0.
 * Se normaliza al sistema de la escena (morro hacia +X, Y arriba, Z al ancho), se le
 * quitan los emblemas de Nissan/GT-R, se reasignan los materiales y se separan los ejes
 * de la carrocería para que las ruedas giren y la altura de suspensión sea real.
 */

export const PAINTS = [
  { id: 'violeta', name: 'Violeta medianoche', hex: '#3a2373', metal: 0.6, rough: 0.38 },
  { id: 'azul', name: 'Azul bahía', hex: '#173f94', metal: 0.6, rough: 0.34 },
  { id: 'plata', name: 'Plata Wangan', hex: '#868c95', metal: 0.9, rough: 0.32 },
  { id: 'blanco', name: 'Blanco circuito', hex: '#dcdad4', metal: 0.2, rough: 0.3 },
  { id: 'rojo', name: 'Rojo Shibuya', hex: '#8e0b1b', metal: 0.55, rough: 0.3 },
  { id: 'sumi', name: 'Negro sumi', hex: '#0b0c10', metal: 0.5, rough: 0.27 },
];

const AXLE_F = 1.35;
const AXLE_R = -1.26;
const AXLE_Y = 0.343;
const RIM_Z = 0.79; // centro lateral de cada neumático

// Piezas del GLB (nombres de nodo tal como los deja GLTFLoader).
const BADGES = ['Plane011_26', 'Plane012_27', 'Plane013_28', 'Plane014_29', 'Curve_58', 'Curve001_59', 'Curve002_60', 'Curve011_61'];
const WING = ['Plane008_24', 'Plane009_25'];
const TIRES = { front: 'Front_Tire_30', rear: 'BBack__Tire_31' };
const RIMS = { front: 'Ring_32', rear: 'Back___Ring_33' };
const DISC_REAR = 'Ring001_37';
const CALIPERS = 'Breake_36';

function sodium(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k);
}

export class Car {
  constructor(gltf, { quality = 'high' } = {}) {
    this.quality = quality;
    this.root = new THREE.Group(); // gira con el configurador
    this.body = new THREE.Group(); // sube y baja con la altura
    this.root.add(this.body);
    this.state = { paint: 'violeta', wheel: 'original', finish: 'plata', aero: 'ala', lights: 1, stance: 0 };
    this.tailV = 1;
    this.tailSeq = 1;
    this.headV = 1;

    const model = gltf.scene;
    model.rotation.y = Math.PI / 2; // el GLB mira a +Z
    this.body.add(model);
    model.updateMatrixWorld(true);
    this.model = model;

    this.#materials();
    this.#hideBadges();
    this.#axles();
    this.#procWheels = new Map();
    this.wing = new THREE.Group();
    for (const n of WING) {
      const o = model.getObjectByName(n);
      if (o) this.wing.attach(o);
    }
    this.body.add(this.wing);
    this.duck = new THREE.Group(); // sin alerón: no hay pieza que mostrar

    this.headAnchors = [
      [1.95, 0.64, 0.6],
      [1.95, 0.64, -0.6],
    ];
    this.dims = { front: 2.24, rear: -2.2, roof: 1.36 };

    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    this.setWheels('original', 'plata');
  }

  #procWheels;

  #materials() {
    const q = this.quality;
    const Physical = q === 'low' ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;
    const p = PAINTS[0];
    this.paint = new Physical({ color: p.hex, metalness: p.metal, roughness: p.rough, envMapIntensity: 1 });
    if (q !== 'low') {
      this.paint.clearcoat = 1;
      this.paint.clearcoatRoughness = 0.04;
    }
    this.glass = new THREE.MeshPhysicalMaterial({
      color: '#05070a', metalness: 0, roughness: 0.03, envMapIntensity: 1.6,
      transparent: true, opacity: 0.82, depthWrite: false,
    });
    this.lens = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', metalness: 0, roughness: 0.04, envMapIntensity: 1.4,
      transparent: true, opacity: 0.16, depthWrite: false,
    });
    this.headMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    // Reflector del faro: metal pulido que se ilumina con la lámpara.
    this.headReflector = new THREE.MeshStandardMaterial({
      color: '#c9d0da', metalness: 1, roughness: 0.18, emissive: '#dfe8ff', emissiveIntensity: 1, envMapIntensity: 1.2,
    });
    this.tailMat = this.#tailMaterial();
    this.amber = new THREE.MeshBasicMaterial({ color: sodium('#ff6a10', 0.35) });
    this.rimMat = finishMaterial('plata');
    this.chrome = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 1, roughness: 0.12, envMapIntensity: 1.4 });
    this.trim = new THREE.MeshStandardMaterial({ color: '#08090b', metalness: 0.3, roughness: 0.45, envMapIntensity: 0.8 });
    this.tire = new THREE.MeshStandardMaterial({ color: '#111113', roughness: 0.82, metalness: 0, envMapIntensity: 0.5 });
    this.plateLight = new THREE.MeshBasicMaterial({ color: sodium('#fff2dc', 0.6) });
    this.titanium = new THREE.MeshStandardMaterial({ color: '#8a86a8', metalness: 1, roughness: 0.25 });

    const byName = {
      Car_Paint_With_Flakes: this.paint,
      Body_Color: this.paint,
      Glass: this.glass,
      Glass_Sefid: this.lens,
      Ligh: this.headReflector,
      Nooor001: this.headMat,
      'Nooor.001': this.headMat,
      Back_Lght: this.tailMat,
      'Material.001': this.tailMat,
      Material001: this.tailMat,
      BBack_LED: this.tailMat,
      white_light: this.tailMat,
      Orange__Light: this.amber,
      Orange_Light: this.amber,
      'Material.004': this.rimMat,
      Material004: this.rimMat,
      Exus: this.titanium,
      'Material.005': this.plateLight,
      Material005: this.plateLight,
      Miror: this.chrome,
      Plastic001: this.trim,
      'Plastic.001': this.trim,
    };
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material.name;
      const m = byName[name];
      if (m) o.material = m;
      else if (name === 'Tire' || name === 'Air_Duct_Rubber') {
        // Conserva las texturas del neumático, con un poco más de rugosidad.
        o.material.roughness = 0.85;
        o.material.envMapIntensity = 0.5;
      } else if (o.material.transmission) {
        o.material.transmission = 0;
      }
      if (o.material === this.glass || o.material === this.lens) o.renderOrder = 2;
    });
  }

  /** Pilotos traseros: cuatro círculos que se encienden en orden por posición lateral. */
  #tailMaterial() {
    const uniforms = { uSeq: { value: 1 }, uOn: { value: 1 }, uRootInv: { value: new THREE.Matrix4() } };
    const m = new THREE.MeshBasicMaterial({ color: '#ff1a30' });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vLat; uniform mat4 uRootInv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLat = (uRootInv * modelMatrix * vec4(position, 1.)).z;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vLat; uniform float uSeq, uOn;')
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          // Orden: los dos interiores primero, luego los exteriores.
          float lat = abs(vLat);
          float idx = lat < .48 ? (vLat > 0. ? 0. : 1.) : (vLat > 0. ? 2. : 3.);
          float k = clamp(uSeq * 4. - idx, 0., 1.);
          diffuseColor.rgb *= .1 + 3.4 * uOn * k;`
        );
    };
    m.customProgramCacheKey = () => 'tail-seq';
    m.userData.uniforms = uniforms;
    return m;
  }

  #hideBadges() {
    for (const n of BADGES) {
      const o = this.model.getObjectByName(n);
      if (o) o.visible = false;
    }
    // Letras "GT-R" laterales: el material Logo.
    this.model.traverse((o) => {
      if (o.isMesh && o.material.name === 'Logo') o.visible = false;
    });
    this.#removeRearLettering();
  }

  /*
   * El rótulo "SKYLINE" está modelado en relieve dentro del paragolpes trasero. Se
   * eliminan los triángulos que sobresalen de la superficie base en esa franja: la
   * superficie de debajo es continua, así que el paragolpes queda liso.
   */
  #removeRearLettering() {
    const node = this.model.getObjectByName('Separ_Aghab_44');
    const mesh = node?.children.find((c) => c.isMesh);
    if (!mesh?.geometry.index) return;
    this.root.updateMatrixWorld(true);
    const M = new THREE.Matrix4().copy(this.root.matrixWorld).invert().multiply(mesh.matrixWorld);
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const P = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(M);
      P[i * 3] = v.x;
      P[i * 3 + 1] = v.y;
      P[i * 3 + 2] = v.z;
    }
    const inBand = (y, z) => y > 0.615 && y < 0.73 && Math.abs(z) < 0.37;
    const base = new Map(); // x de la superficie base por franja de 5 mm
    for (let i = 0; i < pos.count; i++) {
      const y = P[i * 3 + 1];
      if (!inBand(y, P[i * 3 + 2])) continue;
      const k = Math.round(y / 0.005);
      base.set(k, Math.max(base.get(k) ?? -Infinity, P[i * 3]));
    }
    const keep = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3;
      const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
      const cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
      const bx = base.get(Math.round(cy / 0.005));
      if (inBand(cy, cz) && bx !== undefined && cx < bx - 0.002) continue;
      keep.push(a, b, c);
    }
    g.setIndex(keep);
  }

  /** Saca neumáticos, llantas y discos a dos ejes que giran sobre Z. */
  #axles() {
    this.axles = [];
    for (const [key, x] of [['front', AXLE_F], ['rear', AXLE_R]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, AXLE_Y, 0);
      this.root.add(pivot);
      pivot.updateMatrixWorld(true);
      const parts = { tire: [], rim: [] };
      const tire = this.model.getObjectByName(TIRES[key]);
      const rim = this.model.getObjectByName(RIMS[key]);
      if (tire) {
        pivot.attach(tire);
        parts.tire.push(tire);
      }
      if (rim) {
        pivot.attach(rim);
        parts.rim.push(rim);
      }
      if (key === 'rear') {
        const disc = this.model.getObjectByName(DISC_REAR);
        if (disc) {
          pivot.attach(disc);
          parts.rim.push(disc);
        }
      }
      this.axles.push({ key, pivot, parts, side: 1 });
    }
    // Pinzas de freno: siguen a la rueda, no a la carrocería, y no giran.
    const cal = this.model.getObjectByName(CALIPERS);
    if (cal) this.root.attach(cal);
    this.calipers = cal;
    // Compatibilidad con el resto de la escena: "wheels" con un grupo que gira.
    this.wheels = this.axles.map((a) => ({ group: a.pivot, spin: a.pivot, side: 1 }));
  }

  setWheels(design, finish) {
    const f = FINISHES.find((x) => x.id === finish) || FINISHES[0];
    this.rimMat.color.set(f.hex);
    this.rimMat.metalness = f.metal;
    this.rimMat.roughness = f.rough;
    const original = design === 'original';
    for (const a of this.axles) {
      a.parts.rim.forEach((r) => (r.visible = original));
      const prev = this.#procWheels.get(a.key);
      if (prev) prev.forEach((g) => g.removeFromParent());
      this.#procWheels.delete(a.key);
      if (original) continue;
      const set = [];
      for (const s of [1, -1]) {
        const w = buildWheel(design, finish, this.quality);
        // El neumático real del modelo se queda: de la rueda procedural solo se usa la llanta.
        w.spin.children[0].visible = false;
        w.group.children[1].visible = false; // pinza propia: ya está la del modelo
        w.group.position.set(0, 0, s * RIM_Z);
        if (s < 0) w.group.rotation.y = Math.PI;
        a.pivot.add(w.group);
        set.push(w.group);
      }
      this.#procWheels.set(a.key, set);
    }
    this.state.wheel = design;
    this.state.finish = finish;
  }

  setAero(kind) {
    this.wing.visible = kind === 'ala';
    this.state.aero = kind;
  }

  setLights(v) {
    this.headV = v;
    this.state.lights = v;
    this.headMat.color.setRGB(1, 1, 1).multiplyScalar(0.05 + 4 * v);
    this.headReflector.emissiveIntensity = 0.02 + 1.6 * v;
  }

  setTail(v) {
    this.tailV = v;
    this.tailMat.userData.uniforms.uOn.value = 0.25 + 0.75 * v;
  }

  /** Enciende los cuatro círculos uno tras otro (seq de 0 a 1). */
  setTailSequence(seq) {
    this.tailSeq = seq;
    this.tailMat.userData.uniforms.uSeq.value = seq;
  }

  setStance(v) {
    this.state.stance = v;
    this.body.position.y = v;
  }

  /** Mantiene el marco local de los pilotos aunque el coche gire en el configurador. */
  update() {
    this.root.updateMatrixWorld();
    this.tailMat.userData.uniforms.uRootInv.value.copy(this.root.matrixWorld).invert();
  }

  spin(dist) {
    const a = dist / AXLE_Y;
    for (const ax of this.axles) ax.pivot.rotation.z -= a;
  }
}
