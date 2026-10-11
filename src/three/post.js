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

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.55, 1.35);
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
  }

  render(dt, time) {
    this.lens.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
