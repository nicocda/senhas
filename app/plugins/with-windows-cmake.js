// @ts-check
/**
 * Config plugin: en Windows, apunta Gradle a una CMake con Ninja >= 1.12.
 *
 * Por qué: la CMake por defecto del plugin de Android (3.22.1) trae Ninja 1.10.2,
 * que no declara soporte de rutas largas. Las librerías nativas (p. ej. Reanimated)
 * generan rutas de más de 260 caracteres y el build falla con "ninja: error: mkdir".
 * Ver docs/decisiones/0002-cmake-rutas-largas-windows.md
 *
 * Cómo: escribe `cmake.dir` en android/local.properties cada vez que Expo genera
 * la carpeta android/ (prebuild). La ruta del SDK sale de ANDROID_HOME, así que no
 * queda ninguna ruta personal en el repo.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const CMAKE_VERSION = '3.31.6';

/** Formato .properties: barras normales y ":" escapado (C\:/...). */
function toPropertiesPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

/** Reemplaza (o agrega) una clave sin tocar las demás líneas. Idempotente. */
function setProperty(contents, key, value) {
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key.replace('.', '\\.')}=.*$`, 'm');
  if (regex.test(contents)) return contents.replace(regex, line);
  const base = contents.length === 0 || contents.endsWith('\n') ? contents : `${contents}\n`;
  return `${base}${line}\n`;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withWindowsCmake = (config) =>
  withDangerousMod(config, [
    'android',
    async (cfg) => {
      // En macOS/Linux el problema no existe: no tocamos nada.
      if (process.platform !== 'win32') return cfg;

      const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
      if (!sdk) {
        console.warn('[with-windows-cmake] ANDROID_HOME no está definido; se omite cmake.dir.');
        return cfg;
      }

      const cmakeDir = path.join(sdk, 'cmake', CMAKE_VERSION);
      if (!fs.existsSync(cmakeDir)) {
        console.warn(
          `[with-windows-cmake] No existe ${cmakeDir}. Instálala con: android sdk install cmake/${CMAKE_VERSION}`,
        );
        return cfg;
      }

      const file = path.join(cfg.modRequest.platformProjectRoot, 'local.properties');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      fs.writeFileSync(file, setProperty(current, 'cmake.dir', toPropertiesPath(cmakeDir)));
      return cfg;
    },
  ]);

module.exports = withWindowsCmake;
