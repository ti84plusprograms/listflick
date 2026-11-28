import pytest
from pydantic import ValidationError

from app.schemas.gemini_outputs import GeminiDescriptionSections
from app.schemas.listing import PriceSuggestion
from app.services.description_renderer import (
    CONDITION_PLACEHOLDER,
    DETAILS_HEADING,
    SECTION_CONDITION,
    SECTION_FEATURES,
    SECTION_PICKUP,
    SECTION_PRICE,
    is_legacy_description,
    normalize_legacy_description,
    render_structured_description,
    strip_price_lines,
)


# ---------------------------------------------------------------------------
# Local semantic helpers
# ---------------------------------------------------------------------------


def assert_no_excess_blank_lines(rendered: str) -> None:
    assert "\n\n\n" not in rendered


def assert_heading_occurs_once(rendered: str, heading: str) -> None:
    assert rendered.count(heading) == 1


def nonempty_lines(value: str) -> list[str]:
    return [line for line in value.splitlines() if line.strip()]


LEGACY_HEADINGS = [SECTION_FEATURES, SECTION_PRICE, SECTION_CONDITION, SECTION_PICKUP]
THREE_FEATURES = ["Gray finish", "Compact footprint", "Two drawers"]


def render(**kwargs) -> str:
    price = kwargs.pop("price", PriceSuggestion(recommended_price=25))
    condition = kwargs.pop("condition", "")
    return render_structured_description(GeminiDescriptionSections(**kwargs), price=price, condition=condition)


# ---------------------------------------------------------------------------
# New plain-text layout
# ---------------------------------------------------------------------------


def test_render_structured_description_canonical_full_example_exact_output():
    rendered = render(
        opening="Apple iPhone 13 in blue, unlocked",
        features=["128GB storage", "Model A2482", "Blue", "Includes clear case"],
        condition_details="Good. Light scratches on the back glass.",
        pickup_details=["Location: Midtown", "Payment: Cash or Venmo"],
        closing="Open to reasonable offers.",
    )

    assert rendered == (
        "Apple iPhone 13 in blue, unlocked.\n"
        "\n"
        "Details:\n"
        "- 128GB storage\n"
        "- Model A2482\n"
        "- Blue\n"
        "- Includes clear case\n"
        "\n"
        "Condition: Good. Light scratches on the back glass.\n"
        "\n"
        "Pickup in Midtown. Cash or Venmo. Open to reasonable offers."
    )


def test_render_structured_description_has_no_emoji_headers_or_price():
    rendered = render(
        opening="Selling a gray desk",
        features=THREE_FEATURES,
        condition_details="Good. Minor surface wear.",
        pickup_details=["Location: Midtown"],
        price=PriceSuggestion(recommended_price=125, min=100, max=150),
    )

    for heading in LEGACY_HEADINGS:
        assert heading not in rendered
    assert "$" not in rendered
    assert "Price" not in rendered
    assert not is_legacy_description(rendered)


def test_render_structured_description_orders_parts_with_blank_lines():
    rendered = render(
        opening="Selling a gray desk",
        features=THREE_FEATURES,
        condition_details="Good.",
        pickup_details=["Location: Midtown"],
    )

    opening = rendered.index("Selling a gray desk.")
    details = rendered.index(DETAILS_HEADING)
    condition = rendered.index("Condition: Good.")
    pickup = rendered.index("Pickup in Midtown.")
    assert opening < details < condition < pickup
    assert rendered.split("\n\n") == [
        "Selling a gray desk.",
        "Details:\n- Gray finish\n- Compact footprint\n- Two drawers",
        "Condition: Good.",
        "Pickup in Midtown.",
    ]
    assert not rendered.startswith("\n") and not rendered.endswith("\n")
    assert_no_excess_blank_lines(rendered)


def test_render_structured_description_is_deterministic():
    kwargs = dict(opening="Selling a lamp", features=THREE_FEATURES, condition_details="Used, works.")
    assert render(**kwargs) == render(**kwargs)


def test_render_structured_description_without_price_argument():
    rendered = render_structured_description(
        GeminiDescriptionSections(opening="Selling a lamp.", condition_details="Good."),
    )
    assert rendered == "Selling a lamp.\n\nCondition: Good."


# ---------------------------------------------------------------------------
# Details list
# ---------------------------------------------------------------------------


