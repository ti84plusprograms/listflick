import base64
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.gemini_outputs import GeminiDescriptionSections, GeminiListingOutput
from app.schemas.listing import GeneratedListing, PriceSuggestion, VisionAnalysis
from app.services.ai_service import AIService


def _fake_jpeg_bytes() -> bytes:
    # Minimal valid-enough payload for base64 path; image quality tests are separate.
    return b"\xff\xd8\xff\xd9"


@pytest.fixture
def mock_gemini_client():
    client = MagicMock()
    client.generate_json = AsyncMock()
    return client


@pytest.mark.asyncio
async def test_analyze_image_maps_to_frontend_shape(mock_gemini_client):
    mock_gemini_client.generate_json.return_value = VisionAnalysis(
        item_name="Office Chair",
        brand="unknown",
        category="Furniture",
        condition="good",
        visible_defects=["minor scuff"],
        confidence=0.82,
        suggested_price_min=40,
        suggested_price_max=75,
    )
    service = AIService(client=mock_gemini_client)

    data_url = f"data:image/jpeg;base64,{base64.b64encode(_fake_jpeg_bytes()).decode()}"
    analysis = await service.analyze_image(data_url)

    assert isinstance(analysis, VisionAnalysis)
    assert analysis.item_name == "Office Chair"
    assert analysis.brand == ""
    assert analysis.category == "Furniture"
    assert analysis.suggested_price_min == 40
    assert analysis.suggested_price_max == 75


@pytest.mark.asyncio
async def test_analyze_image_normalizes_poor_with_damage_to_needs_repair(mock_gemini_client):
    mock_gemini_client.generate_json.return_value = VisionAnalysis(
        item_name="Patio Umbrella",
        category="Outdoor",
        condition="poor",
        visible_defects=["torn canopy", "damaged tip"],
        confidence=0.76,
    )
    service = AIService(client=mock_gemini_client)

    data_url = f"data:image/jpeg;base64,{base64.b64encode(_fake_jpeg_bytes()).decode()}"
    analysis = await service.analyze_image(data_url)

    assert analysis.condition == "Needs Repair"


@pytest.mark.asyncio
async def test_analyze_image_normalizes_generic_poor_to_fair(mock_gemini_client):
    mock_gemini_client.generate_json.return_value = VisionAnalysis(
        item_name="Side Table",
        category="Furniture",
        condition="poor",
        visible_defects=["visible wear"],
        confidence=0.7,
    )
    service = AIService(client=mock_gemini_client)

    data_url = f"data:image/jpeg;base64,{base64.b64encode(_fake_jpeg_bytes()).decode()}"
    analysis = await service.analyze_image(data_url)

    assert analysis.condition == "Fair"


@pytest.mark.asyncio
async def test_generate_listing_preserves_api_contract(mock_gemini_client):
    mock_gemini_client.generate_json.side_effect = [
        VisionAnalysis(
            item_name="Desk",
            brand="unknown",
            category="Furniture",
            condition="fair",
            confidence=0.7,
            suggested_price_min=50,
            suggested_price_max=90,
        ),
        GeminiListingOutput(
            title="Wooden Desk - Fair Condition",
            description="Sturdy desk. Some wear on surface.",
            tags=["desk", "furniture"],
            marketplace_category="Furniture",
            price_suggestion={
                "min": 55,
                "max": 85,
                "fast_sale_price": 55,
                "recommended_price": 70,
                "high_ask_price": 85,
                "confidence": 0.78,
                "pricing_reason": "Comparable used desks in fair condition.",
            },
        ),
    ]
    service = AIService(client=mock_gemini_client)
    data_url = f"data:image/jpeg;base64,{base64.b64encode(_fake_jpeg_bytes()).decode()}"
    analysis = await service.analyze_image(data_url)
    listing = await service.generate_listing(analysis)

    assert listing.title.startswith("Wooden")
    assert listing.marketplace_category == "Furniture"
    assert listing.price_suggestion.min == 55
    assert listing.price_suggestion.max == 85
    assert listing.price_suggestion.fast_sale_price == 55
    assert listing.price_suggestion.recommended_price == 70
    assert listing.price_suggestion.high_ask_price == 85
    assert listing.price_suggestion.confidence == 0.78
    assert isinstance(listing.tags, list)


