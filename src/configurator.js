import gsap from 'gsap';
import * as THREE from 'three';
import { PAINTS } from './three/car.js';
import { WHEELS, FINISHES } from './three/wheels.js';

const DEFAULTS = { paint: 'violeta', wheel: 'kaze', finish: 'bronce', aero: 'ala', stance: 0, lights: true };
const CODES = { violeta: 'VIO', azul: 'AZB', plata: 'PWG', blanco: 'BCI', rojo: 'RSH', sumi: 'NSU' };

function rimIcon(id) {
  const n = { kaze: 10, ami: 20, tetsu: 6 }[id];
  const w = { kaze: 2.2, ami: 1, tetsu: 4.5 }[id];
  let lines = '';
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2;
    if (id === 'kaze') a = Math.floor(i / 2) * ((Math.PI * 2) / 5) + (i % 2 ? 0.09 : -0.09);
    const x = 20 + Math.cos(a) * 15;
    const y = 20 + Math.sin(a) * 15;
    lines += `<line x1="20" y1="20" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" stroke-width="${w}"/>`;
  }
  const lip = id === 'tetsu' ? '<circle cx="20" cy="20" r="15.5" fill="none" stroke-width="1"/>' : '';
  return `<svg viewBox="0 0 40 40" aria-hidden="true" stroke="currentColor" fill="none"><circle cx="20" cy="20" r="18.5" stroke-width="1.2"/>${lip}${lines}<circle cx="20" cy="20" r="3.2" fill="currentColor" stroke="none"/></svg>`;
}

function readHash() {
  const m = location.hash.match(/c=([\w.-]+)/);
  if (!m) return {};
  const [paint, wheel, finish, aero, stance, lights] = m[1].split('.');
  const out = {};
  if (PAINTS.some((p) => p.id === paint)) out.paint = paint;
  if (WHEELS.some((w) => w.id === wheel)) out.wheel = wheel;
  if (FINISHES.some((f) => f.id === finish)) out.finish = finish;
  if (aero === 'ala' || aero === 'ducktail') out.aero = aero;
  const st = Number(stance);
  if (Number.isFinite(st) && st >= -30 && st <= 10) out.stance = st;
  if (lights === '0' || lights === '1') out.lights = lights === '1';
  return out;
}

/*
 * Configurador: los controles viven en el DOM, el coche en WebGL. El giro con arrastre
 * solo pesa mientras la cámara está en el plano del configurador.
 */
export class Configurator {
  constructor({ stage, choreo, scrollPos, onChange }) {
    this.stage = stage;
    this.car = stage.car;
    this.choreo = choreo;
    this.scrollPos = scrollPos;
    this.onChange = onChange;
    this.root = document.querySelector('.config');
    this.form = this.root.querySelector('.panel');
    this.state = { ...DEFAULTS, ...readHash() };
    this.yaw = 0;
    this.yawTarget = 0;
    this.vel = 0;
    this.spinBoost = 0;
    this.lightsK = this.state.lights ? 1 : 0;
    this.weight = 0;

    this.#build();
    this.#bindDrag();
    this.#applyAll(true);

    choreo.overrides.push((s) => {
      const w = choreo.weight('config', this.scrollPos());
      this.weight = w;
      s.yaw += this.yaw * w;
      s.head *= 1 - w * (1 - this.lightsK);
    });
  }

  #build() {
    const paint = this.form.querySelector('[data-group="paint"]');
    paint.innerHTML = PAINTS.map(
      (p) => `<button type="button" class="swatch" style="--c:${p.hex}" data-value="${p.id}" aria-label="${p.name}"></button>`
    ).join('');
    const wheel = this.form.querySelector('[data-group="wheel"]');
    wheel.innerHTML = WHEELS.map(
      (w) => `<button type="button" class="choice" data-value="${w.id}" aria-label="${w.name}, ${w.note}">${rimIcon(w.id)}<span>${w.name}</span></button>`
    ).join('');
    const finish = this.form.querySelector('[data-group="finish"]');
    finish.innerHTML = FINISHES.map(
      (f) => `<button type="button" class="swatch" style="--c:${f.hex}" data-value="${f.id}" aria-label="${f.name}"></button>`
    ).join('');

