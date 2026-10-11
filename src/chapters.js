import gsap from 'gsap';
import * as THREE from 'three';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/*
 * Lo que pasa en el DOM durante la historia: cotas proyectadas desde el coche real,
 * encendido secuencial de los pilotos, raíl de capítulos y entradas de texto.
 */
export class Chapters {
  constructor({ stage, choreo, reduceMotion }) {
    this.stage = stage;
    this.choreo = choreo;
    this.reduce = reduceMotion;
    this.rail = document.querySelector('.rail');
    this.railItems = [...document.querySelectorAll('.rail li')];
    this.sections = [...document.querySelectorAll('[data-ch]')].filter((el) => el.tagName === 'SECTION');
    this.navLinks = [...document.querySelectorAll('.bar nav a')];
    this.pt = { x: 0, y: 0, visible: true };
    this.pt2 = { x: 0, y: 0, visible: true };

    this.silueta = document.querySelector('.ch-silueta');
    this.mLen = this.silueta?.querySelector('.measure-length');
    this.mHei = this.silueta?.querySelector('.measure-height');
    this.dims = stage.car.dims;
    this.roof = this.dims.roof;
    this.v = new THREE.Vector3();

    // Encendido de los cuatro pilotos ligado al scroll del capítulo Luz.
    choreo.overrides.push((s) => {
      const p = choreo.progress('luz', this.y ?? 0);
      s.tailSeq = p <= 0 ? 1 : clamp01((p - 0.22) / 0.3);
    });

    // Aire: la carretera acelera con el scroll.
    choreo.overrides.push((s) => {
      const p = choreo.progress('aire', this.y ?? 0);
      if (p > 0 && p < 1) s.speed *= 0.25 + 0.75 * clamp01((p - 0.2) / 0.45);
    });

    this.aire = document.querySelector('.ch-aire');
    this.speedNum = this.aire?.querySelector('.speed-num');
    this.navMap = { silueta: 0, luz: 0, aire: 0, corazon: 0, config: 1, detalles: 2 };

    this.#entrances();
  }

  #aire(y) {
    if (!this.aire) return;
    const p = this.choreo.progress('aire', y);
    if (p <= 0 || p >= 1) return;
    const k = clamp01((p - 0.2) / 0.45);
    const kmh = Math.round(250 * k * k * (3 - 2 * k));
    const txt = String(kmh);
    if (txt !== this.lastKmh) {
      this.speedNum.textContent = txt;
      this.lastKmh = txt;
    }
    this.aire.style.setProperty('--stretch', `${(62 + 50 * k).toFixed(1)}%`);
  }

  #entrances() {
    const st = (trigger, extra) => ({ trigger, scrub: true, ...extra });
    gsap.fromTo(
      '.hero-fade',
      { autoAlpha: 1, y: 0 },
      { autoAlpha: 0, y: -60, ease: 'none', scrollTrigger: st('.hero', { start: 'top top', end: '35% top' }) }
    );
    // Luz: el titular toma el rojo de los pilotos a medida que se encienden.
    const luz = document.querySelector('.ch-luz');
    if (luz && !this.reduce) {
      gsap.fromTo(
        luz.querySelector('.ch-title'),
        { color: '#6a3a42', textShadow: '0 0 0 rgba(255,35,56,0)' },
        {
          color: '#fff0f2',
          textShadow: '0 0 42px rgba(255,35,56,0.5)',
          ease: 'none',
          scrollTrigger: st(luz, { start: 'top 10%', end: 'top -45%' }),
        }
      );
    }
    gsap.utils.toArray('.chapter .kanji, .gallery-head .kanji').forEach((k) => {
      gsap.fromTo(k, { yPercent: 18 }, { yPercent: -18, ease: 'none', scrollTrigger: st(k.closest('section'), { start: 'top bottom', end: 'bottom top' }) });
    });
  }

  #measure(y) {
    if (!this.mLen) return;
    const p = this.choreo.progress('silueta', y);
    const vis = p > 0 && p < 1;
    this.mLen.style.visibility = this.mHei.style.visibility = vis ? 'visible' : 'hidden';
    if (!vis) return;
    const k = clamp01((p - 0.32) / 0.22);
    const st = this.stage;
    const lift = st.car.body.position.y;
    // Cota de longitud, bajo el coche.
    st.project(this.v.set(this.dims.rear, -0.12, 0), this.pt);
    st.project(this.v.set(this.dims.front, -0.12, 0), this.pt2);
    const a = this.pt.x < this.pt2.x ? this.pt : this.pt2;
    const b = a === this.pt ? this.pt2 : this.pt;
    this.mLen.style.transform = `translate(${a.x}px, ${a.y}px)`;
    this.mLen.style.setProperty('--w', `${b.x - a.x}px`);
    this.mLen.style.setProperty('--p', k.toFixed(3));
    // Cota de altura, delante del morro.
    st.project(this.v.set(this.dims.front + 0.3, 0, 0), this.pt);
    st.project(this.v.set(this.dims.front + 0.3, this.roof + lift, 0), this.pt2);
    this.mHei.style.transform = `translate(${this.pt.x}px, ${this.pt.y}px)`;
    this.mHei.style.setProperty('--h', `${this.pt.y - this.pt2.y}px`);
    this.mHei.style.setProperty('--p', clamp01((p - 0.42) / 0.2).toFixed(3));
  }

  #rail(y) {
    const mid = y + innerHeight * 0.5;
    let active = null;
    for (const s of this.sections) {
      const top = s.offsetTop;
      if (mid >= top && mid < top + s.offsetHeight) active = s.dataset.ch;
    }
    let navIdx = active ? 0 : -1;
    for (const an of this.choreo.anchors) {
      const el = an.el;
      const inside = mid >= el.offsetTop && mid < el.offsetTop + el.offsetHeight;
      if (inside && an.name in this.navMap) navIdx = this.navMap[an.name];
    }
    if (navIdx !== this.navIdx) {
      this.navIdx = navIdx;
      this.navLinks.forEach((a, i) => a.setAttribute('aria-current', String(i === navIdx)));
    }
    if (active !== this.active) {
      this.active = active;
      this.rail.classList.toggle('on', !!active);
      this.railItems.forEach((li) => li.classList.toggle('active', li.dataset.ch === active));
    }
  }

  update(y, s) {
    this.y = y;
    this.stage.car.setTailSequence?.(s.tailSeq ?? 1);
    this.#measure(y);
    this.#aire(y);
    this.#rail(y);
  }
}