def test_render_structured_description_omits_details_list_with_fewer_than_three_facts():
    rendered = render(opening="Selling a gray desk", features=["Gray finish", "Compact footprint"], condition_details="Good.")

    assert DETAILS_HEADING not in rendered
    assert "- " not in rendered
    # The facts are kept as short sentences instead of being dropped.
    assert rendered.startswith("Selling a gray desk. Gray finish. Compact footprint.")


def test_render_structured_description_does_not_repeat_fact_already_in_opening():
    rendered = render(opening="Selling a gray desk with a gray finish", features=["Gray finish"], condition_details="Good.")

    assert rendered.lower().count("gray finish") == 1


def test_render_structured_description_caps_details_at_eight():
    features = [f"Fact {index}" for index in range(1, 12)]
    rendered = render(opening="Selling a kit.", features=features, condition_details="Good.")

    assert len([line for line in rendered.splitlines() if line.startswith("- ")]) == 8
    assert "- Fact 8" in rendered
    assert "Fact 9" not in rendered


@pytest.mark.parametrize(
    "raw_feature",
    [
        pytest.param("Gray finish", id="plain"),
        pytest.param(" Gray finish ", id="surrounding-space"),
        pytest.param("- Gray finish", id="dash-bullet"),
        pytest.param("* Gray finish", id="asterisk-bullet"),
        pytest.param("• Gray finish", id="unicode-bullet"),
        pytest.param("-- Gray finish", id="double-dash-bullet"),
        pytest.param("GRAY FINISH", id="uppercase"),
        pytest.param("Gray finish.", id="trailing-period"),
    ],
)
def test_render_structured_description_dedupes_feature_variants(raw_feature):
    rendered = render(opening="Selling an item.", features=[*THREE_FEATURES, raw_feature], condition_details="Good.")

    assert rendered.lower().count("gray finish") == 1


@pytest.mark.parametrize(
    "raw_feature",
    [
        pytest.param("- compact footprint", id="dash"),
        pytest.param("* compact footprint", id="asterisk"),
        pytest.param("• compact footprint", id="unicode-bullet"),
        pytest.param("  - compact footprint", id="leading-whitespace-then-dash"),
    ],
)
def test_render_structured_description_normalizes_existing_bullet_prefixes(raw_feature):
    rendered = render(opening="Selling an item.", features=["Oak top", "Steel legs", raw_feature], condition_details="Good.")

    assert "- compact footprint" in rendered
    for doubled in ("- - ", "- * ", "- • ", "- -- "):
        assert doubled not in rendered


def test_render_structured_description_preserves_meaningful_internal_hyphens():
    rendered = render(
        opening="Selling a table.",
        features=["mid-century design", "well-maintained finish", "110-volt adapter"],
        condition_details="Good.",
    )

    assert "- mid-century design" in rendered
    assert "- well-maintained finish" in rendered
    assert "- 110-volt adapter" in rendered


def test_render_structured_description_ignores_meaningless_feature_entries():
    rendered = render(opening="Selling an item.", features=["", " ", "-", "*", "•", "--"], condition_details="Good.")

    assert DETAILS_HEADING not in rendered
    assert rendered == "Selling an item.\n\nCondition: Good."


@pytest.mark.parametrize(
    "feature_text",
    [
        pytest.param("Owner’s manual included", id="smart-apostrophe"),
        pytest.param("Black & silver finish", id="ampersand"),
        pytest.param("Indoor/outdoor use", id="slash"),
        pytest.param("Café-style table", id="accented-character"),
        pytest.param("Works with 110–240V", id="en-dash-range"),
        pytest.param("Paid €90 originally", id="euro-currency"),
        pytest.param("Tested and working (like new)", id="parentheses"),
    ],
)
def test_render_structured_description_preserves_unicode_and_punctuation_in_details(feature_text):
    rendered = render(opening="Selling an item.", features=["Oak top", "Steel legs", feature_text], condition_details="Good.")

    assert f"- {feature_text}" in rendered


# ---------------------------------------------------------------------------
# Condition
# ---------------------------------------------------------------------------


def test_render_structured_description_condition_line_uses_plain_prefix():
    rendered = render(opening="Selling a lamp.", condition_details="fair. Shade has a small tear.")

    assert "Condition: Fair. Shade has a small tear." in rendered
    assert SECTION_CONDITION not in rendered


def test_render_structured_description_does_not_double_condition_label():
    rendered = render(opening="Selling a lamp.", condition_details="✅ Condition: Good.")

    assert rendered.count("Condition:") == 1
    assert "Condition: Good." in rendered


