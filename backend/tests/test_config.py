from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app import main
from app.config import DEFAULT_GROQ_TEXT_MODEL, SUPPORTED_GROQ_VISION_MODEL, Settings
from app.services.notion_status import notion_capability


def test_render_blueprint_defaults_to_byok_for_open_source_deployments():
    blueprint = (Path(__file__).parents[2] / "render.yaml").read_text()

    assert "- key: AI_PROVIDER\n        value: groq" in blueprint
    assert "- key: ALLOW_SERVER_AI_KEY_FALLBACK\n        value: false" in blueprint


def test_groq_vision_model_defaults_to_verified_qwen_model(monkeypatch):
    monkeypatch.delenv("GROQ_VISION_MODEL", raising=False)
    monkeypatch.delenv("GROQ_VISION_REASONING_EFFORT", raising=False)
    configured = Settings(_env_file=None)

    assert configured.groq_vision_model == SUPPORTED_GROQ_VISION_MODEL
    assert configured.groq_vision_reasoning_effort == "none"


def test_groq_text_model_defaults_to_supported_replacement(monkeypatch):
    monkeypatch.delenv("GROQ_TEXT_MODEL", raising=False)

    configured = Settings(_env_file=None)

    assert configured.groq_text_model == DEFAULT_GROQ_TEXT_MODEL
    assert configured.groq_text_model == "openai/gpt-oss-20b"


def test_groq_vision_model_accepts_supported_qwen_model():
    configured = Settings(_env_file=None, groq_vision_model=SUPPORTED_GROQ_VISION_MODEL)

    assert configured.groq_vision_model == SUPPORTED_GROQ_VISION_MODEL


def test_groq_vision_reasoning_effort_preserves_explicit_default():
    configured = Settings(_env_file=None, groq_vision_reasoning_effort="default")

    assert configured.groq_vision_reasoning_effort == "default"


@pytest.mark.parametrize(
    "model_id",
    ["", "   ", " qwen/qwen3.8-27b", "meta-llama/llama-4-scout-17b-16e-instruct"],
)
def test_groq_vision_model_rejects_invalid_or_unsupported_value(model_id):
    with pytest.raises(ValidationError, match="GROQ_VISION_MODEL"):
        Settings(_env_file=None, groq_vision_model=model_id)


@pytest.mark.parametrize("reasoning_effort", ["", "omit", " none", "default "])
def test_groq_vision_reasoning_effort_rejects_invalid_value(reasoning_effort):
    with pytest.raises(ValidationError, match="GROQ_VISION_REASONING_EFFORT"):
        Settings(_env_file=None, groq_vision_reasoning_effort=reasoning_effort)


def test_processing_defaults_are_bounded():
    configured = Settings(_env_file=None)

    assert configured.analysis_lease_seconds == 300
    assert configured.analysis_max_attempts == 3
    assert configured.pending_item_retention_hours == 168
    assert configured.notion_sync_lease_seconds == 300


@pytest.mark.parametrize(
    "field",
    [
        "analysis_lease_seconds",
        "analysis_max_attempts",
        "pending_item_retention_hours",
        "notion_sync_lease_seconds",
    ],
)
def test_processing_settings_reject_non_positive_values(field):
    with pytest.raises(ValidationError, match="Processing lease and retention settings"):
        Settings(_env_file=None, **{field: 0})


@pytest.mark.asyncio
async def test_health_exposes_configured_groq_vision_model(monkeypatch):
    explicit_reasoning_effort = "default"
    monkeypatch.setattr(main.settings, "groq_vision_model", SUPPORTED_GROQ_VISION_MODEL)
    monkeypatch.setattr(main.settings, "groq_vision_reasoning_effort", explicit_reasoning_effort)
    monkeypatch.setattr(main.settings, "groq_text_model", DEFAULT_GROQ_TEXT_MODEL)
    monkeypatch.setattr(main.settings, "allow_server_ai_key_fallback", False)

    response = await main.health()

    assert response["groq_vision_model"] == SUPPORTED_GROQ_VISION_MODEL
    assert response["groq_vision_reasoning_effort"] == explicit_reasoning_effort
    assert response["groq_text_model"] == DEFAULT_GROQ_TEXT_MODEL
    assert response["analysis_executor"] == "request_inline"
    assert response["allow_server_ai_key_fallback"] is False


@pytest.mark.parametrize(
    ("creation_enabled", "api_key", "destination", "expected_reason", "configured"),
    [
        (False, "secret", "source", "backend_disabled", False),
        (True, "", "source", "missing_credentials", False),
        (True, "secret", "", "missing_credentials", False),
        (True, "secret", "source", "configured", True),
    ],
)
def test_notion_capability_explains_effective_configuration(
    creation_enabled,
    api_key,
    destination,
    expected_reason,
    configured,
):
    capability = notion_capability(
        creation_enabled=creation_enabled,
        api_key=api_key,
        data_source_id=destination,
        database_id="",
        client_override_allowed=True,
    )

    assert capability == {
        "configured": configured,
        "creation_enabled": creation_enabled,
        "client_override_allowed": True,
        "effective_request_enabled": configured,
        "reason": expected_reason,
    }


@pytest.mark.asyncio
async def test_health_preserves_legacy_notion_flags_and_adds_capability(monkeypatch):
    monkeypatch.setattr(main.settings, "notion_create_entries", True)
    monkeypatch.setattr(main.settings, "notion_api_key", "secret")
    monkeypatch.setattr(main.settings, "notion_data_source_id", "source")
    monkeypatch.setattr(main.settings, "notion_database_id", "")
    monkeypatch.setattr(main.settings, "notion_allow_client_override", True)

    response = await main.health()

    assert response["notion_configured"] is True
    assert response["notion_client_override_allowed"] is True
    assert response["notion_capability"] == {
        "configured": True,
        "creation_enabled": True,
        "client_override_allowed": True,
        "effective_request_enabled": True,
        "reason": "configured",
    }
