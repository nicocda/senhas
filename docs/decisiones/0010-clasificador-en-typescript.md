# ADR 0010 — El clasificador corre en TypeScript, sin runtime nativo de ML

- **Estado:** aceptada
- **Fecha:** 2026-11-04

## Contexto

La decisión abierta del Hito 5 era dónde corre el clasificador de letras en el teléfono. Las
opciones previstas eran `react-native-fast-tflite`, que trae su propia versión de LiteRT y podría
chocar con las librerías nativas de MediaPipe, o sumarlo al plugin Kotlin.

Con los datos reales, el clasificador resultó ser una red mínima: 66 números de entrada (70 con la
ubicación), capas de 128 y 64 neuronas y una salida por letra. Son unas 17.000 multiplicaciones por
cuadro.

## Opciones evaluadas

| Opción | Veredicto |
|---|---|
| `react-native-fast-tflite` | ❌ Dependencia nativa y posible choque de LiteRT con MediaPipe, para una red de 17k multiplicaciones |
| `.tflite` dentro del plugin Kotlin | ❌ Recompilar por cada modelo; la entrada (normalización) ya se arma en JS |
| **Pesos en JSON y la cuenta en TypeScript** | ✅ |

## Decisión

- `train.py` exporta, además del `.tflite`, un `model.json` con las capas densas (pesos, sesgos y
  activación), las etiquetas y la versión de la normalización.
- `app/src/recognition/classifier.ts` hace la cuenta: por cada capa,
  `salida = activación(entrada · pesos + sesgo)` (ReLU o softmax).
- La entrada se arma con `normalizeHand` y `handLocation` (`app/src/dataset/features.ts`), que son
  copias exactas de las de Python. El clasificador rechaza un modelo entrenado con otra versión de
  la normalización.
- Como mano dominante se usa la lateralidad que detecta MediaPipe: en las sesiones de Nico dijo
  "right" en el 99,8% de los cuadros.
- **Suavizado:** se vota entre los últimos 10 cuadros (~0,7 s). La letra se muestra solo si gana al
  menos 6 de 10 votos, con confianza media de 60% o más; si no, aparece "¿…?".

**Un solo modelo (2026-11-04):** `train.py --level static` entrena las 21 letras estáticas de una mano
juntas (niveles 1 y 2), y la app lo usa por defecto ("Todas las letras"). Usa la ubicación solo si
**todas** las tomas tienen la cara: mezclar tomas con y sin cara le enseñaría al modelo que "sin
cara" significa ciertas letras. Por eso la captura ahora enciende la cara en todos los niveles.
Al evaluar, se deja afuera una persona por vez solo si cada persona tiene todas las letras; si no,
una ronda.

## Verificación

- La salida de TypeScript coincide con la del `.tflite`: la misma letra en **2578/2578** cuadros
  (nivel 1) y **854/854** (nivel 2), con una diferencia máxima de 1e-6 en las probabilidades.
- `normalizeHand` y `handLocation` coinciden con Python en todos los cuadros reales (diferencia
  máxima de 5e-6, la que hay entre float32 y float64).

## Consecuencias

- No se recompila la app por un modelo nuevo: alcanza con reentrenar y recargar el JS.
- Los `model.json` se generan con `train.py` y están fuera de git, como los datos de los que salen:
  hay que entrenar antes de empaquetar la app. Cómo distribuir modelos queda para más adelante.
- Si el modelo crece (por ejemplo, uno temporal para el nivel 3), se vuelve a evaluar el `.tflite`.
- Gotcha: el plugin de Babel de Worklets falla si una variable capturada se llama igual que el
  método `onFrame` del frame processor; la opción del hook se llama `onLiveFrame`.
