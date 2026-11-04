# ADR 0011 — Build release para usar la app sin cable ni Metro

- **Estado:** aceptada
- **Fecha:** 2026-11-04

## Contexto

En desarrollo, la app no lleva su JavaScript adentro: se lo pide a Metro, que corre en la PC, por el
túnel USB (`adb reverse`). Sin cable o sin Metro, la app queda en "iniciando". Nico quiere usar la
app en el teléfono de forma independiente (grabar, reconocer).

## Opciones evaluadas

| Opción | Veredicto |
|---|---|
| Debug + Metro por WiFi | ❌ Sigue necesitando la PC prendida, y abrir el firewall de Windows |
| Release normal | ❌ Funciona sola, pero `adb run-as` no anda con apps no debuggable: `pull_sessions.py` no podría leer la base de datos |
| **Release marcada como debuggable** | ✅ |

## Decisión

- Build **release** (`npx expo run:android --variant release`): el JS va empaquetado y compilado a
  bytecode de Hermes dentro del APK. Los modelos, las plantillas y las guías (`ml/languages/*/models/`)
  también van adentro, porque la app los importa.
- Config plugin `plugins/with-debuggable-release.js`: agrega `debuggable true` a la release para que
  `pull_sessions.py` siga leyendo las sesiones por USB. La app no se publica en ninguna tienda.
- Se firma con la misma clave de debug que la build de desarrollo. Por eso una se puede instalar
  encima de la otra **sin perder las sesiones guardadas**: Android solo deja actualizar una app si la
  firma coincide.

**Compilarla solo para arm64** (`npm run release:phone`, que llama a Gradle con
`-PreactNativeArchitectures=arm64-v8a` y la instala con `adb install -r`). La primera release,
con `expo run:android --variant release`, compiló el C++ para las cuatro arquitecturas: tardó
1 h 8 min, llenó el disco (unos 9 GB de intermedios solo de la release) y dejó un Metro abierto que
la release no usa.

## Verificación

- Con Metro apagado y sin `adb reverse`, la app arranca sola en el teléfono.
- Android la marca `DEBUGGABLE` y `pull_sessions.py` sigue leyendo las 7 sesiones, que
  sobrevivieron a la instalación encima de la build de debug.

## Consecuencias

- Para cambiar el código hay que volver a compilar la release (unos minutos). Para desarrollar, sigue
  la build de debug con Metro (`npm run android`).
- Cada vez que se reentrena un modelo o se regeneran las guías, hay que recompilar la release para que
  los lleve.
- Antes de instalar una build encima de otra, conviene respaldar con `pull_sessions.py`.
- No sirve para publicar: una app para tienda necesita su propia clave y no puede ser debuggable.

## Fuentes

- [React Native: Publishing to Google Play Store](https://reactnative.dev/docs/signed-apk-android)
  (firma de la release; el template la firma con la clave de debug).
- `@expo/config-plugins` 58: `withAppBuildGradle`, leído en `node_modules`.
