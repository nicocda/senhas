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

**Todas las letras (2026-11-04):** `recognition/live.ts` elige el modelo en cada cuadro: con dos manos,
el clasificador del nivel 4 (forma de ambas manos + posición relativa); con una mano que se movió
lo suficiente, DTW contra las plantillas del nivel 3 (`recognition/sequences.ts`, también en
TypeScript); si no, el modelo estático. DTW con 24 plantillas de 32 cuadros se corre unas 3 veces
por segundo. Paridad verificada: las características de dos manos coinciden en 515/515 cuadros y
DTW elige la misma plantilla en 12/12 tomas (diferencia de distancia 4e-7).

**Prioridad a las letras estáticas (2026-11-05):** en vivo, una A con el pulso temblando salía como
CH. Se simuló Detectar sobre las tomas grabadas (ventanas de 2,5 s cada 300 ms): en el **26%** de las
ventanas de letras estáticas, DTW aceptaba una letra con movimiento (CH 75, Z 31, J 26 de 511). El
recorrido (largo del camino del índice) suma el temblor y el ruido de los puntos de los ojos; el
umbral de DTW es uno solo (1,70), fijado por la letra más variable. Se probaron, dejando afuera la
sesión evaluada:

| Regla | Ventanas estáticas que disparan | Efecto en H, J, Z |
|---|---|---|
| Ninguna (antes) | 132/511 | — |
| Margen sobre la segunda letra (×1,4) | 29 | la Z deja de reconocerse |
| **Amplitud ≥ 60% de la típica de la letra** | 78 (55 son CH) | se mantienen |
| **Amplitud + sin CH** | **23** | se mantienen |

- **Amplitud:** diagonal de la caja que encierra la trayectoria del índice. El temblor va y vuelve,
  así que no la agranda; un movimiento real sí. La típica de cada letra es la mediana de sus
  plantillas (H 6,3; J 5,2; Z 6,7; CH 1,7 distancias entre ojos). Se calcula en la app a partir del
  `model.json`, sin reentrenar.
- **La CH no se reconoce en vivo:** casi no se desplaza (rota), y su amplitud y su distancia DTW se
  superponen con las de una mano quieta que tiembla o se acomoda. Sigue en el catálogo y en la
  captura; Nico ya había propuesto sacarla.
- Verificado con el `LiveRecognizer` real (Node) sobre todas las tomas: las tomas estáticas donde
  aparece una letra con movimiento bajaron de 24/126 a 3/126 (J); H 6/6, J 6/6, Z 4/6 (antes 5/6,
  la diferencia no depende del umbral: con 50% también da 4/6).
- Lo que queda (transiciones grandes de verdad) se ataca con lo que propone la investigación de
  palabras: posición de reposo y ejemplos de "ninguna".

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
