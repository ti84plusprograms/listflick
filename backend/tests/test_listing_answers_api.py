"""POST /api/items/{item_id}/answers: seller answers and edits re-price and revise the listing."""

import json
from types import SimpleNamespace

import pytest

from app.api import items as items_api
from app.models import database
from app.schemas.listing import (
    GeneratedListing,
    ListingAnswer,
    ListingAnswersRequest,
    ListingChanges,
    PriceSuggestion,
    VisionAnalysis,
)
from app.services.analyze_service import active_price_after_reprice, merge_seller_facts
from app.services.gemini_client import GeminiClientError

PRICE_QUESTION = {
    "question": "How much storage does it have?",
    "why": "256GB sells for about $80 more than 128GB.",
    "options": ["128GB", "256GB", "512GB"],
}
BUYER_QUESTIONS = [
    {"question": "What is the battery health?", "options": ["90% or higher", "80-89%", "Below 80%"], "affects_price": True},
    {"question": "Is it unlocked?", "options": ["Unlocked", "Carrier locked"], "affects_price": False},
]


def _analysis() -> VisionAnalysis:
    return VisionAnalysis(
        item_name="iPhone 13",
        brand="Apple",
        model="iPhone 13",
        variant="Blue",
        identified_from="Apple logo and camera layout",
        identification_confidence=0.85,
        standard_specs=["6.1 inch display", "A15 Bionic chip"],
        condition="good",
        category="Electronics",
        confidence=0.85,
        visible_defects=["light scratches on back"],
        price_question=PRICE_QUESTION,
        buyer_questions=BUYER_QUESTIONS,
    )


def _listing() -> GeneratedListing:
    return GeneratedListing(
        title="Apple iPhone 13 Blue",
        description="Apple iPhone 13 in blue.\n\nCondition: Good. Light scratches on the back.",
        marketplace_category="Electronics",
        tags=["iphone"],
        price_suggestion=PriceSuggestion(
            min=300, max=380, fast_sale_price=300, recommended_price=340, high_ask_price=380, confidence=0.6
        ),
        price_question=PRICE_QUESTION,
        buyer_questions=BUYER_QUESTIONS,
    )


class RevisingAI:
    provider = "gemini"

    def __init__(self, *, error: Exception | None = None):
        self.calls = []
        self.error = error

    async def revise_listing(self, listing, *, analysis, new_facts, reprice):
        self.calls.append({"listing": listing, "analysis": analysis, "new_facts": new_facts, "reprice": reprice})
        if self.error:
            raise self.error
        price = listing.price_suggestion
        if reprice:
            price = PriceSuggestion(
                min=380, max=460, fast_sale_price=380, recommended_price=420, high_ask_price=460, confidence=0.8
            )
        return listing.model_copy(
            update={
                "title": "Apple iPhone 13 256GB Blue",
                "description": "Apple iPhone 13 in blue, 256GB.\n\nCondition: Good. Light scratches on the back.",
                "price_suggestion": price,
            }
        )


def _use_route_ai(monkeypatch, ai) -> list:
    calls = []

    def fake_configured(*args):
        calls.append(args)
        return ai, SimpleNamespace(provider="gemini", source="byok")

    monkeypatch.setattr(items_api, "ensure_ai_provider_configured", fake_configured)
    return calls


async def _saved_item(status: str = "analyzed") -> dict:
    item = await database.create_item("/tmp/missing-photo.jpg")
    await database.update_item_analysis(item["id"], _analysis().model_dump(), _listing().model_dump(), status=status)
    return item


async def _stored(item_id: str) -> tuple[VisionAnalysis, GeneratedListing, dict]:
    record = await database.get_item(item_id)
    assert record is not None
    return (
        VisionAnalysis.model_validate_json(record["analysis_json"]),
        GeneratedListing.model_validate_json(record["listing_json"]),
        record,
    )


