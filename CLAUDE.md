# senhas — laboratorio de reconocimiento de LSA

**Objetivo único: aprender.** Se prioriza hacerlo bien y entenderlo, no la velocidad.

## Estilo en este proyecto
- Explicaciones didácticas: en el informe final, explicá qué es cada concepto nuevo (RN, Expo, Android nativo, ML) y por qué se eligió, con alternativas.
- Autonomía total: hacé y explicá después. Antes de adoptar cualquier herramienta o librería, verificá su estado actual (mantenimiento, deprecaciones) y citá lo que consultaste.
- Al cerrar cada hito: quiz corto, reforzando los errores anteriores.

## Stack y estructura
- `app/`: Expo SDK 58 (dev build, no Expo Go), RN 0.88, TypeScript, VisionCamera 5. Solo Android (emulador + dispositivo físico).
- `ml/`: Python (MediaPipe + Keras → .tflite). `docs/`: PLAN.md y ADRs.
- ML on-device: MediaPipe Hand Landmarker (21 landmarks) → clasificador propio.

## Módulo nativo `app/modules/hand-landmarker`
- Plugin de VisionCamera v5 (Nitro + MediaPipe, Kotlin). Ver [ADR 0004](docs/decisiones/0004-plugin-hand-landmarker.md).
- Si cambia un spec `*.nitro.ts`: `npx nitrogen` dentro del módulo y commitear `nitrogen/generated/`.
- Cualquier cambio en Kotlin o en los specs requiere recompilar (`npm run android`). Los cambios solo de `.ts`/`.tsx` en `src/` se ven con Fast Refresh: probá ahí antes de recompilar.
- Las capturas de la cámara muestran la cara del usuario (PII biométrica): borrarlas después de verificar, nunca commitearlas.

## Comandos (desde `app/`)
- `npm run check`: typecheck + lint + format:check. Tiene que pasar antes de cada commit.
- `npm run android`: compila e instala en el emulador o dispositivo.
- `npm run release:phone`: versión que funciona sola, sin cable ni Metro (ADR 0011), solo para arm64 y la instala en el teléfono por USB. Lleva adentro los modelos: recompilarla después de reentrenar. Respaldar antes con `pull_sessions.py`. Ojo con el disco: los intermedios nativos de una release ocupan varios GB.
- `npm run phone`: si la app del teléfono queda en "iniciando". Restablece el túnel USB (`adb reverse tcp:8081`), que se pierde cada vez que se corta la conexión, y abre la app apuntando a Metro.
- `npm run evaluate:spelling`: pasa los deletreos grabados (`spell:PALABRA`) por el motor de Detectar, en Node, y da el error por letra. Correrlo antes y después de cada cambio al motor (`src/recognition/`).
- Si Metro no encuentra un archivo nuevo ("Unable to resolve"), reiniciarlo con `npx expo start --dev-client --clear`.

## Comandos (desde `rust/`, Hito 8, ADR 0013)
- Toolchain GNU de Rust (`x86_64-pc-windows-gnu`): no hacen falta las Build Tools de Visual Studio.
- `cargo test --release`: tests unitarios + paridad con TS. La paridad necesita antes `npm run dump:parity` en `app/` (escribe `ml/runs/parity/ts.json`); sin ese archivo, se saltea.
- `cargo run --release --bin evaluate-spelling`: mismo informe que `npm run evaluate:spelling`; tienen que coincidir.
- Antes de cada commit: `cargo fmt --check` y `cargo clippy --all-targets --release -- -D warnings`.
- Un cambio en `app/src/recognition/` o `features.ts` se replica en `rust/crates/senhas-core` y se vuelve a correr la paridad.
- Necesita MinGW-w64 completo en el PATH (WinLibs, instalado con winget): el toolchain GNU de Rust solo no compila `windows-sys`.
- `powershell -File scripts/android.ps1` (`-Phone` para el teléfono, arm64, release): compila la app Rust con `cargo-ndk`, la empaqueta con Gradle (`rust/android/`) y la instala. En el emulador la frontal es la webcam de la PC: `adb -e shell setprop debug.senhas.camera back` usa la trasera virtual (no filma a nadie).
- `cargo ndk -t x86_64 -P 26 clippy --release -p senhas-app -- -D warnings`: `senhas-app` solo compila para Android (necesita `ANDROID_HOME`, `ANDROID_NDK_HOME` y `ANDROID_JAR`, como en `android.ps1`).
- `powershell -File scripts/fetch-mediapipe.ps1`: baja los modelos de MediaPipe y las imágenes públicas de prueba a `rust/mediapipe/` (fuera de git). La paridad de `hand-pipeline` necesita además `reference/mediapipe_reference.py`, corrido con un Python que tenga `mediapipe` (un venv aparte: no está en `ml/requirements.txt`).

## Comandos (desde `ml/`, con `.venv\Scripts\python`)
- `pull_sessions.py`: copia por USB las sesiones exportadas de los teléfonos a `languages/aed/data/`.
- `train.py --level 1|2|4|static`: entrena, evalúa (una persona o ronda afuera), exporta `.tflite`, `model.json` (lo usa la app) y `manifest.json`.
- `train_sequences.py`: plantillas DTW de las letras con movimiento (nivel 3).
- `build_references.py`: poses guía de cada letra para la captura.
- La app importa `models/*/model.json`, `models/movement/model.json` y `models/references.json`: correr los tres scripts antes de compilar en una máquina nueva.
- Datos de personas, modelos y corridas están fuera de git (`ml/.gitignore`).

## Reglas
- `docs/PLAN.md` es la fuente de verdad del progreso: actualizalo al completar ítems.
- Las decisiones técnicas relevantes van como ADR en `docs/decisiones/NNNN-titulo.md`.
- Privacidad: imágenes de manos/caras = datos biométricos (PII). Procesamiento solo on-device; los datasets guardan landmarks, nunca imágenes, y solo con consentimiento.
- Build en Windows: CMake 3.31.6 por rutas largas (ver ADR 0002).
