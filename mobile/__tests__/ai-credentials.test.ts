import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isServerAIKeyFallbackAvailable } from "../utils/aiProviderAvailability";

const credentials = readFileSync(resolve(__dirname, "../services/aiCredentials.ts"), "utf8");
const api = readFileSync(resolve(__dirname, "../services/api.ts"), "utf8");
const storage = readFileSync(resolve(__dirname, "../services/storage.ts"), "utf8");
const camera = readFileSync(resolve(__dirname, "../app/camera.tsx"), "utf8");

for (const expected of [
  'import * as SecureStore from "expo-secure-store"',
  'listflick_ai_key_',
  '`${KEY_PREFIX}${encodeUid(uid)}_${provider}`',
  'padStart(6, "0")',
  "await SecureStore.setItemAsync",
  "await SecureStore.deleteItemAsync",
  "value.trim()",
] as const) {
  if (!credentials.includes(expected)) throw new Error(`Secure credential storage is missing ${expected}`);
}

if (credentials.includes("AsyncStorage") || credentials.includes("console.log") || credentials.includes("console.warn")) {
  throw new Error("Provider credentials must not use AsyncStorage or logging");
}
for (const expected of [
  'headers["X-ListFlick-AI-Key"] = key',
  "const headers = await aiRequestHeaders();",
  'await clearProviderApiKeys(userId)',
] as const) {
  if (!api.includes(expected) && !storage.includes(expected)) throw new Error(`BYOK transport/cleanup is missing ${expected}`);
}
if (!api.includes('"X-ListFlick-AI-Provider": provider')) {
  throw new Error("AI requests must identify the selected provider");
}
if (!storage.includes("export async function getEffectiveAIProvider")) {
  throw new Error("Storage is missing export async function getEffectiveAIProvider");
}
for (const expected of [
  "getEffectiveAIProvider",
  "const provider = await getEffectiveAIProvider",
] as const) {
  if (!api.includes(expected) || !camera.includes(expected)) {
    throw new Error(`Effective AI provider resolution is missing ${expected}`);
  }
}
for (const expected of [
  "isServerAIKeyFallbackAvailable(health, provider)",
  "AsyncStorage.getItem(scopedKey(AI_PROVIDER_PREFERENCE_KEY))",
  "AsyncStorage.setItem(scopedKey(AI_PROVIDER_PREFERENCE_KEY), provider)",
  "hasProviderApiKey(currentUser.uid, provider",
  "if (!(await ensureAIProviderReady())) return",
  "showAIKeyRequiredPrompt(provider",
  'if (!provider) {',
  '"AI_PROVIDER_SELECTION_REQUIRED"',
  "showAIProviderRequiredPrompt()",
  "savedProvider=${savedProvider",
  "backendProvider=${backendProvider}",
  "providerServerKeyConfigured=${providerServerKeyConfigured}",
  "healthAvailable=${health !== null}",
] as const) {
  if (!api.includes(expected) && !storage.includes(expected) && !camera.includes(expected)) {
    throw new Error(`Fallback, scoping, or camera preflight wiring is missing ${expected}`);
  }
}

for (const expected of [
  'const LEGACY_LISTINGS_MIGRATION_OWNER_KEY = "@listings_legacy_migration_owner"',
  'if (scope === "signed-out") return []',
  "migrationOwner && migrationOwner !== scope",
  "AsyncStorage.setItem(LEGACY_LISTINGS_MIGRATION_OWNER_KEY, scope)",
  "AsyncStorage.removeItem(STORAGE_KEY)",
] as const) {
  if (!storage.includes(expected)) throw new Error(`One-time legacy listing migration is missing ${expected}`);
}

for (const expected of [
  "aiProviderFromErrorDetail(detail)",
  'provider === "gemini" || provider === "groq"',
] as const) {
  if (!api.includes(expected)) throw new Error(`Provider error metadata parsing is missing ${expected}`);
}

for (const expected of [
  '"AI_PROVIDER_SELECTION_REQUIRED"',
  '"AI_CREDENTIAL_REQUIRED"',
  "provider,",
] as const) {
  if (!api.includes(expected)) throw new Error(`Local AI errors are missing metadata: ${expected}`);
}

if (isServerAIKeyFallbackAvailable({ status: "ok", allow_server_ai_key_fallback: true, gemini_configured: true, groq_configured: false }, "groq")) {
  throw new Error("Groq must not use a Gemini-only server fallback");
}
if (!isServerAIKeyFallbackAvailable({ status: "ok", allow_server_ai_key_fallback: true, gemini_configured: true, groq_configured: false }, "gemini")) {
  throw new Error("Gemini should use its configured server fallback");
}
if (isServerAIKeyFallbackAvailable({ status: "ok", allow_server_ai_key_fallback: false, groq_configured: true }, "groq")) {
  throw new Error("A configured key must not bypass the disabled fallback flag");
}
if (api.includes("getProviderApiKey(currentUser.uid, provider)") && api.includes("getItem(itemId)")) {
  // The credential helper is only called from provider-execution functions;
  // status polling must remain a normal request.
  const statusSection = api.slice(api.indexOf("export async function getAnalysisJobStatus"), api.indexOf("export async function getHealth"));
  if (statusSection.includes("aiRequestHeaders")) throw new Error("Status polling must not attach an AI key");
}

console.log("AI credential storage and transport wiring tests passed.");
