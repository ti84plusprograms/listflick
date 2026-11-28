import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { colorsFor, getActiveColorScheme, setActiveColorScheme, theme, themedStyles } from "../constants/theme";
import {
  CURRENCY_MESSAGE,
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOT_IMPLEMENTED_TITLE,
  analysisFailedNotification,
  analysisFinishedNotification,
  colorSchemeLabel,
  notificationsLabel,
  parseColorScheme,
  parseNotificationPreferences,
  shouldSendNotification,
} from "../utils/preferences";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");

// Appearance: Light is the default and Dark swaps the palette.
equal(parseColorScheme(null), "light", "default appearance is light");
equal(parseColorScheme("dark"), "dark", "dark is kept");
equal(parseColorScheme("purple"), "light", "unknown value falls back to light");
equal(colorSchemeLabel("dark"), "Dark", "dark label");
equal(colorSchemeLabel("light"), "Light", "light label");

const light = colorsFor("light");
const dark = colorsFor("dark");
deepEqual(Object.keys(dark).sort(), Object.keys(light).sort(), "dark palette defines every light color");
equal(light.background, "#FFFFFF", "light background unchanged");
equal(light.textPrimary, "#1A1A1A", "light text unchanged");
equal(dark.background, "#121212", "dark background is dark");
equal(dark.textPrimary, "#F2F2F2", "dark text is light");
equal(dark.accentText, "#121212", "accent text flips to dark on the light accent");

equal(getActiveColorScheme(), "light", "app starts light");
const styles = themedStyles(() => ({ box: { backgroundColor: theme.colors.background } }));
equal(styles.box.backgroundColor, "#FFFFFF", "themed styles use the light palette");
setActiveColorScheme("dark");
equal(theme.colors.background, "#121212", "theme.colors follows the active scheme");
equal(styles.box.backgroundColor, "#121212", "themed styles rebuild for dark");
setActiveColorScheme("light");
equal(styles.box.backgroundColor, "#FFFFFF", "and back to light");

// The logo mark is black on transparent: original in light mode, light text color in dark mode.
const mark = read("../components/brand/ListFlickMark.tsx");
ok(mark.includes("getActiveColorScheme() === 'dark' ? theme.colors.textPrimary : undefined"), "logo has a dark counterpart");
ok(mark.includes("tintColor ? { tintColor } : null"), "light mode keeps the original logo");

// Notifications: off until the user turns them on; both kinds default on.
deepEqual(parseNotificationPreferences(null), DEFAULT_NOTIFICATION_PREFERENCES, "defaults");
equal(DEFAULT_NOTIFICATION_PREFERENCES.enabled, false, "off by default");
deepEqual(
  parseNotificationPreferences('{"enabled":true,"listingReady":false}'),
  { enabled: true, listingReady: false, needsAttention: true },
  "saved preferences parse",
);
deepEqual(parseNotificationPreferences("{broken"), DEFAULT_NOTIFICATION_PREFERENCES, "bad JSON falls back");
equal(notificationsLabel({ ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: true }), "On", "row label on");
equal(notificationsLabel(DEFAULT_NOTIFICATION_PREFERENCES), "Off", "row label off");

const on = { enabled: true, listingReady: true, needsAttention: false };
equal(shouldSendNotification(on, "listingReady", "background"), true, "sends in background");
equal(shouldSendNotification(on, "listingReady", "inactive"), true, "sends when inactive");
equal(shouldSendNotification(on, "listingReady", "active"), false, "not while the app is open");
equal(shouldSendNotification(on, "needsAttention", "background"), false, "respects per-kind switch");
equal(shouldSendNotification({ ...on, enabled: false }, "listingReady", "background"), false, "master switch wins");

const ready = analysisFinishedNotification({ title: "Adidas backpack", missingCount: 0 });
equal(ready.kind, "listingReady", "complete listing is ready");
equal(ready.content.body, "Adidas backpack is written. Open ListFlick to review and save it.", "ready body");
const missing = analysisFinishedNotification({ title: "", missingCount: 2 });
equal(missing.kind, "needsAttention", "missing details need attention");
equal(missing.content.body, "Your listing is written but missing 2 details. Open ListFlick to finish it.", "attention body");
equal(analysisFinishedNotification({ title: "Helmet", missingCount: 1 }).content.body.includes("missing 1 detail."), true, "singular");
equal(analysisFailedNotification("Analysis could not be completed.").kind, "needsAttention", "failure needs attention");

