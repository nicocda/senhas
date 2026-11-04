// Learn more: https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The sign catalogs live in ../ml/languages, shared with the Python training
// (ADR 0006). On-demand filesystem access did not resolve them, so Metro
// watches that folder explicitly (and reloads when a catalog changes).
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../ml/languages')];

module.exports = config;
