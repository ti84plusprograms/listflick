import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { aiSettingsPresentation } from "../utils/aiSettingsState";

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const unconfigured = aiSettingsPresentation(null, false);
equal(unconfigured.providerLabel, "Choose", "first-time provider label");
equal(unconfigured.credentialLabel, null, "first-time credential row");
equal(unconfigured.credentialStatus, null, "first-time credential status");

const groqMissing = aiSettingsPresentation("groq", false);
equal(groqMissing.providerLabel, "Groq", "Groq provider label");
equal(groqMissing.credentialLabel, "Groq API Key", "Groq credential row");
equal(groqMissing.credentialStatus, "Not saved", "missing credential status");
if (Object.values(groqMissing).some((value) => typeof value === "string" && value.includes("Gemini API Key"))) {
  throw new Error("Groq presentation must not include the inactive Gemini credential");
}

const geminiSaved = aiSettingsPresentation("gemini", true);
equal(geminiSaved.providerLabel, "Gemini", "Gemini provider label");
equal(geminiSaved.credentialLabel, "Gemini API Key", "Gemini credential row");
equal(geminiSaved.credentialStatus, "Saved on this device", "saved credential status");
if (Object.values(geminiSaved).some((value) => typeof value === "string" && value.includes("Groq API Key"))) {
  throw new Error("Gemini presentation must not include the inactive Groq credential");
}

const settings = readFileSync(resolve(__dirname, "../app/(tabs)/settings.tsx"), "utf8");
const camera = readFileSync(resolve(__dirname, "../app/camera.tsx"), "utf8");
const editListing = readFileSync(resolve(__dirname, "../hooks/useEditListingForm.ts"), "utf8");
const processing = readFileSync(resolve(__dirname, "../app/processing.tsx"), "utf8");
const prompt = readFileSync(resolve(__dirname, "../utils/aiCredentialPrompt.ts"), "utf8");

for (const expected of [
  '<Text style={styles.sectionLabel}>AI</Text>',
  'label="AI Provider"',
  "value={aiProviderValue}",
  "isLast={aiSettingsLoading || !selectedProvider}",
  "selectedProvider && aiPresentation.credentialLabel",
  "label={aiPresentation.credentialLabel}",
  "value={aiPresentation.credentialStatus}",
  "setProviderSelectorVisible(true)",
  "accessibilityState={{ selected }}",
  "await saveSelectedAIProvider(provider)",
  "const isFirstSelection = selectedProvider === null",
  "if (isFirstSelection && !providerKeys[provider])",
  'useState<AIProvider | null>(null)',
  "setSelectedProvider(savedProvider)",
  "secureTextEntry",
  "Saved on this device",
  "It will be checked by the provider the next time you use AI.",
  "setAISettingsLoading(true)",
  "setAISettingsLoadFailed(false)",
  "[AI] Settings load failed:",
  "screenActive=${active}",
  "No override saved. This deployment currently supplies",
  "Replace Key",
  "Remove Key",
  "confirmRemoveProviderKey(editingProvider)",
  "getProviderApiKey(user.uid, provider)",
  "showNotionDeveloperUi &&",
] as const) {
  if (!settings.includes(expected)) throw new Error(`Settings AI UX is missing ${expected}`);
}

for (const removed of ["providerSwitch", "Required for the selected provider", ">Optional<"] as const) {
  if (settings.includes(removed)) throw new Error(`Primary Settings UI still includes ${removed}`);
}
if (settings.includes("Configured on this device")) {
  throw new Error("A saved device key must not be presented as provider-validated");
}

for (const source of [camera, editListing, processing]) {
  if (!source.includes("showAIKeyRequiredPrompt")) {
    throw new Error("An AI execution surface is missing the actionable credential prompt");
  }
}
for (const expected of [
  "promptForAnalysisCredentialFailure(job.last_error_code)",
  'errorCode !== "AI_CREDENTIAL_REQUIRED"',
  'errorCode !== "AI_PROVIDER_CREDENTIAL_INVALID"',
  "showAIProviderCredentialInvalidPrompt(provider)",
  "setError(credentialMessage)",
] as const) {
  if (!processing.includes(expected)) {
    throw new Error(`Resumable credential recovery is missing ${expected}`);
  }
}
for (const expected of [
  'e.code === "AI_PROVIDER_CREDENTIAL_INVALID" && e.provider',
  "showAIProviderCredentialInvalidPrompt(e.provider)",
] as const) {
  if (!editListing.includes(expected)) {
    throw new Error(`Improve credential recovery is missing ${expected}`);
  }
}
if (!camera.includes("useFocusEffect") || !camera.includes("aiPreflightPassed.current = false")) {
  throw new Error("Camera preflight must refresh after provider or credential settings can change");
}
for (const expected of [
  'text: "Add API Key"',
  'pathname: "/(tabs)/settings"',
  "params: { manageProvider: provider }",
  'text: "Open Settings"',
  'params: { chooseProvider: "true" }',
  '"API key required"',
  '"Choose an AI provider and add its API key in Settings before generating a listing."',
] as const) {
  if (!prompt.includes(expected)) throw new Error(`Credential prompt is missing ${expected}`);
}

if (!settings.includes('params.chooseProvider !== "true"') || !settings.includes("setProviderSelectorVisible(true)")) {
  throw new Error("Neutral first-time prompt must open the provider selector");
}

if (settings.includes("value={draftProviderKey}") && !settings.includes("secureTextEntry")) {
  throw new Error("Provider credential input must remain masked");
}

console.log("AI Settings UX tests passed.");

const claudeSaved = aiSettingsPresentation("claude", true);
equal(claudeSaved.providerLabel, "Claude", "Claude provider label");
equal(claudeSaved.credentialLabel, "Claude API Key", "Claude credential row");