    this.form.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-value]');
      if (btn) {
        const group = btn.closest('[data-group]').dataset.group;
        this.set(group, btn.dataset.value);
      }
      if (e.target.closest('[data-group="lights"]')) this.set('lights', !this.state.lights);
      if (e.target.closest('[data-copy]')) this.#copy();
    });
    this.form.querySelector('[data-group="stance"]').addEventListener('input', (e) => {
      this.set('stance', Number(e.target.value));
    });

    this.views = [...this.root.querySelectorAll('[data-view]')];
    this.views.forEach((b) =>
      b.addEventListener('click', () => {
        // Gira por el camino más corto hacia la vista elegida.
        const target = Number(b.dataset.view);
        const turns = Math.round((this.yawTarget - target) / (Math.PI * 2));
        this.yawTarget = target + turns * Math.PI * 2;
        this.vel = 0;
        this.#markView(b);
      })
    );
  }

  #markView(active) {
    this.views.forEach((b) => b.setAttribute('aria-pressed', String(b === active)));
  }

  #bindDrag() {
    const area = this.root.querySelector('.sticky');
    let id = null;
    let lastX = 0;
    let lastT = 0;
    area.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.panel, button, a, input')) return;
      id = e.pointerId;
      lastX = e.clientX;
      lastT = performance.now();
      this.vel = 0;
      area.setPointerCapture(id);
      area.classList.add('dragging');
    });
    area.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const now = performance.now();
      const dx = e.clientX - lastX;
      this.yawTarget += dx * 0.0085;
      this.vel = (dx * 0.0085) / Math.max(0.008, (now - lastT) / 1000);
      lastX = e.clientX;
      lastT = now;
      this.#markView(null);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      area.classList.remove('dragging');
    };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
    this.dragging = () => id !== null;
  }

  set(key, value) {
    if (this.state[key] === value) return;
    this.state[key] = value;
    this.#apply(key);
    this.#reflect();
    this.onChange?.(this.state);
  }

  #applyAll(instant) {
    for (const k of Object.keys(this.state)) this.#apply(k, instant);
    this.#reflect();
  }

  #apply(key, instant = false) {
    const car = this.car;
    const v = this.state[key];
    const d = instant ? 0 : 1;
    if (key === 'paint') {
      const p = PAINTS.find((x) => x.id === v);
      const c = new THREE.Color(p.hex);
      gsap.to(car.paint.color, { r: c.r, g: c.g, b: c.b, duration: 0.9 * d, ease: 'power2.inOut' });
      gsap.to(car.paint, { metalness: p.metal, roughness: p.rough, duration: 0.9 * d });
    } else if (key === 'wheel' || key === 'finish') {
      car.setWheels(this.state.wheel, this.state.finish);
      if (!instant && key === 'wheel') this.spinBoost = 14;
    } else if (key === 'aero') {
      car.setAero(v);
      if (!instant) {
        const part = v === 'ala' ? car.wing : car.duck;
        const base = part.userData.baseY ?? (part.userData.baseY = part.position.y);
        gsap.fromTo(part.position, { y: base - 0.28 }, { y: base, duration: 0.9, ease: 'expo.out' });
      }
    } else if (key === 'stance') {
      gsap.to(car.body.position, { y: v / 1000, duration: 0.8 * d, ease: 'power3.out', onUpdate: () => car.setStance(car.body.position.y) });
    } else if (key === 'lights') {
      gsap.killTweensOf(this, 'lightsK');
      if (instant) this.lightsK = v ? 1 : 0;
      else if (v) {
        gsap
          .timeline()
          .to(this, { lightsK: 0.7, duration: 0.05 })
          .to(this, { lightsK: 0.05, duration: 0.07 })
          .to(this, { lightsK: 1, duration: 0.14 });
      } else gsap.to(this, { lightsK: 0, duration: 0.25 });
    }
  }

  #reflect() {
    const s = this.state;
    this.form.querySelectorAll('[data-group] [data-value]').forEach((b) => {
      const g = b.closest('[data-group]').dataset.group;
      b.setAttribute('aria-pressed', String(s[g] === b.dataset.value));
    });
    const out = (k, text) => (this.form.querySelector(`[data-out="${k}"]`).textContent = text);
    out('paint', PAINTS.find((p) => p.id === s.paint).name);
    out('wheel', WHEELS.find((w) => w.id === s.wheel).note);
    out('finish', FINISHES.find((f) => f.id === s.finish).name);
    out('stance', s.stance === 0 ? 'De serie' : `${s.stance > 0 ? '+' : '−'}${Math.abs(s.stance)} mm`);
    this.form.querySelector('[data-group="stance"]').value = s.stance;
    const t = this.form.querySelector('[data-group="lights"]');
    t.setAttribute('aria-checked', String(s.lights));
    t.querySelector('span').textContent = s.lights ? 'Encendidos' : 'Apagados';
    this.form.querySelector('.build-code').textContent = this.code();
  }

  code() {
    const s = this.state;
    const st = s.stance === 0 ? '±0' : `${s.stance > 0 ? '+' : '−'}${Math.abs(s.stance)}`;
    return `KR7 ${CODES[s.paint]} ${s.wheel.toUpperCase()} ${s.finish.slice(0, 2).toUpperCase()} ${s.aero === 'ala' ? 'GT' : 'DT'} ${st}`;
  }

  hash() {
    const s = this.state;
    return `#c=${s.paint}.${s.wheel}.${s.finish}.${s.aero}.${s.stance}.${s.lights ? 1 : 0}`;
  }

  async #copy() {
    const url = location.origin + location.pathname + this.hash();
    history.replaceState(null, '', this.hash());
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      ok = false;
    }
    toast(ok ? 'Enlace copiado' : 'Enlace listo en la barra de direcciones');
  }

  update(dt) {
    if (!this.dragging()) {
      this.yawTarget += this.vel * dt;
      this.vel *= Math.exp(-dt * 4);
    }
    this.yaw += (this.yawTarget - this.yaw) * (1 - Math.exp(-dt * 8));
    if (this.spinBoost > 0.01) {
      this.car.spin(this.spinBoost * dt);
      this.spinBoost *= Math.exp(-dt * 1.6);
    }
  }
}

let toastTimer;
export function toast(text) {
  const el = document.querySelector('.toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}
