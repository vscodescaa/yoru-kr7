import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE, STREET } from './road.js';

/*
 * Ciudad: una manzana de edificios a cada lado de la calle que se repite cada PERIOD
 * metros (se desplaza con el viaje), un horizonte lejano de torres y rótulos verticales
 * de neón perpendiculares a la calle, como en cualquier calle comercial de Tokio.
 */

export const PERIOD = 72;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FACADE = /* glsl */ `
  uniform vec3 uFogColor; uniform float uFogDensity; uniform float uTime;
  varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vSize; varying float vSeed; varying float vD;
  ${NOISE}
  void main(){
    // La interpolación deja micro-variaciones en la semilla: el hash las convertiría en ruido.
    float sd = floor(vSeed * 997. + .5) / 997.;
    vec3 n = normalize(vN);
    float side = step(.5, abs(n.x));
    // Coordenada horizontal sobre la fachada, en metros, independiente de la orientación.
    float u = mix(vL.x * vSize.x, vL.z * vSize.z, side);
    float y = vW.y;
    float roof = step(.5, n.y);
    vec3 concrete = mix(vec3(.018,.019,.024), vec3(.03,.028,.03), hash(vec2(sd, 3.)));
    vec3 col = concrete * (.7 + .3 * vnoise(vec2(u*.6, y*.4) + sd*10.));

    float floorH = 3.1 + hash(vec2(sd, 1.)) * .5;
    float colW = 1.25 + hash(vec2(sd, 2.)) * .7;
    vec2 cell = floor(vec2(u / colW, (y - 4.4) / floorH));
    vec2 f = fract(vec2(u / colW, (y - 4.4) / floorH));
    float frame = step(.18, f.x) * step(f.x, .82) * step(.32, f.y) * step(f.y, .8);
    float h = hash(cell + sd * 17.);
    // Algunas plantas enteras apagadas, otras con oficinas encendidas.
    float floorOn = step(.35, hash(vec2(cell.y, sd * 5.)));
    float lit = step(.84 - .1 * hash(vec2(sd, 9.)), h) * floorOn;
    float k = hash(cell * 1.7 + sd);
    vec3 warm = vec3(1., .6, .28);
    vec3 cool = vec3(.72, .86, 1.);
    vec3 tv = vec3(.4, .55, 1.) * (.7 + .3 * sin(uTime * 3. + h * 40.));
    vec3 wc = k < .6 ? warm : (k < .92 ? cool : tv);
    // Interior: más luz arriba (techo) y una persiana a media altura en algunas.
    float interior = mix(.45, 1., smoothstep(.35, .8, f.y)) * (step(.5, hash(cell + 3.1)) > .5 ? step(f.y, .55 + .2 * hash(cell)) * .7 + .3 : 1.);
    float upper = step(4.4, y);
    vec3 glassDark = vec3(.004, .006, .01) + vec3(.02, .018, .03) * smoothstep(.3, .8, f.y);
    vec3 windows = frame * upper * (lit * wc * interior * (.08 + h * .22) + (1. - lit) * glassDark);
    col = mix(col, vec3(0.), frame * upper * .7);
    col += windows;
    // Cornisas horizontales entre plantas.
    col *= 1. - upper * .35 * (1. - smoothstep(.0, .05, f.y));

    // Planta baja: escaparates con interior, persianas metálicas y rótulos sobre la puerta.
    float ground = 1. - upper;
    float shopCell = floor(u / 4.6 + sd * 3.);
    float shopH = hash(vec2(shopCell, sd));
    float sf = fract(u / 4.6 + sd * 3.);
    float glass = step(.05, sf) * step(sf, .95) * step(.12, y) * step(y, 2.85);
    float mull = 1. - (1. - smoothstep(.0, .012, abs(fract(sf * 3.) - .5) - .48)) * .8;
    vec3 shopTint = mix(vec3(1., .74, .46), vec3(.82, .92, 1.), step(.62, shopH));
    vec3 shop = shopTint * (.06 + .32 * smoothstep(.2, 2.8, y)) * (.7 + .3 * vnoise(vec2(u * 1.3, y * 2.))) * mull;
    vec3 shutter = vec3(.018, .019, .022) * (.7 + .3 * step(.5, fract(y * 6.)));
    bool open = shopH > .3;
    col = mix(col, open ? shop : shutter, glass * ground);
    float boxY = step(3.05, y) * step(y, 3.7) * step(.04, sf) * step(sf, .96);
    vec3 boxCol = vec3(hash(vec2(shopCell, 4.)), hash(vec2(shopCell, 5.)), hash(vec2(shopCell, 6.)));
    boxCol = normalize(boxCol + .15);
    float letters = step(.18, abs(fract((sf - .04) * 9.) - .5)) * step(3.22, y) * step(y, 3.53);
    vec3 box = boxCol * (.12 + .35 * (1. - letters));
    col = mix(col, box, boxY * ground * step(.45, shopH));
    // Luz de calle que sube por la fachada.
    col += vec3(1., .6, .3) * .025 * exp(-y * .3) * (1. - roof);
    // Tira de neón vertical en la esquina de algunos edificios.
    float neonOn = step(.8, hash(vec2(sd, 7.)));
    float edgeU = min(abs(vL.x * vSize.x - vSize.x * .5 + .25), 99.);
    vec3 neonCol = mix(vec3(1., .15, .45), vec3(.2, .7, 1.), step(.5, hash(vec2(sd, 8.))));
    col += neonCol * 1.1 * neonOn * (1. - side) * (1. - smoothstep(.05, .09, edgeU)) * step(4.5, y) * step(y, vSize.y - 1.);
    col = mix(col, vec3(.012), roof);

    float fog = 1. - exp(-uFogDensity * uFogDensity * vD * vD);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 1.);
  }
`;

