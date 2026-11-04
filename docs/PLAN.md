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
- [x] **(Nico)** Confirmar la clasificación de las 28 letras con el video de la CAS: todo coincide. Aporte: **C y E son un par mínimo** (misma forma de mano; la E se hace en el ojo), marcado con `sameHandshapeAs`. Las dos variantes de la V son clases propias (`V1`, `V2`) que se reconocen como V
- [x] **Paquete de lengua** `ml/languages/aed/` (ISO 639-3 de la LSA) con [`letters.json`](../ml/languages/aed/letters.json): letra, nivel, manos, movimiento, ubicación y color del guante. El entrenamiento **genera** el `manifest.json` junto al `.tflite` ([ADR 0006](decisiones/0006-paquetes-de-lengua.md))

#### Etapa 4.3 — Qué guarda cada muestra (antes de grabar a nadie)

- [x] **Referencia del cuerpo, activable** (`bodyReference: 'none' | 'face' | 'pose'`, apagada por defecto), con **puntos mínimos**, nunca la malla de la cara. Los dos candidatos implementados en el plugin y medidos en el teléfono ([ADR 0009](decisiones/0009-referencia-del-cuerpo.md)):
  - **Face Detector** (6 puntos): ~31 ms, 9 FPS en total. **Elegido**
  - **Pose Landmarker lite** (puntos 0–12): ~66 ms, 7 FPS en total
  - Sin referencia: 15 FPS. La orientación de los puntos quedó verificada en los dos (ojos arriba de la boca; nariz arriba de los hombros)
  - *Provisional:* el pecho (F) se estima desde la cara; si no alcanza, pose solo para la F
- [x] La captura la activa sola en las letras con `location` distinta de `neutral` (niveles 2 y 3). El log de depuración cuenta en cuántos cuadros se vio la cara
- [x] Formato de la sesión versionado: persona (código automático), mano dominante, fecha, y por cada letra y ronda la **secuencia** de cuadros (tiempo, lateralidad, landmarks, worldLandmarks y `body`, la referencia del cuerpo). De una estática se toman cuadros sueltos; de una dinámica, la secuencia entera

#### Etapa 4.4 — Guardar y exportar en el teléfono

Escenario: varios teléfonos graban en paralelo y después todo se junta en uno principal.

- [x] **SQLite** (`expo-sqlite`) como almacén en cada teléfono: sesiones y tomas (cuadros en JSON, tamaño de imagen). Migraciones con `PRAGMA user_version` (v2: tamaño de imagen, probada en el teléfono). Las tomas repetidas se marcan como descartadas
- [x] **Exportar una sesión** a un JSON versionado (`formatVersion` 2) y compartirlo con el sistema (`expo-sharing`)
- [ ] **Importar** archivos de sesión en el teléfono principal (`expo-document-picker`), detectando duplicados
- [x] Identificadores que no choquen entre teléfonos: cada sesión y cada toma con un UUID (`expo-crypto`). Pendiente con la importación: avisar si un código de persona (`P01`…) se repite
- [x] Pasar las sesiones a la PC por USB, sin la nube: `ml/pull_sessions.py` (`adb run-as`) → `ml/languages/aed/data/` (fuera de git)
- [ ] Pantalla de sesiones: listar, exportar y **borrar** (si alguien retira su consentimiento). Mientras tanto, se borra con `adb run-as`
- [x] [ADR 0007](decisiones/0007-almacenamiento-y-exportacion.md): esquema y formato de intercambio

#### Etapa 4.5 — El guante

- [x] Componente Skia `GuideHand`: la mano como **guante** (palma rellena, dedos con trazo grueso y redondeado, contorno oscuro) con el **color de la letra**, espejado como la cámara; la cara esquemática (ojos, nariz, boca) para ver dónde va la mano; dos manos en el nivel 4; **animado** en las letras con movimiento, con el rastro del índice
- [x] **Referencias desde las sesiones de Nico** (`ml/build_references.py` → `models/references.json`, fuera de git): por letra, la toma más firme y su cuadro más típico; en las de movimiento, la toma más completa, recortada y submuestreada. Las 29 clases. No se usa la lámina de la CAS (todos los derechos reservados): Nico propuso usarla o generar dibujos nuevos a partir de ella, y se eligió dibujar desde datos propios
- [x] La captura muestra la guía al lado de la letra, mientras se prepara y mientras graba

#### Etapa 4.6 — Pantalla de captura tipo juego

