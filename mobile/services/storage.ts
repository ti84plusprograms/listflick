import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paths } from "expo-file-system";
import { getApp } from "@react-native-firebase/app";
import { getAuth } from "@react-native-firebase/auth";

import type { AIInsightsSettings, DraftListingEdits, ListingDefaults, SavedListing, UserProfile } from "@/types/listing";
import { EMPTY_PROFILE, withUserProfileDefaults } from "../utils/userProfile";
import { scopedStorageKey } from "../utils/storageScope";
import {
  isPendingAnalysisExpired,
  parsePendingAnalysisOperation,
  parsePendingAnalysisOperations,
  removePendingAnalysisOperation,
  upsertPendingAnalysisOperation,
  rebasePendingAnalysisOperation,
  type PendingAnalysisOperation,
} from "../utils/pendingAnalysis";
import { deletePendingAnalysisImages } from "../utils/pendingAnalysisFiles";
import { clearProviderApiKeys } from "./aiCredentials";
import type { ColorScheme } from "../constants/theme";
import {
  parseColorScheme,
  parseNotificationPreferences,
  type NotificationPreferences,
} from "../utils/preferences";
import { isAIProvider, type AIProvider } from "./aiCredentials";

const STORAGE_KEY = "@listings";
const DRAFT_DESCRIPTION_PREFIX = "@draft_description:";
const DRAFT_LISTING_PREFIX = "@draft_listing:";
const PROFILE_KEY = "@user_profile";
const AI_INSIGHTS_SETTINGS_KEY = "@ai_insights_settings";
const LISTING_DEFAULTS_KEY = "@listing_defaults";
const RECENTLY_DELETED_KEY = "@recently_deleted_listings";
const RETENTION_DAYS_KEY = "@recently_deleted_retention_days";
const DEVELOPER_NOTION_MODE_KEY = "@developer_notion_sync_enabled";
/** Before multiple drafts: one unfinished listing at most. Read once and carried over. */
const LEGACY_PENDING_ANALYSIS_KEY = "@pending_analysis";
const PENDING_ANALYSIS_KEY = "@pending_analyses";
const AI_PROVIDER_PREFERENCE_KEY = "@ai_provider_preference";
const APPEARANCE_KEY = "@appearance";
const NOTIFICATION_PREFERENCES_KEY = "@notification_preferences";
const LEGACY_LISTINGS_MIGRATION_OWNER_KEY = "@listings_legacy_migration_owner";
export const DEFAULT_RETENTION_DAYS = 30 as const;
export const RETENTION_OPTIONS = [7, 30, 90] as const;
export const DEFAULT_DEVELOPER_NOTION_MODE = true as const;

function storageScope(): string {
  try {
    return getAuth(getApp()).currentUser?.uid ?? "signed-out";
  } catch {
    // Keep storage isolated even if Firebase has not finished initializing.
    return "signed-out";
  }
}

function scopedKey(key: string): string {
  return scopedStorageKey(key, storageScope());
}

export async function getSelectedAIProvider(): Promise<AIProvider | null> {
  const value = await AsyncStorage.getItem(scopedKey(AI_PROVIDER_PREFERENCE_KEY));
  return isAIProvider(value) ? value : null;
}

export async function getEffectiveAIProvider(health?: { allow_server_ai_key_fallback?: boolean; ai_provider?: string } | null): Promise<AIProvider | null> {
  const selected = await getSelectedAIProvider();
  if (selected) return selected;
  if (health?.allow_server_ai_key_fallback && isAIProvider(health.ai_provider)) {
    return health.ai_provider;
  }
  return null;
}

export async function saveSelectedAIProvider(provider: AIProvider): Promise<void> {
  await AsyncStorage.setItem(scopedKey(AI_PROVIDER_PREFERENCE_KEY), provider);
}

export const DEFAULT_AI_INSIGHTS_SETTINGS: AIInsightsSettings = {
  enabled: false,
};

export const DEFAULT_LISTING_DEFAULTS: ListingDefaults = {
  defaultLocalPickup: false,
};

export const EMPTY_USER_PROFILE: UserProfile = EMPTY_PROFILE;

function userProfileKey(userId?: string): string {
  return userId ? `${PROFILE_KEY}:${userId}` : PROFILE_KEY;
}

function parseUserProfile(raw: string | null): UserProfile | null {
  if (!raw) return null;

  try {
    return withUserProfileDefaults(JSON.parse(raw) as Partial<UserProfile>);
  } catch {
    return null;
  }
}