@pytest.mark.asyncio
async def test_generate_listing_lowers_pricing_confidence_when_key_fields_missing(mock_gemini_client):
    mock_gemini_client.generate_json.return_value = GeminiListingOutput(
        title="Item",
        description="Item for sale.",
        tags=[],
        marketplace_category="",
        price_suggestion={
            "fast_sale_price": 10,
            "recommended_price": 15,
            "high_ask_price": 20,
            "confidence": 0.9,
            "pricing_reason": "Estimated from broad category.",
        },
    )
    service = AIService(client=mock_gemini_client)

    listing = await service.generate_listing(
        VisionAnalysis(
            item_name="unknown",
            brand="unknown",
            condition="unknown",
            category="unknown",
            confidence=0.4,
        )
    )

    assert listing.price_suggestion.confidence <= 0.45
    assert "Item name is unclear." in listing.price_suggestion.pricing_warnings
    assert "Condition is unclear." in listing.price_suggestion.pricing_warnings


@pytest.mark.asyncio
async def test_generate_listing_prompt_requests_structured_complete_description(mock_gemini_client):
    mock_gemini_client.generate_json.return_value = GeminiListingOutput(
        title="Nautica Gray Puffer Jacket",
        description=(
            "Nautica hooded puffer jacket for [user input pending].\n\n"
            "Gray exterior with [user input pending] texture.\n\n"
            "Like new condition with no visible defects.\n\n"
            "Suggested price: $25-$35."
        ),
        tags=["jacket", "nautica"],
        marketplace_category="Clothing & Shoes",
        price_suggestion={"min": 25, "max": 35},
    )
    service = AIService(client=mock_gemini_client)
    service._last_price_hints = (25.0, 35.0)

    await service.generate_listing(
        VisionAnalysis(
            item_name="Puffer Jacket",
            brand="Nautica",
            condition="like new",
            category="Clothing",
            confidence=0.8,
            detected_attributes=["color: gray"],
            visible_defects=[],
        )
    )

    call = mock_gemini_client.generate_json.await_args.kwargs
    assert "description_sections" in call["system_instruction"]
    assert "distinct, buyer-relevant facts" in call["system_instruction"]
    assert "Do not repeat the same fact" in call["system_instruction"]
    assert "Do not invent brand, model" in call["system_instruction"]
    assert "fast_sale_price" in call["system_instruction"]
    assert "recommended_price" in call["system_instruction"]
    assert "pricing confidence" in call["system_instruction"]
    assert "leave the legacy description field empty" in call["user_prompt"]
    assert "Seller style:" in call["user_prompt"]


@pytest.mark.asyncio
async def test_generate_listing_renders_structured_description_once(mock_gemini_client):
    mock_gemini_client.generate_json.return_value = GeminiListingOutput(
        title="Gray Desk",
        description="Should not be used when structured sections exist.",
        description_sections=GeminiDescriptionSections(
            opening="Selling a gray desk.",
            features=["Gray finish", "Gray finish", "Compact footprint"],
            condition_details="Good condition with minor surface wear.",
            pickup_details=["Location: [Insert City/Neighborhood]", "Payment: [Insert Payment Methods]"],
        ),
        price_suggestion={"recommended_price": 35, "min": 30, "max": 40},
    )
    service = AIService(client=mock_gemini_client)

    listing = await service.generate_listing(
        VisionAnalysis(item_name="Desk", category="Furniture", condition="good", confidence=0.8)
    )

    assert listing.description.count("Gray finish") == 1
    assert listing.description.count("Selling a gray desk.") == 1
    assert "💵 Price: $35" in listing.description
    assert "Should not be used" not in listing.description