function facadeMaterial(fog) {
  return new THREE.ShaderMaterial({
    uniforms: { uFogColor: { value: fog.color }, uFogDensity: { value: fog.density }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aSize; attribute float aSeed;
      varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vSize; varying float vSeed; varying float vD;
      void main(){
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vL = position; vSize = aSize; vSeed = aSeed;
        vec4 mv = viewMatrix * w; vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: FACADE,
  });
}

export function buildStreetBlocks(fog) {
  const r = rng(7);
  const items = [];
  for (const side of [-1, 1]) {
    let x = -PERIOD / 2;
    while (x < PERIOD / 2 - 3) {
      const w = Math.min(PERIOD / 2 - x, 6 + r() * 9);
      const d = 10 + r() * 8;
      const h = 9 + Math.pow(r(), 1.4) * 34;
      const front = side < 0 ? STREET.buildNear : STREET.buildFar;
      const setback = r() * 0.9;
      items.push({ x: x + w / 2, z: front + side * (d / 2 + setback), w: w - 0.25, d, h, seed: r() });
      x += w;
    }
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const copies = [-1, 0, 1];
  const count = items.length * copies.length;
  const ig = new THREE.InstancedBufferGeometry().copy(geo);
  const size = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const mesh = new THREE.InstancedMesh(ig, facadeMaterial(fog), count);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const c of copies) {
    for (const b of items) {
      m.compose(new THREE.Vector3(b.x + c * PERIOD, 0, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(i, m);
      size.set([b.w, b.h, b.d], i * 3);
      seed[i] = b.seed;
      i++;
    }
  }
  ig.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 3));
  ig.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  mesh.frustumCulled = false;
  return { mesh, uniforms: mesh.material.uniforms, items };
}

// Rótulos verticales en kanji, sobresaliendo de las fachadas hacia la calle.
const SIGNS = [
  { text: '夜走', color: '#ff2f6d', x: -30, side: -1, y: 6.2 },
  { text: '高速', color: '#46c2ff', x: -9, side: -1, y: 7.4 },
  { text: '湾岸', color: '#ffb347', x: 14, side: -1, y: 6.6 },
  { text: '整備', color: '#ff2f3f', x: 27, side: -1, y: 8.2 },
  { text: '月夜', color: '#9a7dff', x: -20, side: 1, y: 7.0 },
  { text: '駐車', color: '#46c2ff', x: 5, side: 1, y: 6.0 },
  { text: '夜走', color: '#ffb347', x: 31, side: 1, y: 7.8 },
];

function signTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 576;
  const g = c.getContext('2d');
  g.fillStyle = '#07070a';
  g.fillRect(0, 0, 192, 576);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.shadowColor = color;
  g.shadowBlur = 16;
  g.strokeRect(16, 16, 160, 544);
  g.font = "800 132px 'Shippori Mincho B1', serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.shadowBlur = 22;
  [...text].forEach((ch, i) => g.fillText(ch, 96, 170 + i * 240));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildSigns() {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: '#111216', roughness: 0.5, metalness: 0.6 });
  for (const s of SIGNS) {
    const col = new THREE.Color(s.color);
    const face = new THREE.MeshBasicMaterial({
      map: signTexture(s.text, s.color),
      color: new THREE.Color(1, 1, 1).multiplyScalar(1.6),
      fog: true,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3.6, 1.15), [face, face, frameMat, frameMat, frameMat, frameMat]);
    for (const k of [-1, 0, 1]) {
      const b = box.clone();
      const front = s.side < 0 ? STREET.buildNear : STREET.buildFar;
      b.position.set(s.x + k * PERIOD, s.y, front - s.side * 0.85);
      b.userData.color = col;
      group.add(b);
    }
  }
  return { group };
}

