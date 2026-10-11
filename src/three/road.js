import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Calle mojada. La calzada va a lo largo de X y se circula por la izquierda, como en
 * Japón: el coche ocupa el carril z ≈ 0 y la línea central queda a su derecha (+z).
 * El asfalto es un MeshStandardMaterial con textura escaneada (Poly Haven, CC0) al que
 * se le inyectan charcos, ondas de lluvia y el reflejo planar mezclado por Fresnel.
 */

export const STREET = {
  curbNear: -5.2, // bordillo del lado -z
  curbFar: 8.8, // bordillo del lado +z
  centre: 1.8,
  sidewalkH: 0.14,
  lampNear: -8.4,
  lampFar: 12.4,
  lampSpacing: 18,
  buildNear: -13.5,
  buildFar: 16.5,
};

export const NOISE = /* glsl */ `
  float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
  }
  float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.03; a*=.5; } return v; }
`;

const RIPPLES = /* glsl */ `
  // Gotas cayendo en los charcos: anillos que se expanden por celdas aleatorias.
  vec2 rippleLayer(vec2 uv, float t, float seed){
    vec2 cell = floor(uv);
    vec2 f = fract(uv) - .5;
    float h = hash(cell + seed);
    vec2 o = (vec2(hash(cell + seed + 1.3), hash(cell + seed + 2.7)) - .5) * .5;
    vec2 d = f - o;
    float r = length(d);
    float ph = fract(t * (.9 + h * .6) + h);
    float R = ph * .42;
    float x = (r - R) * 34.;
    float ring = sin(clamp(x, -3.1416, 3.1416)) * step(abs(x), 3.1416);
    float amp = (1. - ph) * (1. - ph);
    return d / max(r, 1e-3) * ring * amp;
  }
  vec2 ripples(vec2 p, float t){
    return rippleLayer(p * 2.2, t, 0.) + rippleLayer(p * 2.9 + 7.1, t * 1.13, 3.) * .8;
  }
`;

