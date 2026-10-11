import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getGlowTexture } from './car.js';

/*
 * Noche urbana: mapa de entorno generado una sola vez (PMREM), asfalto mojado con
 * reflejos en espacio de pantalla, lluvia en GPU, bokeh, letreros y siluetas de edificios.
 * Todo es procedural: cero texturas descargadas.
 */

const hot = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

export function buildEnvironmentMap(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color('#010103');
  const add = (w, h, color, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(look ?? new THREE.Vector3(0, 0.6, 0));
    env.add(m);
    return m;
  };
  // Softbox cenital largo: la línea blanca que recorre techo y capó.
  add(9, 0.55, hot('#ffffff', 5), new THREE.Vector3(0, 6, 0.8), new THREE.Vector3(0, 0, 0.8));
  add(9, 0.25, hot('#dfe8ff', 3), new THREE.Vector3(0, 5.5, -1.6), new THREE.Vector3(0, 0, -1.6));
  // Tubos de neón laterales.
  add(0.18, 5, hot('#3aa6ff', 5), new THREE.Vector3(-3.5, 2.5, -6));
  add(0.18, 4, hot('#ff2a8a', 3.2), new THREE.Vector3(4.5, 2.2, -6.5));
  add(7, 0.16, hot('#ff2030', 2.4), new THREE.Vector3(1, 0.7, 7));
  add(4, 0.12, hot('#5fd0ff', 2), new THREE.Vector3(-6.5, 1.4, 3));
  // Paneles laterales tenues: dan al lateral de la carrocería una banda de reflejo.
  add(12, 1.6, hot('#8fa6d8', 1.0), new THREE.Vector3(0, 1.1, -7));
  add(12, 1.6, hot('#d8a27a', 0.85), new THREE.Vector3(0, 1.1, 7));
  add(1.6, 3, hot('#c7d4ff', 1.4), new THREE.Vector3(8, 1.8, 0));
  add(1.6, 3, hot('#ff5a6a', 0.9), new THREE.Vector3(-8, 1.6, 0));
  // Halo cálido de ciudad en el horizonte.
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 14, 2.2, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: hot('#ff9a4a', 0.22), side: THREE.BackSide })
  );
  ring.position.y = 1.2;
  env.add(ring);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: '#020203' }));
  floor.rotation.x = -Math.PI / 2;
  env.add(floor);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.015);
  pmrem.dispose();
  env.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return rt.texture;
}

const NOISE = /* glsl */ `
  float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
  }
  float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.03; a*=.5; } return v; }
`;

export const MAX_STREAKS = 10;

