import { router } from "expo-router";
import { Alert } from "react-native";

import type { AIProvider } from "../services/aiCredentials";
import { providerDisplayName } from "./aiSettingsState";

export function openProviderKeySettings(provider: AIProvider): void {
  router.push({
    pathname: "/(tabs)/settings",
    params: { manageProvider: provider },
  });
}

export function openAIProviderSettings(): void {
  router.push({
    pathname: "/(tabs)/settings",
    params: { chooseProvider: "true" },
  });
}

export function showAIProviderRequiredPrompt(): void {
  Alert.alert(
    "API key required",
    "Choose an AI provider and add its API key in Settings before generating a listing.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: openAIProviderSettings },
    ],
  );
}

export function showAIKeyRequiredPrompt(provider: AIProvider, purpose: string): void {
  const label = providerDisplayName(provider);
  Alert.alert(
    `${label} API key required`,
    `${purpose}\n\nIt is stored securely on this device.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Add API Key", onPress: () => openProviderKeySettings(provider) },
    ],
  );
}

export function showAIProviderCredentialInvalidPrompt(provider: AIProvider): void {
  const label = providerDisplayName(provider);
  Alert.alert(
    `${label} API key rejected`,
    "The provider rejected this API key. Check the key in Settings and try again.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Replace API Key", onPress: () => openProviderKeySettings(provider) },
    ],
  );
}
