// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Bundle Drizzle's generated `.sql` migrations (inlined by babel-plugin-inline-import).
config.resolver.sourceExts.push('sql');

module.exports = config;
