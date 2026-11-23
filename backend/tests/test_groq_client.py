from __future__ import annotations

import logging
from copy import deepcopy
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from app.services.groq_client import GroqClient, GroqClientError, GroqNotConfiguredError


class SimpleSchema(BaseModel):
    name: str
    count: int


@pytest.fixture
def mock_settings():
    with patch("app.services.groq_client.settings") as mock:
        mock.groq_api_key = "gsk_test_key_12345"
        mock.groq_vision_model = "qwen/qwen3.8-27b"
        mock.groq_vision_reasoning_effort = "none"
        mock.groq_text_model = "openai/gpt-oss-20b"
        mock.groq_max_retries = 1
        mock.groq_request_timeout = 10
        yield mock


@pytest.mark.asyncio
async def test_groq_client_not_configured_raises_error():
    with patch("app.services.groq_client.settings") as mock_set:
        mock_set.groq_api_key = ""
        client = GroqClient()
        with pytest.raises(GroqNotConfiguredError):
            await client.generate_json(
                system_instruction="sys",
                user_prompt="prompt",
                schema_model=SimpleSchema,
            )


@pytest.mark.asyncio
async def test_groq_client_generates_json_successfully(mock_settings):
    client = GroqClient()
    mock_async_client = MagicMock()
    mock_async_client.chat.completions.create = AsyncMock()

    # Define fake chat completion response choice
    mock_choice = MagicMock()
    mock_choice.message.content = '{"name": "test-item", "count": 42}'
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    mock_async_client.chat.completions.create.return_value = mock_response

    client._client = mock_async_client

    result = await client.generate_json(
        system_instruction="You are an assistant.",
        user_prompt="Analyze this.",
        schema_model=SimpleSchema,
    )

    assert isinstance(result, SimpleSchema)
    assert result.name == "test-item"
    assert result.count == 42

    mock_async_client.chat.completions.create.assert_called_once()
    call_args = mock_async_client.chat.completions.create.call_args.kwargs
    assert call_args["model"] == "openai/gpt-oss-20b"
    assert "reasoning_effort" not in call_args
    assert call_args["response_format"] == {"type": "json_object"}
    assert call_args["messages"][0]["content"] == "You are an assistant."
    assert call_args["messages"][1]["content"][0]["text"] == "Analyze this."


@pytest.mark.asyncio
async def test_groq_client_handles_vision_base64_payload(mock_settings):
    client = GroqClient()
    mock_async_client = MagicMock()
    mock_async_client.chat.completions.create = AsyncMock()

    mock_choice = MagicMock()
    mock_choice.message.content = '{"name": "vision-item", "count": 1}'
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    mock_async_client.chat.completions.create.return_value = mock_response

    client._client = mock_async_client

    fake_image_bytes = b"fake-jpeg-raw-bytes"
    result = await client.generate_json(
        system_instruction="Analyze image.",
        user_prompt="What is this?",
        image_bytes=fake_image_bytes,
        mime_type="image/png",
        schema_model=SimpleSchema,
    )

    assert result.name == "vision-item"
    mock_async_client.chat.completions.create.assert_called_once()
    call_args = mock_async_client.chat.completions.create.call_args.kwargs
    assert call_args["model"] == "qwen/qwen3.8-27b"
    assert call_args["reasoning_effort"] == "none"

    user_content = call_args["messages"][1]["content"]
    assert len(user_content) == 2
    assert user_content[0]["text"] == "What is this?"
    assert user_content[1]["type"] == "image_url"
    assert "data:image/png;base64," in user_content[1]["image_url"]["url"]


@pytest.mark.asyncio
async def test_groq_client_self_correction_on_bad_json(mock_settings):
    client = GroqClient()
    mock_async_client = MagicMock()
    mock_async_client.chat.completions.create = AsyncMock()

    mock_choice_bad = MagicMock()
    mock_choice_bad.message.content = "This is not valid JSON string."

    mock_choice_good = MagicMock()
    mock_choice_good.message.content = '{"name": "repaired-item", "count": 7}'

    mock_response_bad = MagicMock()
    mock_response_bad.choices = [mock_choice_bad]

    mock_response_good = MagicMock()
    mock_response_good.choices = [mock_choice_good]

    mock_async_client.chat.completions.create.side_effect = [
        mock_response_bad,
        mock_response_good,
    ]

    client._client = mock_async_client

    result = await client.generate_json(
        system_instruction="Repairs.",
        user_prompt="Help.",
        schema_model=SimpleSchema,
    )

    assert result.name == "repaired-item"
    assert result.count == 7
    assert mock_async_client.chat.completions.create.call_count == 2


