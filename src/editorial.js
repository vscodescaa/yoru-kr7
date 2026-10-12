import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

/*
 * Entradas de texto: cada bloque tiene una línea temporal propia que se reproduce al
 * llegar a su plano y se deshace si se vuelve atrás. Los titulares suben línea a línea
 * tras una máscara; los párrafos llegan después, cuando la cámara ya ha parado.
 */

const fmt = (v, dec, th) => {
  const fixed = v.toFixed(dec).replace('.', ',');
  return th ? fixed.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : fixed;
};

/** Cifra que cuenta hasta su valor (data-count) dentro de la entrada del bloque. */
function counter(tl, dd, at) {
  const to = Number(dd.dataset.count);
  const dec = Number(dd.dataset.decimals || 0);
  const th = dd.hasAttribute('data-thousands');
  const o = { v: 0 };
  let last = '';
  tl.fromTo(
    o,
    { v: 0 },
    {
      v: to,
      duration: 1.6,
      ease: 'power3.out',
      onUpdate: () => {
        const txt = fmt(o.v, dec, th);
        if (txt !== last) dd.textContent = last = txt;
      },
    },
    at
  );
}

/** Divide en líneas y reconstruye la animación si el texto vuelve a partirse (resize). */
function lines(el, mask, onChange) {
  if (!el) return;
  SplitText.create(el, {
    type: 'lines',
    mask: mask ? 'lines' : undefined,
    linesClass: 'line',
    autoSplit: true,
    onSplit: (self) => onChange(self.lines),
  });
}

/**
 * Bloque revelable. parts: { scrim, mark, title, rule, text, extra, wholeTitle }
 * build(tl, parts) añade lo específico del bloque.
 */
function block(trigger, start, parts, extra) {
  const state = { titleLines: null, textLines: null, tl: null, dir: 0 };
  const build = () => {
    const progress = state.tl ? state.tl.progress() : 0;
    state.tl?.kill();
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } });
    if (parts.scrim) tl.fromTo(parts.scrim, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, 0);
    if (parts.mark) tl.fromTo(parts.mark, { autoAlpha: 0, x: -14 }, { autoAlpha: 1, x: 0, duration: 0.9 }, 0.05);
    if (state.titleLines) {
      tl.fromTo(state.titleLines, { yPercent: 112 }, { yPercent: 0, duration: 1.2, stagger: 0.085 }, 0.1);
    } else if (parts.wholeTitle) {
      tl.fromTo(
        parts.wholeTitle,
        { clipPath: 'inset(0% 0% 100% 0%)', y: 28 },
        { clipPath: 'inset(-20% -5% -20% 0%)', y: 0, duration: 1.2 },
        0.1
      );
    }
    if (parts.rule) tl.fromTo(parts.rule, { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'expo.inOut' }, 0.35);
    if (state.textLines) {
      tl.fromTo(
        state.textLines,
        { autoAlpha: 0, y: 14 },
        { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.07, ease: 'power3.out' },
        0.55
      );
    }
    extra?.(tl);
    tl.progress(progress);
    state.tl = tl;
    // Si el texto se vuelve a partir a mitad de la entrada, sigue en la misma dirección.
    if (state.dir > 0) tl.play();
    else if (state.dir < 0) tl.reverse();
  };
  const play = () => {
    state.dir = 1;
    state.tl.play();
  };
  const reverse = () => {
    state.dir = -1;
    state.tl.reverse();
  };
  lines(parts.title, true, (l) => {
    state.titleLines = l;
    build();
  });
  lines(parts.text, false, (l) => {
    state.textLines = l;
    build();
  });
  if (!parts.title && !parts.text) build();
  ScrollTrigger.create({
    trigger,
    start,
    onEnter: play,
    onEnterBack: play,
    onLeaveBack: reverse,
  });
  return state;
}

export function editorial({ reduceMotion }) {
  if (reduceMotion) return;

  for (const sec of document.querySelectorAll('.chapter')) {
    const q = (s) => sec.querySelector(s);
    const isAire = sec.classList.contains('ch-aire');
    block(
      sec,
      'top 22%',
      {
        scrim: q('.scrim'),
        mark: q('.ch-mark'),
        // El titular de Aire cambia de anchura con el scroll: se revela entero, sin partirlo.
        title: isAire ? null : q('.ch-title'),
        wholeTitle: isAire ? q('.ch-title') : null,
        rule: q('.ch-rule'),
        text: q('.ch-text'),
      },
      (tl) => {
        const speed = q('.speed');
        if (speed) tl.fromTo(speed, { autoAlpha: 0, y: -16 }, { autoAlpha: 1, y: 0, duration: 1.2 }, 0.3);
        const specs = sec.querySelectorAll('.specs > div');
        if (specs.length) {
          tl.fromTo(specs, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 1, stagger: 0.08, ease: 'power3.out' }, 0.6);
          tl.fromTo(specs, { '--rl': '0%' }, { '--rl': '100%', duration: 1.4, stagger: 0.08, ease: 'expo.inOut' }, 0.7);
          specs.forEach((div, i) => counter(tl, div.querySelector('dd'), 0.7 + i * 0.08));
        }
      }
    );
  }

  const config = document.querySelector('.config');
  if (config) {
    block(
      config,
      'top 30%',
      { scrim: config.querySelector('.scrim'), title: config.querySelector('.config-head h2'), text: config.querySelector('.config-lead') },
      (tl) => {
        tl.fromTo('.config-hint', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: 'power2.out' }, 0.8);
        tl.fromTo('.config .panel', { autoAlpha: 0, x: 28 }, { autoAlpha: 1, x: 0, duration: 1.1 }, 0.2);
        tl.fromTo('.config-views', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 0.5);
      }
    );
  }

  const gallery = document.querySelector('.gallery');
  if (gallery) {
    block(gallery, 'top 70%', { title: gallery.querySelector('.gallery-head h2'), text: gallery.querySelector('.gallery-head p') }, (tl) => {
      tl.fromTo('.gallery-progress', { scaleX: 0, transformOrigin: 'left center' }, { scaleX: 1, duration: 1.4, ease: 'expo.inOut' }, 0.3);
      tl.fromTo('.gallery .tile', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 1.2, stagger: 0.1 }, 0.35);
    });
  }

  const cierre = document.querySelector('.cierre');
  if (cierre) {
    block(
      cierre,
      'top 55%',
      { scrim: cierre.querySelector('.scrim'), title: cierre.querySelector('h2'), text: cierre.querySelector('.cierre-inner > p') },
      (tl) => {
        tl.fromTo('.cierre .btn', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 1, stagger: 0.1, ease: 'power3.out' }, 0.85);
      }
    );
  }
}

/** Intro del hero: la frase sube tras su máscara cuando el coche ya está encendido. */
export function heroLines() {
  const line = document.querySelector('.hero-line');
  const split = SplitText.create(line, { type: 'lines', mask: 'lines', linesClass: 'line' });
  return split.lines;
}
