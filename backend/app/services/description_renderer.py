"""Canonical rendering and cleanup for marketplace listing descriptions.

New descriptions use a plain-text layout with no emoji headers and no price:

    One or two sentences saying what it is.

    Details:
    - fact
    - fact
    - fact

    Condition: Good. Honest flaw sentence.

    Pickup in Midtown. Cash or Venmo. Open to reasonable offers.

Older saved descriptions used emoji section headers (the SECTION_* constants). They are still
recognized by normalize_legacy_description so stored listings keep loading.
"""

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

DETAILS_HEADING = "Details:"
CONDITION_PREFIX = "Condition:"
MIN_DETAILS = 3
MAX_DETAILS = 8
CONDITION_PLACEHOLDER = "[Confirm condition and visible defects]"

_PLACEHOLDER_PATTERN = re.compile(r"\[[^\]]*\]")
_LOCATION_LABEL = re.compile(r"^(?:location|pickup(?: location)?|pick up)\s*:\s*", re.IGNORECASE)
_PAYMENT_LABEL = re.compile(r"^payment(?: methods?)?\s*:\s*", re.IGNORECASE)
_OTHER_LABEL = re.compile(r"^(?:shipping|availability|delivery)\s*:\s*", re.IGNORECASE)
_CLOSING_ALLOWED = re.compile(r"\b(?:offers?|firm|negotiable|obo)\b", re.IGNORECASE)
_CONDITION_LABEL = re.compile(r"^(?:✅\s*)?condition\s*:\s*", re.IGNORECASE)
_PRICE_LINE = re.compile(r"^(?:💵\s*)?(?:asking\s+)?price\s*:", re.IGNORECASE)
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
    return _as_sentence(text)


def _as_sentence(value: str) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    if text[-1] in ".!?":
        return text
    return text.rstrip(",;:") + "."


def _strip_bullet_prefix(value: str) -> str:
    return _BULLET_PREFIX_PATTERN.sub("", _clean_text(value)).strip()


def _clean_feature(value: str) -> str:
    return _strip_bullet_prefix(value)


def _format_price(price: PriceSuggestion) -> str:
    amount = price.recommended_price or price.max or price.min
    if amount <= 0:
        return "[Insert Your Price]"
    return f"${amount:,.2f}".rstrip("0").rstrip(".")


def _logistics_sentence(value: str) -> str:
    text = _strip_bullet_prefix(value)
    if not text or _PLACEHOLDER_PATTERN.search(text):
        return ""
    if _LOCATION_LABEL.match(text):
        place = _LOCATION_LABEL.sub("", text).strip().rstrip(".")
        return f"Pickup in {place}." if place else ""
    if _PAYMENT_LABEL.match(text):
        methods = _PAYMENT_LABEL.sub("", text).strip()
        return _as_sentence(methods[:1].upper() + methods[1:]) if methods else ""
    if _OTHER_LABEL.match(text):
        text = _OTHER_LABEL.sub("", text).strip()
        text = text[:1].upper() + text[1:]
    return _as_sentence(text)


def _logistics_line(pickup_details: Iterable[object], closing: str) -> str:
    sentences = _dedupe(_logistics_sentence(str(value)) for value in pickup_details)
    closing_text = _as_sentence(closing)
    if closing_text and _CLOSING_ALLOWED.search(closing_text) and not _PLACEHOLDER_PATTERN.search(closing_text):
        sentences = _dedupe([*sentences, closing_text])
    return " ".join(sentences)


def _condition_text(condition_details: str, condition: str) -> str:
    details = _CONDITION_LABEL.sub("", _clean_text(condition_details)).strip()
    if details:
        return _as_sentence(details[:1].upper() + details[1:])
    fallback = _clean_text(condition)
    if fallback and fallback.lower() != "unknown":
        return _as_sentence(fallback[:1].upper() + fallback[1:].lower())
    return CONDITION_PLACEHOLDER


def render_structured_description(
    sections: GeminiDescriptionSections,
    *,
    price: PriceSuggestion | None = None,
    condition: str = "",
) -> str:
    """Render structured model output into one stable, paste-ready plain-text layout.

    The price is accepted for backward compatibility but never written: Marketplace shows the
    price separately, and a price line in the description goes stale when the seller edits it.
    """
    del price
    parts: list[str] = []
    opening = _clean_opening(sections.opening)

    features = _dedupe(_clean_feature(value) for value in sections.features)[:MAX_DETAILS]
    if len(features) >= MIN_DETAILS:
        parts_details = [DETAILS_HEADING, *(f"- {value}" for value in features)]
    else:
        # Too few facts for a list: keep them as short sentences after the opening instead of dropping them.
        lowered_opening = opening.casefold()
        extra = [_as_sentence(value) for value in features if value.casefold().rstrip(".") not in lowered_opening]
        opening = " ".join(part for part in [opening, *extra] if part)
        parts_details = []

    if opening:
        parts.append(opening)
    if parts_details:
        parts.append("\n".join(parts_details))

    parts.append(f"{CONDITION_PREFIX} {_condition_text(sections.condition_details, condition)}")

    logistics = _logistics_line(sections.pickup_details, sections.closing)
    if logistics:
        parts.append(logistics)

    return "\n\n".join(parts).strip()


def strip_price_lines(description: str) -> str:
    """Drop price lines (legacy emoji or plain) from a description; Marketplace shows price separately."""
    kept = [line for line in description.splitlines() if not _PRICE_LINE.match(line.strip())]
    text = "\n".join(line.rstrip() for line in kept)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def is_legacy_description(description: str) -> bool:
    """True when a description uses the old emoji section headers."""
    markers = tuple(heading.split(" ")[0] for heading in _SECTION_HEADINGS)
    return any(line.strip().startswith(markers) for line in description.splitlines())


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


def normalize_description(description: str) -> str:
    """Clean model-written description text in either layout.

    Legacy emoji-header text keeps the old normalization. Plain-layout text keeps its blank
    lines between parts (they are part of the layout) but loses repeated lines, runs of blank
    lines and "suggested price" lines.
    """
    if is_legacy_description(description):
        return normalize_legacy_description(description)

    lines: list[str] = []
    seen: set[str] = set()
    for raw_line in description.splitlines():
        line = raw_line.strip()
        if not line:
            if lines and lines[-1] != "":
                lines.append("")
            continue
        if _SUGGESTED_PRICE_PATTERN.search(line):
            continue
        key = re.sub(r"\s+", " ", line).casefold().rstrip(".!?")
        if key in seen:
            continue
        seen.add(key)
        lines.append(line)

    return "\n".join(lines).strip()