export async function getAllListings(): Promise<SavedListing[]> {
  const scope = storageScope();
  const currentKey = scopedStorageKey(STORAGE_KEY, scope);
  const raw = await AsyncStorage.getItem(currentKey);
  if (raw) {
    try {
      return JSON.parse(raw) as SavedListing[];
    } catch {
      return [];
    }
  }

  // Legacy listings predate account scoping and contain no reliable owner ID.
  // Never expose them while signed out, and permanently claim them for the
  // first authenticated account that migrates them so another account on the
  // same device cannot copy the same private listing data.
  if (scope === "signed-out") return [];

  const migrationOwner = await AsyncStorage.getItem(LEGACY_LISTINGS_MIGRATION_OWNER_KEY);
  if (migrationOwner && migrationOwner !== scope) return [];

  const legacyRaw = await AsyncStorage.getItem(STORAGE_KEY);
  if (legacyRaw) {
    try {
      const legacyListings = JSON.parse(legacyRaw) as SavedListing[];
      if (Array.isArray(legacyListings) && legacyListings.length > 0) {
        if (!migrationOwner) {
          await AsyncStorage.setItem(LEGACY_LISTINGS_MIGRATION_OWNER_KEY, scope);
        }
        await AsyncStorage.setItem(currentKey, legacyRaw);
        await AsyncStorage.removeItem(STORAGE_KEY);
        return legacyListings;
      }
    } catch {
      // Ignore parse failure
    }
  }
  return [];
}

export async function saveListing(listing: SavedListing): Promise<void> {
  const all = await getAllListings();
  const idx = all.findIndex((l) => l.id === listing.id);
  if (idx >= 0) {
    all[idx] = listing;
  } else {
    all.unshift(listing);
  }
  await AsyncStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(all));
}

export async function getListing(id: string): Promise<SavedListing | null> {
  const all = await getAllListings();
  return all.find((l) => l.id === id) ?? null;
}

export async function deleteListing(id: string): Promise<void> {
  const all = await getAllListings();
  await AsyncStorage.setItem(
    scopedKey(STORAGE_KEY),
    JSON.stringify(all.filter((l) => l.id !== id))
  );
}

export async function getRecentlyDeletedListings(): Promise<SavedListing[]> {
  const raw = await AsyncStorage.getItem(scopedKey(RECENTLY_DELETED_KEY));
  if (!raw) return [];
  return JSON.parse(raw) as SavedListing[];
}

export async function moveListingToRecentlyDeleted(listing: SavedListing, deletedAt: string, purgeAt: string): Promise<void> {
  const all = await getRecentlyDeletedListings();
  const trashed = { ...listing, deletedAt, purgeAt };
  const next = [trashed, ...all.filter((item) => item.id !== listing.id)];
  await AsyncStorage.setItem(scopedKey(RECENTLY_DELETED_KEY), JSON.stringify(next));
  await deleteListing(listing.id);
}

export async function restoreRecentlyDeletedListing(id: string): Promise<SavedListing | null> {
  const all = await getRecentlyDeletedListings();
  const listing = all.find((item) => item.id === id) ?? null;
  if (!listing) return null;
  await AsyncStorage.setItem(
    scopedKey(RECENTLY_DELETED_KEY),
    JSON.stringify(all.filter((item) => item.id !== id))
  );
  const { deletedAt: _deletedAt, purgeAt: _purgeAt, ...activeListing } = listing;
  await saveListing(activeListing);
  return activeListing;
}

export async function permanentlyDeleteRecentlyDeletedListing(id: string): Promise<void> {
  const all = await getRecentlyDeletedListings();
  await AsyncStorage.setItem(
    scopedKey(RECENTLY_DELETED_KEY),
    JSON.stringify(all.filter((item) => item.id !== id))
  );
}

export async function getRecentlyDeletedRetentionDays(): Promise<number> {
  const raw = await AsyncStorage.getItem(RETENTION_DAYS_KEY);
  const days = Number(raw);
  return RETENTION_OPTIONS.includes(days as (typeof RETENTION_OPTIONS)[number])
    ? days
    : DEFAULT_RETENTION_DAYS;
}

export async function saveRecentlyDeletedRetentionDays(days: number): Promise<void> {
  if (!RETENTION_OPTIONS.includes(days as (typeof RETENTION_OPTIONS)[number])) return;
  await AsyncStorage.setItem(RETENTION_DAYS_KEY, String(days));
}

