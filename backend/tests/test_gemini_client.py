from types import SimpleNamespace

import pytest
from google.genai import errors as genai_errors
from pydantic import BaseModel

from app.services import gemini_client as gemini_module
from app.services.gemini_client import GeminiClient, GeminiClientError


class StructuredOutput(BaseModel):
    value: str


class FakeModels:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class FakeGenAIClient:
    def __init__(self, responses):
        self.models = FakeModels(responses)


def _response(text: str):
    return SimpleNamespace(candidates=[object()], text=text)


def test_generate_sync_tries_all_model_fallbacks(monkeypatch):
    client = GeminiClient()
    fake_sdk = FakeGenAIClient([
        Exception("404 model not found"),
        Exception("invalid model"),
        _response('{"value":"ok"}'),
    ])
    monkeypatch.setattr(gemini_module.settings, "gemini_model", "gemini-primary")
    monkeypatch.setattr(gemini_module.settings, "gemini_model_fallbacks", "gemini-fallback-1,gemini-fallback-2")
    monkeypatch.setattr(client, "_ensure_client", lambda: fake_sdk)

    result = client._generate_sync(
        system_instruction="Return JSON.",
        contents=["prompt"],
    )

    assert result == '{"value":"ok"}'
    assert [call["model"] for call in fake_sdk.models.calls] == [
        "gemini-primary",
        "gemini-fallback-1",
        "gemini-fallback-2",
    ]


def test_generate_sync_keeps_json_config(monkeypatch):
    client = GeminiClient()
    fake_sdk = FakeGenAIClient([_response('{"value":"ok"}')])
    monkeypatch.setattr(gemini_module.settings, "gemini_model", "gemini-primary")
    monkeypatch.setattr(gemini_module.settings, "gemini_model_fallbacks", "")
    monkeypatch.setattr(client, "_ensure_client", lambda: fake_sdk)

    result = client._generate_sync(
        system_instruction="Return JSON.",
        contents=["prompt"],
        max_output_tokens=321,
    )
    call = fake_sdk.models.calls[0]

    assert result == '{"value":"ok"}'
    assert call["config"].system_instruction == "Return JSON."
    assert call["config"].response_mime_type == "application/json"
    assert call["config"].max_output_tokens == 321


@pytest.mark.asyncio
async def test_generate_json_retries_server_errors(monkeypatch):
    client = GeminiClient()
    monkeypatch.setattr(gemini_module.settings, "gemini_max_retries", 1)
    monkeypatch.setattr(gemini_module.settings, "gemini_request_timeout", 1)

    async def no_sleep(_delay):
        return None

    monkeypatch.setattr(gemini_module.asyncio, "sleep", no_sleep)

    calls = []

    def generate_once_then_succeed(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise genai_errors.ServerError(503, {"error": {"message": "temporarily unavailable"}})
        return '{"value":"ok"}'

    monkeypatch.setattr(client, "_generate_sync", generate_once_then_succeed)

    result = await client.generate_json(
        system_instruction="Return JSON.",
        user_prompt="prompt",
        schema_model=StructuredOutput,
    )

    assert result.value == "ok"
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_generate_json_raises_after_retry_budget(monkeypatch):
    client = GeminiClient()
    monkeypatch.setattr(gemini_module.settings, "gemini_max_retries", 0)
    monkeypatch.setattr(gemini_module.settings, "gemini_request_timeout", 1)

    def always_fails(**_kwargs):
        raise genai_errors.ServerError(503, {"error": {"message": "temporarily unavailable"}})

    monkeypatch.setattr(client, "_generate_sync", always_fails)

    with pytest.raises(GeminiClientError, match="after retries"):
        await client.generate_json(
            system_instruction="Return JSON.",
            user_prompt="prompt",
            schema_model=StructuredOutput,
        )
