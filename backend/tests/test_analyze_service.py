import io
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from PIL import Image

from app.api import items as items_api
from app.config import settings
from app.schemas.listing import AnalyzeRequest, AnalyzeResponse, GeneratedListing, PriceSuggestion, VisionAnalysis
from app.services.analyze_service import analyze_item_record
from app.services.gemini_client import GeminiClientError


def _image_bytes() -> bytes:
    image = Image.new("RGB", (800, 600))
    pixels = image.load()
    for x in range(800):
        for y in range(600):
            pixels[x, y] = ((x * 5 + y * 3) % 255, (x + y) % 255, 128)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


class RecordingAI:
    async def analyze_image_bytes(self, image_bytes):
        return VisionAnalysis(item_name="Desk Lamp", category="Home", condition="Good", confidence=0.9)

    async def generate_listing(self, analysis):
        return GeneratedListing(
            title="Desk Lamp",
            description="Clean desk lamp.",
            marketplace_category="Home",
            price_suggestion=PriceSuggestion(min=10, max=20, recommended_price=15),
        )


def _use_route_ai(monkeypatch, ai, provider: str = "groq") -> None:
    monkeypatch.setattr(
        items_api,
        "ensure_ai_provider_configured",
        lambda *_args: (ai, SimpleNamespace(provider=provider, source="server_fallback")),
    )


@pytest.mark.asyncio
async def test_analyze_item_record_orchestrates_and_persists(tmp_path):
    image_path = tmp_path / "item.jpg"
    image_path.write_bytes(_image_bytes())
    update_analysis = AsyncMock()

    response = await analyze_item_record(
        {"id": "item-1", "user_id": "legacy", "image_path": str(image_path)},
        ai=RecordingAI(),
        update_analysis=update_analysis,
    )

    assert response.item_id == "item-1"
    assert response.analysis.item_name == "Desk Lamp"
    assert response.listing.listing_quality.overall_score >= 0
    assert response.image_quality_feedback[0].image_id == "item-1:0"
    update_analysis.assert_awaited_once()


@pytest.mark.asyncio
async def test_analyze_item_record_maps_provider_failure(tmp_path):
    image_path = tmp_path / "item.jpg"
    image_path.write_bytes(_image_bytes())
    ai = RecordingAI()
    ai.analyze_image_bytes = AsyncMock(side_effect=GeminiClientError("provider detail"))

    with pytest.raises(HTTPException) as exc_info:
        await analyze_item_record(
            {"id": "item-1", "image_path": str(image_path)},
            ai=ai,
            update_analysis=AsyncMock(),
        )

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Could not generate listing right now"


@pytest.mark.asyncio
async def test_analyze_route_uses_groq_without_gemini_configuration(monkeypatch):
    item = {"id": "item-1", "image_path": "/tmp/item.jpg"}
    expected = AnalyzeResponse(
        item_id="item-1",
        analysis=VisionAnalysis(item_name="Desk Lamp"),
        listing=GeneratedListing(title="Desk Lamp"),
    )
    analyze = AsyncMock(return_value=expected)
    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "groq-test-key")
    monkeypatch.setattr(settings, "gemini_api_key", "")
    monkeypatch.setattr(items_api, "get_item", AsyncMock(return_value=item))
    monkeypatch.setattr(items_api, "analyze_item_record", analyze)
    service = RecordingAI()
    _use_route_ai(monkeypatch, service)

    response = await items_api.analyze_item(AnalyzeRequest(item_id="item-1"))

    assert response is expected
    analyze.assert_awaited_once_with(
        item,
        ai=service,
        storage=items_api.storage_service,
        update_analysis=items_api.update_item_analysis,
    )


@pytest.mark.asyncio
async def test_analyze_route_fails_if_gemini_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", "")

    with pytest.raises(items_api.HTTPException) as exc_info:
        await items_api.analyze_item(AnalyzeRequest(item_id="item-1"))
    
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "AI_CREDENTIAL_REQUIRED"


@pytest.mark.asyncio
async def test_analyze_route_fails_if_groq_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "")

    with pytest.raises(items_api.HTTPException) as exc_info:
        await items_api.analyze_item(AnalyzeRequest(item_id="item-1"))
    
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "AI_CREDENTIAL_REQUIRED"
