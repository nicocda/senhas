# Comparación: app React Native contra app Rust

Decisión y stack: [ADR 0013](../decisiones/0013-segunda-app-en-rust.md). Este archivo junta el
protocolo de medición y los resultados de las dos apps.

## Protocolo (igual para las dos apps)

Siempre en el **mismo teléfono**, con build release (sin Metro ni modo debug), brillo fijo, Wi-Fi
apagado y la app recién instalada. Paquete RN: `com.nicogiordano.senhas`.

| Métrica | Cómo se mide |
|---|---|
| Tamaño del APK | `ls -l` del APK release arm64 |
| Arranque en frío | `adb shell am force-stop <pkg>` y después `adb shell am start -W -n <pkg>/<actividad>`: `TotalTime`, mediana de 10 corridas |
| ms por cuadro | En Detectar, con una mano y la cara: conversión, inferencia de la mano, cara y clasificador. En RN, desde el panel de debug (`TrackingStats`); en Rust, con contadores equivalentes |
| Cuadros por segundo | Ídem, promedio de 1 minuto haciendo letras |
| Memoria | `adb shell dumpsys meminfo <pkg>`: `TOTAL PSS` después de 1 minuto en Detectar |
| CPU | `adb shell top -b -n 5 -d 2 -p <pid>`: promedio de `%CPU` |
| Batería | `adb shell dumpsys batterystats --reset`, desconectar el cable, 5 minutos en Detectar y después `adb shell dumpsys batterystats <pkg>` (consumo estimado en mAh) |
| Exactitud | `evaluate-spelling` (error por letra) con los mismos deletreos grabados |
| Desarrollo | Líneas de código por pieza, tiempo de compilación limpia e incremental, tiempo desde un cambio de UI hasta verlo en el teléfono |

## Resultados

| Métrica | React Native | Rust |
|---|---|---|
| Tamaño del APK (arm64) | 97,3 MB *(build del 2026-11-06, a repetir con `main`)* | — |
| Arranque en frío | — | — |
| ms por cuadro (mano / cara / clasificador) | — | — |
| Cuadros por segundo (una mano + cara) | — | — |
| Memoria (PSS) | — | — |
| CPU | — | — |
| Batería (5 min) | — | — |
| Error por letra (deletreos) | — | — |
| Tiempo de un cambio de UI hasta verlo | Fast Refresh: ~1 s | — |
| Motor en la PC: las 241 tomas (11.528 cuadros) | 505 ms (Node 24) | 88 ms (port literal: 260 ms) |
| Modelos de MediaPipe en la PC, 1 hilo (palma / landmarks / cara) | LiteRT + XNNPACK: 10,8 / 8,5 / 1,1 ms | tract: 49 / 43 / 8 ms |

## Notas

### Fase 1: la lógica (2026-11-12)

- **Paridad exacta:** en los 11.528 cuadros grabados, Rust da la misma letra que TypeScript, con
  una diferencia de confianza de 1e-16 (los mismos bits) y la misma palabra en las 241 tomas. Se
  logró copiando también los tipos: TS guarda los pesos en `Float32Array` y suma en `number`
  (f64), y Rust hace exactamente eso (`f32` guardado, `f64` al sumar).
- **Rust no es rápido "porque sí":** el port literal tardaba 260 ms, solo el doble que Node. El
  clasificador recorría los pesos de a saltos (`weights[i * outputs + j]`, columna por columna),
  lo que desaprovecha la caché del procesador. Recorriéndolos en el orden en que están guardados
  (fila por fila), bajó a 88 ms, sin cambiar un solo bit del resultado. El mismo cambio
  probablemente acelere también la versión TS: el idioma pesa menos que el orden de acceso a memoria.
- Node no es lento para cuentas: el JIT de V8 compila los bucles numéricos a código de máquina.
  La diferencia de 5,7× es para el motor solo, en la PC. En el teléfono, el motor es una parte
  chica del tiempo por cuadro frente a MediaPipe (~50 ms).

