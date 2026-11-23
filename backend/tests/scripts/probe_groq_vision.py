"""Run privacy-safe Groq vision probes and emit redacted JSON Lines results."""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import logging
import mimetypes
import sys
import time
from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from groq import AsyncGroq  # noqa: E402

from app.config import settings  # noqa: E402
from app.prompts.vision import VISION_SYSTEM_PROMPT, VISION_USER_PROMPT  # noqa: E402
from app.schemas.listing import VisionAnalysis  # noqa: E402
from app.services.groq_client import GroqClient, _error_category, _provider_request_id  # noqa: E402
from app.utils.json_parser import parse_and_validate  # noqa: E402

DEFAULT_IMAGE = Path(__file__).resolve().parent / "fixtures" / "test_item.jpg"
SAFE_RATE_LIMIT_HEADERS = (
    "retry-after",
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-tokens",
)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Probe Groq vision JSON behavior without printing model output or secrets."
    )
    parser.add_argument(
        "--model",
        action="append",
        dest="models",
        help="Groq model ID to test. Repeat for multiple models. Defaults to the configured model.",
    )
    parser.add_argument(
        "--response-format",
        choices=("both", "on", "off"),
        default="both",
        help="Test JSON response_format on, off, or both modes.",
    )
    parser.add_argument(
        "--reasoning-effort",
        choices=("omit", "both", "none", "default"),
        default="omit",
        help=(
            "Set Qwen reasoning_effort to none or default, test both explicit modes, "
            "or omit the field for the historical baseline."
        ),
    )
    parser.add_argument(
        "--retry-path",
        action="store_true",
        help="Exercise the production GroqClient structured-first retry path instead of direct mode calls.",
    )
    parser.add_argument("--runs", type=int, default=1, help="Runs per model/mode combination.")
    parser.add_argument(
        "--max-output-tokens",
        type=int,
        default=2048,
        help="Maximum output tokens for direct probes. Defaults to the production vision value (2048).",
    )
    parser.add_argument(
        "--image",
        action="append",
        dest="images",
        type=Path,
        help="Local image fixture path. Repeat for multiple images. Defaults to the tracked fixture.",
    )
    return parser.parse_args(argv)


def response_format_modes(value: str) -> tuple[bool, ...]:
    if value == "on":
        return (True,)
    if value == "off":
        return (False,)
    return (True, False)


def reasoning_effort_modes(value: str) -> tuple[str | None, ...]:
    if value == "none":
        return ("none",)
    if value == "default":
        return ("default",)
    if value == "both":
        return ("none", "default")
    return (None,)


def safe_error_metadata(
    exc: Exception,
) -> tuple[int | None, dict[str, str] | None, str | None, str | None]:
    response = getattr(exc, "response", None)
    status_code = getattr(exc, "status_code", None) or getattr(response, "status_code", None)
    headers = getattr(response, "headers", None)
    rate_limit = None
    if headers:
        rate_limit = {
            name: str(headers[name])
            for name in SAFE_RATE_LIMIT_HEADERS
            if headers.get(name) is not None
        } or None

    body = getattr(exc, "body", None)
    provider_error = body.get("error") if isinstance(body, dict) else None
    provider_error_type = provider_error.get("type") if isinstance(provider_error, dict) else None
    provider_error_code = provider_error.get("code") if isinstance(provider_error, dict) else None
    return (
        status_code,
        rate_limit,
        str(provider_error_type)[:100] if provider_error_type is not None else None,
        str(provider_error_code)[:100] if provider_error_code is not None else None,
    )


class AttemptCapture(logging.Handler):
    """Capture only the allowlisted structured fields emitted by GroqClient."""

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.attempts: list[dict[str, Any]] = []

    def emit(self, record: logging.LogRecord) -> None:
        if not hasattr(record, "groq_status"):
            return
        self.attempts.append(
            {
                "status": record.groq_status,
                "attempt": record.groq_attempt,
                "reasoning_effort": getattr(record, "groq_reasoning_effort", None),
                "response_format": record.groq_response_format,
                "latency_ms": record.groq_latency_ms,
                "content_length": record.groq_content_length,
                "provider_request_id": record.groq_provider_request_id,
                "error_category": record.groq_error_category,
            }
        )


async def probe_retry_once(
    client: GroqClient,
    *,
    image_bytes: bytes,
    mime_type: str,
    image_sha256: str,
    run_number: int,
) -> dict[str, Any]:
    capture = AttemptCapture()
    groq_logger = logging.getLogger("app.services.groq_client")
    previous_level = groq_logger.level
    groq_logger.addHandler(capture)
    if not groq_logger.isEnabledFor(logging.INFO):
        groq_logger.setLevel(logging.INFO)

    result: dict[str, Any] = {
        "request_path": "retried_client",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "model": settings.groq_vision_model,
        "run": run_number,
        "image_sha256": image_sha256,
        "status": "unknown",
        "terminal_error_category": None,
        "latency_ms": None,
        "attempts": capture.attempts,
    }
    started_at = time.perf_counter()
    try:
        await client.generate_json(
            system_instruction=VISION_SYSTEM_PROMPT,
            user_prompt=VISION_USER_PROMPT,
            image_bytes=image_bytes,
            mime_type=mime_type,
            schema_model=VisionAnalysis,
            max_output_tokens=2048,
        )
        result["status"] = "schema_valid"
    except Exception as exc:
        result["status"] = "failed"
        result["terminal_error_category"] = (
            capture.attempts[-1]["error_category"] if capture.attempts else _error_category(exc)
        )
    finally:
        result["latency_ms"] = round((time.perf_counter() - started_at) * 1000)
        groq_logger.removeHandler(capture)
        groq_logger.setLevel(previous_level)
    return result


