# Los parámetros de una seña

## La idea

Una palabra hablada se arma con sonidos. Una seña se arma con **parámetros**: rasgos que, si
cambian, pueden cambiar el significado. William Stokoe lo mostró en 1960 para la lengua de señas
americana (ASL), y fue la prueba de que las lenguas de señas tienen la misma estructura interna que
cualquier lengua.

| Parámetro | Qué es | Quién lo propuso |
|---|---|---|
| **Configuración** | La forma de la mano: qué dedos están extendidos, doblados o en contacto | Stokoe (1960) |
| **Ubicación** | Dónde se hace la seña: en el espacio neutro frente al cuerpo, o sobre la cara, el pecho, etc. | Stokoe (1960) |
| **Movimiento** | Si la mano se desplaza, gira o cambia de forma, y cómo | Stokoe (1960) |
| **Orientación** | Hacia dónde apuntan la palma y los dedos | Battison (años 70; las fuentes citan 1973 o 1978). Stokoe la trataba como parte de la configuración |
| **Rasgos no manuales** | Expresión de la cara, cabeza, hombros | Trabajos posteriores |

Para la **LSA**, Massone y Machado (1994) describen como aspectos fonológicos la configuración, la
orientación, la ubicación, la dirección del movimiento y los rasgos no manuales. Los programas de los
profesorados argentinos de LSA usan esa misma lista.

**Par mínimo:** dos señas que difieren en un solo parámetro. Es la prueba de que ese parámetro
importa. En el alfabeto pasa con la orientación: si dos letras tienen la misma forma de mano y solo
cambia hacia dónde apuntan, el modelo tiene que poder ver la orientación.

## Qué ve nuestro sistema de cada parámetro

| Parámetro | Lo que tenemos | Consecuencia |
|---|---|---|
| Configuración | Los 21 puntos de la mano, una vez normalizados (sin posición ni tamaño) | Es lo que aprende el clasificador del nivel 1 |
| Orientación | La rotación de esos puntos respecto de la pantalla; los `worldLandmarks` la dan en 3D | **No normalizar toda la rotación**: M, N y P se distinguen porque apuntan hacia abajo |
| Ubicación | Nada: Hand Landmarker no ve el cuerpo | Hace falta la referencia de la cara (etapa 4.3) para el nivel 2 |
| Movimiento | Secuencias de cuadros con timestamp | Por eso la captura guarda secuencias, no cuadros sueltos (nivel 3) |
| Cantidad de manos | `numHands` | Nivel 4, con el modo de dos manos |
| Rasgos no manuales | Nada, a propósito | No los necesitamos para el alfabeto, y capturar la cara es más invasivo |

Cada letra del catálogo ([`ml/languages/aed/letters.json`](../../ml/languages/aed/letters.json))
guarda justamente los parámetros que no salen de la forma de la mano: `hands`, `movement` y
`location`. De esos sale el nivel.

## Para confirmar con el video de la CAS

La clasificación de [`letters.json`](../../ml/languages/aed/letters.json) es **provisional**. Sale de
mirar la lámina de la CAS, que no lo dice en texto. Con el
[video de la CAS](https://cas.org.ar/alfabeto-manual-argentino/), revisá cada letra y, si coincide,
pasá su `verified` a `true`:

- **Movimiento** (nivel 3): CH, H, J, Z. ¿Hay otras que se muevan?
- **Dos manos** (nivel 4): Ñ, Q, W, X. Ojo con la **Q** y la **J**: ProyectoTDLSV las clasifica distinto.
- **Apoyadas en la cara o el cuerpo** (nivel 2): E, Y (ojo); G (oreja); I, T (nariz o boca); S (mentón); F (pecho o cuello). La J (cuello) y la H (frente a la cara) también tienen ubicación, pero van al nivel 3 por el movimiento.
- **Hacia abajo:** M, N, P.
- **V:** la CAS muestra dos variantes, y grabamos las dos (`V1` en el nivel 1, `V2` en el nivel 2, cerca de la cara). Ambas se reconocen como V.

## Fuentes

- Stokoe, W. (1960). *Sign Language Structure*. Resumen de su trabajo en el
  [CNLSE](https://cnlse.es/es/recursos/biblioteca/seeing-language-sign-work-william-c-stokoe).
- [American Sign Language phonology](https://en.wikipedia.org/wiki/American_Sign_Language_phonology)
  (Wikipedia): los parámetros de Stokoe y la orientación como parámetro propio (Battison).
- Massone, M. I. y Machado, E. (1994). *Lengua de Señas Argentina: análisis y vocabulario bilingüe*.
  Citado como referencia fonológica en
  [este documento de la UNCuyo](https://planificacion.bdigital.uncu.edu.ar/objetos_digitales/6909/07-guzman-ruedes4-6.pdf)
  y en el [programa de LSA del IPESCO](https://ipesco-scr.infd.edu.ar/sitio/wp-content/uploads/2023/07/PEE-DI-20-Lengua-de-Senas-Argentina-2023.pdf).
- [CAS, Alfabeto Manual Argentino](https://cas.org.ar/alfabeto-manual-argentino/).
