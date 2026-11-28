import type { AIProvider } from "../services/aiCredentials";
import type { HealthResponse } from "../types/api";

export function providerServerKeyConfigured(health: HealthResponse | null, provider: AIProvider): boolean {
  if (!health) return false;
  if (provider === "gemini") return Boolean(health.gemini_configured);
  if (provider === "groq") return Boolean(health.groq_configured);
  return Boolean(health.claude_configured);
}

export function isServerAIKeyFallbackAvailable(
  health: HealthResponse | null,
  provider: AIProvider,
): boolean {
  if (!health?.allow_server_ai_key_fallback) return false;
  return providerServerKeyConfigured(health, provider);
}
