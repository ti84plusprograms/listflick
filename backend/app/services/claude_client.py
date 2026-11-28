"""Anthropic Claude client with retries, base64 vision support, and structured JSON output handling."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Any, TypeVar

from anthropic import AsyncAnthropic
from pydantic import BaseModel

from app.config import settings
from app.services.ai_credentials import AIProviderCredentialInvalidError
from app.services.image_payload import collect_images, image_label
from app.utils.json_parser import parse_and_validate

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

JSON_ONLY_REMINDER = (
    "Reply with only one JSON object that matches the schema described above. "
    "No markdown code fences and no text before or after the JSON."
)


# Sonnet 5.5 thinks by default and max_tokens covers thinking plus the answer. These calls
# only need a JSON object, so leave enough room for the answer even after some thinking.
MIN_MAX_TOKENS = 8192
# Requests that will fail the same way every time; retrying only burns the user's quota.
_NON_RETRYABLE_STATUS = {400, 404, 413, 422}


def _skips_upfront_thinking(model_name: str) -> bool:
    """Models that accept thinking={"type": "between_tools"} (adaptive thinking is their default)."""
    return model_name.startswith("claude-sonnet-5-5")


class ClaudeClientError(Exception):
    pass


class ClaudeNotConfiguredError(ClaudeClientError):
    pass


def _error_category(exc: Exception) -> str:
    message = str(exc).lower()
    if "received empty content response" in message:
        return "empty_content"
    if "invalid json from model" in message:
        return "invalid_json"
    if "schema validation failed" in message:
        return "schema_validation_failed"
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return f"provider_http_{status}"
    return type(exc).__name__.lower()


def _response_text(response: Any) -> str:
    """Join the text blocks of a Messages API response, ignoring thinking or tool blocks."""
    parts: list[str] = []
    for block in getattr(response, "content", None) or []:
        if getattr(block, "type", None) == "text":
            parts.append(getattr(block, "text", "") or "")
    return "".join(parts)


def _provider_request_id(value: Any) -> str | None:
    for attribute in ("_request_id", "request_id", "id"):
        candidate = getattr(value, attribute, None)
        if isinstance(candidate, (str, int)) and str(candidate).strip():
            return str(candidate)
    return None


def _log_attempt(
    *,
    status: str,
    model_name: str,
    attempt: int,
    latency_ms: int,
    content_length: int | None,
    provider_request_id: str | None,
    stop_reason: str | None,
    error_category: str | None = None,
) -> None:
    message = (
        "Claude JSON generation status=%s model=%s attempt=%d latency_ms=%d content_length=%s "
        "stop_reason=%s provider_request_id=%s error_category=%s"
    )
    arguments = (
        status,
        model_name,
        attempt,
        latency_ms,
        content_length if content_length is not None else "unavailable",
        stop_reason or "unavailable",
        provider_request_id or "unavailable",
        error_category or "none",
    )
    if status == "success":
        logger.info(message, *arguments)
    else:
        logger.warning(message, *arguments)


class ClaudeClient:
    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key
        self._client: AsyncAnthropic | None = None

    def _ensure_configured(self) -> None:
        api_key = self._api_key or settings.anthropic_api_key
        if not api_key:
            raise ClaudeNotConfiguredError("ANTHROPIC_API_KEY not configured")
        if not self._client:
            # Retries are handled below so that malformed JSON can be corrected in the same loop.
            self._client = AsyncAnthropic(
                api_key=api_key,
                timeout=settings.claude_request_timeout,
                max_retries=0,
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
        images: list[bytes] | None = None,
    ) -> T:
        self._ensure_configured()
        assert self._client is not None

        photos = collect_images(image_bytes, images)
        retries = max_retries if max_retries is not None else settings.claude_max_retries
        model_name = settings.claude_vision_model if photos else settings.claude_text_model

        user_content: list[dict[str, Any]] = []
        for index, photo in enumerate(photos):
            if len(photos) > 1:
                user_content.append({"type": "text", "text": image_label(index, len(photos))})
            user_content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": base64.b64encode(photo).decode("utf-8"),
                    },
                }
            )
        user_content.append({"type": "text", "text": f"{user_prompt}\n\n{JSON_ONLY_REMINDER}"})
        messages: list[dict[str, Any]] = [{"role": "user", "content": user_content}]

        last_raw_text: str | None = None

        for attempt in range(retries + 1):
            if attempt > 0 and last_raw_text:
                messages.append({"role": "assistant", "content": last_raw_text})
                messages.append(
                    {
                        "role": "user",
                        "content": "Your previous response was not valid JSON for the schema. "
                        + JSON_ONLY_REMINDER,
                    }
                )
                last_raw_text = None

            kwargs: dict[str, Any] = {
                "model": model_name,
                "max_tokens": max(max_output_tokens, MIN_MAX_TOKENS),
                "messages": messages,
            }
            # Sampling parameters (temperature, top_p, top_k) return a 400 on Sonnet 5.5, so none are sent.
            if _skips_upfront_thinking(model_name):
                kwargs["thinking"] = {"type": "between_tools"}
            if system_instruction:
                kwargs["system"] = system_instruction

            started_at = time.perf_counter()
            content_length: int | None = None
            provider_request_id: str | None = None
            stop_reason: str | None = None
            try:
                response = await self._client.messages.create(**kwargs)
                provider_request_id = _provider_request_id(response)
                stop_reason = getattr(response, "stop_reason", None)
                last_raw_text = _response_text(response)
                content_length = len(last_raw_text)
                if not last_raw_text.strip():
                    raise ValueError("Received empty content response from Claude API")

                result = parse_and_validate(last_raw_text.strip(), schema_model)
                _log_attempt(
                    status="success",
                    model_name=model_name,
                    attempt=attempt + 1,
                    latency_ms=round((time.perf_counter() - started_at) * 1000),
                    content_length=content_length,
                    provider_request_id=provider_request_id,
                    stop_reason=stop_reason,
                )
                return result

            except Exception as exc:
                status_code = getattr(exc, "status_code", None)
                if status_code in {401, 403}:
                    raise AIProviderCredentialInvalidError from exc
                error_category = _error_category(exc)
                _log_attempt(
                    status="failure",
                    model_name=model_name,
                    attempt=attempt + 1,
                    latency_ms=round((time.perf_counter() - started_at) * 1000),
                    content_length=content_length,
                    provider_request_id=provider_request_id or _provider_request_id(exc),
                    stop_reason=stop_reason,
                    error_category=error_category,
                )
                if status_code in _NON_RETRYABLE_STATUS:
                    raise ClaudeClientError(f"Claude API rejected the request ({error_category})") from exc
                if attempt >= retries:
                    raise ClaudeClientError(f"Claude API error after retries ({error_category})") from exc
                if status_code is not None or last_raw_text is None:
                    # Rate limits, overload and network errors: back off before trying again.
                    await asyncio.sleep(min(2**attempt, 8))


claude_client = ClaudeClient()