@pytest.mark.asyncio
async def test_generate_listing_prompt_keeps_condition_and_audience_out_of_title(mock_gemini_client):
    mock_gemini_client.generate_json.return_value = GeminiListingOutput(
        title="Georgia Tech Buzz Mascot Bobblehead",
        description="Georgia Tech Buzz mascot bobblehead.",
        tags=["georgia tech", "bobblehead"],
        marketplace_category="Collectibles",
        price_suggestion={"min": 10, "max": 20},
    )
    service = AIService(client=mock_gemini_client)

    await service.generate_listing(
        VisionAnalysis(
            item_name="Georgia Tech Buzz Mascot Bobblehead",
            brand="Georgia Tech",
            condition="like new",
            category="Collectibles",
            confidence=0.8,
        )
    )

    instruction = mock_gemini_client.generate_json.await_args.kwargs["system_instruction"]
    assert "Do NOT include condition words in the title" in instruction
    assert "Do NOT add buyer/audience filler" in instruction
    user_prompt = mock_gemini_client.generate_json.await_args.kwargs["user_prompt"]
    assert "Item: Georgia Tech Buzz Mascot Bobblehead" in user_prompt


@pytest.mark.asyncio
async def test_listing_falls_back_to_vision_prices(mock_gemini_client):
    mock_gemini_client.generate_json.side_effect = [
        VisionAnalysis(
            item_name="Mug",
            suggested_price_min=5,
            suggested_price_max=12,
            confidence=0.5,
        ),
        GeminiListingOutput(
            title="Coffee Mug",
            description="Ceramic mug.",
            tags=[],
            price_suggestion={},
        ),
    ]
    service = AIService(client=mock_gemini_client)
    data_url = f"data:image/jpeg;base64,{base64.b64encode(_fake_jpeg_bytes()).decode()}"
    analysis = await service.analyze_image(data_url)
    listing = await service.generate_listing(analysis)

    assert listing.price_suggestion.min == 5
    assert listing.price_suggestion.max == 12


@pytest.mark.asyncio
async def test_improve_listing_uses_existing_listing_and_safety_rules(mock_gemini_client):
    mock_gemini_client.generate_json.return_value = GeminiListingOutput(
        title="Spigen Power Bank Portable Charger",
        description="Shorter marketplace-ready description.",
        tags=["power bank"],
        marketplace_category="Electronics",
        price_suggestion={
            "min": 20,
            "max": 30,
            "fast_sale_price": 20,
            "recommended_price": 25,
            "high_ask_price": 30,
            "confidence": 0.7,
            "pricing_reason": "Adjusted from existing listing context.",
        },
    )
    service = AIService(client=mock_gemini_client)
    listing = GeneratedListing(
        title="Power Bank",
        description="Long listing description.",
        marketplace_category="Electronics",
        tags=["charger"],
        price_suggestion=PriceSuggestion(min=25, max=35, recommended_price=30),
    )

    improved = await service.improve_listing(
        listing,
        action="make_description_shorter",
        custom_instruction="Keep it direct.",
        analysis=VisionAnalysis(item_name="Power Bank", brand="Spigen", condition="good", category="Electronics"),
    )

    call = mock_gemini_client.generate_json.await_args.kwargs
    assert improved.title == "Spigen Power Bank Portable Charger"
    assert improved.price_suggestion.recommended_price == 25
    assert "make_description_shorter" in call["user_prompt"]
    assert "Keep it direct." in call["user_prompt"]
    assert "Do not invent brand, model, size, flaws, condition details" in call["user_prompt"]
    assert '"title":"Power Bank"' in call["user_prompt"]


def test_price_suggestion_accepts_legacy_min_max():
    price = PriceSuggestion(min=20, max=40)

    assert price.min == 20
    assert price.max == 40


@pytest.mark.asyncio
async def test_malformed_json_retries_via_client(mock_gemini_client):
    """Client handles retries; service propagates final validated output."""
    mock_gemini_client.generate_json.return_value = VisionAnalysis(item_name="Box")
    service = AIService(client=mock_gemini_client)
    data_url = f"data:image/jpeg;base64,{base64.b64encode(_fake_jpeg_bytes()).decode()}"
    await service.analyze_image(data_url)
    assert mock_gemini_client.generate_json.await_count == 1
