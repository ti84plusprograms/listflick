import pytest

from app.api import items as items_api
from app.models import database
from app.schemas.listing import GeneratedListing, ImageQualityFeedback, PriceSuggestion, VisionAnalysis
from app.services.listing_checklist import build_missing_checklist
from app.services.listing_quality import QUALITY_WEIGHTS, calculate_listing_quality


def _analysis(**overrides) -> VisionAnalysis:
    data = {
        "item_name": "Office Chair",
        "brand": "Herman Miller",
        "condition": "Good",
        "category": "Furniture",
        "confidence": 0.86,
        "detected_attributes": ["color: black", "material: mesh", "model Aeron"],
        "visible_defects": ["minor scuff on base"],
    }
    data.update(overrides)
    return VisionAnalysis(**data)


def _listing(**overrides) -> GeneratedListing:
    data = {
        "title": "Herman Miller Aeron Office Chair Size B",
        "description": (
            "Herman Miller Aeron office chair in good used condition. Black mesh, size B, "
            "with light scuffing on the base. Includes chair only. Porch pickup in Queens."
        ),
        "marketplace_category": "Furniture",
        "tags": ["chair", "office", "aeron"],
        "price_suggestion": PriceSuggestion(
            min=325,
            max=325,
            fast_sale_price=300,
            recommended_price=325,
            high_ask_price=375,
            confidence=0.9,
        ),
    }
    data.update(overrides)
    return GeneratedListing(**data)


def _good_photo() -> ImageQualityFeedback:
    return ImageQualityFeedback(image_id="item:0", image_index=0, overall_status="good")


def test_listing_quality_scores_ready_listing_high():
    analysis = _analysis()
    listing = _listing()
    checklist = build_missing_checklist(analysis, listing, confirmed_keys={"category", "condition"})

    quality = calculate_listing_quality(
        analysis,
        listing,
        missing_checklist=checklist,
        image_quality_feedback=[_good_photo()],
    )

    assert sum(QUALITY_WEIGHTS.values()) == 100
    assert quality.overall_score >= 82
    assert quality.readiness_label == "ready"
    assert quality.score_breakdown["title"] > 0
    assert len(quality.improvement_suggestions) <= 4


def test_listing_quality_scores_incomplete_listing_low():
    analysis = _analysis(brand="unknown", condition="", category="", detected_attributes=[], visible_defects=[])
    listing = _listing(
        title="Item",
        description="Maybe nice item.",
        marketplace_category="",
        tags=[],
        price_suggestion=PriceSuggestion(min=0, max=0),
    )
    checklist = build_missing_checklist(analysis, listing)

    quality = calculate_listing_quality(
        analysis,
        listing,
        missing_checklist=checklist,
        image_quality_feedback=[
            ImageQualityFeedback(image_id="item:0", image_index=0, overall_status="poor")
        ],
    )

    assert quality.overall_score < 50
    assert quality.readiness_label == "needs_work"
    assert any("specific title" in suggestion for suggestion in quality.improvement_suggestions)


@pytest.mark.asyncio
async def test_old_saved_listing_without_quality_gets_compatible_score(temp_db):
    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(
        item["id"],
        _analysis().model_dump(),
        _listing().model_dump(exclude={"listing_quality"}),
        status="saved",
    )

    response = await items_api.get_item_by_id(item["id"])

    assert response.listing is not None
    assert response.listing.listing_quality.overall_score > 0
    assert response.listing.listing_quality.readiness_label in {"almost_ready", "ready"}
