import * as THREE from 'three';
import { Car } from './car.js';
import {
  buildEnvironmentMap, buildGround, buildContactShadow, buildRain, buildBokeh,
  buildSigns, buildSkyline, buildSky, buildStreetLamps, LAMP_SPACING, MAX_STREAKS,
} from './environment.js';

const FOG = new THREE.Color('#05070d');

/** Elige un nivel de calidad inicial con lo que el navegador deja saber. */
export function detectQuality() {
  const params = new URLSearchParams(location.search);
  if (params.get('q')) return params.get('q');
  const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
  if (mobile) return 'low';
  return 'high';
}

export class Stage {
  constructor(canvas, quality) {
    this.quality = quality;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.maxDpr = Math.min(devicePixelRatio || 1, quality === 'low' ? 1.25 : 1.5);
    this.minDpr = 0.6;
    this.dpr = Math.min(devicePixelRatio || 1, quality === 'low' ? 1 : 1.25);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.scene = new THREE.Scene();
    this.scene.background = FOG.clone();
    this.scene.fog = new THREE.FogExp2(FOG, 0.045);
    this.scene.environment = buildEnvironmentMap(this.renderer);
    this.scene.environmentIntensity = 1;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 220);
    this.scene.add(this.camera);

    // Luces directas: una cenital fría y un contraluz que cambia de color por capítulo.
    this.key = new THREE.DirectionalLight('#cfdcff', 1.2);
    this.key.position.set(2, 8, 3);
    this.rim = new THREE.PointLight('#ff2a3a', 0, 14, 1.6);
    this.rim.position.set(-4, 1.4, -1.5);
    this.scene.add(this.key, this.rim);

    this.sky = buildSky();
    this.skyline = buildSkyline();
    this.bokeh = buildBokeh(quality === 'low' ? 90 : 160);
    this.signs = buildSigns();
    this.ground = buildGround();
    this.rain = buildRain(quality === 'low' ? 700 : 1600);
    this.shadow = buildContactShadow();
    this.lamps = buildStreetLamps();
    this.scene.add(
      this.sky.mesh, this.skyline.mesh, this.skyline.beacons, this.bokeh.mesh, this.signs.group,
      this.lamps, this.ground.mesh, this.rain.mesh, this.shadow
    );

    this.streakSources = [
      ...this.signs.lights,
      ...[0.2, 1.1, 2.0, 2.9, 3.8, 4.7].map((a) => ({
        pos: new THREE.Vector3(Math.cos(a) * 15, 5.5, Math.sin(a) * 15),
        color: new THREE.Color('#ffa24a'),
        strength: 0.55,
      })),
    ].slice(0, MAX_STREAKS);
    this.signBase = this.signs.group.children.map((m) => m.position.clone());

    this.car = new Car({ quality });
    this.scene.add(this.car.root);
    this.reflections = quality !== 'low';
    this.refreshMirror();

    this.#buildTitle();

    this.road = 0;
    this.time = 0;
    this.envYaw = 0;
    this.running = true;
    this.frameTimes = [];
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.onQuality = null;
    this.tmp = new THREE.Vector3();

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Reflejo en el asfalto: un clon espejado que comparte geometrías y materiales. */
  refreshMirror() {
    if (this.mirror) this.mirror.removeFromParent();
    this.mirror = null;
    if (!this.reflections) return;
    const m = this.car.root.clone();
    m.scale.y = -1;
    // En el asfalto mojado no se ve el chasis ni los bajos: solo carrocería y luz.
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    m.traverse((o) => {
      if (o.isSprite) {
        o.renderOrder = 1;
        o.scale.y *= 1.8;
      }
      if (o.userData.noMirror) o.visible = false;
    });
    const body = m.children[0].children[0];
    body.material = [body.material[0], body.material[1], hidden];
    this.scene.add(m);
    this.mirror = m;
    this.mirrorBody = m.children[0];
    this.mirrorSpins = m.children.slice(1).map((g) => g.children[0]);
  }

  setReflections(on) {
    this.reflections = on;
    this.refreshMirror();
  }

