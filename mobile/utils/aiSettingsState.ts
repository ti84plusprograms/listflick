import type { AIProvider } from "../services/aiCredentials";

export function providerDisplayName(provider: AIProvider): "Gemini" | "Groq" {
  return provider === "gemini" ? "Gemini" : "Groq";
}

export function aiSettingsPresentation(provider: AIProvider | null, configured: boolean) {
  if (!provider) {
    return {
      providerLabel: "Choose",
      credentialLabel: null,
      credentialStatus: null,
    } as const;
  }
  const providerLabel = providerDisplayName(provider);
  return {
    providerLabel,
    credentialLabel: `${providerLabel} API Key`,
    credentialStatus: configured ? "Saved on this device" : "Not saved",
  } as const;
}
