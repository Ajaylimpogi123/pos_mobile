// Learn more https://docs.expo.io/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Bundle Drizzle's generated `.sql` migrations (inlined by babel-plugin-inline-import).
config.resolver.sourceExts.push('sql');

// @pos/core (the rules shared with the web POS) is a `file:` link to ../packages/pos-core, outside
// this folder. It is not an npm workspace on purpose: the web POS uses another React version, and a
// shared install could hand Metro two copies of React. So Metro is told to watch that one folder.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../packages/pos-core')];
// Its files have no node_modules of their own; the Babel helpers injected into them resolve from ours.
config.resolver.nodeModulesPaths = [...(config.resolver.nodeModulesPaths ?? []), path.resolve(__dirname, 'node_modules')];

module.exports = config;
