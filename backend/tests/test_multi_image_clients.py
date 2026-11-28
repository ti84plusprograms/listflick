"""All three provider clients accept several photos of one item in a single call."""

from __future__ import annotations

import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from app.services import gemini_client as gemini_module
from app.services.claude_client import ClaudeClient
from app.services.gemini_client import GeminiClient
from app.services.groq_client import GROQ_MAX_IMAGES, GroqClient
from app.services.image_payload import MAX_ANALYSIS_IMAGES, collect_images, image_label


class SimpleSchema(BaseModel):
    name: str


PHOTOS = [f"photo-{index}".encode() for index in range(1, 11)]


def _b64(value: bytes) -> str:
    return base64.b64encode(value).decode()


# ---------------------------------------------------------------------------
# collect_images
# ---------------------------------------------------------------------------


def test_collect_images_prefers_list_and_caps_at_eight():
    assert collect_images(b"single", PHOTOS) == PHOTOS[:MAX_ANALYSIS_IMAGES]
    assert MAX_ANALYSIS_IMAGES == 8


def test_collect_images_falls_back_to_single_image_bytes():
    assert collect_images(b"single", None) == [b"single"]
    assert collect_images(b"single", []) == [b"single"]
    assert collect_images(None, None) == []


def test_collect_images_drops_empty_entries_and_respects_byte_budget():
    images = [b"a" * 10, b"", b"b" * 10, b"c" * 10]
    assert collect_images(None, images) == [b"a" * 10, b"b" * 10, b"c" * 10]
    assert collect_images(None, images, max_total_bytes=25) == [b"a" * 10, b"b" * 10]
    # The cover is always sent even when it alone is over budget.
    assert collect_images(None, [b"x" * 50, b"y"], max_total_bytes=10) == [b"x" * 50]


def test_image_label_marks_the_cover():
    assert image_label(0, 3) == "Image 1 of 3 (cover photo):"
    assert image_label(2, 3) == "Image 3 of 3:"


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------


async def _gemini_contents(monkeypatch, **kwargs):
    client = GeminiClient(api_key="test")
    calls = []

    def fake_generate(**call):
        calls.append(call)
        return '{"name": "lamp"}'

    monkeypatch.setattr(client, "_generate_sync", fake_generate)
    monkeypatch.setattr(gemini_module.settings, "gemini_request_timeout", 5)
    result = await client.generate_json(
        system_instruction="s",
        user_prompt="Look.",
        schema_model=SimpleSchema,
        **kwargs,
    )
    assert result.name == "lamp"
    return calls[0]["contents"]


@pytest.mark.asyncio
async def test_gemini_sends_every_photo_with_labels(monkeypatch):
    contents = await _gemini_contents(monkeypatch, image_bytes=PHOTOS[0], images=PHOTOS[:3])

    assert contents[0] == "Look."
    assert contents[1] == "Image 1 of 3 (cover photo):"
    parts = [item for item in contents if not isinstance(item, str)]
    assert [part.inline_data.data for part in parts] == PHOTOS[:3]
    assert contents[3] == "Image 2 of 3:"


@pytest.mark.asyncio
async def test_gemini_caps_photos_at_eight(monkeypatch):
    contents = await _gemini_contents(monkeypatch, images=PHOTOS)

    parts = [item for item in contents if not isinstance(item, str)]
    assert len(parts) == 8


@pytest.mark.asyncio
async def test_gemini_single_image_keeps_old_payload(monkeypatch):
    contents = await _gemini_contents(monkeypatch, image_bytes=b"only")

    assert len(contents) == 2
    assert contents[1].inline_data.data == b"only"


# ---------------------------------------------------------------------------
# Groq
# ---------------------------------------------------------------------------


@pytest.fixture
def groq_settings():
    with patch("app.services.groq_client.settings") as mock:
        mock.groq_api_key = "gsk_test"
        mock.groq_vision_model = "vision-model"
        mock.groq_vision_reasoning_effort = "none"
        mock.groq_text_model = "text-model"
        mock.groq_max_retries = 0
        mock.groq_request_timeout = 10
        yield mock


