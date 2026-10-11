import gsap from 'gsap';

/*
 * Galería de detalles: las imágenes no son archivos, se renderizan desde la misma escena
 * con la configuración actual. Se generan una a una, solo cuando la galería se acerca.
 */
const SHOTS = {
  tail: { pos: [-3.25, 0.66, 1.5], target: [-2.15, 0.64, 0.42], fov: 30, env: 1.6, light: [[-3.4, 1.2, 1.6], '#ff2a3a', 7] },
  wheel: { pos: [2.15, 0.5, 2.25], target: [1.36, 0.36, 0.86], fov: 32, env: 0.4, light: [[2.3, 1.1, 2.6], '#d8e2ff', 5] },
  head: { pos: [3.7, 0.5, 1.5], target: [2.05, 0.62, 0.15], fov: 28, env: 0.2, light: [[3, 2, 2], '#d8e2ff', 0] },
  haunch: { pos: [-3.7, 0.62, 2.7], target: [-1.55, 0.58, 0.75], fov: 28, env: 1.9, light: [[-2.6, 1.6, 2.6], '#9fb8ff', 5] },
  roof: { pos: [1.4, 3.6, 3.1], target: [-0.7, 0.85, 0], fov: 32, env: 0.9, light: [[0, 3, 2], '#d8e2ff', 0] },
};

export class Gallery {
  constructor({ stage }) {
    this.stage = stage;
    this.el = document.querySelector('.gallery');
    this.tiles = [...this.el.querySelectorAll('[data-detail]')];
    this.queue = [];
    this.near = false;
    this.dirty = true;
    this.urls = new Map();
    this.busy = false;

    new IntersectionObserver(
      ([e]) => {
        this.near = e.isIntersecting;
        if (this.near && this.dirty) this.#enqueue();
      },
      { rootMargin: '150% 0px' }
    ).observe(this.el);

    const mm = gsap.matchMedia();
    mm.add('(min-width: 761px)', () => {
      const track = this.el.querySelector('.track');
      const dist = () => Math.max(0, track.scrollWidth - innerWidth);
      gsap.to(track, {
        x: () => -dist(),
        ease: 'none',
        scrollTrigger: {
          trigger: this.el,
          pin: this.el.querySelector('.gallery-pin'),
          start: 'top top',
          end: () => `+=${dist()}`,
          scrub: true,
          invalidateOnRefresh: true,
        },
      });
    });
  }

  /** La configuración cambió: las imágenes se rehacen la próxima vez que se acerque. */
  invalidate() {
    this.dirty = true;
    if (this.near) this.#enqueue();
  }

  #enqueue() {
    this.dirty = false;
    this.queue = this.tiles.map((t) => t.dataset.detail);
  }

  /** Coverage: ¿la galería tapa por completo el lienzo? */
  covers() {
    const r = this.el.getBoundingClientRect();
    return r.top <= 0 && r.bottom >= innerHeight;
  }

  /** Renderiza como máximo una imagen por fotograma. Devuelve true si tocó la escena. */
  step(now) {
    if (!this.queue.length || this.busy || now - (this.last || 0) < 120) return false;
    this.last = now;
    const name = this.queue.shift();
    const st = this.stage;
    const shot = SHOTS[name];
    const tall = this.tiles.find((t) => t.dataset.detail === name).classList.contains('tall') && innerWidth > 760;
    st.captureSize(tall ? 800 : 1280, tall ? 1000 : 800);
    const cam = st.camera;
    cam.position.set(...shot.pos);
    cam.lookAt(...shot.target);
    cam.fov = tall ? shot.fov * 1.25 : shot.fov;
    cam.updateProjectionMatrix();
    st.car.root.rotation.y = 0;
    if (st.mirror) st.mirror.rotation.y = 0;
    st.title.visible = false;
    st.renderer.toneMappingExposure = 1;
    st.scene.environmentRotation.y = shot.env;
    const rimPos = st.rim.position.clone();
    st.rim.position.set(...shot.light[0]);
    st.rim.color.set(shot.light[1]);
    st.rim.intensity = shot.light[2];
    st.car.setTail(1);
    st.car.setTailSequence(1);
    st.render(0);
    st.rim.position.copy(rimPos);
    this.busy = true;
    const done = () => st.restoreSize();
    st.canvas.toBlob(
      (blob) => {
        this.busy = false;
        if (!blob) return;
        const img = this.tiles.find((t) => t.dataset.detail === name).querySelector('img');
        const prev = this.urls.get(name);
        const url = URL.createObjectURL(blob);
        this.urls.set(name, url);
        const swap = () => {
          img.classList.add('ready');
          if (prev) URL.revokeObjectURL(prev);
        };
        img.onload = swap;
        img.src = url;
      },
      'image/jpeg',
      0.86
    );
    // toBlob toma la imagen en este mismo instante: ya se puede devolver el lienzo.
    done();
    return true;
  }
}
