import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isUserProfileComplete,
  userProfileDefaultsFromAuth,
  withUserProfileDefaults,
} from "../utils/userProfile";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function includes(value: string, expected: string, message: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${message}: missing ${JSON.stringify(expected)}`);
  }
}

function excludes(value: string, unexpected: string, message: string): void {
  if (value.includes(unexpected)) {
    throw new Error(`${message}: found ${JSON.stringify(unexpected)}`);
  }
}

const authDefaults = userProfileDefaultsFromAuth({
  displayName: "  Ary Seller  ",
  email: "  ary@example.com  ",
});

const emptySeededProfile = withUserProfileDefaults(null, authDefaults);
equal(emptySeededProfile.name, "Ary Seller", "auth display name seeds an empty profile");
equal(emptySeededProfile.username, "ary@example.com", "auth email seeds an empty profile");

const savedSellerProfile = withUserProfileDefaults(
  {
    name: "Marketplace Pro",
    username: "old-local@example.com",
    pickupLocation: "Downtown",
    paymentMethods: "Cash, Venmo",
  },
  authDefaults
);
equal(savedSellerProfile.name, "Marketplace Pro", "saved display name overrides auth display name");
equal(savedSellerProfile.username, "ary@example.com", "auth email remains account identity");
equal(savedSellerProfile.pickupLocation, "Downtown", "saved pickup location is preserved");
equal(savedSellerProfile.paymentMethods, "Cash, Venmo", "saved payment methods are preserved");
equal(isUserProfileComplete(savedSellerProfile), true, "complete seller details are detected");

const incompleteProfile = withUserProfileDefaults(
  {
    pickupLocation: "Downtown",
  },
  { username: "ary@example.com" }
);
equal(isUserProfileComplete(incompleteProfile), false, "missing seller fields keep profile incomplete");

const fallbackProfile = withUserProfileDefaults({ username: "legacy@example.com" });
equal(fallbackProfile.username, "legacy@example.com", "legacy username remains when no auth email exists");

const settingsSource = readFileSync(resolve(__dirname, "../app/(tabs)/settings.tsx"), "utf8");
includes(settingsSource, "getUserProfile(user?.uid, authProfileDefaults)", "settings reads the user-scoped profile");
includes(settingsSource, "setDraftProfile(effectiveProfile)", "settings opens the edit modal with auth-seeded profile details");
includes(settingsSource, "saveUserProfile(profileToSave, user?.uid)", "settings saves the user-scoped profile");
includes(settingsSource, "Managed by your sign-in provider", "settings renders auth email as provider-managed");

const authContextSource = readFileSync(resolve(__dirname, "../state/AuthContext.tsx"), "utf8");
includes(authContextSource, "setLoading(false)", "auth context clears initial loading from Firebase callback");
excludes(authContextSource, "[loading]", "auth context does not resubscribe when loading changes");

const rootLayoutSource = readFileSync(resolve(__dirname, "../app/_layout.tsx"), "utf8");
includes(rootLayoutSource, "isRedirecting", "root layout blocks stale protected-screen rendering during redirects");

console.log("User profile auth defaults tests passed.");
