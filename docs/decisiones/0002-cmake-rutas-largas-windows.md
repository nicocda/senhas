# ADR 0002 — CMake 3.31.6 para soportar rutas largas en Windows

- **Estado:** aceptada
- **Fecha:** 2026-11-02

## Contexto

El primer `npx expo run:android` falló después de 16 minutos compilando la parte C++ de Reanimated:

```text
ninja: error: mkdir(CMakeFiles/reanimated.dir/C_/Users/.../rnreanimated): No such file or directory
```

- CMake nombra cada `.o` copiando la ruta absoluta del archivo fuente dentro de la carpeta de build,
  así que la ruta del proyecto aparece **dos veces**. El archivo más largo mide unos 316 caracteres,
  y el límite clásico de Windows es 260.
- Windows ya tenía `LongPathsEnabled = 1`, pero cada programa además debe declarar `longPathAware`
  en su manifiesto.
- El plugin de Android (AGP) usa por defecto **CMake 3.22.1**, que trae **Ninja 1.10.2 sin `longPathAware`**.
  CMake 3.31.6 trae **Ninja 1.12.1 con `longPathAware`**. Lo verificamos buscando el texto en los dos `ninja.exe`.

## Opciones evaluadas

| Opción | Resultado |
|---|---|
| Variable `CMAKE_VERSION` (la recomienda la guía de Reanimated) | ❌ Al leer el código vimos que Reanimated 4.7 no la lee: solo la usa `ReactAndroid` |
| Acortar la ruta del proyecto | ❌ Haría falta una raíz de unos 4 caracteres y quedaríamos al límite; con más librerías nativas volvería a fallar |
| WSL2 | ⏸️ Funcionaría, pero cambia todo el entorno. Queda como plan B |
| `cmake.dir` en `android/local.properties` → CMake 3.31.6 | ✅ Reanimated compiló (`BUILD SUCCESSFUL`) y el `.o` de 316 caracteres se creó |

## Decisión

Instalar `cmake/3.31.6` en el SDK (`android sdk install cmake/3.31.6`) y escribir `cmake.dir` en
`android/local.properties`. Como `android/` se regenera (CNG), ese archivo lo escribe un **config plugin
local**: [`app/plugins/with-windows-cmake.js`](../../app/plugins/with-windows-cmake.js). El plugin:

- solo actúa en Windows;
- toma la ruta del SDK de `ANDROID_HOME`, así que no queda ninguna ruta personal en el repo;
- es idempotente y solo agrega o reemplaza la clave `cmake.dir`;
- si falta la CMake, avisa con el comando para instalarla, en lugar de fallar.

## Consecuencias

- Quien clone el repo en Windows debe correr `android sdk install cmake/3.31.6`.
- Hay que revisar esta decisión al actualizar el SDK de Expo o AGP: si AGP adopta por defecto una CMake
  con Ninja ≥ 1.12, el plugin sobra.
- Lección: **la documentación puede estar desactualizada respecto del código.** La fuente de verdad es el código.

## Fuentes

- [Reanimated: Building for Android on Windows](https://docs.swmansion.com/react-native-reanimated/docs/guides/building-on-windows/)
- [Ninja issue #1900 (long paths)](https://github.com/ninja-build/ninja/issues/1900)
- [ClashKing PR #242 (CMake 3.31.6 / Ninja 1.12.1)](https://github.com/ClashKingInc/ClashKingApp/pull/242)
- [Expo: dangerous mods](https://docs.expo.dev/config-plugins/dangerous-mods/)
