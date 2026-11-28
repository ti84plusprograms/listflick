import Constants from "expo-constants";

const envUrl = process.env.EXPO_PUBLIC_API_URL;

export const API_BASE_URL =
  envUrl ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  "http://localhost:8000";

export const FACEBOOK_MARKETPLACE_URL = "https://www.facebook.com/marketplace/create/item";