async def probe_once(
    client: AsyncGroq,
    *,
    model_name: str,
    image_data_url: str,
    image_sha256: str,
    response_format: bool,
    reasoning_effort: str | None,
    run_number: int,
    max_output_tokens: int = 2048,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": VISION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": VISION_USER_PROMPT},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
        "temperature": 0.2,
        "max_tokens": max_output_tokens,
    }
    if response_format:
        kwargs["response_format"] = {"type": "json_object"}
    if reasoning_effort is not None:
        kwargs["reasoning_effort"] = reasoning_effort

    result: dict[str, Any] = {
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "model": model_name,
        "response_format": response_format,
        "reasoning_effort": reasoning_effort,
        "run": run_number,
        "max_output_tokens": max_output_tokens,
        "image_sha256": image_sha256,
        "status": "unknown",
        "content_length": None,
        "provider_request_id": None,
        "http_status": None,
        "rate_limit": None,
        "provider_error_type": None,
        "provider_error_code": None,
        "latency_ms": None,
    }
    started_at = time.perf_counter()
    try:
        response = await client.chat.completions.create(**kwargs)
        result["provider_request_id"] = _provider_request_id(response)
        content = response.choices[0].message.content
        result["content_length"] = len(content) if content is not None else None
        if not content or not content.strip():
            result["status"] = "empty_content"
        else:
            try:
                parse_and_validate(content.strip(), VisionAnalysis)
                result["status"] = "schema_valid"
            except Exception as exc:
                result["status"] = _error_category(exc)
    except Exception as exc:
        result["status"] = _error_category(exc)
        result["provider_request_id"] = _provider_request_id(exc)
        (
            result["http_status"],
            result["rate_limit"],
            result["provider_error_type"],
            result["provider_error_code"],
        ) = safe_error_metadata(exc)
    result["latency_ms"] = round((time.perf_counter() - started_at) * 1000)
    return result


async def main() -> int:
    args = parse_args()
    if args.runs < 1:
        raise SystemExit("--runs must be at least 1")
    if args.max_output_tokens < 1:
        raise SystemExit("--max-output-tokens must be at least 1")
    if not settings.groq_api_key:
        raise SystemExit("GROQ_API_KEY is not configured")
    image_paths = args.images or [DEFAULT_IMAGE]
    for image_path in image_paths:
        if not image_path.is_file():
            raise SystemExit(f"Image fixture does not exist: {image_path}")

    models = args.models or [settings.groq_vision_model]
    if args.retry_path and args.models:
        raise SystemExit("--retry-path uses the configured vision model; do not pass --model")
    if args.retry_path and args.max_output_tokens != 2048:
        raise SystemExit("--retry-path uses the production 2048-token limit")
    if args.retry_path and args.reasoning_effort != "omit":
        raise SystemExit(
            "--retry-path uses the production reasoning behavior; "
            "explicit --reasoning-effort is available only for direct probes"
        )
    if args.retry_path:
        retry_client = GroqClient()
        for image_path in image_paths:
            image_bytes = image_path.read_bytes()
            image_sha256 = hashlib.sha256(image_bytes).hexdigest()
            mime_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
            for run_number in range(1, args.runs + 1):
                result = await probe_retry_once(
                    retry_client,
                    image_bytes=image_bytes,
                    mime_type=mime_type,
                    image_sha256=image_sha256,
                    run_number=run_number,
                )
                print(json.dumps(result, sort_keys=True), flush=True)
                if result["terminal_error_category"] == "ratelimiterror":
                    return 2
        return 0

    client = AsyncGroq(api_key=settings.groq_api_key, timeout=settings.groq_request_timeout)

    for image_path in image_paths:
        image_bytes = image_path.read_bytes()
        image_sha256 = hashlib.sha256(image_bytes).hexdigest()
        mime_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
        image_data_url = f"data:{mime_type};base64," + base64.b64encode(image_bytes).decode("utf-8")

        for model_name in models:
            for response_format in response_format_modes(args.response_format):
                for reasoning_effort in reasoning_effort_modes(args.reasoning_effort):
                    for run_number in range(1, args.runs + 1):
                        result = await probe_once(
                            client,
                            model_name=model_name,
                            image_data_url=image_data_url,
                            image_sha256=image_sha256,
                            response_format=response_format,
                            reasoning_effort=reasoning_effort,
                            run_number=run_number,
                            max_output_tokens=args.max_output_tokens,
                        )
                        print(json.dumps(result, sort_keys=True), flush=True)
                        if result["status"] == "ratelimiterror":
                            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
