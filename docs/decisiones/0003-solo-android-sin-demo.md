# ADR 0003 — Solo Android: quitar la demo y el soporte web de la plantilla

- **Estado:** aceptada
- **Fecha:** 2026-11-03

## Contexto

La plantilla `default@sdk-58` trae una app de demostración (pestañas, logos, componentes de ejemplo)
y soporte para web (`react-native-web`, `react-dom`, archivos `*.web.tsx`). Nosotros solo apuntamos a
Android ([ADR 0001](0001-stack-tecnologico.md)).

Al agregar el hook que corre `npm run check` antes de cada commit, apareció un error de tipos en
`src/components/app-tabs.web.tsx`, un archivo de la demo que solo existe para web: el `ref` de
`TabTriggerSlotProps` (expo-router 58.0.29) no es compatible con el del `Pressable` de RN 0.88.
El error venía desde el primer commit de la app y nadie lo había visto.

## Opciones evaluadas

| Opción | Veredicto |
|---|---|
| Silenciar el error (`as any`, `@ts-expect-error`) | ❌ Parche sobre código que no vamos a usar |
| Corregir el tipo en la demo | ❌ Mantener código ajeno a nuestro objetivo |
| Quitar la demo y la web, como ya preveía el Hito 1 | ✅ |

## Decisión

- Correr `reset-project` borrando la demo (git conserva el historial) y quitar el script.
- Quitar la web: bloque `web` de `app.json`, script `web`, `favicon.png`, `react-dom` y `react-native-web`
  (son *peer dependencies* opcionales de `expo` y `expo-router`).
- Desinstalar las dependencias que solo usaba la demo: `@expo/ui`, `expo-device`, `expo-font`,
  `expo-glass-effect`, `expo-image`, `expo-status-bar`, `expo-symbols`, `expo-web-browser`.
- **Se quedan** las *peer dependencies* obligatorias de `expo-router` (`expo-constants`, `expo-linking`,
  `react-native-screens`, `react-native-safe-area-context`), `expo-splash-screen` y `expo-system-ui`
  (usados por `app.json`), y `react-native-gesture-handler`, `react-native-reanimated` y
  `react-native-worklets`. VisionCamera v5 necesita `react-native-worklets`; los otros dos se revisan
  en el Hito 3, cuando se elija la librería para dibujar el esqueleto.
- Se dejan el bloque `ios` y el script `ios`: no molestan y no son parte de esta limpieza.

## Consecuencias

- `npm run check` pasa y `npx expo-doctor` pasa los 20 chequeos.
- Menos módulos nativos: compilaciones más rápidas y menos superficie para errores.
- Si alguna vez hiciera falta web, habría que volver a instalar esas dependencias.

## Fuentes

- `app/scripts/reset-project.js` (plantilla de Expo SDK 58), leído antes de ejecutarlo.
- `peerDependencies` y `peerDependenciesMeta` de `expo@58.0.23` y `expo-router@58.0.30` en `node_modules`.
- [Expo: Dependency validation](https://expo.fyi/dependency-validation)
