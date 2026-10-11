import * as THREE from 'three';
import { Car } from './car.js';
import { Assets } from './assets.js';
import { loadCarModel } from './car-model.js';
import { buildEnvironmentMap, buildBokeh, buildContactShadow } from './environment.js';
import { buildStreet, buildLamps, updateLampLights, STREET } from './road.js';
import { buildStreetBlocks, buildSigns, buildSkyline, buildSky, buildStreetFurniture, PERIOD } from './city.js';
import { buildRain, buildSplashes, MAX_RAIN_LIGHTS } from './rain.js';
import { PlanarReflector } from './reflector.js';
import { Post } from './post.js';

const FOG = new THREE.Color('#08070d');
const SODIUM_I = 13;
const HEAD_I = 24;

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
      antialias: false, // el MSAA lo hace el render target del postprocesado
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.maxDpr = Math.min(devicePixelRatio || 1, quality === 'low' ? 1.5 : 2);
    this.minDpr = 0.7;
    this.dpr = Math.min(devicePixelRatio || 1, quality === 'low' ? 1.25 : 1.5);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.scene = new THREE.Scene();
    this.scene.background = FOG.clone();
    this.scene.fog = new THREE.FogExp2(FOG, 0.018);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
    this.scene.add(this.camera);
  }

  async load(onProgress) {
    const q = this.quality;
    const assets = new Assets(onProgress);
    const [hdr, data, normal, carGltf] = await Promise.all([
      assets.hdri('env/shanghai_bund_1k.hdr'),
      assets.texture('env/asphalt_data.jpg'),
      assets.texture('env/asphalt_normal.jpg'),
      loadCarModel(assets.base + 'models/r34.glb', assets.manager),
    ]);
    this.scene.environment = buildEnvironmentMap(this.renderer, hdr);
    this.scene.environmentIntensity = 1;
    hdr.dispose();

    // Luz de luna fría y un contraluz que cambia de color por capítulo.
    this.key = new THREE.DirectionalLight('#b9c8ff', 0.6);
    this.key.position.set(2, 8, 3);
    this.rim = new THREE.PointLight('#ff2a3a', 0, 14, 1.6);
    this.rim.position.set(-4, 1.4, -1.5);
    this.scene.add(this.key, this.rim);

    this.reflector = new PlanarReflector({ scale: q === 'low' ? 0.35 : 0.5 });
    this.reflector.enabled = true;

    this.sky = buildSky();
    this.skyline = buildSkyline(this.scene.fog);
    this.blocks = buildStreetBlocks(this.scene.fog);
    this.signs = buildSigns(this.blocks.items);
    this.city = new THREE.Group();
    this.furniture = buildStreetFurniture();
    this.city.add(this.blocks.mesh, this.signs.group, this.furniture.group);
    this.street = buildStreet({ data, normal, reflector: this.reflector, quality: q });
    this.lamps = buildLamps({ quality: q });
    this.lamps.lights.forEach((l) => this.scene.add(l));
    this.bokeh = buildBokeh(q === 'low' ? 80 : 160);
    this.rain = buildRain(q === 'low' ? 2600 : 6500);
    this.splashes = buildSplashes(q === 'low' ? 160 : 420, this.rain.uniforms);
    this.shadow = buildContactShadow();
    this.scene.add(
      this.sky.mesh, this.skyline.mesh, this.skyline.beacons, this.bokeh.mesh, this.city,
      this.street.group, this.lamps.group, this.rain.mesh, this.splashes.mesh, this.shadow
    );

    this.car = new Car(carGltf, { quality: q });
    this.scene.add(this.car.root);
    this.#buildHeadlights();

    this.reflector.hidden.push(this.street.group, this.rain.mesh, this.splashes.mesh, this.shadow);
    this.post = new Post(this.renderer, this.scene, this.camera, q);
    this.#buildTitle();

    this.road = 0;
    this.time = 0;
    this.envYaw = 0;
    this.running = true;
    this.frameTimes = [];
    this.fastWindows = 0;
    this.onQuality = null;
    this.tmp = new THREE.Vector3();
    this.headWorld = new THREE.Vector3();
    this.headDir = new THREE.Vector3();

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Faros: dos focos reales que iluminan el asfalto y la lluvia delante del coche. */
  #buildHeadlights() {
    this.heads = [];
    const anchors = this.car.headAnchors ?? [
      [2.1, 0.62, 0.62],
      [2.1, 0.62, -0.62],
    ];
    for (const [x, y, z] of anchors) {
      const s = new THREE.SpotLight('#e4ecff', 0, 48, 0.42, 0.6, 1.4);
      s.position.set(x, y, z);
      s.target.position.set(x + 10, 0, z * 1.6);
      this.car.root.add(s, s.target);
      this.heads.push(s);
    }
  }

  #buildTitle() {
    // El titular se compone en el pase de profundidad de campo: queda nítido y el coche lo tapa.
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 512;
    this.titleCanvas = c;
    this.titleTex = new THREE.CanvasTexture(c);
    this.titleTex.colorSpace = THREE.SRGBColorSpace;
    this.titleUniforms = this.post.dof.uniforms;
    this.titleUniforms.tTitle.value = this.titleTex;
    this.title = { visible: true, distance: 24 };
    this.titleLayout = { y: 0.2, width: 0.94 };
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

  #setBuffers(w, h, dpr) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, dpr);
    this.reflector.setSize(w * dpr, h * dpr);
    this.bokeh.uniforms.uScale.value = h * dpr * 0.5;
    this.skyline.beaconUniforms.uScale.value = h * dpr * 0.5;
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.#setBuffers(w, h, this.dpr);
  }

  /** Tamaño de búfer temporal para capturas con proporción fija (resize() lo restaura). */
  captureSize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.#setBuffers(w, h, 1);
  }

  restoreSize() {
    this.resize();
  }

  setDpr(v) {
    this.dpr = Math.max(this.minDpr, Math.min(this.maxDpr, v));
    this.resize();
  }

  /** Ajuste de calidad en marcha según el tiempo real de fotograma. */
  #adapt(dt) {
    if (dt <= 0 || dt > 0.25) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    this.lastAvg = avg;
    if (avg > 0.024) {
      this.fastWindows = 0;
      if (this.dpr > this.minDpr + 0.01) this.setDpr(this.dpr - 0.15);
      else if (this.reflector.scale > 0.26) {
        this.reflector.scale = 0.25;
        this.resize();
      } else if (this.post.bloom.enabled) this.post.bloom.enabled = false;
      this.onQuality?.(this.dpr, avg);
    } else if (avg < 0.0175) {
      if (++this.fastWindows >= 4 && this.dpr < this.maxDpr - 0.01) {
        this.fastWindows = 0;
        this.setDpr(this.dpr + 0.1);
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
    this.key.intensity = s.keyI * 0.5;
    this.rim.intensity = s.rimI;
    this.rim.color.setRGB(s.rimR, s.rimG, s.rimB);
    this.car.setLights(s.head);
    this.car.setTail(s.tail);
    this.heads.forEach((h) => (h.intensity = HEAD_I * s.head * s.beam));
    this.rain.uniforms.uAmount.value = s.rain;
    this.rain.uniforms.uWind.value = 0.12;
    this.rain.uniforms.uTravel.value = s.speed;

    // Viaje: la calle, las ruedas y los reflejos se mueven; el coche no.
    const d = s.speed * dt;
    this.road += d;
    this.car.spin(d);
    this.envYaw += d * 0.035;
    this.scene.environmentRotation.y = s.env + this.envYaw;
    for (const m of this.street.materials) m.userData.uniforms.uRoad.value = this.road;
    const lampOff = -(((this.road % STREET.lampSpacing) + STREET.lampSpacing) % STREET.lampSpacing);
    this.lamps.group.position.x = lampOff;
    this.city.position.x = -(((this.road % PERIOD) + PERIOD) % PERIOD);
    updateLampLights(this.lamps, lampOff, 0);

    // Titular: rectángulo en pantalla equivalente a un plano a 24 m delante de la cámara.
    const t = this.titleLayout;
    const dist = this.title.distance;
    const vh = 2 * dist * Math.tan((cam.fov * Math.PI) / 360);
    const vw = vh * aspect;
    const w = vw * Math.min(t.width, aspect < 1 ? 1.25 : t.width) * s.titleScale;
    const hw = w / vw / 2;
    const hh = (w * 0.25) / vh / 2;
    const cy = 0.5 + (vh * (t.y + s.titleLift)) / vh;
    this.titleUniforms.uTitleRect.value.set(0.5 - hw, cy - hh, 0.5 + hw, cy + hh);
    this.titleUniforms.uTitleDepth.value = dist;
    this.title.visible = s.title > 0.002;
    this.titleOpacity = s.title;

    // Enfoque sobre el centro del coche y apertura del plano.
    this.tmp.set(0, 0.6, 0).applyMatrix4(cam.matrixWorldInverse);
    const dof = this.post.dof.uniforms;
    dof.uFocus.value = Math.max(1, -this.tmp.z);
    dof.uAperture.value = this.quality === 'low' ? 0 : s.dof;
  }

  #feedRain() {
    const u = this.rain.uniforms;
    const lights = this.lamps.lights;
    for (let i = 0; i < MAX_RAIN_LIGHTS; i++) {
      const l = lights[i];
      if (l) {
        u.uLights.value[i].set(l.position.x, l.position.y, l.position.z, (l.userData.w ?? 0) * 1.4);
        u.uLightCol.value[i].copy(l.color);
      } else u.uLights.value[i].w = 0;
    }
    const h = this.heads[0];
    h.getWorldPosition(this.headWorld);
    this.heads[1].getWorldPosition(this.tmp);
    this.headWorld.add(this.tmp).multiplyScalar(0.5);
    h.target.getWorldPosition(this.headDir);
    this.headDir.sub(h.getWorldPosition(this.tmp)).normalize();
    u.uHeadPos.value.copy(this.headWorld);
    u.uHeadDir.value.copy(this.headDir);
    u.uHead.value = this.heads[0].intensity / HEAD_I;
    u.uCenter.value.copy(this.camera.position);
    this.splashes.uniforms.uFocus.value.set(this.camera.position.x * 0.4, 0, this.camera.position.z * 0.4);
  }

  render(dt) {
    this.time += dt;
    for (const m of this.street.materials) m.userData.uniforms.uTime.value = this.time;
    this.rain.uniforms.uTime.value = this.time;
    this.skyline.beaconUniforms.uTime.value = this.time;
    this.blocks.uniforms.uTime.value = this.time;
    this.lamps.coneUniforms.uTime.value = this.time;
    this.sky.uniforms.uTime.value = this.time;
    for (const l of this.lamps.lights) l.intensity = SODIUM_I * (l.userData.w ?? 0);
    this.#feedRain();
    this.car.update();

    this.titleUniforms.uOpacity.value = this.title.visible ? this.titleOpacity : 0;
    this.reflector.update(this.renderer, this.scene, this.camera);
    this.post.render(dt, this.time);
    this.#adapt(dt);
  }
}