export function buildRoadMaterial({ data, normal, reflector, sidewalk = false, quality }) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.4,
    metalness: 0,
    envMapIntensity: 0.12,
  });
  const uniforms = {
    tData: { value: data },
    tNormal: { value: normal },
    tReflect: { value: reflector.rt.texture },
    uTexMatrix: { value: reflector.textureMatrix },
    uRoad: { value: 0 },
    uTime: { value: 0 },
    uWet: { value: 1 },
    uRefl: { value: reflector.enabled ? 1 : 0 },
    uSidewalk: { value: sidewalk ? 1 : 0 },
  };
  mat.userData.uniforms = uniforms;
  const taps = quality === 'low' ? 2 : 4;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vWorldP;
        uniform sampler2D tData, tNormal, tReflect;
        uniform mat4 uTexMatrix;
        uniform float uRoad, uTime, uWet, uRefl, uSidewalk;
        ${NOISE}
        ${RIPPLES}
        float gPuddle, gPaint, gRough;
        vec3 gWorldN;
        `
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 wp = vec2(vWorldP.x + uRoad, vWorldP.z);
        vec2 tuv = vec2(wp.x, -wp.y) / 3.2;
        vec3 tdat = texture2D(tData, tuv).rgb;
        vec3 tdat2 = texture2D(tData, tuv * .23 + .37).rgb;
        float lum = tdat.r * (.75 + .5 * tdat2.r);
        float z = vWorldP.z;
        float paint = 0.;
        vec3 paintCol = vec3(.85);
        if (uSidewalk < .5) {
          // Marcas viales gastadas: divisoria discontinua, línea central amarilla y bordes.
          float dash = step(.55, fract(wp.x / 8.)) ;
          paint += dash * (1. - smoothstep(.06, .08, abs(z + 1.6)));
          paint += dash * (1. - smoothstep(.06, .08, abs(z - 5.3)));
          float centre = (1. - smoothstep(.05, .07, abs(z - ${STREET.centre.toFixed(2)} - .11))) + (1. - smoothstep(.05, .07, abs(z - ${STREET.centre.toFixed(2)} + .11)));
          paint += centre;
          paint += (1. - smoothstep(.07, .09, abs(z - ${(STREET.curbNear + 0.35).toFixed(2)})));
          paint += (1. - smoothstep(.07, .09, abs(z - ${(STREET.curbFar - 0.35).toFixed(2)})));
          paintCol = mix(vec3(.82), vec3(.95, .62, .12), step(.5, centre));
          paint = clamp(paint, 0., 1.) * smoothstep(.25, .55, vnoise(wp * 4.) * .6 + tdat.r * .9);
        }
        // Charcos: más en las juntas con el bordillo y en las rodadas, nunca sobre la pintura.
        float pn = fbm(wp * .21 + 3.1);
        float edgeBias = sidewalkBias();
        float puddle = smoothstep(.48, .62, pn + edgeBias + (tdat2.r - .5) * .25) * (1. - paint * .8);
        gPuddle = puddle * uWet;
        gPaint = paint;
        vec3 base = mix(vec3(.06, .062, .07), vec3(.11, .11, .115), uSidewalk) * (.55 + lum * 1.1);
        if (uSidewalk > .5) {
          vec2 g = abs(fract(wp / .6) - .5);
          base *= .8 + .2 * smoothstep(.47, .43, max(g.x, g.y));
        }
        base = mix(base, paintCol * .55, paint);
        // Mojado: el asfalto se oscurece y satura.
        base *= mix(1., .55, uWet);
        base *= mix(1., .5, gPuddle);
        diffuseColor.rgb *= base;
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = mix(.25 + tdat.g * .45, .52 + tdat.g * .4, 1. - uWet);
        roughnessFactor = mix(roughnessFactor, .32, gPaint);
        roughnessFactor = mix(roughnessFactor, .035, gPuddle);
        gRough = roughnessFactor;
        `
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        vec3 tn = texture2D(tNormal, tuv).xyz * 2. - 1.;
        tn.xy *= mix(1.1, .15, gPuddle);
        vec2 rp = ripples(wp, uTime) * gPuddle * .3;
        tn.xy += rp;
        // Plano horizontal: u -> +x, v -> -z.
        gWorldN = normalize(vec3(tn.x, tn.z, -tn.y));
        normal = normalize((viewMatrix * vec4(gWorldN, 0.)).xyz);
        `
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        if (uRefl > 0.) {
          vec4 rc = uTexMatrix * vec4(vWorldP, 1.);
          vec2 ruv = rc.xy / rc.w + gWorldN.xz * vec2(.05, .08) * (1. - gPuddle * .6);
          float lod = mix(.0, 4.2, smoothstep(.03, .55, gRough));
          float stretch = .004 + gRough * .045;
          vec3 refl = vec3(0.);
          float wsum = 0.;
          for (int i = -${taps}; i <= ${taps}; i++) {
            float fi = float(i) / float(${taps});
            float w = exp(-fi * fi * 2.2);
            refl += textureLod(tReflect, ruv + vec2(0., fi * stretch), lod).rgb * w;
            wsum += w;
          }
          refl /= wsum;
          vec3 V = normalize(cameraPosition - vWorldP);
          float NdV = clamp(dot(gWorldN, V), 0., 1.);
          float F = .02 + .98 * pow(1. - NdV, 5.);
          float strength = mix(.45, 1., gPuddle) * uWet * mix(1., .55, uSidewalk);
          outgoingLight += refl * F * strength * uRefl;
        }
        #include <opaque_fragment>
        `
      );
    // Función auxiliar declarada antes de usarse.
    sh.fragmentShader = sh.fragmentShader.replace(
      'float gPuddle, gPaint, gRough;',
      /* glsl */ `float gPuddle, gPaint, gRough;
      float sidewalkBias(){
        float z = vWorldP.z;
        float nearCurb = max(1. - smoothstep(0., .9, z - ${STREET.curbNear.toFixed(2)}), 1. - smoothstep(0., .9, ${STREET.curbFar.toFixed(2)} - z));
        float tracks = 1. - smoothstep(.2, .5, abs(abs(z) - .78));
        return (nearCurb * .22 + tracks * .07) * (1. - uSidewalk) - uSidewalk * .12;
      }`
    );
  };
  mat.customProgramCacheKey = () => `road-${sidewalk ? 1 : 0}-${taps}`;
  return mat;
}

export function buildStreet({ data, normal, reflector, quality }) {
  const group = new THREE.Group();
  const roadMat = buildRoadMaterial({ data, normal, reflector, quality });
  const walkMat = buildRoadMaterial({ data, normal, reflector, sidewalk: true, quality });

  const road = new THREE.Mesh(new THREE.PlaneGeometry(260, STREET.curbFar - STREET.curbNear + 0.4), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.z = (STREET.curbFar + STREET.curbNear) / 2;
  group.add(road);

  const walkW = 14;
  const walks = [
    [STREET.curbNear - walkW / 2, walkW],
    [STREET.curbFar + walkW / 2, walkW],
  ].map(([z, w]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(260, w), walkMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, STREET.sidewalkH, z);
    group.add(m);
    return m;
  });

  // Bordillos de hormigón.
  const curbMat = new THREE.MeshStandardMaterial({ color: '#2a2b2f', roughness: 0.35, metalness: 0, envMapIntensity: 0.4 });
  for (const z of [STREET.curbNear - 0.09, STREET.curbFar + 0.09]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(260, STREET.sidewalkH, 0.18), curbMat);
    c.position.set(0, STREET.sidewalkH / 2, z);
    group.add(c);
  }

  return { group, materials: [roadMat, walkMat], road, walks };
}

/*
 * Farolas de sodio: postes, brazos, luminarias, conos volumétricos de luz en la lluvia
 * y un puñado de PointLight reales que se reasignan a las farolas más cercanas.
 */
