import json

import pytest

from app.api import items as items_api
from app.models import database
from app.schemas.listing import GeneratedListing, PriceSuggestion, VisionAnalysis
from app.services.listing_checklist import build_missing_checklist


def _analysis(**overrides) -> VisionAnalysis:
    data = {
        "item_name": "Office Chair",
        "brand": "unknown",
        "condition": "good",
        "category": "Furniture",
        "confidence": 0.82,
        "detected_attributes": ["color: black", "material: mesh"],
        "visible_defects": ["minor scuff on leg"],
    }
    data.update(overrides)
    return VisionAnalysis(**data)


def _listing(**overrides) -> GeneratedListing:
    data = {
        "title": "Black Mesh Office Chair",
        "description": (
            "Black mesh office chair.\n\n"
            "Includes chair only.\n\n"
            "Pickup in Queens. Cash preferred."
        ),
        "marketplace_category": "Furniture",
        "tags": ["chair", "office"],
        "price_suggestion": PriceSuggestion(min=40, max=65),
    }
    data.update(overrides)
    return GeneratedListing(**data)


def _by_key(items):
    return {item.key: item for item in items}


def test_build_missing_checklist_marks_ai_details_uncertain_not_complete():
    checklist = _by_key(build_missing_checklist(_analysis(brand="Herman Miller"), _listing()))

    assert checklist["brand"].status == "uncertain"
    assert checklist["condition"].status == "uncertain"
    assert checklist["category"].status == "uncertain"
    assert checklist["color"].status == "uncertain"
    assert checklist["material"].status == "uncertain"
    assert checklist["flaws"].status == "uncertain"
    assert checklist["included_accessories"].status == "uncertain"
    assert checklist["pickup_shipping"].status == "complete"
    assert checklist["price_confidence"].status == "uncertain"


def test_build_missing_checklist_flags_absent_buyer_fields():
    checklist = _by_key(
        build_missing_checklist(
            _analysis(condition="", category="", detected_attributes=[], visible_defects=[]),
            _listing(
                description="Nice chair.",
                marketplace_category="",
                price_suggestion=PriceSuggestion(min=0, max=0),
            ),
        )
    )

    assert checklist["brand"].status == "missing"
    assert checklist["dimensions"].status == "missing"
    assert checklist["condition"].status == "missing"
    assert checklist["pickup_shipping"].status == "missing"
    assert checklist["price_confidence"].status == "missing"
    assert checklist["pickup_shipping"].suggested_question


def test_build_missing_checklist_recognizes_single_digit_model_names():
    checklist = _by_key(
        build_missing_checklist(
            _analysis(brand="Canon", item_name="Canon AE-1 camera"),
            _listing(title="Vintage Canon AE-1 35mm Film Camera"),
        )
    )

    assert checklist["model"].status == "uncertain"


@pytest.mark.asyncio
async def test_save_and_get_item_return_updated_checklist(monkeypatch, temp_db):
    class DisabledNotionService:
        is_configured = False

    monkeypatch.setattr(items_api, "notion_service", DisabledNotionService())
    item = await database.create_item("/tmp/photo.jpg")
    await database.update_item_analysis(item["id"], _analysis().model_dump(), _listing().model_dump())

    save_response = await items_api.save_item_listing(
        item["id"],
        items_api.SaveListingRequest(
            title="Black Mesh Office Chair",
            description="Black mesh office chair. Porch pickup in Queens.",
            category="Furniture",
            condition="Good",
            asking_price=50,
        ),
    )
    saved_item = await database.get_item(item["id"])
    item_response = await items_api.get_item_by_id(item["id"])

    save_checklist = _by_key(save_response.missing_checklist)
    item_checklist = _by_key(item_response.missing_checklist)

    assert save_checklist["pickup_shipping"].status == "complete"
    assert save_checklist["category"].status == "complete"
    assert save_checklist["condition"].status == "complete"
    assert save_checklist["price_confidence"].status == "complete"
    assert item_checklist["category"].status == "complete"
    assert item_checklist["price_confidence"].status == "complete"
    assert saved_item is not None
    saved_price = json.loads(saved_item["listing_json"])["price_suggestion"]
    assert saved_price["min"] == 50.0
    assert saved_price["max"] == 50.0
    assert saved_price["fast_sale_price"] == 50.0
    assert saved_price["recommended_price"] == 50.0
    assert saved_price["high_ask_price"] == 50.0
    assert saved_price["confidence"] == 1.0
