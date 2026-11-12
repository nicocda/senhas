# Comparación: app React Native contra app Rust

Decisión y stack: [ADR 0013](../decisiones/0013-segunda-app-en-rust.md). Este archivo junta el
protocolo de medición y los resultados de las dos apps.

## Protocolo (igual para las dos apps)

Siempre en el **mismo teléfono**, con build release (sin Metro ni modo debug), brillo fijo, Wi-Fi
apagado y la app recién instalada. Paquete RN: `com.nicogiordano.senhas`.

| Métrica | Cómo se mide |
|---|---|
| Tamaño del APK | `ls -l` del APK release arm64 |
| Arranque en frío | `adb shell am force-stop <pkg>` y después `adb shell am start -W -n <pkg>/<actividad>`: `TotalTime`, mediana de 10 corridas |
| ms por cuadro | En Detectar, con una mano y la cara: conversión, inferencia de la mano, cara y clasificador. En RN, desde el panel de debug (`TrackingStats`); en Rust, con contadores equivalentes |
| Cuadros por segundo | Ídem, promedio de 1 minuto haciendo letras |
| Memoria | `adb shell dumpsys meminfo <pkg>`: `TOTAL PSS` después de 1 minuto en Detectar |
| CPU | `adb shell top -b -n 5 -d 2 -p <pid>`: promedio de `%CPU` |
| Batería | `adb shell dumpsys batterystats --reset`, desconectar el cable, 5 minutos en Detectar y después `adb shell dumpsys batterystats <pkg>` (consumo estimado en mAh) |
| Exactitud | `evaluate-spelling` (error por letra) con los mismos deletreos grabados |
| Desarrollo | Líneas de código por pieza, tiempo de compilación limpia e incremental, tiempo desde un cambio de UI hasta verlo en el teléfono |

## Resultados

| Métrica | React Native | Rust |
|---|---|---|
| Tamaño del APK (arm64) | 97,3 MB *(build del 2026-11-06, a repetir con `main`)* | — |
| Arranque en frío | — | — |
| ms por cuadro (mano / cara / clasificador) | — | — |
| Cuadros por segundo (una mano + cara) | — | — |
| Memoria (PSS) | — | — |
| CPU | — | — |
| Batería (5 min) | — | — |
| Error por letra (deletreos) | — | — |
| Tiempo de un cambio de UI hasta verlo | Fast Refresh: ~1 s | — |

## Notas

- Las dos apps usan los mismos `.tflite` de MediaPipe y los mismos `model.json`. Las diferencias
  vienen del runtime y del código, no de los modelos.
- En RN, MediaPipe ya corre en Kotlin nativo y solo el clasificador corre en JS. La ganancia de Rust
  en la inferencia de la mano debería ser chica. Donde se espera más diferencia: en el puente entre
  la cámara y el JS, en el tamaño del APK (sin Hermes ni React) y en el arranque.
