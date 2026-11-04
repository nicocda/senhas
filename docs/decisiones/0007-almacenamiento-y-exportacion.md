# ADR 0007 — Dataset en el teléfono: SQLite y sesiones exportadas como JSON

- **Estado:** aceptada
- **Fecha:** 2026-11-04

## Contexto

La captura tipo juego ([ADR 0005](0005-datos-propios-captura-tipo-juego.md)) graba en el teléfono,
sin servidor. Podemos grabar en varios teléfonos en paralelo y después juntar todo en uno principal y
en la PC para entrenar. Solo se guardan coordenadas de la mano, nunca imágenes.

## Opciones evaluadas

| Opción | Veredicto |
|---|---|
| Solo archivos JSON por sesión | ❌ Contar, filtrar o descartar tomas obliga a reescribir archivos |
| Solo SQLite | ❌ Pasar datos entre teléfonos y a la PC necesita igual un formato de intercambio |
| SQLite como almacén y JSON por sesión para intercambiar | ✅ |

## Decisión

- **SQLite** (`expo-sqlite`) en el almacenamiento privado de la app, con dos tablas:
  - `sessions`: persona (código sin nombre), mano dominante, lengua, versión del catálogo y
    momento del consentimiento.
  - `takes`: una letra en una ronda, con la secuencia de cuadros en JSON y el tamaño de la imagen.
- **Migraciones con `PRAGMA user_version`.** Cada versión del esquema es un paso que corre una sola
  vez, en orden. La v2 agregó el tamaño de la imagen; las tomas anteriores quedan con `NULL`.
- **Repetir no borra:** una toma repetida se marca `discarded` y no se exporta.
- **Intercambio:** cada sesión se exporta a un JSON (`format: "senhas-session"`, con
  `formatVersion`), que guarda las tomas no descartadas. Los identificadores son UUID
  (`expo-crypto`), así no chocan entre teléfonos.
- **A la PC por USB:** `ml/pull_sessions.py` copia los exportados con `adb run-as`, sin pasar por
  la nube. El menú de compartir de Android también está disponible, pero manda datos de personas a
  servicios de terceros.
- **Cada cuadro guarda:** tiempo desde el inicio de la toma, y por cada mano la lateralidad, la
  confianza, los 21 puntos normalizados y los 21 world landmarks, redondeados a 5 decimales (menos
  de un píxel; 0,01 mm).

## Consecuencias

- Un nivel completo (39 tomas, unos 1150 cuadros) pesa unos 30 KB sin manos detectadas y bastante
  más con manos: cada mano suma 126 números por cuadro.
- Falta importar sesiones en el teléfono principal y borrar sesiones desde la app (ver `PLAN.md`).
  Mientras tanto, se borran con `adb run-as`.
- Los datos de personas no entran en git (`ml/.gitignore`).

## Fuentes

- `expo-sqlite` 58.0.15, `expo-file-system` 58.0.13, `expo-sharing` 58.0.22 y `expo-crypto` 58.0.7:
  APIs leídas en `node_modules` (`openDatabaseAsync`, `withTransactionAsync`, `File`, `Paths`,
  `shareAsync`, `randomUUID`).
- [SQLite: PRAGMA user_version](https://www.sqlite.org/pragma.html#pragma_user_version).
