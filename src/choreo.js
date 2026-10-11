import * as THREE from 'three';

/*
 * Cada sección con data-shot fija un plano. Mientras la sección ocupa la pantalla
 * el plano "aguanta" (con una deriva opcional); entre secciones se interpola.
 * El estado resultante se amortigua para que el movimiento nunca sea brusco.
 */

const BASE = {
  px: 5, py: 1, pz: 5, tx: 0, ty: 0.6, tz: 0, fov: 30,
  yaw: 0, env: 0, exposure: 1, keyI: 1.2, rimI: 0, rim: '#ff2a3a',
  head: 1, beam: 1, tail: 0.6, rain: 1, speed: 0, title: 0, titleScale: 1, titleLift: 0, dof: 0.6,
  shiftX: 0, shiftY: 0, // descentramiento del encuadre (fracción de pantalla; + = coche a la derecha / abajo)
};

const shot = (o) => ({ ...BASE, ...o });

export const SHOTS = {
  hero: shot({
    px: 5.6, py: 0.82, pz: 5.1, tx: 0.15, ty: 0.72, tz: 0, fov: 30, title: 1, tail: 0.6, dof: 0.75,
    drift: { px: 5.9, pz: 4.6 },
  }),
  silueta: shot({
    px: 0.15, py: 0.66, pz: 10.2, tx: 0, ty: 0.64, tz: 0, fov: 25, env: 0.5, head: 0.9, tail: 0.7, titleScale: 1.7, titleLift: 0.12, dof: 0.55, shiftY: 0.1,
    keyI: 1.4, drift: { px: -0.5, env: 1.1 },
  }),
  luz: shot({
    px: -5.4, py: 0.74, pz: 2.1, tx: -1.9, ty: 0.68, tz: 0.15, fov: 30, env: 1.6, head: 0.15, tail: 1,
    keyI: 0.5, rimI: 5, exposure: 0.85, dof: 0.6, shiftX: -0.24, drift: { pz: 1.4, px: -5.0 },
  }),
  aire: shot({
    px: -4.6, py: 4.4, pz: -5.6, tx: -0.3, ty: 0.55, tz: 0, fov: 30, env: 2.4, head: 1, tail: 1,
    keyI: 1.1, rimI: 3, rim: '#46c2ff', speed: 26, rain: 1.2, dof: 0.35, shiftX: 0.12, shiftY: -0.06, drift: { px: -5.4, py: 3.6, pz: -4.4 },
  }),
  corazon: shot({
    px: 4.2, py: 0.36, pz: -2.7, tx: 1.55, ty: 0.48, tz: -0.1, fov: 30, env: 3.3, head: 1, tail: 0.6,
    keyI: 1.0, rimI: 4, rim: '#ffd2a0', speed: 4, dof: 0.3, exposure: 0.8, beam: 0.45, shiftX: 0.2, drift: { px: 3.5, pz: -3.2 },
  }),
  config: shot({
    mobile: { tx: 0, ty: -1.25, tz: 0, fov: 30 },
    px: 6.7, py: 2.05, pz: 6.9, tx: 0.85, ty: 0.42, tz: -0.85, fov: 29, env: 0.2, head: 1, tail: 0.7,
    keyI: 1.3, rain: 0.45, dof: 0.4, exposure: 0.85, shiftY: 0.07,
  }),
  detalles: shot({
    mobile: { tx: 0, ty: -1.25, tz: 0, fov: 30 },
    px: 6.7, py: 2.05, pz: 6.9, tx: 0.85, ty: 0.42, tz: -0.85, fov: 29, env: 0.2, rain: 0.45, shiftY: 0.07,
  }),
  cierre: shot({
    mobile: { tx: 0, ty: -1.9, tz: 0 },
    px: -8.8, py: 1.05, pz: 1.6, tx: -0.3, ty: 0.95, tz: -1.7, fov: 26, env: 1, head: 1, tail: 1,
    keyI: 0.7, rimI: 5, speed: 30, rain: 1.1, dof: 0.7, shiftX: 0.06, drift: { px: -10.5, pz: 0.6 },
  }),
};

