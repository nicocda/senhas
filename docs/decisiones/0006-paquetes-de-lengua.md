# ADR 0006 — Paquetes de lengua: un catálogo por lengua de señas

- **Estado:** aceptada
- **Fecha:** 2026-11-04

## Contexto

Empezamos por el alfabeto de la LSA, pero queremos poder sumar otras lenguas de señas sin reescribir
la app ni el entrenamiento. Además, tres partes del proyecto necesitan la misma información sobre
cada letra:

- **La captura**, en la app: qué letra mostrar, de qué color, si necesita dos manos o la referencia
  de la cara, y cuánto dura la grabación.
- **El entrenamiento**, en Python: qué etiquetas existen y a qué nivel pertenece cada una.
- **El reconocimiento**, en la app: qué índice de la salida del modelo corresponde a qué letra.

Si cada parte tiene su propia lista, tarde o temprano dejan de coincidir. Y un modelo que devuelve
"clase 7" no sirve si no se sabe qué letra era la 7 cuando se entrenó.

## Opciones evaluadas

| Opción | Veredicto |
|---|---|
| Listas de letras escritas a mano en la app y en Python | ❌ Se desincronizan |
| Un catálogo por lengua en `ml/languages/<código>/`, que leen la app y Python | ✅ |
| El orden de las etiquetas, escrito a mano junto al modelo | ❌ Error silencioso si cambia el catálogo |
| El entrenamiento genera un `manifest.json` junto a cada `.tflite` | ✅ |

## Decisión

```text
ml/languages/aed/            ← código ISO 639-3 de la LSA
├─ letters.json              ← catálogo (a mano, versionado en git)
├─ data/                     ← sesiones exportadas de los teléfonos (fuera de git: datos de personas)
└─ models/<nivel>/           ← lo genera el entrenamiento
   ├─ model.tflite
   └─ manifest.json          ← labels en orden, hash del modelo, versión de normalización
```

- **Código de lengua ISO 639-3** (`aed` para la LSA). Es el estándar que identifica cada lengua de
  señas, en lugar de inventar nombres.
- **`letters.json`** es la única fuente de verdad del alfabeto. Tiene `schemaVersion` y, por letra:
  `id`, `level`, `hands`, `movement`, `location` (`neutral`, `face`, `body`), `color` y `verified`.
  Los campos guardan los parámetros de la seña que no salen de la forma de la mano (ver
  [los parámetros de una seña](../aprendizaje/parametros-de-la-sena.md)).
- **Variantes:** cada entrada es una **clase** del modelo. Si una letra tiene variantes (la V tiene
  dos en la LSA), cada variante es una entrada propia (`V1`, `V2`) con `letter: "V"`. Sin `letter`,
  la entrada representa la letra de su `id`. El modelo aprende cada forma por separado, y al
  reconocer se muestra la letra. Así una forma no "contamina" a la otra, y se ve cuál de las dos
  se confunde.
- **Pares mínimos:** `sameHandshapeAs` marca una entrada con la misma configuración que otra, que
  se distingue por otro parámetro. Por ejemplo, la E tiene la forma de la C pero se hace en el ojo.
  El entrenamiento lo usa para saber qué clases necesitan la referencia de la cara, y la
  evaluación, para saber qué confusiones esperar.
- **`verified: false`** hasta que una persona lo confirme contra la referencia de la CAS. La
  clasificación inicial se sacó de la ilustración.
- **El `manifest.json` lo genera el entrenamiento**, nunca se escribe a mano. La app lo lee para
  saber qué letra es cada salida del modelo y para rechazar un modelo entrenado con otra
  normalización.
- **Los datos de personas no entran en git** (`ml/.gitignore`).

## Consecuencias

- Sumar una lengua es crear `ml/languages/<código>/letters.json` y grabar sus datos.
- Cómo lee la app un archivo que está fuera de `app/` se decide en la etapa 4.6, al armar la
  captura. Las opciones son copiarlo en el build o configurar Metro.
- Si cambia el formato del catálogo, sube `schemaVersion` y los lectores lo validan.

## Fuentes

- [ISO 639-3: código `aed`](https://iso639-3.sil.org/code/aed), Argentine Sign Language.
- [ADR 0005](0005-datos-propios-captura-tipo-juego.md): datos propios y captura por niveles.
