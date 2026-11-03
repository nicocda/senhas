# Señas

Laboratorio para aprender React Native: una app Android que usa la cámara del teléfono para detectar
las manos y reconocer **LSA (Lengua de Señas Argentina)**, empezando por el alfabeto manual.

Todo corre en el teléfono: MediaPipe detecta 21 puntos de la mano y un clasificador propio
(entrenado en Python, exportado a `.tflite`) decide la seña. No se suben imágenes a ningún servidor.

## Estructura

| Carpeta | Contenido |
|---|---|
| [`app/`](app/) | App Expo (SDK 58, React Native 0.88, TypeScript) |
| `ml/` | Python: dataset, entrenamiento y export del modelo (Hito 4) |
| [`docs/`](docs/) | [Plan de trabajo](docs/PLAN.md) y [decisiones (ADRs)](docs/decisiones/) |

## Requisitos

- Windows con Node 24, JDK 17 y el Android SDK por línea de comandos (`ANDROID_HOME`).
- CMake 3.31.6 del SDK por las rutas largas de Windows ([ADR 0002](docs/decisiones/0002-cmake-rutas-largas-windows.md)).
- Un emulador Android o un teléfono con depuración USB.

## Comandos (desde `app/`)

```bash
npm install
npm run android   # compila el development build y lo instala
npm start         # levanta Metro (el servidor de JS) si la app ya está instalada
npm run check     # typecheck + lint + formato
```

El progreso está en [docs/PLAN.md](docs/PLAN.md).