### Fase 2: MediaPipe sin MediaPipe (2026-11-12)

- **Qué hace MediaPipe entre los dos modelos:** el detector de palma recibe la imagen con franjas
  (*letterbox*) a 192×192 y da 2016 candidatos, uno por "ancla" (una grilla fija de posiciones).
  Se quedan los de score ≥ 0,5. Los que se superponen se promedian, pesados por su score (NMS
  ponderado). La palma se convierte en una región rotada, ×2,6 y corrida hacia los dedos. Ese
  recorte, a 224×224, va al modelo de landmarks. En el cuadro siguiente, la región sale de los
  landmarks y no se vuelve a buscar la palma: es el **seguimiento**. Son ~600 líneas de Rust.
- **Paridad con MediaPipe (Python) sobre sus imágenes públicas:** landmarks a 0,00006 de la imagen
  (0,04 px) en una imagen suelta y a 0,0002 con seguimiento; *world landmarks* a 0,04 mm; cara a
  0,0007. El recorte imita el de OpenCV (posiciones redondeadas a 1/32 de píxel, resultado en 8 bits).
- **Un "error" de MediaPipe reproducido a propósito:** al principio los landmarks diferían hasta 2%.
  Aislando cada paso (correr el modelo sobre la región que sale de los landmarks de MediaPipe dio
  0,00001), quedó la conversión palma → región. El código de Tasks pide
  `set_rotation_vector_target_angle(90)`, y ese campo está en **radianes** (el de grados es
  `rotation_vector_target_angle_degrees`). La región de la palma queda ~27° girada de más, y el
  modelo de landmarks lo tolera. Con 90 radianes, todo coincide. Sin el código fuente abierto, esto
  no se encuentra: es parte del costo de rehacer una librería.
- **tract es correcto pero lento:** da los mismos números que LiteRT (cuarta cifra decimal), pero tarda
  entre 4,5 y 7 veces más. XNNPACK tiene núcleos SIMD escritos a mano para cada procesador. Para la
  PC alcanza; en el teléfono hace falta LiteRT.

### Fase 3: la app en Android (2026-11-12)

- **Sin Java propio, pero no sin Java:** el APK es un `NativeActivity` (una actividad de Android que
  carga una `.so` y le pasa los eventos) con `hasCode="false"`. Igual Java aparece dos veces: el
  backend de Android de Slint compila un helper en Java en su build script y lo carga en memoria, y el
  permiso de cámara se pide por JNI (`Activity.requestPermissions`), porque Android no tiene API en C
  para eso. En Android, todo pasa en algún momento por la máquina virtual de Java.
- **La cámara en C:** Camera2 del NDK + `AImageReader`, ~300 líneas de Rust `unsafe`. En RN eso lo da
  VisionCamera. Hay que manejar a mano lo que una librería resuelve: abrir solo en primer plano
  (Android rechaza la cámara desde segundo plano), cerrarla al salir, rotar según el sensor y
  convertir YUV a RGB.
- **Herramientas:** `cargo-apk`, el empaquetador que sugiere Slint, no tiene versiones desde 2023. Se
  usó `cargo-ndk` + un Gradle mínimo (el mismo plugin de Android que la app RN, 9.2.1).
- **Ciclo de desarrollo:** un cambio en Rust es recompilar la `.so` (10 s incremental, ~4 min desde
  cero) + empaquetar con Gradle (5 s) + instalar. En RN, un cambio de UI se ve en ~1 s con Fast Refresh.

- Las dos apps usan los mismos `.tflite` de MediaPipe y los mismos `model.json`. Las diferencias
  vienen del runtime y del código, no de los modelos.
- En RN, MediaPipe ya corre en Kotlin nativo y solo el clasificador corre en JS. La ganancia de Rust
  en la inferencia de la mano debería ser chica. Donde se espera más diferencia: en el puente entre
  la cámara y el JS, en el tamaño del APK (sin Hermes ni React) y en el arranque.