def _groq_client():
    client = GroqClient()
    fake = MagicMock()
    choice = MagicMock()
    choice.message.content = '{"name": "lamp"}'
    fake.chat.completions.create = AsyncMock(return_value=MagicMock(choices=[choice]))
    client._client = fake
    return client, fake.chat.completions.create


@pytest.mark.asyncio
async def test_groq_sends_every_photo_in_one_message(groq_settings):
    client, create = _groq_client()

    await client.generate_json(system_instruction="s", user_prompt="Look.", images=PHOTOS[:3], schema_model=SimpleSchema)

    kwargs = create.await_args.kwargs
    assert kwargs["model"] == "vision-model"
    content = kwargs["messages"][1]["content"]
    urls = [item["image_url"]["url"] for item in content if item["type"] == "image_url"]
    assert urls == [f"data:image/jpeg;base64,{_b64(photo)}" for photo in PHOTOS[:3]]
    texts = [item["text"] for item in content if item["type"] == "text"]
    assert texts == ["Look.", "Image 1 of 3 (cover photo):", "Image 2 of 3:", "Image 3 of 3:"]


@pytest.mark.asyncio
async def test_groq_caps_photos_to_provider_limit(groq_settings):
    client, create = _groq_client()

    await client.generate_json(system_instruction="s", user_prompt="Look.", images=PHOTOS, schema_model=SimpleSchema)

    content = create.await_args.kwargs["messages"][1]["content"]
    assert len([item for item in content if item["type"] == "image_url"]) == GROQ_MAX_IMAGES


@pytest.mark.asyncio
async def test_groq_text_only_call_uses_text_model(groq_settings):
    client, create = _groq_client()

    await client.generate_json(system_instruction="s", user_prompt="Write.", schema_model=SimpleSchema)

    kwargs = create.await_args.kwargs
    assert kwargs["model"] == "text-model"
    assert "reasoning_effort" not in kwargs


# ---------------------------------------------------------------------------
# Claude
# ---------------------------------------------------------------------------


@pytest.fixture
def claude_settings():
    with patch("app.services.claude_client.settings") as mock:
        mock.anthropic_api_key = "sk-ant-test"
        mock.claude_vision_model = "vision-model"
        mock.claude_text_model = "text-model"
        mock.claude_max_retries = 0
        mock.claude_request_timeout = 10
        yield mock


def _claude_client():
    client = ClaudeClient()
    fake = MagicMock()
    fake.messages.create = AsyncMock(
        return_value=SimpleNamespace(content=[SimpleNamespace(type="text", text='{"name": "lamp"}')], stop_reason="end_turn")
    )
    client._client = fake
    return client, fake.messages.create


@pytest.mark.asyncio
async def test_claude_sends_every_photo_before_the_prompt(claude_settings):
    client, create = _claude_client()

    await client.generate_json(
        system_instruction="s",
        user_prompt="Look.",
        image_bytes=PHOTOS[0],
        images=PHOTOS[:3],
        schema_model=SimpleSchema,
    )

    kwargs = create.await_args.kwargs
    assert kwargs["model"] == "vision-model"
    content = kwargs["messages"][0]["content"]
    images = [item["source"]["data"] for item in content if item["type"] == "image"]
    assert images == [_b64(photo) for photo in PHOTOS[:3]]
    assert content[0] == {"type": "text", "text": "Image 1 of 3 (cover photo):"}
    assert content[-1]["type"] == "text" and content[-1]["text"].startswith("Look.")


@pytest.mark.asyncio
async def test_claude_caps_photos_at_eight(claude_settings):
    client, create = _claude_client()

    await client.generate_json(system_instruction="s", user_prompt="Look.", images=PHOTOS, schema_model=SimpleSchema)

    content = create.await_args.kwargs["messages"][0]["content"]
    assert len([item for item in content if item["type"] == "image"]) == 8
