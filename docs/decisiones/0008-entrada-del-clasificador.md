# ADR 0008 — Entrada del clasificador: world landmarks normalizados

- **Estado:** aceptada
- **Fecha:** 2026-11-04

## Contexto

El clasificador del nivel 1 recibe una mano y devuelve una letra. MediaPipe da dos juegos de 21
puntos por mano:

- **Normalizados:** x e y entre 0 y 1, relativos al ancho y al alto de la imagen, que es de
  720×1280. Una unidad en x no mide lo mismo que en y, y la mano cambia de tamaño según la
  distancia a la cámara.
- **World landmarks:** en metros, centrados en la mano, con la misma escala en los tres ejes. Ya los
  giramos a vertical, como los normalizados (verificado en la etapa 4.1).

Para separar M, N y P hay que conservar la **orientación** de la mano: se distinguen porque apuntan
hacia abajo ([notas](../aprendizaje/parametros-de-la-sena.md)).

## Opciones evaluadas

| Opción | Veredicto |
|---|---|
| Normalizados (x, y) + tamaño de imagen | ❌ Más pasos, y la profundidad (z) en otra escala |
| World landmarks, con la rotación también normalizada | ❌ Mezclaría M, N y P |
| World landmarks, normalizando solo posición, escala y lateralidad | ✅ |

## Decisión

Normalización versión 1 (`ml/signs/features.py`):

1. World landmarks de la mano (21 × 3).
2. **Posición:** la muñeca pasa a ser el origen.
3. **Lateralidad:** si la persona es zurda, se espeja x. Todas las muestras quedan como una mano
   derecha. Se usa la mano dominante de la sesión, no la lateralidad que estima MediaPipe por cuadro.
4. **Escala:** se divide por la distancia muñeca → nudillo del dedo medio (punto 9). Una mano grande
   y una chica haciendo la misma letra quedan iguales.
5. **La rotación no se toca.**

El resultado son 63 números. La versión de la normalización va en el `manifest.json` de cada modelo:
la app tiene que aplicar exactamente los mismos pasos (Hito 5) y rechazar un modelo con otra versión.

**Evaluación:** los cuadros de una misma toma son casi idénticos. Separarlos al azar entre
entrenamiento y prueba daría resultados engañosamente buenos. Se deja afuera un grupo entero: una
persona por vez si hay varias, o una ronda por vez con una sola persona.

## Consecuencias

- Los normalizados siguen guardándose, junto con el tamaño de la imagen, para la relación mano–cara
  del nivel 2.
- Si la orientación respecto de la cámara varía mucho entre personas (teléfono inclinado), habrá que
  revisarlo con datos reales.
- La prueba de humo con datos sintéticos confirmó el espejado de los zurdos: un modelo entrenado
  con una persona "diestra" reconoce al 100% a una "zurda" espejada. No dice nada de la calidad, solo
  que el pipeline es correcto.

## Fuentes

- [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker):
  coordenadas normalizadas y de mundo.
- [world_landmark_projection_calculator.cc](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/calculators/util/world_landmark_projection_calculator.cc):
  rotación de los world landmarks.
