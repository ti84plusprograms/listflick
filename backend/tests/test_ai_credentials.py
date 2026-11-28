import pytest
from fastapi import HTTPException, Response

from app.api import items as items_api
from app.config import settings
from app.schemas.listing import AnalysisJobStatus, AnalyzeRequest, AnalyzeResponse, GeneratedListing, VisionAnalysis
from app.services.ai_credentials import (
    AICredentialRequiredError,
    AIProviderCredentialInvalidError,
    resolve_ai_credential,
)
from app.services.analyze_service import improve_listing_record


def test_request_key_takes_precedence_over_explicit_server_fallback(monkeypatch):
    monkeypatch.setattr(settings, "allow_server_ai_key_fallback", True)
    monkeypatch.setattr(settings, "gemini_api_key", "server-gemini")

    resolved = resolve_ai_credential("gemini", "  user-gemini  ")

    assert resolved.value == "user-gemini"
    assert resolved.source == "byok"


def test_missing_key_is_rejected_when_fallback_disabled(monkeypatch):
    monkeypatch.setattr(settings, "allow_server_ai_key_fallback", False)
    monkeypatch.setattr(settings, "gemini_api_key", "server-gemini")

    with pytest.raises(AICredentialRequiredError):
        resolve_ai_credential("gemini")


def test_enabled_fallback_requires_a_server_key(monkeypatch):
    monkeypatch.setattr(settings, "allow_server_ai_key_fallback", True)
    monkeypatch.setattr(settings, "groq_api_key", "")

    with pytest.raises(AICredentialRequiredError):
        resolve_ai_credential("groq")


@pytest.mark.asyncio
async def test_analyze_route_uses_request_scoped_key(monkeypatch):
    captured = {}

    async def fake_analyze(item, *, ai, update_analysis, storage):
        captured["key"] = ai._client._api_key
        return AnalyzeResponse(
            item_id=item["id"],
            analysis=VisionAnalysis(item_name="Lamp"),
            listing=GeneratedListing(title="Lamp"),
        )

    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(settings, "allow_server_ai_key_fallback", False)
    monkeypatch.setattr(items_api, "get_item", lambda *args, **kwargs: None)
    async def owned_item(*args, **kwargs):
        return {"id": "item-1"}

    monkeypatch.setattr(items_api, "require_owned_item", owned_item)
    monkeypatch.setattr(items_api, "analyze_item_record", fake_analyze)

    response = await items_api.analyze_item(AnalyzeRequest(item_id="item-1"), uid="owner", ai_key="user-key")

    assert response.item_id == "item-1"
    assert captured["key"] == "user-key"


@pytest.mark.asyncio
async def test_improve_route_uses_request_scoped_groq_key(monkeypatch):
    captured = {}

    async def fake_improve(payload, item, *, ai):
        captured["key"] = ai._client._api_key
        return {"item_id": None, "listing": GeneratedListing(title="Lamp"), "missing_checklist": []}

    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "allow_server_ai_key_fallback", False)
    monkeypatch.setattr(items_api, "improve_listing_record", fake_improve)

    response = await items_api.improve_listing(
        items_api.ImproveListingRequest(action="make_title_more_searchable", listing=GeneratedListing(title="Lamp")),
        uid="owner",
        ai_key="user-groq-key",
    )

    assert response["item_id"] is None
    assert captured["key"] == "user-groq-key"


@pytest.mark.asyncio
async def test_request_provider_overrides_backend_default(monkeypatch):
    captured = {}

    async def fake_analyze(item, *, ai, update_analysis, storage):
        captured["provider"] = ai._provider
        return AnalyzeResponse(
            item_id=item["id"],
            analysis=VisionAnalysis(item_name="Lamp"),
            listing=GeneratedListing(title="Lamp"),
        )

    async def owned_item(*args, **kwargs):
        return {"id": "item-1"}

    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(settings, "allow_server_ai_key_fallback", False)
    monkeypatch.setattr(items_api, "require_owned_item", owned_item)
    monkeypatch.setattr(items_api, "analyze_item_record", fake_analyze)

    await items_api.analyze_item(
        AnalyzeRequest(item_id="item-1"),
        uid="owner",
        ai_key="groq-key",
        ai_provider="groq",
    )

    assert captured["provider"] == "groq"