// Currency and unbuilt features say so instead of doing nothing.
equal(CURRENCY_MESSAGE.includes("USD only"), true, "currency message");
equal(NOT_IMPLEMENTED_TITLE, "Feature yet to be implemented", "not implemented title");

// Wiring.
const settings = read("../app/(tabs)/settings.tsx");
for (const expected of [
  'label="Notifications"',
  "onPress={() => setNotificationsVisible(true)}",
  "Alert.alert(CURRENCY_TITLE, CURRENCY_MESSAGE)",
  "value={colorSchemeLabel(scheme)} onPress={chooseAppearance}",
  "requestNotificationPermission()",
  "Linking.openSettings()",
  'showNotImplemented("A separate Suggested Pricing setting")',
]) {
  ok(settings.includes(expected), `Settings is missing ${expected}`);
}
ok(!settings.includes("For now mirrors AI insights"), "Suggested Pricing no longer mirrors AI insights");
for (const row of settings.match(/<NavRow\b[\s\S]*?\/>/g) ?? []) {
  ok(row.includes("onPress"), `Settings row does nothing when tapped: ${row.replace(/\s+/g, " ")}`);
}

const processing = read("../app/processing.tsx");
ok(processing.includes("sendListingNotification(finished.kind, finished.content)"), "processing sends the finished alert");
equal((processing.match(/notifyAnalysisNeedsAttention\(/g) ?? []).length, 4, "helper plus three failure paths");

const layout = read("../app/_layout.tsx");
ok(layout.includes("<AppearanceProvider>"), "root waits for the saved appearance");
ok(layout.includes("key={scheme}"), "screens redraw when the scheme changes");
ok(layout.includes("<StatusBar style={statusBarStyle} />"), "status bar follows the scheme");

const appJson = JSON.parse(read("../app.json")) as { expo: { plugins: unknown[] } };
ok(appJson.expo.plugins.includes("expo-notifications"), "notifications plugin configured");
// Dark counterparts for what iOS draws before the app starts (follows the phone's setting).
type SplashOptions = { image: string; backgroundColor: string; dark?: { image: string; backgroundColor: string } };
const expoConfig = appJson.expo as unknown as { ios: { icon?: { light: string; dark: string } }; plugins: unknown[] };
deepEqual(
  expoConfig.ios.icon,
  { light: "./assets/images/icon.png", dark: "./assets/images/icon-dark.png" },
  "iOS app icon has a dark variant",
);
const splash = expoConfig.plugins.find((p) => Array.isArray(p) && p[0] === "expo-splash-screen") as [string, SplashOptions];
deepEqual(splash[1].dark, { image: "./assets/images/logo-mark-dark.png", backgroundColor: colorsFor("dark").background }, "dark splash");
equal(splash[1].backgroundColor, colorsFor("light").background, "light splash unchanged");
for (const image of ["../assets/images/icon-dark.png", "../assets/images/logo-mark-dark.png"]) {
  const bytes = readFileSync(resolve(__dirname, image));
  equal(bytes.subarray(1, 4).toString(), "PNG", `${image} is a PNG`);
  equal(bytes[25], 6, `${image} has a transparent background (RGBA)`);
}

// Mods run last-to-first, so the entitlement stripper must be listed before expo-notifications
// to run after it. Personal dev teams can't sign the push capability; local alerts don't need it.
ok(
  appJson.expo.plugins.indexOf("./plugins/withoutPushEntitlement.js") > -1 &&
    appJson.expo.plugins.indexOf("./plugins/withoutPushEntitlement.js") < appJson.expo.plugins.indexOf("expo-notifications"),
  "push entitlement is stripped after expo-notifications adds it",
);
ok(!processing.includes("getExpoPushTokenAsync") && !read("../services/notifications.ts").includes("PushToken"), "no remote push in use");

// Every style block must rebuild per scheme, or that screen stays light in dark mode.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}
for (const file of ["../app", "../components", "../hooks"].flatMap((dir) => sourceFiles(resolve(__dirname, dir)))) {
  const source = readFileSync(file, "utf8");
  if (!source.includes("theme.colors")) continue;
  const plain = source.match(/(?<!themedStyles\(\(\) => )StyleSheet\.create\(/g);
  ok(!plain, `${file} builds styles once; wrap them in themedStyles(() => ...)`);
}

console.log("settings preferences tests passed");