/** Torres lejanas: siluetas con ventanas, balizas y bruma. No se desplazan. */
export function buildSkyline(fog) {
  const count = 60;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFogColor: { value: fog.color } },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying float vD;
      void main(){
        vec4 w = modelMatrix * instanceMatrix * vec4(position,1.);
        vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vec4 mv = viewMatrix * w; vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFogColor; varying vec3 vW; varying vec3 vN; varying float vD;
      ${NOISE}
      void main(){
        vec2 t = normalize(vec2(-vN.z, vN.x));
        float u = dot(vW.xz, t);
        vec2 cell = floor(vec2(u*.7, vW.y*.32));
        vec2 f = fract(vec2(u*.7, vW.y*.32));
        float win = step(.2,f.x)*step(f.x,.8)*step(.3,f.y)*step(f.y,.75);
        float lit = step(.8, hash(cell + floor(vW.xz*.05)));
        vec3 warm = mix(vec3(1.,.66,.36), vec3(.75,.88,1.), step(.6, hash(cell*.7)));
        vec3 col = vec3(.006,.007,.012) + win*lit*warm*.9*(1.-abs(vN.y));
        float haze = exp(-max(vW.y,0.)*.04);
        col = mix(col, uFogColor * 1.6, haze * .75);
        gl_FragColor = vec4(mix(col, uFogColor, .55), 1.);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const r = rng(21);
  const tops = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + r() * 0.08;
    const rad = 95 + r() * 45;
    const h = 30 + Math.pow(r(), 1.3) * 90;
    const w = 10 + r() * 16;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m.compose(new THREE.Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad), q, new THREE.Vector3(w, h, w * 0.8));
    mesh.setMatrixAt(i, m);
    if (h > 50) tops.push(Math.cos(a) * rad, h + 1, Math.sin(a) * rad);
  }
  mesh.frustumCulled = false;

  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(tops, 3));
  bg.setAttribute('aPhase', new THREE.Float32BufferAttribute(tops.filter((_, i) => i % 3 === 0).map(() => r() * 6.28), 1));
  const beaconUniforms = { uTime: { value: 0 }, uScale: { value: 300 } };
  const beacons = new THREE.Points(
    bg,
    new THREE.ShaderMaterial({
      uniforms: beaconUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aPhase; uniform float uTime, uScale; varying float vOn;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.);
          vOn = smoothstep(.55,.95, sin(uTime*1.3 + aPhase)*.5+.5);
          gl_PointSize = 2.2 * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vOn;
        void main(){
          float d = length(gl_PointCoord-.5)*2.;
          float g = exp(-d*d*6.) + .6*exp(-d*d*60.);
          gl_FragColor = vec4(vec3(1.,.08,.12) * g * vOn * 3., 1.);
        }`,
    })
  );
  beacons.renderOrder = 1;
  return { mesh, beacons, beaconUniforms };
}

/** Cielo nocturno con contaminación lumínica y nubes bajas iluminadas desde abajo. */
export function buildSky() {
  const uniforms = {
    uTop: { value: new THREE.Color('#020309') },
    uHorizon: { value: new THREE.Color('#2a1c2e') },
    uGlow: { value: new THREE.Color('#5a3a3a') },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uGlow; uniform float uTime; varying vec3 vP;
      ${NOISE}
      void main(){
        vec3 d = normalize(vP);
        float h = d.y;
        vec3 c = mix(uHorizon, uTop, smoothstep(-.02, .45, h));
        // Nubes bajas: capa de ruido proyectada sobre una cúpula.
        vec2 cp = d.xz / max(h + .12, .05) * 1.4 + uTime * .006;
        float cl = smoothstep(.45, .85, fbm(cp));
        c += uGlow * cl * smoothstep(.02, .12, h) * smoothstep(.6, .15, h) * .55;
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), mat);
  m.renderOrder = -1;
  return { mesh: m, uniforms };
}

/*
 * Mobiliario de calle japonés: postes eléctricos de hormigón con travesaños,
 * transformadores y cables combados, y máquinas expendedoras encendidas.
 */
export function buildStreetFurniture() {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.8, metalness: 0, envMapIntensity: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: '#16171b', roughness: 0.5, metalness: 0.6, envMapIntensity: 0.6 });
  const POLE_SPACING = 36;
  const poleParts = [];
  const darkParts = [];
  const wirePts = [];
  for (const side of [-1, 1]) {
    const z = side < 0 ? STREET.curbNear - 0.6 : STREET.curbFar + 0.6;
    const tops = [];
    for (let k = -3; k <= 3; k++) {
      const x = k * POLE_SPACING + (side > 0 ? 11 : -7);
      const pole = new THREE.CylinderGeometry(0.13, 0.19, 10.5, 10);
      pole.translate(x, 5.25, z);
      poleParts.push(pole);
      for (const [y, len] of [[9.6, 1.7], [8.9, 1.3]]) {
        const arm = new THREE.BoxGeometry(0.1, 0.1, len);
        arm.translate(x, y, z);
        darkParts.push(arm);
      }
      const trafo = new THREE.CylinderGeometry(0.28, 0.28, 0.75, 12);
      trafo.translate(x + 0.32, 7.6, z);
      darkParts.push(trafo);
      tops.push(x);
    }
    // Cables: catenarias entre postes consecutivos, a distintas alturas.
    for (const [y, dz] of [[9.62, 0.75], [9.62, -0.75], [8.92, 0.55], [8.92, -0.55], [7.9, 0]]) {
      for (let i = 0; i < tops.length - 1; i++) {
        const a = tops[i];
        const b = tops[i + 1];
        const sag = 0.55 + Math.abs(dz) * 0.2;
        const N = 14;
        for (let j = 0; j < N; j++) {
          const t0 = j / N;
          const t1 = (j + 1) / N;
          const p = (t) => [a + (b - a) * t, y - sag * 4 * t * (1 - t), z + dz];
          wirePts.push(...p(t0), ...p(t1));
        }
      }
    }
  }
  const poles = new THREE.Mesh(mergeGeometries(poleParts), concrete);
  const fittings = new THREE.Mesh(mergeGeometries(darkParts), dark);
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#050507', transparent: true, opacity: 0.85 }));
  group.add(poles, fittings, wires);

  // Máquinas expendedoras: la luz más reconocible de una calle japonesa de noche.
  const front = vendingTexture();
  const vm = [];
  const spots = [
    [-22, -1, 2], [9, -1, 1], [30, -1, 3],
    [-14, 1, 2], [20, 1, 1],
  ];
  const faceMat = new THREE.MeshBasicMaterial({ map: front, color: new THREE.Color(1, 1, 1).multiplyScalar(1.15) });
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#d9dade', roughness: 0.35, metalness: 0.2, envMapIntensity: 0.6 });
  for (const [x0, side, n] of spots) {
    const zFace = side < 0 ? STREET.buildNear + 0.45 : STREET.buildFar - 0.45;
    for (let i = 0; i < n; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.83, 0.75), [bodyMat, bodyMat, bodyMat, bodyMat, side < 0 ? faceMat : bodyMat, side < 0 ? bodyMat : faceMat]);
      box.position.set(x0 + i * 1.04, STREET.sidewalkH + 0.915, zFace);
      vm.push(box);
    }
  }
  for (const k of [-1, 0, 1]) {
    for (const b of vm) {
      const c = b.clone();
      c.position.x += k * PERIOD;
      group.add(c);
    }
  }
  // Los postes repiten cada 36 m: dos tramos cubren el periodo de la manzana.
  return { group };
}

function vendingTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 468;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f6fb';
  g.fillRect(0, 0, 256, 468);
  const cols = ['#d92b2b', '#1f5fd1', '#f2c230', '#2aa55a', '#ea6a1f', '#7b3fc4', '#e8e8e8', '#13a3c9'];
  for (let row = 0; row < 3; row++) {
    const y0 = 34 + row * 92;
    g.fillStyle = '#c9d2e6';
    g.fillRect(14, y0 - 6, 228, 82);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = cols[(i * 3 + row * 5) % cols.length];
      g.fillRect(22 + i * 27.5, y0, 18, 52);
      g.fillStyle = 'rgba(255,255,255,.6)';
      g.fillRect(25 + i * 27.5, y0 + 4, 4, 40);
      g.fillStyle = '#222';
      g.fillRect(24 + i * 27.5, y0 + 60, 14, 6);
    }
  }
  g.fillStyle = '#1b1d22';
  g.fillRect(14, 316, 228, 70);
  g.fillStyle = '#0c0d10';
  g.fillRect(40, 400, 176, 50);
  g.fillStyle = '#3cff8a';
  g.fillRect(170, 330, 50, 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
