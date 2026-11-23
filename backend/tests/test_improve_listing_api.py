import json
from types import SimpleNamespace

import pytest

from app.api import items as items_api
from app.config import settings
from app.models import database
from app.schemas.listing import GeneratedListing, PriceSuggestion, VisionAnalysis


def _analysis() -> VisionAnalysis:
    return VisionAnalysis(
        item_name="Power Bank",
        brand="Spigen",
        condition="good",
        category="Electronics",
        confidence=0.8,
        visible_defects=["light surface wear"],
    )


def _listing(title: str = "Power Bank") -> GeneratedListing:
    return GeneratedListing(
        title=title,
        description="Portable charger for sale.",
        marketplace_category="Electronics",
        tags=["charger"],
        price_suggestion=PriceSuggestion(min=20, max=35, recommended_price=25),
    )


class ImprovingAIService:
    def __init__(self):
        self.calls = []

    async def improve_listing(self, listing, *, action, custom_instruction="", analysis=None):
        self.calls.append(
            {
                "listing": listing,
                "action": action,
                "custom_instruction": custom_instruction,
                "analysis": analysis,
            }
        )
        return listing.model_copy(update={"title": "Spigen Power Bank Portable Charger"})


def _use_route_ai(monkeypatch, ai, provider: str) -> None:
    monkeypatch.setattr(
        items_api,
        "ensure_ai_provider_configured",
        lambda *_args: (ai, SimpleNamespace(provider=provider, source="server_fallback")),
    )


@pytest.mark.asyncio
async def test_improve_listing_uses_saved_item_without_overwriting(monkeypatch, temp_db):
    service = ImprovingAIService()
    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    _use_route_ai(monkeypatch, service, "gemini")

    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(item["id"], _analysis().model_dump(), _listing().model_dump(), status="saved")

    response = await items_api.improve_listing(
        items_api.ImproveListingRequest(
            item_id=item["id"],
            action="make_title_more_searchable",
            custom_instruction="Keep the brand first.",
        )
    )
    saved_item = await database.get_item(item["id"])

    assert response.listing.title == "Spigen Power Bank Portable Charger"
    assert service.calls[0]["analysis"].brand == "Spigen"
    assert service.calls[0]["custom_instruction"] == "Keep the brand first."
    assert saved_item is not None
    assert json.loads(saved_item["listing_json"])["title"] == "Power Bank"


@pytest.mark.asyncio
async def test_improve_listing_accepts_unsaved_listing_payload_with_groq_only(monkeypatch):
    service = ImprovingAIService()
    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "groq-test-key")
    monkeypatch.setattr(settings, "gemini_api_key", "")
    _use_route_ai(monkeypatch, service, "groq")

    response = await items_api.improve_listing(
        items_api.ImproveListingRequest(
            listing=_listing("Current Draft"),
            action="make_description_more_professional",
        )
    )

    assert response.item_id is None
    assert response.listing.title == "Spigen Power Bank Portable Charger"
    assert service.calls[0]["listing"].title == "Current Draft"


@pytest.mark.asyncio
async def test_improve_listing_fails_if_gemini_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", "")

    with pytest.raises(items_api.HTTPException) as exc_info:
        await items_api.improve_listing(
            items_api.ImproveListingRequest(action="make_title_more_searchable")
        )
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "AI_CREDENTIAL_REQUIRED"
    assert exc_info.value.detail["provider"] == "gemini"


@pytest.mark.asyncio
async def test_improve_listing_fails_if_groq_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "")

    with pytest.raises(items_api.HTTPException) as exc_info:
        await items_api.improve_listing(
            items_api.ImproveListingRequest(action="make_title_more_searchable")
        )
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "AI_CREDENTIAL_REQUIRED"
    assert exc_info.value.detail["provider"] == "groq"
