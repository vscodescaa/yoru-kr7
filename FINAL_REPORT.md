# YORU KR-7: informe final

## Qué construí

Una experiencia web de una sola página para presentar un coche conceptual ficticio, el **YORU KR-7**, un coupé biturbo de inspiración JDM. Todo ocurre de noche, bajo la lluvia, en una calle mojada con letreros de neón, farolas de sodio y una ciudad que se pierde en la bruma.

La página tiene nueve momentos, todos sobre una única escena 3D que nunca se recarga:

| Sección | Qué pasa |
|---|---|
| **Carga e intro** | Pantalla negra, la ciudad aparece con la exposición, la cámara se acerca, la línea LED delantera arranca con un parpadeo y el titular «KR-7» se revela desde el centro. Es el único movimiento que no dispara el usuario. |
| **Hero** | El titular gigante vive *dentro* de la escena WebGL, detrás del coche: el coche lo tapa como en una portada de revista. El ratón mueve la cámara unos centímetros. |
| **Transición** | Al hacer scroll el titular se expande y se desvanece mientras la cámara gira 90° hasta el perfil. |
| **影 Silueta** | Perfil puro. El titular se revela con un barrido de luz y aparecen cotas de plano técnico (4.460 mm, 1.215 mm) **proyectadas desde el coche 3D real**, no dibujadas encima. |
| **光 Luz** | Primer plano trasero teñido de rojo. Los cuatro pilotos circulares se encienden uno a uno con el scroll, de dentro hacia fuera, y el titular toma su color. |
| **風 Aire** | Vista cenital trasera. La carretera, las farolas, las ruedas y los reflejos se ponen en marcha; el velocímetro sube de 0 a 250 km/h y el titular se ensancha de 62 % a 125 % de anchura tipográfica con la velocidad. |
| **心 Corazón** | Plano bajo frontal con los faros. Cuatro cifras técnicas que cuentan al ritmo del scroll. |
| **Configurador** | Seis pinturas, tres diseños de llanta, tres acabados, ala GT o ducktail, altura de suspensión, faros y tres vistas. Se gira arrastrando, con inercia. Genera un código de configuración y un enlace que reproduce exactamente el coche. |
| **Detalles** | Galería horizontal con cinco primeros planos. Las imágenes **se renderizan en el navegador desde la misma escena y con la configuración elegida**: si pintas el coche de azul, las fotos salen azules. |
| **Cierre** | El coche se aleja por la carretera mojada mientras aparece la llamada a la acción para clientes («Agenda una demo», «Recorrerlo de nuevo»). |

## Stack

| Pieza | Por qué |
|---|---|
| **Vite 8 + JavaScript sin framework** | No hay estado de aplicación que justifique React; sin capa intermedia entre el scroll y el render. |
| **Three.js 0.186** | Control total sobre cada draw call, materiales, resolución y presupuesto de fotograma. |
| **GSAP 3.15 + ScrollTrigger** | Entradas de texto ligadas al scroll, galería horizontal fijada, transiciones del configurador. |
| **Lenis 1.3** | Scroll suave sincronizado con el mismo `gsap.ticker` que dibuja la escena: un único bucle por fotograma. |
| **Archivo (variable) y Shippori Mincho B1** | Autoalojadas con fontsource; la japonesa recortada a los 19 kanji que se usan. |

No hay modelos 3D, vídeos ni imágenes descargadas. El coche, la ciudad, la lluvia, las texturas de los letreros y las fotos de la galería se generan en tiempo real. El build completo ocupa 1,6 MB, y el navegador solo descarga una parte (≈215 KB de JS comprimido, 8 KB de CSS y los fragmentos de fuente necesarios).

## Decisiones visuales

**Paleta.** Tinta nocturna azulada (`#04060c`), hueso (`#e8e9ee`) para el texto, y tres luces con significado: rojo de piloto (`#ff2338`), blanco LED frío (`#cfe0ff`) y azul neón (`#46c2ff`). El ámbar de sodio solo existe dentro de la escena (farolas, reflejos en el asfalto), nunca en la interfaz.