@pytest.mark.asyncio
async def test_groq_client_disables_response_format_then_corrects_actual_malformed_output(
    mock_settings,
    caplog,
):
    client = GroqClient()
    mock_async_client = MagicMock()
    captured_calls: list[dict] = []
    private_failed_generation = "PRIVATE_PROVIDER_FAILED_GENERATION"
    private_malformed_output = "PRIVATE_MALFORMED_MODEL_OUTPUT"

    first_error = RuntimeError(
        f"Error code: 400 json_validate_failed failed_generation={private_failed_generation}"
    )
    first_error.request_id = "req-first-failure"

    malformed_choice = MagicMock()
    malformed_choice.message.content = private_malformed_output
    malformed_response = MagicMock()
    malformed_response.id = "resp-malformed"
    malformed_response.choices = [malformed_choice]

    valid_choice = MagicMock()
    valid_choice.message.content = '{"name": "repaired-item", "count": 7}'
    valid_response = MagicMock()
    valid_response.id = "resp-valid"
    valid_response.choices = [valid_choice]

    async def create(**kwargs):
        captured_calls.append(deepcopy(kwargs))
        if len(captured_calls) == 1:
            raise first_error
        if len(captured_calls) == 2:
            return malformed_response
        return valid_response

    mock_async_client.chat.completions.create = AsyncMock(side_effect=create)
    client._client = mock_async_client
    caplog.set_level(logging.INFO, logger="app.services.groq_client")

    result = await client.generate_json(
        system_instruction="Repairs.",
        user_prompt="Help.",
        image_bytes=b"fake-jpeg-raw-bytes",
        schema_model=SimpleSchema,
        max_retries=2,
    )

    assert result == SimpleSchema(name="repaired-item", count=7)
    assert len(captured_calls) == 3
    assert captured_calls[0]["response_format"] == {"type": "json_object"}
    assert captured_calls[0]["reasoning_effort"] == "none"
    assert "response_format" not in captured_calls[1]
    assert captured_calls[1]["reasoning_effort"] == "none"
    assert "response_format" not in captured_calls[2]
    assert captured_calls[2]["reasoning_effort"] == "none"

    assert len(captured_calls[0]["messages"]) == 2
    assert captured_calls[1]["messages"] == captured_calls[0]["messages"]
    assert captured_calls[2]["messages"][:2] == captured_calls[0]["messages"]
    assert captured_calls[2]["messages"][2] == {
        "role": "assistant",
        "content": private_malformed_output,
    }
    assert captured_calls[2]["messages"][3] == {
        "role": "user",
        "content": "Your previous response was not valid JSON. Please generate ONLY valid JSON matching the schema.",
    }

    attempt_records = [record for record in caplog.records if hasattr(record, "groq_status")]
    assert [record.groq_status for record in attempt_records] == ["failure", "failure", "success"]
    assert [record.groq_response_format for record in attempt_records] == [True, False, False]
    assert [record.groq_reasoning_effort for record in attempt_records] == ["none", "none", "none"]
    assert [record.groq_error_category for record in attempt_records] == [
        "provider_json_validation_failed",
        "invalid_json",
        None,
    ]
    assert [record.groq_provider_request_id for record in attempt_records] == [
        "req-first-failure",
        "resp-malformed",
        "resp-valid",
    ]
    assert [record.groq_content_length for record in attempt_records] == [
        None,
        len(private_malformed_output),
        len(valid_choice.message.content),
    ]
    assert private_failed_generation not in caplog.text
    assert private_malformed_output not in caplog.text
    assert valid_choice.message.content not in caplog.text


@pytest.mark.asyncio
async def test_groq_client_classifies_blank_content_without_logging_content(mock_settings, caplog):
    client = GroqClient()
    mock_async_client = MagicMock()
    blank_choice = MagicMock()
    blank_choice.message.content = "   "
    blank_response = MagicMock()
    blank_response.id = "resp-blank"
    blank_response.choices = [blank_choice]
    mock_async_client.chat.completions.create = AsyncMock(return_value=blank_response)
    client._client = mock_async_client
    caplog.set_level(logging.INFO, logger="app.services.groq_client")

    with pytest.raises(GroqClientError, match=r"after retries \(empty_content\)"):
        await client.generate_json(
            system_instruction="Repairs.",
            user_prompt="Help.",
            schema_model=SimpleSchema,
            max_retries=0,
        )

    [record] = [record for record in caplog.records if hasattr(record, "groq_status")]
    assert record.groq_status == "failure"
    assert record.groq_error_category == "empty_content"
    assert record.groq_content_length == 3
    assert record.groq_provider_request_id == "resp-blank"
    assert "Received empty content response" not in caplog.text


@pytest.mark.asyncio
async def test_groq_client_sanitizes_provider_output_from_final_error(mock_settings, caplog):
    client = GroqClient()
    mock_async_client = MagicMock()
    private_failed_generation = "PRIVATE_PROVIDER_FAILED_GENERATION"
    provider_error = RuntimeError(
        f"Error code: 400 json_validate_failed failed_generation={private_failed_generation}"
    )
    provider_error.request_id = "req-terminal-failure"
    mock_async_client.chat.completions.create = AsyncMock(side_effect=provider_error)
    client._client = mock_async_client
    caplog.set_level(logging.INFO, logger="app.services.groq_client")

    with pytest.raises(
        GroqClientError,
        match=r"after retries \(provider_json_validation_failed\)",
    ) as caught:
        await client.generate_json(
            system_instruction="Repairs.",
            user_prompt="Help.",
            schema_model=SimpleSchema,
            max_retries=0,
        )

    assert private_failed_generation not in str(caught.value)
    assert private_failed_generation not in caplog.text
    [record] = [record for record in caplog.records if hasattr(record, "groq_status")]
    assert record.groq_error_category == "provider_json_validation_failed"
    assert record.groq_provider_request_id == "req-terminal-failure"
