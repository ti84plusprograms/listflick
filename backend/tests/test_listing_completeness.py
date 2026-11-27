"""Multi-photo analysis, richer identification, questions and listing revision."""

import io
from unittest.mock import AsyncMock, MagicMock

import pytest
from PIL import Image

from app.prompts.listing import LISTING_SYSTEM_PROMPT, REVISION_USER_TEMPLATE
from app.prompts.vision import VISION_SYSTEM_PROMPT, VISION_USER_PROMPT
from app.schemas.gemini_outputs import GeminiDescriptionSections, GeminiListingOutput
from app.schemas.listing import GeneratedListing, ItemResponse, PriceSuggestion, VisionAnalysis
from app.services.ai_service import AIService
from app.services.analyze_service import analyze_item_record
from app.services.listing_checklist import build_missing_checklist
from app.services.listing_quality import calculate_listing_quality


def _image_bytes(shade: int = 128) -> bytes:
    image = Image.new("RGB", (640, 480))
    pixels = image.load()
    for x in range(640):
        for y in range(480):
            pixels[x, y] = ((x * 5 + y * 3) % 255, (x + y) % 255, shade)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture
def client():
    fake = MagicMock()
    fake.generate_json = AsyncMock()
    return fake


# ---------------------------------------------------------------------------
# Schema defaults and back-compat
# ---------------------------------------------------------------------------


def test_old_stored_analysis_and_listing_still_parse():
    old_analysis = '{"item_name": "Lamp", "brand": "Ikea", "condition": "good", "category": "Home", "confidence": 0.7}'
    old_listing = '{"title": "Ikea Lamp", "description": "x", "marketplace_category": "Home", "tags": []}'

    analysis = VisionAnalysis.model_validate_json(old_analysis)
    listing = GeneratedListing.model_validate_json(old_listing)

    assert analysis.model == "" and analysis.variant == "" and analysis.identified_from == ""
    assert analysis.identification_confidence == 0.0
    assert analysis.standard_specs == [] and analysis.seller_facts == []
    assert analysis.price_question is None and analysis.buyer_questions == []
    assert listing.price_question is None and listing.buyer_questions == []


def test_standard_specs_require_confident_identification():
    low = VisionAnalysis(identification_confidence=0.6, standard_specs=["6.1 inch display"])
    high = VisionAnalysis(identification_confidence=0.8, standard_specs=["6.1 inch display"])

    assert low.standard_specs == []
    assert high.standard_specs == ["6.1 inch display"]


def test_question_normalization_from_messy_model_output():
    analysis = VisionAnalysis.model_validate(
        {
            "model": "unknown",
            "identification_confidence": "0.9",
            "price_question": {"question": "  Which generation? ", "options": ["1st", "2nd", "2nd", "3rd", "4th", "5th"]},
            "buyer_questions": [
                {"question": "Which generation?"},
                "Does it power on?",
                {"question": "", "options": ["x"]},
                {"question": "Dimensions?", "options": "20 in, 24 in", "affects_price": "yes"},
                {"question": "Q4"},
                {"question": "Q5"},
            ],
        }
    )

    assert analysis.model == ""
    assert analysis.price_question is not None
    assert analysis.price_question.question == "Which generation?"
    assert analysis.price_question.options == ["1st", "2nd", "3rd", "4th"]
    questions = [q.question for q in analysis.buyer_questions]
    assert questions == ["Does it power on?", "Dimensions?", "Q4"]
    assert analysis.buyer_questions[1].options == ["20 in", "24 in"]
    assert analysis.buyer_questions[1].affects_price is True


@pytest.mark.parametrize("raw", [None, "null", "", "none", False, {"question": ""}, {"why": "x"}])
def test_empty_price_question_becomes_none(raw):
    assert VisionAnalysis.model_validate({"price_question": raw}).price_question is None


def test_item_response_exposes_questions():
    listing = GeneratedListing(
        title="t",
        price_question={"question": "Does it work?", "why": "Broken ones sell for parts.", "options": ["Yes", "No"]},
        buyer_questions=[{"question": "What size?", "options": [], "affects_price": False}],
    )
    payload = ItemResponse(
        id="i", image_url="/x", status="analyzed", listing=listing, created_at="2026-01-01T00:00:00", updated_at="2026-01-01T00:00:00"
    ).model_dump(mode="json")

    assert payload["listing"]["price_question"]["options"] == ["Yes", "No"]
    assert payload["listing"]["buyer_questions"][0]["question"] == "What size?"


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


def test_vision_prompt_describes_one_item_across_photos_and_questions():
    assert "ONE item" in VISION_SYSTEM_PROMPT
    assert "Image 1 is the cover photo" in VISION_SYSTEM_PROMPT
    for field in ("model", "variant", "identified_from", "identification_confidence", "standard_specs", "price_question", "buyer_questions"):
        assert f'"{field}"' in VISION_SYSTEM_PROMPT
    assert "25%" in VISION_SYSTEM_PROMPT
    assert "Never ask about anything the photos already show" in VISION_SYSTEM_PROMPT
    assert "Image 1 is the cover photo" in VISION_USER_PROMPT


