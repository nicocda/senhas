# ADR 0001 — Stack tecnológico

- **Estado:** aceptada
- **Fecha:** 2026-11-02

## Contexto

Queremos una app Android que detecte manos con la cámara y reconozca LSA, como laboratorio para
aprender React Native. Requisitos: que todo corra en el dispositivo (privacidad, sin costo por uso),
usar piezas **vigentes y mantenidas**, y poder entrenar un modelo propio.

## Opciones evaluadas

| Necesidad | Opción | Estado verificado (npm / PyPI / Maven, 2026-11-02) | Veredicto |
|---|---|---|---|
| Framework | Expo SDK 58 (React Native 0.88) | `expo@58.0.22`, publicado el 15/10/2026 | ✅ |
| Cámara | `react-native-vision-camera` v5 | `5.2.4` (29/10/2026), Nitro Modules | ✅ |
| Mano | `react-native-mediapipe` | último release en 12/2024, solo VisionCamera v4 | ❌ abandonada |
| Mano | `react-native-mediapipe-vision` | una sola versión (08/2025) | ❌ |
| Mano | `expo-vision-camera-v4-mediapipe` | 0 estrellas, solo VisionCamera v4 | ❌ |
| Mano | MediaPipe Tasks Android oficial + **plugin Kotlin propio** | `tasks-vision 1.2.0` (28/10/2026) | ✅ |
| Entrenamiento | `mediapipe-model-maker` | último release en 04/2024 | ❌ |
| Entrenamiento | `mediapipe` + `tensorflow` + `ai-edge-litert` | 1.2.0 / 2.21.0 / 2.3.0 | ✅ |
| Reconocimiento | LLM en la nube | costo por uso, envía imágenes biométricas | ❌ |
| IDE | Android Studio | no hace falta: VS Code + SDK por línea de comandos | ❌ |

## Decisión

Expo SDK 58 con *development builds*, VisionCamera v5, MediaPipe oficial envuelto en un plugin Kotlin
propio, y un clasificador entrenado por nosotros en Python y exportado a LiteRT (`.tflite`).

## Consecuencias

- Hay que escribir algo de Kotlin (Hito 3). Lo aceptamos: es aprendizaje útil.
- Expo Go no sirve; siempre usamos `npx expo run:android`.
- **Queda abierto:** el runtime del clasificador en la app. `react-native-fast-tflite 3.0.1` trae LiteRT 1.4.0
  y podría chocar con las librerías nativas de MediaPipe. Se decide con una prueba en el Hito 5.

## Fuentes

- [Expo SDK 58](https://expo.dev/changelog/sdk-58) · [Expo SDK 55 (fin de la Legacy Architecture)](https://expo.dev/changelog/sdk-55)
- [What's New in VisionCamera V5](https://margelo.com/blog/whats-new-in-visioncamera-v5)
- [react-native-fast-tflite releases](https://github.com/margelo/react-native-fast-tflite/releases)
- [MediaPipe Gesture Recognizer](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer)
