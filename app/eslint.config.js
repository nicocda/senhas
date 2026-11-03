// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
// Apaga las reglas de ESLint que chocan con Prettier (el formato lo maneja Prettier).
// Va al final para que pise a las anteriores.
const prettierConfig = require('eslint-config-prettier/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  prettierConfig,
]);
