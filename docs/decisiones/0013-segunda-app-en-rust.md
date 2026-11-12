# ADR 0013 — Segunda app, 100% en Rust, para comparar con la de React Native

- **Estado:** aceptada (stack a confirmar con los spikes de las fases 2 y 3)
- **Fecha:** 2026-11-12

## Contexto

Nico leyó que empresas grandes "migran de React Native a Rust" por rendimiento y quiere una segunda
app que haga lo mismo que `app/`, con los mismos datos y modelos, escrita en Rust, para comparar.

**Lo que hacen las empresas en realidad:** Firefox (Mozilla), 1Password y Ferrostar (Stadia Maps)
escriben en Rust el *núcleo* (lógica, cifrado, cálculo de rutas). Lo exponen a Kotlin, Swift o
React Native con [UniFFI](https://github.com/mozilla/uniffi-rs) y dejan la UI nativa. Rehacer la UI
en Rust es poco común. Nico eligió igual la versión **100% Rust** (UI, cámara e inferencia): es la
que más enseña y la que mejor muestra por qué el patrón habitual es el otro.

**El obstáculo:** MediaPipe Tasks no tiene SDK para Rust. El plugin actual
(`app/modules/hand-landmarker/.../HybridHandLandmarker.kt`) usa MediaPipe para la mano y para la cara
(ADR 0009). `hand_landmarker.task` es un zip con dos modelos (verificado):
`hand_detector.tflite` (2,3 MB) y `hand_landmarks_detector.tflite` (5,5 MB). La cara es
`blaze_face_short_range.tflite`. En Rust se corren esos `.tflite` directamente y se reescribe lo que
MediaPipe hace entre ellos: anclas, NMS, recorte rotado y seguimiento.

## Opciones evaluadas

### Interfaz

| Opción | Veredicto |
|---|---|
| **Slint** 1.15+ (backend `android-activity`) | ✅ Dibuja de forma nativa, con soporte oficial de Android desde 1.5. La versión 1.15 (feb 2026) agregó *safe area* y teclado virtual |
| Dioxus 0.7 | ❌ En mobile dibuja dentro de un *webview*: compararía Rust contra un navegador, no contra RN. Su ejemplo de cámara es un esqueleto vacío |
| egui / iced | ❌ Andan en Android, pero sin soporte oficial ni guías para mobile |

**Licencia de Slint:** la *Royalty-free 2.0* es gratis para apps de escritorio, mobile y web (no
embebidos), con una condición: mostrar el widget `AboutSlint` en una pantalla "Acerca de" o el
distintivo en una página pública. Alternativa: GPLv3.

### Cámara

| Opción | Veredicto |
|---|---|
| **Camera2 del NDK** (`ACameraManager` + `AImageReader`) con `ndk-sys` | ✅ Es la API nativa en C. El crate `ndk` (0.9) cubre `AImageReader` (feature `media`), pero no la cámara: esa parte se llama por `ndk-sys` |
| CameraX por JNI | ❌ Obliga a escribir Kotlin y a cruzar JNI en cada cuadro |

### Inferencia

| Opción | Veredicto |
|---|---|
| **`google-ai-edge-litert`** (oficial de Google, SDK 2.3.0) | ✅ Su `build.rs` soporta Android arm64 (teléfono), Android x86_64 (emulador) y Windows x86_64 (PC). Es el mismo runtime que usa MediaPipe por dentro. Requiere Clang (bindgen) y CMake |
| `tract-tflite` 0.23 (Rust puro) | Respaldo: sin dependencias nativas, pero sin lista pública de operaciones soportadas y casi sin documentación |
| `tflitec` | ❌ Fija TensorFlow 2.9.1, anterior al cambio de nombre a LiteRT |

### Build

`cargo-ndk` 4.1 (soporta Windows y arma la carpeta `jniLibs`) + un proyecto Gradle mínimo para
empaquetar el APK. NDK 27.1 ya instalado (`%LOCALAPPDATA%\Android\Sdk\ndk\27.1.12297006`).

## Decisión

- Carpeta `rust/` en este repo, como workspace de Cargo. Así lee los mismos
  `ml/languages/aed/models/*` y las mismas sesiones sin copiarlos.
- Crates:
  - `senhas-core`: lógica pura, port de `app/src/dataset/features.ts` y `app/src/recognition/*`.
  - `hand-pipeline`: modelos de MediaPipe con LiteRT.
  - `senhas-app`: Slint + cámara.
- Paridad obligatoria: `senhas-core` tiene que dar la misma letra que TypeScript en todos los cuadros
  grabados (diferencia ≤ 1e-5), como en el ADR 0010.
- **Seguir o no seguir (fase 2):** si los landmarks de Rust no coinciden con los de MediaPipe Python
  sobre imágenes públicas, plan B: Kotlin mínimo con MediaPipe por JNI y todo lo demás en Rust.
- Fuera de alcance: la pantalla de Captura. Los datos se siguen grabando con la app RN.

## Consecuencias

- Sin recarga en caliente: cada cambio de UI en Android es recompilar. Slint tiene *live preview* en
  la PC, que alivia un poco. Esto se mide como parte de la comparación.
- La lógica de reconocimiento queda duplicada en TS y en Rust. El test de paridad es lo que evita
  que se separen.
- Requiere instalar Rust (`rustup`, targets `aarch64-linux-android` y `x86_64-linux-android`),
  `cargo-ndk` y LLVM/Clang.
- **Toolchain GNU en Windows (2026-11-12):** Rust necesita un linker. El de Microsoft viene con las
  Build Tools de Visual Studio (~3,5 GB, piden administrador). Se eligió el host
  `x86_64-pc-windows-gnu`, que trae su propio linker (MinGW). Para Android no cambia nada: ahí se
  usa el linker del NDK. Si en la fase 2 LiteRT necesita compilar C++ en la PC, se revisa.
- **MinGW completo (2026-11-12):** el toolchain GNU trae `dlltool`, pero no el ensamblador (`as`)
  que `dlltool` necesita, así que no compila crates que importan DLLs de Windows con `raw-dylib`
  (`windows-sys`). Se instaló WinLibs (MinGW-w64 UCRT, `winget --scope user`, ~950 MB, sin
  administrador), que queda en el PATH del usuario.

## Fase 2: inferencia (2026-11-12)

- **tract en la PC:** es Rust puro, no necesita instalar nada más y corre los tres modelos de
  MediaPipe con los mismos números que LiteRT. Pero es entre 4,5 y 7 veces más lento (palma 49 ms
  contra 11 ms, en un hilo). `hand-pipeline` usa el trait `backend::Model`: el pipeline no sabe qué
  motor corre debajo.
- **LiteRT en Android (fase 3/4):** su crate compila C++ con clang y genera los bindings con bindgen
  en cada build (necesita `clang`, `libclang` y CMake). Para Android se usa el clang del NDK; en la
  PC no hace falta.
- **Ángulo de la palma en radianes:** MediaPipe Tasks usa `rotation_vector_target_angle(90)`, un
  campo en radianes ([proto](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/calculators/util/detections_to_rects_calculator.proto)).
  Se reproduce igual (`hand.rs`, `PALM_TARGET_ANGLE`): la app RN usa ese mismo MediaPipe.

## Fuentes (consultadas el 2026-11-12)

- LiteRT Rust: [docs.rs google-ai-edge-litert](https://docs.rs/google-ai-edge-litert), [build.rs](https://github.com/google-ai-edge/LiteRT/blob/main/litert/rust/build/build.rs), [notas de LiteRT](https://developers.google.com/edge/litert/releases/litert_aug)
- [tract-tflite](https://docs.rs/crate/tract-tflite/latest), [tflitec](https://docs.rs/crate/tflitec/0.5.2)
- Slint: [1.15](https://slint.dev/blog/slint-1.15-released), [licencia Royalty-free 2.0](https://github.com/slint-ui/slint/blob/master/LICENSES/LicenseRef-Slint-Royalty-free-2.0.md)
- [Dioxus mobile](https://www.mintlify.com/DioxusLabs/dioxus/platforms/mobile)
- [ndk](https://docs.rs/crate/ndk/latest), [`ndk::media`](https://docs.rs/ndk/latest/ndk/media/index.html), [NDK Camera](https://developer.android.com/ndk/reference/group/camera)
- [cargo-ndk](https://docs.rs/crate/cargo-ndk/latest)
- [Ferrostar](https://stadiamaps.com/blog/ferrostar-building-a-cross-platform-navigation-sdk-in-rust-part-1/), [UniFFI para RN](https://hacks.mozilla.org/2024/12/introducing-uniffi-for-react-native-rust-powered-turbo-modules/)
