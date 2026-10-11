import '@fontsource-variable/archivo/wdth.css';
import './fonts-ja.css';
import './style.css';
import './sections.css';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { Stage, detectQuality } from './three/stage.js';
import { SIGN_GLYPHS } from './three/city.js';
import { Choreo } from './choreo.js';
import { Chapters } from './chapters.js';
import { Configurator } from './configurator.js';
import { Gallery } from './gallery.js';
import { editorial, heroLines } from './editorial.js';

gsap.registerPlugin(ScrollTrigger);

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadFonts() {
  await Promise.race([
    Promise.all([
      document.fonts.load("ultra-expanded 800 100px 'Archivo Variable'"),
      document.fonts.load("500 20px 'Archivo Variable'"),
      document.fonts.load("800 100px 'Shippori Mincho B1'", SIGN_GLYPHS),
    ]),
    wait(3000),
  ]);
}

function fallback(err) {
  console.error(err);
  document.documentElement.classList.add('no-webgl');
  document.getElementById('loader').classList.add('done');
}

async function boot() {
  await loadFonts();
  const canvas = document.getElementById('gl');
  let stage;
  const line = document.querySelector('.loader-line');
  try {
    stage = new Stage(canvas, detectQuality());
    await stage.load((p) => {
      line.classList.add('determinate');
      line.style.setProperty('--p', p.toFixed(3));
    });
  } catch (err) {
    fallback(err);
    return;
  }
  window.__yoru = stage; // útil para depurar y para las pruebas automáticas

  const choreo = new Choreo();
  const lenis = reduceMotion ? null : new Lenis({ lerp: 0.09, wheelMultiplier: 0.85 });
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  const scrollPos = () => (lenis ? lenis.scroll : scrollY);
  window.__lenis = lenis;
  window.__choreo = choreo;

  const chapters = new Chapters({ stage, choreo, lenis, reduceMotion });
  const gallery = new Gallery({ stage });
  const configurator = new Configurator({ stage, choreo, scrollPos, onChange: () => gallery.invalidate() });
  editorial({ reduceMotion });
  ScrollTrigger.addEventListener('refresh', () => choreo.refresh());
  ScrollTrigger.refresh();

  // Navegación interna con el mismo scroll suave.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    const target = id === '#top' ? 0 : document.querySelector(id);
    if (target === null) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { duration: id === '#top' ? 2.6 : 1.8 });
    else (target === 0 ? document.body : target).scrollIntoView();
  });

  // Arranque: un único momento orquestado.
  const intro = { dolly: 1, head: 0, reveal: 0, exposure: 0.05 };
  choreo.overrides.push((s) => {
    s.px += intro.dolly * 2.6;
    s.pz += intro.dolly * 3.4;
    s.py += intro.dolly * 0.25;
    s.head *= intro.head;
    s.tail *= Math.min(1, intro.exposure * 1.4);
    s.exposure *= intro.exposure;
  });

  // Paralaje del puntero en el hero: la cámara respira con el ratón, nada más.
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  if (matchMedia('(pointer: fine)').matches && !reduceMotion) {
    addEventListener('pointermove', (e) => {
      pointer.x = (e.clientX / innerWidth) * 2 - 1;
      pointer.y = (e.clientY / innerHeight) * 2 - 1;
    });
  }
  choreo.overrides.push((s) => {
    pointer.sx += (pointer.x - pointer.sx) * 0.04;
    pointer.sy += (pointer.y - pointer.sy) * 0.04;
    const w = choreo.weight('hero', scrollPos());
    s.px += pointer.sx * 0.35 * w;
    s.pz -= pointer.sx * 0.35 * w;
    s.py -= pointer.sy * 0.18 * w;
    if (reduceMotion) s.rain *= 0.3;
  });

  choreo.update(scrollPos(), 0, true);
  stage.apply(choreo.state, 0);
  try {
    await stage.renderer.compileAsync(stage.scene, stage.camera);
  } catch {
    /* compileAsync no disponible: se compila en el primer fotograma */
  }
  stage.render(0);

  let last = performance.now();
  gsap.ticker.add(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const y = scrollPos();
    const s = choreo.update(y, dt);
    stage.titleUniforms.uReveal.value = intro.reveal;
    configurator.update(dt);
    stage.apply(s, dt);
    chapters.update(y, s);
    // Las capturas de la galería usan la misma escena y luego se restaura el plano.
    if (gallery.step(now)) stage.apply(s, 0);
    // Con la galería tapando el lienzo no se dibuja nada.
    stage.running = !gallery.covers();
    if (stage.running) stage.render(dt);
  });

  document.getElementById('loader').classList.add('done');
  const heroBits = document.querySelectorAll('.hero-vertical, .scroll-cue, .bar');
  const heroSub = document.querySelector('.hero-sub');
  const heroScrim = document.querySelector('.hero .scrim');
  const heroLine = reduceMotion ? [] : heroLines();
  gsap.set(heroBits, { autoAlpha: 0 });
  if (!reduceMotion) {
    gsap.set(heroLine, { yPercent: 112 });
    gsap.set([heroSub, heroScrim], { autoAlpha: 0 });
  }

  const tl = gsap.timeline({ delay: 0.35 });
  if (reduceMotion) {
    tl.set(intro, { dolly: 0, head: 1, reveal: 1, exposure: 1 }).set(heroBits, { autoAlpha: 1 });
  } else {
    tl.to(intro, { exposure: 1, duration: 2.6, ease: 'power2.inOut' }, 0)
      .to(intro, { dolly: 0, duration: 3.6, ease: 'power3.out' }, 0)
      // Las luces LED arrancan con un parpadeo corto, como un encendido real.
      .to(intro, { head: 0.7, duration: 0.05 }, 0.9)
      .to(intro, { head: 0.05, duration: 0.07 }, 0.98)
      .to(intro, { head: 1, duration: 0.12 }, 1.12)
      .to(intro, { reveal: 1, duration: 1.6, ease: 'expo.out' }, 1.35)
      .to(heroScrim, { autoAlpha: 1, duration: 1.6, ease: 'power2.out' }, 1.8)
      .to(heroLine, { yPercent: 0, duration: 1.3, ease: 'expo.out', stagger: 0.1 }, 2.1)
      .to(heroSub, { autoAlpha: 1, duration: 1.1, ease: 'power2.out' }, 2.55)
      .to(heroBits, { autoAlpha: 1, duration: 1.2, ease: 'power2.out', stagger: 0.12 }, 2.4);
  }
}

boot();
