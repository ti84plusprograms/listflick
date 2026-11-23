"""Google Gemini API client with retries, timeouts, and structured JSON handling."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, TypeVar

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel

from app.config import settings
from app.utils.json_parser import parse_and_validate
from app.services.ai_credentials import AIProviderCredentialInvalidError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

class GeminiClientError(Exception):
    pass


class GeminiNotConfiguredError(GeminiClientError):
    pass


class GeminiResponseError(GeminiClientError):
    pass


class GeminiClient:
    def __init__(self, api_key: str | None = None) -> None:
        self._client: genai.Client | None = None
        self._api_key = api_key

    def _ensure_client(self) -> genai.Client:
        api_key = self._api_key or settings.gemini_api_key
        if not api_key:
            raise GeminiNotConfiguredError("GEMINI_API_KEY not configured")
        if self._client is None:
            self._client = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(timeout=settings.gemini_request_timeout * 1000),
            )
        return self._client

    def _model_candidates(self) -> list[str]:
        candidates = [settings.gemini_model, *settings.fallback_model_list]
        return list(dict.fromkeys(candidate for candidate in candidates if candidate))

    def _generate_sync(
        self,
        *,
        system_instruction: str,
        contents: list[Any],
        max_output_tokens: int = 800,
    ) -> str:
        client = self._ensure_client()
        last_error: Exception | None = None
        model_candidates = self._model_candidates()

        for index, model_name in enumerate(model_candidates):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.2,
                        max_output_tokens=max_output_tokens,
                        response_mime_type="application/json",
                    ),
                )
            except Exception as exc:
                last_error = exc
                if self._is_model_not_found(exc) and index < len(model_candidates) - 1:
                    logger.warning("Model %s unavailable, trying next fallback", model_name)
                    continue
                raise

            if not response.candidates:
                raise GeminiResponseError("No response candidates from Gemini")

            text = response.text
            if not text or not text.strip():
                raise GeminiResponseError("Empty response from Gemini")
            return text.strip()

        if last_error:
            raise last_error
        raise GeminiResponseError("No Gemini models configured")

    @staticmethod
    def _is_model_not_found(exc: Exception) -> bool:
        msg = str(exc).lower()
        return "not found" in msg or "404" in msg or "invalid model" in msg

    @staticmethod
    def _is_retryable_api_error(exc: genai_errors.APIError) -> bool:
        return exc.code in {408, 429} or exc.code >= 500

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
        retries = max_retries if max_retries is not None else settings.gemini_max_retries
        last_error: Exception | None = None

        for attempt in range(retries + 1):
            prompt = user_prompt
            if attempt > 0:
                prompt = (
                    f"{user_prompt}\n\n"
                    "Your previous response was invalid or incomplete. "
                    "Return ONLY valid JSON matching the required schema. "
                    "No markdown. No explanations."
                )
                if last_error:
                    prompt += f"\nError: {last_error}"

            contents: list[Any] = [prompt]
            if image_bytes:
                contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))

            try:
                raw = await asyncio.wait_for(
                    asyncio.to_thread(
                        self._generate_sync,
                        system_instruction=system_instruction,
                        contents=contents,
                        max_output_tokens=max_output_tokens,
                    ),
                    timeout=settings.gemini_request_timeout + 5,
                )
                return parse_and_validate(raw, schema_model)
            except genai_errors.APIError as exc:
                if exc.code in {401, 403}:
                    raise AIProviderCredentialInvalidError from exc
                if not self._is_retryable_api_error(exc):
                    raise
                last_error = exc
                logger.warning("Gemini retryable error (attempt %s): %s", attempt + 1, exc)
                if attempt >= retries:
                    raise GeminiClientError(f"Gemini API error after retries: {exc}") from exc
                await asyncio.sleep(min(2**attempt, 8))
            except (ValueError, GeminiResponseError) as exc:
                last_error = exc
                logger.warning("Gemini parse/response error (attempt %s): %s", attempt + 1, exc)
                if attempt >= retries:
                    raise GeminiClientError(f"Failed to parse Gemini JSON: {exc}") from exc
                await asyncio.sleep(0.5)
            except asyncio.TimeoutError as exc:
                last_error = exc
                logger.warning("Gemini timeout (attempt %s)", attempt + 1)
                if attempt >= retries:
                    raise GeminiClientError("Gemini request timed out") from exc
                await asyncio.sleep(1)

        raise GeminiClientError("Unexpected Gemini client failure")


gemini_client = GeminiClient()
