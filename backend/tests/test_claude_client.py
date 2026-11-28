from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from app.services.ai_credentials import AIProviderCredentialInvalidError
from app.services.claude_client import ClaudeClient, ClaudeClientError, ClaudeNotConfiguredError


class SimpleSchema(BaseModel):
    name: str
    count: int


def _response(text: str, *, request_id: str = "req_123"):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        stop_reason="end_turn",
        _request_id=request_id,
    )


@pytest.fixture
def mock_settings():
    with patch("app.services.claude_client.settings") as mock:
        mock.anthropic_api_key = "sk-ant-test"
        mock.claude_vision_model = "claude-sonnet-5-5"
        mock.claude_text_model = "claude-haiku-5-5"
        mock.claude_max_retries = 1
        mock.claude_request_timeout = 10
        yield mock


def _client_with(create: AsyncMock) -> ClaudeClient:
    client = ClaudeClient()
    fake = MagicMock()
    fake.messages.create = create
    client._client = fake
    return client


@pytest.mark.asyncio
async def test_claude_client_not_configured_raises_error():
    with patch("app.services.claude_client.settings") as mock_set:
        mock_set.anthropic_api_key = ""
        with pytest.raises(ClaudeNotConfiguredError):
            await ClaudeClient().generate_json(system_instruction="sys", user_prompt="p", schema_model=SimpleSchema)


@pytest.mark.asyncio
async def test_claude_client_generates_json_with_text_model(mock_settings):
    create = AsyncMock(return_value=_response('{"name": "lamp", "count": 2}'))
    client = _client_with(create)

    result = await client.generate_json(system_instruction="You list items.", user_prompt="Go.", schema_model=SimpleSchema)

    assert result == SimpleSchema(name="lamp", count=2)
    kwargs = create.await_args.kwargs
    assert kwargs["model"] == "claude-haiku-5-5"
    assert kwargs["system"] == "You list items."
    content = kwargs["messages"][0]["content"]
    assert content[0]["type"] == "text" and content[0]["text"].startswith("Go.")
    assert "Reply with only one JSON object" in content[0]["text"]


@pytest.mark.asyncio
async def test_claude_client_sends_image_block_with_vision_model(mock_settings):
    create = AsyncMock(return_value=_response('{"name": "lamp", "count": 1}'))
    client = _client_with(create)

    await client.generate_json(system_instruction="s", user_prompt="Look.", image_bytes=b"\xff\xd8jpeg", schema_model=SimpleSchema)

    kwargs = create.await_args.kwargs
    assert kwargs["model"] == "claude-sonnet-5-5"
    image = kwargs["messages"][0]["content"][0]
    assert image["type"] == "image"
    assert image["source"] == {"type": "base64", "media_type": "image/jpeg", "data": "/9hqcGVn"}


@pytest.mark.asyncio
async def test_claude_client_accepts_fenced_json_and_ignores_non_text_blocks(mock_settings):
    response = SimpleNamespace(
        content=[SimpleNamespace(type="thinking", thinking="..."), SimpleNamespace(type="text", text='```json\n{"name": "a", "count": 3}\n```')],
        stop_reason="end_turn",
    )
    client = _client_with(AsyncMock(return_value=response))

    result = await client.generate_json(system_instruction="s", user_prompt="p", schema_model=SimpleSchema)

    assert result.count == 3


@pytest.mark.asyncio
async def test_claude_client_self_corrects_bad_json(mock_settings):
    create = AsyncMock(side_effect=[_response("not json"), _response('{"name": "ok", "count": 5}')])
    client = _client_with(create)

    result = await client.generate_json(system_instruction="s", user_prompt="p", schema_model=SimpleSchema)

    assert result.name == "ok"
    second = create.await_args_list[1].kwargs["messages"]
    assert [m["role"] for m in second] == ["user", "assistant", "user"]
    assert second[1]["content"] == "not json"


@pytest.mark.asyncio
async def test_claude_client_raises_after_retries(mock_settings):
    create = AsyncMock(side_effect=[_response("nope"), _response("still nope")])
    client = _client_with(create)

    with pytest.raises(ClaudeClientError):
        await client.generate_json(system_instruction="s", user_prompt="p", schema_model=SimpleSchema)
    assert create.await_count == 2


@pytest.mark.asyncio
async def test_claude_client_maps_auth_errors_to_invalid_credential(mock_settings):
    error = Exception("unauthorized")
    error.status_code = 401
    client = _client_with(AsyncMock(side_effect=error))

    with pytest.raises(AIProviderCredentialInvalidError):
        await client.generate_json(system_instruction="s", user_prompt="p", schema_model=SimpleSchema)


@pytest.mark.asyncio
async def test_claude_client_sends_no_sampling_params_and_skips_upfront_thinking_on_sonnet_5_5(mock_settings):
    create = AsyncMock(return_value=_response('{"name": "lamp", "count": 2}'))
    client = _client_with(create)

    await client.generate_json(
        system_instruction="s", user_prompt="p", image_bytes=b"img", schema_model=SimpleSchema, max_output_tokens=1024
    )

    kwargs = create.await_args.kwargs
    assert kwargs["model"] == "claude-sonnet-5-5"
    for sampling in ("temperature", "top_p", "top_k"):
        assert sampling not in kwargs
    assert kwargs["thinking"] == {"type": "between_tools"}
    assert kwargs["max_tokens"] >= 8192


@pytest.mark.asyncio
async def test_claude_client_leaves_thinking_unset_for_other_models(mock_settings):
    create = AsyncMock(return_value=_response('{"name": "lamp", "count": 2}'))
    client = _client_with(create)

    await client.generate_json(system_instruction="s", user_prompt="p", schema_model=SimpleSchema)

    kwargs = create.await_args.kwargs
    assert kwargs["model"] == "claude-haiku-5-5"
    assert "thinking" not in kwargs
    assert "temperature" not in kwargs


@pytest.mark.asyncio
async def test_claude_client_does_not_retry_bad_requests(mock_settings):
    error = Exception("bad request")
    error.status_code = 400
    create = AsyncMock(side_effect=error)
    client = _client_with(create)

    with pytest.raises(ClaudeClientError):
        await client.generate_json(system_instruction="s", user_prompt="p", schema_model=SimpleSchema)
    assert create.await_count == 1


@pytest.mark.asyncio
async def test_claude_client_backs_off_on_rate_limits(mock_settings):
    error = Exception("rate limited")
    error.status_code = 429
    create = AsyncMock(side_effect=[error, _response('{"name": "lamp", "count": 2}')])
    client = _client_with(create)

    with patch("app.services.claude_client.asyncio.sleep", new=AsyncMock()) as sleep:
        result = await client.generate_json(system_instruction="s", user_prompt="p", schema_model=SimpleSchema)

    assert result.name == "lamp"
    sleep.assert_awaited_once()