  #buildTitle() {
    // El titular vive en WebGL, detrás del coche: el coche lo tapa como en una portada.
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 512;
    this.titleCanvas = c;
    this.titleTex = new THREE.CanvasTexture(c);
    this.titleTex.colorSpace = THREE.SRGBColorSpace;
    this.titleUniforms = {
      uMap: { value: this.titleTex },
      uReveal: { value: 0 },
      uOpacity: { value: 1 },
      uColor: { value: new THREE.Color('#e9ebf2') },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.titleUniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform float uReveal, uOpacity; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          float a = texture2D(uMap, vUv).a;
          float edge = abs(vUv.x - .5)*2.;
          float m = smoothstep(edge-.04, edge, uReveal*1.04);
          float shade = mix(.35, 1., smoothstep(.1,.85,vUv.y));
          gl_FragColor = vec4(uColor*shade, a*m*uOpacity*.92);
        }`,
    });
    this.title = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.25), mat);
    this.title.renderOrder = 0;
    this.title.position.z = -24;
    this.camera.add(this.title);
    this.titleLayout = { y: 0.2, width: 0.94, stretch: 1, lift: 0 };
    this.drawTitle('KR-7');
  }

  drawTitle(text) {
    const g = this.titleCanvas.getContext('2d');
    g.clearRect(0, 0, 2048, 512);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = "ultra-expanded 800 400px 'Archivo Variable', 'Archivo', sans-serif";
    if ('fontStretch' in g) g.fontStretch = 'ultra-expanded';
    g.letterSpacing = '-10px';
    g.fillText(text, 1024, 440);
    this.titleTex.needsUpdate = true;
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const px = this.renderer.getPixelRatio();
    this.ground.uniforms.uRes.value.set(w * px, h * px);
    this.bokeh.uniforms.uScale.value = h * px * 0.5;
    this.skyline.beaconUniforms.uScale.value = h * px * 0.5;
  }

  /** Tamaño de búfer temporal para capturas con proporción fija (resize() lo restaura). */
  captureSize(w, h) {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.ground.uniforms.uRes.value.set(w, h);
    this.bokeh.uniforms.uScale.value = h * 0.5;
  }

  restoreSize() {
    this.renderer.setPixelRatio(this.dpr);
    this.resize();
  }

  setDpr(v) {
    this.dpr = Math.max(this.minDpr, Math.min(this.maxDpr, v));
    this.renderer.setPixelRatio(this.dpr);
    this.resize();
  }

  /** Ajuste de calidad en marcha según el tiempo real de fotograma. */
  #adapt(dt) {
    if (dt <= 0 || dt > 0.25) return; // capturas, pestaña en segundo plano o pausa
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    this.lastAvg = avg;
    if (avg > 0.021) {
      this.fastWindows = 0;
      if (this.dpr > this.minDpr + 0.01) this.setDpr(this.dpr - 0.12);
      else if (this.reflections) this.setReflections(false);
      this.onQuality?.(this.dpr, avg);
    } else if (avg < 0.0175) {
      if (++this.fastWindows >= 4 && this.dpr < this.maxDpr - 0.01) {
        this.fastWindows = 0;
        this.setDpr(this.dpr + 0.08);
        this.onQuality?.(this.dpr, avg);
      }
    } else this.fastWindows = 0;
  }

  project(v, out) {
    this.tmp.copy(v).project(this.camera);
    out.x = (this.tmp.x * 0.5 + 0.5) * innerWidth;
    out.y = (-this.tmp.y * 0.5 + 0.5) * innerHeight;
    out.visible = this.tmp.z < 1;
    return out;
  }

  /** Aplica el estado interpolado por la coreografía. */
  apply(s, dt) {
    const cam = this.camera;
    cam.position.set(s.px, s.py, s.pz);
    cam.lookAt(s.tx, s.ty, s.tz);
    let fov = s.fov;
    const aspect = cam.aspect;
    if (aspect < 1.25) {
      // En vertical se conserva el encuadre horizontal en lugar del vertical.
      const hf = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 1.35);
      fov = Math.min(72, (2 * Math.atan(Math.tan(hf / 2) / aspect) * 180) / Math.PI);
    }
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    this.car.root.rotation.y = s.yaw;
    this.renderer.toneMappingExposure = s.exposure;
    this.key.intensity = s.keyI;
    this.rim.intensity = s.rimI;
    this.rim.color.setRGB(s.rimR, s.rimG, s.rimB);
    this.car.setLights(s.head);
    this.car.setTail(s.tail);
    this.rain.uniforms.uAmount.value = s.rain;
    this.rain.uniforms.uWind.value = 0.12 + s.speed * 0.02;

    // Viaje: la carretera, las ruedas y los reflejos se mueven; el coche no.
    const d = s.speed * dt;
    this.road += d;
    this.car.spin(d);
    this.envYaw += d * 0.035;
    this.scene.environmentRotation.y = s.env + this.envYaw;
    this.ground.uniforms.uRoad.value = this.road;
    this.lamps.position.x = -(this.road % LAMP_SPACING);
    this.signs.group.children.forEach((m, i) => {
      const b = this.signBase[i];
      m.position.x = ((((b.x - this.road * 0.6) % 60) + 90) % 60) - 30;
      this.streakSources[i].pos.x = m.position.x;
    });

    // Titular en WebGL.
    const t = this.titleLayout;
    const dist = -this.title.position.z;
    const vh = 2 * dist * Math.tan((cam.fov * Math.PI) / 360);
    const vw = vh * aspect;
    const w = vw * Math.min(t.width, aspect < 1 ? 1.25 : t.width) * s.titleScale;
    this.title.scale.set(w, w, 1);
    this.title.position.y = vh * (t.y + s.titleLift);
    this.titleUniforms.uOpacity.value = s.title;
    this.title.visible = s.title > 0.002;

    if (this.mirror) {
      this.mirror.rotation.y = s.yaw;
      this.mirrorBody.position.y = this.car.body.position.y;
      this.car.wheels.forEach((wh, i) => (this.mirrorSpins[i].rotation.z = wh.spin.rotation.z));
    }
  }

  render(dt) {
    this.time += dt;
    this.ground.uniforms.uTime.value = this.time;
    this.rain.uniforms.uTime.value = this.time;
    this.skyline.beaconUniforms.uTime.value = this.time;
    this.rain.uniforms.uCenter.value.copy(this.camera.position);

    const u = this.ground.uniforms;
    this.streakSources.forEach((src, i) => {
      this.tmp.copy(src.pos).project(this.camera);
      const on = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.3 ? src.strength : 0;
      u.uStreakPos.value[i].set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5, on);
      u.uStreakCol.value[i].copy(src.color);
    });

    this.renderer.render(this.scene, this.camera);
    this.#adapt(dt);
  }
}
