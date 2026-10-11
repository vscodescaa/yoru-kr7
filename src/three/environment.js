import * as THREE from 'three';

/*
 * Mapa de entorno para los reflejos del coche: una HDRI nocturna real (Shanghai Bund,
 * Poly Haven, CC0) atenuada, más softboxes y tubos de neón que dibujan la línea de
 * hombros y el techo como en una sesión de fotografía nocturna.
 */

const hot = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

export function buildEnvironmentMap(renderer, hdr) {
  const env = new THREE.Scene();
  env.background = new THREE.Color('#000000');
  if (hdr) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(30, 64, 32),
      new THREE.MeshBasicMaterial({ map: hdr, side: THREE.BackSide, color: hot('#ffffff', 0.55) })
    );
    dome.rotation.y = Math.PI * 0.35;
    env.add(dome);
  }
  const add = (w, h, color, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(look ?? new THREE.Vector3(0, 0.6, 0));
    env.add(m);
    return m;
  };
  // Softbox cenital largo: la línea blanca que recorre techo y capó.
  add(9, 0.5, hot('#ffffff', 4), new THREE.Vector3(0, 6, 0.8), new THREE.Vector3(0, 0, 0.8));
  add(9, 0.22, hot('#dfe8ff', 2.4), new THREE.Vector3(0, 5.5, -1.6), new THREE.Vector3(0, 0, -1.6));
  // Tubos de neón.
  add(0.16, 5, hot('#3aa6ff', 4), new THREE.Vector3(-3.5, 2.5, -6));
  add(0.16, 4, hot('#ff2a8a', 2.6), new THREE.Vector3(4.5, 2.2, -6.5));
  add(7, 0.14, hot('#ff2030', 1.8), new THREE.Vector3(1, 0.7, 7));
  // Bandas laterales tenues para el costado de la carrocería.
  add(12, 1.2, hot('#8fa6d8', 0.6), new THREE.Vector3(0, 1.1, -7));
  add(12, 1.2, hot('#d8a27a', 0.5), new THREE.Vector3(0, 1.1, 7));
  // Asfalto mojado: suelo oscuro pero no negro, refleja algo del cielo.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshBasicMaterial({ color: hot('#1a1820', 0.6) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  env.add(floor);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.012);
  pmrem.dispose();
  env.traverse((o) => {
    o.geometry?.dispose();
    if (o.material && o.material.map !== hdr) o.material.dispose();
  });
  return rt.texture;
}

const PALETTE = ['#ffb35c', '#ffd9a0', '#f2f4ff', '#ff3348', '#53c6ff', '#ff4fa3', '#ffb35c', '#ffe6c4'];

/** Luces lejanas desenfocadas: dan profundidad de campo a los fondos. */
export function buildBokeh(count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 30 + Math.random() * 40;
    pos.set([Math.cos(a) * r, 0.6 + Math.pow(Math.random(), 1.8) * 14, Math.sin(a) * r], i * 3);
    c.set(PALETTE[(Math.random() * PALETTE.length) | 0]);
    col.set([c.r, c.g, c.b], i * 3);
    size[i] = 0.6 + Math.random() * 1.8;
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
        vC = color; vF = smoothstep(80.,26.,-mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBright; varying vec3 vC; varying float vF;
      void main(){
        float d = length(gl_PointCoord-.5)*2.;
        float disc = smoothstep(1.,.8,d) * (.55 + .45*smoothstep(.55,.95,d));
        gl_FragColor = vec4(vC * disc * .4 * vF * uBright, 1.);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = 1;
  return { mesh: pts, uniforms };
}

export function buildContactShadow() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 64, 4, 128, 64, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.9)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.6)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(5.4, 2.6),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.006;
  m.renderOrder = 3;
  return m;
}
