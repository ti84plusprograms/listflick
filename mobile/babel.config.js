module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // Resolve the preset that ships with `expo`, whether npm nests it under
      // expo/node_modules or hoists it to the top level.
      require.resolve("babel-preset-expo", { paths: [require.resolve("expo/package.json")] }),
    ],
  };
};