export function buildLamps({ quality }) {
  const S = STREET.lampSpacing;
  const group = new THREE.Group(); // se desplaza con el viaje
  const parts = [];
  const lenses = [];
  const heads = [];
  const rows = 8;
  for (const side of [-1, 1]) {
    const z = side < 0 ? STREET.lampNear : STREET.lampFar;
    const reach = side < 0 ? 3.0 : -3.0; // el brazo apunta hacia la calzada
    for (let i = -rows; i <= rows; i++) {
      const x = i * S + (side > 0 ? S / 2 : 0);
      const pole = new THREE.CylinderGeometry(0.06, 0.09, 6.6, 8);
      pole.translate(x, 3.3, z);
      const base = new THREE.CylinderGeometry(0.16, 0.18, 0.5, 8);
      base.translate(x, 0.25, z);
      // Brazo curvo: tubo sobre un arco.
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(x, 6.2, z),
        new THREE.Vector3(x, 6.85, z),
        new THREE.Vector3(x, 6.75, z + reach)
      );
      const arm = new THREE.TubeGeometry(curve, 10, 0.045, 6, false);
      const head = new THREE.BoxGeometry(0.62, 0.12, 0.3);
      head.translate(x, 6.7, z + reach);
      parts.push(pole, base, arm, head);
      const lens = new THREE.PlaneGeometry(0.5, 0.22);
      lens.rotateX(Math.PI / 2);
      lens.translate(x, 6.635, z + reach);
      lenses.push(lens);
      heads.push(new THREE.Vector3(x, 6.6, z + reach));
    }
  }
  const metal = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.45, metalness: 0.7, envMapIntensity: 0.8 });
  const posts = new THREE.Mesh(mergeGeometries(parts), metal);
  const sodium = new THREE.Color('#ffa24c');
  const lensMesh = new THREE.Mesh(
    mergeGeometries(lenses),
    new THREE.MeshBasicMaterial({ color: sodium.clone().multiplyScalar(14), side: THREE.DoubleSide, fog: false })
  );
  group.add(posts, lensMesh);

  // Conos de luz: solo se ven donde hay lluvia y bruma que los atraviesa.
  const coneGeo = new THREE.CylinderGeometry(0.22, 2.7, 6.5, 32, 8, true);
  coneGeo.translate(0, -3.25, 0);
  const coneUniforms = { uTime: { value: 0 }, uColor: { value: sodium.clone().multiplyScalar(0.55) } };
  const coneMat = new THREE.ShaderMaterial({
    uniforms: coneUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW; varying float vCam;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.);
        // Con la cámara dentro o pegada al cono, el haz llenaría la pantalla: se apaga.
        vec3 apex = (modelMatrix * vec4(0., 0., 0., 1.)).xyz;
        vCam = smoothstep(2.6, 6.5, length(cameraPosition.xz - apex.xz));
        vW = w.xyz;
        vH = -position.y / 6.5;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor;
      varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW; varying float vCam;
      ${NOISE}
      void main(){
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float soft = pow(facing, 1.6);
        float fall = pow(1. - vH, 1.6) * smoothstep(0., .08, vH) * smoothstep(1., .82, vH);
        float rain = .75 + .25 * vnoise(vec2(vW.x * 9. + vW.z * 9., vW.y * 1.4 + uTime * 9.));
        gl_FragColor = vec4(uColor * soft * fall * rain * .3 * vCam, 1.);
      }`,
  });
  const cones = heads.map((h) => {
    const c = new THREE.Mesh(coneGeo, coneMat);
    c.position.copy(h);
    c.renderOrder = 6;
    group.add(c);
    return c;
  });

  // Luces reales: unas pocas por lado, reasignadas a las farolas más cercanas.
  const perSide = quality === 'low' ? 2 : 3;
  const lights = [];
  for (let i = 0; i < perSide * 2; i++) {
    const l = new THREE.PointLight(sodium, 0, 26, 1.7);
    lights.push(l);
  }

  return { group, heads, lights, cones, coneUniforms, perSide, lensMesh, posts };
}

/** Reparte las PointLight entre las farolas más próximas al punto de interés. */
export function updateLampLights(lamps, offsetX, focusX = 0) {
  const S = STREET.lampSpacing;
  const { lights, heads, perSide } = lamps;
  let li = 0;
  for (const side of [-1, 1]) {
    const shift = side > 0 ? S / 2 : 0;
    // Índice de la farola más cercana al foco en este lado.
    const k0 = Math.round((focusX - offsetX - shift) / S);
    const ks = [];
    for (let d = -Math.floor((perSide - 1) / 2); ks.length < perSide; d++) ks.push(k0 + d);
    for (const k of ks) {
      const x = k * S + shift + offsetX;
      const h = heads.find((p) => Math.abs(p.x - (k * S + shift)) < 0.01 && Math.sign(p.z - 2) === side);
      const l = lights[li++];
      if (!h) {
        l.intensity = 0;
        continue;
      }
      l.position.set(x, h.y - 0.25, h.z);
      // Atenuación suave al entrar y salir del grupo activo: sin saltos de luz.
      const d = Math.abs(x - focusX) / (S * (perSide * 0.5 + 0.1));
      l.userData.w = Math.max(0, 1 - d * d);
    }
  }
}