export function buildGround() {
  const uniforms = {
    uTime: { value: 0 },
    uRoad: { value: 0 },
    uWet: { value: 1 },
    uFogColor: { value: new THREE.Color('#05070d') },
    uFogDensity: { value: 0.045 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uStreakPos: { value: Array.from({ length: MAX_STREAKS }, () => new THREE.Vector3()) },
    uStreakCol: { value: Array.from({ length: MAX_STREAKS }, () => new THREE.Color()) },
    uTint: { value: new THREE.Color('#1b2236') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying float vDepth;
      void main(){
        vec4 w = modelMatrix * vec4(position,1.);
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uRoad, uWet, uFogDensity;
      uniform vec3 uFogColor, uTint;
      uniform vec2 uRes;
      uniform vec3 uStreakPos[${MAX_STREAKS}];
      uniform vec3 uStreakCol[${MAX_STREAKS}];
      varying vec3 vWorld; varying float vDepth;
      ${NOISE}
      void main(){
        vec2 p = vWorld.xz;
        vec2 rp = vec2(p.x + uRoad, p.y);
        float puddle = smoothstep(.42,.68, fbm(rp*.32 + 3.1));
        float grain = hash(floor(rp*90.));
        // Marcas viales: discontinua central y líneas de borde, gastadas.
        float dash = step(.5, fract(rp.x*.18)) * (1.-smoothstep(.06,.09,abs(p.y+2.35)));
        float edge = (1.-smoothstep(.03,.05,abs(abs(p.y-0.6)-4.6)))*.6;
        float paint = (dash + edge) * (.55 + .45*vnoise(rp*3.));
        vec3 col = vec3(.012,.013,.017) + grain*.012 + uTint*.05;
        col += paint * vec3(.045,.045,.043);

        // Reflejos alargados de las luces de la ciudad sobre el asfalto mojado.
        vec2 fc = gl_FragCoord.xy / uRes;
        vec3 streak = vec3(0.);
        for(int i=0;i<${MAX_STREAKS};i++){
          vec3 s = uStreakPos[i];
          if(s.z <= 0.) continue;
          float dx = (fc.x - s.x) * (uRes.x/uRes.y);
          float below = s.y - fc.y;
          float w = .006 + .02*clamp(below,0.,1.);
          float h = exp(-dx*dx/(w*w)) * smoothstep(-.02,.06,below) * exp(-below*1.6);
          streak += uStreakCol[i] * h * s.z;
        }
        float broken = .35 + .65*vnoise(vec2(rp.x*1.5, rp.y*14.) + uTime*.6);
        col += streak * broken * (.25 + .9*puddle) * uWet;

        float alpha = mix(.94, .58, puddle*uWet);
        float fog = 1. - exp(-uFogDensity*uFogDensity*vDepth*vDepth);
        col = mix(col, uFogColor, fog);
        alpha = mix(alpha, 1., fog);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}

export function buildContactShadow() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 64, 4, 128, 64, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.95)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 2.9),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.004;
  m.renderOrder = 3;
  return m;
}

export function buildRain(count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 22;
    const y = Math.random() * 9;
    const z = (Math.random() - 0.5) * 22;
    const r = Math.random();
    for (let k = 0; k < 2; k++) {
      const o = i * 2 + k;
      pos.set([x, y, z], o * 3);
      seed[o] = r;
      end[o] = k;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const uniforms = { uTime: { value: 0 }, uAmount: { value: 1 }, uWind: { value: 0.12 }, uCenter: { value: new THREE.Vector3() } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSeed; attribute float aEnd;
      uniform float uTime, uWind; uniform vec3 uCenter;
      varying float vA; varying float vEnd;
      void main(){
        vec3 p = position;
        float speed = 7. + aSeed*5.;
        p.y = mod(p.y - uTime*speed, 9.);
        p.x = uCenter.x + mod(p.x - uCenter.x + 11., 22.) - 11.;
        p.z = uCenter.z + mod(p.z - uCenter.z + 11., 22.) - 11.;
        float len = .18 + aSeed*.22;
        p.y += aEnd*len;
        p.x += aEnd*len*uWind;
        vec4 mv = modelViewMatrix * vec4(p,1.);
        vA = smoothstep(18.,2.,-mv.z) * smoothstep(0.,.6,p.y);
        vEnd = aEnd;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAmount; varying float vA; varying float vEnd;
      void main(){ gl_FragColor = vec4(vec3(.62,.72,.9) * vA * uAmount * (.25 + .5*vEnd), 1.); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  return { mesh: lines, uniforms };
}

const PALETTE = ['#ffb35c', '#ffd9a0', '#f2f4ff', '#ff3348', '#53c6ff', '#ff4fa3', '#ffb35c', '#ffe6c4'];

export function buildBokeh(count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 16 + Math.random() * 30;
    pos.set([Math.cos(a) * r, 0.4 + Math.pow(Math.random(), 1.8) * 9, Math.sin(a) * r], i * 3);
    c.set(PALETTE[(Math.random() * PALETTE.length) | 0]);
    col.set([c.r, c.g, c.b], i * 3);
    size[i] = 0.5 + Math.random() * 1.6;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const uniforms = { uScale: { value: 300 }, uBright: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    vertexShader: /* glsl */ `
      attribute float aSize; uniform float uScale; varying vec3 vC; varying float vF;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position,1.);
        gl_PointSize = aSize * uScale / -mv.z;
        vC = color; vF = smoothstep(60.,16.,-mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBright; varying vec3 vC; varying float vF;
      void main(){
        float d = length(gl_PointCoord-.5)*2.;
        float disc = smoothstep(1.,.78,d) * (.55 + .45*smoothstep(.55,.95,d));
        gl_FragColor = vec4(vC * disc * .32 * vF * uBright, 1.);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = 1;
  return { mesh: pts, uniforms };
}

// Letreros verticales de neón (kanji dibujados en canvas con resplandor).
const SIGNS = [
  { text: '夜走', color: '#ff2f6d', a: 2.45, r: 27, y: 3.6 },
  { text: '高速', color: '#46c2ff', a: 3.5, r: 30, y: 4.4 },
  { text: '湾岸', color: '#ffb347', a: 4.3, r: 26, y: 3.4 },
  { text: '整備', color: '#ff2f3f', a: 0.5, r: 28, y: 3.8 },
  { text: '月夜', color: '#9a7dff', a: 5.35, r: 31, y: 4.8 },
  { text: '駐車', color: '#46c2ff', a: 1.55, r: 27, y: 3.4 },
];

function signTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, 128, 384);
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeRect(14, 14, 100, 356);
  g.font = "800 92px 'Shippori Mincho B1', serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.shadowBlur = 24;
  [...text].forEach((ch, i) => g.fillText(ch, 64, 112 + i * 160));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSigns() {
  const group = new THREE.Group();
  const lights = [];
  for (const s of SIGNS) {
    const mat = new THREE.MeshBasicMaterial({
      map: signTexture(s.text, s.color),
      color: new THREE.Color(s.color).lerp(new THREE.Color('#ffffff'), 0.35),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.5,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 3.3), mat);
    m.position.set(Math.cos(s.a) * s.r, s.y, Math.sin(s.a) * s.r);
    m.lookAt(0, s.y * 0.6, 0);
    m.renderOrder = 1;
    group.add(m);
    lights.push({ pos: m.position.clone().setY(s.y - 1.1), color: new THREE.Color(s.color), strength: 0.9 });
  }
  return { group, lights };
}

export function buildSkyline() {
  const count = 46;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFogColor: { value: new THREE.Color('#05070d') } },
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
        vec2 cell = floor(vec2(u*1.6, vW.y*2.2));
        vec2 f = fract(vec2(u*1.6, vW.y*2.2));
        float win = step(.25,f.x)*step(f.x,.75)*step(.3,f.y)*step(f.y,.75);
        float lit = step(.93, hash(cell + floor(vW.xz*.1)));
        vec3 warm = mix(vec3(1.,.62,.3), vec3(.75,.85,1.), step(.5, hash(cell*.7)));
        vec3 col = vec3(.004,.005,.009) + win*lit*warm*.26*(1.-abs(vN.y));
        // Bruma de ciudad: el pie de los edificios se pierde en la luz de la calle.
        float haze = exp(-max(vW.y,0.)*.11);
        col = mix(col, vec3(.05,.037,.06), haze*.6);
        float fog = 1. - exp(-.00035*vD*vD);
        gl_FragColor = vec4(mix(col, uFogColor, fog*.6), 1.);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const tops = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.1;
    const r = 48 + Math.random() * 26;
    const h = 9 + Math.pow(Math.random(), 1.5) * 34;
    const w = 4 + Math.random() * 7;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(w, h, w * 0.8));
    mesh.setMatrixAt(i, m);
    if (h > 18) tops.push(Math.cos(a) * r, h + 0.4, Math.sin(a) * r);
  }
  mesh.frustumCulled = false;

  // Balizas rojas de azotea, cada una con su propio ritmo de parpadeo.
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(tops, 3));
  bg.setAttribute('aPhase', new THREE.Float32BufferAttribute(tops.filter((_, i) => i % 3 === 0).map(() => Math.random() * 6.28), 1));
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
          gl_PointSize = 1.4 * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vOn;
        void main(){
          float d = length(gl_PointCoord-.5)*2.;
          float g = exp(-d*d*6.) + .6*exp(-d*d*60.);
          gl_FragColor = vec4(vec3(1.,.08,.12) * g * vOn, 1.);
        }`,
    })
  );
  beacons.renderOrder = 1;
  return { mesh, uniforms: mat.uniforms, beacons, beaconUniforms };
}

export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color('#03040a') }, uHorizon: { value: new THREE.Color('#171221') } },
    vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon; varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        vec3 c = mix(uHorizon, uTop, smoothstep(-.02,.35,h));
        gl_FragColor = vec4(c,1.);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(110, 24, 12), mat);
  m.renderOrder = -1;
  return { mesh: m, uniforms: mat.uniforms };
}

