from __future__ import annotations

import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.scripts import probe_groq_vision
from tests.scripts.probe_groq_vision import (
    parse_args,
    probe_once,
    probe_retry_once,
    reasoning_effort_modes,
    response_format_modes,
    safe_error_metadata,
)


def test_response_format_modes_are_explicit():
    assert response_format_modes("on") == (True,)
    assert response_format_modes("off") == (False,)
    assert response_format_modes("both") == (True, False)


def test_reasoning_effort_modes_are_explicit():
    assert reasoning_effort_modes("omit") == (None,)
    assert reasoning_effort_modes("none") == ("none",)
    assert reasoning_effort_modes("default") == ("default",)
    assert reasoning_effort_modes("both") == ("none", "default")


def test_parse_args_accepts_multiple_images():
    args = parse_args(["--image", "first.jpg", "--image", "second.jpg"])

    assert [str(image) for image in args.images] == ["first.jpg", "second.jpg"]


def test_parse_args_can_select_production_retry_path():
    args = parse_args(["--retry-path", "--runs", "2"])

    assert args.retry_path is True
    assert args.runs == 2


def test_parse_args_can_override_direct_probe_token_cap():
    args = parse_args(["--max-output-tokens", "512"])

    assert args.max_output_tokens == 512


def test_safe_error_metadata_allows_only_quota_headers():
    response = MagicMock()
    response.status_code = 429
    response.headers = {
        "retry-after": "42",
        "x-ratelimit-remaining-requests": "0",
        "authorization": "PRIVATE_TOKEN",
        "x-debug-private": "PRIVATE_VALUE",
    }
    error = MagicMock()
    error.status_code = 429
    error.response = response
    error.body = {
        "error": {
            "type": "tokens",
            "code": "rate_limit_exceeded",
            "message": "PRIVATE_PROVIDER_MESSAGE",
        }
    }

    status_code, rate_limit, provider_error_type, provider_error_code = safe_error_metadata(error)

    assert status_code == 429
    assert rate_limit == {
        "retry-after": "42",
        "x-ratelimit-remaining-requests": "0",
    }
    assert provider_error_type == "tokens"
    assert provider_error_code == "rate_limit_exceeded"
    assert "PRIVATE" not in json.dumps(
        [rate_limit, provider_error_type, provider_error_code]
    )


@pytest.mark.asyncio
async def test_probe_reports_metadata_without_returning_model_output():
    private_model_output = "PRIVATE_MALFORMED_MODEL_OUTPUT"
    choice = MagicMock()
    choice.message.content = private_model_output
    response = MagicMock()
    response.id = "resp-private"
    response.choices = [choice]
    client = MagicMock()
    client.chat.completions.create = AsyncMock(return_value=response)

    result = await probe_once(
        client,
        model_name="test-model",
        image_data_url="data:image/jpeg;base64,c2FmZQ==",
        image_sha256="test-sha",
        response_format=False,
        reasoning_effort=None,
        run_number=1,
    )

    assert result["status"] == "invalid_json"
    assert result["content_length"] == len(private_model_output)
    assert result["provider_request_id"] == "resp-private"
    assert result["observed_at"].endswith("+00:00")
    assert private_model_output not in json.dumps(result)
    request_kwargs = client.chat.completions.create.await_args.kwargs
    assert "reasoning_effort" not in request_kwargs


@pytest.mark.asyncio
async def test_probe_sends_and_reports_explicit_reasoning_effort():
    choice = MagicMock()
    choice.message.content = "not-json"
    response = MagicMock()
    response.id = "resp-reasoning"
    response.choices = [choice]
    client = MagicMock()
    client.chat.completions.create = AsyncMock(return_value=response)

    result = await probe_once(
        client,
        model_name="test-model",
        image_data_url="data:image/jpeg;base64,c2FmZQ==",
        image_sha256="test-sha",
        response_format=True,
        reasoning_effort="none",
        run_number=1,
    )

    request_kwargs = client.chat.completions.create.await_args.kwargs
    assert request_kwargs["reasoning_effort"] == "none"
    assert request_kwargs["response_format"] == {"type": "json_object"}
    assert result["reasoning_effort"] == "none"


@pytest.mark.asyncio
async def test_retry_probe_captures_only_structured_attempt_metadata():
    private_message = "PRIVATE_LOG_MESSAGE"
    client = MagicMock()

    async def generate_json(**_kwargs):
        logging.getLogger("app.services.groq_client").info(
            private_message,
            extra={
                "groq_status": "success",
                "groq_attempt": 1,
                "groq_response_format": True,
                "groq_latency_ms": 123,
                "groq_content_length": 456,
                "groq_provider_request_id": "request-safe",
                "groq_error_category": None,
            },
        )
        return MagicMock()

    client.generate_json = AsyncMock(side_effect=generate_json)

    result = await probe_retry_once(
        client,
        image_bytes=b"image",
        mime_type="image/jpeg",
        image_sha256="sha-safe",
        run_number=1,
    )

    assert result["status"] == "schema_valid"
    assert result["attempts"] == [
        {
            "status": "success",
            "attempt": 1,
            "reasoning_effort": None,
            "response_format": True,
            "latency_ms": 123,
            "content_length": 456,
            "provider_request_id": "request-safe",
            "error_category": None,
        }
    ]
    assert private_message not in json.dumps(result)


@pytest.mark.asyncio
async def test_main_stops_batch_after_first_rate_limit(monkeypatch, tmp_path):
    image_path = tmp_path / "fixture.jpg"
    image_path.write_bytes(b"image")
    monkeypatch.setattr(
        probe_groq_vision,
        "parse_args",
        lambda: SimpleNamespace(
            runs=5,
            images=[image_path],
            models=["test-model"],
            retry_path=False,
            response_format="on",
            reasoning_effort="none",
            max_output_tokens=2048,
        ),
    )
    monkeypatch.setattr(probe_groq_vision.settings, "groq_api_key", "test-key")
    probe = AsyncMock(
        return_value={
            "status": "ratelimiterror",
            "image_sha256": "sha",
            "run": 1,
        }
    )
    monkeypatch.setattr(probe_groq_vision, "probe_once", probe)
    monkeypatch.setattr(probe_groq_vision, "AsyncGroq", MagicMock())

    exit_code = await probe_groq_vision.main()

    assert exit_code == 2
    probe.assert_awaited_once()
