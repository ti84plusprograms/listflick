import pytest
from pydantic import ValidationError

from app.schemas.gemini_outputs import GeminiDescriptionSections
from app.schemas.listing import PriceSuggestion
from app.services.description_renderer import (
    SECTION_CONDITION,
    SECTION_FEATURES,
    SECTION_PICKUP,
    SECTION_PRICE,
    normalize_legacy_description,
    render_structured_description,
)


# ---------------------------------------------------------------------------
# Local semantic helpers
# ---------------------------------------------------------------------------


def assert_sections_in_order(rendered: str, headings: list[str]) -> None:
    positions = [rendered.index(heading) for heading in headings]
    assert positions == sorted(positions)


def assert_no_excess_blank_lines(rendered: str) -> None:
    assert "\n\n\n" not in rendered


def assert_heading_occurs_once(rendered: str, heading: str) -> None:
    assert rendered.count(heading) == 1


def nonempty_lines(value: str) -> list[str]:
    return [line for line in value.splitlines() if line.strip()]


ALL_HEADINGS = [SECTION_FEATURES, SECTION_PRICE, SECTION_CONDITION, SECTION_PICKUP]


# ---------------------------------------------------------------------------
# Full layout / section ordering
# ---------------------------------------------------------------------------


def test_render_structured_description_orders_all_populated_sections():
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling a gray desk",
            features=["Gray finish", "Compact footprint"],
            condition_details="Good condition with minor surface wear.",
            pickup_details=["Location: Midtown", "Payment: Cash or Venmo"],
        ),
        price=PriceSuggestion(recommended_price=25),
    )

    assert_sections_in_order(rendered, ALL_HEADINGS)
    assert rendered.index("Selling a gray desk.") < rendered.index(SECTION_FEATURES)
    for heading in ALL_HEADINGS:
        assert_heading_occurs_once(rendered, heading)
    assert not rendered.startswith("\n")
    assert not rendered.endswith("\n")
    assert_no_excess_blank_lines(rendered)


def test_render_structured_description_omits_features_heading_when_no_features():
    rendered = render_structured_description(
        GeminiDescriptionSections(opening="Selling an item.", condition_details="Fair condition."),
        price=PriceSuggestion(recommended_price=10),
    )

    assert SECTION_FEATURES not in rendered
    # Price, Condition, and Pickup are always present regardless of features.
    assert_sections_in_order(rendered, [SECTION_PRICE, SECTION_CONDITION, SECTION_PICKUP])
    assert_no_excess_blank_lines(rendered)


def test_render_structured_description_is_deterministic():
    sections = GeminiDescriptionSections(
        opening="Selling a lamp",
        features=["Brass base", "Fabric shade"],
        condition_details="Used, works well.",
        pickup_details=["Location: Downtown"],
    )
    price = PriceSuggestion(recommended_price=40)

    first = render_structured_description(sections, price=price)
    second = render_structured_description(sections, price=price)

    assert second == first


def test_render_structured_description_canonical_full_example_exact_output():
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling a gray desk",
            features=["Gray finish"],
            condition_details="Good condition.",
            pickup_details=["Location: Midtown", "Payment: Cash"],
        ),
        price=PriceSuggestion(recommended_price=25),
    )

    assert rendered == (
        "Selling a gray desk.\n"
        "\n"
        "🔹 Features:\n"
        "- Gray finish\n"
        "\n"
        "💵 Price: $25\n"
        "\n"
        "✅ Condition: Good condition.\n"
        "\n"
        "📍 Pickup Details:\n"
        "- Location: Midtown\n"
        "- Payment: Cash"
    )


# ---------------------------------------------------------------------------
# Feature deduplication and bullet normalization
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw_feature",
    [
        pytest.param("Gray finish", id="plain"),
        pytest.param(" Gray finish", id="leading-space"),
        pytest.param("Gray finish ", id="trailing-space"),
        pytest.param(" Gray finish ", id="surrounding-space"),
        pytest.param("- Gray finish", id="dash-bullet"),
        pytest.param("* Gray finish", id="asterisk-bullet"),
        pytest.param("• Gray finish", id="unicode-bullet"),
        pytest.param("-- Gray finish", id="double-dash-bullet"),
        pytest.param("GRAY FINISH", id="uppercase"),
        pytest.param("Gray finish.", id="trailing-period"),
    ],
)
def test_render_structured_description_dedupes_feature_variants_against_canonical(raw_feature):
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling an item.",
            features=["Gray finish", raw_feature],
            condition_details="Good.",
        ),
        price=PriceSuggestion(recommended_price=10),
    )

    assert rendered.count("Gray finish") == 1


