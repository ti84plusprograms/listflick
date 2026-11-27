"""Resolve request-scoped AI credentials without persisting or logging secrets."""

from dataclasses import dataclass

from app.config import SUPPORTED_AI_PROVIDERS, settings

AI_CREDENTIAL_HEADER = "X-ListFlick-AI-Key"
AI_PROVIDER_HEADER = "X-ListFlick-AI-Provider"


class AICredentialError(Exception):
    code = "AI_CREDENTIAL_REQUIRED"


class AICredentialRequiredError(AICredentialError):
    pass


class AIProviderCredentialInvalidError(AICredentialError):
    code = "AI_PROVIDER_CREDENTIAL_INVALID"


@dataclass(frozen=True)
class ResolvedAICredential:
    provider: str
    value: str
    source: str


def selected_provider(request_provider: str | None = None) -> str:
    requested = request_provider.strip() if isinstance(request_provider, str) else ""
    provider = (requested or settings.ai_provider).strip().lower()
    if provider not in SUPPORTED_AI_PROVIDERS:
        raise ValueError(f"Unsupported AI_PROVIDER: {settings.ai_provider}")
    return provider


def resolve_ai_credential(provider: str, request_key: str | None = None) -> ResolvedAICredential:
    provider = provider.strip().lower()
    if provider not in SUPPORTED_AI_PROVIDERS:
        raise ValueError(f"Unsupported AI provider: {provider}")

    request_value = request_key.strip() if isinstance(request_key, str) else ""
    if request_value:
        return ResolvedAICredential(provider=provider, value=request_value, source="byok")

    server_value = {
        "gemini": settings.gemini_api_key,
        "groq": settings.groq_api_key,
        "claude": settings.anthropic_api_key,
    }[provider]
    if settings.allow_server_ai_key_fallback and server_value:
        return ResolvedAICredential(provider=provider, value=server_value, source="server_fallback")

    raise AICredentialRequiredError