/* Device preferences: shared by every account on this phone. */
export async function getAppearance(): Promise<ColorScheme> {
  return parseColorScheme(await AsyncStorage.getItem(APPEARANCE_KEY));
}

export async function saveAppearance(scheme: ColorScheme): Promise<void> {
  await AsyncStorage.setItem(APPEARANCE_KEY, scheme);
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return parseNotificationPreferences(await AsyncStorage.getItem(NOTIFICATION_PREFERENCES_KEY));
}

export async function saveNotificationPreferences(prefs: NotificationPreferences): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(prefs));
}

export async function getDeveloperNotionMode(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(DEVELOPER_NOTION_MODE_KEY);
  if (raw === null) return DEFAULT_DEVELOPER_NOTION_MODE;
  return raw === "true";
}

export async function saveDeveloperNotionMode(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(DEVELOPER_NOTION_MODE_KEY, String(enabled));
}

export async function getDraftDescription(id: string): Promise<string | null> {
  return AsyncStorage.getItem(scopedKey(`${DRAFT_DESCRIPTION_PREFIX}${id}`));
}

export async function saveDraftDescription(id: string, description: string): Promise<void> {
  await AsyncStorage.setItem(scopedKey(`${DRAFT_DESCRIPTION_PREFIX}${id}`), description);
}

export async function getDraftListingEdits(id: string): Promise<DraftListingEdits | null> {
  const raw = await AsyncStorage.getItem(scopedKey(`${DRAFT_LISTING_PREFIX}${id}`));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as DraftListingEdits;
  } catch {
    return null;
  }
}

export async function saveDraftListingEdits(id: string, edits: DraftListingEdits): Promise<void> {
  await AsyncStorage.setItem(scopedKey(`${DRAFT_LISTING_PREFIX}${id}`), JSON.stringify(edits));
}

export async function getUserProfile(
  userId?: string,
  authDefaults: Partial<UserProfile> = {}
): Promise<UserProfile> {
  const scopedKey = userProfileKey(userId);
  const scopedProfile = parseUserProfile(await AsyncStorage.getItem(scopedKey));
  if (scopedProfile) {
    return withUserProfileDefaults(scopedProfile, authDefaults);
  }

  if (userId) {
    const legacyProfile = parseUserProfile(await AsyncStorage.getItem(PROFILE_KEY));
    if (legacyProfile) {
      const migratedProfile = withUserProfileDefaults(legacyProfile, authDefaults);
      await AsyncStorage.setItem(scopedKey, JSON.stringify(migratedProfile));
      return migratedProfile;
    }
  }

  return withUserProfileDefaults(null, authDefaults);
}

export async function saveUserProfile(profile: UserProfile, userId?: string): Promise<void> {
  await AsyncStorage.setItem(userProfileKey(userId), JSON.stringify(withUserProfileDefaults(profile)));
}

export async function getAIInsightsSettings(): Promise<AIInsightsSettings> {
  const raw = await AsyncStorage.getItem(AI_INSIGHTS_SETTINGS_KEY);
  if (!raw) return DEFAULT_AI_INSIGHTS_SETTINGS;

  try {
    return {
      ...DEFAULT_AI_INSIGHTS_SETTINGS,
      ...(JSON.parse(raw) as Partial<AIInsightsSettings>),
    };
  } catch {
    return DEFAULT_AI_INSIGHTS_SETTINGS;
  }
}

export async function saveAIInsightsSettings(settings: AIInsightsSettings): Promise<void> {
  await AsyncStorage.setItem(AI_INSIGHTS_SETTINGS_KEY, JSON.stringify(settings));
}

export async function getListingDefaults(): Promise<ListingDefaults> {
  const raw = await AsyncStorage.getItem(LISTING_DEFAULTS_KEY);
  if (!raw) return DEFAULT_LISTING_DEFAULTS;

  try {
    return {
      ...DEFAULT_LISTING_DEFAULTS,
      ...(JSON.parse(raw) as Partial<ListingDefaults>),
    };
  } catch {
    return DEFAULT_LISTING_DEFAULTS;
  }
}

export async function saveListingDefaults(defaults: ListingDefaults): Promise<void> {
  await AsyncStorage.setItem(LISTING_DEFAULTS_KEY, JSON.stringify(defaults));
}