@pytest.mark.parametrize(
    ("raw_feature", "expected"),
    [
        pytest.param("compact footprint", "compact footprint", id="plain"),
        pytest.param("- compact footprint", "compact footprint", id="dash"),
        pytest.param("* compact footprint", "compact footprint", id="asterisk"),
        pytest.param("• compact footprint", "compact footprint", id="unicode-bullet"),
        pytest.param("-- compact footprint", "compact footprint", id="double-dash"),
        pytest.param("  - compact footprint", "compact footprint", id="leading-whitespace-then-dash"),
    ],
)
def test_render_structured_description_normalizes_existing_bullet_prefixes(raw_feature, expected):
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling an item.",
            features=[raw_feature],
            condition_details="Good.",
        ),
        price=PriceSuggestion(recommended_price=10),
    )

    assert f"- {expected}" in rendered
    assert "- - " not in rendered
    assert "- * " not in rendered
    assert "- • " not in rendered
    assert "- -- " not in rendered


def test_render_structured_description_preserves_meaningful_internal_hyphens():
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling a table.",
            features=["mid-century design", "well-maintained condition", "110-volt adapter"],
            condition_details="Good.",
        ),
        price=PriceSuggestion(recommended_price=10),
    )

    assert "- mid-century design" in rendered
    assert "- well-maintained condition" in rendered
    assert "- 110-volt adapter" in rendered


@pytest.mark.parametrize(
    "raw_feature",
    [
        pytest.param("", id="empty"),
        pytest.param(" ", id="whitespace-only"),
        pytest.param("-", id="lone-dash"),
        pytest.param("*", id="lone-asterisk"),
        pytest.param("•", id="lone-unicode-bullet"),
        pytest.param("--", id="lone-double-dash"),
    ],
)
def test_render_structured_description_omits_empty_feature_entries(raw_feature):
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling an item.",
            features=[raw_feature, "Valid feature"],
            condition_details="Good.",
        ),
        price=PriceSuggestion(recommended_price=10),
    )

    lines_after_heading = [
        line for line in rendered.splitlines() if line.startswith("- ") and "Valid feature" not in line
    ]
    # Only the valid feature bullet should remain; no blank/lone-bullet lines.
    assert lines_after_heading == [] or all(line.strip() != "-" for line in lines_after_heading)
    assert "- Valid feature" in rendered
    assert "\n- \n" not in rendered
    assert not rendered.endswith("- ")


def test_render_structured_description_features_section_absent_when_all_entries_meaningless():
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling an item.",
            features=["", " ", "-", "*", "•", "--"],
            condition_details="Good.",
        ),
        price=PriceSuggestion(recommended_price=10),
    )

    assert SECTION_FEATURES not in rendered
    assert_no_excess_blank_lines(rendered)


# ---------------------------------------------------------------------------
# Price rendering (schema-verified: PriceSuggestion has min/max/recommended_price,
# no explicit "range" concept in rendering -- renderer always shows one amount,
# falling back recommended_price -> max -> min)
# ---------------------------------------------------------------------------


def test_render_structured_description_renders_exact_integer_price():
    rendered = render_structured_description(
        GeminiDescriptionSections(opening="Selling an item.", condition_details="Good."),
        price=PriceSuggestion(recommended_price=25),
    )

    assert f"{SECTION_PRICE} $25" in rendered
    assert_heading_occurs_once(rendered, SECTION_PRICE)
    assert rendered.count("$25") == 1


def test_render_structured_description_renders_decimal_price():
    rendered = render_structured_description(
        GeminiDescriptionSections(opening="Selling an item.", condition_details="Good."),
        price=PriceSuggestion(recommended_price=19.99),
    )

    assert f"{SECTION_PRICE} $19.99" in rendered


def test_render_structured_description_uses_placeholder_when_all_prices_are_zero():
    rendered = render_structured_description(
        GeminiDescriptionSections(opening="Selling an item.", condition_details="Good."),
        price=PriceSuggestion(),
    )

    assert f"{SECTION_PRICE} [Insert Your Price]" in rendered
    assert_heading_occurs_once(rendered, SECTION_PRICE)


