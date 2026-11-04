// @ts-check
/**
 * Config plugin: marca la build release como "debuggable".
 *
 * Por qué: la release lleva el JS adentro y funciona sin Metro ni cable, pero
 * `adb run-as` (con el que ml/pull_sessions.py lee la base de datos del teléfono)
 * solo funciona con apps debuggable. Esta app es un laboratorio: no se publica en
 * ninguna tienda, así que no hay costo en dejarla debuggable.
 * Ver docs/decisiones/0011-build-release-sin-cable.md
 *
 * Cómo: agrega `debuggable true` al bloque `release` de android/app/build.gradle
 * cada vez que Expo genera la carpeta android/ (prebuild). Idempotente.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'debuggable true // with-debuggable-release';

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = function withDebuggableRelease(config) {
  return withAppBuildGradle(config, (gradle) => {
    const contents = gradle.modResults.contents;
    if (contents.includes(MARKER)) {
      return gradle;
    }
    const release = /(buildTypes\s*\{[\s\S]*?release\s*\{)/;
    if (!release.test(contents)) {
      throw new Error('with-debuggable-release: no release buildType in app/build.gradle');
    }
    gradle.modResults.contents = contents.replace(release, `$1\n            ${MARKER}`);
    return gradle;
  });
};