@pytest.mark.asyncio
async def test_server_fallback_preserves_request_provider_across_ai_routes(monkeypatch):
    captured = {}

    async def owned_item(*args, **kwargs):
        return {"id": "item-1", "user_id": "owner"}

    async def fake_analyze(item, *, ai, update_analysis, storage):
        captured["analyze"] = ai._provider
        return AnalyzeResponse(
            item_id=item["id"],
            analysis=VisionAnalysis(item_name="Lamp"),
            listing=GeneratedListing(title="Lamp"),
        )

    async def fake_execute(item, **kwargs):
        captured["job"] = kwargs["ai"]._provider
        return AnalysisJobStatus(
            item_id=item["id"],
            status="succeeded",
            attempt_count=1,
            can_retry=False,
        )

    async def fake_improve(payload, item, *, ai):
        captured["improve"] = ai._provider
        return {"item_id": None, "listing": GeneratedListing(title="Lamp"), "missing_checklist": []}

    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(settings, "allow_server_ai_key_fallback", True)
    monkeypatch.setattr(settings, "groq_api_key", "server-groq-key")
    monkeypatch.setattr(items_api, "require_owned_item", owned_item)
    monkeypatch.setattr(items_api, "analyze_item_record", fake_analyze)
    monkeypatch.setattr(items_api, "execute_resumable_analysis", fake_execute)
    monkeypatch.setattr(items_api, "improve_listing_record", fake_improve)
    monkeypatch.setattr(items_api, "ai_service", object(), raising=False)

    await items_api.analyze_item(
        AnalyzeRequest(item_id="item-1"),
        uid="owner",
        ai_provider="groq",
    )
    await items_api.start_or_resume_analysis(
        "item-1",
        Response(),
        uid="owner",
        ai_provider="groq",
    )
    await items_api.improve_listing(
        items_api.ImproveListingRequest(
            action="make_title_more_searchable",
            listing=GeneratedListing(title="Lamp"),
        ),
        uid="owner",
        ai_provider="groq",
    )

    assert captured == {"analyze": "groq", "job": "groq", "improve": "groq"}


@pytest.mark.asyncio
async def test_invalid_provider_key_maps_to_safe_error():
    class InvalidAI:
        provider = "groq"

        async def improve_listing(self, *args, **kwargs):
            raise AIProviderCredentialInvalidError

    with pytest.raises(HTTPException) as exc_info:
        await improve_listing_record(
            items_api.ImproveListingRequest(
                action="make_title_more_searchable",
                listing=GeneratedListing(title="Lamp"),
            ),
            None,
            ai=InvalidAI(),
        )

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail["code"] == "AI_PROVIDER_CREDENTIAL_INVALID"
    assert exc_info.value.detail["provider"] == "groq"


def test_claude_is_a_supported_provider_with_its_own_server_key(monkeypatch):
    from app.services.ai_credentials import selected_provider

    monkeypatch.setattr(settings, "allow_server_ai_key_fallback", True)
    monkeypatch.setattr(settings, "anthropic_api_key", "server-claude")

    assert selected_provider(" Claude ") == "claude"
    resolved = resolve_ai_credential("claude")
    assert resolved.value == "server-claude"
    assert resolved.source == "server_fallback"
    assert resolve_ai_credential("claude", "user-claude").source == "byok"


def test_ai_service_uses_claude_client_for_claude_provider():
    from app.services.ai_service import AIService
    from app.services.claude_client import ClaudeClient

    service = AIService(provider="claude", api_key="user-claude")

    assert service.provider == "claude"
    assert isinstance(service._client, ClaudeClient)
    assert service._client._api_key == "user-claude"
