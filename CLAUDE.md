# senhas — laboratorio de reconocimiento de LSA

**Objetivo único: aprender.** Se prioriza hacerlo bien y entenderlo, no la velocidad.

## Estilo en este proyecto
- Explicaciones didácticas: en el informe final, explicá qué es cada concepto nuevo (RN, Expo, Android nativo, ML) y por qué se eligió, con alternativas.
- Autonomía total: hacé y explicá después. Antes de adoptar cualquier herramienta o librería, verificá su estado actual (mantenimiento, deprecaciones) y citá lo que consultaste.
- Al cerrar cada hito: quiz corto, reforzando los errores anteriores.

## Stack y estructura
- `app/`: Expo SDK 58 (dev build, no Expo Go), RN 0.88, TypeScript, VisionCamera 5. Solo Android (emulador + dispositivo físico).
- `ml/`: Python (MediaPipe + Keras → .tflite). `docs/`: PLAN.md y ADRs.
- ML on-device: MediaPipe Hand Landmarker (21 landmarks) → clasificador propio.

## Comandos (desde `app/`)
- `npm run check`: typecheck + lint + format:check. Tiene que pasar antes de cada commit.
- `npm run android`: compila e instala en el emulador o dispositivo.

## Reglas
- `docs/PLAN.md` es la fuente de verdad del progreso: actualizalo al completar ítems.
- Las decisiones técnicas relevantes van como ADR en `docs/decisiones/NNNN-titulo.md`.
- Privacidad: imágenes de manos/caras = datos biométricos (PII). Procesamiento solo on-device; los datasets guardan landmarks, nunca imágenes, y solo con consentimiento.
- Build en Windows: CMake 3.31.6 por rutas largas (ver ADR 0002).
