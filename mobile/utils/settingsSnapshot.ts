import type { UserProfile } from "../types/listing";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "./preferences";
import { EMPTY_PROFILE } from "./userProfile";

/**
 * The last values the Settings screen loaded or saved. Switching Appearance remounts
 * every screen; Settings starts from this instead of defaults so its switches don't
 * flip while the saved values reload.
 */
export interface SettingsSnapshot {
  profile: UserProfile;
  /** Account the cached profile belongs to; profiles are per account. */
  profileOwner: string | null;
  defaultPickup: boolean;
  retentionDays: number;
  notificationPrefs: NotificationPreferences;
}

let snapshot: SettingsSnapshot = {
  profile: EMPTY_PROFILE,
  profileOwner: null,
  defaultPickup: false,
  retentionDays: 30,
  notificationPrefs: DEFAULT_NOTIFICATION_PREFERENCES,
};

export function getSettingsSnapshot(): SettingsSnapshot {
  return snapshot;
}

/** The cached profile, only if it belongs to this account. */
export function snapshotProfileFor(uid: string | null | undefined): UserProfile {
  return uid && snapshot.profileOwner === uid ? snapshot.profile : EMPTY_PROFILE;
}

export function updateSettingsSnapshot(values: Partial<SettingsSnapshot>): void {
  snapshot = { ...snapshot, ...values };
}
