"""Canonical rendering and cleanup for marketplace listing descriptions."""

from __future__ import annotations

import re
from collections.abc import Iterable

from app.schemas.gemini_outputs import GeminiDescriptionSections
from app.schemas.listing import PriceSuggestion

SECTION_FEATURES = "🔹 Features:"
SECTION_PRICE = "💵 Price:"
SECTION_CONDITION = "✅ Condition:"
SECTION_PICKUP = "📍 Pickup Details:"

_SECTION_HEADINGS = {SECTION_FEATURES, SECTION_PRICE, SECTION_CONDITION, SECTION_PICKUP}
_SUGGESTED_PRICE_PATTERN = re.compile(r"\bsuggested\s+(?:price\s+)?(?:range|price)\b", re.IGNORECASE)
_BULLET_PREFIX_PATTERN = re.compile(r"^[•·*\-–—]+\s*")


def _clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _dedupe(values: Iterable[object]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = _clean_text(value)
        key = text.casefold().rstrip(".!?")
        if not text or key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def _clean_opening(value: str) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    return text.rstrip(".") + "."


def _strip_bullet_prefix(value: str) -> str:
    return _BULLET_PREFIX_PATTERN.sub("", _clean_text(value)).strip()


def _clean_feature(value: str) -> str:
    return _strip_bullet_prefix(value)


def _format_price(price: PriceSuggestion) -> str:
    amount = price.recommended_price or price.max or price.min
    if amount <= 0:
        return "[Insert Your Price]"
    return f"${amount:,.2f}".rstrip("0").rstrip(".")


def _fallback_condition(condition_details: str) -> str:
    details = _clean_text(condition_details)
    return details or "[Confirm condition and visible defects]"


def _safe_pickup_details(values: Iterable[object]) -> list[str]:
    details = _dedupe(_strip_bullet_prefix(value) for value in values)
    return details or ["Location: [Insert City/Neighborhood]", "Payment: [Insert Payment Methods]"]


def render_structured_description(
    sections: GeminiDescriptionSections,
    *,
    price: PriceSuggestion,
) -> str:
    """Render structured model output into one stable, paste-ready format."""
    lines: list[str] = []
    opening = _clean_opening(sections.opening)
    if opening:
        lines.append(opening)

    features = _dedupe(_clean_feature(value) for value in sections.features)
    if features:
        lines.extend(["", SECTION_FEATURES, *(f"- {value}" for value in features)])

    lines.extend(["", f"{SECTION_PRICE} {_format_price(price)}"])

    condition = _fallback_condition(sections.condition_details)
    lines.extend(["", f"{SECTION_CONDITION} {condition}"])

    pickup = _safe_pickup_details(sections.pickup_details)
    lines.extend(["", SECTION_PICKUP, *(f"- {value}" for value in pickup)])

    closing = _clean_opening(sections.closing)
    if closing:
        lines.extend(["", closing])

    return "\n".join(lines).strip()


def normalize_legacy_description(description: str) -> str:
    """Clean older free-form model output without changing its meaning."""
    lines: list[str] = []
    seen: set[str] = set()
    for raw_line in description.splitlines():
        line = raw_line.strip()
        if not line or line in _SECTION_HEADINGS:
            if line and (not lines or lines[-1] != line):
                lines.append(line)
            continue
        if _SUGGESTED_PRICE_PATTERN.search(line):
            continue
        key = re.sub(r"\s+", " ", line).casefold().rstrip(".!?")
        if key in seen:
            continue
        seen.add(key)
        lines.append(line)

    return "\n".join(lines).strip()
