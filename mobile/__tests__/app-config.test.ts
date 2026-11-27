import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

type GoogleUrlSchemeModule = {
  readReversedClientId(plistPath: string): string | null;
  GOOGLE_URL_SCHEME_PLACEHOLDER: string;
};
type PluginEntry = string | [string, Record<string, unknown>?];
type AppConfig = { plugins: PluginEntry[]; ios?: { appleTeamId?: string } };

const { readReversedClientId, GOOGLE_URL_SCHEME_PLACEHOLDER } = require(
  "../plugins/googleUrlScheme.js",
) as GoogleUrlSchemeModule;

const mobileRoot = resolve(__dirname, "..");
const fixture = (name: string) => resolve(__dirname, "fixtures", name);

assert.equal(
  GOOGLE_URL_SCHEME_PLACEHOLDER,
  "com.googleusercontent.apps.REPLACE_WITH_YOUR_REVERSED_CLIENT_ID",
);
assert.equal(
  readReversedClientId(fixture("GoogleService-Info.with-id.plist")),
  "com.googleusercontent.apps.000000000000-fixture",
);
assert.equal(readReversedClientId(fixture("GoogleService-Info.no-id.plist")), null);
assert.doesNotThrow(() => readReversedClientId("does/not/exist.plist"));
assert.equal(readReversedClientId("does/not/exist.plist"), null);

// Load app.config.js from a throwaway copy of the config files so the real
// (gitignored) mobile/config/GoogleService-Info.plist never influences the result.
// The copy lives inside mobile/ so `require` still resolves mobile/node_modules.
function loadAppConfig(plist: string | null, appleTeamId?: string): AppConfig {
  const dir = mkdtempSync(join(mobileRoot, ".app-config-test-"));
  const previousTeamId = process.env.APPLE_TEAM_ID;
  try {
    mkdirSync(join(dir, "plugins"));
    copyFileSync(join(mobileRoot, "app.config.js"), join(dir, "app.config.js"));
    copyFileSync(join(mobileRoot, "app.json"), join(dir, "app.json"));
    copyFileSync(join(mobileRoot, "plugins", "googleUrlScheme.js"), join(dir, "plugins", "googleUrlScheme.js"));
    if (plist) {
      mkdirSync(join(dir, "config"));
      copyFileSync(plist, join(dir, "config", "GoogleService-Info.plist"));
    }
    if (appleTeamId === undefined) delete process.env.APPLE_TEAM_ID;
    else process.env.APPLE_TEAM_ID = appleTeamId;
    return require(join(dir, "app.config.js")) as AppConfig;
  } finally {
    if (previousTeamId === undefined) delete process.env.APPLE_TEAM_ID;
    else process.env.APPLE_TEAM_ID = previousTeamId;
    rmSync(dir, { recursive: true, force: true });
  }
}

function googleSignInOptions(config: AppConfig): Record<string, unknown> | undefined {
  const entry = config.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "@react-native-google-signin/google-signin",
  );
  assert.ok(Array.isArray(entry), "app.config.js must keep the google-signin plugin entry");
  return entry[1];
}

const withoutPlist = loadAppConfig(null);
assert.equal(googleSignInOptions(withoutPlist)?.iosUrlScheme, GOOGLE_URL_SCHEME_PLACEHOLDER);
assert.equal(withoutPlist.ios?.appleTeamId, undefined);

const withPlist = loadAppConfig(fixture("GoogleService-Info.with-id.plist"));
assert.equal(googleSignInOptions(withPlist)?.iosUrlScheme, "com.googleusercontent.apps.000000000000-fixture");

const plistWithoutId = loadAppConfig(fixture("GoogleService-Info.no-id.plist"));
assert.equal(googleSignInOptions(plistWithoutId)?.iosUrlScheme, GOOGLE_URL_SCHEME_PLACEHOLDER);

const withTeam = loadAppConfig(null, "TEAMID1234");
assert.equal(withTeam.ios?.appleTeamId, "TEAMID1234");

// Every other plugin entry passes through from app.json unchanged.
const appJson = require("../app.json") as { expo: AppConfig };
assert.equal(withoutPlist.plugins.length, appJson.expo.plugins.length);

console.log("App config tests passed.");
