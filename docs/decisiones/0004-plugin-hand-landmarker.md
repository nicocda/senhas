# ADR 0004 — Plugin nativo `hand-landmarker` (Nitro + MediaPipe) y dibujo con Skia

- **Estado:** aceptada
- **Fecha:** 2026-11-03

## Contexto

En el Hito 3 hay que obtener los 21 puntos de la mano en cada cuadro de la cámara y dibujarlos en vivo.
El [ADR 0001](0001-stack-tecnologico.md) ya descartó los wrappers de MediaPipe de la comunidad y decidió
escribir un plugin propio. Quedaban por definir cómo armarlo en VisionCamera v5, en qué formato pasarle
la imagen a MediaPipe y con qué dibujar.

## Opciones evaluadas

| Tema | Opción | Veredicto |
|---|---|---|
| Plugin | Módulo Nitro local (así son los plugins de VisionCamera v5) | ✅ |
| Formato del cuadro | `yuv` (el más eficiente) | ❌ MediaPipe no acepta YUV: `AndroidPacketCreator` exige RGBA_8888 |
| Formato del cuadro | `rgb`: CameraX convierte a RGBA_8888 | ✅ |
| Modo de MediaPipe | `LIVE_STREAM` (asíncrono, resultado por callback en otro hilo) | ❌ Complica devolver el resultado en el mismo cuadro |
| Modo de MediaPipe | `VIDEO` (`detectForVideo`, síncrono, con seguimiento entre cuadros) | ✅ |
| Delegado | GPU | ❌ por ahora: falla en el emulador y exige usarlo desde el hilo que lo creó |
| Delegado | CPU | ✅ |
| Modelo (7,8 MB) | Guardarlo en git | ❌ Binario pesado; la página oficial no declara su licencia |
| Modelo | Descargarlo al compilar (como el ejemplo oficial de Google), versión fija + SHA-256 | ✅ |
| Dibujo | `setState` en React por cada cuadro | ❌ 25 renders por segundo en el hilo de JS |
| Dibujo | SVG animado con Reanimated (~42 nodos) | ❌ 42 actualizaciones de props por cuadro |
| Dibujo | `react-native-vision-camera-skia` | ❌ Reemplaza la vista previa nativa; pensado para dibujar *dentro* del cuadro |
| Dibujo | Canvas de **Skia 2.14.0** encima de la vista previa, con shared values de Reanimated | ✅ Un solo canvas en la GPU, se redibuja en el hilo de UI sin pasar por React |

## Decisión

- Módulo local en `app/modules/hand-landmarker`, enlazado con `"hand-landmarker": "file:modules/hand-landmarker"`
  y con la estructura del plugin oficial `react-native-vision-camera-barcode-scanner@5.2.4`. El código puente
  (Kotlin, C++, JNI) lo genera `nitrogen@0.37.1`, la misma versión que `react-native-nitro-modules`.
- Kotlin: `ImageProxy` RGBA → `Bitmap` → `HandLandmarker.detectForVideo` (MediaPipe `tasks-vision` **1.2.2**, CPU).
- `useFrameOutput` con `pixelFormat: 'rgb'` y `orientationSource="interface"` en la cámara.
- Los puntos van a un shared value de Reanimated; las estadísticas, a React una vez por segundo.

## Hallazgos que no estaban en la documentación

1. **MediaPipe devuelve los puntos en coordenadas del sensor.** La rotación de `ImageProcessingOptions` se usa
   para analizar la imagen, pero los puntos salen "acostados". El plugin los rota a la vertical
   (`NormalizedLandmark.toUpright`). Lo verificamos en un Xiaomi, con el sensor frontal a 270°.
2. **`orientationSource` por defecto sigue al teléfono físico.** Con la UI fija en vertical, el esqueleto
   rotaba al girar el teléfono. Con `'interface'`, los cuadros siguen a la pantalla.
3. **La cámara tiene que pausarse en segundo plano.** Si no se pausa, Android la bloquea ("Camera is disabled,
   probably due to a device policy"). `isActive` sigue a `AppState`.

## Consecuencias

- Rendimiento en el teléfono (Xiaomi, `arm64-v8a`): **~23 FPS, copia 5 ms, MediaPipe ~50 ms**. El cuello de
  botella es la inferencia, no la copia. Pendiente: probar el delegado GPU en el teléfono.
- Cada cambio en Kotlin o en los specs implica `npx nitrogen` (si cambió el spec) y recompilar. Gracias a la
  caché de Gradle, una recompilación del módulo tarda unos 2 minutos; la primera, unos 18.
- El APK suma ~16 MB de librerías nativas de MediaPipe por arquitectura y 7,8 MB del modelo.

## Fuentes

- [VisionCamera: Native Frame Processor Plugins](https://github.com/margelo/react-native-vision-camera/blob/main/docs/content/docs/native-frame-processor-plugins.mdx)
  y el código de `react-native-vision-camera-barcode-scanner@5.2.4` (npm).
- [Nitro: How to build a Nitro Module](https://github.com/mrousavy/nitro/blob/main/docs/docs/getting-started/how-to-build-a-nitro-module.md)
  y [Worklets](https://github.com/mrousavy/nitro/blob/main/docs/docs/guides/worklets.md).
- [MediaPipe Hand Landmarker para Android](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/android),
  `AndroidPacketCreator.java` y el ejemplo oficial `mediapipe-samples/examples/hand_landmarker/android`.
- Metadatos de Google Maven para `com.google.mediapipe:tasks-vision` (1.2.2, publicado el 2026-11-03).
- `node_modules/expo/bundledNativeModules.json` (Skia 2.14.0 fijado por el SDK 58).