def test_render_structured_description_falls_back_to_analysis_condition():
    rendered = render(opening="Selling a lamp.", condition="like new")

    assert "Condition: Like new." in rendered


def test_render_structured_description_uses_condition_placeholder_when_unknown():
    rendered = render(opening="Selling a lamp.")

    assert f"Condition: {CONDITION_PLACEHOLDER}" in rendered


# ---------------------------------------------------------------------------
# Logistics line
# ---------------------------------------------------------------------------


def test_render_structured_description_omits_logistics_when_unknown():
    rendered = render(
        opening="Selling an item.",
        condition_details="Fair.",
        pickup_details=["Location: [Insert City/Neighborhood]", "Payment: [Insert Payment Methods]"],
    )

    assert "[Insert" not in rendered
    assert "Pickup" not in rendered
    assert rendered.endswith("Condition: Fair.")


def test_render_structured_description_writes_logistics_as_one_line():
    rendered = render(
        opening="Selling an item.",
        condition_details="Good.",
        pickup_details=["Location: Midtown", "- Payment: Cash or Venmo", "Shipping: available within the US"],
    )

    assert nonempty_lines(rendered)[-1] == "Pickup in Midtown. Cash or Venmo. Available within the US."


@pytest.mark.parametrize(
    "raw_pickup",
    [
        pytest.param("Location: Midtown", id="plain"),
        pytest.param(" Location: Midtown ", id="surrounding-space"),
        pytest.param("- Location: Midtown", id="dash-bullet"),
        pytest.param("• Location: Midtown", id="unicode-bullet"),
    ],
)
def test_render_structured_description_dedupes_logistics_variants(raw_pickup):
    rendered = render(opening="Selling an item.", condition_details="Good.", pickup_details=["Location: Midtown", raw_pickup])

    assert rendered.count("Pickup in Midtown.") == 1


@pytest.mark.parametrize(
    ("closing", "expected"),
    [
        pytest.param("Open to reasonable offers.", "Open to reasonable offers.", id="offers"),
        pytest.param("Price is firm", "Price is firm.", id="firm"),
    ],
)
def test_render_structured_description_keeps_offer_or_firm_closing_on_logistics_line(closing, expected):
    rendered = render(opening="Selling an item.", condition_details="Good.", pickup_details=["Location: Midtown"], closing=closing)

    assert nonempty_lines(rendered)[-1] == f"Pickup in Midtown. {expected}"


def test_render_structured_description_drops_sign_off_closings():
    rendered = render(opening="Selling an item.", condition_details="Good.", closing="Feel free to message me with questions")

    assert "message me" not in rendered
    assert rendered.endswith("Condition: Good.")


# ---------------------------------------------------------------------------
# Price line cleanup and legacy detection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "price_line",
    [
        pytest.param("💵 Price: $25", id="legacy-emoji"),
        pytest.param("Price: $25 (negotiable)", id="plain"),
        pytest.param("Asking price: $25", id="asking"),
    ],
)
def test_strip_price_lines_removes_price_lines(price_line):
    description = f"Selling a lamp.\n\n{price_line}\n\nCondition: Good."

    assert strip_price_lines(description) == "Selling a lamp.\n\nCondition: Good."


def test_strip_price_lines_keeps_sentences_that_mention_price():
    description = "Selling a lamp.\nThe price includes the shade.\n\nPrice is firm."

    assert strip_price_lines(description) == description


def test_is_legacy_description_detects_emoji_headers():
    assert is_legacy_description("Selling a lamp.\n\n✅ Condition: Good.")
    assert is_legacy_description("🔹 Features:\n- Brass base")
    assert not is_legacy_description("Selling a lamp.\n\nDetails:\n- a\n- b\n- c\n\nCondition: Good.")


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


# ---------------------------------------------------------------------------
# Layout-aware normalization
# ---------------------------------------------------------------------------


def test_normalize_description_keeps_plain_layout_blank_lines():
    from app.services.description_renderer import normalize_description

    description = "Oak desk.\n\n\n\nDetails:\n- Oak top\n- Oak top\n- Steel legs\n\nCondition: Good.\nSuggested price: $60"

    assert normalize_description(description) == "Oak desk.\n\nDetails:\n- Oak top\n- Steel legs\n\nCondition: Good."


def test_normalize_description_uses_legacy_rules_for_emoji_layout():
    from app.services.description_renderer import normalize_description

    description = "Selling a lamp.\n\n✅ Condition: Good."

    assert normalize_description(description) == normalize_legacy_description(description)