/** Every unfinished listing for this account, newest first, including one saved before multiple drafts. */
async function readPendingAnalysisOperations(): Promise<PendingAnalysisOperation[]> {
  const key = scopedKey(PENDING_ANALYSIS_KEY);
  let operations = parsePendingAnalysisOperations(await AsyncStorage.getItem(key));
  const legacyKey = scopedKey(LEGACY_PENDING_ANALYSIS_KEY);
  const legacy = parsePendingAnalysisOperation(await AsyncStorage.getItem(legacyKey));
  if (legacy) {
    operations = upsertPendingAnalysisOperation(operations, legacy);
    await AsyncStorage.setItem(key, JSON.stringify(operations));
  }
  if (legacy || (await AsyncStorage.getItem(legacyKey)) !== null) await AsyncStorage.removeItem(legacyKey);
  return operations;
}

async function writePendingAnalysisOperations(operations: PendingAnalysisOperation[]): Promise<void> {
  const key = scopedKey(PENDING_ANALYSIS_KEY);
  if (operations.length === 0) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, JSON.stringify(operations));
}

export async function getPendingAnalysisOperations(): Promise<PendingAnalysisOperation[]> {
  const operations = await readPendingAnalysisOperations();
  const live = operations.filter((operation) => !isPendingAnalysisExpired(operation));
  if (live.length !== operations.length) {
    for (const expired of operations.filter((operation) => isPendingAnalysisExpired(operation))) {
      await deletePendingAnalysisImages(expired.operationId);
    }
    await writePendingAnalysisOperations(live);
  }
  // Stored photo URIs may name an old app container after an update or reinstall.
  return live.map((operation) => rebasePendingAnalysisOperation(operation, Paths.document.uri));
}

/** One unfinished listing by id, or the newest when no id is given. */
export async function getPendingAnalysisOperation(operationId?: string): Promise<PendingAnalysisOperation | null> {
  const operations = await getPendingAnalysisOperations();
  if (!operationId) return operations[0] ?? null;
  return operations.find((operation) => operation.operationId === operationId) ?? null;
}

export async function savePendingAnalysisOperation(operation: PendingAnalysisOperation): Promise<void> {
  await writePendingAnalysisOperations(upsertPendingAnalysisOperation(await readPendingAnalysisOperations(), operation));
}

export async function clearPendingAnalysisOperation(operationId: string): Promise<void> {
  await writePendingAnalysisOperations(removePendingAnalysisOperation(await readPendingAnalysisOperations(), operationId));
  await deletePendingAnalysisImages(operationId);
}

export async function clearPendingAnalysisOperationForItem(itemId: string): Promise<void> {
  const match = (await readPendingAnalysisOperations()).find((operation) => operation.itemId === itemId);
  if (match) await clearPendingAnalysisOperation(match.operationId);
}

export async function clearLocalUserData(userId: string): Promise<void> {
  await clearProviderApiKeys(userId);
  const keys = await AsyncStorage.getAllKeys();
  const userSuffix = `:${userId}`;
  const pendingKey = scopedStorageKey(PENDING_ANALYSIS_KEY, userId);
  const legacyPendingKey = scopedStorageKey(LEGACY_PENDING_ANALYSIS_KEY, userId);
  const pendingOperations = parsePendingAnalysisOperations(await AsyncStorage.getItem(pendingKey));
  const legacyPendingOperation = parsePendingAnalysisOperation(await AsyncStorage.getItem(legacyPendingKey));
  if (legacyPendingOperation) pendingOperations.push(legacyPendingOperation);
  const directKeys = new Set([
    scopedStorageKey(STORAGE_KEY, userId),
    scopedStorageKey(RECENTLY_DELETED_KEY, userId),
    scopedStorageKey(AI_PROVIDER_PREFERENCE_KEY, userId),
    pendingKey,
    legacyPendingKey,
    userProfileKey(userId),
  ]);
  const draftKeys = keys.filter(
    (key) =>
      (key.startsWith(DRAFT_DESCRIPTION_PREFIX) || key.startsWith(DRAFT_LISTING_PREFIX)) &&
      key.endsWith(userSuffix)
  );
  const keysToRemove = keys.filter((key) => directKeys.has(key) || draftKeys.includes(key));
  for (const pendingOperation of pendingOperations) await deletePendingAnalysisImages(pendingOperation.operationId);
  if (keysToRemove.length > 0) {
    await AsyncStorage.multiRemove(keysToRemove);
  }
}
