import * as Notifications from "expo-notifications";
import { AppState } from "react-native";
import {
  shouldSendNotification,
  type ListingNotificationContent,
  type ListingNotificationKind,
} from "../utils/preferences";
import { getNotificationPreferences } from "./storage";

let handlerConfigured = false;

/** Call once at startup. Listing alerts are only sent while ListFlick is in the background. */
export function configureNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export type NotificationPermission = "granted" | "denied" | "undetermined";

export async function getNotificationPermission(): Promise<NotificationPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
}

/** Asks iOS for permission when it hasn't been asked yet. Returns whether alerts are allowed. */
export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") return true;
  if (!current.canAskAgain) return false;
  const next = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return next.status === "granted";
}

/** Sends a listing alert if the user turned that kind on and the app is in the background. Never throws. */
export async function sendListingNotification(
  kind: ListingNotificationKind,
  content: ListingNotificationContent,
): Promise<void> {
  try {
    const prefs = await getNotificationPreferences();
    if (!shouldSendNotification(prefs, kind, AppState.currentState)) return;
    if ((await getNotificationPermission()) !== "granted") return;
    await Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body, sound: "default" },
      trigger: null,
    });
  } catch (error) {
    console.warn(`[Notifications] Could not send ${kind} alert: ${String(error)}`);
  }
}
