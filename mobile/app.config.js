const path = require("path");
const { readReversedClientId, GOOGLE_URL_SCHEME_PLACEHOLDER } = require("./plugins/googleUrlScheme");

const expo = require("./app.json").expo;
const GOOGLE_SIGN_IN_PLUGIN = "@react-native-google-signin/google-signin";

// The iOS URL scheme for Google Sign-In comes from the local, gitignored Firebase plist
// so the real client ID is never committed. Without the plist, the placeholder keeps
// `expo config` and prebuild working on a fresh clone.
const iosUrlScheme =
  readReversedClientId(path.join(__dirname, "config", "GoogleService-Info.plist")) ??
  GOOGLE_URL_SCHEME_PLACEHOLDER;

const plugins = expo.plugins.map((plugin) =>
  Array.isArray(plugin) && plugin[0] === GOOGLE_SIGN_IN_PLUGIN
    ? [GOOGLE_SIGN_IN_PLUGIN, { ...plugin[1], iosUrlScheme }]
    : plugin,
);

// Optional: set APPLE_TEAM_ID locally to sign builds for a physical device.
const ios = process.env.APPLE_TEAM_ID
  ? { ...expo.ios, appleTeamId: process.env.APPLE_TEAM_ID }
  : expo.ios;

module.exports = { ...expo, ios, plugins };