def test_listing_prompts_carry_voice_title_and_priority_rules():
    for phrase in ("Max 80 characters", "No price", "Details:", "smoke-free home", "perfect for", "exclamation marks"):
        assert phrase.lower() in (LISTING_SYSTEM_PROMPT + REVISION_USER_TEMPLATE).lower()
    assert "seller answers and edits, then what the photos show, then standard specs" in LISTING_SYSTEM_PROMPT
    assert "Keep the seller's own sentences" in REVISION_USER_TEMPLATE


# ---------------------------------------------------------------------------
# AIService
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_analyze_images_sends_all_photos_in_one_call(client):
    client.generate_json.return_value = VisionAnalysis(
        item_name="Chair",
        condition="poor",
        visible_defects=["torn seat"],
        price_question={"question": "Does it recline — fully?", "why": "Broken “recline” lowers it.", "options": ["Yes"]},
        buyer_questions=[{"question": "What are the dimensions?", "options": []}],
    )
    service = AIService(client=client)
    photos = [b"one", b"two", b"three"]

    analysis = await service.analyze_images(photos)

    client.generate_json.assert_awaited_once()
    kwargs = client.generate_json.await_args.kwargs
    assert kwargs["images"] == photos
    assert kwargs["image_bytes"] == b"one"
    assert analysis.condition == "Needs Repair"
    assert analysis.price_question.question == "Does it recline, fully?"
    assert analysis.price_question.why == 'Broken "recline" lowers it.'


@pytest.mark.asyncio
async def test_analyze_image_bytes_keeps_single_photo_payload(client):
    client.generate_json.return_value = VisionAnalysis(item_name="Mug")
    service = AIService(client=client)

    await service.analyze_image_bytes(b"one")

    assert "images" not in client.generate_json.await_args.kwargs


@pytest.mark.asyncio
async def test_generate_listing_uses_identification_and_copies_questions(client):
    client.generate_json.return_value = GeminiListingOutput(
        title="Apple iPhone 13 128GB Blue!",
        description_sections=GeminiDescriptionSections(
            opening="Apple iPhone 13 in blue.",
            features=["128GB", "6.1 inch display", "Unlocked"],
            condition_details="Good. Light scratches on the back.",
        ),
        price_suggestion={"recommended_price": 340, "fast_sale_price": 300, "high_ask_price": 380},
    )
    service = AIService(client=client)
    analysis = VisionAnalysis(
        item_name="iPhone 13",
        brand="Apple",
        model="iPhone 13",
        variant="128GB Blue",
        identified_from="Model A2482 on the back",
        identification_confidence=0.9,
        standard_specs=["6.1 inch display"],
        condition="good",
        category="Electronics",
        confidence=0.9,
        seller_facts=["Is it unlocked? Yes"],
        price_question={"question": "How much storage?", "options": ["128GB", "256GB"]},
        buyer_questions=[{"question": "Battery health?", "affects_price": True}],
    )

    listing = await service.generate_listing(analysis)

    prompt = client.generate_json.await_args.kwargs["user_prompt"]
    assert "Model: iPhone 13" in prompt
    assert "Variant: 128GB Blue" in prompt
    assert "Identified from: Model A2482 on the back" in prompt
    assert "Standard specs for this model: 6.1 inch display" in prompt
    assert "Seller facts (highest priority): Is it unlocked? Yes" in prompt
    assert "How much storage? Options: 128GB, 256GB." in prompt
    assert listing.title == "Apple iPhone 13 128GB Blue"
    assert listing.price_question is not None and listing.price_question.question == "How much storage?"
    assert listing.buyer_questions[0].question == "Battery health?"
    assert "Details:\n- 128GB" in listing.description
    assert "$" not in listing.description


@pytest.mark.asyncio
async def test_revise_listing_reprices_and_keeps_seller_text(client):
    client.generate_json.return_value = GeminiListingOutput(
        title="Apple iPhone 13 256GB Blue",
        description="My phone — 256GB now.\n\n💵 Price: $420\n\nCondition: Good.",
        price_suggestion={"recommended_price": 420, "fast_sale_price": 380, "high_ask_price": 460, "confidence": 0.8},
    )
    service = AIService(client=client)
    listing = GeneratedListing(
        title="Apple iPhone 13",
        description="My phone.\n\nCondition: Good.",
        price_suggestion=PriceSuggestion(recommended_price=340, fast_sale_price=300, high_ask_price=380),
        price_question={"question": "How much storage?"},
    )
    analysis = VisionAnalysis(item_name="iPhone 13", brand="Apple", category="Electronics", condition="good", confidence=0.9)

    revised = await service.revise_listing(listing, analysis=analysis, new_facts=["How much storage? 256GB"], reprice=True)

    prompt = client.generate_json.await_args.kwargs["user_prompt"]
    assert "- How much storage? 256GB" in prompt
    assert "Re-price: Yes" in prompt
    assert revised.price_suggestion.recommended_price == 420
    assert revised.description == "My phone, 256GB now.\n\nCondition: Good."
    assert revised.title == "Apple iPhone 13 256GB Blue"
    assert revised.price_question is not None  # the caller decides which questions to clear


