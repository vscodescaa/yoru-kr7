import * as THREE from 'three';

/*
 * Lluvia: cada gota es un quad orientado a cámara y estirado según su velocidad
 * (desenfoque de movimiento). Casi no se ve en la oscuridad: brilla al cruzar la luz
 * de las farolas y de los faros, como en una fotografía nocturna real.
 */

export const MAX_RAIN_LIGHTS = 8;

const LIGHTING = /* glsl */ `
  uniform vec4 uLights[${MAX_RAIN_LIGHTS}]; // xyz posición, w intensidad
  uniform vec3 uLightCol[${MAX_RAIN_LIGHTS}];
  uniform vec3 uHeadPos; uniform vec3 uHeadDir; uniform float uHead;
  vec3 dropLight(vec3 p){
    vec3 c = vec3(.05, .06, .08);
    for (int i = 0; i < ${MAX_RAIN_LIGHTS}; i++) {
      vec3 d = p - uLights[i].xyz;
      // Cono hacia abajo: la farola ilumina sobre todo debajo de ella.
      float down = smoothstep(-.2, .7, -d.y / (length(d) + 1e-3));
      c += uLightCol[i] * uLights[i].w * down / (1. + dot(d, d) * .35);
    }
    vec3 hd = p - uHeadPos;
    float hl = length(hd);
    float cone = smoothstep(.82, .97, dot(hd / (hl + 1e-3), uHeadDir)) * smoothstep(1.5, 4., length(p - cameraPosition));
    c += vec3(.85, .9, 1.) * cone * uHead * 1.1 / (1. + hl * hl * .08);
    return c;
  }
`;

export function buildRain(count) {
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('corner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, 1, 1, -1, 1], 2));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const start = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    start.set([(Math.random() - 0.5) * 26, Math.random() * 11, (Math.random() - 0.5) * 26, Math.random()], i * 4);
  }
  quad.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 4));
  quad.instanceCount = count;

  const uniforms = {
    uTime: { value: 0 },
    uAmount: { value: 1 },
    uWind: { value: 0.12 },
    uTravel: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uLights: { value: Array.from({ length: MAX_RAIN_LIGHTS }, () => new THREE.Vector4()) },
    uLightCol: { value: Array.from({ length: MAX_RAIN_LIGHTS }, () => new THREE.Color()) },
    uHeadPos: { value: new THREE.Vector3() },
    uHeadDir: { value: new THREE.Vector3(1, 0, 0) },
    uHead: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec2 corner; attribute vec4 aStart;
      uniform float uTime, uWind, uTravel; uniform vec3 uCenter;
      varying vec2 vC; varying vec3 vLight; varying float vA;
      ${LIGHTING}
      void main(){
        float seed = aStart.w;
        float speed = 8. + seed * 4.;
        vec3 p = aStart.xyz;
        p.y = mod(p.y - uTime * speed, 11.) - .2;
        // El viaje arrastra la lluvia hacia atrás respecto al coche.
        p.x -= uTime * uTravel;
        p.x = uCenter.x + mod(p.x - uCenter.x + 13., 26.) - 13.;
        p.z = uCenter.z + mod(p.z - uCenter.z + 13., 26.) - 13.;
        vec3 vel = vec3(-uTravel - uWind * 6., -speed, uWind * 2.);
        float len = length(vel) * (1. / 30.);
        vec3 dir = normalize(vel);
        vec3 a = p;
        vec3 b = p - dir * len;
        vec3 mid = mix(a, b, corner.y);
        vec3 toCam = normalize(cameraPosition - mid);
        float dist = length(cameraPosition - mid);
        vec3 side = normalize(cross(dir, toCam));
        float w = max(.0035, dist * .0011);
        vec3 pos = mid + side * corner.x * w;
        vC = corner;
        vLight = min(dropLight(p), vec3(1.6));
        vA = smoothstep(.25, 1.8, dist) * smoothstep(24., 9., dist) * step(0., p.y) * (.004 / w);
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAmount; varying vec2 vC; varying vec3 vLight; varying float vA;
      void main(){
        float across = 1. - vC.x * vC.x;
        float along = smoothstep(0., .35, vC.y) * smoothstep(1., .7, vC.y);
        gl_FragColor = vec4(vLight * across * along * vA * uAmount * .55, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(quad, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  return { mesh, uniforms };
}

/** Salpicaduras: anillos que nacen y se apagan sobre el asfalto alrededor de la cámara. */
export function buildSplashes(count, shared) {
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) seed[i] = Math.random();
  quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  quad.instanceCount = count;
  const uniforms = { ...shared, uFocus: { value: new THREE.Vector3() } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec2 corner; attribute float aSeed;
      uniform float uTime, uTravel; uniform vec3 uFocus;
      varying vec2 vC; varying float vPh; varying vec3 vLight;
      ${LIGHTING}
      float h1(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        float rate = 1.6 + aSeed;
        float t = uTime * rate + aSeed * 7.;
        float cycle = floor(t);
        vPh = fract(t);
        float r1 = h1(cycle * 12.9 + aSeed * 78.2);
        float r2 = h1(cycle * 39.3 + aSeed * 11.7);
        vec3 p = vec3(uFocus.x + (r1 - .5) * 22. - vPh / rate * uTravel, .012, uFocus.z + (r2 - .5) * 16.);
        float size = .03 + .1 * vPh;
        vC = corner;
        vLight = dropLight(p + vec3(0., .4, 0.));
        vec3 pos = p + vec3(corner.x, 0., corner.y) * size;
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAmount; varying vec2 vC; varying float vPh; varying vec3 vLight;
      void main(){
        float r = length(vC);
        float ring = smoothstep(.7, .9, r) * smoothstep(1., .92, r);
        float dot0 = smoothstep(.35, 0., r) * smoothstep(.25, 0., vPh);
        float a = (ring * .8 + dot0 * 2.) * (1. - vPh);
        gl_FragColor = vec4(vLight * a * uAmount * .5, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(quad, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return { mesh, uniforms };
}
