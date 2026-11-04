# ADR 0005 — Datos propios del alfabeto LSA, grabados con una captura tipo juego

- **Estado:** aceptada
- **Fecha:** 2026-11-04

## Contexto

Para entrenar el clasificador del alfabeto manual de la LSA necesitamos ejemplos etiquetados. Antes
de grabar los nuestros investigamos qué existe (noviembre de 2026):

- **No hay ningún dataset público del alfabeto manual de LSA.** Lo que existe son señas léxicas
  (LSA64), formas de mano (LSA16) y frases continuas (LSA-T).
- **LSA64** (UNLP): 3200 videos de 64 palabras, sin letras, con guantes fluorescentes. Licencia
  CC BY-NC-SA 4.0. Sirve más adelante para señas con movimiento.
- **LSA16** (UNLP): 800 imágenes de 16 formas de mano, que no coinciden con las letras. CC BY-NC-SA 4.0.
- **LSA-T / GloSL-LSA-T**: unas 22 h de frases del canal de CN Sordos. La licencia de los datos no
  está clara, e incluyen video o puntos de la cara (datos biométricos).
- **ProyectoTDLSV** (GitHub): alfabeto LSA con MediaPipe y TFLite, casi lo mismo que hacemos nosotros,
  pero **sin licencia** y sin dataset publicado.
- La referencia oficial del alfabeto es la lámina de la **Confederación Argentina de Sordos (CAS)**,
  con 28 signos. Tiene "todos los derechos reservados": sirve para consultar, no para redistribuir.

La restricción práctica: a cada persona que graba se la puede convocar **una sola vez y por pocos
minutos**.

## Opciones evaluadas

| Opción | Veredicto |
|---|---|
| Partir de un dataset público | ❌ No existe para el alfabeto |
| Reutilizar ProyectoTDLSV | ❌ Sin licencia: no se puede reutilizar legalmente |
| Grabar solo las letras estáticas ahora y el resto después | ❌ Obliga a convocar otra vez a las mismas personas |
| Grabar las 28 letras en una sesión corta, tipo juego, guardando todo lo necesario | ✅ |

## Decisión

- **Datos propios, solo landmarks.** Nunca imágenes ni video. Todo se procesa y se guarda en el
  teléfono, sin servidor. Cada persona da su consentimiento y se identifica con un código (`P01`…),
  no con su nombre.
- **Una sesión de unos 7–8 minutos por persona, con las 28 letras** agrupadas en 4 niveles: estáticas
  de una mano, apoyadas en la cara, con movimiento y con dos manos.
- **Ciclo por letra:** preparate (unos 1,5 s, no se guarda) → grabando (unos 2 s, 3 s si hay
  movimiento) → siguiente. Son **3 rondas en orden aleatorio**, para que haya variedad de posición y
  postura, con un botón para repetir.
- **Se guardan secuencias**, no cuadros sueltos. Así el mismo dato sirve para las letras estáticas y
  las dinámicas.
- **Ejemplo en pantalla:** un guante dibujado con Skia, con un color por letra, a partir de landmarks
  de referencia grabados por el autor. No usamos la lámina de la CAS ni imágenes de internet.
- **Se graba en el teléfono**, el mismo pipeline que usará la app, para que los datos de
  entrenamiento se parezcan a los de uso real.

## Consecuencias

- Antes de grabar a otras personas hay que cerrar qué guarda cada muestra: la referencia del cuerpo
  para las letras apoyadas en la cara y el formato versionado. Si falta algo, habría que volver a
  convocarlas.
- La clasificación de las letras en niveles sale de la ilustración de la CAS. Hay que confirmarla con
  el video de la CAS o con alguien que enseñe LSA.
- Con 3–5 personas el dataset es chico. Por eso se evalúa dejando afuera a una persona por vez, para
  medir cómo generaliza a gente que el modelo no vio.
- El preprocesado tiene que **conservar la orientación** de la mano: M, N y P se distinguen porque
  apuntan hacia abajo.

## Fuentes

- [LSA64](http://facundoq.github.io/datasets/lsa64/) y [LSA16](http://facundoq.github.io/datasets/lsa16/),
  páginas oficiales con su licencia (CC BY-NC-SA 4.0).
- [midusi/lsa-t](https://github.com/midusi/lsa-t) y
  [pedroodb/glosl-lsat](https://huggingface.co/datasets/pedroodb/glosl-lsat).
- [F200508/ProyectoTDLSV](https://github.com/F200508/ProyectoTDLSV): sin archivo de licencia.
- [CAS, Alfabeto Manual Argentino](https://cas.org.ar/alfabeto-manual-argentino/).
- Ronchetti et al., *LSA64: An Argentinian Sign Language Dataset* (CACIC 2016; arXiv 2310.17429).
- Dal Bianco et al., *LSA-T* (IBERAMIA 2022; arXiv 2211.15481).