@pytest.mark.asyncio
async def test_revise_listing_without_reprice_keeps_price(client):
    client.generate_json.return_value = GeminiListingOutput(
        title="",
        description="",
        price_suggestion={"recommended_price": 999},
    )
    service = AIService(client=client)
    listing = GeneratedListing(
        title="Desk",
        description="Oak desk.\n\nCondition: Good.",
        price_suggestion=PriceSuggestion(recommended_price=60),
    )

    revised = await service.revise_listing(listing, analysis=None, new_facts=["Dimensions? 48 x 24 in"], reprice=False)

    assert "Re-price: No" in client.generate_json.await_args.kwargs["user_prompt"]
    assert revised.price_suggestion.recommended_price == 60
    assert revised.description == listing.description
    assert revised.title == "Desk"


# ---------------------------------------------------------------------------
# analyze_item_record uses every photo
# ---------------------------------------------------------------------------


class MultiPhotoAI:
    def __init__(self):
        self.images = None
        self.single_calls = 0

    async def analyze_images(self, images):
        self.images = images
        return VisionAnalysis(
            item_name="Desk Lamp",
            category="Home",
            condition="Good",
            confidence=0.9,
            buyer_questions=[{"question": "Does it turn on?", "options": ["Yes", "No"], "affects_price": True}],
        )

    async def analyze_image_bytes(self, image_bytes):
        self.single_calls += 1
        return VisionAnalysis(item_name="Desk Lamp", category="Home", condition="Good", confidence=0.9)

    async def generate_listing(self, analysis):
        return GeneratedListing(
            title="Desk Lamp",
            description="Desk lamp.",
            marketplace_category="Home",
            price_suggestion=PriceSuggestion(min=10, max=20, recommended_price=15),
            buyer_questions=analysis.buyer_questions,
        )


@pytest.mark.asyncio
async def test_analyze_item_record_sends_every_photo(tmp_path):
    paths = []
    for index in range(3):
        path = tmp_path / f"item-{index}.jpg"
        path.write_bytes(_image_bytes(40 * index + 40))
        paths.append(str(path))
    import json

    ai = MultiPhotoAI()
    update_analysis = AsyncMock()
    response = await analyze_item_record(
        {"id": "item-1", "user_id": "legacy", "image_path": paths[0], "image_paths_json": json.dumps(paths)},
        ai=ai,
        update_analysis=update_analysis,
    )

    assert ai.images is not None and len(ai.images) == 3
    assert ai.single_calls == 0
    assert response.image_quality.get("original_size") == "640x480"  # cover photo quality metrics still computed
    assert len(response.image_quality_feedback) == 3
    assert response.listing.buyer_questions[0].question == "Does it turn on?"
    persisted_listing = update_analysis.await_args.args[2]
    assert persisted_listing["buyer_questions"][0]["question"] == "Does it turn on?"
    assert any(item.key == "buyer_question_1" for item in response.missing_checklist)


# ---------------------------------------------------------------------------
# Checklist and quality treat open questions as missing info
# ---------------------------------------------------------------------------


def test_checklist_lists_open_questions_first():
    listing = GeneratedListing(
        title="Lamp",
        price_question={"question": "Does it work?", "why": "Broken ones sell for parts."},
        buyer_questions=[{"question": "How tall is it?"}],
    )
    checklist = build_missing_checklist(VisionAnalysis(item_name="Lamp"), listing)

    assert checklist[0].key == "price_question"
    assert checklist[0].status == "missing"
    assert checklist[0].suggested_question == "Does it work?"
    assert checklist[0].reason == "Broken ones sell for parts."
    assert checklist[1].key == "buyer_question_1"
    assert checklist[1].suggested_question == "How tall is it?"


def test_open_price_question_lowers_pricing_score():
    base = GeneratedListing(
        title="Lamp",
        price_suggestion=PriceSuggestion(min=10, max=10, recommended_price=10, confidence=0.9),
    )
    asked = GeneratedListing.model_validate({**base.model_dump(), "price_question": {"question": "Does it work?"}})

    before = calculate_listing_quality(None, base).score_breakdown["pricing"]
    after = calculate_listing_quality(None, asked)

    assert after.score_breakdown["pricing"] == before - 4
    assert any("price question" in suggestion for suggestion in after.improvement_suggestions)