def test_render_structured_description_falls_back_to_max_when_recommended_price_is_zero():
    rendered = render_structured_description(
        GeminiDescriptionSections(opening="Selling an item.", condition_details="Good."),
        price=PriceSuggestion(max=30),
    )

    assert f"{SECTION_PRICE} $30" in rendered


def test_render_structured_description_falls_back_to_min_when_recommended_and_max_are_zero():
    rendered = render_structured_description(
        GeminiDescriptionSections(opening="Selling an item.", condition_details="Good."),
        price=PriceSuggestion(min=15),
    )

    assert f"{SECTION_PRICE} $15" in rendered


def test_render_structured_description_prefers_recommended_price_over_max_and_min():
    rendered = render_structured_description(
        GeminiDescriptionSections(opening="Selling an item.", condition_details="Good."),
        price=PriceSuggestion(recommended_price=25, max=100, min=5),
    )

    assert f"{SECTION_PRICE} $25" in rendered
    assert "$100" not in rendered
    assert "$5" not in rendered


# ---------------------------------------------------------------------------
# PriceSuggestion schema behavior (schema layer, independent of renderer)
# ---------------------------------------------------------------------------


def test_price_suggestion_clamps_negative_recommended_price_to_zero():
    # A before-validator clamps negatives to 0 rather than rejecting them,
    # so ge=0 never actually fails on negative input.
    price = PriceSuggestion(recommended_price=-1)

    assert price.recommended_price == 0.0


def test_price_suggestion_clamps_non_numeric_recommended_price_to_zero():
    price = PriceSuggestion(recommended_price="not-a-number")

    assert price.recommended_price == 0.0


def test_price_suggestion_coerces_numeric_strings():
    price = PriceSuggestion(recommended_price="25")

    assert price.recommended_price == 25.0


def test_price_suggestion_clamps_confidence_above_one():
    price = PriceSuggestion(confidence=5)

    assert price.confidence == 1.0


def test_price_suggestion_rejects_non_mapping_payload():
    # The before-validator only normalizes dict-shaped input (`isinstance(value, dict)`);
    # a non-mapping payload skips normalization entirely and fails ordinary
    # model validation instead of being silently coerced.
    with pytest.raises(ValidationError):
        PriceSuggestion.model_validate("not-a-mapping")


# ---------------------------------------------------------------------------
# Condition rendering
# ---------------------------------------------------------------------------


def test_render_structured_description_uses_condition_fallback_placeholder_when_missing():
    rendered = render_structured_description(
        GeminiDescriptionSections(opening="Selling an item."),
        price=PriceSuggestion(recommended_price=10),
    )

    assert f"{SECTION_CONDITION} [Confirm condition and visible defects]" in rendered


# ---------------------------------------------------------------------------
# Pickup / logistics rendering
# ---------------------------------------------------------------------------


def test_render_structured_description_uses_safe_placeholders_for_missing_logistics():
    rendered = render_structured_description(
        GeminiDescriptionSections(opening="Selling an item.", condition_details="Fair condition."),
        price=PriceSuggestion(),
    )

    assert "Location: [Insert City/Neighborhood]" in rendered
    assert "Payment: [Insert Payment Methods]" in rendered
    assert rendered.count("Location: [Insert City/Neighborhood]") == 1
    assert rendered.count("Payment: [Insert Payment Methods]") == 1


def test_render_structured_description_preserves_explicit_location_only():
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling an item.",
            condition_details="Good.",
            pickup_details=["Location: Midtown"],
        ),
        price=PriceSuggestion(recommended_price=10),
    )

    assert "- Location: Midtown" in rendered
    # Payment logistics still absent from schema (no separate payment field
    # to fall back on); pickup_details fallback only applies when the entire
    # list is empty, so a partial list is preserved as-is.
    assert "Payment:" not in rendered


def test_render_structured_description_preserves_both_explicit_logistics_values():
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling an item.",
            condition_details="Good.",
            pickup_details=["Location: Midtown", "Payment: Cash or Venmo"],
        ),
        price=PriceSuggestion(recommended_price=10),
    )

    assert "- Location: Midtown" in rendered
    assert "- Payment: Cash or Venmo" in rendered
    assert rendered.count("Location:") == 1
    assert rendered.count("Payment:") == 1


