# Plan de trabajo — Señas (lab)

> **Objetivo único: aprender.** Este proyecto no busca entregar rápido, sino entender cada pieza:
> React Native, Expo, código nativo Android, visión por computadora y entrenamiento de modelos.
> Si una decisión acelera el proyecto pero se salta el aprendizaje, no la tomamos.

**Qué construimos:** una app Android en React Native que usa la cámara del teléfono para
detectar las manos y reconocer **LSA (Lengua de Señas Argentina)**. Empezamos por el
**alfabeto manual estático** y después pasamos a palabras con movimiento.

---

## 1. Cómo trabajamos

### Principios

1. **Investigar antes de usar.** Antes de adoptar una herramienta, librería o comando,
   verificamos en fuentes oficiales (docs, npm, PyPI, Maven) que esté vigente y mantenida.
   Nada se instala "por si acaso" ni "porque es lo habitual".
2. **Hacer y explicar después.** Claude avanza con autonomía y, al terminar cada tarea,
   explica qué hizo, qué decidió y por qué, con las alternativas. Las tareas grandes
   empiezan con un plan corto que puedes frenar.
3. **Participación activa.** Preguntas, revisas y decides el rumbo; los quizzes de cada
   hito fijan lo aprendido.
4. **Verificar, no suponer.** Después de cada paso comprobamos que funcionó de verdad, no
   solo que el comando terminó sin error. Un hook de Claude Code
   ([`.claude/hooks/check-before-commit.mjs`](../.claude/hooks/check-before-commit.mjs))
   bloquea cualquier commit si `npm run check` falla.
5. **Buenas prácticas desde el día 1.** TypeScript estricto, lint y formato automáticos,
   commits pequeños y descriptivos, decisiones documentadas.
6. **Privacidad por diseño.** Las imágenes de manos y caras son datos biométricos (PII).
   Todo se procesa en el teléfono, no se sube nada a servidores, y los datasets guardan
   solo coordenadas de la mano (nunca video), con el consentimiento de quien graba.
7. **Sin secretos en el repo.** Nada de tokens ni claves en el código ni en git. Si alguna
   vez hacen falta, van en variables de entorno o en archivos ignorados por git.

### Ciclo de cada paso

```text
Plan (si es grande) → Investigar → Ejecutar → Verificar → Documentar → Explicar → Preguntas
```

- **Documentar:** cada decisión relevante queda en un ADR (*Architecture Decision Record*)
  en [`docs/decisiones/`](decisiones/), con el contexto, las opciones evaluadas, la
  decisión y las fuentes.
- **Preguntas:** al cerrar cada hito hacemos una sesión corta de preguntas para fijar
  lo aprendido. También puedes pedir una en cualquier momento.

### Convenciones (se configuran en el Hito 1)

