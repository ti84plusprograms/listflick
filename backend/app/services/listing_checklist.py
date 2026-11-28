"""Deterministic listing completeness checks for buyer-facing details."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.schemas.listing import ChecklistItem, GeneratedListing, VisionAnalysis

UNKNOWN_VALUES = {"", "unknown", "n/a", "na", "none", "not sure", "unsure", "tbd", "user input pending"}


@dataclass(frozen=True)
class ChecklistSpec:
    key: str
    label: str
    question: str


CHECKLIST_SPECS = {
    "brand": ChecklistSpec("brand", "Brand", "What brand is it?"),
    "model": ChecklistSpec("model", "Model", "What model or style name should buyers search for?"),
    "dimensions": ChecklistSpec("dimensions", "Dimensions", "What are the key measurements or size?"),
    "condition": ChecklistSpec("condition", "Condition", "What condition should the listing show?"),
    "color": ChecklistSpec("color", "Color", "What color should be listed?"),
    "material": ChecklistSpec("material", "Material", "What material is it made from?"),
    "category": ChecklistSpec("category", "Category", "Which Marketplace category fits best?"),
    "flaws": ChecklistSpec("flaws", "Flaws", "Are there any scratches, stains, missing parts, or other flaws?"),
    "included_accessories": ChecklistSpec(
        "included_accessories",
        "Included accessories",
        "What accessories, parts, cords, or manuals are included?",
    ),
    "pickup_shipping": ChecklistSpec(
        "pickup_shipping",
        "Pickup/shipping preference",
        "Do you want pickup, shipping, or both?",
    ),
    "price_confidence": ChecklistSpec(
        "price_confidence",
        "Price confidence",
        "What exact asking price do you want to list?",
    ),
}


def build_missing_checklist(
    analysis: VisionAnalysis,
    listing: GeneratedListing,
    confirmed_keys: set[str] | None = None,
) -> list[ChecklistItem]:
    confirmed = confirmed_keys or set()
    text = _combined_text(analysis, listing)
    description = listing.description or ""

    return [
        *_open_question_items(listing),
        _brand_item(analysis),
        _text_item("model", _has_model(text), "AI may have inferred a model; confirm before posting."),
        _text_item("dimensions", _has_dimensions(text), "Measurements are useful for buyer fit."),
        _condition_item(analysis, listing, "condition" in confirmed),
        _attribute_item("color", analysis, text),
        _attribute_item("material", analysis, text),
        _category_item(analysis, listing, "category" in confirmed),
        _flaws_item(analysis, text),
        _accessories_item(text),
        _pickup_shipping_item(description),
        _price_item(listing),
    ]


def _open_question_items(listing: GeneratedListing) -> list[ChecklistItem]:
    """Unanswered price and buyer questions are missing information the seller still has to give."""
    items: list[ChecklistItem] = []
    price_question = listing.price_question
    if price_question is not None and price_question.question:
        items.append(
            ChecklistItem(
                key="price_question",
                label="Price detail",
                status="missing",
                reason=price_question.why or "This detail can change the price a lot.",
                suggested_question=price_question.question,
            )
        )
    for index, question in enumerate(listing.buyer_questions):
        if not question.question:
            continue
        items.append(
            ChecklistItem(
                key=f"buyer_question_{index + 1}",
                label="Buyer question",
                status="missing",
                reason="Buyers usually ask this and the photos do not answer it."
                + (" It can change the price." if question.affects_price else ""),
                suggested_question=question.question,
            )
        )
    return items


def _item(key: str, status: str, reason: str | None = None) -> ChecklistItem:
    spec = CHECKLIST_SPECS[key]
    return ChecklistItem(
        key=spec.key,
        label=spec.label,
        status=status,  # type: ignore[arg-type]
        reason=reason,
        suggested_question=spec.question if status != "complete" else None,
    )


def _has_value(value: str | None) -> bool:
    normalized = (value or "").strip().lower()
    return normalized not in UNKNOWN_VALUES and "[insert" not in normalized


def _combined_text(analysis: VisionAnalysis, listing: GeneratedListing) -> str:
    fields = [
        analysis.item_name,
        analysis.brand,
        analysis.condition,
        analysis.category,
        " ".join(analysis.detected_attributes),
        " ".join(analysis.visible_defects),
        listing.title,
        listing.description,
        listing.marketplace_category,
        " ".join(listing.tags),
    ]
    return "\n".join(value for value in fields if value).lower()


def _brand_item(analysis: VisionAnalysis) -> ChecklistItem:
    if not _has_value(analysis.brand):
        return _item("brand", "missing", "Brand was not confidently identified.")
    return _item("brand", "uncertain", "Brand appears AI-detected; confirm it from the item label.")


def _text_item(key: str, present: bool, uncertain_reason: str) -> ChecklistItem:
    if present:
        return _item(key, "uncertain", uncertain_reason)
    return _item(key, "missing", f"{CHECKLIST_SPECS[key].label} is not in the listing yet.")


def _has_model(text: str) -> bool:
    return bool(
        re.search(r"\b(model|style|series|generation|gen)\s*[:#-]?\s*[a-z0-9][a-z0-9 -]{1,20}\b", text, re.I)
        or re.search(r"\b[a-z]{1,6}[- ]?\d{1,5}[a-z]?\b", text, re.I)
    )


def _has_dimensions(text: str) -> bool:
    return bool(
        re.search(r"\b\d+(?:\.\d+)?\s*(?:x|by)\s*\d+(?:\.\d+)?\b", text, re.I)
        or re.search(r"\b\d+(?:\.\d+)?\s*(?:in|inch|inches|ft|feet|cm|mm|lb|lbs)\b", text, re.I)
        or re.search(r"\b(size|dimensions|measurements?)\s*[:#-]?\s*[a-z0-9]", text, re.I)
    )


def _condition_item(analysis: VisionAnalysis, listing: GeneratedListing, confirmed: bool) -> ChecklistItem:
    condition = analysis.condition
    description_has_condition = bool(re.search(r"\b(new|like new|good|fair|needs repair)\b", listing.description, re.I))
    if confirmed and (_has_value(condition) or description_has_condition):
        return _item("condition", "complete")
    if _has_value(condition) or description_has_condition:
        return _item("condition", "uncertain", "Condition is AI-filled unless you confirm it.")
    return _item("condition", "missing", "Condition is not listed.")


def _category_item(analysis: VisionAnalysis, listing: GeneratedListing, confirmed: bool) -> ChecklistItem:
    if confirmed and (_has_value(listing.marketplace_category) or _has_value(analysis.category)):
        return _item("category", "complete")
    if _has_value(listing.marketplace_category) or _has_value(analysis.category):
        return _item("category", "uncertain", "Category is AI-selected; confirm it matches Marketplace.")
    return _item("category", "missing", "Category is not selected.")


def _attribute_item(key: str, analysis: VisionAnalysis, text: str) -> ChecklistItem:
    patterns = {
        "color": r"\b(color|black|white|gray|grey|blue|red|green|brown|tan|beige|pink|purple|yellow|orange|silver|gold)\b",
        "material": r"\b(material|wood|metal|plastic|glass|leather|fabric|cotton|wool|polyester|ceramic|steel|aluminum)\b",
    }
    if re.search(patterns[key], text, re.I):
        return _item(key, "uncertain", f"{CHECKLIST_SPECS[key].label} appears AI-detected; confirm before posting.")
    return _item(key, "missing", f"{CHECKLIST_SPECS[key].label} is not described.")


def _flaws_item(analysis: VisionAnalysis, text: str) -> ChecklistItem:
    if analysis.visible_defects:
        return _item("flaws", "uncertain", "Visible flaws were AI-detected; confirm severity.")
    if re.search(r"\b(no visible|no known|flaw|scratch|scuff|stain|dent|damage|wear|missing)\b", text, re.I):
        return _item("flaws", "uncertain", "Flaw disclosure appears AI-written; confirm it is accurate.")
    return _item("flaws", "missing", "Flaw disclosure is not included.")


def _accessories_item(text: str) -> ChecklistItem:
    if re.search(r"\b(includes|included|comes with|accessor(?:y|ies)|charger|cord|cable|manual|case|box|remote)\b", text, re.I):
        return _item("included_accessories", "uncertain", "Included items may be AI-inferred; confirm what is actually included.")
    return _item("included_accessories", "missing", "Included accessories are not stated.")


def _pickup_shipping_item(description: str) -> ChecklistItem:
    lower = description.lower()
    has_placeholder = "[insert" in lower
    has_preference = bool(re.search(r"\b(pickup|pick up|porch pickup|meetup|meet up|shipping|ship)\b", lower))
    if has_preference and not has_placeholder:
        return _item("pickup_shipping", "complete")
    if has_preference:
        return _item("pickup_shipping", "missing", "Pickup or shipping details still contain a placeholder.")
    return _item("pickup_shipping", "missing", "Pickup or shipping preference is not included.")


def _price_item(listing: GeneratedListing) -> ChecklistItem:
    price = listing.price_suggestion
    if price.min <= 0 and price.max <= 0 and price.recommended_price <= 0:
        return _item("price_confidence", "missing", "No asking price or price range is set.")
    if price.confidence and price.confidence < 0.5:
        return _item("price_confidence", "uncertain", "Pricing confidence is low; compare similar sold listings.")
    if price.min == price.max:
        return _item("price_confidence", "complete")
    return _item("price_confidence", "uncertain", "AI provided a price range; choose a final asking price.")
