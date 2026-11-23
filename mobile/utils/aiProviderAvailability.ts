import type { AIProvider } from "../services/aiCredentials";
import type { HealthResponse } from "../types/api";

export function isServerAIKeyFallbackAvailable(
  health: HealthResponse | null,
  provider: AIProvider,
): boolean {
  if (!health?.allow_server_ai_key_fallback) return false;
  return provider === "gemini"
    ? Boolean(health.gemini_configured)
    : Boolean(health.groq_configured);
}
