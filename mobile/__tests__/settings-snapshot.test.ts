import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSettingsSnapshot, snapshotProfileFor, updateSettingsSnapshot } from "../utils/settingsSnapshot";
import { EMPTY_PROFILE } from "../utils/userProfile";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../utils/preferences";

// Before anything loads, Settings shows the defaults.
const initial = getSettingsSnapshot();
equal(initial.defaultPickup, false, "pickup default");
equal(initial.retentionDays, 30, "retention default");
deepEqual(initial.notificationPrefs, DEFAULT_NOTIFICATION_PREFERENCES, "notification defaults");

// Switching Appearance remounts Settings. A remounted screen must start from the
// last loaded values, not the defaults, or the switches visibly flip.
updateSettingsSnapshot({ defaultPickup: true, retentionDays: 7 });
equal(getSettingsSnapshot().defaultPickup, true, "pickup survives a remount");
equal(getSettingsSnapshot().retentionDays, 7, "retention survives a remount");
updateSettingsSnapshot({ notificationPrefs: { enabled: true, listingReady: false, needsAttention: true } });
equal(getSettingsSnapshot().defaultPickup, true, "partial updates keep other values");
equal(getSettingsSnapshot().notificationPrefs.listingReady, false, "notification prefs kept");

// Profiles are per account: another account never sees the cached one.
updateSettingsSnapshot({ profile: { ...EMPTY_PROFILE, name: "Ary" }, profileOwner: "user-a" });
equal(snapshotProfileFor("user-a").name, "Ary", "same account keeps its profile");
deepEqual(snapshotProfileFor("user-b"), EMPTY_PROFILE, "other account starts empty");
deepEqual(snapshotProfileFor(null), EMPTY_PROFILE, "signed out starts empty");

const settings = readFileSync(resolve(__dirname, "../app/(tabs)/settings.tsx"), "utf8");
for (const expected of [
  "useState(() => getSettingsSnapshot().defaultPickup)",
  "useState(() => getSettingsSnapshot().retentionDays)",
  "useState<NotificationPreferences>(() => getSettingsSnapshot().notificationPrefs)",
  "useState<UserProfile>(() => snapshotProfileFor(user?.uid))",
]) {
  ok(settings.includes(expected), `Settings should start from the snapshot: ${expected}`);
}
ok(!settings.includes("useState(false);\n  const [retentionDays"), "pickup no longer starts as false");

console.log("settings snapshot tests passed");
