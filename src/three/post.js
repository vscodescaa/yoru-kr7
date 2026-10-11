import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

/*
 * Cadena de postprocesado en HDR lineal: escena → bloom → lente (viñeta, aberración
 * cromática en los bordes y grano) → tone mapping y sRGB.
 */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uAberration: { value: 0.006 },
    uGrain: { value: 0.035 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uAberration, uGrain; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
    void main(){
      vec2 c = vUv - .5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uAberration;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + off).b;
      float vig = 1. - uVignette * smoothstep(.12, .75, r2 * 1.6);
      col *= vig;
      // Grano proporcional a la luminancia baja, como en un sensor a ISO alto.
      float g = hash(vUv * uRes + fract(uTime * 13.7) * 100.) - .5;
      float l = dot(col, vec3(.299, .587, .114));
      col += g * uGrain * (.35 + .65 * (1. - smoothstep(0., .6, l))) * .25;
      gl_FragColor = vec4(max(col, 0.), 1.);
    }`,
};

/*
 * Profundidad de campo por recolección (32 muestras en espiral áurea) a partir del
 * búfer de profundidad, y el titular "KR-7" compuesto encima: nítido, ocultado por
 * todo lo que esté por delante de él en la escena.
 */
const DofShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 400 },
    uFocus: { value: 7 },
    uAperture: { value: 1 },
    uMaxCoc: { value: 12 },
    uRes: { value: new THREE.Vector2(1, 1) },
    tTitle: { value: null },
    uTitleRect: { value: new THREE.Vector4() },
    uTitleDepth: { value: 24 },
    uReveal: { value: 0 },
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color('#e9ebf2') },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    #define TAPS 32
    uniform sampler2D tDiffuse, tDepth, tTitle;
    uniform float uNear, uFar, uFocus, uAperture, uMaxCoc, uTitleDepth, uReveal, uOpacity;
    uniform vec2 uRes; uniform vec4 uTitleRect; uniform vec3 uColor;
    varying vec2 vUv;
    float lin(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
    float coc(float z){ return clamp(uAperture * abs(z - uFocus) / max(z, .05), 0., 1.) * uMaxCoc; }
    void main(){
      float zc = lin(vUv);
      float cc = coc(zc);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (uAperture > 0.) {
        vec3 acc = col;
        float wsum = 1.;
        for (int i = 0; i < TAPS; i++) {
          float fi = float(i);
          float r = sqrt((fi + .5) / float(TAPS)) * uMaxCoc;
          float a = fi * 2.39996;
          vec2 uv2 = vUv + vec2(cos(a), sin(a)) * r / uRes;
          float z2 = lin(uv2);
          float c2 = coc(z2);
          // Lo que está detrás no puede desbordarse sobre lo enfocado.
          if (z2 > zc) c2 = min(c2, cc);
          float w = smoothstep(r - 1.5, r + .5, c2);
          acc += texture2D(tDiffuse, uv2).rgb * w;
          wsum += w;
        }
        col = acc / wsum;
      }
      // Titular en profundidad: detrás del coche, delante de la ciudad.
      vec2 tuv = (vUv - uTitleRect.xy) / (uTitleRect.zw - uTitleRect.xy);
      if (uOpacity > .002 && tuv.x > 0. && tuv.x < 1. && tuv.y > 0. && tuv.y < 1. && zc > uTitleDepth) {
        float ta = texture2D(tTitle, tuv).a;
        float edge = abs(tuv.x - .5) * 2.;
        float m = smoothstep(edge - .04, edge, uReveal * 1.04);
        float shade = mix(.35, 1., smoothstep(.1, .85, tuv.y));
        col = mix(col, uColor * shade * .85, ta * m * uOpacity * .92);
      }
      gl_FragColor = vec4(col, 1.);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.dof = new ShaderPass(DofShader);
    this.dof.uniforms.uNear.value = camera.near;
    this.dof.uniforms.uFar.value = camera.far;
    // Cada búfer del compositor tiene su propia profundidad: se lee la del de entrada.
    const dofRender = this.dof.render.bind(this.dof);
    this.dof.render = (r, write, read, dt, mask) => {
      this.dof.uniforms.tDepth.value = read.depthTexture;
      dofRender(r, write, read, dt, mask);
    };
    this.composer.addPass(this.dof);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.5, 1.6);
    this.composer.addPass(this.bloom);
    this.lens = new ShaderPass(LensShader);
    this.composer.addPass(this.lens);
    this.composer.addPass(new OutputPass());
    // El bloom suma sobre el búfer de entrada: con MSAA three lo invalida al resolver, así que el antialiasing va al final.
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);
    this.bloomScale = quality === 'low' ? 0.35 : 0.5;
  }

  setSize(w, h, dpr) {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.setSize(Math.round(w * dpr * this.bloomScale), Math.round(h * dpr * this.bloomScale));
    this.lens.uniforms.uRes.value.set(w * dpr, h * dpr);
    this.dof.uniforms.uRes.value.set(w * dpr, h * dpr);
    this.dof.uniforms.uMaxCoc.value = Math.min(16, 11 * (h * dpr) / 900);
  }

  render(dt, time) {
    this.lens.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
