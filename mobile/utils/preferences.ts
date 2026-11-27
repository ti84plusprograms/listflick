import type { ColorScheme } from "../constants/theme";

export const NOT_IMPLEMENTED_TITLE = "Feature yet to be implemented";
export const CURRENCY_TITLE = "Currency";
export const CURRENCY_MESSAGE = "ListFlick currently supports USD only. Prices are suggested in US dollars.";

export function parseColorScheme(raw: string | null | undefined): ColorScheme {
  return raw === "dark" ? "dark" : "light";
}

export function colorSchemeLabel(scheme: ColorScheme): string {
  return scheme === "dark" ? "Dark" : "Light";
}

export interface NotificationPreferences {
  /** Master switch. Only true once the user turned it on and iOS allowed it. */
  enabled: boolean;
  listingReady: boolean;
  needsAttention: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: false,
  listingReady: true,
  needsAttention: true,
};

export function parseNotificationPreferences(raw: string | null | undefined): NotificationPreferences {
  if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  try {
    const value = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      enabled: value.enabled === true,
      listingReady: value.listingReady !== false,
      needsAttention: value.needsAttention !== false,
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export function notificationsLabel(prefs: NotificationPreferences): string {
  return prefs.enabled ? "On" : "Off";
}

export type ListingNotificationKind = "listingReady" | "needsAttention";

export interface ListingNotificationContent {
  title: string;
  body: string;
}

/** What to tell the user when an analysis they left running finishes. */
export function analysisFinishedNotification(input: {
  title?: string | null;
  missingCount: number;
}): { kind: ListingNotificationKind; content: ListingNotificationContent } {
  const name = input.title?.trim() || "Your listing";
  if (input.missingCount > 0) {
    const details = input.missingCount === 1 ? "1 detail" : `${input.missingCount} details`;
    return {
      kind: "needsAttention",
      content: { title: "Listing needs attention", body: `${name} is written but missing ${details}. Open ListFlick to finish it.` },
    };
  }
  return {
    kind: "listingReady",
    content: { title: "Listing ready", body: `${name} is written. Open ListFlick to review and save it.` },
  };
}

export function analysisFailedNotification(message: string): { kind: ListingNotificationKind; content: ListingNotificationContent } {
  return {
    kind: "needsAttention",
    content: { title: "Listing needs attention", body: message },
  };
}

export function shouldSendNotification(
  prefs: NotificationPreferences,
  kind: ListingNotificationKind,
  appState: string,
): boolean {
  if (!prefs.enabled || !prefs[kind]) return false;
  // In the foreground the user already sees the result on screen.
  return appState !== "active";
}
