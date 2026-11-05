# Reconocer palabras (señas léxicas) — investigación inicial

Fecha: 2026-11-05. Base para el Hito 7. Nada de esto está decidido: primero, la charla con una
profesora de LSA.

## Lo más importante

- **Nuestro caso (pocos ejemplos, agregar palabras sin reentrenar) tiene un antecedente directo
  en LSA:** Ferreira et al. 2022 entrenan un transformer chico con *triplet loss* sobre landmarks
  de MediaPipe (pose + manos, **sin cara**) de LSA64. Con 48 señas para entrenar, reconocen **16
  señas que el modelo nunca vio** a partir de pocos ejemplos: 85% con 10 ejemplos y 10 clases, y
  97,5% con 5 ejemplos y 4 clases. Una palabra nueva se agrega guardando su "huella" (*embedding*).
  [arXiv 2204.02803](https://ar5iv.labs.arxiv.org/html/2204.02803)
- **La malla completa de la cara empeora los resultados:** en LIBRAS, usar los 543 puntos rindió
  0,70; pose + manos, 0,95 ([arXiv 2510.24887](https://arxiv.org/html/2510.24887v3)). En el
  reconocimiento entre lenguas, los puntos de la boca también empeoraron. Buena noticia para la
  privacidad: alcanza con unos pocos puntos de la cara como referencia, que ya tenemos.
- **Hombros y codos parecen ayudar** en palabras, donde los brazos se mueven más.
- **Con muchos ejemplos, LSA64 está "resuelto":** SPOTER llega a 100%
  ([WACVW 2022](https://openaccess.thecvf.com/content/WACV2022W/HADCV/html/Bohacek_Sign_Pose-Based_Transformer_for_Word-Level_Sign_Language_Recognition_WACVW_2022_paper.html))
  y SignBart a 96% con 750 k parámetros ([arXiv 2506.21592](https://arxiv.org/abs/2506.21592)),
  pero con ~40–50 ejemplos por seña.
- **No hay proyectos públicos de reconocimiento de palabras de LSA en el teléfono.** En Perú hay
  datasets con keypoints (PUCP); en México y Brasil, datasets con subconjuntos de cara.
- **Kaggle "Isolated Sign Language Recognition" (2023):** 250 señas con landmarks de MediaPipe. Los
  modelos ganadores tenían que ser TFLite de menos de 40 MB y menos de 100 ms. El 1.º usó
  1D-CNN + Transformer sobre manos, labios, ojos y nariz, sin pose
  ([repo, MIT](https://github.com/hoyso48/Google---Isolated-Sign-Language-Recognition-1st-place-solution)).

## Enfoques, de más simple a más potente

| Enfoque | Ejemplos por palabra | ¿Agregar palabras sin reentrenar? | Nota |
|---|---|---|---|
| DTW + vecino más cercano (lo que hacemos en el nivel 3) | 5–10 | Sí | Simple; se vuelve lento y confuso con más de ~50 palabras |
| LSTM/GRU, transformer, ST-GCN con salida fija | 40 o más | No | Muy buenos con muchos datos |
| **Encoder de *embeddings* + prototipos** (triplet/contrastive) | 5–10 | **Sí** | Se entrena una vez con muchas señas (p. ej. LSA64); después, palabra nueva = promedio de sus *embeddings* |

## Detectar inicio y fin de una seña (segmentación)

Lo más simple, y también lo que resuelve nuestro problema de las transiciones:

- **Posición de reposo:** la seña empieza cuando las manos salen del reposo y termina cuando vuelven.
- **Velocidad con histéresis:** un umbral para arrancar, otro para cortar, y un mínimo de cuadros quieta.
- **Umbral de rechazo:** si la palabra más parecida está lejos, responder "no reconocido".
- **Ejemplos negativos:** grabar transiciones y gestos sin seña como clase "nada".

Lo más avanzado (BIO tagging, [Moryossef et al. 2023](https://aclanthology.org/2023.findings-emnlp.846))
no está pensado para correr en el teléfono en tiempo real.

## Vocabulario

- **Señario de la CAS:** el volumen 1 tiene 230 señas en 10 temas (saludos, familia, colores,
  números, escuela, provincias, clima…), con video desde 3 ángulos. "Todos los derechos reservados":
  sirve para consultar, no para entrenar con sus videos.
- **LSA64:** 64 palabras de uso cotidiano (42 de una mano y 22 de dos), CC BY-NC-SA 4.0.
- Criterio usado en ASL (PopSign): primeras palabras infantiles (inventario MacArthur-Bates).

## Recomendación (para discutir)

1. **Etapa A:** extender DTW a palabras (manos + ubicación respecto de la cara + orientación +
   ángulos de los dedos + segunda mano), con umbral de rechazo y una clase "transición".
   10–20 palabras, 10 ejemplos cada una en al menos 2 sesiones, empezando y terminando en reposo.
2. **Etapa B:** encoder de *embeddings* entrenado con LSA64 (extrayendo sus landmarks con los mismos
   modelos de MediaPipe) más los datos propios, siguiendo a Ferreira et al. Se evalúa siempre con
   palabras que el modelo no vio.
3. **Segmentación explícita** al principio (reposo → seña → reposo).

## Preguntas para la profesora

1. ¿Qué 20–30 palabras enseña primero? ¿Tienen variantes regionales?
2. ¿Cuáles se distinguen **solo** por la cara (boca, cejas, cabeza)? ¿Se pueden ignorar al principio?
3. ¿Cuáles son de una mano y cuáles de dos? ¿Se pueden espejar para personas zurdas?
4. ¿Cuál es la forma "de diccionario" de cada seña y cuánto varía en una conversación?
5. ¿Qué pares de señas confunden más sus estudiantes?
6. ¿Cuál es la posición de reposo natural entre señas?
7. ¿Qué señas tocan el cuerpo (pecho, mentón, frente)?
8. ¿Ella o sus estudiantes sordos grabarían sesiones (solo coordenadas, con consentimiento)?

## Sin verificar

El puntaje final del 1.º puesto de Kaggle, la licencia del dataset de Kaggle, la URL del diccionario
de la UNCuyo, el costo en FPS de sumar hombros y codos (Pose Landmarker) en Android y los números de
LSTM sobre LSA64 (vienen de agregadores, no del paper original).
