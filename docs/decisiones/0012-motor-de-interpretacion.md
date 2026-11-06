# ADR 0012 — Motor de interpretación: de cuadros a texto

- **Estado:** aceptada
- **Fecha:** 2026-11-06

## Contexto

Detectar decidía cuadro a cuadro (`recognition/live.ts`): votación sobre los últimos 10 cuadros
para las letras estáticas y DTW cada 300 ms sobre los últimos 2,5 s para las letras con movimiento.
Nico pidió distinguir una **transición**, una **vibración** y una **letra completa**, decidir las
letras con movimiento mirando el pasado, trabajar con tiempos en vez de cantidad de cuadros y
escribir lo que se reconoce como texto.

Para medirlo se grabaron deletreos de palabras (`app/spell.tsx`, 14 palabras, una sesión lenta y
otra rápida) y se armó un evaluador (`npm run evaluate:spelling`). Pasa cada deletreo por el motor,
en Node, y mide el **error por letra**: distancia de edición entre el texto y la palabra.

## Lo que mostraron los datos

- El clasificador sí ve casi todas las letras; se perdían en las reglas.
- Con dos manos y la cara, el teléfono procesa **8–9 cuadros por segundo** (113–127 ms entre
  cuadros). Diez cuadros son más de un segundo.
- Deletreando rápido, **el brazo se desplaza mientras la mano sostiene la letra**: la R de PERRO
  se ve al 100% con la punta del índice a 3–4 distancias entre ojos por segundo. La velocidad no
  sirve para decidir si una letra está "quieta".
- Velocidad del índice, en distancias entre ojos por segundo:

  | Caso | Velocidad |
  |---|---|
  | Letra quieta | mediana 0,5; 90% por debajo de 1,5 |
  | Pico de una letra con movimiento | 90% por encima de 5 |

- El umbral de DTW era uno solo (1,70), fijado por la letra más variable (Z). Las transiciones de
  los deletreos quedaban a 1,22–1,40 de una J y entraban; la J verdadera de JUEGO, a 0,89.

## Decisión

Un motor nuevo, `recognition/interpreter.ts`, que sigue el modelo **Movimiento–Detención**
([Liddell y Johnson, 1989](https://cnlse.es/es/recursos/biblioteca/american-sign-language-phonological-base)):
cada seña alterna detenciones y movimientos. Todo se mide en milisegundos.

- **Letra estática = detención de la forma:** el clasificador dice la misma letra, con confianza
  ≥ 0,6, durante **≥ 350 ms**. Tolera huecos de hasta 250 ms (cuadros borrosos), y la mano puede
  desplazarse mientras tanto.
- **Movimiento:** empieza cuando el índice supera 3 distancias entre ojos por segundo y termina
  cuando pasa 150 ms por debajo de 1,5. Usar dos umbrales distintos (histéresis) evita que una
  velocidad cerca del límite haga parpadear el estado.
- **Letra con movimiento:** el movimiento se compara con las plantillas recién **cuando termina**.
  Se acepta si queda bajo el **umbral de su letra** y si está casi completo (amplitud ≥ 60% de la
  típica). Si se acepta, las letras escritas desde que empezó se retiran, porque eran su forma
  inicial. La forma en que termina (la J termina como una I) no se vuelve a escribir.
- **Umbral por letra:** `train_sequences.py` calcula para cada letra la misma regla que antes se
  usaba para todas: 1,25 × la distancia de su coincidencia correcta más lejana, dejando una toma
  afuera. Da J 0,86, H 1,35 y Z 1,70. Se calculó con las tomas de entrenamiento, no ajustándolo
  a los deletreos.
- **Texto:** una letra no se repite seguida a menos que la mano haya salido del cuadro (400 ms sin
  verla). Uno o dos cuadros sin mano son el detector que la pierde, no la mano que se va.
- Detectar muestra el texto que se va formando, la letra que se está sosteniendo en gris (más
  opaca a medida que se acerca a los 350 ms) y un botón para borrar.

## Opciones evaluadas

| Variante | Lenta | Rápida |
|---|---|---|
| Motor anterior (`live.ts`) | 31% | 44% |
| Detención solo con la mano quieta (por velocidad) | 23% | 48% |
| Detención por forma, aunque la mano se mueva | 23% | 38% |
| Ídem, sin letras con movimiento | 26% | 30% |
| Ídem + umbral DTW por letra | 23% | 30% |
| **Ídem + 400 ms sin mano para "soltar"** | **21%** | **30%** |
| Tiempo mínimo de 200 o 250 ms en vez de 350 | peor | peor |
| Retirar letras hasta 400 ms antes del movimiento | peor | peor |

Controles con las tomas de letras sueltas: el 87% escribe exactamente su letra. Solo 1 de 177
letras quietas escribe una letra con movimiento. Se encuentran 15 de 18 letras con movimiento,
aunque esto es optimista porque esas tomas son las plantillas.

## Consecuencias

- `recognition/live.ts` se elimina; Detectar usa el `Interpreter`. Los modos "solo nivel 1/2"
  siguen mostrando un clasificador cuadro a cuadro, para mirar un modelo solo.
- El `model.json` de movimiento lleva `thresholds` por letra. Si falta (modelo viejo), se usa el
  global.
- Lo que queda, en orden de peso:
  - **Letras dobles** (LLAVE, PERRO): falta saber cómo se marcan en LSA (pregunta para la profesora).
  - **Primera letra** perdida al deletrear rápido.
  - **Confusiones del clasificador:** Y→U, E→F, T→I.
  - La J de JUEGO lento queda apenas arriba de su umbral (0,89 contra 0,86).
- Los umbrales se eligieron mirando estas dos sesiones. El número que vale es el de una sesión
  nueva, grabada sin mirarla antes (pendiente).