@pytest.mark.asyncio
async def test_price_answer_reprices_keeps_tier_and_clears_answered_question(monkeypatch, temp_db):
    ai = RevisingAI()
    _use_route_ai(monkeypatch, ai)
    item = await _saved_item()

    response = await items_api.answer_listing_questions(
        item["id"],
        ListingAnswersRequest(
            answers=[ListingAnswer(question="How much storage does it have?", answer="256GB")],
            active_price=300,
            active_price_source="ai_fast_sale",
        ),
    )

    assert ai.calls[0]["reprice"] is True
    assert ai.calls[0]["new_facts"] == ["How much storage does it have? 256GB"]
    assert response.repriced is True
    assert response.active_price == 380  # new fast-sale tier, because the seller picked that tier
    assert response.active_price_source == "ai_fast_sale"
    assert response.listing.price_suggestion.recommended_price == 420
    assert response.listing.price_question is None
    assert [q.question for q in response.listing.buyer_questions] == [q["question"] for q in BUYER_QUESTIONS]
    assert response.listing.title == "Apple iPhone 13 256GB Blue"

    analysis, listing, record = await _stored(item["id"])
    assert listing.price_question is None
    assert len(listing.buyer_questions) == 2
    assert analysis.price_question is None
    assert analysis.seller_facts == ["How much storage does it have? 256GB"]
    assert "256GB" in listing.description
    assert record["status"] == "analyzed"
    assert any(item.key == "buyer_question_1" for item in response.missing_checklist)
    assert not any(item.key == "price_question" for item in response.missing_checklist)


@pytest.mark.asyncio
async def test_manual_price_is_kept_and_only_suggestion_updates(monkeypatch, temp_db):
    ai = RevisingAI()
    _use_route_ai(monkeypatch, ai)
    item = await _saved_item(status="saved")

    response = await items_api.answer_listing_questions(
        item["id"],
        ListingAnswersRequest(
            answers=[ListingAnswer(question="What is the battery health?", answer="92%")],
            active_price=325,
            active_price_source="manual",
        ),
    )

    assert response.repriced is True  # stored buyer question is marked affects_price
    assert response.active_price == 325
    assert response.active_price_source == "manual"
    assert response.listing.price_suggestion.recommended_price == 420
    _, _, record = await _stored(item["id"])
    assert record["status"] == "saved"


@pytest.mark.asyncio
async def test_non_price_answer_revises_description_without_repricing(monkeypatch, temp_db):
    ai = RevisingAI()
    _use_route_ai(monkeypatch, ai)
    item = await _saved_item()

    response = await items_api.answer_listing_questions(
        item["id"],
        ListingAnswersRequest(
            answers=[
                ListingAnswer(question="Is it unlocked?", answer="Unlocked"),
                ListingAnswer(question="What is the battery health?", answer="   "),
            ],
            active_price=340,
        ),
    )

    assert ai.calls[0]["reprice"] is False
    assert ai.calls[0]["new_facts"] == ["Is it unlocked? Unlocked"]
    assert response.repriced is False
    assert response.active_price == 340
    assert response.listing.price_suggestion.recommended_price == 340
    remaining = [q.question for q in response.listing.buyer_questions]
    assert remaining == ["What is the battery health?"]  # blank answers do not clear a question
    assert response.listing.price_question is not None


@pytest.mark.asyncio
async def test_client_listing_text_is_used_but_questions_come_from_server(monkeypatch, temp_db):
    ai = RevisingAI()
    _use_route_ai(monkeypatch, ai)
    item = await _saved_item()
    edited = _listing().model_copy(
        update={"description": "My own words about this phone.", "price_question": None, "buyer_questions": []}
    )

    await items_api.answer_listing_questions(
        item["id"],
        ListingAnswersRequest(
            answers=[ListingAnswer(question="How much storage does it have?", answer="128GB")],
            listing=edited,
        ),
    )

    sent = ai.calls[0]["listing"]
    assert sent.description == "My own words about this phone."
    assert sent.price_question is not None and sent.price_question.question == PRICE_QUESTION["question"]
    assert ai.calls[0]["reprice"] is True


@pytest.mark.asyncio
async def test_edit_changes_reprice_and_update_analysis(monkeypatch, temp_db):
    ai = RevisingAI()
    _use_route_ai(monkeypatch, ai)
    item = await _saved_item()

    response = await items_api.answer_listing_questions(
        item["id"],
        ListingAnswersRequest(
            changes=ListingChanges(condition="Fair", flaws="Cracked camera lens", accessories=""),
            active_price_source="ai_recommended",
            active_price=340,
        ),
    )

    assert ai.calls[0]["reprice"] is True
    assert ai.calls[0]["new_facts"] == [
        "Condition: Fair",
        "Flaws: Cracked camera lens",
        "Included accessories: none (seller cleared this)",
    ]
    assert ai.calls[0]["analysis"].condition == "Fair"
    assert response.active_price == 420
    # Changes do not answer the open questions.
    assert response.listing.price_question is not None
    analysis, _, _ = await _stored(item["id"])
    assert "Condition: Fair" in analysis.seller_facts


