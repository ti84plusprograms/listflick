import Constants from "expo-constants";

const envUrl = process.env.EXPO_PUBLIC_API_URL;
const extra = Constants.expoConfig?.extra as {
  apiUrl?: string;
  e2eApiUrl?: string;
  e2eResetAiSettings?: boolean;
} | undefined;
const developmentE2EUrl = __DEV__ ? extra?.e2eApiUrl : undefined;

export const IS_E2E = __DEV__ && Boolean(developmentE2EUrl);

export const E2E_RESET_AI_SETTINGS =
  IS_E2E && extra?.e2eResetAiSettings === true;

export const API_BASE_URL =
  developmentE2EUrl ??
  envUrl ??
  extra?.apiUrl ??
  "http://localhost:8000";

export const FACEBOOK_MARKETPLACE_URL = "https://www.facebook.com/marketplace/create/item";