**Tipografía como motor.** Archivo variable tiene un eje de anchura de 62 % a 125 %. Lo usé como instrumento: titulares anchos y pesados (el lenguaje de los badges y la cartelería automotriz) y, en el capítulo Aire, la anchura del titular es literalmente la velocidad. Los kanji en Shippori Mincho, en contorno fino, aportan la elegancia caligráfica frente a la agresividad del grotesk.

**Capítulos con identidad propia.** Cada capítulo tiene un plano de cámara, una luz dominante (fría, roja, azul, cálida), una composición distinta y un único gesto de movimiento: barrido, encendido, aceleración, cuenta. Los kanji 影 光 風 心 (sombra, luz, viento, corazón) son los marcadores de capítulo, y el raíl lateral los recuerda porque sí son una secuencia.

**El coche como protagonista, el texto como portada.** El titular del hero está detrás del coche en profundidad real. Las cotas de la Silueta salen del modelo. El texto del configurador se mantiene en un panel sobrio para no competir con el coche.

**Lo que evité a propósito.** Etiquetas en mayúsculas encima de cada título, tarjetas idénticas con sombra, entradas de «aparece y sube» en todas las secciones, flechas en los botones, numeraciones decorativas y `backdrop-filter` (además de verse genérico, cuesta caro sobre un canvas que cambia cada fotograma).

## Qué parte usa Spline

**Ninguna en la versión final**, por decisión técnica:

1. **No hay forma de llevar la escena a la web sin intervención manual.** El MCP de Spline crea y edita escenas dentro del editor, pero no exporta ni publica el `.splinecode` que necesita el runtime. Habría tenido que pedirte que exportaras a mano, y el encargo pedía no depender de validaciones intermedias.
2. **Rendimiento en la GT 1030.** El runtime de Spline añade su propio renderer (más de 1 MB) sin control fino sobre resolución, reflejos ni presupuesto de fotograma. Con Three.js directo la escena corre a 60 fps en tu equipo (cifras abajo).
3. **Generación con IA.** Spline puede generar modelos 3D con IA, pero consume créditos de tu cuenta y su topología no sirve para un configurador (pintura, cristal y llantas separados). No lo usé sin que lo pidieras.

**Dónde encajaría Spline:** si se quiere un coche modelado a mano en lugar del procedural, se puede modelar en Spline, exportarlo a GLB y cargarlo con `GLTFLoader` reutilizando los materiales, el reflejo, las luces y el configurador tal como están. Solo cambiaría `src/three/car.js`.

## Cómo optimicé para la GT 1030

**Resultados medidos con Playwright sobre tu GPU real** (Chrome 154, `ANGLE (NVIDIA GeForce GT 1030 Direct3D11)`), recorriendo la página entera con la rueda del ratón:

| Viewport | FPS medio | p95 | p99 | Fotogramas > 33 ms |
|---|---|---|---|---|
| 1600 × 900 | 59,6 | 16,8 ms | 16,9 ms | 2 de 949 |
| 1920 × 1080 | 59,2 | 16,8 ms | 16,9 ms | 6 de 950 |

Los picos coinciden con la generación de las fotos de la galería (una por fotograma, solo cuando cambia la configuración). La escena dibuja unos 104.000 triángulos en 149 draw calls, con 7 texturas.

Qué lo hace posible:

- **Un solo canvas y un solo bucle.** Lenis, ScrollTrigger y el render comparten `gsap.ticker`. La escena no se reconstruye nunca; las secciones solo mueven la cámara y cambian parámetros.
- **Sin post-procesado.** El *bloom* son sprites aditivos sobre cada luz. El grano y la viñeta son CSS estático.
- **Reflejo del asfalto sin render target.** Es un clon espejado del coche que comparte geometrías y materiales (sin chasis ni bajos). El asfalto, semitransparente en los charcos, lo deja ver.
- **Reflejos de neón en espacio de pantalla.** Diez luces de la ciudad se proyectan a pantalla cada fotograma y el shader del suelo dibuja sus estelas, sin una segunda pasada.
- **Iluminación precalculada.** El entorno (softboxes, neones, halo de ciudad) se hornea una sola vez en un mapa PMREM. Solo hay dos luces dinámicas y ninguna sombra en tiempo real: la de contacto es una textura degradada.
- **Geometría barata.** La lluvia son 1.600 líneas en una sola draw call animadas en GPU; los edificios, una `InstancedMesh`; las farolas, una geometría fusionada.
- **Resolución adaptativa.** El DPR arranca en 1–1,25 (máximo 1,5). Cada 90 fotogramas se mide el tiempo medio: si pasa de 21 ms baja la resolución hasta 0,6 y, si aún no basta, apaga el reflejo. Si sobra margen, la sube poco a poco.
- **Se deja de dibujar cuando no se ve.** Mientras la galería tapa el lienzo, el render se pausa.
- **Calidad baja para móviles** (o con `?q=low`): materiales estándar en lugar de *clearcoat*, menos estaciones en la carrocería, menos lluvia, sin antialiasing MSAA.
- **Shaders compilados antes de mostrar nada** (`compileAsync`) para que la intro no dé tirones.

