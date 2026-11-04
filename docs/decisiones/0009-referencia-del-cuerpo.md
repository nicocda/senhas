# ADR 0009 — Referencia del cuerpo: Face Detector, activable

- **Estado:** aceptada (provisional: se confirma con los datos del nivel 2)
- **Fecha:** 2026-11-04

## Contexto

Hand Landmarker solo ve la mano. Las letras del nivel 2 se distinguen por **dónde** se hacen: la E
es una C hecha en el ojo, y la F se hace en el pecho. Hace falta saber dónde está el cuerpo, con
puntos mínimos (nunca la malla de la cara, mucho más identificable). Basta una ubicación aproximada.

## Opciones evaluadas

Medido en el teléfono (Xiaomi, CPU), con una persona frente a la cámara y una mano por cuadro:

| Opción | Puntos | Tiempo del modelo | FPS totales | Orientación |
|---|---|---|---|---|
| Sin referencia | — | — | 15 | — |
| **Face Detector** (BlazeFace short range, 230 KB) | 6: ojos, nariz, boca, tragos de las orejas | **~31 ms** | 9 | ✅ ojos (y≈0,53) arriba de la boca (y≈0,60) |
| Pose Landmarker lite (5,8 MB) | 0–12 de 33: cara y hombros | ~66 ms | 7 | ✅ nariz (y≈0,52) arriba de los hombros (y≈0,62) |

Google publica ~3 ms para BlazeFace en un Pixel 6; en este teléfono, con la imagen de 720×1280,
tarda unas diez veces más.

## Decisión

- **Face Detector**: cuesta la mitad que la pose y da directamente los ojos y la boca, que es lo que
  necesitan la E, la Y, la I, la T y la S. El cuello y el pecho (F) se **estiman** desde la cara (una
  o dos alturas de cara por debajo de la boca).
- **Activable** (`bodyReference: 'none' | 'face' | 'pose'`), apagada por defecto como el modo de dos
  manos. La captura la va a encender solo en las letras que la necesitan.
- Los puntos vuelven en la imagen vertical, con la misma rotación que la mano. Se guardan en cada
  cuadro (`body`) junto a las manos.
- La pose queda disponible en el código para comparar con los datos reales.

## Consecuencias

- Mientras está encendida, los FPS bajan de 15 a 9: con 3 s de grabación siguen siendo unos
  27 cuadros por toma.
- **Provisional:** si la estimación del pecho no alcanza para separar la F, se cambia a la pose solo
  para esa letra.
- Los tres modelos se descargan al compilar, fijados a la versión 1 y verificados con SHA-256.

## Fuentes

- [Face Detector](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector) y
  [Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker):
  modelos, puntos y modo VIDEO.
- APIs de `tasks-vision` 1.2.2 y `tasks-core` 1.2.2 leídas con `javap` (`FaceDetector`,
  `PoseLandmarker`, `Detection.keypoints()`).
