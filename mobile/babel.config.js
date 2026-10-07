module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Drizzle's expo-sqlite migrations import the generated `.sql` files as strings
    // (src/db/migrations/migrations.js): https://orm.drizzle.team/docs/connect-expo-sqlite
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
