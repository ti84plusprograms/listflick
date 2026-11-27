const { getDefaultConfig } = require("expo/metro-config");

// Expo SDK 56 makes expo/fetch the global fetch. It rejects React Native
// FormData file parts ({ uri, name, type }), which the photo uploads in
// services/api.ts send, so keep React Native's fetch (Expo's documented opt-out).
process.env.EXPO_PUBLIC_USE_RN_FETCH ??= "1";
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