@pytest.mark.parametrize(
    "raw_pickup",
    [
        pytest.param("Location: Midtown", id="plain"),
        pytest.param(" Location: Midtown", id="leading-space"),
        pytest.param("Location: Midtown ", id="trailing-space"),
        pytest.param("- Location: Midtown", id="dash-bullet"),
        pytest.param("* Location: Midtown", id="asterisk-bullet"),
        pytest.param("• Location: Midtown", id="unicode-bullet"),
    ],
)
def test_render_structured_description_dedupes_pickup_variants(raw_pickup):
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling an item.",
            condition_details="Good.",
            pickup_details=["Location: Midtown", raw_pickup],
        ),
        price=PriceSuggestion(recommended_price=10),
    )

    assert rendered.count("Location: Midtown") == 1
    assert "- - " not in rendered
    assert "- * " not in rendered
    assert "- • " not in rendered


def test_render_structured_description_pickup_details_appear_after_condition():
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling an item.",
            condition_details="Good.",
            pickup_details=["Location: Midtown"],
        ),
        price=PriceSuggestion(recommended_price=10),
    )

    assert rendered.index(SECTION_CONDITION) < rendered.index(SECTION_PICKUP)


# ---------------------------------------------------------------------------
# Unicode / punctuation preservation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "feature_text",
    [
        pytest.param("Owner’s manual included", id="smart-apostrophe"),
        pytest.param("Black & silver finish", id="ampersand"),
        pytest.param("Indoor/outdoor use", id="slash"),
        pytest.param("High-quality, well-maintained frame", id="hyphen-comma"),
        pytest.param("Café-style table", id="accented-character"),
        pytest.param("Works with 110–240V", id="en-dash-range"),
        pytest.param("Paid €90 originally", id="euro-currency"),
        pytest.param("Tested and working (like new)", id="parentheses"),
    ],
)
def test_render_structured_description_preserves_unicode_and_punctuation_in_features(feature_text):
    rendered = render_structured_description(
        GeminiDescriptionSections(
            opening="Selling an item.",
            features=[feature_text],
            condition_details="Good.",
        ),
        price=PriceSuggestion(recommended_price=10),
    )

    assert feature_text in rendered


# ---------------------------------------------------------------------------
# Legacy description normalization
# ---------------------------------------------------------------------------


def test_normalize_legacy_description_removes_duplicate_and_suggested_price_lines():
    description = """Selling a lamp.

Selling a lamp.
💵 Price: $20-$30
Suggested price range: $20-$30.
✅ Condition: Good."""

    cleaned = normalize_legacy_description(description)

    assert cleaned.count("Selling a lamp.") == 1
    assert "Suggested price range" not in cleaned
    assert "💵 Price: $20-$30" in cleaned
    assert "✅ Condition: Good." in cleaned


@pytest.mark.parametrize(
    "suggested_price_line",
    [
        pytest.param("Suggested price range: $20-$30", id="mixed-case"),
        pytest.param("Suggested Price Range: $20-$30", id="title-case"),
        pytest.param(" suggested price range: $20-$30", id="leading-space-lowercase"),
        pytest.param("SUGGESTED PRICE RANGE: $20-$30", id="all-caps"),
        pytest.param("Suggested price: $25", id="suggested-price-only"),
        pytest.param("AI suggested price range: $20-$30", id="embedded-mid-sentence"),
    ],
)
def test_normalize_legacy_description_removes_suggested_price_variants(suggested_price_line):
    description = f"Selling a lamp.\n{suggested_price_line}\n✅ Condition: Good."

    cleaned = normalize_legacy_description(description)

    assert "suggested" not in cleaned.lower()
    assert "Selling a lamp." in cleaned
    assert "✅ Condition: Good." in cleaned


def test_normalize_legacy_description_removes_suggested_price_line_at_end():
    description = "Selling a lamp.\n✅ Condition: Good.\nSuggested price range: $20-$30"

    cleaned = normalize_legacy_description(description)

    assert "suggested" not in cleaned.lower()
    assert cleaned.endswith("✅ Condition: Good.")


def test_normalize_legacy_description_removes_multiple_suggested_price_lines():
    description = (
        "Selling a lamp.\n"
        "Suggested price range: $20-$30\n"
        "✅ Condition: Good.\n"
        "Suggested price: $25"
    )

    cleaned = normalize_legacy_description(description)

    assert "suggested" not in cleaned.lower()
    assert "Selling a lamp." in cleaned
    assert "✅ Condition: Good." in cleaned


