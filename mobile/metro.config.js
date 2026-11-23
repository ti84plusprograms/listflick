const { getDefaultConfig } = require("expo/metro-config");
const {
  withMultipartBundleCompression,
} = require("./config/metroMultipartCompression.cjs");

const config = getDefaultConfig(__dirname);
const defaultEnhanceMiddleware = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = (middleware, metroServer) => {
  const enhancedMiddleware = defaultEnhanceMiddleware(middleware, metroServer);

  if (process.env.LISTFLICK_METRO_COMPRESS_MULTIPART !== "1") {
    return enhancedMiddleware;
  }

  return withMultipartBundleCompression(enhancedMiddleware);
};

module.exports = config;