@pytest.mark.asyncio
async def test_dismiss_clears_questions_without_ai(monkeypatch, temp_db):
    calls = _use_route_ai(monkeypatch, RevisingAI())
    item = await _saved_item()

    response = await items_api.answer_listing_questions(
        item["id"],
        ListingAnswersRequest(dismiss=True, active_price=340, active_price_source="ai_recommended"),
    )

    assert calls == []
    assert response.repriced is False
    assert response.active_price == 340
    assert response.listing.price_question is None
    assert response.listing.buyer_questions == []
    analysis, listing, _ = await _stored(item["id"])
    assert listing.price_question is None and listing.buyer_questions == []
    assert analysis.price_question is None and analysis.buyer_questions == []
    assert listing.description == _listing().description


@pytest.mark.asyncio
async def test_answers_require_an_existing_listing(monkeypatch, temp_db):
    _use_route_ai(monkeypatch, RevisingAI())
    item = await database.create_item("/tmp/missing-photo.jpg")

    with pytest.raises(items_api.HTTPException) as exc_info:
        await items_api.answer_listing_questions(
            item["id"],
            ListingAnswersRequest(answers=[ListingAnswer(question="Q?", answer="A")]),
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_answers_for_unknown_item_return_404(monkeypatch, temp_db):
    _use_route_ai(monkeypatch, RevisingAI())

    with pytest.raises(items_api.HTTPException) as exc_info:
        await items_api.answer_listing_questions(
            "missing",
            ListingAnswersRequest(answers=[ListingAnswer(question="Q?", answer="A")]),
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_provider_failure_maps_to_502_and_keeps_stored_listing(monkeypatch, temp_db):
    _use_route_ai(monkeypatch, RevisingAI(error=GeminiClientError("boom")))
    item = await _saved_item()

    with pytest.raises(items_api.HTTPException) as exc_info:
        await items_api.answer_listing_questions(
            item["id"],
            ListingAnswersRequest(answers=[ListingAnswer(question="Is it unlocked?", answer="Yes")]),
        )
    assert exc_info.value.status_code == 502
    _, listing, _ = await _stored(item["id"])
    assert len(listing.buyer_questions) == 2


@pytest.mark.asyncio
async def test_missing_byok_credential_is_reported(monkeypatch, temp_db):
    from app.config import settings

    monkeypatch.setattr(settings, "ai_provider", "claude")
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    monkeypatch.setattr(settings, "allow_server_ai_key_fallback", False)
    item = await _saved_item()

    with pytest.raises(items_api.HTTPException) as exc_info:
        await items_api.answer_listing_questions(
            item["id"],
            ListingAnswersRequest(answers=[ListingAnswer(question="Is it unlocked?", answer="Yes")]),
            ai_key=None,
            ai_provider="claude",
        )
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "AI_CREDENTIAL_REQUIRED"


def test_active_price_rules():
    suggestion = PriceSuggestion(fast_sale_price=10, recommended_price=20, high_ask_price=30)
    assert active_price_after_reprice(suggestion, active_price=15, active_price_source="manual", repriced=True) == 15
    assert active_price_after_reprice(suggestion, active_price=15, active_price_source="ai_high_ask", repriced=True) == 30
    assert active_price_after_reprice(suggestion, active_price=15, active_price_source=None, repriced=True) == 20
    assert active_price_after_reprice(suggestion, active_price=15, active_price_source="ai_fast_sale", repriced=False) == 15
    assert active_price_after_reprice(suggestion, active_price=0, active_price_source=None, repriced=False) == 20


def test_merge_seller_facts_replaces_answers_to_the_same_question():
    merged = merge_seller_facts(
        ["How much storage does it have? 128GB", "Condition: Good"],
        ["How much storage does it have? 256GB", "Condition: Fair"],
    )
    assert merged == ["How much storage does it have? 256GB", "Condition: Fair"]


def test_answers_request_shape_round_trips():
    payload = ListingAnswersRequest.model_validate(
        json.loads(
            '{"answers": [{"question": "Q?", "answer": "A", "affects_price": true}],'
            ' "changes": {"condition": "Fair"}, "active_price": 12, "active_price_source": "manual"}'
        )
    )
    assert payload.answers[0].affects_price is True
    assert payload.changes is not None and payload.changes.has_changes()
    assert payload.dismiss is False