| Tema | Convención |
|---|---|
| Lenguaje | TypeScript en modo `strict` |
| Formato / lint | Prettier + ESLint (config oficial de Expo) |
| Commits | [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`… |
| Ramas | `main` siempre funciona; cada hito o tarea en su rama (`hito-1/scaffold`, …) |
| Documentación | Explicaciones en `docs/`, decisiones en `docs/decisiones/` |

---

## 2. Estructura del repositorio (objetivo)

```text
senhas/
├─ app/                 ← App React Native (Expo)
│  └─ modules/          ← Código nativo propio (plugin Kotlin de MediaPipe)
├─ ml/                  ← Python: captura → dataset → entrenamiento → export .tflite
├─ docs/
│  ├─ PLAN.md           ← Este archivo
│  ├─ decisiones/       ← ADRs
│  └─ aprendizaje/      ← Notas y conceptos explicados por hito
├─ CLAUDE.md            ← Contexto del proyecto para Claude
└─ README.md
```

---

## 3. Stack decidido (verificado el 2026-11-02)

| Capa | Pieza | Versión | Por qué |
|---|---|---|---|
| App | Expo SDK | 58 (React Native 0.88) | Estable actual. Solo usa la *New Architecture* |
| Cámara | `react-native-vision-camera` | 5.2.x | Activa; procesa cada cuadro (*frame processors*) con Nitro Modules |
| Mano | MediaPipe Tasks Android (`tasks-vision`) | 1.2.0 | Oficial de Google, 21 puntos por mano. Lo envolvemos **en un plugin Kotlin propio**, porque las librerías de la comunidad están abandonadas |
| Clasificador | Modelo propio en LiteRT (`.tflite`) | — | Entrenado por nosotros. **El runtime en la app se decide en el Hito 5** |
| Entrenamiento | Python 3.12 + `mediapipe` 1.2.0 + `tensorflow` 2.21 + `ai-edge-litert` 2.3.0 | — | Mismo modelo de mano en la PC y en el teléfono |

**Descartados:** Android Studio (alcanzan VS Code y la CLI), `react-native-mediapipe`,
`react-native-mediapipe-vision`, `expo-vision-camera-v4-mediapipe` (sin mantenimiento o solo
compatibles con VisionCamera v4), `mediapipe-model-maker` (último release: abril de 2024), y
servicios con LLM o tokens (todo corre en el teléfono).

---

## 4. Hitos

Cada hito tiene un **criterio de hecho** verificable y una lista de **lo que vas a aprender**.

### Hito 0 — Entorno de desarrollo · ✅ completo

- [x] JDK 17 (Microsoft OpenJDK) + `JAVA_HOME`
- [x] Android SDK por línea de comandos + `ANDROID_HOME` + `Path`
- [x] `platform-tools`, `emulator`, imagen `android-35` (x86_64)
- [x] AVD `senhas_pixel` (perfil Pixel 7), aceleración WHPX verificada
- [x] Android CLI con métricas desactivadas (`.androidrc`)
- [x] Android Studio desinstalado (no hace falta)
- [x] Webcam en el emulador: Logitech C270 = `webcam2` en `config.ini` (la VGA fallaba con `BGR4 → I420`). Ojo: las etiquetas `webcamN` cambian si conectas o desconectas cámaras; revisar con `emulator -webcam-list -avd senhas_pixel`
- [x] Primer arranque del emulador + `adb devices` lo lista (`emulator-5554`, Android 15)
- [x] Teléfono físico conectado por USB (Android 16, `arm64-v8a`)

**Hecho cuando:** `adb devices` muestra el emulador y el teléfono, y la app Cámara del emulador ve tu webcam.
**Aprendes:** JDK y Gradle, SDK, `adb`, AVD, virtualización, variables de entorno.

### Hito 1 — Proyecto base con buenas prácticas · ✅ completo

- [x] `git init`, `.gitignore`, `.gitattributes`, primer commit con este plan
- [x] Crear la app Expo en `app/` (plantilla `default@sdk-58`)
- [x] TypeScript `strict`, ESLint, Prettier, scripts de `npm` (`lint`, `typecheck`, `format`, `check`)
- [x] Limpiar la plantilla: quitar la demo (`reset-project`) y el soporte web ([ADR 0003](decisiones/0003-solo-android-sin-demo.md))
- [x] *Development build* (`npx expo run:android`) en el emulador y en el teléfono. Requirió CMake 3.31.6 + config plugin ([ADR 0002](decisiones/0002-cmake-rutas-largas-windows.md))
- [x] `README.md`, `CLAUDE.md`, primeros ADRs (el plugin propio de MediaPipe quedó en el [ADR 0001](decisiones/0001-stack-tecnologico.md))
- [x] Hook que bloquea commits si `npm run check` falla
- [x] Quiz del Hito 1 (2/4: repasar la división JS ↔ nativo en el Hito 2)

**Hecho cuando:** la app corre en ambos dispositivos y `lint` y `typecheck` pasan sin errores.
**Aprendes:** Expo vs React Native "pelado", Expo Go vs development build, Metro, *prebuild*
y CNG (*Continuous Native Generation*), estructura de un proyecto, Expo Router.

### Hito 2 — Cámara · ✅ completo

- [x] Instalar VisionCamera v5 y sus dependencias (Nitro, worklets)
- [x] Permisos de cámara (configuración + pedido en tiempo de ejecución + qué pasa si el usuario los niega)
- [x] Pantalla con vista previa de la cámara frontal
- [x] Primer *frame processor* en JS que solo cuenta FPS (formato `yuv`: `native` falla en el emulador)
- [x] Emulador: la webcam como cámara **frontal** (`hw.camera.front=webcam2`, `hw.camera.back=emulated`)
- [x] Probar en el teléfono físico y comparar FPS (emulador: 18–21 FPS con la Logitech C270; teléfono Xiaomi: 25+ FPS, con la capa extra de permisos de MIUI funcionando)
- [x] Quiz del Hito 2 (2/4: `app.json` también es nativo → recompilar)

**Hecho cuando:** ves la cámara en el teléfono y un contador de FPS estable.
**Aprendes:** permisos de Android, componentes nativos, hilos (UI, JS, cámara), worklets.

### Hito 3 — Detección de la mano (código nativo) · ✅ completo

- [x] Módulo nativo local en `app/modules/` (Kotlin) como *frame processor plugin* de VisionCamera v5 ([ADR 0004](decisiones/0004-plugin-hand-landmarker.md))
- [x] Integrar MediaPipe Hand Landmarker y empaquetar `hand_landmarker.task` (se descarga al compilar, con SHA-256 verificado)
- [x] Devolver los 21 puntos a JS con tipos de TypeScript
- [x] Dibujar los puntos y huesos sobre la vista previa (Skia 2.14 + shared values de Reanimated)
- [x] Puntos en coordenadas verticales (MediaPipe los devuelve en coordenadas del sensor) y cuadros que siguen a la pantalla al girar el teléfono
- [x] Cámara pausada en segundo plano (`isActive` según `AppState`)
- [x] Medir rendimiento (ms por cuadro) en emulador vs teléfono. Teléfono: ~23 FPS, copia 5 ms, MediaPipe ~50 ms. Emulador: ~8–11 FPS, copia 7–10 ms, MediaPipe ~70–100 ms
- [x] Quiz del Hito 3 (2/4: un spec `.nitro.ts` también termina en el APK → nitrogen + recompilar; espejado ≠ rotación)
- [ ] *Pendiente para más adelante:* probar el delegado GPU en el teléfono para bajar los ~50 ms de MediaPipe

**Hecho cuando:** el esqueleto de tu mano se dibuja en vivo y sigue el movimiento con fluidez en el teléfono.
**Aprendes:** Kotlin básico, Gradle, Nitro Modules, puente JS ↔ nativo, formatos de imagen (YUV/RGB), coordenadas normalizadas.

### Hito 4 — Datos y entrenamiento (Python)

- [x] Detectar y dibujar **las dos manos** (algunas señas LSA son bimanuales): `numHands: 2` y overlay por bloques de 21 puntos. Costo en el emulador: 4–6 FPS y MediaPipe 112–145 ms con dos manos, contra ~12 FPS y ~60 ms con una. En modo VIDEO, MediaPipe solo se saltea la detección de palmas si ya sigue `numHands` manos ([hand_landmarker_graph.cc](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/hand_landmarker/hand_landmarker_graph.cc)). Por eso es **configurable** (`useHandTracking({ numHands })`, botón "1 mano / 2 manos") con **1 por defecto**; a futuro, una seña podría activar el modo de dos manos. Cambiar el valor recrea el landmarker, y el plugin Kotlin sincroniza `detect`/`dispose` para no liberar MediaPipe en medio de una inferencia. *Pendiente:* medir en el teléfono
- [x] Investigar qué existe para LSA: **no hay datasets públicos del alfabeto manual**; grabamos datos propios con un protocolo tipo juego ([ADR 0005](decisiones/0005-datos-propios-captura-tipo-juego.md))

**Idea central:** a cada persona la grabamos **una sola vez**, unos 7–8 minutos, con **las 28 letras**.
Por eso la captura guarda todo lo que vamos a necesitar después, aunque al principio solo
entrenemos las letras estáticas. Todo corre en el teléfono: sin servidor ni internet.

Las letras se agrupan en **4 niveles** (clasificación provisional, sacada de la lámina de la CAS;
se confirma en la etapa 4.2):

| Nivel | Letras | Qué tienen |
|---|---|---|
| 1 | A B C D K L M N O P R U V1 | Estáticas, una mano, sin contacto con el cuerpo. M, N y P apuntan hacia abajo |
| 2 | E F G I S T V2 Y | Estáticas, apoyadas en la cara o el cuerpo |
| 3 | CH H J Z | Con movimiento |
| 4 | Ñ Q W X | Con dos manos |

#### Etapa 4.1 — Cerrar el puente JS ↔ nativo

- [x] Ejercicio práctico: cambiar un spec sin nitrogen ni recompilar (`worldLandmarks`). Sin nitrogen, el `DetectedHand` generado no tiene el campo: TypeScript compila, pero en runtime llega `undefined`. Solución: `npx nitrogen`, llenarlo en Kotlin y recompilar
- [x] `worldLandmarks` (puntos en metros, centrados en la mano) disponibles en JS, en orientación vertical igual que los normalizados (MediaPipe los rota con el mismo `hand_rect`: [world_landmark_projection_calculator.cc](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/calculators/util/world_landmark_projection_calculator.cc)). Verificado en el emulador con imagen girada (720×1280): la dirección muñeca→nudillo medio coincide en ambos (coseno 0,96–1,00)

#### Etapa 4.2 — Estudiar el alfabeto y armar el catálogo

- [x] Aprender los parámetros de una seña (configuración, orientación, ubicación, movimiento, rasgos no manuales) y qué ve nuestro sistema de cada uno → [notas](aprendizaje/parametros-de-la-sena.md)
- [ ] **(Nico)** Confirmar la clasificación de las 28 letras con el video de la CAS (hay discrepancias, p. ej. J y Q) y marcar `verified: true` en `letters.json`. La lista para revisar está en las [notas](aprendizaje/parametros-de-la-sena.md#para-confirmar-con-el-video-de-la-cas)
- [x] **Paquete de lengua** `ml/languages/aed/` (ISO 639-3 de la LSA) con [`letters.json`](../ml/languages/aed/letters.json): letra, nivel, manos, movimiento, ubicación y color del guante. El entrenamiento **genera** el `manifest.json` junto al `.tflite` ([ADR 0006](decisiones/0006-paquetes-de-lengua.md))

#### Etapa 4.3 — Qué guarda cada muestra (antes de grabar a nadie)

- [ ] **Referencia del cuerpo, activable y desactivable** (como `numHands`): Hand Landmarker no ve la cara, y sin una referencia E, F, G, I, S, T e Y se confunden con otras. Se guardan **puntos mínimos**, nunca la malla de la cara (468 puntos, mucho más identificable). Candidatos, a medir en el teléfono antes de elegir (va en un ADR):
  - **Face Detector** (BlazeFace): 6 puntos (ojos, punta de la nariz, boca, tragos de las orejas), ~3 ms en CPU en un Pixel 6. Muy barato, pero no ve el pecho ni el cuello (letra F)
  - **Pose Landmarker** (variante lite): de sus 33 puntos guardamos solo 0–12 (nariz, ojos, orejas, comisuras de la boca, hombros). Cubre pecho y cuello, pero cuesta más
  - Alcanza con una ubicación **aproximada**: con el Face Detector, cuello y pecho se pueden **estimar** a partir del cuadro de la cara (una o dos alturas de cara por debajo del mentón). Si eso alcanza para separar la F, gana el Face Detector por liviano. Se prueban ambos y se descarta uno
- [ ] La captura la activa sola en los niveles que la necesitan (2 y 3)
- [ ] Formato de la sesión con versión de esquema: persona (`P01`…), mano dominante, fecha, y por cada letra y ronda la **secuencia** de cuadros (timestamp, lateralidad, landmarks, worldLandmarks, referencia del cuerpo). Guardar secuencias sirve para todo: de una estática se toman cuadros sueltos; de una dinámica, la secuencia entera

#### Etapa 4.4 — Guardar y exportar en el teléfono

Escenario: varios teléfonos graban en paralelo y después todo se junta en uno principal.

- [ ] **SQLite** (`expo-sqlite`) como almacén en cada teléfono: sesiones, letras, rondas y cuadros; permite contar muestras, filtrar y borrar
- [ ] **Exportar una sesión** a un archivo (JSON con versión de esquema) y compartirlo con el sistema (`expo-sharing`)
- [ ] **Importar** archivos de sesión en el teléfono principal (`expo-document-picker`), detectando duplicados
- [ ] Identificadores que no choquen entre teléfonos: cada sesión con un UUID; el código de persona (`P01`…) puede repetirse en dos teléfonos, así que la importación avisa
- [ ] Exportar todo a la PC para entrenar (`ml/languages/aed/data/`, fuera de git)
- [ ] Borrar sesiones desde la app (si alguien retira su consentimiento)
- [ ] ADR con el esquema y el formato de intercambio

#### Etapa 4.5 — El guante

- [ ] Componente Skia que dibuja la mano como un **guante** relleno (dedos redondeados + palma) a partir de los 21 puntos, con el **color de la letra**
- [ ] Grabar la **referencia**: vos hacés cada letra (bien aprendida del video de la CAS) y esos puntos alimentan el guante de ejemplo. Así no usamos imágenes ajenas (la lámina de la CAS tiene todos los derechos reservados)

#### Etapa 4.6 — Pantalla de captura tipo juego

- [x] **Menú inicial** con la cámara apagada: *Detectar* (la vista en vivo), *Grabar datos* (4 niveles, desactivados hasta esta etapa) y *Ejercicios* (por definir). Al volver al menú, la cámara se cierra y el landmarker se libera
- [ ] Inicio: consentimiento, identificador sin nombre (`P01`…), mano dominante, elegir niveles (por defecto, todos)
- [ ] Ciclo por letra: **preparate** (≈1,5 s, letra grande + guante de ejemplo; no se guarda) → **grabando** (≈2 s; ≈3 s para el nivel 3, con cuenta regresiva) → siguiente
- [ ] **3 rondas** con las letras en orden aleatorio; botón **repetir** si salió mal
- [ ] Modo de dos manos automático en el nivel 4 (`numHands` según la letra)
- [ ] Resumen final: muestras por letra

#### Etapa 4.7 — Piloto y grabación

- [ ] Piloto con vos en el **teléfono** (no el emulador): ajustar tiempos y textos
- [ ] Grabar a 3–5 personas, cada una con su consentimiento; exportar a `ml/languages/aed/data/` (fuera de git)

#### Etapa 4.8 — Entrenamiento (nivel 1)

- [ ] Entorno Python aislado (`venv`) con dependencias fijadas
- [ ] Preprocesado: normalizar posición, escala y mano izquierda o derecha. **Conservar la orientación** respecto de la pantalla: M, N y P se distinguen porque apuntan hacia abajo
- [ ] Entrenar el clasificador del nivel 1 (Keras), evaluarlo **dejando afuera a una persona por vez** (exactitud, matriz de confusión) y exportarlo a `.tflite`
- [ ] Probar el `.tflite` en la PC con `ai-edge-litert`

**Hecho cuando:** hay un dataset de 3–5 personas con las 28 letras, y el modelo del nivel 1 supera una exactitud acordada con personas que nunca vio, y se entiende por qué falla donde falla.
**Aprendes:** protocolos de captura, consentimiento, formatos de datos versionados, normalización, train/val/test, redes densas, sobreajuste, métricas, cuantización.

> Los niveles 2, 3 y 4 se entrenan después (Hito 6), con los datos que ya grabamos acá.

### Hito 5 — Reconocimiento en la app

- [ ] **Decisión abierta:** dónde corre el clasificador. Las opciones son `react-native-fast-tflite` (trae LiteRT 1.4.0, posible choque con las librerías nativas de MediaPipe) o hacerlo en el mismo plugin Kotlin. Se decide con una prueba y queda en un ADR
- [ ] Integrar el modelo y mostrar la letra reconocida con su confianza
- [ ] Suavizado temporal (votación sobre los últimos N cuadros) para que no "parpadee"

**Hecho cuando:** deletreas palabras simples y la app las reconoce en vivo.
**Aprendes:** inferencia en el dispositivo, rendimiento, UX de resultados con incertidumbre.

### Hito 6 — Modo aprender y señas dinámicas (futuro)

- Modo juego: la app propone una letra, la haces y te dice si está bien
- Entrenar los niveles 2, 3 y 4 del alfabeto con los datos grabados en el Hito 4 (referencia del cuerpo, secuencias y dos manos)
- Señas con movimiento: secuencias de puntos y un modelo temporal (LSTM/GRU). Candidato: dataset **LSA64** (CC BY-NC-SA 4.0: uso no comercial, derivados con la misma licencia; tiene video de personas, usarlo solo en local)
- Tests automatizados (lógica de normalización y suavizado) y CI básica

---

## 5. Decisiones abiertas

| # | Decisión | Cuándo |
|---|---|---|
| 1 | Runtime del clasificador en la app | Hito 5 |
| ~~2~~ | ~~Librería para dibujar el esqueleto sobre la cámara~~ → Skia ([ADR 0004](decisiones/0004-plugin-hand-landmarker.md)) | ✅ Hito 3 |
| 3 | Gestor de entorno Python (`venv` + `pip` o alternativa) | Hito 4 |
| ~~4~~ | ~~Fuente de datos del alfabeto LSA (propia vs pública)~~ → propia, captura tipo juego ([ADR 0005](decisiones/0005-datos-propios-captura-tipo-juego.md)) | ✅ Hito 4 |
| 5 | Referencia del cuerpo, activable: Face Detector (6 puntos) vs Pose Landmarker lite (puntos 0–12). Se mide en el teléfono | Hito 4, etapa 4.3 |
| ~~6~~ | ~~Almacenamiento en el teléfono~~ → SQLite + exportar/importar sesiones como archivo | ✅ Hito 4, etapa 4.4 |

---

## 6. Cómo retomar el trabajo en una sesión nueva

1. Abre este archivo y busca el primer `[ ]` sin marcar.
2. Revisa el último ADR en `docs/decisiones/`.
3. Dile a Claude: *"Seguimos con el Hito N, paso X"*.
