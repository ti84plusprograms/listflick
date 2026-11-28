"""Deterministic listing readiness scoring."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.schemas.listing import (
    ChecklistItem,
    GeneratedListing,
    ImageQualityFeedback,
    ListingQuality,
    ReadinessLabel,
    VisionAnalysis,
)
from app.services.listing_checklist import UNKNOWN_VALUES


QUALITY_WEIGHTS = {
    "title": 18,
    "description": 22,
    "condition": 14,
    "pricing": 16,
    "photos": 14,
    "buyer_details": 16,
}

GENERIC_TITLE_WORDS = {
    "item",
    "thing",
    "stuff",
    "misc",
    "miscellaneous",
    "unknown",
    "for sale",
    "nice item",
}
UNCERTAIN_CLAIM_PATTERN = re.compile(
    r"\b(?:maybe|possibly|probably|appears to|seems to|i think|not sure|unknown|n/a)\b",
    re.I,
)
CONDITION_PATTERN = re.compile(
    r"\b(?:new|like new|good|fair|needs repair|used|excellent|working|wear|scratch|scuff|stain|dent)\b",
    re.I,
)
PICKUP_PATTERN = re.compile(
    r"\b(?:pickup|pick up|porch pickup|meetup|meet up|shipping|ship|cash|venmo|zelle)\b",
    re.I,
)


@dataclass(frozen=True)
class ComponentScore:
    key: str
    score: int
    suggestion: str | None = None


def calculate_listing_quality(
    analysis: VisionAnalysis | None,
    listing: GeneratedListing,
    *,
    missing_checklist: list[ChecklistItem] | None = None,
    image_quality_feedback: list[ImageQualityFeedback] | None = None,
) -> ListingQuality:
    """Score listing readiness from existing deterministic signals only."""

    checklist = missing_checklist or []
    photos = image_quality_feedback or []
    components = [
        _title_score(listing),
        _description_score(listing),
        _condition_score(analysis, listing, checklist),
        _pricing_score(listing),
        _photo_score(photos),
        _buyer_details_score(checklist, listing),
    ]
    breakdown = {component.key: component.score for component in components}
    overall = max(0, min(100, sum(breakdown.values())))
    return ListingQuality(
        overall_score=overall,
        readiness_label=_readiness_label(overall),
        score_breakdown=breakdown,
        improvement_suggestions=[component.suggestion for component in components if component.suggestion][:4],
    )


def listing_with_quality(
    analysis: VisionAnalysis | None,
    listing: GeneratedListing,
    *,
    missing_checklist: list[ChecklistItem] | None = None,
    image_quality_feedback: list[ImageQualityFeedback] | None = None,
) -> GeneratedListing:
    quality = calculate_listing_quality(
        analysis,
        listing,
        missing_checklist=missing_checklist,
        image_quality_feedback=image_quality_feedback,
    )
    return listing.model_copy(update={"listing_quality": quality})


def _readiness_label(score: int) -> ReadinessLabel:
    if score >= 82:
        return "ready"
    if score >= 60:
        return "almost_ready"
    return "needs_work"


def _has_value(value: str | None) -> bool:
    return (value or "").strip().lower() not in UNKNOWN_VALUES


def _is_generic_title(title: str) -> bool:
    normalized = re.sub(r"\s+", " ", title.strip().lower())
    return not normalized or normalized in GENERIC_TITLE_WORDS or len(normalized.split()) < 3


def _title_score(listing: GeneratedListing) -> ComponentScore:
    title = listing.title.strip()
    score = QUALITY_WEIGHTS["title"]
    suggestion = None
    if _is_generic_title(title):
        score -= 12
        suggestion = "Use a specific title with brand, item type, and key searchable detail."
    if len(title) < 20:
        score -= 4
        suggestion = suggestion or "Add one more searchable detail to the title."
    if UNCERTAIN_CLAIM_PATTERN.search(title):
        score -= 4
        suggestion = suggestion or "Remove uncertain claims from the title."
    return ComponentScore("title", max(0, score), suggestion)


def _description_score(listing: GeneratedListing) -> ComponentScore:
    description = listing.description.strip()
    score = QUALITY_WEIGHTS["description"]
    suggestion = None
    if len(description) < 80:
        score -= 12
        suggestion = "Add a short buyer-facing description with condition, included items, and pickup details."
    if "[insert" in description.lower():
        score -= 6
        suggestion = suggestion or "Replace placeholder text before posting."
    if UNCERTAIN_CLAIM_PATTERN.search(description):
        score -= 5
        suggestion = suggestion or "Confirm or remove uncertain claims in the description."
    if not PICKUP_PATTERN.search(description):
        score -= 4
        suggestion = suggestion or "Add pickup, shipping, or payment preference."
    return ComponentScore("description", max(0, score), suggestion)


def _condition_score(
    analysis: VisionAnalysis | None,
    listing: GeneratedListing,
    checklist: list[ChecklistItem],
) -> ComponentScore:
    score = QUALITY_WEIGHTS["condition"]
    condition_item = _checklist_item(checklist, "condition")
    has_condition = _has_value(analysis.condition if analysis else "") or bool(
        CONDITION_PATTERN.search(listing.description)
    )
    if (condition_item and condition_item.status == "missing") or not has_condition:
        return ComponentScore("condition", 0, "Add condition and any visible wear or flaws.")
    if condition_item and condition_item.status == "uncertain":
        return ComponentScore("condition", max(0, score - 6), "Confirm the condition details before posting.")
    return ComponentScore("condition", score)


def _pricing_score(listing: GeneratedListing) -> ComponentScore:
    price = listing.price_suggestion
    has_price = price.recommended_price > 0 or price.min > 0 or price.max > 0
    if not has_price:
        return ComponentScore("pricing", 0, "Set an asking price.")
    score = QUALITY_WEIGHTS["pricing"]
    if price.confidence < 0.5:
        score -= 8
        suggestion = "Compare similar listings or choose a final asking price."
    elif price.confidence < 0.75:
        score -= 4
        suggestion = "Review pricing before posting."
    else:
        suggestion = None
    if price.min != price.max and price.recommended_price <= 0:
        score -= 3
        suggestion = suggestion or "Choose a final asking price from the suggested range."
    if listing.price_question is not None and listing.price_question.question:
        score -= 4
        suggestion = "Answer the price question so the suggested price fits your exact item."
    return ComponentScore("pricing", max(0, score), suggestion)


def _photo_score(image_quality_feedback: list[ImageQualityFeedback]) -> ComponentScore:
    if not image_quality_feedback:
        return ComponentScore("photos", 8, "Add clear photos from multiple angles.")
    score = QUALITY_WEIGHTS["photos"]
    if any(item.overall_status == "poor" for item in image_quality_feedback):
        return ComponentScore("photos", max(0, score - 10), "Retake blurry, dark, or unclear photos.")
    if any(item.overall_status == "needs_improvement" for item in image_quality_feedback):
        return ComponentScore("photos", max(0, score - 5), "Improve lighting or add a clearer photo.")
    return ComponentScore("photos", score)


def _buyer_details_score(checklist: list[ChecklistItem], listing: GeneratedListing) -> ComponentScore:
    if not checklist:
        return ComponentScore("buyer_details", 10, "Confirm buyer-facing details before posting.")
    missing = [item for item in checklist if item.status == "missing"]
    uncertain = [item for item in checklist if item.status == "uncertain"]
    score = QUALITY_WEIGHTS["buyer_details"] - (len(missing) * 2) - len(uncertain)
    if missing:
        labels = ", ".join(item.label.lower() for item in missing[:2])
        return ComponentScore("buyer_details", max(0, score), f"Fill in missing details: {labels}.")
    if uncertain:
        return ComponentScore("buyer_details", max(0, score), "Confirm AI-detected details before posting.")
    if not listing.marketplace_category.strip():
        return ComponentScore("buyer_details", max(0, score - 4), "Choose a Marketplace category.")
    return ComponentScore("buyer_details", max(0, score))


def _checklist_item(checklist: list[ChecklistItem], key: str) -> ChecklistItem | None:
    return next((item for item in checklist if item.key == key), None)
