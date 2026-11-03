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

### Hito 1 — Proyecto base con buenas prácticas · 🟡 en curso

- [x] `git init`, `.gitignore`, `.gitattributes`, primer commit con este plan
- [x] Crear la app Expo en `app/` (plantilla `default@sdk-58`)
- [x] TypeScript `strict`, ESLint, Prettier, scripts de `npm` (`lint`, `typecheck`, `format`, `check`)
- [x] Limpiar la plantilla: quitar la demo (`reset-project`) y el soporte web ([ADR 0003](decisiones/0003-solo-android-sin-demo.md))
- [x] *Development build* (`npx expo run:android`) en el emulador y en el teléfono. Requirió CMake 3.31.6 + config plugin ([ADR 0002](decisiones/0002-cmake-rutas-largas-windows.md))
- [x] `README.md`, `CLAUDE.md`, primeros ADRs (el plugin propio de MediaPipe quedó en el [ADR 0001](decisiones/0001-stack-tecnologico.md))
- [x] Hook que bloquea commits si `npm run check` falla
- [ ] Quiz del Hito 1

**Hecho cuando:** la app corre en ambos dispositivos y `lint` y `typecheck` pasan sin errores.
**Aprendes:** Expo vs React Native "pelado", Expo Go vs development build, Metro, *prebuild*
y CNG (*Continuous Native Generation*), estructura de un proyecto, Expo Router.

### Hito 2 — Cámara

- [ ] Instalar VisionCamera v5 y sus dependencias (Nitro, worklets)
- [ ] Permisos de cámara (configuración + pedido en tiempo de ejecución + qué pasa si el usuario los niega)
- [ ] Pantalla con vista previa de la cámara frontal
- [ ] Primer *frame processor* en JS que solo cuenta FPS

**Hecho cuando:** ves la cámara en el teléfono y un contador de FPS estable.
**Aprendes:** permisos de Android, componentes nativos, hilos (UI, JS, cámara), worklets.

### Hito 3 — Detección de la mano (código nativo)

- [ ] Módulo nativo local en `app/modules/` (Kotlin) como *frame processor plugin* de VisionCamera v5
- [ ] Integrar MediaPipe Hand Landmarker y empaquetar `hand_landmarker.task`
- [ ] Devolver los 21 puntos a JS con tipos de TypeScript
- [ ] Dibujar los puntos y huesos sobre la vista previa (la librería de dibujo se investiga en este hito)
- [ ] Medir rendimiento (ms por cuadro) en emulador vs teléfono

**Hecho cuando:** el esqueleto de tu mano se dibuja en vivo y sigue el movimiento con fluidez en el teléfono.
**Aprendes:** Kotlin básico, Gradle, Nitro Modules, puente JS ↔ nativo, formatos de imagen (YUV/RGB), coordenadas normalizadas.

### Hito 4 — Datos y entrenamiento (Python)

- [ ] Investigar si existen datasets públicos del alfabeto LSA (y sus licencias)
- [ ] Pantalla de captura en la app: eliges una letra y graba N muestras de puntos (**no** imágenes)
- [ ] Exportar las muestras a la PC (JSON o CSV) y armar el dataset en `ml/data/`
- [ ] Entorno Python aislado (`venv`) con dependencias fijadas
- [ ] Preprocesado: normalizar los puntos (posición, escala, mano izquierda o derecha)
- [ ] Entrenar el clasificador (Keras), evaluarlo (exactitud, matriz de confusión) y exportarlo a `.tflite`
- [ ] Probar el `.tflite` en la PC con `ai-edge-litert`

**Hecho cuando:** el modelo supera una exactitud acordada sobre datos que nunca vio en el entrenamiento, y se entiende por qué falla donde falla.
**Aprendes:** datasets, normalización, train/val/test, redes densas, sobreajuste, métricas, cuantización.

> Nota: algunas letras del alfabeto LSA llevan movimiento. En este hito trabajamos solo las
> estáticas y dejamos anotadas las dinámicas para el Hito 6.

### Hito 5 — Reconocimiento en la app

- [ ] **Decisión abierta:** dónde corre el clasificador. Las opciones son `react-native-fast-tflite` (trae LiteRT 1.4.0, posible choque con las librerías nativas de MediaPipe) o hacerlo en el mismo plugin Kotlin. Se decide con una prueba y queda en un ADR
- [ ] Integrar el modelo y mostrar la letra reconocida con su confianza
- [ ] Suavizado temporal (votación sobre los últimos N cuadros) para que no "parpadee"

**Hecho cuando:** deletreas palabras simples y la app las reconoce en vivo.
**Aprendes:** inferencia en el dispositivo, rendimiento, UX de resultados con incertidumbre.

### Hito 6 — Modo aprender y señas dinámicas (futuro)

- Modo juego: la app propone una letra, la haces y te dice si está bien
- Señas con movimiento: secuencias de puntos y un modelo temporal (LSTM/GRU). Candidato: dataset **LSA64**, revisando su licencia
- Tests automatizados (lógica de normalización y suavizado) y CI básica

---

## 5. Decisiones abiertas

| # | Decisión | Cuándo |
|---|---|---|
| 1 | Runtime del clasificador en la app | Hito 5 |
| 2 | Librería para dibujar el esqueleto sobre la cámara | Hito 3 |
| 3 | Gestor de entorno Python (`venv` + `pip` o alternativa) | Hito 4 |
| 4 | Fuente de datos del alfabeto LSA (propia vs pública) | Hito 4 |

---

## 6. Cómo retomar el trabajo en una sesión nueva

1. Abre este archivo y busca el primer `[ ]` sin marcar.
2. Revisa el último ADR en `docs/decisiones/`.
3. Dile a Claude: *"Seguimos con el Hito N, paso X"*.