- [x] **Menú inicial** con la cámara apagada: *Detectar* (la vista en vivo), *Grabar datos* (4 niveles, desactivados hasta esta etapa) y *Ejercicios* (por definir). Al volver al menú, la cámara se cierra y el landmarker se libera
- [x] **Versión mínima del nivel 1**, para el piloto (sin guante ni cara): el catálogo se lee de `ml/` (Metro con `watchFolders`), el hook graba los cuadros entre `startRecording` y `stopRecording`
- [x] Inicio: consentimiento, **código asignado automáticamente** (`P-7F3A`, sin nombres), mano dominante y **segundos de grabación** (3 por defecto, entre 0 y 10). *Pendiente:* elegir varios niveles en una sesión
- [x] Ciclo por letra: **preparate** (1,5 s, letra grande con su color; no se guarda) → **grabando** (los segundos elegidos) → siguiente. Si la mano no se vio (menos del 30% de los cuadros), la toma no se guarda y **se repite la letra**. *Pendiente:* guante de ejemplo y cuenta regresiva
- [x] El esqueleto se muestra también mientras se graba: confirma que la mano se está detectando
- [x] **3 rondas** con las letras en orden aleatorio; botón **repetir** la última toma
- [x] Modo de dos manos automático según la letra (`numHands` = `hands` del catálogo)
- [x] Resumen final: cuadros con mano por letra (avisa si hay pocos) y exportar
- [x] **Log de depuración** oculto (pulsación larga sobre el título del menú): sesiones, tomas con cuadros y cuadros con mano, exportaciones y errores
- [x] Nivel 2 habilitado (con la referencia de la cara; el guante sigue pendiente)
- [x] **Nivel 3 habilitado** (CH, H, J, Z): sin la regla de quietud (moverse es la letra); en su lugar se registra cuánto recorrió la punta del índice, en distancias entre ojos, para aprender qué es un movimiento normal antes de poner una regla
- [x] Primera sesión del nivel 3 (P-924B): con los movimientos rápidos la mano se pierde (en la Z r2, 23/45 cuadros con mano; ~9 FPS con la cara). El momento del movimiento varía mucho dentro de la toma. El recorrido va de 9 a 28 distancias entre ojos (la Z, la que más); la CH casi no se desplaza (rota)
- [x] Segunda sesión del nivel 3 (P-9784), **más lenta de lo natural** (lo hizo así para que el sistema lo tome): la mano se siguió en casi todos los cuadros y cada letra tiene su recorrido (CH ≈5, J ≈8–11, Z ≈13–18, H ≈16–17)
- [x] **Nivel 3 con DTW + vecino más cercano** (`ml/signs/sequences.py`, `train_sequences.py`): ubicación respecto de los ojos + normal de la palma, recortando lo quieto y remuestreando a 32 cuadros. **96% entre sesiones** (con las plantillas lentas reconoce 12/12 de la sesión a velocidad normal: la velocidad casi no importa), 100% dejando afuera una toma. Umbral de distancia 1,70 para responder "no sé"
- [ ] Grabar el nivel 3 **a velocidad natural**: el problema de ir rápido no es la velocidad sino que la mano se pierde en los cuadros borrosos
- [ ] (descartado por ahora) red recurrente para el nivel 3: DTW alcanza con pocos datos; con pocas secuencias, comparar **DTW + vecino más cercano** (alinea secuencias de distinta velocidad; anda con pocos ejemplos) contra una red recurrente chica (GRU)
- [x] **Nivel 4 habilitado** (Ñ, Q, W, X): dos manos; la regla de quietud mide la mano dominante (según la lateralidad de MediaPipe)
- [x] Primera sesión del nivel 4 (P-884A): dos manos en el 99% de los cuadros, siempre una izquierda y una derecha
- [x] **Modelo del nivel 4**: forma de la mano dominante y de la otra (66 + 66) + posición de la otra respecto de la muñeca dominante (4). **100%** dejando afuera una ronda (4 letras muy distintas, una sesión)
- [x] **Todo integrado en Detectar** ("Todas las letras", `recognition/live.ts`): con dos manos → nivel 4; con una mano que recorrió ≥3 distancias entre ojos en 2,5 s → DTW (si encuentra una plantilla cercana, la muestra 1,5 s); si no → modelo estático. Umbrales elegidos con los datos (velocidad del índice en letras quietas vs en movimiento)
- [ ] Probar en vivo la integración, sobre todo que las transiciones entre letras estáticas no disparen letras de movimiento
  - *Segunda prueba (Nico): "lento pero aceptable".* Problemas para mejorar:
    - **Cada cambio de letra se interpreta como una de movimiento** (casi siempre Z o CH): la transición entre letras estáticas también recorre distancia y DTW la acepta. Ideas: exigir que el movimiento empiece y termine con la mano quieta; pedir que la plantilla más cercana gane con margen sobre la segunda; grabar transiciones como clase "ninguna"; subir el recorrido mínimo o bajar el umbral
    - **La CH molesta mucho** (aparece en las transiciones). Nico propone sacarla: no es una letra del alfabeto español actual, aunque la lámina de la CAS sí la incluye. Decidirlo al retomar
    - **La W siempre sale como X** en vivo, aunque el modelo del nivel 4 dio 100% con los datos grabados. Revisar qué cambia en vivo (lateralidad de cada mano, cuál se toma como dominante, encuadre)
    - **La T se confunde muchísimo con la I** (ya se veía en los datos: forma de mano parecida; la ubicación ayudaría)
  - *Primera prueba (Nico, en orden alfabético):* la **H** se reconoció mal y la confianza general bajó respecto de los modelos por nivel (ahora el estático elige entre 21 letras). El modo debug muestra cada intento de DTW (letra más cercana, distancia, umbral y recorrido) para ver por qué falla
