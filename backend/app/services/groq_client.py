"""Groq API client with retries, base64 vision support, and structured JSON output handling."""

from __future__ import annotations

import base64
import logging
import time
from typing import Any, TypeVar

from groq import AsyncGroq
from pydantic import BaseModel

from app.config import settings
from app.utils.json_parser import parse_and_validate
from app.services.ai_credentials import AIProviderCredentialInvalidError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class GroqClientError(Exception):
    pass


class GroqNotConfiguredError(GroqClientError):
    pass


def _error_category(exc: Exception) -> str:
    message = str(exc).lower()
    if "json_validate_failed" in message:
        return "provider_json_validation_failed"
    if "received empty content response" in message:
        return "empty_content"
    if "invalid json from model" in message:
        return "invalid_json"
    if "schema validation failed" in message:
        return "schema_validation_failed"
    if "400" in message:
        return "provider_http_400"
    return type(exc).__name__.lower()


def _provider_request_id(value: Any) -> str | None:
    for attribute in ("request_id", "_request_id", "id"):
        candidate = getattr(value, attribute, None)
        if isinstance(candidate, (str, int)) and str(candidate).strip():
            return str(candidate)
    return None


def _log_attempt(
    *,
    status: str,
    model_name: str,
    reasoning_effort: str | None,
    attempt: int,
    response_format_used: bool,
    latency_ms: int,
    content_length: int | None,
    provider_request_id: str | None,
    error_category: str | None = None,
) -> None:
    fields = {
        "groq_status": status,
        "groq_model": model_name,
        "groq_reasoning_effort": reasoning_effort,
        "groq_attempt": attempt,
        "groq_response_format": response_format_used,
        "groq_latency_ms": latency_ms,
        "groq_content_length": content_length,
        "groq_provider_request_id": provider_request_id,
        "groq_error_category": error_category,
    }
    message = (
        "Groq JSON generation status=%s model=%s reasoning_effort=%s attempt=%d response_format=%s "
        "latency_ms=%d content_length=%s provider_request_id=%s error_category=%s"
    )
    arguments = (
        status,
        model_name,
        reasoning_effort or "unavailable",
        attempt,
        response_format_used,
        latency_ms,
        content_length if content_length is not None else "unavailable",
        provider_request_id or "unavailable",
        error_category or "none",
    )
    if status == "success":
        logger.info(message, *arguments, extra=fields)
    else:
        logger.warning(message, *arguments, extra=fields)


class GroqClient:
    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key
        self._client: AsyncGroq | None = None

    def _ensure_configured(self) -> None:
        api_key = self._api_key or settings.groq_api_key
        if not api_key:
            raise GroqNotConfiguredError("GROQ_API_KEY not configured")
        if not self._client:
            self._client = AsyncGroq(
                api_key=api_key,
                timeout=settings.groq_request_timeout,
            )

    async def generate_json(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
        image_bytes: bytes | None = None,
        mime_type: str = "image/jpeg",
        schema_model: type[T],
        max_output_tokens: int = 800,
        max_retries: int | None = None,
    ) -> T:
        self._ensure_configured()
        assert self._client is not None

        retries = max_retries if max_retries is not None else settings.groq_max_retries
        model_name = settings.groq_vision_model if image_bytes else settings.groq_text_model
        reasoning_effort = settings.groq_vision_reasoning_effort if image_bytes else None

        # Build messages standard format
        messages: list[dict[str, Any]] = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})

        user_content: list[dict[str, Any]] = [{"type": "text", "text": user_prompt}]
        if image_bytes:
            encoded_image = base64.b64encode(image_bytes).decode("utf-8")
            user_content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime_type};base64,{encoded_image}"},
                }
            )

        messages.append({"role": "user", "content": user_content})

        last_raw_text: str | None = None
        use_response_format = True

        for attempt in range(retries + 1):
            if attempt > 0 and last_raw_text is not None:
                # Add self-correction context to the messages list
                messages.append({"role": "assistant", "content": last_raw_text})
                messages.append(
                    {
                        "role": "user",
                        "content": "Your previous response was not valid JSON. Please generate ONLY valid JSON matching the schema.",
                    }
                )

            response_format_used = use_response_format
            kwargs: dict[str, Any] = {
                "model": model_name,
                "messages": messages,
                "temperature": 0.2,
                "max_tokens": max_output_tokens,
            }
            if response_format_used:
                kwargs["response_format"] = {"type": "json_object"}
            if reasoning_effort is not None:
                kwargs["reasoning_effort"] = reasoning_effort

            started_at = time.perf_counter()
            content_length: int | None = None
            provider_request_id: str | None = None
            try:
                response = await self._client.chat.completions.create(**kwargs)
                provider_request_id = _provider_request_id(response)
                last_raw_text = response.choices[0].message.content
                content_length = len(last_raw_text) if last_raw_text is not None else None
                if not last_raw_text or not last_raw_text.strip():
                    raise ValueError("Received empty content response from Groq API")

                result = parse_and_validate(last_raw_text.strip(), schema_model)
                _log_attempt(
                    status="success",
                    model_name=model_name,
                    reasoning_effort=reasoning_effort,
                    attempt=attempt + 1,
                    response_format_used=response_format_used,
                    latency_ms=round((time.perf_counter() - started_at) * 1000),
                    content_length=content_length,
                    provider_request_id=provider_request_id,
                )
                return result

            except Exception as exc:
                if getattr(exc, "status_code", None) in {401, 403}:
                    raise AIProviderCredentialInvalidError from exc
                provider_request_id = provider_request_id or _provider_request_id(exc)
                error_category = _error_category(exc)
                _log_attempt(
                    status="failure",
                    model_name=model_name,
                    reasoning_effort=reasoning_effort,
                    attempt=attempt + 1,
                    response_format_used=response_format_used,
                    latency_ms=round((time.perf_counter() - started_at) * 1000),
                    content_length=content_length,
                    provider_request_id=provider_request_id,
                    error_category=error_category,
                )
                # If Groq server-side JSON validation failed, disable response_format for retries
                if error_category in {"provider_json_validation_failed", "provider_http_400"}:
                    use_response_format = False

                if attempt >= retries:
                    raise GroqClientError(f"Groq API error after retries ({error_category})") from exc


groq_client = GroqClient()