@pytest.mark.parametrize(
    "legitimate_line",
    [
        pytest.param("The original retail price was $120.", id="retail-price"),
        pytest.param("The price includes both chairs.", id="price-includes"),
        pytest.param("This was purchased at full price.", id="purchased-at-price"),
        pytest.param("Price is firm because the item is unused.", id="price-is-firm"),
    ],
)
def test_normalize_legacy_description_preserves_legitimate_price_text(legitimate_line):
    description = f"Selling a chair.\n{legitimate_line}\n✅ Condition: Good."

    cleaned = normalize_legacy_description(description)

    assert legitimate_line in cleaned


def test_normalize_legacy_description_removes_duplicate_paragraphs_across_blank_line_gaps():
    description = "Selling a lamp.\n\n\n\nSelling a lamp.\n✅ Condition: Good."

    cleaned = normalize_legacy_description(description)

    assert cleaned.count("Selling a lamp.") == 1


def test_normalize_legacy_description_removes_duplicate_lines_with_surrounding_whitespace():
    description = "Selling a lamp.\n   Selling a lamp.   \n✅ Condition: Good."

    cleaned = normalize_legacy_description(description)

    assert cleaned.count("Selling a lamp.") == 1


def test_normalize_legacy_description_collapses_excessive_blank_lines():
    description = "Selling a lamp.\n\n\n\n\n✅ Condition: Good."

    cleaned = normalize_legacy_description(description)

    assert_no_excess_blank_lines(cleaned)
    assert "\n\n" not in cleaned


def test_normalize_legacy_description_preserves_repeated_section_headings_once_adjacent_duplicate():
    description = "🔹 Features:\n🔹 Features:\n- Gray finish"

    cleaned = normalize_legacy_description(description)

    assert cleaned.count("🔹 Features:") == 1


def test_normalize_legacy_description_returns_already_clean_description_unchanged():
    description = "Selling a lamp.\n✅ Condition: Good.\n📍 Pickup Details:\n- Location: Midtown"

    cleaned = normalize_legacy_description(description)

    assert cleaned == description


def test_normalize_legacy_description_no_price_information_present():
    description = "Selling a lamp.\n✅ Condition: Good."

    cleaned = normalize_legacy_description(description)

    assert cleaned == description


@pytest.mark.parametrize(
    "meaningful_text",
    [
        pytest.param("Owner’s manual included", id="smart-apostrophe"),
        pytest.param("Black & silver finish", id="ampersand"),
        pytest.param("Indoor/outdoor use", id="slash"),
        pytest.param("High-quality, well-maintained frame", id="hyphen-comma"),
        pytest.param("Café-style table", id="accented-character"),
        pytest.param("Works with 110–240V", id="en-dash-range"),
        pytest.param("Paid €90 originally", id="euro-currency"),
        pytest.param("✅ Tested and working", id="emoji-prefix"),
        pytest.param('The seller said "like new".', id="quotation-marks"),
    ],
)
def test_normalize_legacy_description_preserves_unicode_and_punctuation(meaningful_text):
    description = f"Selling an item.\n{meaningful_text}\n✅ Condition: Good."

    cleaned = normalize_legacy_description(description)

    assert meaningful_text in cleaned


@pytest.mark.parametrize(
    "description",
    [
        pytest.param(
            "Selling a lamp.\n\nSelling a lamp.\n✅ Condition: Good.",
            id="duplicate-paragraphs",
        ),
        pytest.param(
            "Selling a lamp.\nSuggested price range: $20-$30\n✅ Condition: Good.",
            id="suggested-price-line",
        ),
        pytest.param(
            "Selling a lamp.\n\n\n\n\n✅ Condition: Good.",
            id="excessive-whitespace",
        ),
        pytest.param(
            "Selling a lamp.\n✅ Condition: Good.\n📍 Pickup Details:\n- Location: Midtown",
            id="already-clean",
        ),
        pytest.param(
            "🔹 Features:\n- Gray finish\n- Gray finish\n✅ Condition: Good.",
            id="bullets-and-headings",
        ),
    ],
)
def test_normalize_legacy_description_is_idempotent(description):
    once = normalize_legacy_description(description)
    twice = normalize_legacy_description(once)

    assert twice == once