- [x] `pull_sessions.py` lee la base del teléfono: ya no hace falta exportar

#### Etapa 4.7 — Piloto y grabación

- [ ] Piloto con vos en el **teléfono** (no el emulador): ajustar tiempos y textos
- [ ] Grabar a 3–5 personas, cada una con su consentimiento; exportar a `ml/languages/aed/data/` (fuera de git)

#### Etapa 4.8 — Entrenamiento (nivel 1)

- [x] Entorno Python aislado: `venv` + `pip` (Python 3.12), dependencias directas fijas en `ml/requirements.txt` y todas en `requirements.lock.txt`. TensorFlow 2.21, LiteRT 2.3.0, scikit-learn 1.9.1 y matplotlib 3.11.2, con wheels para Windows verificadas en PyPI
- [x] Preprocesado ([ADR 0008](decisiones/0008-entrada-del-clasificador.md)): world landmarks; posición (muñeca al origen), escala (muñeca → nudillo medio) y lateralidad (zurdos espejados). **Se conserva la orientación**: M, N y P se distinguen porque apuntan hacia abajo
- [x] `ml/train.py`: red densa (Keras), evaluación dejando afuera **una persona por vez** (o una ronda, si hay una sola persona), matriz de confusión, export a `.tflite` + `manifest.json`, y verificación de que el `.tflite` responde igual que Keras con `ai-edge-litert`. Probado de punta a punta con datos sintéticos
- [x] **Primera sesión real** (P-BCD2, Nico): 65,3% con todos los cuadros → 78,1% con solo los cuadros quietos (`--still 0.15`) → **80,5%** con la normal de la palma (normalización v2). La K y la R casi en 0%: se hicieron distinto en cada ronda (la persona buscaba la forma). La U y la V se separan por la orientación de la palma; una V se hizo con la orientación de la U
- [x] **Medir la duda:** en cada toma, cuánto tiempo estuvo la mano cerca de su forma típica (`steadyMs`, igual en TS y Python). Si fue menos de 1 s, la app pide repetir la letra (hasta 3 intentos) y el resumen muestra cuántas veces costó cada letra
- [x] **Más rondas a las letras difíciles:** `train.py` escribe `capture-plan.json` (+2 rondas si el modelo acierta menos del 50%, +1 si menos del 85%) y la app lo usa en las sesiones siguientes
- [x] **Segunda sesión** (P-B2D5, Nico, mismo día): 91% de tomas firmes (antes 72%); K y R aprendidas. Dentro de la sesión, **92,5%** (K 100%, R 94%); entre sesiones, 68%, porque en la primera la R y una V se hicieron distinto. La sesión 1 queda fuera del entrenamiento (`data/excluded/`, `pull_sessions.py` no la vuelve a traer). Lo que queda difícil es O→D
- [x] Descartar una sesión al terminarla (se borra del teléfono con sus tomas); si no se descarta, queda guardada
- [ ] Al evaluar con varias personas: saber qué sesiones son de la misma persona (hoy cada sesión tiene su código), para no medir "persona nueva" con alguien que el modelo ya vio
- [ ] Entrenar el nivel 1 con datos de varias personas.
- [ ] *(Anotado por Nico)* Grabar ejemplos con la **mano izquierda**, para probar el espejado con datos reales
- [ ] *(Anotado por Nico)* **Partir el nivel 1 en dos pruebas**: con ~40 tomas, a partir de la 30 cansa y se mira cuánto falta (en el nivel 2, con menos tomas, no pasó)
- [x] **Primera sesión del nivel 2** (P-4C9D): la cara se vio en el 100% de los cuadros y cada letra cae en su zona respecto de los ojos (la F en el pecho: el Face Detector alcanza). Solo forma de la mano: 91,5%; con ubicación: 91,7%. La T de la ronda 3 tuvo forma de I y el modelo, entrenado con pocas rondas, no aprendió a usar la ubicación (aprende el atajo más fácil). Hacen falta más sesiones; si sigue, aumentar los datos "ensuciando" la forma para forzar la ubicación Ojo: solo con la mano, una E se ve igual que una C; la E se resuelve en el Hito 6 con la ubicación
- [ ] Analizar las clases marcadas con `confusableWith` (D y O): qué puntos las separan en los datos reales y cuánto se confunden