const KEYS = Object.keys(BASE).filter((k) => k !== 'rim');
// 'mobile' y 'drift' no son parámetros interpolables: solo variantes del plano.
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const color = new THREE.Color();

function flatten(s) {
  color.set(s.rim);
  return { ...s, rimR: color.r, rimG: color.g, rimB: color.b };
}

function lerpInto(out, a, b, t) {
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  out.rimR = a.rimR + (b.rimR - a.rimR) * t;
  out.rimG = a.rimG + (b.rimG - a.rimG) * t;
  out.rimB = a.rimB + (b.rimB - a.rimB) * t;
  return out;
}

export class Choreo {
  constructor() {
    this.anchors = [];
    this.state = null;
    this.target = {};
    this.overrides = []; // funciones (estado) => void aplicadas tras interpolar
    this.refresh();
    addEventListener('resize', () => this.refresh());
  }

  refresh() {
    const vh = innerHeight;
    this.anchors = [...document.querySelectorAll('[data-shot]')].map((el) => {
      const top = el.getBoundingClientRect().top + scrollY;
      const base = SHOTS[el.dataset.shot];
      const s = innerWidth / innerHeight < 0.8 && base.mobile ? { ...base, ...base.mobile } : base;
      const a = flatten(s);
      const b = flatten({ ...s, ...(s.drift || {}) });
      return { el, name: el.dataset.shot, start: top, end: Math.max(top, top + el.offsetHeight - vh), a, b };
    });
  }

  /** Estado deseado para una posición de scroll. */
  sample(y) {
    const A = this.anchors;
    const out = this.target;
    const held = (an, p) => lerpInto({}, an.a, an.b, easeInOut(Math.min(1, Math.max(0, p))));
    if (y <= A[0].end) return Object.assign(out, held(A[0], (y - A[0].start) / Math.max(1, A[0].end - A[0].start)));
    for (let i = 0; i < A.length; i++) {
      const an = A[i];
      if (y >= an.start && y <= an.end) {
        return Object.assign(out, held(an, (y - an.start) / Math.max(1, an.end - an.start)));
      }
      const next = A[i + 1];
      if (next && y > an.end && y < next.start) {
        const t = easeInOut((y - an.end) / (next.start - an.end));
        return lerpInto(out, held(an, 1), held(next, 0), t);
      }
    }
    return Object.assign(out, held(A[A.length - 1], 1));
  }

  /** Avanza el estado amortiguado hacia el deseado. */
  update(y, dt, snap = false) {
    const target = this.sample(y);
    for (const fn of this.overrides) fn(target);
    if (!this.state || snap) {
      this.state = { ...target };
      return this.state;
    }
    const k = 1 - Math.exp(-dt * 5.5);
    for (const key in target) {
      if (typeof target[key] === 'number') this.state[key] += (target[key] - this.state[key]) * k;
    }
    return this.state;
  }

  /** Cuánto manda un plano: 1 mientras aguanta, 0 cuando ya manda el vecino. */
  weight(name, y) {
    const i = this.anchors.findIndex((a) => a.name === name);
    if (i < 0) return 0;
    const an = this.anchors[i];
    if (y >= an.start && y <= an.end) return 1;
    if (y < an.start) {
      const prev = this.anchors[i - 1];
      if (!prev) return 1;
      if (y <= prev.end) return 0;
      return easeInOut((y - prev.end) / (an.start - prev.end));
    }
    const next = this.anchors[i + 1];
    if (!next) return 1;
    if (y >= next.start) return 0;
    return 1 - easeInOut((y - an.end) / (next.start - an.end));
  }

  /** Progreso 0..1 de una sección en su tramo de "aguante". */
  progress(name, y) {
    const an = this.anchors.find((a) => a.name === name);
    if (!an) return 0;
    const span = Math.max(1, an.end - an.start + innerHeight);
    return Math.min(1, Math.max(0, (y - an.start + innerHeight) / span));
  }
}
