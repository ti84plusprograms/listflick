import * as SecureStore from "expo-secure-store";

export const AI_PROVIDERS = ["gemini", "groq", "claude"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export function isAIProvider(value: unknown): value is AIProvider {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

// SecureStore key names may contain only alphanumeric characters, ".", "-", and "_".
const KEY_PREFIX = "listflick_ai_key_";

function encodeUid(uid: string): string {
  return Array.from(uid)
    .map((character) => (character.codePointAt(0) ?? 0).toString(16).padStart(6, "0"))
    .join("");
}

function storageKey(uid: string, provider: AIProvider): string {
  return `${KEY_PREFIX}${encodeUid(uid)}_${provider}`;
}

export async function getProviderApiKey(uid: string, provider: AIProvider): Promise<string | null> {
  return SecureStore.getItemAsync(storageKey(uid, provider));
}

export async function hasProviderApiKey(uid: string, provider: AIProvider): Promise<boolean> {
  return Boolean((await getProviderApiKey(uid, provider))?.trim());
}

export async function setProviderApiKey(uid: string, provider: AIProvider, value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("API key cannot be blank");
  await SecureStore.setItemAsync(storageKey(uid, provider), trimmed);
}

export async function deleteProviderApiKey(uid: string, provider: AIProvider): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(uid, provider));
}

export async function clearProviderApiKeys(uid: string): Promise<void> {
  await Promise.all(AI_PROVIDERS.map((provider) => deleteProviderApiKey(uid, provider)));
}