**Hecho cuando:** hay un dataset de 3–5 personas con las 28 letras, y el modelo del nivel 1 supera una exactitud acordada con personas que nunca vio, y se entiende por qué falla donde falla.
**Aprendes:** protocolos de captura, consentimiento, formatos de datos versionados, normalización, train/val/test, redes densas, sobreajuste, métricas, cuantización.

> Los niveles 2, 3 y 4 se entrenan después (Hito 6), con los datos que ya grabamos acá.

### Hito 5 — Reconocimiento en la app

- [x] Dónde corre el clasificador: **en TypeScript**, con los pesos exportados a JSON. Es una red de ~17k multiplicaciones y no justifica un runtime nativo ([ADR 0010](decisiones/0010-clasificador-en-typescript.md)). Verificado igual al `.tflite` en todos los cuadros reales
- [x] "Detectar" muestra la letra reconocida con su color y su confianza; se elige reconocer las letras del nivel 1 o del nivel 2 (este último enciende la cara)
- [ ] Probarlo en vivo con las letras de los niveles 1 y 2
- [x] Suavizado: votación sobre los últimos 10 cuadros (gana con 6 votos y 60% de confianza media; si no, "¿…?")
- [x] **Un solo modelo para todas las letras estáticas de una mano** (`train.py --level static`, 21 clases): los niveles quedan solo para organizar la captura. En Detectar, el modo "Todas las letras" es el de por defecto (también se puede elegir nivel 1 o 2). Con los datos actuales, **89,8%** solo con la forma de la mano (la C y la E salen bien por la orientación de la palma)
- [x] La captura enciende la cara en **todos** los niveles. Cuando todas las tomas tengan la cara (una sesión nueva del nivel 1), `train.py` entrena el modelo combinado **con ubicación**; mientras tanto avisa y usa solo la forma
- [x] Otra sesión del nivel 1 con la cara (P-E350). **Nivel 1 entre sesiones: 87,2%** (a la mañana, aprendiendo, era 68%); la O pasó de 55% a 100%. Modelo combinado: solo forma con todos los datos **91,4%** vs forma + ubicación sin la sesión vieja (que no tiene cara) 81,3%: hoy pesan más los datos. `train.py --location auto|on|off`; la ubicación mejora la T (22% → 67%), así que con más sesiones con cara se vuelve a comparar
- [ ] *(Anotado por Nico, probando Detectar)* La **O** (nivel 1) cuesta muchísimo y la **T** (nivel 2) también: coincide con los datos (O 55%, se confunde con la D; T 22%, con la K y la I)

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
| ~~1~~ | ~~Runtime del clasificador en la app~~ → TypeScript ([ADR 0010](decisiones/0010-clasificador-en-typescript.md)) | ✅ Hito 4 |
| ~~2~~ | ~~Librería para dibujar el esqueleto sobre la cámara~~ → Skia ([ADR 0004](decisiones/0004-plugin-hand-landmarker.md)) | ✅ Hito 3 |
| ~~3~~ | ~~Gestor de entorno Python~~ → `venv` + `pip` con dependencias fijadas | ✅ Hito 4 |
| ~~4~~ | ~~Fuente de datos del alfabeto LSA (propia vs pública)~~ → propia, captura tipo juego ([ADR 0005](decisiones/0005-datos-propios-captura-tipo-juego.md)) | ✅ Hito 4 |
| ~~5~~ | ~~Referencia del cuerpo~~ → Face Detector, activable (provisional hasta los datos del nivel 2) ([ADR 0009](decisiones/0009-referencia-del-cuerpo.md)) | ✅ Hito 4, etapa 4.3 |
| ~~6~~ | ~~Almacenamiento en el teléfono~~ → SQLite + exportar/importar sesiones como archivo | ✅ Hito 4, etapa 4.4 |

---

## 6. Cómo retomar el trabajo en una sesión nueva

1. Abre este archivo y busca el primer `[ ]` sin marcar.
2. Revisa el último ADR en `docs/decisiones/`.
3. Dile a Claude: *"Seguimos con el Hito N, paso X"*.