export const LAMP_SPACING = 16;

/** Farolas de sodio a ambos lados de la calzada; se desplazan con la velocidad. */
export function buildStreetLamps() {
  const parts = [];
  const heads = [];
  const count = 9;
  for (const side of [1, -1]) {
    for (let i = 0; i < count; i++) {
      const x = -64 + i * LAMP_SPACING + (side > 0 ? LAMP_SPACING / 2 : 0);
      const z = side * 7.6;
      const pole = new THREE.CylinderGeometry(0.05, 0.07, 6.4, 6);
      pole.translate(x, 3.2, z);
      const arm = new THREE.BoxGeometry(0.08, 0.06, 1.7);
      arm.translate(x, 6.35, z - side * 0.85);
      const head = new THREE.BoxGeometry(0.5, 0.1, 0.22);
      head.translate(x, 6.3, z - side * 1.65);
      parts.push(pole, arm, head);
      heads.push(x, 6.18, z - side * 1.65);
    }
  }
  const group = new THREE.Group();
  const posts = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshStandardMaterial({ color: '#0a0b0e', roughness: 0.6, metalness: 0.5 })
  );
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(heads, 3));
  const glows = new THREE.Points(
    hg,
    new THREE.PointsMaterial({
      map: getGlowTexture(),
      color: new THREE.Color('#ffae57').multiplyScalar(1.2),
      size: 3.2,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.8,
    })
  );
  glows.renderOrder = 1;
  group.add(posts, glows);
  return group;
}
