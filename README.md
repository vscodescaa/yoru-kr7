# YORU KR-7

Demo automotriz de cultura JDM nocturna: un coupé conceptual ficticio presentado con historia por scroll, configurador 3D y galería de detalles renderizada en tiempo real.

![Hoja de contactos](docs/screenshots/contact.jpg)

## Ejecutar

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # genera dist/
npm run preview   # sirve dist/
```

`dist/` es estático: se puede subir tal cual a cualquier hosting (Netlify, Vercel, GitHub Pages, un bucket).

Parámetros útiles en la URL:

- `?q=low` fuerza la calidad baja (la que usan los móviles); `?q=high`, la alta.
- `#c=azul.tetsu.plata.ducktail.-20.1` abre el configurador con esa combinación (es lo que copia el botón «Copiar enlace»).

## Estructura

```
index.html                 secciones y textos
src/main.js                arranque, Lenis, bucle único de render, intro
src/choreo.js              planos de cámara por sección e interpolación por scroll
src/chapters.js            efectos DOM de la historia (cotas, velocidad, cifras, raíl)
src/configurator.js        controles, giro con arrastre, enlace compartible
src/gallery.js             fotos de detalle renderizadas desde la escena + scroll horizontal
src/three/stage.js         renderer, calidad adaptativa, reflejo, titular en WebGL
src/three/car.js           carrocería procedural (loft), luces, aero
src/three/wheels.js        neumáticos, tres diseños de llanta, frenos
src/three/environment.js   entorno PMREM, asfalto mojado, lluvia, ciudad, farolas
src/style.css, sections.css
src/fonts-ja.css           generado por scripts/subset-kanji-css.py
```

Si cambias textos en japonés, vuelve a generar `src/fonts-ja.css`:

```bash
python scripts/subset-kanji-css.py
```

## Contacto de la demo

El botón «Agenda una demo» apunta a `mailto:hola@tuestudio.com`. Cámbialo en `index.html` por el correo real del estudio.

Más detalle sobre decisiones, rendimiento y validación en [FINAL_REPORT.md](FINAL_REPORT.md).