## Qué validé con Playwright

Todo lo verifiqué yo, sin pedirte nada, con el navegador de Playwright corriendo en tu PC:

- **Visual, sección por sección**, a 1600 × 900, 1920 × 1080 y 390 × 844 (móvil), con varias rondas de corrección. Las capturas finales están en `docs/screenshots/`.
- **Iteraciones que salieron de esas revisiones:** el grano CSS lavaba los negros; la pintura se veía negra en los laterales (añadí paneles de reflejo al entorno); el reflejo del chasis parecía una losa negra (lo excluí del espejo); el fondo competía con el coche; el panel del configurador tapaba el coche; el titular del cierre tapaba el coche; la foto de escapes no tenía sujeto (la cambié); en móvil las fotos se recortaban mal (ahora se capturan con proporción fija); en móvil el configurador pasó a panel inferior con el coche arriba; el ducktail sobresalía de la cola.
- **Rendimiento** en la GT 1030 real (tabla de arriba), confirmando el renderer de la GPU para descartar un renderer por software.
- **Configurador funcional:** clics reales en pintura, llanta, acabado, aerodinámica, altura, faros y vistas; arrastre con el ratón; «Copiar enlace» (portapapeles leído de vuelta) y recarga con ese enlace restaurando exactamente la misma configuración.
- **Galería:** las cinco imágenes se generan con el tamaño correcto (1280 × 800 y 800 × 1000) y el render se pausa mientras la galería cubre la pantalla.
- **Navegación** del menú a Configurar y Detalles, aterrizando exactamente al inicio de cada sección y sin deriva posterior.
- **Movimiento reducido** (`prefers-reduced-motion`): sin intro animada, scroll nativo, lluvia atenuada.
- **Build de producción** servido con `vite preview`: cero errores de consola, cero peticiones fallidas, las tres fuentes cargadas.
- **Sin desbordamiento horizontal** en móvil.

## Pendiente o mejorable

- **El coche es procedural.** Convence de noche y en movimiento, pero no tiene interior visible, dibujo en el neumático ni juntas más allá de las puertas. Para un cliente real, el siguiente paso es un modelo hecho a mano (Spline, Blender) cargado como GLB sobre esta misma base.
- **Solo probado en Chromium.** No lo validé en Safari, Firefox ni en teléfonos reales; el móvil se comprobó emulando el viewport, así que el arrastre táctil y el rendimiento en GPU móvil están sin medir.
- **El correo de contacto es un marcador:** `hola@tuestudio.com` en `index.html`.
- **Sin sonido.** Un ambiente de lluvia y un arranque de motor discretos, activables por el usuario, sumarían mucho en una presentación en directo.
- **Picos al generar la galería:** 2–6 fotogramas lentos al rehacer las fotos tras cambiar la configuración. Se podrían repartir en `requestIdleCallback` o generar a menor resolución.
- **Bundle:** three.js es casi todo el JavaScript (215 KB comprimidos). Se podría cargar la escena con `import()` dinámico para pintar el texto aún antes.
- **No pasé Lighthouse** ni una auditoría de accesibilidad completa. Los kanji son decorativos (`aria-hidden`), los controles tienen nombres accesibles y foco visible, pero falta revisar el contraste de algunos textos secundarios sobre la escena.
- **Durante una de las pruebas automáticas** vi el scroll avanzar solo después de una ráfaga de eventos de rueda. No se reprodujo en pruebas dedicadas (carga, 8 s de reposo y navegación por menú quedan quietas), así que lo atribuyo al arnés de pruebas, pero conviene vigilarlo en una prueba manual.
